# ChatBridge Phase 2: LLM Proxy + Plugin Framework

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the LLM server-side proxy (BYOK, SSE streaming) and the plugin framework (registry, iframe container, postMessage bridge, tool discovery) so plugins can be invoked from chat.

**Architecture:** The LLM proxy at `/api/chat/completions` decrypts user API keys and forwards to providers. The plugin system has three parts: a `PluginRegistration` DB table seeded with bundled plugins, a `PluginFrame` React component that renders sandboxed iframes inline in chat, and a `PluginBridge` class managing the postMessage protocol.

**Tech Stack:** Next.js API routes, SSE, OpenAI SDK, React, postMessage API

**Spec:** `docs/superpowers/specs/2026-04-02-chatbridge-platform-design.md` (Sections 2.3, 3) and `docs/superpowers/specs/2026-04-02-plugin-api-contract-design.md` (Section 2)

**Depends on:** Phase 1 (server, auth, storage, encryption) — all complete.

---

## File Structure

```
server/
├── app/api/
│   ├── chat/
│   │   └── completions/
│   │       └── route.ts            # LLM proxy with SSE streaming
│   └── plugins/
│       ├── route.ts                # GET /api/plugins — list active plugins
│       └── [pluginId]/
│           └── state/
│               └── route.ts        # GET/PUT plugin state
├── lib/
│   ├── llm-proxy.ts                # Provider-specific API call logic
│   └── plugin-seed.ts              # Seed bundled plugin registrations
├── prisma/
│   └── seed.ts                     # Prisma seed script
└── __tests__/
    ├── llm-proxy.test.ts           # LLM proxy unit tests
    └── plugin-api.test.ts          # Plugin API tests

src/renderer/
├── components/
│   └── plugin/
│       ├── PluginFrame.tsx          # Sandboxed iframe container
│       └── PluginBridge.ts         # postMessage protocol handler
└── packages/
    └── plugin-types.ts             # Shared types for plugin messages
```

---

### Task 1: Plugin Message Types

**Files:**
- Create: `src/renderer/packages/plugin-types.ts`

- [ ] **Step 1: Create shared types for the postMessage protocol**

```typescript
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
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/packages/plugin-types.ts
git commit -m "feat: add shared plugin message types"
```

---

### Task 2: PluginBridge

**Files:**
- Create: `src/renderer/components/plugin/PluginBridge.ts`

- [ ] **Step 1: Write the PluginBridge class**

```typescript
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
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/components/plugin/PluginBridge.ts
git commit -m "feat: add PluginBridge postMessage handler"
```

---

### Task 3: PluginFrame React Component

**Files:**
- Create: `src/renderer/components/plugin/PluginFrame.tsx`

- [ ] **Step 1: Write the PluginFrame component**

```tsx
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
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/components/plugin/PluginFrame.tsx
git commit -m "feat: add PluginFrame sandboxed iframe component"
```

---

### Task 4: Plugin Seed Data

**Files:**
- Create: `server/lib/plugin-seed.ts`
- Create: `server/prisma/seed.ts`

- [ ] **Step 1: Create plugin seed definitions**

