# ChatBridge Phase 3: Chess + Timeline Plugins

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build two internal plugin iframe apps (chess and timeline) that communicate with the platform via the postMessage protocol defined in Phase 2.

**Architecture:** Each plugin is a self-contained static HTML+JS app served from `server/public/plugins/`. They receive `INVOKE_TOOL` messages from the parent window and respond with `STATE_UPDATE`, `TASK_COMPLETE`, and `ERROR`. Each plugin sends `READY` on load.

**Tech Stack:** Chess: chess.js, react-chessboard, Stockfish WASM. Timeline: React, drag-and-drop, static JSON event data.

**Spec:** `docs/superpowers/specs/2026-04-02-chatbridge-platform-design.md` (Section 4)

**Depends on:** Phase 2 (plugin types, PluginBridge, PluginFrame, plugin API) — all complete.

---

## File Structure

```
server/public/plugins/
├── chess/
│   ├── index.html              # Entry point
│   ├── chess-app.js            # Bundled React app (chess.js + react-chessboard)
│   └── stockfish.js            # Stockfish WASM worker
└── timeline/
    ├── index.html              # Entry point
    ├── timeline-app.js         # Bundled React app
    └── data/
        └── events.json         # Curated historical events
```

Note: For MVP, we'll use inline `<script>` tags with CDN imports for React, chess.js, and react-chessboard rather than a separate build pipeline. This keeps the plugins as simple static files.

---

### Task 1: Chess Plugin

**Files:**
- Create: `server/public/plugins/chess/index.html`

The chess plugin is a single HTML file with inline JavaScript that:

1. **Loads dependencies** from CDN: React 18, ReactDOM, chess.js, react-chessboard
2. **Sends `READY`** on load via `window.parent.postMessage`
3. **Listens for `INVOKE_TOOL`** messages and handles:
   - `start_game` — initializes chess.js `Chess()` instance, sets difficulty/color, renders board
   - `get_hint` — uses Stockfish to find best move, sends `TASK_COMPLETE` with the suggested move
   - `end_game` — sends `TASK_COMPLETE` with game result (winner, move count)
   - `undo_move` — calls `chess.undo()` twice (player move + AI move), sends `TASK_COMPLETE`
   - `redo_move` — replays from move history, sends `TASK_COMPLETE`
4. **AI opponent** — Stockfish WASM in a web worker. On the player's move, sends position to Stockfish, waits for best move, plays it. Difficulty controls search depth (easy=1, medium=5, hard=10).
5. **Sends `STATE_UPDATE`** after each move with: FEN, move history, difficulty, color, game status
6. **Renders** using react-chessboard with the current position

For MVP simplicity, skip Stockfish WASM and use a simple random-legal-move AI. Stockfish can be added as an enhancement later. This keeps the plugin buildable as a single HTML file.

The AI logic:
- easy: random legal move
- medium: captures if available, else random
- hard: captures prioritized, checks prioritized, else random

- [ ] **Step 1: Create the chess plugin HTML**

Create `server/public/plugins/chess/index.html` — a complete self-contained HTML file with:
- CDN script tags for React 18 UMD, ReactDOM, chess.js, react-chessboard
- Inline `<script>` with the full chess app logic
- postMessage protocol: listens for INVOKE_TOOL, sends READY/STATE_UPDATE/TASK_COMPLETE/ERROR
- Chessboard rendering with react-chessboard
- Simple AI opponent (random legal moves with capture/check priority for harder difficulties)
- Undo/redo support via move history stack
- Full tool handler for all 5 tools: start_game, get_hint, end_game, undo_move, redo_move

- [ ] **Step 2: Verify the plugin serves correctly**

```bash
curl -s http://localhost:3000/plugins/chess/index.html | head -5
```

Expected: HTML content served from Next.js static files.

- [ ] **Step 3: Commit**

```bash
git add server/public/plugins/chess/
git commit -m "feat: add chess plugin iframe app"
```

---

### Task 2: Timeline Plugin

**Files:**
- Create: `server/public/plugins/timeline/index.html`
- Create: `server/public/plugins/timeline/data/events.json`

The timeline plugin:

1. **Event data** — a JSON file with 50+ historical events, each with id, event name, year, category
2. **Game mechanics:**
   - On `start_quiz`: shuffle deck, optionally filter by category, draw first card
   - Player sees a growing timeline and must place the current card in the right position
   - Correct placement: card added to timeline, score +1, next card drawn automatically
   - Wrong placement: lose a life, card still needs to be placed
   - 3 lives total. At 0 lives: game over, send `TASK_COMPLETE` with final score
3. **UI:** Horizontal timeline with placed cards, current card highlighted, drop zones between existing cards
4. **postMessage protocol:** READY on load, handles INVOKE_TOOL for start_quiz/check_placement/get_hint/next_card, sends STATE_UPDATE after each action

For MVP: use click-to-place instead of drag-and-drop (simpler). Player clicks a gap in the timeline to place the current card.

- [ ] **Step 1: Create events.json**

Create `server/public/plugins/timeline/data/events.json` with 50+ curated events across categories: space, politics, science, culture, war, technology.

Each event: `{ "id": "string", "event": "Short description", "year": number, "category": "string" }`

- [ ] **Step 2: Create the timeline plugin HTML**

Create `server/public/plugins/timeline/index.html` — a complete self-contained HTML file with:
- CDN script tags for React 18 UMD, ReactDOM
- Inline `<script>` with the full timeline app logic
- postMessage protocol: READY, INVOKE_TOOL handler, STATE_UPDATE, TASK_COMPLETE, ERROR
- Game state: timeline (placed cards), deck (remaining), currentCard, score, lives (3)
- Click-to-place UI: timeline displayed horizontally, gaps between cards are clickable
- Tool handlers: start_quiz, check_placement, get_hint, next_card

- [ ] **Step 3: Verify the plugin serves correctly**

```bash
curl -s http://localhost:3000/plugins/timeline/index.html | head -5
curl -s http://localhost:3000/plugins/timeline/data/events.json | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'{len(d)} events')"
```

Expected: HTML served, 50+ events in JSON.

- [ ] **Step 4: Commit**

```bash
git add server/public/plugins/timeline/
git commit -m "feat: add timeline quiz plugin iframe app"
```

---

### Task 3: Plugin Smoke Test (Playwright)

**Files:**
- Create: `server/__tests__/e2e/chess-plugin.e2e.ts`
- Create: `server/__tests__/e2e/timeline-plugin.e2e.ts`

- [ ] **Step 1: Chess plugin E2E test**

Test that the chess plugin loads and responds to postMessage:
1. Navigate to `/plugins/chess/index.html` directly
2. Listen for `READY` message from the iframe (use page.evaluate to listen)
3. Send `INVOKE_TOOL` with `start_game` params
4. Verify the chessboard renders (check for board DOM elements)

- [ ] **Step 2: Timeline plugin E2E test**

Test that the timeline plugin loads:
1. Navigate to `/plugins/timeline/index.html` directly
2. Verify READY is sent
3. Send `INVOKE_TOOL` with `start_quiz` params
4. Verify game UI renders with a card and timeline

- [ ] **Step 3: Run all tests**

```bash
cd /Users/jackjiang/GitHub/chatbox/server && pnpm test
cd /Users/jackjiang/GitHub/chatbox && npx playwright test --config=playwright.config.ts
```

- [ ] **Step 4: Commit**

```bash
git add server/__tests__/e2e/
git commit -m "test: add chess and timeline plugin E2E smoke tests"
```
