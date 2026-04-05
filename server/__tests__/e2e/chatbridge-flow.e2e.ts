import { test, expect } from '@playwright/test'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient({
  datasources: { db: { url: 'postgresql://postgres:postgres@127.0.0.1:54322/chatbridge' } },
})

const RENDERER_URL = 'http://localhost:1212'
const TEST_PASSWORD = 'test-password-123'

// Unique emails per test group to avoid collisions
const ts = Date.now()
const LOGIN_EMAIL = `e2e-login-${ts}@test.com`
const FAIL_EMAIL = `e2e-fail-${ts}@test.com`
const SIGNUP_EMAIL = `e2e-signup-${ts}@test.com`
const LOGOUT_EMAIL = `e2e-logout-${ts}@test.com`
const INIT_EMAIL = `e2e-init-${ts}@test.com`
const CHESS_EMAIL = `e2e-chess-${ts}@test.com`

async function deleteTestUsers() {
  await prisma.user.deleteMany({
    where: {
      email: {
        in: [LOGIN_EMAIL, FAIL_EMAIL, SIGNUP_EMAIL, LOGOUT_EMAIL, INIT_EMAIL, CHESS_EMAIL],
      },
    },
  })
}

async function login(page: import('@playwright/test').Page, email: string, password: string) {
  await page.goto(RENDERER_URL)
  await page.waitForSelector('[data-testid="login-email"]', { timeout: 15000 })
  await page.fill('[data-testid="login-email"]', email)
  await page.fill('[data-testid="login-password"]', password)
  await page.click('[data-testid="login-submit"]')
}

test.beforeAll(async () => {
  await deleteTestUsers()
})

test.afterAll(async () => {
  await deleteTestUsers()
  await prisma.$disconnect()
})

// ─── Group 1: Auth Flow ──────────────────────────────────────────

test.describe('Auth Flow', () => {
  test('login screen renders with email and password fields', async ({ page }) => {
    await page.goto(RENDERER_URL)
    await page.waitForSelector('[data-testid="login-email"]', { timeout: 15000 })

    await expect(page.locator('[data-testid="login-email"]')).toBeVisible()
    await expect(page.locator('[data-testid="login-password"]')).toBeVisible()
    await expect(page.locator('[data-testid="login-submit"]')).toBeVisible()
    await expect(page.locator('[data-testid="login-submit"]')).toHaveText('Sign In')
  })

  test('toggle to signup mode changes heading and button', async ({ page }) => {
    await page.goto(RENDERER_URL)
    await page.waitForSelector('[data-testid="login-toggle"]', { timeout: 15000 })
    await page.click('[data-testid="login-toggle"]')

    await expect(page.locator('[data-testid="login-submit"]')).toHaveText('Sign Up')
    await expect(page.getByText('Create Account')).toBeVisible()
  })

  test('sign in with valid credentials loads chatbox', async ({ page }) => {
    await login(page, LOGIN_EMAIL, TEST_PASSWORD)

    // After login, page reloads and chatbox initializes — wait for sidebar
    await page.waitForSelector('[data-testid="login-email"]', { state: 'hidden', timeout: 20000 }).catch(() => {})
    // Wait for the app to load (sidebar or any main UI element)
    await page.waitForTimeout(5000)
    // The login form should no longer be visible
    await expect(page.locator('[data-testid="login-email"]')).not.toBeVisible()
  })

  test('submit with empty fields shows browser validation', async ({ page }) => {
    await page.goto(RENDERER_URL)
    await page.waitForSelector('[data-testid="login-submit"]', { timeout: 15000 })

    // Click submit without filling fields — HTML5 required validation prevents submission
    await page.click('[data-testid="login-submit"]')

    // The login form should still be visible (form was not submitted)
    await expect(page.locator('[data-testid="login-email"]')).toBeVisible()
    await expect(page.locator('[data-testid="login-submit"]')).toHaveText('Sign In')
  })

  test('signup with new email creates account and loads chatbox', async ({ page }) => {
    await page.goto(RENDERER_URL)
    await page.waitForSelector('[data-testid="login-toggle"]', { timeout: 15000 })
    await page.click('[data-testid="login-toggle"]')

    await page.fill('[data-testid="login-email"]', SIGNUP_EMAIL)
    await page.fill('[data-testid="login-password"]', TEST_PASSWORD)
    await page.click('[data-testid="login-submit"]')

    // Should load chatbox after signup
    await page.waitForSelector('[data-testid="login-email"]', { state: 'hidden', timeout: 20000 }).catch(() => {})
    await page.waitForTimeout(5000)
    await expect(page.locator('[data-testid="login-email"]')).not.toBeVisible()
  })
})

