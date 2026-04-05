# TutorMeAI Plugin API Contract

Developer-facing specification for building, registering, and communicating with third-party plugins on the TutorMeAI (ChatBridge) platform.

---

## 1. Plugin Registration

Developers register a plugin by submitting a JSON manifest to the platform.

### Endpoint

```
POST /api/plugins/register
```

### Manifest Schema

```json
{
  "app": {
    "appName": "Spotify Playlist Creator",
    "appSlug": "spotify-playlist-creator",
    "description": "Creates and manages Spotify playlists from chat",
    "iframeUrl": "https://developer-domain.com/plugin/embed",
    "authPattern": "external_authenticated",
    "oauthProvider": "spotify"
  },
  "toolSchemas": [ ... ],
  "permissions": { ... }
}
```

### `app` — Plugin Metadata

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `appName` | string | yes | Human-readable display name |
| `appSlug` | string | yes | Unique identifier. Kebab-case, immutable after registration. |
| `description` | string | yes | Short description shown to educators and injected into LLM context |
| `iframeUrl` | string | yes | The URL the platform loads inside the sandboxed iframe |
| `authPattern` | enum | yes | One of `internal`, `external_public`, or `external_authenticated` |
| `oauthProvider` | string | conditional | Required when `authPattern` is `external_authenticated`. Identifies the OAuth provider (e.g., `spotify`, `google`, `github`). |

### Auth Pattern Definitions

**`internal`** — Tools bundled with the platform. No external API calls, no credentials needed. The AI sends parameters and the platform backend executes the logic directly. `iframeUrl` is optional — only needed if the tool has a visual UI component (e.g., an interactive graph). Tools without a UI (e.g., a calculator) run entirely server-side with no iframe.
- Trust level: Absolute.
- Examples: Calculator (no UI), interactive geometry visualizer (with UI).

**`external_public`** — Third-party tools that use general-purpose data. May require a platform-owned developer API key, but never require student login.
- Trust level: Moderate.
- Examples: Weather dashboard, dictionary lookup, Wikipedia search.
- Platform handling: The backend proxy attaches the platform's API key to outbound requests.

**`external_authenticated`** — Third-party tools that access user-specific data. The platform brokers an OAuth2 flow so the student can grant the app permission.
- Trust level: Low/Strict.
- Examples: Spotify playlist creator, Google Calendar sync, GitHub repo manager.
- Platform handling: The platform manages the OAuth handshake via NextAuth in the top-level window, stores tokens securely in PostgreSQL, refreshes them automatically, and injects scoped session credentials into the tool invocation via the backend proxy. The iframe never initiates or participates in the OAuth flow.

### `toolSchemas` — OpenAI-Compatible Function Definitions

An array of tool definitions using the OpenAI function calling format. These are injected directly into the LLM's context when the plugin is active, with no transformation.

```json
{
  "toolSchemas": [
    {
      "name": "create_playlist",
      "description": "Creates a new Spotify playlist for the user",
      "parameters": {
        "type": "object",
        "properties": {
          "playlistName": {
            "type": "string",
            "description": "Name of the playlist"
          },
          "songs": {
            "type": "array",
            "items": { "type": "string" },
            "description": "List of song names to add"
          }
        },
        "required": ["playlistName", "songs"]
      }
    }
  ]
}
```

Each tool schema must include `name`, `description`, and `parameters` (as a JSON Schema object). The platform validates schemas at registration time and rejects malformed definitions.

### `permissions` — Plugin Permissions

