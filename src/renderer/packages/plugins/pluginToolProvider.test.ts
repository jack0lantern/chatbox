import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PluginToolProvider } from './pluginToolProvider'
import { PluginManager } from './pluginManager'

const mockPlugins = [
  {
    appSlug: 'chess',
    appName: 'Chess',
    description: 'Play chess against an AI opponent.',
    iframeUrl: '/plugins/chess/index.html',
    authPattern: 'internal',
    toolSchemas: [
      {
        name: 'start_game',
        description: 'Start a new chess game',
        parameters: {
          type: 'object',
          properties: {
            difficulty: { type: 'string', enum: ['easy', 'medium', 'hard'] },
            color: { type: 'string', enum: ['white', 'black', 'random'] },
          },
          required: ['difficulty', 'color'],
        },
      },
      {
        name: 'get_hint',
        description: 'Get a hint',
        parameters: { type: 'object', properties: {} },
      },
    ],
    permissions: {
      maxIframeHeight: 600,
      allowedOrigins: ['http://localhost:3000'],
      timeouts: { ready: 10, taskComplete: 30 },
    },
  },
]

describe('PluginToolProvider', () => {
  let provider: PluginToolProvider
  let manager: PluginManager
  let fetchFn: ReturnType<typeof vi.fn>

  beforeEach(() => {
    manager = new PluginManager()
    fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockPlugins),
    })
    provider = new PluginToolProvider(manager, fetchFn)
  })

  it('returns empty tool set before loading', () => {
    expect(provider.getAvailableTools()).toEqual({})
  })

  it('loads plugins and creates namespaced tools', async () => {
    await provider.loadPlugins('http://localhost:3000')

    const tools = provider.getAvailableTools()
    expect(tools).toHaveProperty('plugin__chess__start_game')
    expect(tools).toHaveProperty('plugin__chess__get_hint')
    expect(Object.keys(tools)).toHaveLength(2)
  })

  it('tool execute delegates to pluginManager.invoke', async () => {
    await provider.loadPlugins('http://localhost:3000')

    const invokeSpy = vi.spyOn(manager, 'invoke').mockResolvedValue({ started: true })

    const tools = provider.getAvailableTools()
    const result = await tools['plugin__chess__start_game'].execute!(
      { difficulty: 'easy', color: 'white' },
      { toolCallId: 'tc_1', messages: [], abortSignal: new AbortController().signal }
    )

    expect(invokeSpy).toHaveBeenCalledWith('chess', 'start_game', { difficulty: 'easy', color: 'white' })
    expect(result).toEqual({ started: true })
  })

  it('returns plugin metadata by tool name', async () => {
    await provider.loadPlugins('http://localhost:3000')

    const meta = provider.getPluginForTool('plugin__chess__start_game')
    expect(meta).toEqual(expect.objectContaining({ appSlug: 'chess', appName: 'Chess' }))
  })

  it('returns undefined for unknown tool names', () => {
    expect(provider.getPluginForTool('unknown_tool')).toBeUndefined()
  })
})
