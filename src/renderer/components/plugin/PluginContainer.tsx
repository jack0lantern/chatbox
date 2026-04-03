import { ActionIcon, Collapse, Group, Paper, Text, UnstyledButton } from '@mantine/core'
import { IconChevronDown, IconChevronUp, IconX } from '@tabler/icons-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { pluginManager } from '@/packages/plugins/pluginManager'
import type { PluginDefinition } from '@/packages/plugins/pluginToolProvider'
import { pluginToolProviderInstance } from '@/packages/plugins/pluginToolProvider'
import { PluginBridge } from './PluginBridge'

interface ActivePlugin {
  pluginSlug: string
  plugin: PluginDefinition
}

export default function PluginContainer() {
  const [activePlugin, setActivePlugin] = useState<ActivePlugin | null>(null)
  const [minimized, setMinimized] = useState(false)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const bridgeRef = useRef<PluginBridge | null>(null)

  // Queue of tool invocations waiting for the bridge to be ready
  const pendingInvocationsRef = useRef<Array<{
    invocationId: string
    toolName: string
    parameters: Record<string, unknown>
  }>>([])
  const bridgeReadyRef = useRef(false)

  const sendPendingInvocations = useCallback(() => {
    if (!bridgeRef.current || !bridgeReadyRef.current) return
    for (const inv of pendingInvocationsRef.current) {
      bridgeRef.current.sendInvokeTool(inv.invocationId, inv.toolName, inv.parameters)
    }
    pendingInvocationsRef.current = []
  }, [])

  // Subscribe to pluginManager events
  useEffect(() => {
    const offMount = pluginManager.on('mount', (payload) => {
      if (!('toolName' in payload)) return
      const { pluginSlug, toolName, parameters } = payload

      const plugin = pluginToolProviderInstance.getPlugins().find(p => p.appSlug === pluginSlug)
      if (!plugin) return

      const invocationId = pluginManager.getLastInvocationId(pluginSlug)
      if (!invocationId) return

      // If this plugin is already active, just queue the invocation
      if (activePlugin?.pluginSlug === pluginSlug) {
        if (bridgeReadyRef.current && bridgeRef.current) {
          bridgeRef.current.sendInvokeTool(invocationId, toolName, parameters)
        } else {
          pendingInvocationsRef.current.push({ invocationId, toolName, parameters })
        }
        setMinimized(false)
        return
      }

      // New plugin — mount it
      pendingInvocationsRef.current = [{ invocationId, toolName, parameters }]
      bridgeReadyRef.current = false
      setActivePlugin({ pluginSlug, plugin })
      setMinimized(false)
    })

    const offUnmount = pluginManager.on('unmount', (payload) => {
      if ('pluginSlug' in payload && activePlugin?.pluginSlug === payload.pluginSlug) {
        setActivePlugin(null)
        bridgeReadyRef.current = false
        pendingInvocationsRef.current = []
      }
    })

    return () => {
      offMount()
      offUnmount()
    }
  }, [activePlugin, sendPendingInvocations])

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
        sendPendingInvocations()
      },
      onStateUpdate: (invocationId, state) => {
        pluginManager.handleStateUpdate(invocationId, state)
      },
      onTaskComplete: (invocationId, result) => {
        pluginManager.handleTaskComplete(invocationId, result)
      },
      onError: (invocationId, code, message, recoverable) => {
        pluginManager.handleError(invocationId, code, message, recoverable)
      },
      onTimeout: (_type, invocationId) => {
        if (invocationId) {
          pluginManager.handleError(invocationId, 'INTERNAL_ERROR', 'Plugin timed out', false)
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

  if (!activePlugin) return null

  const { plugin } = activePlugin

  return (
    <Paper
      radius="md"
      withBorder
      mx="sm"
      mb={4}
      style={{ overflow: 'hidden' }}
    >
      <Group
        justify="space-between"
        px="sm"
        py={6}
        style={{
          backgroundColor: 'var(--chatbox-background-gray-secondary)',
          borderBottom: minimized ? 'none' : '1px solid var(--mantine-color-default-border)',
          cursor: 'pointer',
        }}
        onClick={() => setMinimized(prev => !prev)}
      >
        <Group gap={8}>
          <Text size="sm" fw={600}>
            {plugin.appName}
          </Text>
        </Group>
        <Group gap={4}>
          <UnstyledButton onClick={(e) => { e.stopPropagation(); setMinimized(prev => !prev) }}>
            {minimized ? <IconChevronUp size={16} /> : <IconChevronDown size={16} />}
          </UnstyledButton>
          <ActionIcon variant="subtle" size="sm" onClick={(e) => { e.stopPropagation(); handleClose() }}>
            <IconX size={14} />
          </ActionIcon>
        </Group>
      </Group>
      <Collapse in={!minimized}>
        <iframe
          ref={iframeRef}
          src={plugin.iframeUrl}
          sandbox="allow-scripts allow-same-origin"
          style={{
            width: '100%',
            height: plugin.permissions.maxIframeHeight,
            border: 'none',
            display: 'block',
          }}
        />
      </Collapse>
    </Paper>
  )
}
