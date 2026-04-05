# Chess `get_game_state` and coaching-oriented tool copy — Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans to implement task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the LLM answer questions about the current position, openings, and coaching by calling a dedicated **`get_game_state`** tool, and reduce misuse of **`get_hint`** by tightening registry copy.

**Spec:** [`docs/superpowers/specs/2026-04-03-chess-plugin-chat-integration-design.md`](../specs/2026-04-03-chess-plugin-chat-integration-design.md) (Section 5: LLM coaching and `get_game_state`)

**Out of scope for this plan:** Automatic injection of chess state into every `streamText` call (optional follow-up). No new API routes.

---

## Preconditions

- Chess iframe and `PluginBridge` already route `INVOKE_TOOL` / `TASK_COMPLETE`.
- Plugin list is seeded from `server/lib/plugin-seed.ts` (or equivalent); if production uses DB-only rows, mirror the same schema and descriptions there.

---

## Task 1: Registry — add tool + rewrite descriptions

**File:** `server/lib/plugin-seed.ts`

- [ ] **Step 1:** Update the Chess plugin-level `description` so it states:
  - Students play in the embedded board.
  - For **position-aware teaching** (openings, plans, what to think about), call **`get_game_state`** first when the answer depends on the current position.
  - For **“best move” / explicit engine help**, use **`get_hint`**.
  - Mention `start_game`, `end_game`, `undo_move`, `redo_move` briefly.

- [ ] **Step 2:** Add a `get_game_state` entry to `toolSchemas` **after** `start_game` (logical order: start → observe → hint → …):
  - `name`: `get_game_state`
  - `description`: One or two sentences: read-only snapshot for coaching and analysis; not for engine best-move (that is `get_hint`). No required parameters; use `parameters: { type: 'object', properties: {} }` or equivalent empty object schema consistent with other no-arg tools in this file.

- [ ] **Step 3:** Tighten **existing** chess tool `description` fields (no behavior change):
  - `start_game`, `end_game`, `undo_move`, `redo_move`: keep accurate; add half-sentence where useful (“does not return full position text for coaching”).
  - `get_hint`: explicitly “engine-suggested move for the side to move,” not a substitute for explaining the position.

- [ ] **Step 4:** If the app re-seeds on deploy, run or document the usual seed/migrate path so `GET /api/plugins` returns the updated `toolSchemas` for chess.

**Verification:** `GET /api/plugins` (authenticated) includes `get_game_state` under chess and updated strings in JSON.

---

## Task 2: Iframe — implement `get_game_state`

**File:** `server/public/plugins/chess/index.html`

- [ ] **Step 1:** Add `handleGetGameState(invocationId)` (or inline branch) that:
  - If no active game / `chess` is null: `TASK_COMPLETE` with `{ gameStarted: false, fen: null, message: '<short string>' }` (exact shape should match spec minimums plus safe defaults).
  - If game active: build result including at least `fen`, SAN history (array or joined string), `turn` (`w` / `b`), booleans for terminal/check state derived from chess.js, `playerColor`, `difficulty`, `gameStarted: true`. Optional: short `summary` one-liner (e.g. “White to move; Black played …”).

- [ ] **Step 2:** Wire `INVOKE_TOOL`: `else if (toolName === 'get_game_state') handleGetGameState(invocationId);`

- [ ] **Step 3:** Ensure `invocationId` used for `TASK_COMPLETE` matches the active tool invocation (same pattern as `get_hint`).

**Verification:** Manually or via Playwright: post `INVOKE_TOOL` for `get_game_state` after `start_game` and assert `TASK_COMPLETE` payload contains `fen` and history; call before `start_game` and assert `gameStarted: false`.

---

## Task 3: Tests

- [ ] **Step 1 (API / unit):** Extend `server/__tests__/plugin-api.test.ts` or the e2e that lists plugins so the chess entry’s `toolSchemas` names include `get_game_state` (and optionally snapshot key description substrings if the suite already does that).

- [ ] **Step 2 (e2e):** In `server/__tests__/e2e/gap-fixes.e2e.ts` or `chess-plugin.e2e.ts`, add a focused test: load chess iframe, `start_game` via postMessage, then `get_game_state`, assert `TASK_COMPLETE` includes expected keys. Reuse existing message helpers where possible.

- [ ] **Step 3:** Run `pnpm test` (or scoped vitest/playwright command used in CI for server e2e) and fix failures.

---

## Task 4: Docs alignment (platform catalog)

**File:** `docs/superpowers/specs/2026-04-02-chatbridge-platform-design.md`

- [ ] **Step 1:** Update the Chess **tool table** to include `get_game_state` with params `{}` and a one-line description consistent with Section 5 of the chat integration spec.

---

## Task 5: Client display (only if needed)

- [ ] **Step 1:** Confirm `getToolName('plugin__chess__get_game_state')` resolves to a sensible label via existing `plugin__` snake_case logic in `src/renderer/packages/tools/index.ts`. Adjust `toolIconMap` in `ToolCallPartUI` only if chess tools need a distinct icon for the new tool (optional).

---

## Rollout notes

- **Caching:** Clients that cache `GET /api/plugins` need restart or refresh path to pick up new schemas; document if product has a “reload plugins” action.
- **Token size:** Large move histories can bloat tool results; if needed later, truncate to last N plies in the iframe or add optional `detail` in a follow-up spec.

---

## Definition of done

- `get_game_state` appears in server plugin registry and executes in the chess iframe with stable JSON shape.
- Descriptions clearly separate coaching (`get_game_state`) from engine hint (`get_hint`).
- Automated tests cover registry presence and at least one iframe round-trip for `get_game_state`.
- Platform design spec chess table mentions the new tool.
