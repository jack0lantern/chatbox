import { test, expect } from '@playwright/test'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient({
  datasources: { db: { url: 'postgresql://postgres:postgres@127.0.0.1:54322/chatbridge' } },
})

const BASE_URL = 'http://localhost:3000'

// Unique emails to avoid collision with other test files
const EMAIL_PW_HASH = 'test-gap-pwhash@test.com'
const EMAIL_PW_WRONG = 'test-gap-pwwrong@test.com'
const EMAIL_STATE = 'test-gap-state@test.com'
const TEST_PASSWORD = 'correct-horse-battery'
const WRONG_PASSWORD = 'wrong-password-123'

async function deleteUserByEmail(email: string) {
  try {
    await prisma.user.deleteMany({ where: { email } })
  } catch {}
}

async function loginAndGetCookies(page: import('@playwright/test').Page, email: string, password: string) {
  await page.goto(`${BASE_URL}/login`)
  await page.waitForLoadState('networkidle')
  await page.fill('#email', email)
  await page.fill('#password', password)
  await page.click('button[type="submit"]')
}

test.afterAll(async () => {
  await deleteUserByEmail(EMAIL_PW_HASH)
  await deleteUserByEmail(EMAIL_PW_WRONG)
  await deleteUserByEmail(EMAIL_STATE)
  await prisma.$disconnect()
})

