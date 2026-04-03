// src/renderer/packages/plugin-types.ts

// Message types
export type ParentMessageType = 'INVOKE_TOOL' | 'STATE_RESTORE' | 'DESTROY'
export type IframeMessageType = 'READY' | 'STATE_UPDATE' | 'TASK_COMPLETE' | 'ERROR'
export type PluginMessageType = ParentMessageType | IframeMessageType

// Error codes
export type PluginErrorCode = 'INVALID_PARAMS' | 'RENDER_FAILED' | 'UPSTREAM_ERROR' | 'INTERNAL_ERROR'

// Message envelope
export interface PluginMessage {
  type: PluginMessageType
  invocationId: string | null
  payload: Record<string, unknown>
}

// Parent → Iframe messages
export interface InvokeToolMessage {
  type: 'INVOKE_TOOL'
  invocationId: string
  payload: {
    toolName: string
    parameters: Record<string, unknown>
    credentials?: {
      sessionToken: string
    }
  }
}

export interface StateRestoreMessage {
  type: 'STATE_RESTORE'
  invocationId: string
  payload: {
    state: Record<string, unknown>
  }
}

export interface DestroyMessage {
  type: 'DESTROY'
  invocationId: string
  payload: Record<string, never>
}

// Iframe → Parent messages
export interface ReadyMessage {
  type: 'READY'
  invocationId: null
  payload: Record<string, never>
}

export interface StateUpdateMessage {
  type: 'STATE_UPDATE'
  invocationId: string
  payload: {
    state: Record<string, unknown>
  }
}

export interface TaskCompleteMessage {
  type: 'TASK_COMPLETE'
  invocationId: string
  payload: {
    result: Record<string, unknown>
  }
}

export interface ErrorMessage {
  type: 'ERROR'
  invocationId: string
  payload: {
    code: PluginErrorCode
    message: string
    recoverable: boolean
  }
}

export type ParentMessage = InvokeToolMessage | StateRestoreMessage | DestroyMessage
export type IframeMessage = ReadyMessage | StateUpdateMessage | TaskCompleteMessage | ErrorMessage