```typescript
// server/lib/plugin-seed.ts

export const bundledPlugins = [
  {
    appSlug: 'chess',
    appName: 'Chess',
    description: 'Play chess against an AI opponent. Supports hints, undo, and redo.',
    iframeUrl: '/plugins/chess/index.html',
    authPattern: 'internal',
    toolSchemas: [
      {
        name: 'start_game',
        description: 'Start a new chess game against the AI',
        parameters: {
          type: 'object',
          properties: {
            difficulty: { type: 'string', enum: ['easy', 'medium', 'hard'], description: 'AI difficulty level' },
            color: { type: 'string', enum: ['white', 'black', 'random'], description: 'Which color the student plays' },
          },
          required: ['difficulty', 'color'],
        },
      },
      {
        name: 'get_hint',
        description: 'Suggest the best next move for the student',
        parameters: {
          type: 'object',
          properties: {
            difficulty: { type: 'string', enum: ['easy', 'medium', 'hard'] },
          },
        },
      },
      {
        name: 'end_game',
        description: 'End the current chess game and show results',
        parameters: { type: 'object', properties: {} },
      },
      {
        name: 'undo_move',
        description: 'Undo the last move',
        parameters: { type: 'object', properties: {} },
      },
      {
        name: 'redo_move',
        description: 'Redo a previously undone move',
        parameters: { type: 'object', properties: {} },
      },
    ],
    permissions: {
      maxIframeHeight: 600,
      allowedOrigins: ['http://localhost:3000'],
      timeouts: { ready: 10, taskComplete: 30 },
    },
  },
  {
    appSlug: 'timeline',
    appName: 'Timeline Quiz',
    description: 'A history quiz game. Place historical events in chronological order. 3 lives.',
    iframeUrl: '/plugins/timeline/index.html',
    authPattern: 'internal',
    toolSchemas: [
      {
        name: 'start_quiz',
        description: 'Start a new timeline quiz game',
        parameters: {
          type: 'object',
          properties: {
            category: { type: 'string', description: 'Optional category filter (e.g., space, politics, science)' },
          },
        },
      },
      {
        name: 'check_placement',
        description: 'Check if the student placed the current event card correctly',
        parameters: { type: 'object', properties: {} },
      },
      {
        name: 'get_hint',
        description: 'Narrow down the correct position for the current card',
        parameters: { type: 'object', properties: {} },
      },
      {
        name: 'next_card',
        description: 'Draw the next event card',
        parameters: { type: 'object', properties: {} },
      },
    ],
    permissions: {
      maxIframeHeight: 500,
      allowedOrigins: ['http://localhost:3000'],
      timeouts: { ready: 5, taskComplete: 15 },
    },
  },
  {
    appSlug: 'spotify',
    appName: 'Spotify Playlist Creator',
    description: 'Create and manage Spotify playlists from chat',
    iframeUrl: '/plugins/spotify/index.html',
    authPattern: 'external_authenticated',
    oauthProvider: 'spotify',
    toolSchemas: [
      {
        name: 'create_playlist',
        description: 'Create a new Spotify playlist',
        parameters: {
          type: 'object',
          properties: {
            playlistName: { type: 'string', description: 'Name of the playlist' },
            songs: { type: 'array', items: { type: 'string' }, description: 'List of song names to add' },
          },
          required: ['playlistName', 'songs'],
        },
      },
      {
        name: 'search_songs',
        description: 'Search for songs on Spotify',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query' },
          },
          required: ['query'],
        },
      },
      {
        name: 'add_to_playlist',
        description: 'Add songs to an existing playlist',
        parameters: {
          type: 'object',
          properties: {
            playlistId: { type: 'string', description: 'Spotify playlist ID' },
            songs: { type: 'array', items: { type: 'string' }, description: 'Song names to add' },
          },
          required: ['playlistId', 'songs'],
        },
      },
    ],
    permissions: {
      maxIframeHeight: 500,
      allowedOrigins: ['http://localhost:3000'],
      requestedScopes: ['playlist-modify-public'],
      timeouts: { ready: 5, taskComplete: 15 },
    },
  },
]
```

- [ ] **Step 2: Create Prisma seed script**

```typescript
// server/prisma/seed.ts
import { PrismaClient } from '@prisma/client'
import { randomUUID } from 'crypto'
import { bundledPlugins } from '../lib/plugin-seed'

const prisma = new PrismaClient()

async function main() {
  for (const plugin of bundledPlugins) {
    await prisma.pluginRegistration.upsert({
      where: { appSlug: plugin.appSlug },
      update: {
        appName: plugin.appName,
        description: plugin.description,
        iframeUrl: plugin.iframeUrl,
        authPattern: plugin.authPattern,
        oauthProvider: plugin.oauthProvider ?? null,
        toolSchemas: plugin.toolSchemas,
        permissions: plugin.permissions,
      },
      create: {
        appSlug: plugin.appSlug,
        appName: plugin.appName,
        description: plugin.description,
        iframeUrl: plugin.iframeUrl,
        authPattern: plugin.authPattern,
        oauthProvider: plugin.oauthProvider ?? null,
        toolSchemas: plugin.toolSchemas,
        permissions: plugin.permissions,
        apiKey: randomUUID(),
      },
    })
    console.log(`Seeded plugin: ${plugin.appSlug}`)
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e)
    prisma.$disconnect()
    process.exit(1)
  })
```

- [ ] **Step 3: Add seed script to package.json**

Add to `server/package.json` in the `prisma` section:

```json
{
  "prisma": {
    "seed": "tsx prisma/seed.ts"
  }
}
```

And add `tsx` as a dev dependency:

```bash
cd server && pnpm add -D tsx
```

- [ ] **Step 4: Run seed**

```bash
cd server && npx prisma db seed
```

