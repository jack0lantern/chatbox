import { test, expect } from '@playwright/test'

test('login flow', async ({ page }) => {
  // Collect console errors
  const consoleErrors: string[] = []
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })
  page.on('pageerror', err => consoleErrors.push(err.message))

  // Collect network failures
  const failedRequests: string[] = []
  page.on('requestfailed', req => {
    failedRequests.push(`${req.method()} ${req.url()} - ${req.failure()?.errorText}`)
  })

  // Track all network requests to auth endpoints
  const authRequests: { url: string; status: number; body: string }[] = []
  page.on('response', async res => {
    if (res.url().includes('/api/auth/')) {
      let body = ''
      try { body = await res.text() } catch {}
      authRequests.push({ url: res.url(), status: res.status(), body })
    }
  })

  await page.goto('http://localhost:3000/login')
  await page.waitForLoadState('networkidle')

  // Fill in the form
  await page.fill('#email', 'xjackjiang@gmail.com')
  await page.fill('#password', 'password123')

  // Click sign in
  await page.click('button[type="submit"]')

  // Wait for any network activity to settle
  await page.waitForTimeout(3000)

  // Report everything
  console.log('\n=== CONSOLE ERRORS ===')
  consoleErrors.forEach(e => console.log(e))

  console.log('\n=== FAILED REQUESTS ===')
  failedRequests.forEach(r => console.log(r))

  console.log('\n=== AUTH REQUESTS ===')
  authRequests.forEach(r => console.log(`${r.status} ${r.url}\n  ${r.body.substring(0, 200)}`))

  console.log('\n=== CURRENT URL ===')
  console.log(page.url())

  console.log('\n=== PAGE CONTENT ===')
  const bodyText = await page.textContent('body')
  console.log(bodyText?.substring(0, 500))

  // Check if there's an error message visible on page
  const errorEl = await page.$('p[style*="color: red"]')
  if (errorEl) {
    const errorText = await errorEl.textContent()
    console.log('\n=== ERROR MESSAGE ON PAGE ===')
    console.log(errorText)
  }
})
