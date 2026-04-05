// src/renderer/components/plugin/PluginBridge.ts
import type {
  IframeMessage,
  InvokeToolMessage,
  StateRestoreMessage,
  DestroyMessage,
  ParentMessage,
} from '@/packages/plugin-types'

export interface PluginBridgeConfig {
  iframe: HTMLIFrameElement
  allowedOrigins: string[]
  onReady: () => void
  onStateUpdate: (invocationId: string, state: Record<string, unknown>) => void
  onTaskComplete: (invocationId: string, result: Record<string, unknown>) => void
  onError: (invocationId: string, code: string, message: string, recoverable: boolean) => void
  onTimeout: (type: 'ready' | 'taskComplete', invocationId: string | null) => void
  readyTimeout?: number
  taskCompleteTimeout?: number
}

export class PluginBridge {
  private iframe: HTMLIFrameElement
  private allowedOrigins: Set<string>
  private config: PluginBridgeConfig
  private readyTimer: ReturnType<typeof setTimeout> | null = null
  private taskCompleteTimers: Map<string, ReturnType<typeof setTimeout>> = new Map()
  private listener: ((event: MessageEvent) => void) | null = null
  private isReady = false

  constructor(config: PluginBridgeConfig) {
    this.iframe = config.iframe
    this.allowedOrigins = new Set(config.allowedOrigins)
    // The iframe may be served through a proxy (same origin as the renderer),
    // so always accept messages from the current page's origin.
    this.allowedOrigins.add(window.location.origin)
    this.config = config

    this.listener = this.handleMessage.bind(this)
    window.addEventListener('message', this.listener)

    // Start READY timeout
    this.readyTimer = setTimeout(() => {
      if (!this.isReady) {
        this.config.onTimeout('ready', null)
      }
    }, config.readyTimeout ?? 5000)
  }

  private handleMessage(event: MessageEvent) {
    // Validate origin
    if (!this.allowedOrigins.has(event.origin)) return

    const data = event.data as IframeMessage
    if (!data?.type) return

    switch (data.type) {
      case 'READY':
        this.isReady = true
        if (this.readyTimer) {
          clearTimeout(this.readyTimer)
          this.readyTimer = null
        }
        this.config.onReady()
        break

      case 'STATE_UPDATE':
        if (data.invocationId) {
          this.config.onStateUpdate(data.invocationId, data.payload.state)
        }
        break

      case 'TASK_COMPLETE':
        if (data.invocationId) {
          // Clear task complete timeout
          const timer = this.taskCompleteTimers.get(data.invocationId)
          if (timer) {
            clearTimeout(timer)
            this.taskCompleteTimers.delete(data.invocationId)
          }
          this.config.onTaskComplete(data.invocationId, data.payload.result)
        }
        break

      case 'ERROR':
        if (data.invocationId) {
          const timer = this.taskCompleteTimers.get(data.invocationId)
          if (timer) {
            clearTimeout(timer)
            this.taskCompleteTimers.delete(data.invocationId)
          }
          this.config.onError(
            data.invocationId,
            data.payload.code,
            data.payload.message,
            data.payload.recoverable
          )
        }
        break
    }
  }

  sendInvokeTool(invocationId: string, toolName: string, parameters: Record<string, unknown>, credentials?: { sessionToken: string }) {
    const message: InvokeToolMessage = {
      type: 'INVOKE_TOOL',
      invocationId,
      payload: { toolName, parameters, ...(credentials ? { credentials } : {}) },
    }
    this.postMessage(message)

    // Start task complete timeout
    const timeout = this.config.taskCompleteTimeout ?? 10000
    const timer = setTimeout(() => {
      this.taskCompleteTimers.delete(invocationId)
      this.config.onTimeout('taskComplete', invocationId)
    }, timeout)
    this.taskCompleteTimers.set(invocationId, timer)
  }

  sendStateRestore(invocationId: string, state: Record<string, unknown>) {
    const message: StateRestoreMessage = {
      type: 'STATE_RESTORE',
      invocationId,
      payload: { state },
    }
    this.postMessage(message)
  }

  sendDestroy(invocationId: string) {
    const message: DestroyMessage = {
      type: 'DESTROY',
      invocationId,
      payload: {} as Record<string, never>,
    }
    this.postMessage(message)
  }

  private postMessage(message: ParentMessage) {
    if (this.iframe.contentWindow) {
      this.iframe.contentWindow.postMessage(message, '*')
    }
  }

  destroy() {
    if (this.listener) {
      window.removeEventListener('message', this.listener)
      this.listener = null
    }
    if (this.readyTimer) {
      clearTimeout(this.readyTimer)
    }
    for (const timer of this.taskCompleteTimers.values()) {
      clearTimeout(timer)
    }
    this.taskCompleteTimers.clear()
  }
}
