# Chess Plugin Chat Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the chess plugin into the chat window so the AI can invoke chess tools and an interactive board renders as a persistent iframe.

**Architecture:** A `pluginToolProvider` fetches plugin schemas from the server and exposes them as Vercel AI SDK tools. A `PluginManager` singleton coordinates tool execution with a persistent iframe via the existing `PluginBridge` postMessage layer. The iframe container lives in the chat layout (not per-message) and mounts on demand.

**Tech Stack:** React 18, TypeScript, Vercel AI SDK (`tool()` from `ai`, Zod schemas), existing PluginBridge/PluginFrame components, Mantine UI, Vitest.

**Spec:** [`docs/superpowers/specs/2026-04-03-chess-plugin-chat-integration-design.md`](../specs/2026-04-03-chess-plugin-chat-integration-design.md)

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `src/renderer/packages/plugins/pluginManager.ts` | Singleton: manages active plugin sessions, dispatches INVOKE_TOOL to iframe bridge, resolves Promises on TASK_COMPLETE |
| `src/renderer/packages/plugins/pluginManager.test.ts` | Unit tests for PluginManager |
| `src/renderer/packages/plugins/pluginToolProvider.ts` | Fetches plugin schemas from server, converts to Vercel AI SDK ToolSet |
| `src/renderer/packages/plugins/pluginToolProvider.test.ts` | Unit tests for pluginToolProvider |
| `src/renderer/components/plugin/PluginContainer.tsx` | Persistent iframe container mounted in chat layout |

### Modified Files

| File | Change |
|------|--------|
| `server/public/plugins/chess/index.html` | Fix postMessage field names to match PluginBridge protocol |
| `src/renderer/packages/model-calls/stream-text.ts` | Merge plugin tools into tool set |
| `src/renderer/components/message-parts/ToolCallPartUI.tsx` | Detect `plugin__` prefix, render compact pill |
| `src/renderer/packages/tools/index.ts` | Handle plugin tool display names |
| `src/renderer/routes/session/$sessionId.tsx` | Mount PluginContainer in chat layout |

---

## Task 1: Fix Chess Plugin postMessage Protocol

The chess plugin's message handling has field name mismatches with `PluginBridge.ts`. The bridge sends `payload.toolName` and `payload.parameters`, but the chess plugin reads `payload.tool` and `payload.params`. The error message type is `TASK_ERROR` but the protocol expects `ERROR` with `code`, `message`, `recoverable` fields.

**Files:**
- Modify: `server/public/plugins/chess/index.html:817-837` (message listener)
- Modify: `server/public/plugins/chess/index.html:622-628` (sendError function)

- [ ] **Step 1: Fix the `sendError` function to match the `ERROR` protocol**

Change `server/public/plugins/chess/index.html` line 622-628 from:

```js
function sendError(message) {
  window.parent.postMessage({
    type: 'TASK_ERROR',
    invocationId: currentInvocationId,
    payload: { error: message },
  }, '*');
}
```

To:

```js
function sendError(message) {
  window.parent.postMessage({
    type: 'ERROR',
    invocationId: currentInvocationId,
    payload: { code: 'INTERNAL_ERROR', message, recoverable: false },
  }, '*');
}
```

- [ ] **Step 2: Fix the INVOKE_TOOL message listener field names**

Change `server/public/plugins/chess/index.html` line 819-829 from:

```js
  if (type === 'INVOKE_TOOL') {
    const { tool, params } = payload || {};
    if (tool === 'start_game')  handleStartGame(invocationId, params);
    else if (tool === 'get_hint')   handleGetHint(invocationId, params);
    else if (tool === 'end_game')   handleEndGame(invocationId);
    else if (tool === 'undo_move')  handleUndoMove(invocationId);
    else if (tool === 'redo_move')  handleRedoMove(invocationId);
    else {
      currentInvocationId = invocationId;
      sendError(`Unknown tool: ${tool}`);
    }
```

To:

```js
  if (type === 'INVOKE_TOOL') {
    const { toolName, parameters } = payload || {};
    if (toolName === 'start_game')  handleStartGame(invocationId, parameters);
    else if (toolName === 'get_hint')   handleGetHint(invocationId, parameters);
    else if (toolName === 'end_game')   handleEndGame(invocationId);
    else if (toolName === 'undo_move')  handleUndoMove(invocationId);
    else if (toolName === 'redo_move')  handleRedoMove(invocationId);
    else {
      currentInvocationId = invocationId;
      sendError(`Unknown tool: ${toolName}`);
    }
```

