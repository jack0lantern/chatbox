# Chess Plugin Chat Integration

Wire the chess plugin into the chat window so the AI can invoke chess tools and the board renders as a persistent iframe.

## Decisions

- **Trigger**: AI-driven — AI generates tool calls (`start_game`, `get_game_state`, `get_hint`, etc.)
- **Plugin registry**: Client fetches from `GET /api/plugins`, caches result
- **Tool discovery**: Plugin Tool Provider (parallel to MCP, not shoehorned into MCP)
- **Board persistence**: Single persistent iframe pinned in chat view, not inline per-message
- **Coaching vs move suggestion**: The model uses **`get_game_state`** for position-aware chat (openings, plans, coaching). It uses **`get_hint`** only when the user wants a concrete best-move suggestion from the engine. Descriptions on the plugin record and each tool schema must make that split obvious to the LLM.

---

## 1. Plugin Tool Provider

**New file:** `src/renderer/packages/plugins/pluginToolProvider.ts`

Fetches plugin definitions from `GET /api/plugins` and converts each plugin's `toolSchemas` into Vercel AI SDK `ToolSet` format.

- Tool names prefixed as `plugin__<slug>__<toolName>` (e.g., `plugin__chess__start_game`, `plugin__chess__get_game_state`) to namespace them and avoid collisions with MCP or built-in tools.
- Each tool's `execute` function doesn't run logic itself. It delegates to `PluginManager.invoke()`, which communicates with the persistent iframe and returns a Promise that resolves on `TASK_COMPLETE`.
- Plugin schemas cached in memory after first fetch. Cache invalidated on app startup or explicit refresh.

**Integration point** — merged into `stream-text.ts` at the tool set assembly (~line 296):

```ts
let tools: ToolSet = {
  ...mcpController.getAvailableTools(),
  ...pluginToolProvider.getAvailableTools(),
}
```

---

## 2. PluginManager Singleton

**New file:** `src/renderer/packages/plugins/pluginManager.ts`

Coordination layer between tool execution (from AI) and the persistent iframe (in the UI).

**Responsibilities:**

- Maintains a map of active plugin sessions: `pluginSlug → { iframeRef, bridge, state }`
- `invoke(pluginSlug, toolName, params)`:
  - If no iframe active for this plugin → emits `mount` event (UI subscribes and renders the iframe)
  - Sends `INVOKE_TOOL` via existing `PluginBridge`
  - Returns a Promise keyed by `invocationId` that resolves on `TASK_COMPLETE` or rejects on `ERROR`/timeout
- Receives `STATE_UPDATE` from bridge → persists to server via `PUT /api/plugins/{pluginId}/state`
- On session end / navigate away → sends `DESTROY`, tears down iframe, cleans up

**Communication with UI:**

- Simple EventEmitter pattern: `pluginManager.on('mount', ...)`, `pluginManager.on('unmount', ...)`
- Framework-agnostic (no React dependency). The React component subscribes to events.
- Holds a pending Promise per invocation. When `TASK_COMPLETE` arrives via postMessage, resolves the matching Promise by `invocationId`. This is how the Vercel AI SDK tool execute function gets its return value.

---

## 3. Persistent Iframe Container

**New file:** `src/renderer/components/plugin/PluginContainer.tsx`

Mounted in the chat view layout — not inside the message stream. Renders above the input box, below the message list.

**Behavior:**

- Subscribes to `pluginManager.on('mount', { pluginSlug, iframeUrl, ... })`
- When fired, renders a `PluginFrame` for that plugin (reuses existing component)
- Passes the iframe ref back to `pluginManager` so the bridge can send messages
- Header bar shows plugin name ("Chess") with minimize and close buttons
- Close → sends `DESTROY` via manager, tears down iframe
- Minimize → collapses iframe to a small pill
- Only visible when a plugin session is active

**State restore:** On mount, checks for saved state via `GET /api/plugins/{pluginId}/state`. If found, sends `STATE_RESTORE` before the first `INVOKE_TOOL`.

---

## 4. ToolCallPartUI Changes

Minimal changes to `src/renderer/components/message-parts/ToolCallPartUI.tsx`.

**Detection:** Check for `plugin__` prefix in `part.toolName`. When matched, render a `PluginToolCallUI` variant instead of `GeneralToolCallUI`.

**PluginToolCallUI:** Compact pill (reuses `ToolCallPill`) showing:
- Plugin/game icon (extend `toolIconMap`)
- Human-readable tool name (strip `plugin__chess__` prefix, title-case remainder)
- Loading/success/error state
- On expand: result JSON (same as GeneralToolCallUI), but no iframe

**Tool name display:** Extend `getToolName()` in `src/renderer/packages/tools/index.ts` to handle plugin tool names — strip prefix and title-case.

---

## 5. LLM coaching and `get_game_state`