Expected: "Seeded plugin: chess", "Seeded plugin: timeline", "Seeded plugin: spotify"

- [ ] **Step 5: Commit**

```bash
git add server/lib/plugin-seed.ts server/prisma/seed.ts server/package.json
git commit -m "feat: add bundled plugin seed data (chess, timeline, spotify)"
```

---

### Task 5: Plugin List API

**Files:**
- Create: `server/app/api/plugins/route.ts`
- Create: `server/app/api/plugins/[pluginId]/state/route.ts`
- Create: `server/__tests__/plugin-api.test.ts`

- [ ] **Step 1: Create GET /api/plugins route**

```typescript
// server/app/api/plugins/route.ts
import { getServerSession } from 'next-auth'
import { NextResponse } from 'next/server'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const plugins = await prisma.pluginRegistration.findMany({
    where: { status: 'active' },
    select: {
      id: true,
      appSlug: true,
      appName: true,
      description: true,
      iframeUrl: true,
      authPattern: true,
      toolSchemas: true,
      permissions: true,
    },
  })

  return NextResponse.json({ plugins })
}
```

- [ ] **Step 2: Create plugin state routes**

```typescript
// server/app/api/plugins/[pluginId]/state/route.ts
import { getServerSession } from 'next-auth'
import { NextResponse } from 'next/server'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

type RouteContext = { params: Promise<{ pluginId: string }> }

export async function GET(_req: Request, context: RouteContext) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { pluginId } = await context.params
  const userId = (session.user as any).id as string

  // Get the most recent state for this user + plugin
  const state = await prisma.pluginState.findFirst({
    where: { userId, pluginId },
    orderBy: { updatedAt: 'desc' },
  })

  return NextResponse.json({ state: state?.state ?? null })
}

export async function PUT(req: Request, context: RouteContext) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { pluginId } = await context.params
  const userId = (session.user as any).id as string
  const body = await req.json()
  const { invocationId, state } = body

  await prisma.pluginState.upsert({
    where: {
      userId_pluginId_invocationId: { userId, pluginId, invocationId },
    },
    update: { state },
    create: { userId, pluginId, invocationId, state },
  })

  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 3: Write tests**

```typescript
// server/__tests__/plugin-api.test.ts
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { prisma } from '../lib/prisma'
import { GET as getPlugins } from '../app/api/plugins/route'
import { GET as getState, PUT as putState } from '../app/api/plugins/[pluginId]/state/route'
import { getServerSession } from 'next-auth'

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}))

const TEST_USER_ID = 'test-user-plugins'

const mockSession = {
  user: { id: TEST_USER_ID, email: 'test-plugin@test.com', name: 'Test' },
}

describe('plugin API', () => {
  beforeEach(async () => {
    vi.mocked(getServerSession).mockResolvedValue(mockSession)
    await prisma.user.upsert({
      where: { id: TEST_USER_ID },
      update: {},
      create: { id: TEST_USER_ID, email: 'test-plugin@test.com' },
    })
    await prisma.pluginState.deleteMany({ where: { userId: TEST_USER_ID } })
  })

  it('GET /api/plugins returns seeded plugins', async () => {
    const res = await getPlugins(new Request('http://localhost/api/plugins'))
    const data = await res.json()
    expect(data.plugins.length).toBeGreaterThanOrEqual(3)
    const slugs = data.plugins.map((p: any) => p.appSlug)
    expect(slugs).toContain('chess')
    expect(slugs).toContain('timeline')
    expect(slugs).toContain('spotify')
  })

  it('plugin state round-trip', async () => {
    // PUT state
    const putRes = await putState(
      new Request('http://localhost/api/plugins/chess/state', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invocationId: 'inv_1', state: { fen: 'starting', score: 0 } }),
      }),
      { params: Promise.resolve({ pluginId: 'chess' }) }
    )
    expect(putRes.status).toBe(200)

    // GET state
    const getRes = await getState(
      new Request('http://localhost/api/plugins/chess/state'),
      { params: Promise.resolve({ pluginId: 'chess' }) }
    )
    const data = await getRes.json()
    expect(data.state).toEqual({ fen: 'starting', score: 0 })
  })

  it('returns 401 without auth', async () => {
    vi.mocked(getServerSession).mockResolvedValue(null)
    const res = await getPlugins(new Request('http://localhost/api/plugins'))
    expect(res.status).toBe(401)
  })
})
```

- [ ] **Step 4: Run tests**

```bash
cd server && pnpm test -- __tests__/plugin-api.test.ts
```

Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add server/app/api/plugins/ server/__tests__/plugin-api.test.ts
git commit -m "feat: add plugin list and state API routes"
```

