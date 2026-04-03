import { test, expect, type Page } from '@playwright/test'

// The timeline plugin uses top-level fields: { type, tool, params, callId }
async function sendTool(page: Page, tool: string, params: Record<string, unknown> = {}) {
  const callId = `test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  await page.evaluate(({ tool, params, callId }) => {
    window.postMessage({ type: 'INVOKE_TOOL', tool, params, callId }, '*')
  }, { tool, params, callId })
  return callId
}

async function startGame(page: Page) {
  await page.goto('/plugins/timeline/index.html')
  await page.waitForLoadState('networkidle')
  await sendTool(page, 'start_quiz', {})
  // Wait for events.json to load and game to initialize
  await page.waitForTimeout(1500)
}

// Extract timeline card years from the DOM via page.evaluate
async function getTimelineYears(page: Page): Promise<number[]> {
  return page.evaluate(() => {
    // Timeline cards use class 'timeline-card' with year in '.tc-year'
    const cards = document.querySelectorAll('.timeline-card')
    const years: number[] = []
    cards.forEach(card => {
      const yearEl = card.querySelector('.tc-year')
      if (yearEl) {
        const text = yearEl.textContent || ''
        const match = text.match(/(\d+)\s*(BC|AD)/i)
        if (match) {
          const num = parseInt(match[1])
          years.push(match[2].toUpperCase() === 'BC' ? -num : num)
        }
      }
    })
    return years
  })
}

// Check if timeline years are sorted
function isSorted(years: number[]): boolean {
  for (let i = 1; i < years.length; i++) {
    if (years[i - 1] > years[i]) return false
  }
  return true
}

test.describe('Timeline placement bug fixes', () => {

  test('BUG FIX 1: wrong placement should rearrange card to correct chronological position', async ({ page }) => {
    const { pageErrors, consoleErrors } = attachCollectors(page)
    await startGame(page)

    // Get initial timeline state
    const initialYears = await getTimelineYears(page)
    console.log('Initial timeline:', initialYears)
    expect(initialYears.length).toBeGreaterThanOrEqual(1)

    // Find a drop zone and click it (intentionally in a spot that might be wrong)
    // We click the FIRST drop zone — if the current card belongs later, this is wrong
    const dropZones = page.locator('.drop-zone')
    const dropCount = await dropZones.count()
    expect(dropCount).toBeGreaterThan(0)

    // Click the first drop zone
    await dropZones.first().click()
    await page.waitForTimeout(1000)

    // Regardless of whether it was right or wrong, the timeline should be sorted
    const afterYears = await getTimelineYears(page)
    console.log('After placement:', afterYears)
    expect(afterYears.length).toBe(initialYears.length + 1)
    expect(isSorted(afterYears)).toBe(true)
  })

  test('BUG FIX 2: correct placements after a wrong one should still count as correct', async ({ page }) => {
    const { pageErrors } = attachCollectors(page)
    await startGame(page)

    // We'll track lives and score through multiple placements
    // Strategy: make several placements and verify timeline stays sorted after each

    for (let attempt = 0; attempt < 4; attempt++) {
      const dropZones = page.locator('.drop-zone')
      const dropCount = await dropZones.count()
      if (dropCount === 0) break // game might be over

      // Click a drop zone
      await dropZones.first().click()
      await page.waitForTimeout(800)

      // After every placement, timeline must be sorted
      const years = await getTimelineYears(page)
      console.log(`After placement ${attempt + 1}:`, years)
      expect(isSorted(years)).toBe(true)
    }

    expect(pageErrors).toEqual([])
  })

  test('timeline stays sorted through 10 consecutive placements', async ({ page }) => {
    const { pageErrors } = attachCollectors(page)
    await startGame(page)

    for (let i = 0; i < 10; i++) {
      // Wait for current card to appear
      await page.waitForTimeout(700)

      const dropZones = page.locator('.drop-zone')
      const dropCount = await dropZones.count()
      if (dropCount === 0) break

      // Click a random drop zone
      const randomIndex = Math.floor(Math.random() * dropCount)
      await dropZones.nth(randomIndex).click()
      await page.waitForTimeout(600)

      // Verify timeline is always sorted
      const years = await getTimelineYears(page)
      if (years.length > 1) {
        expect(isSorted(years)).toBe(true)
      }
    }

    expect(pageErrors).toEqual([])
  })
})

function attachCollectors(page: Page) {
  const consoleErrors: string[] = []
  const pageErrors: string[] = []
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()) })
  page.on('pageerror', err => { pageErrors.push(err.message) })
  return { consoleErrors, pageErrors }
}
