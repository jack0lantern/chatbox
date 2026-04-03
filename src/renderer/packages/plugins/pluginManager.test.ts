import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PluginManager } from './pluginManager'

describe('PluginManager', () => {
  let manager: PluginManager

  beforeEach(() => {
    manager = new PluginManager()
  })

  it('emits mount event when invoking a plugin with no active session', () => {
    const mountHandler = vi.fn()
    manager.on('mount', mountHandler)

    manager.invoke('chess', 'start_game', { difficulty: 'easy', color: 'white' })

    expect(mountHandler).toHaveBeenCalledWith(
      expect.objectContaining({ pluginSlug: 'chess' })
    )
  })

  it('does not emit mount if session already active', () => {
    const mountHandler = vi.fn()
    manager.on('mount', mountHandler)

    manager.invoke('chess', 'start_game', { difficulty: 'easy', color: 'white' })
    manager.invoke('chess', 'get_hint', {})

    expect(mountHandler).toHaveBeenCalledTimes(1)
  })

  it('resolves invoke promise when handleTaskComplete is called', async () => {
    const promise = manager.invoke('chess', 'start_game', { difficulty: 'easy', color: 'white' })

    const invocationId = manager.getLastInvocationId('chess')!
    manager.handleTaskComplete(invocationId, { started: true })

    const result = await promise
    expect(result).toEqual({ started: true })
  })

  it('rejects invoke promise when handleError is called', async () => {
    const promise = manager.invoke('chess', 'start_game', { difficulty: 'easy', color: 'white' })

    const invocationId = manager.getLastInvocationId('chess')!
    manager.handleError(invocationId, 'INTERNAL_ERROR', 'No active game', false)

    await expect(promise).rejects.toThrow('No active game')
  })

  it('emits unmount event when destroy is called', () => {
    const unmountHandler = vi.fn()
    manager.on('unmount', unmountHandler)

    manager.invoke('chess', 'start_game', { difficulty: 'easy', color: 'white' }).catch(() => {})
    manager.destroySession('chess')

    expect(unmountHandler).toHaveBeenCalledWith(
      expect.objectContaining({ pluginSlug: 'chess' })
    )
  })

  it('cleans up session on destroy', () => {
    manager.invoke('chess', 'start_game', { difficulty: 'easy', color: 'white' }).catch(() => {})
    manager.destroySession('chess')

    expect(manager.hasActiveSession('chess')).toBe(false)
  })
})
