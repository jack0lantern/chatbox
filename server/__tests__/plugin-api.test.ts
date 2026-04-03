import { describe, expect, it, beforeEach, vi } from 'vitest'
import { prisma } from '../lib/prisma'
import { GET as getPlugins } from '../app/api/plugins/route'
import { GET as getState, PUT as putState } from '../app/api/plugins/[pluginId]/state/route'
import { getServerSession } from 'next-auth'

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}))

const TEST_USER_ID = 'test-user-plugins'
const mockSession = {
  user: { id: TEST_USER_ID, email: 'test-plugin@test.com', name: 'Test' },
}

describe('plugin API', () => {
  beforeEach(async () => {
    vi.mocked(getServerSession).mockResolvedValue(mockSession)
    await prisma.user.upsert({
      where: { id: TEST_USER_ID },
      update: {},
      create: { id: TEST_USER_ID, email: 'test-plugin@test.com' },
    })
    await prisma.pluginState.deleteMany({ where: { userId: TEST_USER_ID } })
  })

  it('GET /api/plugins returns seeded plugins', async () => {
    const res = await getPlugins(new Request('http://localhost/api/plugins'))
    const data = await res.json()
    expect(data.plugins.length).toBeGreaterThanOrEqual(3)
    const slugs = data.plugins.map((p: any) => p.appSlug)
    expect(slugs).toContain('chess')
    expect(slugs).toContain('timeline')
    expect(slugs).toContain('spotify')
  })

  it('plugin state round-trip', async () => {
    const putRes = await putState(
      new Request('http://localhost/api/plugins/chess/state', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invocationId: 'inv_1', state: { fen: 'starting', score: 0 } }),
      }),
      { params: Promise.resolve({ pluginId: 'chess' }) }
    )
    expect(putRes.status).toBe(200)

    const getRes = await getState(
      new Request('http://localhost/api/plugins/chess/state'),
      { params: Promise.resolve({ pluginId: 'chess' }) }
    )
    const data = await getRes.json()
    expect(data.state).toEqual({ fen: 'starting', score: 0 })
  })

  it('returns 401 without auth', async () => {
    vi.mocked(getServerSession).mockResolvedValue(null)
    const res = await getPlugins(new Request('http://localhost/api/plugins'))
    expect(res.status).toBe(401)
  })
})