---

### Task 6: LLM Proxy Route

**Files:**
- Create: `server/lib/llm-proxy.ts`
- Create: `server/app/api/chat/completions/route.ts`
- Create: `server/__tests__/llm-proxy.test.ts`

- [ ] **Step 1: Create provider-specific proxy logic**

```typescript
// server/lib/llm-proxy.ts
import { decrypt } from './encryption'
import { prisma } from './prisma'

interface ProxyRequest {
  provider: string
  model: string
  messages: Array<{ role: string; content: string }>
  temperature?: number
  topP?: number
  tools?: Array<Record<string, unknown>>
}

interface ProviderConfig {
  apiKey: string
  apiHost: string
  apiPath: string
}

const PROVIDER_DEFAULTS: Record<string, { host: string; path: string }> = {
  openai: { host: 'https://api.openai.com', path: '/v1/chat/completions' },
  claude: { host: 'https://api.anthropic.com', path: '/v1/messages' },
  gemini: { host: 'https://generativelanguage.googleapis.com', path: '/v1beta/models/{model}:streamGenerateContent' },
  deepseek: { host: 'https://api.deepseek.com', path: '/v1/chat/completions' },
}

export async function getProviderConfig(userId: string, provider: string): Promise<ProviderConfig | null> {
  // Read settings from user storage
  const settingsRow = await prisma.userStorage.findUnique({
    where: { userId_key: { userId, key: 'settings' } },
  })

  if (!settingsRow?.value) return null

  const settings = settingsRow.value as Record<string, unknown>
  const providers = settings.providers as Record<string, Record<string, unknown>> | undefined
  if (!providers?.[provider]) return null

  const providerSettings = providers[provider]
  const encryptedKey = providerSettings.apiKey as string | undefined
  if (!encryptedKey) return null

  const defaults = PROVIDER_DEFAULTS[provider] ?? { host: '', path: '/v1/chat/completions' }

  return {
    apiKey: decrypt(encryptedKey),
    apiHost: (providerSettings.apiHost as string) || defaults.host,
    apiPath: (providerSettings.apiPath as string) || defaults.path,
  }
}

export function buildProviderRequest(provider: string, req: ProxyRequest, apiKey: string) {
  // OpenAI-compatible format (works for OpenAI, DeepSeek, and most providers)
  return {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: req.model,
      messages: req.messages,
      temperature: req.temperature,
      top_p: req.topP,
      stream: true,
      ...(req.tools ? { tools: req.tools } : {}),
    }),
  }
}
```

- [ ] **Step 2: Create the SSE streaming route**

```typescript
// server/app/api/chat/completions/route.ts
import { getServerSession } from 'next-auth'
import { NextResponse } from 'next/server'
import { authOptions } from '@/lib/auth'
import { getProviderConfig, buildProviderRequest } from '@/lib/llm-proxy'

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const userId = (session.user as any).id as string
  const body = await req.json()
  const { provider, model, messages, temperature, topP, tools } = body

  if (!provider || !model || !messages) {
    return NextResponse.json(
      { error: 'Missing required fields: provider, model, messages' },
      { status: 400 }
    )
  }

  const config = await getProviderConfig(userId, provider)
  if (!config) {
    return NextResponse.json(
      { error: `No API key configured for provider: ${provider}` },
      { status: 400 }
    )
  }

  const { headers, body: requestBody } = buildProviderRequest(
    provider,
    { provider, model, messages, temperature, topP, tools },
    config.apiKey
  )

  const url = `${config.apiHost}${config.apiPath}`

  try {
    const providerResponse = await fetch(url, {
      method: 'POST',
      headers,
      body: requestBody,
    })

    if (!providerResponse.ok) {
      const errorText = await providerResponse.text()
      return NextResponse.json(
        { error: `Provider error: ${providerResponse.status}`, details: errorText },
        { status: providerResponse.status }
      )
    }

    // Stream the response back to the client
    if (!providerResponse.body) {
      return NextResponse.json({ error: 'No response body from provider' }, { status: 502 })
    }

    return new Response(providerResponse.body, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    })
  } catch (error) {
    return NextResponse.json(
      { error: `Failed to reach provider: ${error}` },
      { status: 502 }
    )
  }
}
```

