import { test, expect } from '@playwright/test'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient({
  datasources: { db: { url: 'postgresql://postgres:postgres@127.0.0.1:54322/chatbridge' } },
})

const BASE_URL = 'http://localhost:3000'
const TEST_PASSWORD = 'password-llm-e2e-321'

const EMAIL_LLM_AUTH = 'test-llm-auth@test.com'
const EMAIL_LLM_NOKEY = 'test-llm-nokey@test.com'

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
  await deleteUserByEmail(EMAIL_LLM_AUTH)
  await deleteUserByEmail(EMAIL_LLM_NOKEY)
  await prisma.$disconnect()
})

test('POST /api/chat/completions without auth returns 401', async ({ browser }) => {
  // Use a fresh context with no session cookies
  const context = await browser.newContext()
  const res = await context.request.post(`${BASE_URL}/api/chat/completions`, {
    data: {
      provider: 'openai',
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'hello' }],
    },
  })
  expect(res.status()).toBe(401)
  const body = await res.json()
  expect(body.error).toMatch(/unauthorized/i)
  await context.close()
})

test('POST /api/chat/completions with missing fields returns 400', async ({ page }) => {
  await deleteUserByEmail(EMAIL_LLM_AUTH)
  await loginAndGetCookies(page, EMAIL_LLM_AUTH)

  // Missing model and messages
  const res = await page.request.post(`${BASE_URL}/api/chat/completions`, {
    data: { provider: 'openai' },
  })
  expect(res.status()).toBe(400)
  const body = await res.json()
  expect(body.error).toMatch(/missing required fields/i)
})

test('POST /api/chat/completions with no API key configured returns 400 with message', async ({ page }) => {
  await deleteUserByEmail(EMAIL_LLM_NOKEY)
  await loginAndGetCookies(page, EMAIL_LLM_NOKEY)

  // User has no API keys stored — should get 400 about missing key
  const res = await page.request.post(`${BASE_URL}/api/chat/completions`, {
    data: {
      provider: 'openai',
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'hello' }],
    },
  })
  expect(res.status()).toBe(400)
  const body = await res.json()
  expect(body.error).toMatch(/no api key configured/i)
})