```json
{
  "permissions": {
    "maxIframeHeight": 600,
    "allowedOrigins": ["https://developer-domain.com"],
    "requestedScopes": ["playlist-modify-public"],
    "timeouts": {
      "ready": 5,
      "taskComplete": 15
    }
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `maxIframeHeight` | number | yes | Maximum pixel height the iframe is allowed to occupy |
| `allowedOrigins` | string[] | yes | Origins permitted for `postMessage` communication. Must include the `iframeUrl` domain. Used to build CSP headers. |
| `requestedScopes` | string[] | conditional | OAuth scopes the platform will request on the user's behalf. Required when `authPattern` is `external_authenticated`. |
| `timeouts` | object | no | Custom timeout overrides in seconds. Keys: `ready` (default 5), `taskComplete` (default 10). Platform-enforced ceiling of 30 seconds. |

### Registration Response

```json
{
  "pluginId": "plg_abc123",
  "apiKey": "sk_live_xyz789",
  "status": "registered"
}
```

The `apiKey` authenticates future manifest updates via `PUT /api/plugins/{appSlug}`.

---

## 2. postMessage Protocol

All communication between the platform (parent window) and the plugin (sandboxed iframe) uses `window.postMessage` with a strict JSON schema. Direct API calls from the iframe to the platform backend are rejected.

### Message Envelope

Every message follows this structure:

```json
{
  "type": "MESSAGE_TYPE",
  "invocationId": "inv_abc123",
  "payload": { }
}
```

`invocationId` correlates all messages in a tool invocation lifecycle back to the original LLM tool call.

### Parent to Iframe (3 message types)

#### `INVOKE_TOOL`

Sent after the LLM emits a tool call and auth has been resolved by the platform.

**An iframe can receive multiple `INVOKE_TOOL` messages during its lifetime.** The first one typically starts the session (e.g., `start_game`). Subsequent ones are in-session commands routed by the LLM when the user sends chat messages directed at the running plugin (e.g., `get_game_state`, `get_hint`, `end_game`). Each `INVOKE_TOOL` carries a unique `invocationId`, but the iframe stays alive across all of them.

The LLM — not the plugin — is responsible for interpreting user intent and mapping it to the correct tool call. Plugin developers must define tool schemas for all actions their plugin can handle.

```json
{
  "type": "INVOKE_TOOL",
  "invocationId": "inv_abc123",
  "payload": {
    "toolName": "create_playlist",
    "parameters": {
      "playlistName": "Study Beats",
      "songs": ["Bohemian Rhapsody", "Clair de Lune"]
    },
    "credentials": {
      "sessionToken": "short-lived-scoped-token"
    }
  }
}
```

- `credentials` is only present for `external_authenticated` plugins. It contains a short-lived, platform-scoped session token — never a raw OAuth access token.
- `credentials` is absent for `internal` and `external_public` plugins.

#### `STATE_RESTORE`

Sent when the iframe sends `READY` and the platform has persisted state from a previous session.

```json
{
  "type": "STATE_RESTORE",
  "invocationId": "inv_abc123",
  "payload": {
    "state": {
      "currentLevel": 3,
      "score": 1200
    }
  }
}
```

#### `DESTROY`

Sent when the user navigates away or the chat session ends. Gives the plugin a chance to clean up gracefully.

```json
{
  "type": "DESTROY",
  "invocationId": "inv_abc123",
  "payload": {}
}
```

### Iframe to Parent (4 message types)

#### `READY`

Sent once when the iframe has loaded and is ready to receive messages.

```json
{
  "type": "READY",
  "invocationId": null,
  "payload": {}
}
```

`invocationId` is `null` because `READY` is sent before any invocation.

#### `STATE_UPDATE`

Sent anytime the plugin wants to persist intermediate state (e.g., game progress, form draft).

```json
{
  "type": "STATE_UPDATE",
  "invocationId": "inv_abc123",
  "payload": {
    "state": {
      "currentLevel": 4,
      "score": 1500
    }
  }
}
```

The platform persists this as a JSONB column in PostgreSQL, keyed by user + plugin + invocation.

#### `TASK_COMPLETE`

Sent when the tool invocation is finished. The `result` is passed back to the LLM to continue the conversation.

```json
{
  "type": "TASK_COMPLETE",
  "invocationId": "inv_abc123",
  "payload": {
    "result": {
      "playlistUrl": "https://open.spotify.com/playlist/abc",
      "trackCount": 2
    }
  }
}
```

#### `ERROR`

Sent when the plugin encounters a failure.

```json
{
  "type": "ERROR",
  "invocationId": "inv_abc123",
  "payload": {
    "code": "UPSTREAM_ERROR",
    "message": "Spotify API returned 503",
    "recoverable": false
  }
}
```

`code` must be one of the following:

| Code | Meaning |
|------|---------|
| `INVALID_PARAMS` | The parameters sent in `INVOKE_TOOL` are invalid or incomplete |
| `RENDER_FAILED` | The plugin UI failed to render |
| `UPSTREAM_ERROR` | A third-party API call made by the plugin failed |
| `INTERNAL_ERROR` | An unexpected error within the plugin |

`recoverable` indicates whether the platform should retry the invocation (`true`) or abort and report to the chatbot (`false`).

### Message Lifecycle

A typical session with multiple invocations (e.g., a chess game):

```
Parent                          Iframe
  |                               |
  |-------- (iframe loads) ------>|
  |                               |
  |<---------- READY ------------|
  |                               |
  |------- STATE_RESTORE -------->|  (if prior state exists)
  |                               |
  |--- INVOKE_TOOL (start_game) ->|
  |                               |
  |<------- STATE_UPDATE --------|  (0 or more times)
  |                               |
  |<------ TASK_COMPLETE --------|
  |                               |
  |  ... user keeps chatting ...  |
  |                               |
  |--- INVOKE_TOOL (get_hint) --->|  (LLM interprets "help me find the best move")
  |                               |
  |<------ TASK_COMPLETE --------|
  |                               |
  |--- INVOKE_TOOL (end_game) --->|  (LLM interprets "end this game")
  |                               |
  |<------- STATE_UPDATE --------|
  |<------ TASK_COMPLETE --------|
  |                               |
  |---------- DESTROY ----------->|
  |                               |