- [ ] **Step 3: Verify the READY signal exists**

Confirm that line 1276-1277 already sends the READY signal correctly:

```js
window.parent.postMessage({ type: 'READY', invocationId: null, payload: {} }, '*');
```

No change needed here — just verify it's present.

- [ ] **Step 4: Commit**

```bash
git add server/public/plugins/chess/index.html
git commit -m "fix(chess): align postMessage protocol with PluginBridge contract"
```

---

## Task 2: Create PluginManager Singleton

The PluginManager coordinates between tool execution (Vercel AI SDK calling `execute()`) and the persistent iframe (rendering in React). It uses an EventEmitter pattern so the React layer can subscribe to mount/unmount events without the manager depending on React.

**Files:**
- Create: `src/renderer/packages/plugins/pluginManager.ts`
- Create: `src/renderer/packages/plugins/pluginManager.test.ts`

- [ ] **Step 1: Write the failing test for PluginManager event emitter and invoke**

Create `src/renderer/packages/plugins/pluginManager.test.ts`:

```ts
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

    // invoke without resolving — just check the mount event fires
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

    // Simulate the bridge calling back
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

    manager.invoke('chess', 'start_game', { difficulty: 'easy', color: 'white' })
    manager.destroySession('chess')

    expect(unmountHandler).toHaveBeenCalledWith(
      expect.objectContaining({ pluginSlug: 'chess' })
    )
  })

  it('cleans up session on destroy', () => {
    manager.invoke('chess', 'start_game', { difficulty: 'easy', color: 'white' })
    manager.destroySession('chess')

    expect(manager.hasActiveSession('chess')).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/renderer/packages/plugins/pluginManager.test.ts`
Expected: FAIL — module `./pluginManager` not found.

- [ ] **Step 3: Implement PluginManager**

Create `src/renderer/packages/plugins/pluginManager.ts`:

```ts
type EventType = 'mount' | 'unmount'

interface MountEvent {
  pluginSlug: string
  toolName: string
  parameters: Record<string, unknown>
}

interface UnmountEvent {
  pluginSlug: string
}

type EventPayload = MountEvent | UnmountEvent
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
    // State persistence will be wired in PluginContainer (Task 5)
  }

  destroySession(pluginSlug: string): void {
    const session = this.sessions.get(pluginSlug)
    if (!session) return

    // Reject any pending invocations
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/renderer/packages/plugins/pluginManager.test.ts`
Expected: All 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/packages/plugins/pluginManager.ts src/renderer/packages/plugins/pluginManager.test.ts
git commit -m "feat: add PluginManager singleton for plugin session coordination"
```

---

## Task 3: Create Plugin Tool Provider

Fetches plugin definitions from `GET /api/plugins` and converts them into Vercel AI SDK `ToolSet` format. Each tool's `execute` delegates to `pluginManager.invoke()`.

**Files:**
- Create: `src/renderer/packages/plugins/pluginToolProvider.ts`
- Create: `src/renderer/packages/plugins/pluginToolProvider.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/renderer/packages/plugins/pluginToolProvider.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/renderer/packages/plugins/pluginToolProvider.test.ts`
Expected: FAIL — module `./pluginToolProvider` not found.

- [ ] **Step 3: Implement PluginToolProvider**

Create `src/renderer/packages/plugins/pluginToolProvider.ts`:

```ts
import { tool, type ToolSet } from 'ai'
import z from 'zod'
import type { PluginManager } from './pluginManager'

interface PluginToolSchema {
  name: string
  description: string
  parameters: {
    type: string
    properties: Record<string, unknown>
    required?: string[]
  }
}

export interface PluginDefinition {
  appSlug: string
  appName: string
  description: string
  iframeUrl: string
  authPattern: string
  toolSchemas: PluginToolSchema[]
  permissions: {
    maxIframeHeight: number
    allowedOrigins: string[]
    timeouts: { ready: number; taskComplete: number }
  }
}

function jsonSchemaToZod(schema: PluginToolSchema['parameters']): z.ZodTypeAny {
  const shape: Record<string, z.ZodTypeAny> = {}
  const properties = schema.properties || {}
  const required = schema.required || []

  for (const [key, prop] of Object.entries(properties)) {
    const p = prop as Record<string, unknown>
    let field: z.ZodTypeAny

    if (p.type === 'string') {
      if (Array.isArray(p.enum)) {
        field = z.enum(p.enum as [string, ...string[]])
      } else {
        field = z.string()
      }
    } else if (p.type === 'number') {
      field = z.number()
    } else if (p.type === 'boolean') {
      field = z.boolean()
    } else if (p.type === 'array') {
      field = z.array(z.unknown())
    } else {
      field = z.unknown()
    }

    if (p.description) {
      field = field.describe(p.description as string)
    }

    if (!required.includes(key)) {
      field = field.optional()
    }

    shape[key] = field
  }

  return z.object(shape)
}

