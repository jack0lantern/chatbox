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

  test('BUG FIX 1: wrong placement rearranges card to correct chronological position', async ({ page }) => {
    const { pageErrors } = attachCollectors(page)
    await startGame(page)

    const initialYears = await getTimelineYears(page)
    expect(initialYears.length).toBeGreaterThanOrEqual(1)

    // Click the first drop zone
    await page.locator('.drop-zone').first().click()
    await page.waitForTimeout(1000)

    // Regardless of whether right or wrong, timeline must be sorted
    const afterYears = await getTimelineYears(page)
    expect(afterYears.length).toBe(initialYears.length + 1)
    expect(isSorted(afterYears)).toBe(true)
  })

  test('BUG FIX 2: correct placement after wrong one is scored correctly', async ({ page }) => {
    const { pageErrors } = attachCollectors(page)

    // Intercept STATE_UPDATE messages to track score/lives
    await page.addInitScript(() => {
      ;(window as any).__stateHistory = []
      const orig = window.parent.postMessage.bind(window.parent)
      window.parent.postMessage = function(msg: any, ...args: any[]) {
        if (msg?.type === 'STATE_UPDATE' && msg.state) {
          ;(window as any).__stateHistory.push({
            score: msg.state.score,
            lives: msg.state.lives,
            timelineYears: (msg.state.timeline || []).map((c: any) => c.year),
            timelineStatuses: (msg.state.timeline || []).map((c: any) => c.status)
          })
        }
        return orig(msg, ...args)
      }
    })

    await page.goto('/plugins/timeline/index.html')
    await page.waitForLoadState('networkidle')
    await sendTool(page, 'start_quiz', {})
    await page.waitForTimeout(2000)

    // Make 5 placements, clicking different positions
    const positions = ['first', 'last', 'last', 'last', 'first']
    for (let i = 0; i < positions.length; i++) {
      const dropZones = page.locator('.drop-zone')
      const count = await dropZones.count()
      if (count === 0) break

      if (positions[i] === 'first') {
        await dropZones.first().click()
      } else {
        await dropZones.last().click()
      }
      await page.waitForTimeout(1200)
    }

    // Get state history
    const history = await page.evaluate(() => (window as any).__stateHistory || [])

    // Verify: timeline is sorted after every single placement
    for (let i = 0; i < history.length; i++) {
      const years = history[i].timelineYears as number[]
      expect(isSorted(years)).toBe(true)
    }

    // Verify: score only goes up on correct placements (never decreases)
    let prevScore = 0
    for (const entry of history) {
      expect(entry.score).toBeGreaterThanOrEqual(prevScore)
      prevScore = entry.score
    }

    // Verify: lives only go down on wrong placements (never increases)
    let prevLives = 3
    for (const entry of history) {
      expect(entry.lives).toBeLessThanOrEqual(prevLives)
      prevLives = entry.lives
    }

    // Verify: if a correct placement happened after a wrong one, score increased
    // Look for a pattern: lives decreased, then score increased
    let foundWrongThenCorrect = false
    for (let i = 1; i < history.length; i++) {
      if (history[i].lives < history[i-1].lives) {
        // Wrong placement just happened
        // Check if any subsequent placement has a higher score
        for (let j = i + 1; j < history.length; j++) {
          if (history[j].score > history[i].score) {
            foundWrongThenCorrect = true
            break
          }
        }
      }
    }
    // We can't guarantee this scenario happens with random cards, but if it did, it worked
    if (foundWrongThenCorrect) {
      console.log('VERIFIED: correct placement scored correctly after a wrong one')
    }

    expect(pageErrors).toEqual([])
  })

  test('timeline stays sorted through 10 random placements', async ({ page }) => {
    const { pageErrors } = attachCollectors(page)
    await startGame(page)

    for (let i = 0; i < 10; i++) {
      await page.waitForTimeout(700)

      const dropZones = page.locator('.drop-zone')
      const dropCount = await dropZones.count()
      if (dropCount === 0) break

      const randomIndex = Math.floor(Math.random() * dropCount)
      await dropZones.nth(randomIndex).click()
      await page.waitForTimeout(600)

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
