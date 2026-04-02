# ChatBridge Platform Design

Extending the chatbox app with a server-backed plugin architecture for the TutorMeAI educational platform. Adds authentication, server-side storage, LLM proxy, and a sandboxed plugin system — while preserving the existing chat UI and multi-provider support.

**Companion spec:** [Plugin API Contract](./2026-04-02-plugin-api-contract-design.md)

---

## 1. Architecture Overview

The existing chatbox app becomes a client shell backed by a Next.js API server. Both the Electron and web builds talk to the same backend. Auth is required to use the platform on either.

```
┌─────────────────────────────────────┐
│  Client (Electron or Browser)       │
│                                     │
│  Existing chatbox React UI          │
│  + ServerPlatform (replaces local   │
│    storage with API calls)          │
│  + PluginFrame (iframe container)   │
│  + PluginBridge (postMessage)       │
└──────────────┬──────────────────────┘
               │ HTTP / SSE
               ▼
┌─────────────────────────────────────┐
│  Next.js Backend                    │
│                                     │
│  /api/auth/*     → NextAuth         │
│  /api/chat/*     → LLM proxy + SSE │
│  /api/storage/*  → CRUD for         │
│                    sessions/settings │
│  /api/plugins/*  → Registry + proxy │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  Supabase (PostgreSQL)              │
│                                     │
│  Users, Accounts, Sessions,         │
│  UserStorage, PluginRegistrations,  │
│  PluginState                        │
└─────────────────────────────────────┘
```

### What Stays in Chatbox

- React chat UI components (message list, input box, markdown rendering, code blocks)
- Session/conversation model (sessions, messages, content parts)
- Multi-provider support (OpenAI, Claude, Gemini, Ollama, etc.)
- Streaming response handling
- Settings UI, theme system, sidebar

### What Gets Swapped

The `platform` layer. A new `ServerPlatform` implements the same `Platform` interface (`getStoreValue`, `setStoreValue`, `delStoreValue`, `getAllStoreValues`, etc.) but routes through `fetch()` to the backend API instead of local storage or IPC.

### What's New

- NextAuth login gate (required before anything loads)
- LLM server-side proxy (BYOK — keys stored encrypted in Postgres)
- Plugin registry, iframe container, postMessage bridge
- Server-side proxy for tool invocations
- OAuth flows for external authenticated plugins

### Project Structure

The Next.js backend lives in a `server/` directory at the repo root, alongside the existing chatbox source:

```
chatbox/
├── src/              # existing chatbox (Electron + renderer)
├── server/           # new Next.js backend
│   ├── app/
│   │   └── api/      # API routes (auth, storage, chat, plugins)
│   ├── prisma/       # schema + migrations
│   └── plugins/      # static plugin iframe apps (chess, timeline, spotify)
├── package.json      # existing
└── ...
```

The `server/` directory has its own `package.json` and runs independently. The chatbox renderer connects to it via `fetch()`.

### Electron-Specific Code That Remains

Window management, tray icon, auto-updater, global shortcuts. Everything else goes through the server.

---

## 2. Server-Side Platform Swap

### Storage API

A user-scoped key-value store backed by PostgreSQL. Mirrors chatbox's current storage model exactly — the chat logic doesn't care that it's a database instead of localStorage.

| Route | Method | Purpose | Maps to |
|-------|--------|---------|---------|
| `/api/storage/:key` | GET | Read a value | `platform.getStoreValue(key)` |
| `/api/storage/:key` | PUT | Write a value | `platform.setStoreValue(key, value)` |
| `/api/storage/:key` | DELETE | Remove a value | `platform.delStoreValue(key)` |
| `/api/storage` | GET | Read all values | `platform.getAllStoreValues()` |

All routes require a valid NextAuth session. The backend uses the session's `userId` to partition data in PostgreSQL.

### What Gets Stored

| Key pattern | Data |
|---|---|
| `settings` | User preferences, provider configs, BYOK API keys (encrypted), theme, language, shortcuts |
| `chat-sessions-list` | Session metadata index |
| `session:{id}` | Full session with messages |
| `configs` | App-level config (device UUID, etc.) |

Same key patterns as chatbox today. The client owns the data schema; the backend is a dumb key-value store.

### API Key Encryption

User API keys (OpenAI, Claude, etc.) are encrypted at rest with a server-side key before writing to the database. The encryption key lives in an environment variable, never in the database. The client sends keys in plaintext over HTTPS; the backend encrypts before storing and decrypts only when making proxied LLM calls. The browser never holds raw API keys after initial submission.

### LLM Proxy

`POST /api/chat/completions` — called on every chat message send. The client sends the message payload (model, messages, provider) and the backend:

1. Looks up the user's encrypted API key for that provider from the database
2. Decrypts it server-side
3. Makes the API call to OpenAI/Claude/Gemini/etc.
4. Streams the response back to the client via SSE

The existing chat logic (message construction, streaming handler, token counting) stays in the React layer — only the final `fetch` target changes.

