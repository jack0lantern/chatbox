# Timeline: `get_game_state` replaces `get_hint`

**Goal:** Remove the iframe’s built-in `get_hint` tool and expose **`get_game_state`** instead so the LLM can give **custom** placement and chronology hints in chat from a read-only snapshot (aligned with chess coaching via `get_game_state`).

**Spec touchpoints:** [`docs/superpowers/specs/2026-04-02-chatbridge-platform-design.md`](../specs/2026-04-02-chatbridge-platform-design.md) (Timeline tool table), [`docs/superpowers/specs/2026-04-02-plugin-api-contract-design.md`](../specs/2026-04-02-plugin-api-contract-design.md) (generic multi-tool iframe flow).

---

## Rationale

- Fixed string hints (“before/after midpoint”) are rigid; tutors benefit from **`get_game_state` → natural-language hint** in the model response.
- **Anti-spoil:** The tool result must **not** include the **year** of the **current** (unplaced) card. Placed timeline entries include years (visible on the board). Do **not** return full remaining deck (would leak future answers); **`deckRemainingCount`** only.

---

## Implementation checklist

- [x] **`server/lib/plugin-seed.ts`:** Replace timeline `get_hint` with `get_game_state`; tighten plugin `description` so the model prefers state + chat for hints.
- [x] **`server/public/plugins/timeline/index.html`:** Handle `INVOKE_TOOL` `get_game_state`; return `TASK_COMPLETE` with structured snapshot; remove `get_hint` handler and in-iframe hint UI.
- [x] **Tests:** `server/__tests__/e2e/timeline-chaos.e2e.ts` uses `get_game_state`; `server/__tests__/plugin-api.test.ts` asserts timeline has `get_game_state` and not `get_hint`. The plugin API suite’s `beforeEach` syncs all `bundledPlugins` rows into Prisma so tool schemas match the repo without a manual `prisma db seed` before every run, and list tests accept both a bare JSON array and a `{ plugins }` wrapper from `GET /api/plugins`.
- [x] **Docs:** Phase 2/3 plans and platform design timeline table updated.

---

## `get_game_state` result shape (illustrative)

**Idle / loading:** `{ quizActive: false, phase, message? }`

**Playing or game over:** `{ quizActive: true, phase, score, lives, round, deckComplete, deckRemainingCount, timeline: [...], currentCard: { id, event, category } | null, summary }`

---

## Verification

```bash
cd server && pnpm exec prisma db seed   # refresh DB toolSchemas from bundledPlugins
cd server && pnpm test
cd /path/to/chatbox && npx playwright test server/__tests__/e2e/timeline-chaos.e2e.ts
```

---

## Follow-ups (optional)

- E2E asserting `TASK_COMPLETE` after `start_quiz` + `get_game_state` includes `timeline` and `currentCard` without `year` on `currentCard`.
- Renderer `getToolName` / icons for `plugin__timeline__get_game_state` if labels need polish.
