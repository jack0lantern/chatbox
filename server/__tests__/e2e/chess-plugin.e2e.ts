import { test, expect } from '@playwright/test'

test.describe('chess plugin', () => {
  test('loads and sends READY message', async ({ page }) => {
    const messages: any[] = []

    // Capture postMessages sent by the plugin to its parent
    await page.addInitScript(() => {
      const origPostMessage = window.postMessage.bind(window)
      ;(window as any).__pluginMessages = []
      window.parent.postMessage = (data: any) => {
        ;(window as any).__pluginMessages.push(data)
        origPostMessage(data, '*')
      }
    })

    await page.goto('/plugins/chess/index.html')
    await page.waitForLoadState('networkidle')

    // Verify the page loaded (has chess-related content)
    const body = await page.textContent('body')
    expect(body).toBeTruthy()

    // Check that the page has children in its body
    const hasContent = await page.locator('body').evaluate(el => el.children.length > 0)
    expect(hasContent).toBe(true)

    // Verify the READY message was posted (chess plugin posts to window.parent)
    const sentReady = await page.evaluate(() => {
      return (window as any).__pluginMessages?.some((m: any) => m.type === 'READY')
    })
    expect(sentReady).toBe(true)
  })

  test('renders a chessboard after start_game message', async ({ page }) => {
    await page.goto('/plugins/chess/index.html')
    await page.waitForLoadState('networkidle')

    // Send start_game using the format chess plugin actually expects:
    // { type: 'INVOKE_TOOL', invocationId, payload: { tool, params } }
    await page.evaluate(() => {
      window.postMessage({
        type: 'INVOKE_TOOL',
        invocationId: 'test-inv-1',
        payload: {
          tool: 'start_game',
          params: { difficulty: 'easy', color: 'white' }
        }
      }, '*')
    })

    // Wait for board to render
    await page.waitForTimeout(1000)

    // Verify chess pieces are visible (Unicode chess pieces rendered in the DOM)
    const pageContent = await page.textContent('body')
    const hasChessPieces = /[♔♕♖♗♘♙♚♛♜♝♞♟]/.test(pageContent || '')
    expect(hasChessPieces).toBe(true)
  })
})