**Hybrid option:** The architecture supports switching to direct-to-provider calls for regular chat in the future, routing only plugin tool calls through the proxy. The `ServerPlatform` abstraction makes this a configuration change, not a rewrite.

### Auth Gate

Both web and Electron check for a valid NextAuth session on load. If none exists, they redirect to a login page instead of rendering the chat UI. This replaces the current splash screen flow.

---

## 3. Plugin System

Three components: the registry, the iframe container, and the postMessage bridge.

### Plugin Registry

Server-side. Stores plugin manifests in a `PluginRegistration` table. For MVP, the three bundled plugins (chess, timeline, spotify) are seeded into this table on first run — no public registration API needed yet.

### LLM Tool Discovery

When a chat session is active, the backend injects only the active/relevant plugin tool schemas into the LLM's system prompt (dynamic filtering from the architecture doc). The LLM sees standard OpenAI function definitions and emits tool calls naturally.

### Iframe Container (`PluginFrame`)

A new React component that renders when the LLM emits a tool call mapping to a registered plugin. It:

- Creates a sandboxed iframe (`sandbox="allow-scripts allow-same-origin"`)
- Manages the `READY` timeout (5s)
- Passes messages through the bridge
- Shows a loading state while waiting for `READY`
- Renders inline in the chat message stream, below the assistant message that triggered it

### postMessage Bridge (`PluginBridge`)

A class that wraps `window.postMessage` and `message` event listeners. It:

- Validates origins against `allowedOrigins` from the plugin manifest
- Routes incoming messages (`READY`, `STATE_UPDATE`, `TASK_COMPLETE`, `ERROR`) to handlers
- Sends outgoing messages (`INVOKE_TOOL`, `STATE_RESTORE`, `DESTROY`)
- Enforces the `TASK_COMPLETE` timeout (10s default)
- Tracks `invocationId` correlation

### postMessage Protocol

Seven message types. Full specification in the [Plugin API Contract](./2026-04-02-plugin-api-contract-design.md).

**Parent → Iframe:** `INVOKE_TOOL`, `STATE_RESTORE`, `DESTROY`
**Iframe → Parent:** `READY`, `STATE_UPDATE`, `TASK_COMPLETE`, `ERROR`

Iframes are long-lived and receive multiple `INVOKE_TOOL` messages during their lifetime. The LLM interprets user chat messages and maps them to defined tool schemas — plugins don't parse raw text.

### Error Handling

- **Plugin-reported:** `ERROR` message with `code`, `message`, `recoverable`
- **Timeouts:** `READY` (5s), `TASK_COMPLETE` (10s), configurable via manifest up to 30s ceiling
- **Circuit breaker:** 3 consecutive failures → plugin flagged as `unreliable`, excluded from LLM tool discovery. Developers reset via API.

---

## 4. Plugins

### Chess (`internal`)

Iframe loads a standalone React app using chess.js (game logic), react-chessboard (UI), and Stockfish WASM (AI opponent). Hosted as a static page within the app (e.g., `/plugins/chess/index.html`).

**Tool schemas:**

| Tool | Params | Description |
|------|--------|-------------|
| `start_game` | `{ difficulty: "easy"\|"medium"\|"hard", color: "white"\|"black"\|"random" }` | Start a new chess game. `random` picks a side server-side. |
| `get_hint` | `{ difficulty: "easy"\|"medium"\|"hard" }` | Suggest the best next move |
| `end_game` | `{}` | End the current game and show results |
| `undo_move` | `{}` | Undo the last move |
| `redo_move` | `{}` | Redo a previously undone move |

The AI opponent is Stockfish WASM (~2MB), running in a web worker inside the iframe. Difficulty maps to search depth (easy=depth 1, medium=depth 5, hard=depth 10). The LLM doesn't play chess — it routes user requests to the right tool call.

**Persisted state:** Board position (FEN string), move history, difficulty, color, undo/redo stacks.

### Timeline (`internal`)