```

---

## 3. Error Handling & Timeouts

### Plugin-Reported Errors

Plugins report failures via the `ERROR` message type (see Section 2). When `recoverable` is `false`, the platform:
1. Kills the iframe.
2. Feeds a sanitized error to the LLM.
3. The LLM generates a conversational explanation to the student.

When `recoverable` is `true`, the platform may retry the `INVOKE_TOOL` once before treating it as a hard failure.

### Platform-Enforced Timeouts

| Event | Default Timeout | Behavior on Timeout |
|-------|----------------|---------------------|
| `READY` not received after iframe load | 5 seconds | Platform kills the iframe, reports failure to chatbot |
| `TASK_COMPLETE` not received after `INVOKE_TOOL` | 10 seconds | Platform kills the iframe, reports failure to chatbot |

Plugins may request longer timeouts via a `timeouts` field in the manifest `permissions` object. The platform enforces a hard ceiling (e.g., 30 seconds) that cannot be exceeded.

```json
{
  "permissions": {
    "timeouts": {
      "ready": 5,
      "taskComplete": 15
    }
  }
}
```

### Circuit Breaker

3 consecutive failures (timeout or `ERROR` with `recoverable: false`) for the same plugin triggers the circuit breaker:

1. The plugin is flagged as `unreliable` in the database.
2. Unreliable plugins are excluded from LLM tool discovery — the LLM will not attempt to invoke them.
3. The chatbot receives a system message explaining the app is temporarily unavailable.
4. Developers can reset the flag via `PUT /api/plugins/{appSlug}/reset` using their API key.

---

## 4. Security Constraints

These rules are enforced by the platform and are non-negotiable for all plugins.

### Iframe Sandbox

All plugins render under:

```
sandbox="allow-scripts allow-same-origin"
```

No popups, no form submissions, no top-level navigation. This policy is platform-enforced and not configurable per plugin.

### Origin Enforcement

- The platform validates `postMessage` event origins against the `allowedOrigins` declared in the manifest.
- Messages from unregistered origins are silently dropped.
- CSP headers restrict iframe `src` to the registered `iframeUrl` domain.

### Credential Rules

- Plugins **never** receive raw OAuth access tokens. The `credentials.sessionToken` in `INVOKE_TOOL` is a short-lived, scoped token generated by the platform.
- Plugins **never** initiate authentication flows. If a user has not connected their account, the platform handles the OAuth flow in the top-level window via NextAuth before the iframe is loaded. The iframe is only rendered after auth is resolved.
- `internal` and `external_public` plugins receive no `credentials` field.

### LLM Credential Isolation

The LLM context window never contains OAuth tokens, API keys, or session credentials. The LLM receives only tool call parameters (from the user) and sanitized results (from the backend proxy). All credential injection happens server-side, outside the LLM's request/response cycle. Specifically:

1. The LLM outputs a plain JSON tool call intent — parameters only, no credentials.
2. The backend proxy intercepts the intent and fetches the user's tokens from PostgreSQL (NextAuth `Account` table).
3. The backend executes the third-party API call server-side, injecting credentials into HTTP headers.
4. The backend returns only the sanitized result to the LLM to continue the conversation.

This prevents prompt injection attacks from extracting credentials — even if a malicious input tricks the LLM into outputting its full context, there are no secrets to leak.

### Data Access Boundary

- Plugins cannot access the parent DOM, chat history, student profile data, or other plugin state.
- `postMessage` is the only communication channel between the plugin and the platform.
- Direct HTTP calls from the iframe to platform backend endpoints are rejected.

### Rate Limiting

- Enforced per-plugin, per-user session.
- Default: 60 `STATE_UPDATE` messages per minute.
- Developers do not configure this — it is a platform guardrail.
- Exceeding the limit causes the platform to silently drop excess messages and log a warning.

---

## 5. Authenticated Tool Invocation Flow

For `external_authenticated` plugins, the full lifecycle from user request to task completion:

```
1. User:      "Create a Spotify playlist called Study Beats"
2. LLM:       Emits tool call → { tool: "create_playlist", params: {...} }
3. Backend:   Intercepts tool call, checks PostgreSQL for linked Spotify token
4a. No token: Backend returns AUTH_REQUIRED to Chat UI
              → Chat UI renders native "Connect Spotify" button (NOT in iframe)
              → User clicks → top-level NextAuth redirect → user consents
              → Token stored in PostgreSQL → retry from step 3
4b. Token:    Backend proxy executes Spotify API call server-side
              → Returns result to LLM
5. Chat UI:   Renders the plugin iframe
6. Parent:    Waits for READY, then sends STATE_RESTORE (if prior state),
              then sends INVOKE_TOOL with parameters + scoped sessionToken
7. Iframe:    Renders UI, sends STATE_UPDATE as needed
8. Iframe:    Sends TASK_COMPLETE with result
9. LLM:       Receives result, continues conversation with the student
10. Parent:   Sends DESTROY when the interaction is complete
```

The LLM never sees raw OAuth tokens or API keys at any point in this flow.
