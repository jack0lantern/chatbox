import { test, expect, type Page } from '@playwright/test'

function attachErrorCollectors(page: Page) {
  const errors: string[] = []
  const pageErrors: string[] = []
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()) })
  page.on('pageerror', err => { pageErrors.push(err.message) })
  return { errors, pageErrors }
}

async function sendTool(page: Page, tool: string, params: Record<string, unknown> = {}) {
  const callId = `chaos-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  await page.evaluate(({ tool, params, callId }) => {
    window.postMessage({ type: 'INVOKE_TOOL', tool, params, callId }, '*')
  }, { tool, params, callId })
  return callId
}

async function sendRaw(page: Page, data: any) {
  await page.evaluate((d) => { window.postMessage(d, '*') }, data)
}

test.describe('Timeline Plugin Chaos Testing', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/plugins/timeline/index.html')
    await page.waitForLoadState('networkidle')
  })

  // --- Tools before start ---

  test('check_placement before start_quiz', async ({ page }) => {
    const { pageErrors } = attachErrorCollectors(page)
    await sendTool(page, 'check_placement')
    await page.waitForTimeout(500)
    expect(pageErrors).toEqual([])
  })

  test('get_hint before start_quiz', async ({ page }) => {
    const { pageErrors } = attachErrorCollectors(page)
    await sendTool(page, 'get_hint')
    await page.waitForTimeout(500)
    expect(pageErrors).toEqual([])
  })

  test('next_card before start_quiz', async ({ page }) => {
    const { pageErrors } = attachErrorCollectors(page)
    await sendTool(page, 'next_card')
    await page.waitForTimeout(500)
    expect(pageErrors).toEqual([])
  })

  // --- Invalid inputs ---

  test('start_quiz with nonexistent category', async ({ page }) => {
    const { pageErrors } = attachErrorCollectors(page)
    await sendTool(page, 'start_quiz', { category: 'underwater-basket-weaving' })
    await page.waitForTimeout(1000)
    expect(pageErrors).toEqual([])
  })

  test('start_quiz with null category', async ({ page }) => {
    const { pageErrors } = attachErrorCollectors(page)
    await sendTool(page, 'start_quiz', { category: null as any })
    await page.waitForTimeout(1000)
    expect(pageErrors).toEqual([])
  })

  test('start_quiz with no params', async ({ page }) => {
    const { pageErrors } = attachErrorCollectors(page)
    await sendTool(page, 'start_quiz')
    await page.waitForTimeout(1000)
    expect(pageErrors).toEqual([])
    // Should have game UI
    const content = await page.textContent('body')
    expect(content).toBeTruthy()
  })

  // --- Double start ---

  test('double start_quiz', async ({ page }) => {
    const { pageErrors } = attachErrorCollectors(page)
    await sendTool(page, 'start_quiz')
    await page.waitForTimeout(500)
    await sendTool(page, 'start_quiz', { category: 'war' })
    await page.waitForTimeout(1000)
    expect(pageErrors).toEqual([])
  })

  // --- Unknown tool ---

  test('unknown tool name', async ({ page }) => {
    const { pageErrors } = attachErrorCollectors(page)
    await sendTool(page, 'destroy_everything', { nuke: true })
    await page.waitForTimeout(500)
    expect(pageErrors).toEqual([])
  })

  test('empty tool name', async ({ page }) => {
    const { pageErrors } = attachErrorCollectors(page)
    await sendTool(page, '')
    await page.waitForTimeout(500)
    expect(pageErrors).toEqual([])
  })

  // --- Malformed messages ---

  test('null postMessage', async ({ page }) => {
    const { pageErrors } = attachErrorCollectors(page)
    await sendRaw(page, null)
    await page.waitForTimeout(300)
    expect(pageErrors).toEqual([])
  })

  test('string postMessage', async ({ page }) => {
    const { pageErrors } = attachErrorCollectors(page)
    await sendRaw(page, 'hello')
    await page.waitForTimeout(300)
    expect(pageErrors).toEqual([])
  })

  test('number postMessage', async ({ page }) => {
    const { pageErrors } = attachErrorCollectors(page)
    await sendRaw(page, 42)
    await page.waitForTimeout(300)
    expect(pageErrors).toEqual([])
  })

  test('INVOKE_TOOL with missing tool field', async ({ page }) => {
    const { pageErrors } = attachErrorCollectors(page)
    await sendRaw(page, { type: 'INVOKE_TOOL', params: {} })
    await page.waitForTimeout(300)
    expect(pageErrors).toEqual([])
  })

  test('INVOKE_TOOL with null params', async ({ page }) => {
    const { pageErrors } = attachErrorCollectors(page)
    await sendRaw(page, { type: 'INVOKE_TOOL', tool: 'start_quiz', params: null })
    await page.waitForTimeout(1000)
    expect(pageErrors).toEqual([])
  })

  // --- STATE_RESTORE edge cases ---

  test('STATE_RESTORE with empty state', async ({ page }) => {
    const { pageErrors } = attachErrorCollectors(page)
    await sendRaw(page, { type: 'STATE_RESTORE', payload: { state: {} } })
    await page.waitForTimeout(500)
    expect(pageErrors).toEqual([])
  })

  test('STATE_RESTORE with null state', async ({ page }) => {
    const { pageErrors } = attachErrorCollectors(page)
    await sendRaw(page, { type: 'STATE_RESTORE', payload: { state: null } })
    await page.waitForTimeout(500)
    expect(pageErrors).toEqual([])
  })

  test('STATE_RESTORE with null payload', async ({ page }) => {
    const { pageErrors } = attachErrorCollectors(page)
    await sendRaw(page, { type: 'STATE_RESTORE', payload: null })
    await page.waitForTimeout(500)
    expect(pageErrors).toEqual([])
  })

  test('STATE_RESTORE with corrupted state', async ({ page }) => {
    const { pageErrors } = attachErrorCollectors(page)
    await sendRaw(page, {
      type: 'STATE_RESTORE',
      payload: { state: { timeline: 'not-an-array', lives: -5, deck: null } }
    })
    await page.waitForTimeout(500)
    expect(pageErrors).toEqual([])
  })

  // --- DESTROY ---

  test('DESTROY before start', async ({ page }) => {
    const { pageErrors } = attachErrorCollectors(page)
    await sendRaw(page, { type: 'DESTROY' })
    await page.waitForTimeout(300)
    expect(pageErrors).toEqual([])
  })

  test('DESTROY mid-game', async ({ page }) => {
    const { pageErrors } = attachErrorCollectors(page)
    await sendTool(page, 'start_quiz')
    await page.waitForTimeout(1000)
    await sendRaw(page, { type: 'DESTROY' })
    await page.waitForTimeout(300)
    expect(pageErrors).toEqual([])
  })

  test('tools after DESTROY', async ({ page }) => {
    const { pageErrors } = attachErrorCollectors(page)
    await sendTool(page, 'start_quiz')
    await page.waitForTimeout(1000)
    await sendRaw(page, { type: 'DESTROY' })
    await page.waitForTimeout(300)
    // Send more tools after destroy
    await sendTool(page, 'get_hint')
    await sendTool(page, 'check_placement')
    await sendTool(page, 'next_card')
    await page.waitForTimeout(500)
    expect(pageErrors).toEqual([])
  })

  // --- Rapid fire ---

  test('rapid start_quiz calls', async ({ page }) => {
    const { pageErrors } = attachErrorCollectors(page)
    for (let i = 0; i < 5; i++) {
      await sendTool(page, 'start_quiz')
    }
    await page.waitForTimeout(2000)
    expect(pageErrors).toEqual([])
  })

  test('rapid tool calls during game', async ({ page }) => {
    const { pageErrors } = attachErrorCollectors(page)
    await sendTool(page, 'start_quiz')
    await page.waitForTimeout(1000)
    for (let i = 0; i < 10; i++) {
      await sendTool(page, 'get_hint')
      await sendTool(page, 'check_placement')
      await sendTool(page, 'next_card')
    }
    await page.waitForTimeout(1000)
    expect(pageErrors).toEqual([])
  })

  // --- Gameplay edge cases ---

  test('start then get_hint immediately', async ({ page }) => {
    const { pageErrors } = attachErrorCollectors(page)
    await sendTool(page, 'start_quiz')
    await sendTool(page, 'get_hint')
    await page.waitForTimeout(1500)
    expect(pageErrors).toEqual([])
  })

  test('start then next_card immediately', async ({ page }) => {
    const { pageErrors } = attachErrorCollectors(page)
    await sendTool(page, 'start_quiz')
    await sendTool(page, 'next_card')
    await page.waitForTimeout(1500)
    expect(pageErrors).toEqual([])
  })

  // --- Click interactions during game ---

  test('clicking drop zones during game', async ({ page }) => {
    const { pageErrors } = attachErrorCollectors(page)
    await sendTool(page, 'start_quiz')
    await page.waitForTimeout(1500)

    // Try clicking all visible drop zones
    const dropZones = page.locator('[class*="drop"], [data-drop], button, [role="button"]')
    const count = await dropZones.count()
    for (let i = 0; i < Math.min(count, 5); i++) {
      await dropZones.nth(i).click({ force: true }).catch(() => {})
      await page.waitForTimeout(200)
    }
    expect(pageErrors).toEqual([])
  })

  test('rapid clicking everywhere during game', async ({ page }) => {
    const { pageErrors } = attachErrorCollectors(page)
    await sendTool(page, 'start_quiz')
    await page.waitForTimeout(1500)

    // Click random positions
    for (let i = 0; i < 10; i++) {
      const x = Math.floor(Math.random() * 600) + 50
      const y = Math.floor(Math.random() * 400) + 50
      await page.mouse.click(x, y).catch(() => {})
      await page.waitForTimeout(50)
    }
    expect(pageErrors).toEqual([])
  })
})
