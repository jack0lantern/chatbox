import { test, expect } from '@playwright/test'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient({
  datasources: { db: { url: 'postgresql://postgres:postgres@127.0.0.1:54322/chatbridge' } },
})

const BASE_URL = 'http://localhost:3000'

// Unique emails for each test to avoid collisions
const AUTH_TEST_EMAIL_1 = 'test-auth-redirect@test.com'
const AUTH_TEST_EMAIL_2 = 'test-auth-login@test.com'
const AUTH_TEST_EMAIL_3 = 'test-auth-persist@test.com'
const TEST_PASSWORD = 'password-test-123'

async function deleteUserByEmail(email: string) {
  try {
    await prisma.user.deleteMany({ where: { email } })
  } catch {}
}

test.afterAll(async () => {
  await deleteUserByEmail(AUTH_TEST_EMAIL_1)
  await deleteUserByEmail(AUTH_TEST_EMAIL_2)
  await deleteUserByEmail(AUTH_TEST_EMAIL_3)
  await prisma.$disconnect()
})

test('visit / without session redirects to /login', async ({ page }) => {
  await page.goto(`${BASE_URL}/`)
  await page.waitForURL(`${BASE_URL}/login**`, { timeout: 10000 })
  expect(page.url()).toContain('/login')
})

test('login with valid credentials redirects to / showing logged-in state', async ({ page }) => {
  // Ensure user doesn't pre-exist so we test auto-create on first login
  await deleteUserByEmail(AUTH_TEST_EMAIL_2)

  await page.goto(`${BASE_URL}/login`)
  await page.waitForLoadState('networkidle')

  await page.fill('#email', AUTH_TEST_EMAIL_2)
  await page.fill('#password', TEST_PASSWORD)
  await page.click('button[type="submit"]')

  // Wait for redirect to home
  await page.waitForURL(`${BASE_URL}/`, { timeout: 15000 })

  // Should show the logged-in state with the email
  const bodyText = await page.textContent('body')
  expect(bodyText).toContain(AUTH_TEST_EMAIL_2)
  expect(bodyText).toContain('ChatBridge')
})

test('visit /login when already logged in — page is accessible', async ({ page }) => {
  // Login first
  await deleteUserByEmail(AUTH_TEST_EMAIL_1)
  await page.goto(`${BASE_URL}/login`)
  await page.waitForLoadState('networkidle')
  await page.fill('#email', AUTH_TEST_EMAIL_1)
  await page.fill('#password', TEST_PASSWORD)
  await page.click('button[type="submit"]')
  await page.waitForURL(`${BASE_URL}/`, { timeout: 15000 })

  // Navigate back to /login — should still be accessible (no forced redirect away)
  await page.goto(`${BASE_URL}/login`)
  await page.waitForLoadState('networkidle')

  // The login page should render (it's a client component, it will load)
  // We just verify it doesn't error out or show a broken page
  expect(page.url()).toContain('/login')
  const bodyText = await page.textContent('body')
  // The login form should still be present
  expect(bodyText).toMatch(/ChatBridge Login|Sign In/)
})

test('session persists across page navigation', async ({ page }) => {
  // Login
  await deleteUserByEmail(AUTH_TEST_EMAIL_3)
  await page.goto(`${BASE_URL}/login`)
  await page.waitForLoadState('networkidle')
  await page.fill('#email', AUTH_TEST_EMAIL_3)
  await page.fill('#password', TEST_PASSWORD)
  await page.click('button[type="submit"]')
  await page.waitForURL(`${BASE_URL}/`, { timeout: 15000 })

  // Confirm logged in
  let bodyText = await page.textContent('body')
  expect(bodyText).toContain(AUTH_TEST_EMAIL_3)

  // Navigate away and back
  await page.goto(`${BASE_URL}/login`)
  await page.waitForLoadState('networkidle')
  await page.goto(`${BASE_URL}/`)
  await page.waitForLoadState('networkidle')

  // Should still be logged in (session persisted via cookie)
  bodyText = await page.textContent('body')
  expect(bodyText).toContain(AUTH_TEST_EMAIL_3)
})
