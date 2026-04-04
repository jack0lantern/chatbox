import { test, expect } from '@playwright/test'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient({
  datasources: { db: { url: 'postgresql://postgres:postgres@127.0.0.1:54322/chatbridge' } },
})

const RENDERER_URL = 'http://localhost:1212'
const TEST_PASSWORD = 'test-password-123'
const ts = Date.now()
const SCROLL_EMAIL = `e2e-scroll-${ts}@test.com`

async function login(page: import('@playwright/test').Page, email: string, password: string) {
  await page.goto(RENDERER_URL)
  await page.waitForSelector('[data-testid="login-email"]', { timeout: 15000 })
  await page.fill('[data-testid="login-email"]', email)
  await page.fill('[data-testid="login-password"]', password)
  await page.click('[data-testid="login-submit"]')
}

test.afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: SCROLL_EMAIL } })
  await prisma.$disconnect()
})

test.describe('Chess plugin scroll in full app', () => {
  test('scrolling within chess iframe does not crash the app', async ({ page }) => {
    const pageErrors: string[] = []
    const consoleErrors: string[] = []
    page.on('pageerror', (err) => pageErrors.push(err.message))
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text())
    })

    // Login
    await login(page, SCROLL_EMAIL, TEST_PASSWORD)
    await page.waitForTimeout(5000)
    await expect(page.locator('[data-testid="login-email"]')).not.toBeVisible()

    // Navigate to new chat session
    const newChatBtn = page.locator('[data-testid="new-chat-button"]')
    if (await newChatBtn.isVisible()) {
      await newChatBtn.click()
      await page.waitForTimeout(2000)
    }

    // Wait for message input
    await page.waitForSelector('[data-testid="message-input"]', { timeout: 15000 })

    // Inject chess iframe into the session layout (same position as real PluginContainer)
    const injected = await page.evaluate(() => {
      // Find the session flex column: div.flex.flex-col.h-full
      const flexCols = document.querySelectorAll('.flex.flex-col.h-full')
      const sessionCol = Array.from(flexCols).find(el =>
        el.querySelector('[data-testid="message-input"]')
      )
      if (!sessionCol) return false

      const wrapper = document.createElement('div')
      wrapper.id = 'test-plugin-container'
      wrapper.style.cssText = 'overflow: hidden; border: 1px solid #ccc; border-radius: 8px; margin: 0 12px 4px;'

      const iframe = document.createElement('iframe')
      iframe.id = 'test-chess-iframe'
      iframe.src = '/plugins/chess/index.html'
      iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin')
      iframe.style.cssText = 'width: 100%; height: 600px; border: none; display: block;'
      wrapper.appendChild(iframe)

      // Insert before the last child (InputBox area)
      const lastChild = sessionCol.lastElementChild
      if (lastChild) {
        sessionCol.insertBefore(wrapper, lastChild)
      } else {
        sessionCol.appendChild(wrapper)
      }
      return true
    })
    expect(injected).toBe(true)

    // Wait for iframe to load
    await page.waitForTimeout(3000)

    const iframe = page.locator('#test-chess-iframe')
    await expect(iframe).toBeVisible()

    // Start a chess game inside the iframe
    const frame = page.frameLocator('#test-chess-iframe')
    await frame.locator('#root').waitFor({ timeout: 10000 })

    await page.evaluate(() => {
      const el = document.querySelector('#test-chess-iframe') as HTMLIFrameElement
      el?.contentWindow?.postMessage({
        type: 'INVOKE_TOOL',
        invocationId: 'scroll-test-1',
        payload: { toolName: 'start_game', parameters: { difficulty: 'easy', color: 'white' } },
      }, '*')
    })

    // Wait for chessboard
    await frame.locator('.chess-board').waitFor({ timeout: 10000 })
    await page.waitForTimeout(500)

    // Verify board is visible
    const boardVisible = await frame.locator('.chess-board').isVisible()
    expect(boardVisible).toBe(true)

    // Get iframe position
    const bounds = await iframe.boundingBox()
    expect(bounds).not.toBeNull()

    // Count page errors before scroll
    const errorsBefore = pageErrors.length

    // Move mouse to iframe center and scroll down aggressively
    await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2)
    for (let i = 0; i < 20; i++) {
      await page.mouse.wheel(0, 120)
      await page.waitForTimeout(80)
    }
    await page.waitForTimeout(500)

    // Scroll back up
    for (let i = 0; i < 20; i++) {
      await page.mouse.wheel(0, -120)
      await page.waitForTimeout(80)
    }
    await page.waitForTimeout(500)

    // Verify app did not crash
    const bodyExists = await page.textContent('body').catch(() => null)
    expect(bodyExists).toBeTruthy()

    // Iframe should still be visible
    const iframeStillVisible = await iframe.isVisible().catch(() => false)
    expect(iframeStillVisible).toBe(true)

    // Board should still be visible inside iframe
    const boardStillVisible = await frame.locator('.chess-board').isVisible().catch(() => false)
    expect(boardStillVisible).toBe(true)

    // Message input should still be usable
    const inputVisible = await page.locator('[data-testid="message-input"]').isVisible().catch(() => false)
    expect(inputVisible).toBe(true)

    // No new page errors from scrolling
    const newErrors = pageErrors.slice(errorsBefore).filter(e =>
      !e.includes('net::ERR') && !e.includes('createRoot')
    )
    expect(newErrors).toEqual([])
  })
})