- [ ] **Step 3: Write unit test for provider config**

```typescript
// server/__tests__/llm-proxy.test.ts
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { prisma } from '../lib/prisma'
import { encrypt } from '../lib/encryption'
import { getProviderConfig, buildProviderRequest } from '../lib/llm-proxy'

const TEST_USER_ID = 'test-user-llm-proxy'

describe('llm-proxy', () => {
  beforeEach(async () => {
    await prisma.user.upsert({
      where: { id: TEST_USER_ID },
      update: {},
      create: { id: TEST_USER_ID, email: 'test-llm@test.com' },
    })
    await prisma.userStorage.deleteMany({ where: { userId: TEST_USER_ID } })
  })

  it('getProviderConfig returns decrypted API key', async () => {
    const encryptedKey = encrypt('sk-test-key-123')
    await prisma.userStorage.create({
      data: {
        userId: TEST_USER_ID,
        key: 'settings',
        value: {
          providers: {
            openai: {
              apiKey: encryptedKey,
            },
          },
        },
      },
    })

    const config = await getProviderConfig(TEST_USER_ID, 'openai')
    expect(config).not.toBeNull()
    expect(config!.apiKey).toBe('sk-test-key-123')
    expect(config!.apiHost).toBe('https://api.openai.com')
    expect(config!.apiPath).toBe('/v1/chat/completions')
  })

  it('getProviderConfig returns null for missing provider', async () => {
    await prisma.userStorage.create({
      data: {
        userId: TEST_USER_ID,
        key: 'settings',
        value: { providers: {} },
      },
    })

    const config = await getProviderConfig(TEST_USER_ID, 'openai')
    expect(config).toBeNull()
  })

  it('getProviderConfig uses custom host if set', async () => {
    const encryptedKey = encrypt('sk-custom')
    await prisma.userStorage.create({
      data: {
        userId: TEST_USER_ID,
        key: 'settings',
        value: {
          providers: {
            openai: {
              apiKey: encryptedKey,
              apiHost: 'https://my-proxy.example.com',
            },
          },
        },
      },
    })

    const config = await getProviderConfig(TEST_USER_ID, 'openai')
    expect(config!.apiHost).toBe('https://my-proxy.example.com')
  })

  it('buildProviderRequest creates OpenAI-compatible request', () => {
    const result = buildProviderRequest('openai', {
      provider: 'openai',
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'hello' }],
      temperature: 0.7,
    }, 'sk-test')

    expect(result.headers.Authorization).toBe('Bearer sk-test')
    const body = JSON.parse(result.body)
    expect(body.model).toBe('gpt-4o-mini')
    expect(body.stream).toBe(true)
    expect(body.messages).toHaveLength(1)
  })

  it('buildProviderRequest includes tools when provided', () => {
    const tools = [{ type: 'function', function: { name: 'test', parameters: {} } }]
    const result = buildProviderRequest('openai', {
      provider: 'openai',
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'hello' }],
      tools,
    }, 'sk-test')

    const body = JSON.parse(result.body)
    expect(body.tools).toEqual(tools)
  })
})
```

- [ ] **Step 4: Run tests**

```bash
cd server && pnpm test -- __tests__/llm-proxy.test.ts
```

Expected: 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add server/lib/llm-proxy.ts server/app/api/chat/ server/__tests__/llm-proxy.test.ts
git commit -m "feat: add LLM proxy route with SSE streaming and BYOK"
```

---

### Task 7: Verification

**Files:** None (testing)

- [ ] **Step 1: Run all unit tests**

```bash
cd server && pnpm test
```

Expected: All tests pass (encryption, storage-api, plugin-api, llm-proxy).

- [ ] **Step 2: Run all E2E tests**

```bash
cd /Users/jackjiang/GitHub/chatbox && npx playwright test --config=playwright.config.ts
```

Expected: All E2E tests pass.

- [ ] **Step 3: Verify chatbox build**

```bash
cd /Users/jackjiang/GitHub/chatbox && pnpm build
```

Expected: Build succeeds. The new PluginFrame and PluginBridge components are included.

- [ ] **Step 4: Verify plugin seed data**

```bash
cd server && npx prisma studio
```

Open `PluginRegistration` table. Expected: 3 rows (chess, timeline, spotify) with full tool schemas.

- [ ] **Step 5: Commit any fixes**

```bash
git add -A
git commit -m "fix: resolve issues found during Phase 2 verification"
```
