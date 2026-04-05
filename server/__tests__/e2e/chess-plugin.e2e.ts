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

    // Send start_game using the correct INVOKE_TOOL payload format:
    // { type: 'INVOKE_TOOL', invocationId, payload: { toolName, parameters } }
    await page.evaluate(() => {
      window.postMessage({
        type: 'INVOKE_TOOL',
        invocationId: 'test-inv-1',
        payload: {
          toolName: 'start_game',
          parameters: { difficulty: 'easy', color: 'white' }
        }
      }, '*')
    })

    // Wait for board to render (react-chessboard loads async via esm.sh)
    await page.waitForTimeout(3000)

    // react-chessboard renders SVG pieces inside the board container.
    // Look for piece elements (data-piece attributes) or SVG content within the board.
    const hasBoardPieces = await page.evaluate(() => {
      // react-chessboard renders pieces as <div> elements with data-piece attributes
      // or as images/SVGs inside the board squares
      const pieces = document.querySelectorAll('[data-piece]')
      if (pieces.length > 0) return true

      // Alternatively, check for piece elements by class
      const pieceEls = document.querySelectorAll('.piece')
      if (pieceEls.length > 0) return true

      // Check for SVG elements that react-chessboard may render for pieces
      const svgs = document.querySelectorAll('svg')
      if (svgs.length > 0) return true

      // Check for images (some react-chessboard versions use img tags)
      const imgs = document.querySelectorAll('img[src*="piece"], img[alt]')
      if (imgs.length > 0) return true

      // Fallback: the board container should exist with many child divs (64 squares)
      const boardSquares = document.querySelectorAll('[data-square]')
      return boardSquares.length >= 64
    })
    expect(hasBoardPieces).toBe(true)
  })
})
