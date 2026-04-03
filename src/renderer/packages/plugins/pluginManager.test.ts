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

  it('emits invoke event for every invocation including subsequent ones', () => {
    const invokeHandler = vi.fn()
    manager.on('invoke', invokeHandler)

    manager.invoke('chess', 'start_game', { difficulty: 'easy', color: 'white' })
    manager.invoke('chess', 'get_hint', {})

    expect(invokeHandler).toHaveBeenCalledTimes(2)
    expect(invokeHandler).toHaveBeenNthCalledWith(1,
      expect.objectContaining({ pluginSlug: 'chess', toolName: 'start_game' })
    )
    expect(invokeHandler).toHaveBeenNthCalledWith(2,
      expect.objectContaining({ pluginSlug: 'chess', toolName: 'get_hint' })
    )
  })

  it('resolves second invocation independently', async () => {
    const promise1 = manager.invoke('chess', 'start_game', { difficulty: 'easy', color: 'white' })
    const id1 = manager.getLastInvocationId('chess')!

    const promise2 = manager.invoke('chess', 'get_hint', {})
    const id2 = manager.getLastInvocationId('chess')!

    manager.handleTaskComplete(id1, { started: true })
    manager.handleTaskComplete(id2, { hint: 'e2e4' })

    expect(await promise1).toEqual({ started: true })
    expect(await promise2).toEqual({ hint: 'e2e4' })
  })
})