export class PluginToolProvider {
  private plugins: PluginDefinition[] = []
  private tools: ToolSet = {}
  private toolToPlugin: Map<string, PluginDefinition> = new Map()
  private manager: PluginManager
  private fetchFn: typeof fetch

  constructor(manager: PluginManager, fetchFn: typeof fetch = fetch) {
    this.manager = manager
    this.fetchFn = fetchFn
  }

  async loadPlugins(serverBaseUrl: string): Promise<void> {
    const response = await this.fetchFn(`${serverBaseUrl}/api/plugins`)
    if (!response.ok) {
      console.error('Failed to fetch plugins:', response.status)
      return
    }

    this.plugins = await response.json()
    this.tools = {}
    this.toolToPlugin.clear()

    for (const plugin of this.plugins) {
      for (const schema of plugin.toolSchemas) {
        const toolKey = `plugin__${plugin.appSlug}__${schema.name}`
        const inputSchema = jsonSchemaToZod(schema.parameters)

        this.tools[toolKey] = tool({
          description: `[${plugin.appName}] ${schema.description}`,
          inputSchema,
          execute: async (args: Record<string, unknown>) => {
            return await this.manager.invoke(plugin.appSlug, schema.name, args)
          },
        })

        this.toolToPlugin.set(toolKey, plugin)
      }
    }
  }

  getAvailableTools(): ToolSet {
    return { ...this.tools }
  }

  getPluginForTool(toolKey: string): PluginDefinition | undefined {
    return this.toolToPlugin.get(toolKey)
  }

