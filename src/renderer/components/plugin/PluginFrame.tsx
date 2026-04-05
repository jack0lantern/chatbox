// src/renderer/components/plugin/PluginFrame.tsx
import { useCallback, useEffect, useRef, useState } from 'react'
import { PluginBridge } from './PluginBridge'

interface PluginFrameProps {
  pluginId: string
  iframeUrl: string
  allowedOrigins: string[]
  maxHeight: number
  invocationId: string
  toolName: string
  parameters: Record<string, unknown>
  credentials?: { sessionToken: string }
  savedState?: Record<string, unknown> | null
  onStateUpdate?: (invocationId: string, state: Record<string, unknown>) => void
  onTaskComplete?: (invocationId: string, result: Record<string, unknown>) => void
  onError?: (invocationId: string, code: string, message: string, recoverable: boolean) => void
}

type FrameStatus = 'loading' | 'ready' | 'active' | 'complete' | 'error' | 'timeout'

export default function PluginFrame({
  pluginId,
  iframeUrl,
  allowedOrigins,
  maxHeight,
  invocationId,
  toolName,
  parameters,
  credentials,
  savedState,
  onStateUpdate,
  onTaskComplete,
  onError,
}: PluginFrameProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const bridgeRef = useRef<PluginBridge | null>(null)
  const [status, setStatus] = useState<FrameStatus>('loading')
  const [errorMessage, setErrorMessage] = useState<string>('')

  const handleReady = useCallback(() => {
    setStatus('ready')

    // Restore state if available
    if (savedState && bridgeRef.current) {
      bridgeRef.current.sendStateRestore(invocationId, savedState)
    }

    // Send the tool invocation
    if (bridgeRef.current) {
      bridgeRef.current.sendInvokeTool(invocationId, toolName, parameters, credentials)
      setStatus('active')
    }
  }, [invocationId, toolName, parameters, credentials, savedState])

  const handleStateUpdate = useCallback(
    (invId: string, state: Record<string, unknown>) => {
      onStateUpdate?.(invId, state)
    },
    [onStateUpdate]
  )

  const handleTaskComplete = useCallback(
    (invId: string, result: Record<string, unknown>) => {
      setStatus('complete')
      onTaskComplete?.(invId, result)
    },
    [onTaskComplete]
  )

  const handleError = useCallback(
    (invId: string, code: string, message: string, recoverable: boolean) => {
      setStatus('error')
      setErrorMessage(message)
      onError?.(invId, code, message, recoverable)
    },
    [onError]
  )

  const handleTimeout = useCallback((type: 'ready' | 'taskComplete', invId: string | null) => {
    setStatus('timeout')
    setErrorMessage(type === 'ready' ? 'Plugin failed to load' : 'Plugin timed out')
  }, [])

  useEffect(() => {
    const iframe = iframeRef.current
    if (!iframe) return

    const bridge = new PluginBridge({
      iframe,
      allowedOrigins,
      onReady: handleReady,
      onStateUpdate: handleStateUpdate,
      onTaskComplete: handleTaskComplete,
      onError: handleError,
      onTimeout: handleTimeout,
    })
    bridgeRef.current = bridge

    return () => {
      bridge.sendDestroy(invocationId)
      bridge.destroy()
      bridgeRef.current = null
    }
  }, [iframeUrl]) // Only recreate bridge if iframe URL changes

  // Allow sending additional INVOKE_TOOL messages to a running iframe
  useEffect(() => {
    if (status === 'active' || status === 'complete') {
      bridgeRef.current?.sendInvokeTool(invocationId, toolName, parameters, credentials)
    }
  }, [invocationId]) // New invocationId = new tool call to running iframe

  if (status === 'timeout' || status === 'error') {
    return (
      <div style={{
        padding: 16,
        border: '1px solid #e0e0e0',
        borderRadius: 8,
        background: '#fafafa',
        color: '#666',
        textAlign: 'center',
      }}>
        {errorMessage || 'Plugin encountered an error'}
      </div>
    )
  }

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      {status === 'loading' && (
        <div style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#fafafa',
          borderRadius: 8,
          zIndex: 1,
        }}>
          Loading plugin...
        </div>
      )}
      <iframe
        ref={iframeRef}
        src={iframeUrl}
        sandbox="allow-scripts allow-same-origin"
        style={{
          width: '100%',
          maxHeight,
          minHeight: 200,
          border: '1px solid #e0e0e0',
          borderRadius: 8,
        }}
      />
    </div>
  )
}
