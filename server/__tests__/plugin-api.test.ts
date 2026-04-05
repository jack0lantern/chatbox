import { describe, expect, it, beforeEach, vi } from 'vitest'
import { prisma } from '../lib/prisma'
import { bundledPlugins } from '../lib/plugin-seed'
import { GET as getPlugins } from '../app/api/plugins/route'
import { GET as getState, PUT as putState } from '../app/api/plugins/[pluginId]/state/route'
import { getServerSession } from 'next-auth'

function pluginsFromResponse(data: unknown) {
  if (Array.isArray(data)) return data
  if (data && typeof data === 'object' && 'plugins' in data && Array.isArray((data as { plugins: unknown }).plugins)) {
    return (data as { plugins: unknown[] }).plugins
  }
  return []
}

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
    for (const plugin of bundledPlugins) {
      await prisma.pluginRegistration.updateMany({
        where: { appSlug: plugin.appSlug },
        data: {
          appName: plugin.appName,
          description: plugin.description,
          iframeUrl: plugin.iframeUrl,
          authPattern: plugin.authPattern,
          oauthProvider: plugin.oauthProvider ?? null,
          toolSchemas: plugin.toolSchemas,
          permissions: plugin.permissions,
        },
      })
    }
  })

  it('GET /api/plugins returns seeded plugins', async () => {
    const res = await getPlugins(new Request('http://localhost/api/plugins'))
    const data = await res.json()
    const plugins = pluginsFromResponse(data)
    expect(plugins.length).toBeGreaterThanOrEqual(3)
    const slugs = plugins.map((p: any) => p.appSlug)
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

  it('GET /api/plugins is public (no session required)', async () => {
    vi.mocked(getServerSession).mockResolvedValue(null)
    const res = await getPlugins(new Request('http://localhost/api/plugins'))
    expect(res.status).toBe(200)
    const plugins = pluginsFromResponse(await res.json())
    expect(plugins.length).toBeGreaterThanOrEqual(1)
  })

  it('GET /api/plugins excludes unreliable plugins', async () => {
    // Set chess plugin status to unreliable
    await prisma.pluginRegistration.updateMany({
      where: { appSlug: 'chess' },
      data: { status: 'unreliable' },
    })
    try {
      const res = await getPlugins(new Request('http://localhost/api/plugins'))
      const data = await res.json()
      const slugs = pluginsFromResponse(data).map((p: any) => p.appSlug)
      expect(slugs).not.toContain('chess')
      // Other active plugins still present
      expect(slugs).toContain('timeline')
      expect(slugs).toContain('spotify')
    } finally {
      // Restore chess to active
      await prisma.pluginRegistration.updateMany({
        where: { appSlug: 'chess' },
        data: { status: 'active' },
      })
    }
  })

  it('plugin state overwrite: PUT same pluginId+invocationId twice, verify latest state', async () => {
    // First PUT
    await putState(
      new Request('http://localhost/api/plugins/chess/state', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invocationId: 'inv_overwrite', state: { score: 1 } }),
      }),
      { params: Promise.resolve({ pluginId: 'chess' }) }
    )

    // Second PUT with same invocationId but different state
    const putRes = await putState(
      new Request('http://localhost/api/plugins/chess/state', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invocationId: 'inv_overwrite', state: { score: 99 } }),
      }),
      { params: Promise.resolve({ pluginId: 'chess' }) }
    )
    expect(putRes.status).toBe(200)

    const getRes = await getState(
      new Request('http://localhost/api/plugins/chess/state'),
      { params: Promise.resolve({ pluginId: 'chess' }) }
    )
    const data = await getRes.json()
    expect(data.state).toEqual({ score: 99 })
  })

  it('GET plugin state returns null when no state exists', async () => {
    // No PUT performed — pluginState was cleared in beforeEach
    const getRes = await getState(
      new Request('http://localhost/api/plugins/chess/state'),
      { params: Promise.resolve({ pluginId: 'chess' }) }
    )
    expect(getRes.status).toBe(200)
    const data = await getRes.json()
    expect(data.state).toBeNull()
  })

  it('PUT plugin state returns 401 without auth', async () => {
    vi.mocked(getServerSession).mockResolvedValue(null)
    const res = await putState(
      new Request('http://localhost/api/plugins/chess/state', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invocationId: 'inv_unauth', state: { x: 1 } }),
      }),
      { params: Promise.resolve({ pluginId: 'chess' }) }
    )
    expect(res.status).toBe(401)
  })

  it('chess plugin toolSchemas includes get_game_state', async () => {
    const res = await getPlugins(new Request('http://localhost/api/plugins'))
    const data = await res.json()
    const plugins = pluginsFromResponse(data)
    const chess = plugins.find((p: any) => p.appSlug === 'chess')
    expect(chess).toBeTruthy()
    expect(Array.isArray(chess.toolSchemas)).toBe(true)
    const toolNames = chess.toolSchemas.map((t: any) => t.name)
    expect(toolNames).toContain('get_game_state')
  })

  it('timeline plugin toolSchemas includes get_game_state, not get_hint', async () => {
    const res = await getPlugins(new Request('http://localhost/api/plugins'))
    const data = await res.json()
    const plugins = pluginsFromResponse(data)
    const timeline = plugins.find((p: any) => p.appSlug === 'timeline')
    expect(timeline).toBeTruthy()
    const toolNames = timeline.toolSchemas.map((t: any) => t.name)
    expect(toolNames).toContain('get_game_state')
    expect(toolNames).not.toContain('get_hint')
  })
})