// ---------------------------------------------------------------------------
// Gap 1: Stockfish WASM — AI actually makes a move
// ---------------------------------------------------------------------------
test.describe('Gap 1 & 2: Chess Stockfish + react-chessboard', () => {
  test('chess plugin loads ES modules and sends READY', async ({ page }) => {
    const messages: any[] = []

    await page.addInitScript(() => {
      ;(window as any).__pluginMessages = []
      const origPostMessage = window.postMessage.bind(window)
      window.parent.postMessage = (data: any, origin: any) => {
        ;(window as any).__pluginMessages.push(data)
        origPostMessage(data, origin)
      }
    })

    await page.goto(`${BASE_URL}/plugins/chess/index.html`)
    // ES modules from esm.sh need extra time
    await page.waitForTimeout(5000)

    const sentReady = await page.evaluate(() => {
      return (window as any).__pluginMessages?.some((m: any) => m.type === 'READY')
    })
    expect(sentReady).toBe(true)
  })

  test('react-chessboard renders data-square elements after start_game', async ({ page }) => {
    await page.goto(`${BASE_URL}/plugins/chess/index.html`)
    await page.waitForTimeout(5000)

    await page.evaluate(() => {
      window.postMessage({
        type: 'INVOKE_TOOL',
        invocationId: 'gap-test-1',
        payload: {
          toolName: 'start_game',
          parameters: { difficulty: 'easy', color: 'white' },
        },
      }, '*')
    })

    // react-chessboard renders squares with data-square attributes
    await page.waitForSelector('[data-square="e2"]', { timeout: 5000 })
    const squareCount = await page.locator('[data-square]').count()
    expect(squareCount).toBe(64)
  })

  test('Stockfish AI responds when player is black (AI moves first)', async ({ page }) => {
    await page.addInitScript(() => {
      ;(window as any).__pluginMessages = []
      const origPostMessage = window.postMessage.bind(window)
      window.parent.postMessage = (data: any, origin: any) => {
        ;(window as any).__pluginMessages.push(data)
        origPostMessage(data, origin)
      }
    })

    await page.goto(`${BASE_URL}/plugins/chess/index.html`)
    await page.waitForTimeout(5000)

    // Start game as black — AI (Stockfish or fallback) must move first
    await page.evaluate(() => {
      window.postMessage({
        type: 'INVOKE_TOOL',
        invocationId: 'gap-sf-1',
        payload: {
          toolName: 'start_game',
          parameters: { difficulty: 'medium', color: 'black' },
        },
      }, '*')
    })

    // Wait for TASK_COMPLETE which includes the game start result
    await page.waitForTimeout(3000)

    const taskComplete = await page.evaluate(() => {
      return (window as any).__pluginMessages?.find(
        (m: any) => m.type === 'TASK_COMPLETE' && m.invocationId === 'gap-sf-1'
      )
    })
    expect(taskComplete).toBeTruthy()
    expect(taskComplete.payload.result.started).toBe(true)
    expect(taskComplete.payload.result.playerColor).toBe('black')

    // After start_game with black, there should be a STATE_UPDATE showing the AI's first move
    const stateUpdate = await page.evaluate(() => {
      return (window as any).__pluginMessages?.find(
        (m: any) => m.type === 'STATE_UPDATE'
      )
    })
    expect(stateUpdate).toBeTruthy()
    // FEN should differ from starting position since AI moved
    const fen = stateUpdate.payload.state.fen
    expect(fen).toBeTruthy()
    expect(fen).not.toBe('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')
  })

  test('get_hint returns a valid move', async ({ page }) => {
    await page.addInitScript(() => {
      ;(window as any).__pluginMessages = []
      const origPostMessage = window.postMessage.bind(window)
      window.parent.postMessage = (data: any, origin: any) => {
        ;(window as any).__pluginMessages.push(data)
        origPostMessage(data, origin)
      }
    })

    await page.goto(`${BASE_URL}/plugins/chess/index.html`)
    await page.waitForTimeout(5000)

    // Start game first
    await page.evaluate(() => {
      window.postMessage({
        type: 'INVOKE_TOOL',
        invocationId: 'gap-hint-start',
        payload: {
          toolName: 'start_game',
          parameters: { difficulty: 'easy', color: 'white' },
        },
      }, '*')
    })
    await page.waitForTimeout(2000)

    // Request hint
    await page.evaluate(() => {
      window.postMessage({
        type: 'INVOKE_TOOL',
        invocationId: 'gap-hint-1',
        payload: {
          toolName: 'get_hint',
          parameters: {},
        },
      }, '*')
    })
    await page.waitForTimeout(3000)

    const hintResult = await page.evaluate(() => {
      return (window as any).__pluginMessages?.find(
        (m: any) => m.type === 'TASK_COMPLETE' && m.invocationId === 'gap-hint-1'
      )
    })
    expect(hintResult).toBeTruthy()
    // Hint should contain from/to squares
    expect(hintResult.payload.result.hint).toBeTruthy()
    expect(hintResult.payload.result.from).toMatch(/^[a-h][1-8]$/)
    expect(hintResult.payload.result.to).toMatch(/^[a-h][1-8]$/)
  })

  test('get_game_state returns board snapshot after start_game', async ({ page }) => {
    await page.addInitScript(() => {
      ;(window as any).__pluginMessages = []
      const origPostMessage = window.postMessage.bind(window)
      window.parent.postMessage = (data: any, origin: any) => {
        ;(window as any).__pluginMessages.push(data)
        origPostMessage(data, origin)
      }
    })

    await page.goto(`${BASE_URL}/plugins/chess/index.html`)
    await page.waitForTimeout(5000)

    // Start game first
    await page.evaluate(() => {
      window.postMessage({
        type: 'INVOKE_TOOL',
        invocationId: 'gap-state-start',
        payload: {
          toolName: 'start_game',
          parameters: { difficulty: 'easy', color: 'white' },
        },
      }, '*')
    })
    await page.waitForTimeout(2000)

    // Request game state
    await page.evaluate(() => {
      window.postMessage({
        type: 'INVOKE_TOOL',
        invocationId: 'gap-state-1',
        payload: {
          toolName: 'get_game_state',
          parameters: {},
        },
      }, '*')
    })
    await page.waitForTimeout(2000)

    const stateResult = await page.evaluate(() => {
      return (window as any).__pluginMessages?.find(
        (m: any) => m.type === 'TASK_COMPLETE' && m.invocationId === 'gap-state-1'
      )
    })
    expect(stateResult).toBeTruthy()
    const result = stateResult.payload.result
    expect(result.gameStarted).toBe(true)
    expect(typeof result.fen).toBe('string')
    expect(Array.isArray(result.moveHistory)).toBe(true)
    expect(result.turn).toBe('w')
    expect(result.playerColor).toBe('white')
    expect(result.difficulty).toBe('easy')
    expect(typeof result.inCheck).toBe('boolean')
    expect(typeof result.isCheckmate).toBe('boolean')
    expect(typeof result.isStalemate).toBe('boolean')
    expect(typeof result.isDraw).toBe('boolean')
  })

  test('get_game_state with no active game returns gameStarted: false', async ({ page }) => {
    await page.addInitScript(() => {
      ;(window as any).__pluginMessages = []
      const origPostMessage = window.postMessage.bind(window)
      window.parent.postMessage = (data: any, origin: any) => {
        ;(window as any).__pluginMessages.push(data)
        origPostMessage(data, origin)
      }
    })

    await page.goto(`${BASE_URL}/plugins/chess/index.html`)
    await page.waitForTimeout(5000)

    // Call get_game_state without starting a game
    await page.evaluate(() => {
      window.postMessage({
        type: 'INVOKE_TOOL',
        invocationId: 'gap-state-nogame',
        payload: {
          toolName: 'get_game_state',
          parameters: {},
        },
      }, '*')
    })
    await page.waitForTimeout(2000)

    const stateResult = await page.evaluate(() => {
      return (window as any).__pluginMessages?.find(
        (m: any) => m.type === 'TASK_COMPLETE' && m.invocationId === 'gap-state-nogame'
      )
    })
    expect(stateResult).toBeTruthy()
    const result = stateResult.payload.result
    expect(result.gameStarted).toBe(false)
    expect(result.fen).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Gap 3: Plugin state persistence
// ---------------------------------------------------------------------------
test.describe('Gap 3: State persistence wired in PluginContainer', () => {
  test('PUT and GET plugin state round-trip', async ({ page }) => {
    await deleteUserByEmail(EMAIL_STATE)
    await loginAndGetCookies(page, EMAIL_STATE, TEST_PASSWORD)
    await page.waitForURL(`${BASE_URL}/`, { timeout: 15000 })

    const statePayload = {
      fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1',
      moveHistory: ['e4'],
      difficulty: 'hard',
      playerColor: 'white',
    }

    // PUT state
    const putRes = await page.request.put(`${BASE_URL}/api/plugins/chess/state`, {
      data: { invocationId: 'gap-e2e-state-1', state: statePayload },
    })
    expect(putRes.status()).toBe(200)

    // GET state
    const getRes = await page.request.get(`${BASE_URL}/api/plugins/chess/state`)
    expect(getRes.status()).toBe(200)
    const body = await getRes.json()
    expect(body.state).toEqual(statePayload)
  })
})

// ---------------------------------------------------------------------------
// Gap 4 & 5: Spotify uses direct fetch, no API_REQUEST postMessage
// ---------------------------------------------------------------------------
test.describe('Gap 4 & 5: Spotify direct fetch protocol', () => {
  test('Spotify plugin does not send API_REQUEST messages', async ({ page }) => {
    await page.addInitScript(() => {
      ;(window as any).__pluginMessages = []
      const origPostMessage = window.postMessage.bind(window)
      window.parent.postMessage = (data: any, origin: any) => {
        ;(window as any).__pluginMessages.push(data)
        origPostMessage(data, origin)
      }
    })

    await page.goto(`${BASE_URL}/plugins/spotify/index.html`)
    await page.waitForLoadState('networkidle')

    // Trigger a search via INVOKE_TOOL (this would previously have used API_REQUEST internally)
    await page.evaluate(() => {
      window.postMessage({
        type: 'INVOKE_TOOL',
        invocationId: 'gap-spot-1',
        payload: {
          toolName: 'search_songs',
          parameters: { query: 'test' },
        },
      }, '*')
    })

    // Wait for the fetch to attempt (will fail without Spotify auth, but that's OK)
    await page.waitForTimeout(3000)

    // Verify NO API_REQUEST messages were sent via postMessage
    const apiRequests = await page.evaluate(() => {
      return (window as any).__pluginMessages?.filter(
        (m: any) => m.type === 'API_REQUEST'
      )
    })
    expect(apiRequests.length).toBe(0)

    // Verify a TASK_COMPLETE or ERROR was sent (the fetch call happened, even if auth failed)
    const responses = await page.evaluate(() => {
      return (window as any).__pluginMessages?.filter(
        (m: any) => m.type === 'TASK_COMPLETE' || m.type === 'ERROR'
      )
    })
    expect(responses.length).toBeGreaterThan(0)
  })

  test('Spotify plugin renders UI and accepts STATE_RESTORE', async ({ page }) => {
    await page.goto(`${BASE_URL}/plugins/spotify/index.html`)
    await expect(page.locator('.header h1')).toHaveText('Playlist Builder')
    await expect(page.locator('.search-input')).toBeVisible()

    await page.evaluate(() => {
      window.postMessage({
        type: 'STATE_RESTORE',
        invocationId: null,
        payload: {
          state: {
            playlistName: 'Gap Test Playlist',
            tracks: [{
              uri: 'spotify:track:test123',
              name: 'Test Song',
              artist: 'Test Artist',
              albumArt: null,
              duration: 200000,
            }],
            createdPlaylists: [],
          },
        },
      }, '*')
    })

    await expect(page.locator('.playlist-name-input')).toHaveValue('Gap Test Playlist')
    await expect(page.locator('.track-name').first()).toHaveText('Test Song')
  })
})

// ---------------------------------------------------------------------------
// Gap 6: Password hashing — bcrypt verify/reject
// ---------------------------------------------------------------------------
test.describe('Gap 6: Password hashing', () => {
  test('first login creates user with hashed password, second login verifies', async ({ page }) => {
    await deleteUserByEmail(EMAIL_PW_HASH)

    // First login — auto-creates user with hashed password
    await loginAndGetCookies(page, EMAIL_PW_HASH, TEST_PASSWORD)
    await page.waitForURL(`${BASE_URL}/`, { timeout: 15000 })

    const bodyText = await page.textContent('body')
    expect(bodyText).toContain(EMAIL_PW_HASH)

    // Verify passwordHash was stored
    const user = await prisma.user.findUnique({ where: { email: EMAIL_PW_HASH } })
    expect(user).toBeTruthy()
    expect(user!.passwordHash).toBeTruthy()
    expect(user!.passwordHash).toMatch(/^\$2[aby]?\$/) // bcrypt hash prefix
  })

  test('login with wrong password is rejected', async ({ browser }) => {
    // Ensure user exists from previous test (or create fresh)
    await deleteUserByEmail(EMAIL_PW_WRONG)
    const context1 = await browser.newContext()
    const page1 = await context1.newPage()
    await loginAndGetCookies(page1, EMAIL_PW_WRONG, TEST_PASSWORD)
    await page1.waitForURL(`${BASE_URL}/`, { timeout: 15000 })
    await context1.close()

    // Now try wrong password in a fresh context
    const context2 = await browser.newContext()
    const page2 = await context2.newPage()
    await loginAndGetCookies(page2, EMAIL_PW_WRONG, WRONG_PASSWORD)

    // Should NOT redirect to home — stays on login or shows error
    await page2.waitForTimeout(3000)
    const url = page2.url()
    expect(url).toContain('/login')

    await context2.close()
  })
})

// ---------------------------------------------------------------------------
// Gap 7: Plugin listing returns public array (no auth required)
// ---------------------------------------------------------------------------
test.describe('Gap 7: Plugin listing public access', () => {
  test('GET /api/plugins returns plain array without auth', async ({ page }) => {
    const context = await page.context().browser()!.newContext()
    const res = await context.request.get(`${BASE_URL}/api/plugins`)
    expect(res.status()).toBe(200)

    const data = await res.json()
    // Must be a plain array, NOT wrapped in { plugins: [...] }
    expect(Array.isArray(data)).toBe(true)
    expect(data.length).toBeGreaterThanOrEqual(3)

    // Each plugin should have the expected fields
    const chess = data.find((p: any) => p.appSlug === 'chess')
    expect(chess).toBeTruthy()
    expect(chess.appName).toBe('Chess')
    expect(chess.toolSchemas).toBeDefined()
    expect(Array.isArray(chess.toolSchemas)).toBe(true)
    expect(chess.permissions).toBeDefined()

    await context.close()
  })
})
