type EventType = 'mount' | 'unmount' | 'invoke'

interface MountEvent {
  pluginSlug: string
  toolName: string
  parameters: Record<string, unknown>
}

interface InvokeEvent {
  pluginSlug: string
  invocationId: string
  toolName: string
  parameters: Record<string, unknown>
}

interface UnmountEvent {
  pluginSlug: string
}

type EventPayload = MountEvent | InvokeEvent | UnmountEvent
type EventHandler = (payload: EventPayload) => void

interface PendingInvocation {
  invocationId: string
  resolve: (result: Record<string, unknown>) => void
  reject: (error: Error) => void
}

interface PluginSession {
  pluginSlug: string
  pendingInvocations: Map<string, PendingInvocation>
  lastInvocationId: string | null
}

let invocationCounter = 0
function generateInvocationId(): string {
  return `inv_${Date.now()}_${++invocationCounter}`
}

export class PluginManager {
  private sessions: Map<string, PluginSession> = new Map()
  private listeners: Map<EventType, Set<EventHandler>> = new Map()

  on(event: EventType, handler: EventHandler): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set())
    }
    this.listeners.get(event)!.add(handler)
    return () => {
      this.listeners.get(event)?.delete(handler)
    }
  }

  private emit(event: EventType, payload: EventPayload): void {
    const handlers = this.listeners.get(event)
    if (handlers) {
      for (const handler of handlers) {
        handler(payload)
      }
    }
  }

  invoke(
    pluginSlug: string,
    toolName: string,
    parameters: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const invocationId = generateInvocationId()

    let session = this.sessions.get(pluginSlug)
    const needsMount = !session

    if (!session) {
      session = {
        pluginSlug,
        pendingInvocations: new Map(),
        lastInvocationId: null,
      }
      this.sessions.set(pluginSlug, session)
    }

    session.lastInvocationId = invocationId

    const promise = new Promise<Record<string, unknown>>((resolve, reject) => {
      session!.pendingInvocations.set(invocationId, { invocationId, resolve, reject })
    })

    if (needsMount) {
      this.emit('mount', { pluginSlug, toolName, parameters })
    }

    // Always emit invoke so the container can send INVOKE_TOOL to the iframe
    this.emit('invoke', { pluginSlug, invocationId, toolName, parameters })

    return promise
  }

  handleTaskComplete(invocationId: string, result: Record<string, unknown>): void {
    for (const session of this.sessions.values()) {
      const pending = session.pendingInvocations.get(invocationId)
      if (pending) {
        pending.resolve(result)
        session.pendingInvocations.delete(invocationId)
        return
      }
    }
  }

  handleError(invocationId: string, _code: string, message: string, _recoverable: boolean): void {
    for (const session of this.sessions.values()) {
      const pending = session.pendingInvocations.get(invocationId)
      if (pending) {
        pending.reject(new Error(message))
        session.pendingInvocations.delete(invocationId)
        return
      }
    }
  }

  handleStateUpdate(_invocationId: string, _state: Record<string, unknown>): void {
    // Actual persistence is handled in PluginContainer via fetch to the backend API.
  }

  destroySession(pluginSlug: string): void {
    const session = this.sessions.get(pluginSlug)
    if (!session) return

    for (const pending of session.pendingInvocations.values()) {
      pending.reject(new Error('Plugin session destroyed'))
    }

    this.sessions.delete(pluginSlug)
    this.emit('unmount', { pluginSlug })
  }

  hasActiveSession(pluginSlug: string): boolean {
    return this.sessions.has(pluginSlug)
  }

  getLastInvocationId(pluginSlug: string): string | null {
    return this.sessions.get(pluginSlug)?.lastInvocationId ?? null
  }

  getSession(pluginSlug: string): PluginSession | undefined {
    return this.sessions.get(pluginSlug)
  }
}

export const pluginManager = new PluginManager()