  getPlugins(): PluginDefinition[] {
    return this.plugins
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/renderer/packages/plugins/pluginToolProvider.test.ts`
Expected: All 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/packages/plugins/pluginToolProvider.ts src/renderer/packages/plugins/pluginToolProvider.test.ts
git commit -m "feat: add PluginToolProvider to convert plugin schemas to AI SDK tools"
```

---

## Task 4: Integrate Plugin Tools into stream-text.ts

Merge plugin tools into the tool set that gets passed to the AI model.

**Files:**
- Modify: `src/renderer/packages/model-calls/stream-text.ts:1-2` (imports)
- Modify: `src/renderer/packages/model-calls/stream-text.ts:296-298` (tool set assembly)

- [ ] **Step 1: Add import for pluginToolProvider**

Add after the existing `mcpController` import at line 26 of `src/renderer/packages/model-calls/stream-text.ts`:

```ts
import { pluginToolProvider } from '../plugins/pluginToolProvider'
```

Note: We need to create and export a singleton instance. Add the following to the bottom of `src/renderer/packages/plugins/pluginToolProvider.ts`:

```ts
import { pluginManager } from './pluginManager'

export const pluginToolProvider = new PluginToolProvider(pluginManager)
```

Wait — this creates a circular-ish pattern. Better: export the singleton from a separate barrel file. Instead, just add the singleton export at the bottom of `pluginToolProvider.ts` (it imports `pluginManager` from the same package — no circularity since `pluginManager.ts` doesn't import from `pluginToolProvider.ts`).

Append to the end of `src/renderer/packages/plugins/pluginToolProvider.ts`:

```ts
import { pluginManager } from './pluginManager'

export const pluginToolProviderInstance = new PluginToolProvider(pluginManager)
```

- [ ] **Step 2: Merge plugin tools into the tool set**

In `src/renderer/packages/model-calls/stream-text.ts`, change the import to:

```ts
import { pluginToolProviderInstance } from '../plugins/pluginToolProvider'
```

Change lines 296-298 from:

```ts
    let tools: ToolSet = {
      ...mcpController.getAvailableTools(),
    }
```

To:

```ts
    let tools: ToolSet = {
      ...mcpController.getAvailableTools(),
      ...pluginToolProviderInstance.getAvailableTools(),
    }
```

- [ ] **Step 3: Trigger plugin loading on app startup**

We need to call `pluginToolProviderInstance.loadPlugins()` somewhere during app initialization. Add it to the MCP bootstrap flow.

Read `src/renderer/setup/mcp_bootstrap.ts` to find the right place, then add after the existing MCP bootstrap:

```ts
import { pluginToolProviderInstance } from '@/packages/plugins/pluginToolProvider'

// Inside the bootstrap function, after MCP servers are started:
pluginToolProviderInstance.loadPlugins('http://localhost:3000').catch((err) => {
  console.error('Failed to load plugins:', err)
})
```

The server URL should come from an environment variable or config. For now, hardcode `http://localhost:3000` to match the chess plugin's `allowedOrigins`. This can be made configurable later.

- [ ] **Step 4: Verify the app builds**

Run: `npx electron-vite build` or `pnpm build`
Expected: No TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/packages/plugins/pluginToolProvider.ts src/renderer/packages/model-calls/stream-text.ts src/renderer/setup/mcp_bootstrap.ts
git commit -m "feat: integrate plugin tools into AI model tool set"
```

---

## Task 5: Create PluginContainer Component

A persistent React component that mounts in the chat layout. It subscribes to `pluginManager` events and renders a `PluginFrame` when a plugin session starts.

**Files:**
- Create: `src/renderer/components/plugin/PluginContainer.tsx`

- [ ] **Step 1: Create the PluginContainer component**

Create `src/renderer/components/plugin/PluginContainer.tsx`:

```tsx
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
```

- [ ] **Step 2: Verify the component compiles**

Run: `npx tsc --noEmit --project tsconfig.json` (or whatever tsconfig the renderer uses)
Expected: No TypeScript errors for the new file.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/plugin/PluginContainer.tsx
git commit -m "feat: add persistent PluginContainer for iframe rendering in chat"
```

---

## Task 6: Mount PluginContainer in Chat Layout

Add the PluginContainer between the MessageList and InputBox in the session route.

**Files:**
- Modify: `src/renderer/routes/session/$sessionId.tsx:168-192`

- [ ] **Step 1: Add import**

Add to the imports in `src/renderer/routes/session/$sessionId.tsx`:

```ts
import PluginContainer from '@/components/plugin/PluginContainer'
```

- [ ] **Step 2: Mount PluginContainer between MessageList and InputBox**

Change lines 173-176 from:

```tsx
      <MessageList ref={messageListRef} key={`message-list${currentSessionId}`} currentSession={currentSession} />

      {/* <ScrollButtons /> */}
      <ErrorBoundary name="session-inputbox">
```

To:

```tsx
      <MessageList ref={messageListRef} key={`message-list${currentSessionId}`} currentSession={currentSession} />

      <PluginContainer />

      {/* <ScrollButtons /> */}
      <ErrorBoundary name="session-inputbox">
```

- [ ] **Step 3: Verify the app builds**

Run: `pnpm build` or start dev with `pnpm dev` and confirm no errors.
Expected: App builds successfully.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/routes/session/\$sessionId.tsx
git commit -m "feat: mount PluginContainer in chat layout"
```

---

## Task 7: Update ToolCallPartUI for Plugin Tools

When the AI calls a plugin tool, the message stream should show a compact pill (not the full GeneralToolCallUI with JSON args). The interactive UI lives in the PluginContainer.

**Files:**
- Modify: `src/renderer/packages/tools/index.ts:3-21`
- Modify: `src/renderer/components/message-parts/ToolCallPartUI.tsx:30-48,416-424`

- [ ] **Step 1: Update getToolName to handle plugin tool names**

In `src/renderer/packages/tools/index.ts`, change the `getToolName` function from:

```ts
export function getToolName(toolName: string): string {
  // Use translation keys that i18next cli can detect
  const toolNames: Record<string, string> = {
    query_knowledge_base: t('Query Knowledge Base'),
    get_files_meta: t('Get Files Meta'),
    read_file_chunks: t('Read File Chunks'),
    list_files: t('List Files'),
    web_search: t('Web Search'),
    file_search: t('File Search'),
    code_search: t('Code Search'),
    terminal: t('Terminal'),
    create_file: t('Create File'),
    edit_file: t('Edit File'),
    delete_file: t('Delete File'),
    parse_link: t('Parse Link'),
  }

  return toolNames[toolName] || toolName
}
```

To:

```ts
export function getToolName(toolName: string): string {
  // Handle plugin tool names: plugin__chess__start_game → Start Game
  if (toolName.startsWith('plugin__')) {
    const parts = toolName.split('__')
    const rawName = parts[2] || toolName
    return rawName
      .split('_')
      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ')
  }

  // Use translation keys that i18next cli can detect
  const toolNames: Record<string, string> = {
    query_knowledge_base: t('Query Knowledge Base'),
    get_files_meta: t('Get Files Meta'),
    read_file_chunks: t('Read File Chunks'),
    list_files: t('List Files'),
    web_search: t('Web Search'),
    file_search: t('File Search'),
    code_search: t('Code Search'),
    terminal: t('Terminal'),
    create_file: t('Create File'),
    edit_file: t('Edit File'),
    delete_file: t('Delete File'),
    parse_link: t('Parse Link'),
  }

  return toolNames[toolName] || toolName
}

export function isPluginTool(toolName: string): boolean {
  return toolName.startsWith('plugin__')
}

export function getPluginSlug(toolName: string): string | null {
  if (!toolName.startsWith('plugin__')) return null
  return toolName.split('__')[1] || null
}
```

- [ ] **Step 2: Add plugin icon to toolIconMap and update ToolCallPartUI entry point**

In `src/renderer/components/message-parts/ToolCallPartUI.tsx`, add `IconChess` import (or use a generic puzzle icon since Tabler doesn't have a chess icon):

Add to the icon imports at line 5:

```ts
  IconPuzzle,
```

Add to `toolIconMap` (after `parse_link` entry around line 45):

```ts
  plugin: IconPuzzle,
```

Update `getToolIcon` at line 48 from:

```ts
const getToolIcon = (toolName: string) => toolIconMap[toolName] || IconCode
```

To:

```ts
const getToolIcon = (toolName: string) => {
  if (toolName.startsWith('plugin__')) return toolIconMap['plugin'] || IconCode
  return toolIconMap[toolName] || IconCode
}
```

- [ ] **Step 3: Update the ToolCallPartUI entry point to handle plugin tools**

Change the `ToolCallPartUI` component at line 416-424 from:

```tsx
export const ToolCallPartUI: FC<{ part: MessageToolCallPart }> = ({ part }) => {
  if (part.toolName === 'web_search') {
    return <WebSearchGroupUI parts={[part]} />
  }
  if (part.toolName === 'parse_link') {
    return <ParseLinkUI part={part} />
  }
  return <GeneralToolCallUI part={part} />
}
```

To:

```tsx
export const ToolCallPartUI: FC<{ part: MessageToolCallPart }> = ({ part }) => {
  if (part.toolName === 'web_search') {
    return <WebSearchGroupUI parts={[part]} />
  }
  if (part.toolName === 'parse_link') {
    return <ParseLinkUI part={part} />
  }
  if (part.toolName.startsWith('plugin__')) {
    return <GeneralToolCallUI part={part} />
  }
  return <GeneralToolCallUI part={part} />
}
```

Note: Plugin tools use the same `GeneralToolCallUI` for now — the `getToolName` and `getToolIcon` changes handle the display differences. A custom `PluginToolCallUI` variant can be added later if needed, but YAGNI — the pill already shows the right name and icon.

- [ ] **Step 4: Verify the app builds**

Run: `pnpm build`
Expected: No TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/packages/tools/index.ts src/renderer/components/message-parts/ToolCallPartUI.tsx
git commit -m "feat: display plugin tool calls with friendly names and icons"
```

---

## Task 8: Manual Smoke Test

Verify the full flow works end-to-end.

**Files:** None (testing only)

- [ ] **Step 1: Start the server**

Run: `cd server && npm run dev` (or however the Next.js server starts)
Expected: Server running on `http://localhost:3000`.

- [ ] **Step 2: Start the Electron app**

Run: `pnpm dev`
Expected: App opens without errors.

- [ ] **Step 3: Verify plugin tools are loaded**

Open the browser devtools console in the Electron app. Check for:
- No errors from `pluginToolProviderInstance.loadPlugins()`
- `console.debug('tools', tools)` in stream-text.ts should show `plugin__chess__start_game` etc. when you send a message

- [ ] **Step 4: Test the chess flow**

1. Open a chat session with a capable model (GPT-4, Claude, etc.)
2. Type: "Let's play chess. Start an easy game, I'll play white."
3. Verify:
   - The AI generates a `plugin__chess__start_game` tool call
   - A tool call pill appears in the message with "Start Game" label
   - The PluginContainer appears between the message list and input box
   - The chess board renders in the iframe
   - You can click squares to make moves
4. Type: "Give me a hint"
5. Verify the AI calls `plugin__chess__get_hint` and the hint result appears

- [ ] **Step 5: Test minimize/close**

1. Click the minimize button on the PluginContainer header
2. Verify the iframe collapses
3. Click again to expand
4. Click the close (X) button
5. Verify the iframe is removed and the container disappears
