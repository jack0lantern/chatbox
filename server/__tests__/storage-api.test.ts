import { beforeEach, describe, expect, it, vi } from 'vitest'
import { prisma } from '../lib/prisma'

const TEST_USER_ID = 'test-user-storage'

vi.mock('next-auth', () => ({
  getServerSession: vi.fn().mockResolvedValue({
    user: { id: TEST_USER_ID, email: 'test@test.com', name: 'Test' },
  }),
}))

// Import after mock is set up
const { GET: getAll } = await import('../app/api/storage/route')
const { GET, PUT, DELETE } = await import('../app/api/storage/[key]/route')

function makeKeyContext(key: string) {
  return { params: Promise.resolve({ key }) }
}

function makeRequest(body?: unknown): Request {
  return {
    json: () => Promise.resolve(body),
  } as unknown as Request
}

beforeEach(async () => {
  await prisma.userStorage.deleteMany({ where: { userId: TEST_USER_ID } })
  // Ensure the test user exists (UserStorage has a FK constraint on userId)
  await prisma.user.upsert({
    where: { id: TEST_USER_ID },
    update: {},
    create: { id: TEST_USER_ID, email: 'test@test.com', name: 'Test' },
  })
})

describe('Storage API', () => {
  it('PUT and GET a value', async () => {
    const putReq = makeRequest({ value: { theme: 'dark' } })
    const putRes = await PUT(putReq, makeKeyContext('settings'))
    expect(putRes.status).toBe(200)
    const putBody = await putRes.json()
    expect(putBody).toEqual({ ok: true })

    const getRes = await GET(makeRequest(), makeKeyContext('settings'))
    const getBody = await getRes.json()
    expect(getBody).toEqual({ value: { theme: 'dark' } })
  })

  it('GET returns null for missing key', async () => {
    const res = await GET(makeRequest(), makeKeyContext('nonexistent'))
    const body = await res.json()
    expect(body).toEqual({ value: null })
  })

  it('DELETE removes a value', async () => {
    // First PUT a value
    await PUT(makeRequest({ value: 'to-be-deleted' }), makeKeyContext('temp'))

    // Confirm it exists
    const beforeRes = await GET(makeRequest(), makeKeyContext('temp'))
    const beforeBody = await beforeRes.json()
    expect(beforeBody.value).toBe('to-be-deleted')

    // DELETE it
    const delRes = await DELETE(makeRequest(), makeKeyContext('temp'))
    expect(delRes.status).toBe(200)
    const delBody = await delRes.json()
    expect(delBody).toEqual({ ok: true })

    // Confirm it's gone
    const afterRes = await GET(makeRequest(), makeKeyContext('temp'))
    const afterBody = await afterRes.json()
    expect(afterBody).toEqual({ value: null })
  })

  it('GET /api/storage returns all values', async () => {
    await PUT(makeRequest({ value: 'val1' }), makeKeyContext('key1'))
    await PUT(makeRequest({ value: 'val2' }), makeKeyContext('key2'))

    const res = await getAll()
    const body = await res.json()
    expect(body).toEqual({ key1: 'val1', key2: 'val2' })
  })

  it('returns 401 when not authenticated', async () => {
    const { getServerSession } = await import('next-auth')
    vi.mocked(getServerSession).mockResolvedValueOnce(null)

    const res = await GET(makeRequest(), makeKeyContext('settings'))
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body).toEqual({ error: 'Unauthorized' })
  })

  it('overwrites existing value when PUTting same key twice', async () => {
    await PUT(makeRequest({ value: 'original' }), makeKeyContext('overwrite-key'))
    await PUT(makeRequest({ value: 'updated' }), makeKeyContext('overwrite-key'))

    const res = await GET(makeRequest(), makeKeyContext('overwrite-key'))
    const body = await res.json()
    expect(body).toEqual({ value: 'updated' })

    // Confirm only one row exists for this key
    const rows = await prisma.userStorage.findMany({
      where: { userId: TEST_USER_ID, key: 'overwrite-key' },
    })
    expect(rows).toHaveLength(1)
  })

  it('stores and retrieves a JSON object value', async () => {
    const complexObj = { a: 1, b: 'hello', c: true, d: null, e: { nested: 'value' } }
    await PUT(makeRequest({ value: complexObj }), makeKeyContext('json-obj'))

    const res = await GET(makeRequest(), makeKeyContext('json-obj'))
    const body = await res.json()
    expect(body.value).toEqual(complexObj)
  })

  it('stores and retrieves an array value', async () => {
    const arr = [1, 'two', { three: 3 }, [4, 5]]
    await PUT(makeRequest({ value: arr }), makeKeyContext('array-key'))

    const res = await GET(makeRequest(), makeKeyContext('array-key'))
    const body = await res.json()
    expect(body.value).toEqual(arr)
  })

  it('stores and retrieves a deeply nested object', async () => {
    const deep = { level1: { level2: { level3: { level4: 'deep' } } } }
    await PUT(makeRequest({ value: deep }), makeKeyContext('nested-key'))

    const res = await GET(makeRequest(), makeKeyContext('nested-key'))
    const body = await res.json()
    expect(body.value).toEqual(deep)
  })

  it('handles URL-encoded key names with special characters like session:abc-123', async () => {
    const specialKey = 'session:abc-123'
    await PUT(makeRequest({ value: 'session-data' }), makeKeyContext(specialKey))

    const res = await GET(makeRequest(), makeKeyContext(specialKey))
    const body = await res.json()
    expect(body.value).toBe('session-data')
  })

  it('handles keys with slashes and spaces', async () => {
    const slashKey = 'user/settings/theme'
    await PUT(makeRequest({ value: 'light' }), makeKeyContext(slashKey))

    const res = await GET(makeRequest(), makeKeyContext(slashKey))
    const body = await res.json()
    expect(body.value).toBe('light')
  })

  it('GET all returns empty object when no keys exist', async () => {
    const res = await getAll()
    const body = await res.json()
    expect(body).toEqual({})
  })
})