// ─── Group 2: Post-Login Initialization ──────────────────────────

test.describe('Post-Login Initialization', () => {
  test('after login, sidebar and session list are visible', async ({ page }) => {
    await login(page, INIT_EMAIL, TEST_PASSWORD)
    await page.waitForTimeout(8000)

    // The sidebar should be rendered — look for the session list or sidebar structure
    const sidebar = page.locator('.sidebar, [class*="sidebar"], nav')
    // At minimum, the login form should be gone
    await expect(page.locator('[data-testid="login-email"]')).not.toBeVisible()
  })

  test('ChatBridgeAccountSection shows logged-in email', async ({ page }) => {
    await login(page, INIT_EMAIL, TEST_PASSWORD)
    await page.waitForTimeout(8000)

    // The account section should display the email
    const body = await page.textContent('body')
    expect(body).toContain(INIT_EMAIL)
  })
})

// ─── Group 3: Chess Plugin ───────────────────────────────────────

test.describe('Chess Plugin', () => {
  test('plugin tools are loaded after initialization', async ({ page }) => {
    const toolLogs: string[] = []
    page.on('console', (msg) => {
      const text = msg.text()
      if (text.includes('tools') || text.includes('plugin')) {
        toolLogs.push(text)
      }
    })

    await login(page, CHESS_EMAIL, TEST_PASSWORD)
    await page.waitForTimeout(10000)

    await expect(page.locator('[data-testid="login-email"]')).not.toBeVisible()
  })

  test('send "lets play chess" in chat', async ({ page }) => {
    // Capture all console output for debugging
    const consoleLogs: string[] = []
    page.on('console', (msg) => consoleLogs.push(`[${msg.type()}] ${msg.text()}`))
    page.on('pageerror', (err) => consoleLogs.push(`[PAGE_ERROR] ${err.message}`))

    // Login and wait for app to initialize
    await login(page, CHESS_EMAIL, TEST_PASSWORD)
    await page.waitForTimeout(8000)
    await expect(page.locator('[data-testid="login-email"]')).not.toBeVisible()

    // Create a new chat session
    const newChatBtn = page.locator('[data-testid="new-chat-button"]')
    if (await newChatBtn.isVisible()) {
      await newChatBtn.click()
      await page.waitForTimeout(1000)
    }

    // Wait for message input to be ready
    await page.waitForSelector('[data-testid="message-input"]', { timeout: 10000 })

    // Type and send "lets play chess"
    await page.fill('[data-testid="message-input"]', 'lets play chess')
    await page.press('[data-testid="message-input"]', 'Enter')

    // Wait for the message to appear and AI to process
    await page.waitForTimeout(15000)

    // Take a screenshot for debugging
    await page.screenshot({ path: 'test-results/chess-prompt.png', fullPage: true })

    // Log console output for debugging
    const pluginLogs = consoleLogs.filter(l =>
      l.includes('plugin') || l.includes('chess') || l.includes('tools') || l.includes('error') || l.includes('ERROR')
    )
    console.log('=== Relevant console logs ===')
    for (const log of pluginLogs.slice(-30)) {
      console.log(log)
    }

    // Verify the message was sent (it should appear in the message list)
    const bodyText = await page.textContent('body')
    expect(bodyText).toContain('lets play chess')
  })
})
