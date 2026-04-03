import { test, expect } from '@playwright/test'

test.describe('timeline plugin', () => {
  test('loads and has content', async ({ page }) => {
    await page.goto('/plugins/timeline/index.html')
    await page.waitForLoadState('networkidle')

    const body = await page.textContent('body')
    expect(body).toBeTruthy()

    const hasContent = await page.locator('body').evaluate(el => el.children.length > 0)
    expect(hasContent).toBe(true)
  })

  test('events.json is accessible and has 50+ events', async ({ request }) => {
    const response = await request.get('/plugins/timeline/data/events.json')
    expect(response.ok()).toBe(true)

    const events = await response.json()
    expect(Array.isArray(events)).toBe(true)
    expect(events.length).toBeGreaterThanOrEqual(50)

    // Verify event structure
    const first = events[0]
    expect(first).toHaveProperty('id')
    expect(first).toHaveProperty('event')
    expect(first).toHaveProperty('year')
    expect(first).toHaveProperty('category')
  })

  test('renders game UI after start_quiz message', async ({ page }) => {
    await page.goto('/plugins/timeline/index.html')
    await page.waitForLoadState('networkidle')

    // Send start_quiz using the format the timeline plugin actually expects:
    // { type: 'INVOKE_TOOL', tool, params, callId }
    await page.evaluate(() => {
      window.postMessage({
        type: 'INVOKE_TOOL',
        tool: 'start_quiz',
        params: {},
        callId: 'test-inv-1'
      }, '*')
    })

    // Wait for game to initialize (loads events.json)
    await page.waitForTimeout(2000)

    // Verify game elements are visible
    const pageContent = await page.textContent('body')
    // Should show score or lives or some game UI
    const hasGameUI = pageContent && (
      pageContent.includes('Score') ||
      pageContent.includes('score') ||
      pageContent.includes('Lives') ||
      pageContent.includes('♥') ||
      pageContent.includes('❤')
    )
    expect(hasGameUI).toBeTruthy()
  })
})