A card-based history quiz game inspired by [WikiTrivia](https://wikitrivia.tomjwatson.com/). On each turn, a new event card is revealed and the student places it in the correct position on a growing timeline. Wrong placement costs a life.

**Data source:** A static JSON file bundled with the plugin (`/plugins/timeline/data/events.json`), categorized by topic:

```json
[
  { "id": "moon-landing", "event": "First Moon Landing", "year": 1969, "category": "space" },
  { "id": "magna-carta", "event": "Magna Carta Signed", "year": 1215, "category": "politics" }
]
```

No LLM dependency for quiz content. The LLM's only role is routing user intent to tool calls.

**Tool schemas:**

| Tool | Params | Description |
|------|--------|-------------|
| `start_quiz` | `{ category?: string }` | Start a new game. Optional category filter. Shuffles the deck. |
| `check_placement` | `{}` | Validate where the student placed the current card |
| `get_hint` | `{}` | Narrow down the correct position |
| `next_card` | `{}` | Draw the next card (called automatically after correct placement) |

Difficulty is emergent — the further the student gets, the tighter the gaps between dates on the timeline, making placement harder. No explicit difficulty param needed.

**Game mechanics:**
- 3 lives. Each wrong placement costs a life.
- At 0 lives, the iframe sends `TASK_COMPLETE` with the final score.

**Persisted state:** Timeline (placed cards in order), remaining deck, current card, score, lives remaining.

### Spotify (`external_authenticated`)

Iframe renders a playlist builder UI. All Spotify API calls happen server-side through the backend proxy.

**Tool schemas:**

| Tool | Params | Description |
|------|--------|-------------|
| `create_playlist` | `{ playlistName: string, songs: string[] }` | Create a new Spotify playlist |
| `search_songs` | `{ query: string }` | Search for songs |
| `add_to_playlist` | `{ playlistId: string, songs: string[] }` | Add songs to an existing playlist |

**OAuth flow:**
1. LLM emits tool call → backend checks PostgreSQL for linked Spotify token
2. No token → backend returns `AUTH_REQUIRED` → chat UI renders native "Connect Spotify" button (NOT in iframe)
3. User clicks → top-level NextAuth redirect → user consents → token stored in PostgreSQL
4. Retry → backend proxy executes Spotify API call server-side → iframe renders result
5. The iframe gets a scoped session token to render playlist state, never raw OAuth tokens

---

## 5. Database Schema

All tables in Supabase PostgreSQL, managed via Prisma. Local Supabase for development, hosted for production.

### NextAuth Tables (auto-generated)

- `User` — id, email, name, image
- `Account` — linked OAuth providers (Spotify tokens live here)
- `Session` — active sessions
- `VerificationToken` — email verification

### App Tables

```prisma
model UserStorage {
  id        String   @id @default(uuid())
  userId    String
  key       String
  value     Json
  updatedAt DateTime @updatedAt

  @@unique([userId, key])
}

model PluginRegistration {
  id            String   @id @default(uuid())
  appSlug       String   @unique
  appName       String
  description   String
  iframeUrl     String
  authPattern   String   // "internal" | "external_public" | "external_authenticated"
  oauthProvider String?
  toolSchemas   Json     // array of OpenAI function definitions
  permissions   Json
  apiKey        String   // developer's key for manifest updates
  status        String   @default("active")  // "active" | "unreliable"
  failureCount  Int      @default(0)
  createdAt     DateTime @default(now())
}

model PluginState {
  id           String   @id @default(uuid())
  userId       String
  pluginId     String
  invocationId String
  state        Json
  updatedAt    DateTime @updatedAt

  @@unique([userId, pluginId, invocationId])
}
```

Chat sessions are stored as JSON in `UserStorage` using the same key patterns chatbox uses today (`chat-sessions-list`, `session:{id}`). This avoids remodeling the session data structure.

---

## 6. Build Order

Four phases — each one deployable and testable before the next starts.

### Phase 1: Server + Auth + Storage (Day 1-2)

- Scaffold Next.js backend with local Supabase
- Prisma schema + migrations (UserStorage, PluginRegistration, PluginState)
- NextAuth setup (credentials or email provider for now, Spotify OAuth added in Phase 4)
- `/api/storage/*` CRUD routes
- `ServerPlatform` implementation in chatbox renderer
- Auth gate — redirect to login if no session
- **Verify:** existing chatbox UI works exactly as before, but data lives in Postgres

### Phase 2: LLM Proxy + Plugin Framework (Day 3)

- `/api/chat/completions` — BYOK proxy with encrypted key storage, SSE streaming
- `PluginFrame` React component
- `PluginBridge` postMessage class
- Plugin registry seeding (3 bundled plugins)
- LLM tool discovery (inject active plugin schemas into system prompt)
- **Verify:** regular chat works through the proxy, an empty plugin iframe loads and sends `READY`

### Phase 3: Chess + Timeline Plugins (Day 4-5)

- Chess iframe app (chess.js + react-chessboard, 5 tool schemas, state persistence)
- Timeline iframe app (drag-to-order UI, 3 lives, LLM-generated quiz content)
- **Verify:** "start a chess game" → LLM routes → iframe renders → user plays → "undo that" → LLM routes `undo_move`

### Phase 4: Spotify Plugin + Polish (Day 6-7)

- NextAuth Spotify OAuth provider
- `/api/plugins/proxy/spotify` — server-side Spotify API calls
- Spotify iframe (playlist builder UI)
- Circuit breaker, timeout enforcement, error handling
- **Verify:** full lifecycle for all three plugins

---

## Technology Summary

| Concern | Technology |
|---------|-----------|
| Frontend | Existing chatbox React UI |
| Backend | Next.js (App Router, API routes) |
| Auth | NextAuth.js |
| Database | PostgreSQL via Supabase (local dev, hosted prod) |
| ORM | Prisma |
| AI | OpenAI GPT-4o-mini with function calling (BYOK, all providers supported) |
| Real-time | SSE for LLM streaming |
| Plugin UI | Sandboxed iframes |
| Plugin comms | window.postMessage (7 message types) |
| Chess engine | chess.js + react-chessboard + Stockfish WASM |
| Testing | Playwright (E2E lifecycle) |