The model does not see the board visually. For **openings, strategy, and coaching**, it needs a **read-only snapshot** of the game. That snapshot must arrive through a **tool result** (same contract as other chess tools), not by guessing from chat history.

### Tool: `get_game_state`

| Aspect | Specification |
|--------|----------------|
| **Purpose** | Return structured state so the LLM can discuss the position, suggest plans, reference opening ideas, and coach without playing a move for the student. |
| **Parameters** | Prefer `{}` (no parameters) for simplicity; optional `detail` enum later if you need a shorter payload for token limits. |
| **Behavior** | Synchronous from the iframe’s perspective: read current `chess.js` (or equivalent) state, build JSON, send **`TASK_COMPLETE`** immediately. **No** Stockfish search. |
| **When to call** | Before or when answering user questions about “this position,” “what opening is this,” “what should I think about,” etc. Not required for every message if the model already has a recent snapshot from a prior tool result. |
| **Payload (illustrative)** | At minimum: `fen`, SAN move list (or PGN fragment), side to move, flags (`inCheck`, `isCheckmate`, `isStalemate`, `isDraw`), `playerColor`, `difficulty`, `gameStarted` (or equivalent). Optionally a one-line `summary` string for quick model grounding. |
| **Empty / no game** | If no game is in progress, return a clear result (e.g. `gameStarted: false`, `fen: null`) and a short `message` — do not throw; the LLM can tell the user to start a game. |

### Distinction from `get_hint`

| Tool | Role |
|------|------|
| `get_game_state` | **Observation** — “what is the position?” for explanation and coaching. |
| `get_hint` | **Engine suggestion** — “what move should I play?” using Stockfish (or configured engine). |

Tool descriptions and the **plugin-level `description`** in the registry must spell this out so routers do not use `get_hint` for pure analysis questions.

### Clearer tool descriptions (registry)

Descriptions are part of the **tool contract** for the LLM.

- **`server/lib/plugin-seed.ts`** (or DB-backed plugin rows in production): update the Chess **`description`** to mention coaching: call `get_game_state` for position-aware help; call `get_hint` only for explicit move suggestions; use `start_game` / `end_game` / undo / redo as today.
- **Per-tool `description` fields** in `toolSchemas`: each should state **when** to use the tool and **what** it returns in one or two sentences. Avoid duplicate wording across tools; make the split between `get_game_state` and `get_hint` explicit.

No change to the Plugin Tool Provider or postMessage envelope is required beyond registering the new schema and handling it in the iframe.

---

## 6. Chess Plugin postMessage Adaptation

**Modified file:** `server/public/plugins/chess/index.html`

The chess app already has game logic. It needs to implement the postMessage protocol from the [Plugin API Contract](2026-04-02-plugin-api-contract-design.md):

- Send `READY` on load
- Listen for `INVOKE_TOOL` → route to correct handler (`start_game`, `get_game_state`, `get_hint`, `end_game`, `undo_move`, `redo_move`)
- Send `STATE_UPDATE` after each move (FEN, move history, difficulty, player color)
- Send `TASK_COMPLETE` when a tool invocation finishes (return result to AI)
- Listen for `STATE_RESTORE` → reload game from saved FEN + history
- Listen for `DESTROY` → clean up

---

## 7. Files

### New

| File | Purpose |
|------|---------|
| `src/renderer/packages/plugins/pluginToolProvider.ts` | Fetch plugin schemas, convert to Vercel AI SDK ToolSet |
| `src/renderer/packages/plugins/pluginManager.ts` | Singleton: tool execution ↔ iframe bridge coordination |
| `src/renderer/components/plugin/PluginContainer.tsx` | Persistent iframe container in chat layout |

### Modified

| File | Change |
|------|--------|
| `src/renderer/packages/model-calls/stream-text.ts` | Merge plugin tools into tool set (~3 lines) |
| `src/renderer/components/message-parts/ToolCallPartUI.tsx` | Detect `plugin__` prefix, render compact pill |
| `src/renderer/packages/tools/index.ts` | Strip plugin prefix for display names |
| `src/renderer/components/chat/` (layout) | Mount `PluginContainer` in chat view |
| `server/public/plugins/chess/index.html` | postMessage protocol; includes `get_game_state` handler |
| `server/lib/plugin-seed.ts` | Chess: add `get_game_state` schema; tighten plugin + per-tool descriptions |

### Unchanged

| File | Why |
|------|-----|
| `src/renderer/components/plugin/PluginBridge.ts` | Already implements postMessage protocol |
| `src/renderer/components/plugin/PluginFrame.tsx` | Already handles iframe lifecycle |
| `src/renderer/packages/plugin-types.ts` | Already defines message types |
| Server API routes (`/api/plugins`, `/api/plugins/{id}/state`) | Already exist; no new route required for `get_game_state` |

### Related product docs

When updating the high-level platform catalog of chess tools, keep in sync with [ChatBridge platform design](2026-04-02-chatbridge-platform-design.md) (chess tool table).
