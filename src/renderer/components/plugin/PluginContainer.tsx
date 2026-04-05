import { ActionIcon, Group, Text, UnstyledButton } from '@mantine/core'
import { IconX } from '@tabler/icons-react'
import { useSetAtom } from 'jotai'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useSidebarWidth } from '@/hooks/useScreenChange'
import { pluginManager } from '@/packages/plugins/pluginManager'
import type { PluginDefinition } from '@/packages/plugins/pluginToolProvider'
import { pluginToolProviderInstance } from '@/packages/plugins/pluginToolProvider'
import { pluginActiveAtom } from '@/stores/atoms/uiAtoms'
import { useUIStore } from '@/stores/uiStore'
import { PluginBridge } from './PluginBridge'

interface ActivePlugin {
  pluginSlug: string
  plugin: PluginDefinition
}

export default function PluginContainer() {
  const [activePlugin, setActivePlugin] = useState<ActivePlugin | null>(null)
  const activePluginRef = useRef<ActivePlugin | null>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const bridgeRef = useRef<PluginBridge | null>(null)
  const setPluginActive = useSetAtom(pluginActiveAtom)

  // Queue of tool invocations waiting for the bridge to be ready
  const pendingInvocationsRef = useRef<Array<{
    invocationId: string
    toolName: string
    parameters: Record<string, unknown>
  }>>([])
  const bridgeReadyRef = useRef(false)

  // Keep ref in sync so event handlers always see the latest value
  activePluginRef.current = activePlugin

  const sendPendingInvocations = useCallback(() => {
    if (!bridgeRef.current || !bridgeReadyRef.current) return
    for (const inv of pendingInvocationsRef.current) {
      bridgeRef.current.sendInvokeTool(inv.invocationId, inv.toolName, inv.parameters)
    }
    pendingInvocationsRef.current = []
  }, [])

  // Subscribe to pluginManager events — stable subscription, never re-subscribes
  useEffect(() => {
    const offMount = pluginManager.on('mount', (payload) => {
      if (!('toolName' in payload)) return
      const { pluginSlug } = payload

      const plugin = pluginToolProviderInstance.getPlugins().find(p => p.appSlug === pluginSlug)
      if (!plugin) return

      // New plugin — reset iframe state and mount
      pendingInvocationsRef.current = []
      bridgeReadyRef.current = false
      setActivePlugin({ pluginSlug, plugin })
      setPluginActive(true)
    })

    const offInvoke = pluginManager.on('invoke', (payload) => {
      if (!('invocationId' in payload)) return
      const { invocationId, toolName, parameters } = payload as {
        pluginSlug: string
        invocationId: string
        toolName: string
        parameters: Record<string, unknown>
      }

      // Send INVOKE_TOOL if bridge is ready, otherwise queue it
      if (bridgeReadyRef.current && bridgeRef.current) {
        bridgeRef.current.sendInvokeTool(invocationId, toolName, parameters)
      } else {
        pendingInvocationsRef.current.push({ invocationId, toolName, parameters })
      }
    })

    const offUnmount = pluginManager.on('unmount', (payload) => {
      if ('pluginSlug' in payload && activePluginRef.current?.pluginSlug === payload.pluginSlug) {
        setActivePlugin(null)
        setPluginActive(false)
        bridgeReadyRef.current = false
        pendingInvocationsRef.current = []
      }
    })

    return () => {
      offMount()
      offInvoke()
      offUnmount()
      setPluginActive(false)
    }
  }, [setPluginActive])

  // Set up PluginBridge when iframe mounts
  useEffect(() => {
    if (!activePlugin || !iframeRef.current) return

    const { plugin } = activePlugin

    const bridge = new PluginBridge({
      iframe: iframeRef.current,
      allowedOrigins: plugin.permissions.allowedOrigins,
      readyTimeout: (plugin.permissions.timeouts.ready || 10) * 1000,
      taskCompleteTimeout: (plugin.permissions.timeouts.taskComplete || 30) * 1000,
      onReady: () => {
        bridgeReadyRef.current = true
        // Restore saved state from backend
        const slug = activePluginRef.current?.pluginSlug
        if (slug && bridgeRef.current) {
          fetch(`/api/plugins/${slug}/state`, { credentials: 'include' })
            .then(res => res.ok ? res.json() : null)
            .then(data => {
              if (data?.state && bridgeRef.current) {
                bridgeRef.current.sendStateRestore('restore', data.state as Record<string, unknown>)
              }
            })
            .catch(() => {})
        }
        sendPendingInvocations()
      },
      onStateUpdate: (invocationId, state) => {
        pluginManager.handleStateUpdate(invocationId, state)
        // Persist to backend
        const slug = activePluginRef.current?.pluginSlug
        if (slug && invocationId) {
          fetch(`/api/plugins/${slug}/state`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ invocationId, state }),
          }).catch(() => {}) // fire-and-forget, don't block plugin
        }
      },
      onTaskComplete: (invocationId, result) => {
        pluginManager.handleTaskComplete(invocationId, result)
      },
      onError: (invocationId, code, message, recoverable) => {
        pluginManager.handleError(invocationId, code, message, recoverable)
      },
      onTimeout: (type, invocationId) => {
        if (invocationId) {
          pluginManager.handleError(invocationId, 'INTERNAL_ERROR', 'Plugin timed out', false)
        } else if (type === 'ready') {
          // Iframe never sent READY — destroy session to reject all pending invocations
          pluginManager.destroySession(activePlugin.pluginSlug)
        }
      },
    })

    bridgeRef.current = bridge

    return () => {
      bridge.destroy()
      bridgeRef.current = null
      bridgeReadyRef.current = false
    }
  }, [activePlugin, sendPendingInvocations])

  const handleClose = useCallback(() => {
    if (activePlugin) {
      const invocationId = pluginManager.getLastInvocationId(activePlugin.pluginSlug)
      if (invocationId && bridgeRef.current) {
        bridgeRef.current.sendDestroy(invocationId)
      }
      pluginManager.destroySession(activePlugin.pluginSlug)
    }
  }, [activePlugin])

  const showSidebar = useUIStore((s) => s.showSidebar)
  const sidebarWidth = useSidebarWidth()

  if (!activePlugin) return null

  const { plugin } = activePlugin
  const sidebarOffset = showSidebar ? sidebarWidth : 0

  return (
    <div
      className="hidden sm:flex"
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        bottom: 0,
        left: sidebarOffset,
        zIndex: 2,
        flexDirection: 'column',
        backgroundColor: 'var(--mantine-color-body)',
      }}
    >
      <Group
        justify="space-between"
        px="sm"
        py={6}
        style={{
          backgroundColor: 'var(--chatbox-background-gray-secondary)',
          borderBottom: '1px solid var(--mantine-color-default-border)',
          flexShrink: 0,
        }}
      >
        <Group gap={8}>
          <Text size="sm" fw={600}>
            {plugin.appName}
          </Text>
        </Group>
        <ActionIcon variant="subtle" size="sm" onClick={handleClose}>
          <IconX size={14} />
        </ActionIcon>
      </Group>
      <iframe
        ref={iframeRef}
        src={plugin.iframeUrl}
        sandbox="allow-scripts allow-same-origin"
        style={{
          width: '100%',
          flex: 1,
          border: 'none',
          display: 'block',
        }}
      />
    </div>
  )
}
