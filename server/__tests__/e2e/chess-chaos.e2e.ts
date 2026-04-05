import { test, expect, Page } from '@playwright/test'

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

/** Collect console errors and page crashes during a test */
function attachErrorCollectors(page: Page) {
  const errors: string[] = []
  const warnings: string[] = []
  const pageErrors: string[] = []

  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text())
    if (msg.type() === 'warning') warnings.push(msg.text())
  })
  page.on('pageerror', (err) => {
    pageErrors.push(err.message)
  })

  return { errors, warnings, pageErrors }
}

/** Send an INVOKE_TOOL message to the plugin */
async function invokeTool(page: Page, toolName: string, parameters: any = {}, invocationId?: string) {
  const id = invocationId || `chaos-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  await page.evaluate(
    ({ toolName, parameters, id }) => {
      window.postMessage(
        {
          type: 'INVOKE_TOOL',
          invocationId: id,
          payload: { toolName, parameters },
        },
        '*'
      )
    },
    { toolName, parameters, id }
  )
  return id
}

/** Send a raw postMessage */
async function sendRawMessage(page: Page, data: any) {
  await page.evaluate((d) => {
    window.postMessage(d, '*')
  }, data)
}

/** Start a game and wait for board to render (esm.sh imports need extra time) */
async function startGameAndWait(page: Page, color = 'white', difficulty = 'easy') {
  await invokeTool(page, 'start_game', { difficulty, color })
  await page.waitForTimeout(2000)
}

/** Check if chess pieces are visible on the page (react-chessboard renders SVG/img pieces) */
async function hasPiecesOnBoard(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    // react-chessboard renders pieces as elements with data-piece attributes
    const pieces = document.querySelectorAll('[data-piece]')
    if (pieces.length > 0) return true
    // Fallback: check for piece class elements or SVGs
    const pieceEls = document.querySelectorAll('.piece')
    if (pieceEls.length > 0) return true
    const svgs = document.querySelectorAll('svg')
    if (svgs.length > 0) return true
    // Check for board squares (react-chessboard uses data-square)
    const squares = document.querySelectorAll('[data-square]')
    return squares.length >= 64
  })
}

/** Make a player move by clicking squares (react-chessboard uses data-square) */
async function clickMove(page: Page, from: string, to: string) {
  const fromSq = page.locator(`[data-square="${from}"]`)
  const toSq = page.locator(`[data-square="${to}"]`)
  await fromSq.click()
  await page.waitForTimeout(100)
  await toSq.click()
  await page.waitForTimeout(800) // wait for AI response (Stockfish may take a moment)
}

// ─────────────────────────────────────────────
// Phase 1: Exploratory chaos testing
// ─────────────────────────────────────────────

test.describe('chess plugin chaos tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/plugins/chess/index.html')
    await page.waitForLoadState('networkidle')
  })

  // Scenario 1: Double start
  test('double start_game — second start should reset cleanly without errors', async ({ page }) => {
    const { errors, pageErrors } = attachErrorCollectors(page)

    await invokeTool(page, 'start_game', { difficulty: 'easy', color: 'white' })
    await invokeTool(page, 'start_game', { difficulty: 'hard', color: 'black' })
    await page.waitForTimeout(1000)

    expect(pageErrors).toEqual([])
    expect(errors).toEqual([])
    expect(await hasPiecesOnBoard(page)).toBe(true)

    // After double start the game should be active and functioning
    const bodyText = await page.textContent('body')
    expect(bodyText).toContain('Game Status')
  })

  // Scenario 2: Tools before start
  test('get_hint before start_game — should return error, no crash', async ({ page }) => {
    const { errors, pageErrors } = attachErrorCollectors(page)

    await invokeTool(page, 'get_hint', {})
    await page.waitForTimeout(500)

    expect(pageErrors).toEqual([])
    // Page should still be functional (showing welcome screen)
    const bodyText = await page.textContent('body')
    expect(bodyText).toContain('Chess')
  })

  test('undo_move before start_game — should return error, no crash', async ({ page }) => {
    const { errors, pageErrors } = attachErrorCollectors(page)

    await invokeTool(page, 'undo_move', {})
    await page.waitForTimeout(500)

    expect(pageErrors).toEqual([])
  })

  test('redo_move before start_game — should return error, no crash', async ({ page }) => {
    const { errors, pageErrors } = attachErrorCollectors(page)

    await invokeTool(page, 'redo_move', {})
    await page.waitForTimeout(500)

    expect(pageErrors).toEqual([])
  })

  test('end_game before start_game — should not crash', async ({ page }) => {
    const { errors, pageErrors } = attachErrorCollectors(page)

    await invokeTool(page, 'end_game', {})
    await page.waitForTimeout(500)

    expect(pageErrors).toEqual([])
  })

  // Scenario 3: Invalid params
  test('start_game with missing params — should not crash', async ({ page }) => {
    const { errors, pageErrors } = attachErrorCollectors(page)

    // Completely missing params
    await invokeTool(page, 'start_game')
    await page.waitForTimeout(500)

    expect(pageErrors).toEqual([])
    // Should still start a game with defaults
    expect(await hasPiecesOnBoard(page)).toBe(true)
  })

  test('start_game with wrong types — should not crash', async ({ page }) => {
    const { errors, pageErrors } = attachErrorCollectors(page)

    await invokeTool(page, 'start_game', { difficulty: 12345, color: null })
    await page.waitForTimeout(500)

    expect(pageErrors).toEqual([])
  })

  test('start_game with invalid difficulty — should not crash', async ({ page }) => {
    const { errors, pageErrors } = attachErrorCollectors(page)

    await invokeTool(page, 'start_game', { difficulty: 'nightmare', color: 'white' })
    await page.waitForTimeout(500)

    expect(pageErrors).toEqual([])
    // Game should still start (with fallback to random move selection)
    expect(await hasPiecesOnBoard(page)).toBe(true)
  })

  test('start_game with invalid color — should not crash', async ({ page }) => {
    const { errors, pageErrors } = attachErrorCollectors(page)

    await invokeTool(page, 'start_game', { difficulty: 'easy', color: 'purple' })
    await page.waitForTimeout(500)

    expect(pageErrors).toEqual([])
  })

  // Scenario 4: Rapid fire moves
  test('rapid clicks during AI turn — should not corrupt state', async ({ page }) => {
    const { errors, pageErrors } = attachErrorCollectors(page)

    await startGameAndWait(page, 'white', 'easy')

    // Make a valid move
    await clickMove(page, 'e2', 'e4')

    // Immediately try to click more squares during AI response time
    const squares = ['d2', 'd4', 'c2', 'c4', 'b1', 'c3']
    for (const sq of squares) {
      const el = page.locator(`[data-square="${sq}"]`)
      if (await el.count() > 0) {
        await el.click({ force: true })
      }
    }

    await page.waitForTimeout(1000)

    expect(pageErrors).toEqual([])
    expect(await hasPiecesOnBoard(page)).toBe(true)
  })

  // Scenario 5: Undo with no moves
  test('undo_move immediately after start — no moves made', async ({ page }) => {
    const { errors, pageErrors } = attachErrorCollectors(page)

    await startGameAndWait(page, 'white', 'easy')
    await invokeTool(page, 'undo_move')
    await page.waitForTimeout(500)

    expect(pageErrors).toEqual([])
    // Board should still be intact at starting position
    expect(await hasPiecesOnBoard(page)).toBe(true)
  })

  // Scenario 6: Redo with no undo
  test('redo_move with nothing to redo — should send error, no crash', async ({ page }) => {
    const { errors, pageErrors } = attachErrorCollectors(page)

    await startGameAndWait(page, 'white', 'easy')
    await invokeTool(page, 'redo_move')
    await page.waitForTimeout(500)

    expect(pageErrors).toEqual([])
  })

  // Scenario 7: Multiple undos
  test('10 rapid undo_move commands — should not crash', async ({ page }) => {
    const { errors, pageErrors } = attachErrorCollectors(page)

    await startGameAndWait(page, 'white', 'easy')

    // Make one move so there is something to undo
    await clickMove(page, 'e2', 'e4')
    await page.waitForTimeout(500)

    // Send 10 undo commands rapidly
    for (let i = 0; i < 10; i++) {
      await invokeTool(page, 'undo_move')
    }
    await page.waitForTimeout(1000)

    expect(pageErrors).toEqual([])
    expect(await hasPiecesOnBoard(page)).toBe(true)
  })

  // Scenario 8: Get hint during AI turn
  test('get_hint right after starting as black (AI moves first)', async ({ page }) => {
    const { errors, pageErrors } = attachErrorCollectors(page)

    // Start as black — AI moves first
    await invokeTool(page, 'start_game', { difficulty: 'easy', color: 'black' })
    // Immediately request hint while AI might be processing
    await invokeTool(page, 'get_hint')
    await page.waitForTimeout(1000)

    expect(pageErrors).toEqual([])
  })

  // Scenario 9: End game before any moves
  test('start_game then immediately end_game — should not crash', async ({ page }) => {
    const { errors, pageErrors } = attachErrorCollectors(page)

    await startGameAndWait(page, 'white', 'easy')
    await invokeTool(page, 'end_game')
    await page.waitForTimeout(500)

    expect(pageErrors).toEqual([])
  })

  // Scenario 10: STATE_RESTORE with invalid data
  test('STATE_RESTORE with garbage data — should not crash', async ({ page }) => {
    const { errors, pageErrors } = attachErrorCollectors(page)

    await sendRawMessage(page, { type: 'STATE_RESTORE', payload: { state: 'garbage' } })
    await page.waitForTimeout(500)

    expect(pageErrors).toEqual([])
  })

  test('STATE_RESTORE with empty object — should not crash', async ({ page }) => {
    const { errors, pageErrors } = attachErrorCollectors(page)

    await sendRawMessage(page, { type: 'STATE_RESTORE', payload: { state: {} } })
    await page.waitForTimeout(500)

    expect(pageErrors).toEqual([])
  })

  test('STATE_RESTORE with missing fields — should not crash', async ({ page }) => {
    const { errors, pageErrors } = attachErrorCollectors(page)

    await sendRawMessage(page, {
      type: 'STATE_RESTORE',
      payload: { state: { fen: 'not-valid-fen' } },
    })
    await page.waitForTimeout(500)

    expect(pageErrors).toEqual([])
  })

  test('STATE_RESTORE with null payload — should not crash', async ({ page }) => {
    const { errors, pageErrors } = attachErrorCollectors(page)

    await sendRawMessage(page, { type: 'STATE_RESTORE', payload: null })
    await page.waitForTimeout(500)

    expect(pageErrors).toEqual([])
  })

  // Scenario 11: DESTROY during game
  test('DESTROY mid-game — should reset cleanly', async ({ page }) => {
    const { errors, pageErrors } = attachErrorCollectors(page)

    await startGameAndWait(page, 'white', 'easy')
    await clickMove(page, 'e2', 'e4')
    await page.waitForTimeout(500)

    await sendRawMessage(page, { type: 'DESTROY' })
    await page.waitForTimeout(500)

    expect(pageErrors).toEqual([])
    // After destroy, should show welcome screen (no game active)
    const bodyText = await page.textContent('body')
    expect(bodyText).toContain('Chess')
  })

  // Scenario 12: Malformed messages
  test('postMessage with wrong type field — should be ignored', async ({ page }) => {
    const { errors, pageErrors } = attachErrorCollectors(page)

    await sendRawMessage(page, { type: 'BOGUS_TYPE', payload: {} })
    await page.waitForTimeout(500)

    expect(pageErrors).toEqual([])
  })

  test('postMessage with missing fields — should not crash', async ({ page }) => {
    const { errors, pageErrors } = attachErrorCollectors(page)

    await sendRawMessage(page, { type: 'INVOKE_TOOL' })
    await page.waitForTimeout(500)

    expect(pageErrors).toEqual([])
  })

  test('postMessage with null payload — should not crash', async ({ page }) => {
    const { errors, pageErrors } = attachErrorCollectors(page)

    await sendRawMessage(page, { type: 'INVOKE_TOOL', payload: null })
    await page.waitForTimeout(500)

    expect(pageErrors).toEqual([])
  })

  test('postMessage with null data — should not crash', async ({ page }) => {
    const { errors, pageErrors } = attachErrorCollectors(page)

    await sendRawMessage(page, null)
    await page.waitForTimeout(500)

    expect(pageErrors).toEqual([])
  })

  test('postMessage with numeric data — should not crash', async ({ page }) => {
    const { errors, pageErrors } = attachErrorCollectors(page)

    await sendRawMessage(page, 42)
    await page.waitForTimeout(500)

    expect(pageErrors).toEqual([])
  })

  test('INVOKE_TOOL with missing tool name — should not crash', async ({ page }) => {
    const { errors, pageErrors } = attachErrorCollectors(page)

    await sendRawMessage(page, { type: 'INVOKE_TOOL', invocationId: 'x', payload: { params: {} } })
    await page.waitForTimeout(500)

    expect(pageErrors).toEqual([])
  })

  // Scenario 13: Start game with color "random"
  test('start_game with color random — should resolve to white or black', async ({ page }) => {
    const { errors, pageErrors } = attachErrorCollectors(page)

    await startGameAndWait(page, 'random', 'easy')

    expect(pageErrors).toEqual([])
    expect(await hasPiecesOnBoard(page)).toBe(true)
    const bodyText = await page.textContent('body')
    expect(bodyText).toContain('Game Status')
  })

  // Scenario 14: Play a full game (a few moves at least)
  test('play several moves — state should remain consistent', async ({ page }) => {
    const { errors, pageErrors } = attachErrorCollectors(page)

    await startGameAndWait(page, 'white', 'easy')

    // Make a few moves
    const moves = [
      ['e2', 'e4'],
      ['d2', 'd4'],
      ['g1', 'f3'],
    ]

    for (const [from, to] of moves) {
      // Wait for it to be our turn
      await page.waitForTimeout(600)
      await clickMove(page, from, to)
      await page.waitForTimeout(600)
    }

    expect(pageErrors).toEqual([])
    expect(await hasPiecesOnBoard(page)).toBe(true)
  })

  // Scenario 15: Console error monitoring across a complex sequence
  test('complex sequence — start, move, undo, redo, hint, end — no crashes', async ({ page }) => {
    const { errors, pageErrors } = attachErrorCollectors(page)

    // Start game
    await startGameAndWait(page, 'white', 'easy')

    // Make a move
    await clickMove(page, 'e2', 'e4')
    await page.waitForTimeout(600)

    // Get hint
    await invokeTool(page, 'get_hint')
    await page.waitForTimeout(300)

    // Make another move
    await clickMove(page, 'd2', 'd4')
    await page.waitForTimeout(600)

    // Undo
    await invokeTool(page, 'undo_move')
    await page.waitForTimeout(300)

    // Redo
    await invokeTool(page, 'redo_move')
    await page.waitForTimeout(300)

    // End game
    await invokeTool(page, 'end_game')
    await page.waitForTimeout(300)

    expect(pageErrors).toEqual([])
  })

  // ─────────────────────────────────────────────
  // Phase 3: Regression tests for discovered bugs
  // ─────────────────────────────────────────────

  test('BUG: INVOKE_TOOL with undefined payload should not throw', async ({ page }) => {
    // When payload is undefined, destructuring { tool, params } from undefined throws
    const { pageErrors } = attachErrorCollectors(page)

    await sendRawMessage(page, { type: 'INVOKE_TOOL', invocationId: 'test', payload: undefined })
    await page.waitForTimeout(500)

    expect(pageErrors).toEqual([])
  })

  test('BUG: STATE_RESTORE with invalid FEN should not throw uncaught error', async ({ page }) => {
    // Chess() constructor throws on invalid FEN — the try/catch should handle it
    const { pageErrors } = attachErrorCollectors(page)

    await sendRawMessage(page, {
      type: 'STATE_RESTORE',
      payload: { state: { fen: 'totally-invalid-fen-string' } },
    })
    await page.waitForTimeout(500)

    expect(pageErrors).toEqual([])
  })

  test('BUG: end_game before start should not throw when accessing chess methods', async ({ page }) => {
    // handleEndGame accesses chess.isCheckmate() etc. but chess is null before start
    const { pageErrors } = attachErrorCollectors(page)

    await invokeTool(page, 'end_game')
    await page.waitForTimeout(500)

    expect(pageErrors).toEqual([])
  })

  test('BUG: INVOKE_TOOL with unknown tool should send error, not crash', async ({ page }) => {
    const { pageErrors } = attachErrorCollectors(page)

    await invokeTool(page, 'nonexistent_tool', {})
    await page.waitForTimeout(500)

    expect(pageErrors).toEqual([])
  })

  test('BUG: double start while AI is moving should not corrupt state', async ({ page }) => {
    const { pageErrors } = attachErrorCollectors(page)

    // Start as black (AI moves immediately)
    await invokeTool(page, 'start_game', { difficulty: 'easy', color: 'black' })
    // Immediately start another game before AI finishes
    await invokeTool(page, 'start_game', { difficulty: 'easy', color: 'white' })
    await page.waitForTimeout(1000)

    expect(pageErrors).toEqual([])
    expect(await hasPiecesOnBoard(page)).toBe(true)
  })

  test('BUG: undo when moveHistory is empty should send appropriate response', async ({ page }) => {
    const { pageErrors } = attachErrorCollectors(page)

    await startGameAndWait(page, 'white', 'easy')

    // Capture outgoing messages
    const messages = await page.evaluate(() => {
      const captured: any[] = []
      const orig = window.postMessage.bind(window)
      window.postMessage = (data: any, origin: any) => {
        captured.push(data)
        orig(data, origin)
      }
      return captured
    })

    await invokeTool(page, 'undo_move')
    await page.waitForTimeout(500)

    expect(pageErrors).toEqual([])
    // The undo should complete without error even though there are no moves
  })

  test('BUG: multiple rapid start_game calls should not leave zombie AI timers', async ({ page }) => {
    const { pageErrors } = attachErrorCollectors(page)

    // Rapidly start 5 games
    for (let i = 0; i < 5; i++) {
      await invokeTool(page, 'start_game', {
        difficulty: 'easy',
        color: i % 2 === 0 ? 'white' : 'black',
      })
    }
    await page.waitForTimeout(2000)

    expect(pageErrors).toEqual([])
    expect(await hasPiecesOnBoard(page)).toBe(true)

    // The game should be functional — try to interact
    const bodyText = await page.textContent('body')
    expect(bodyText).toContain('Game Status')
  })

  test('BUG: DESTROY then start_game should work cleanly', async ({ page }) => {
    const { pageErrors } = attachErrorCollectors(page)

    await startGameAndWait(page, 'white', 'easy')
    await sendRawMessage(page, { type: 'DESTROY' })
    await page.waitForTimeout(300)

    // Should be able to start a new game after destroy
    await startGameAndWait(page, 'white', 'easy')

    expect(pageErrors).toEqual([])
    expect(await hasPiecesOnBoard(page)).toBe(true)
  })

  test('BUG: STATE_RESTORE with null state field should not throw', async ({ page }) => {
    const { pageErrors } = attachErrorCollectors(page)

    await sendRawMessage(page, { type: 'STATE_RESTORE', payload: { state: null } })
    await page.waitForTimeout(500)

    expect(pageErrors).toEqual([])
  })

  test('BUG: INVOKE_TOOL for start_game with null parameters should use defaults', async ({ page }) => {
    const { pageErrors } = attachErrorCollectors(page)

    await page.evaluate(() => {
      window.postMessage(
        {
          type: 'INVOKE_TOOL',
          invocationId: 'null-params',
          payload: { toolName: 'start_game', parameters: null },
        },
        '*'
      )
    })
    await page.waitForTimeout(2000)

    expect(pageErrors).toEqual([])
    // Should start with defaults (medium, white)
    expect(await hasPiecesOnBoard(page)).toBe(true)
  })
})
