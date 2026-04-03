import { test, expect } from '@playwright/test'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient({
  datasources: { db: { url: 'postgresql://postgres:postgres@127.0.0.1:54322/chatbridge' } },
})

const BASE_URL = 'http://localhost:3000'
const TEST_PASSWORD = 'password-storage-test-456'

// Unique emails per test
const EMAIL_ROUNDTRIP = 'test-storage-roundtrip@test.com'
const EMAIL_MULTI = 'test-storage-multi@test.com'
const EMAIL_ISOLATION_A = 'test-storage-user-a@test.com'
const EMAIL_ISOLATION_B = 'test-storage-user-b@test.com'

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
  await deleteUserByEmail(EMAIL_ROUNDTRIP)
  await deleteUserByEmail(EMAIL_MULTI)
  await deleteUserByEmail(EMAIL_ISOLATION_A)
  await deleteUserByEmail(EMAIL_ISOLATION_B)
  await prisma.$disconnect()
})

test('full round-trip: PUT a setting, GET it back, DELETE it, verify gone', async ({ page }) => {
  await deleteUserByEmail(EMAIL_ROUNDTRIP)

  // Login via browser to establish session cookie
  await loginAndGetCookies(page, EMAIL_ROUNDTRIP)

  const testKey = 'round-trip-setting'
  const testValue = { theme: 'dark', fontSize: 14, notifications: true }

  // PUT value using authenticated request context (inherits browser cookies)
  const putRes = await page.request.put(`${BASE_URL}/api/storage/${testKey}`, {
    data: { value: testValue },
  })
  expect(putRes.status()).toBe(200)
  const putBody = await putRes.json()
  expect(putBody).toEqual({ ok: true })

  // GET the value back
  const getRes = await page.request.get(`${BASE_URL}/api/storage/${testKey}`)
  expect(getRes.status()).toBe(200)
  const getBody = await getRes.json()
  expect(getBody.value).toEqual(testValue)

  // DELETE the value
  const delRes = await page.request.delete(`${BASE_URL}/api/storage/${testKey}`)
  expect(delRes.status()).toBe(200)
  const delBody = await delRes.json()
  expect(delBody).toEqual({ ok: true })

  // Verify it's gone
  const afterRes = await page.request.get(`${BASE_URL}/api/storage/${testKey}`)
  expect(afterRes.status()).toBe(200)
  const afterBody = await afterRes.json()
  expect(afterBody).toEqual({ value: null })
})

test('multiple keys: store several keys, GET all, verify all present', async ({ page }) => {
  await deleteUserByEmail(EMAIL_MULTI)
  await loginAndGetCookies(page, EMAIL_MULTI)

  const keys = ['setting-a', 'setting-b', 'setting-c']
  const values = ['value-a', 42, { nested: true }]

  // PUT all keys
  for (let i = 0; i < keys.length; i++) {
    const res = await page.request.put(`${BASE_URL}/api/storage/${keys[i]}`, {
      data: { value: values[i] },
    })
    expect(res.status()).toBe(200)
  }

  // GET all via the list endpoint
  const allRes = await page.request.get(`${BASE_URL}/api/storage`)
  expect(allRes.status()).toBe(200)
  const allBody = await allRes.json()

  expect(allBody['setting-a']).toBe('value-a')
  expect(allBody['setting-b']).toBe(42)
  expect(allBody['setting-c']).toEqual({ nested: true })
})

test('storage isolation: user A data not visible to user B', async ({ browser }) => {
  await deleteUserByEmail(EMAIL_ISOLATION_A)
  await deleteUserByEmail(EMAIL_ISOLATION_B)

  const isolatedKey = 'secret-key-user-a'
  const isolatedValue = 'only-user-a-should-see-this'

  // User A: login in a fresh browser context and store a value
  const contextA = await browser.newContext()
  const pageA = await contextA.newPage()
  await loginAndGetCookies(pageA, EMAIL_ISOLATION_A)
  const putRes = await pageA.request.put(`${BASE_URL}/api/storage/${isolatedKey}`, {
    data: { value: isolatedValue },
  })
  expect(putRes.status()).toBe(200)

  // Verify user A can read it back
  const getResA = await pageA.request.get(`${BASE_URL}/api/storage/${isolatedKey}`)
  const getBodyA = await getResA.json()
  expect(getBodyA.value).toBe(isolatedValue)

  await contextA.close()

  // User B: login in a completely separate browser context
  const contextB = await browser.newContext()
  const pageB = await contextB.newPage()
  await loginAndGetCookies(pageB, EMAIL_ISOLATION_B)

  // User B should NOT see user A's key
  const getResB = await pageB.request.get(`${BASE_URL}/api/storage/${isolatedKey}`)
  expect(getResB.status()).toBe(200)
  const getBodyB = await getResB.json()
  expect(getBodyB.value).toBeNull()

  // GET all for user B should also not contain user A's key
  const allResB = await pageB.request.get(`${BASE_URL}/api/storage`)
  expect(allResB.status()).toBe(200)
  const allBodyB = await allResB.json()
  expect(allBodyB[isolatedKey]).toBeUndefined()

  await contextB.close()
})
