import { test, expect } from '@playwright/test'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient({
  datasources: { db: { url: 'postgresql://postgres:postgres@127.0.0.1:54322/chatbridge' } },
})

const BASE_URL = 'http://localhost:3000'
const TEST_PASSWORD = 'password-plugins-e2e-789'

const EMAIL_PLUGIN_LIST = 'test-plugins-list@test.com'
const EMAIL_PLUGIN_STATE = 'test-plugins-state@test.com'
const EMAIL_PLUGIN_ISOLATION_A = 'test-plugins-isolation-a@test.com'
const EMAIL_PLUGIN_ISOLATION_B = 'test-plugins-isolation-b@test.com'

async function deleteUserByEmail(email: string) {
  try {
    await prisma.user.deleteMany({ where: { email } })
  } catch {}
}

async function loginAndGetCookies(page: import('@playwright/test').Page, email: string) {
  await page.goto(`${BASE_URL}/login`)
  await page.waitForLoadState('networkidle')
  await page.fill('#email', email)
  await page.fill('#password', TEST_PASSWORD)
  await page.click('button[type="submit"]')
  await page.waitForURL(`${BASE_URL}/`, { timeout: 15000 })
}

test.afterAll(async () => {
  await deleteUserByEmail(EMAIL_PLUGIN_LIST)
  await deleteUserByEmail(EMAIL_PLUGIN_STATE)
  await deleteUserByEmail(EMAIL_PLUGIN_ISOLATION_A)
  await deleteUserByEmail(EMAIL_PLUGIN_ISOLATION_B)
  await prisma.$disconnect()
})

test('GET /api/plugins without auth returns 401', async ({ page }) => {
  // Make an unauthenticated request (no session cookie)
  const context = await page.context().browser()!.newContext()
  const res = await context.request.get(`${BASE_URL}/api/plugins`)
  expect(res.status()).toBe(401)
  await context.close()
})

test('login then GET /api/plugins returns array with chess, timeline, spotify', async ({ page }) => {
  await deleteUserByEmail(EMAIL_PLUGIN_LIST)
  await loginAndGetCookies(page, EMAIL_PLUGIN_LIST)

  const res = await page.request.get(`${BASE_URL}/api/plugins`)
  expect(res.status()).toBe(200)

  const data = await res.json()
  expect(Array.isArray(data.plugins)).toBe(true)
  expect(data.plugins.length).toBeGreaterThanOrEqual(3)

  const slugs = data.plugins.map((p: any) => p.appSlug)
  expect(slugs).toContain('chess')
  expect(slugs).toContain('timeline')
  expect(slugs).toContain('spotify')
})

test('login, PUT plugin state for chess, GET it back, verify match', async ({ page }) => {
  await deleteUserByEmail(EMAIL_PLUGIN_STATE)
  await loginAndGetCookies(page, EMAIL_PLUGIN_STATE)

  const statePayload = { fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR', turn: 'b', moveCount: 1 }

  // PUT state
  const putRes = await page.request.put(`${BASE_URL}/api/plugins/chess/state`, {
    data: { invocationId: 'e2e-inv-1', state: statePayload },
  })
  expect(putRes.status()).toBe(200)
  const putBody = await putRes.json()
  expect(putBody.ok).toBe(true)

  // GET state back
  const getRes = await page.request.get(`${BASE_URL}/api/plugins/chess/state`)
  expect(getRes.status()).toBe(200)
  const getBody = await getRes.json()
  expect(getBody.state).toEqual(statePayload)
})

test('plugin state isolation: user A stores state, user B cannot see it', async ({ browser }) => {
  await deleteUserByEmail(EMAIL_PLUGIN_ISOLATION_A)
  await deleteUserByEmail(EMAIL_PLUGIN_ISOLATION_B)

  const stateA = { board: 'user-a-secret-board', score: 42 }

  // User A: login in fresh context, store state
  const contextA = await browser.newContext()
  const pageA = await contextA.newPage()
  await loginAndGetCookies(pageA, EMAIL_PLUGIN_ISOLATION_A)

  const putRes = await pageA.request.put(`${BASE_URL}/api/plugins/chess/state`, {
    data: { invocationId: 'e2e-isolation-inv', state: stateA },
  })
  expect(putRes.status()).toBe(200)

  // Verify user A can read it back
  const getResA = await pageA.request.get(`${BASE_URL}/api/plugins/chess/state`)
  const bodyA = await getResA.json()
  expect(bodyA.state).toEqual(stateA)

  await contextA.close()

  // User B: login in a completely separate browser context
  const contextB = await browser.newContext()
  const pageB = await contextB.newPage()
  await loginAndGetCookies(pageB, EMAIL_PLUGIN_ISOLATION_B)

  // User B should NOT see user A's chess state
  const getResB = await pageB.request.get(`${BASE_URL}/api/plugins/chess/state`)
  expect(getResB.status()).toBe(200)
  const bodyB = await getResB.json()
  expect(bodyB.state).toBeNull()

  await contextB.close()
})
