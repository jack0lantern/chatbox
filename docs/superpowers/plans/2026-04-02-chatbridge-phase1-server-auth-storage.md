# ChatBridge Phase 1: Server + Auth + Storage

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace chatbox's local storage with a server-backed storage layer behind NextAuth authentication, so both Electron and web builds talk to the same PostgreSQL database.

**Architecture:** A Next.js API server lives in `server/` at the repo root. The chatbox renderer gets a new `ServerPlatform` that implements the existing `Platform` interface by routing storage calls through `fetch()` to the backend. NextAuth gates all access.

**Tech Stack:** Next.js (App Router), NextAuth.js, Prisma, Supabase (local PostgreSQL), TypeScript

**Spec:** `docs/superpowers/specs/2026-04-02-chatbridge-platform-design.md` (Sections 1, 2, 5)

---

## File Structure

```
server/                              # NEW — Next.js backend
├── package.json
├── tsconfig.json
├── next.config.ts
├── .env.local                       # Supabase URL, NextAuth secret, encryption key
├── prisma/
│   └── schema.prisma                # User, Account, Session, UserStorage models
├── app/
│   ├── layout.tsx                   # Root layout (minimal)
│   ├── api/
│   │   ├── auth/[...nextauth]/
│   │   │   └── route.ts            # NextAuth handler
│   │   └── storage/
│   │       ├── route.ts            # GET /api/storage (all values)
│   │       └── [key]/
│   │           └── route.ts        # GET/PUT/DELETE /api/storage/:key
│   └── login/
│       └── page.tsx                # Login page
├── lib/
│   ├── auth.ts                     # NextAuth config
│   ├── prisma.ts                   # Prisma client singleton
│   └── encryption.ts              # API key encrypt/decrypt
└── __tests__/
    ├── storage-api.test.ts         # Storage route tests
    └── encryption.test.ts          # Encryption round-trip tests

src/renderer/platform/
├── server_platform.ts              # NEW — ServerPlatform implementation
└── index.ts                        # MODIFY — add ServerPlatform selection
```

---

### Task 1: Scaffold Next.js Backend

**Files:**
- Create: `server/package.json`
- Create: `server/tsconfig.json`
- Create: `server/next.config.ts`
- Create: `server/.env.local`
- Create: `server/app/layout.tsx`

- [ ] **Step 1: Create server directory and package.json**

```bash
mkdir -p server
```

```json
// server/package.json
{
  "name": "chatbridge-server",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev --port 3000",
    "build": "next build",
    "start": "next start",
    "db:generate": "prisma generate",
    "db:push": "prisma db push",
    "db:studio": "prisma studio",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "next": "^15.3.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "next-auth": "^4.24.0",
    "@prisma/client": "^6.5.0",
    "@auth/prisma-adapter": "^2.9.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@types/react": "^19.0.0",
    "typescript": "^5.7.0",
    "prisma": "^6.5.0",
    "vitest": "^3.1.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
// server/tsconfig.json
{
  "compilerOptions": {
    "target": "ES2017",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": {
      "@/*": ["./*"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: Create next.config.ts**

```typescript
// server/next.config.ts
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Allow requests from Electron and dev origins
  async headers() {
    return [
      {
        source: '/api/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Access-Control-Allow-Methods', value: 'GET, PUT, DELETE, OPTIONS' },
          { key: 'Access-Control-Allow-Headers', value: 'Content-Type, Authorization' },
          { key: 'Access-Control-Allow-Credentials', value: 'true' },
        ],
      },
    ]
  },
}

export default nextConfig
```

- [ ] **Step 4: Create .env.local**

```bash
# server/.env.local
DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
NEXTAUTH_SECRET="dev-secret-change-in-production"
NEXTAUTH_URL="http://localhost:3000"
ENCRYPTION_KEY="dev-encryption-key-32-chars-long!"
```

- [ ] **Step 5: Create root layout**

```tsx
// server/app/layout.tsx
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
```

- [ ] **Step 6: Create vitest config**

```typescript
// server/vitest.config.ts
import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
})
```

- [ ] **Step 7: Install dependencies and verify server starts**

```bash
cd server && pnpm install && pnpm dev
```

Expected: Next.js dev server starts on port 3000.

- [ ] **Step 8: Commit**

```bash
git add server/
git commit -m "feat: scaffold Next.js backend for ChatBridge"
```

---

### Task 2: Prisma Schema + Local Supabase

**Files:**
- Create: `server/prisma/schema.prisma`
- Create: `server/lib/prisma.ts`

- [ ] **Step 1: Start local Supabase**

```bash
cd server && npx supabase init && npx supabase start
```

Expected: Local Supabase starts. Note the DB URL (should match `.env.local`).

- [ ] **Step 2: Create Prisma schema**

```prisma
// server/prisma/schema.prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// NextAuth models

model User {
  id            String    @id @default(uuid())
  name          String?
  email         String    @unique
  emailVerified DateTime?
  image         String?
  accounts      Account[]
  sessions      Session[]
  storage       UserStorage[]
  pluginStates  PluginState[]
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
}

model Account {
  id                String  @id @default(uuid())
  userId            String
  type              String
  provider          String
  providerAccountId String
  refresh_token     String?
  access_token      String?
  expires_at        Int?
  token_type        String?
  scope             String?
  id_token          String?
  session_state     String?
  user              User    @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([provider, providerAccountId])
}

model Session {
  id           String   @id @default(uuid())
  sessionToken String   @unique
  userId       String
  expires      DateTime
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model VerificationToken {
  identifier String
  token      String   @unique
  expires    DateTime

  @@unique([identifier, token])
}

// App models

model UserStorage {
  id        String   @id @default(uuid())
  userId    String
  key       String
  value     Json
  updatedAt DateTime @updatedAt
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, key])
}

model PluginRegistration {
  id            String   @id @default(uuid())
  appSlug       String   @unique
  appName       String
  description   String
  iframeUrl     String
  authPattern   String
  oauthProvider String?
  toolSchemas   Json
  permissions   Json
  apiKey        String
  status        String   @default("active")
  failureCount  Int      @default(0)
  createdAt     DateTime @default(now())
}

model PluginState {
  id           String   @id @default(uuid())
  userId       String
  pluginId     String
  invocationId String
  state        Json
  updatedAt    DateTime @updatedAt
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, pluginId, invocationId])
}
```

- [ ] **Step 3: Create Prisma client singleton**

```typescript
// server/lib/prisma.ts
import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient }

export const prisma = globalForPrisma.prisma || new PrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
```

- [ ] **Step 4: Push schema to database**

```bash
cd server && pnpm db:generate && pnpm db:push
```

Expected: Prisma generates client and pushes schema to local Supabase. No errors.

- [ ] **Step 5: Commit**

```bash
git add server/prisma/ server/lib/prisma.ts
git commit -m "feat: add Prisma schema with NextAuth and app models"
```

---

### Task 3: NextAuth Configuration

**Files:**
- Create: `server/lib/auth.ts`
- Create: `server/app/api/auth/[...nextauth]/route.ts`
- Create: `server/app/login/page.tsx`

- [ ] **Step 1: Create NextAuth config**

```typescript
// server/lib/auth.ts
import { PrismaAdapter } from '@auth/prisma-adapter'
import type { NextAuthOptions } from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import { prisma } from './prisma'

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma),
  providers: [
    CredentialsProvider({
      name: 'Email',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null

        // For MVP: auto-create user on first login, simple password check
        // Replace with proper hashing (bcrypt) before production
        let user = await prisma.user.findUnique({
          where: { email: credentials.email },
        })

        if (!user) {
          user = await prisma.user.create({
            data: {
              email: credentials.email,
              name: credentials.email.split('@')[0],
            },
          })
        }

        return { id: user.id, email: user.email, name: user.name }
      },
    }),
  ],
  session: {
    strategy: 'jwt',
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id
      }
      return token
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).id = token.id
      }
      return session
    },
  },
  pages: {
    signIn: '/login',
  },
}
```

- [ ] **Step 2: Create NextAuth route handler**

```typescript
// server/app/api/auth/[...nextauth]/route.ts
import NextAuth from 'next-auth'
import { authOptions } from '@/lib/auth'

const handler = NextAuth(authOptions)
export { handler as GET, handler as POST }
```

- [ ] **Step 3: Create login page**

```tsx
// server/app/login/page.tsx
'use client'

import { signIn } from 'next-auth/react'
import { useState } from 'react'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    const result = await signIn('credentials', {
      email,
      password,
      redirect: false,
    })

    if (result?.error) {
      setError('Login failed. Please try again.')
    } else {
      window.location.href = '/'
    }
  }

  return (
    <div style={{ maxWidth: 400, margin: '100px auto', padding: 24 }}>
      <h1>ChatBridge Login</h1>
      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: 16 }}>
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            style={{ display: 'block', width: '100%', padding: 8, marginTop: 4 }}
          />
        </div>
        <div style={{ marginBottom: 16 }}>
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            style={{ display: 'block', width: '100%', padding: 8, marginTop: 4 }}
          />
        </div>
        {error && <p style={{ color: 'red' }}>{error}</p>}
        <button type="submit" style={{ padding: '8px 24px' }}>
          Sign In
        </button>
      </form>
    </div>
  )
}
```

- [ ] **Step 4: Install NextAuth dependencies**

```bash
cd server && pnpm add next-auth@^4.24.0 @auth/prisma-adapter@^2.9.0
```

- [ ] **Step 5: Verify login flow works**

```bash
cd server && pnpm dev
```

Visit `http://localhost:3000/login`. Enter any email/password. Expected: user is created in database and session is established. Visit `http://localhost:3000/api/auth/session` — should return session JSON with user ID.

- [ ] **Step 6: Commit**

```bash
git add server/lib/auth.ts server/app/api/auth/ server/app/login/
git commit -m "feat: add NextAuth with credentials provider and login page"
```

---

### Task 4: Encryption Utility

**Files:**
- Create: `server/lib/encryption.ts`
- Create: `server/__tests__/encryption.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// server/__tests__/encryption.test.ts
import { describe, expect, it } from 'vitest'
import { decrypt, encrypt } from '../lib/encryption'

describe('encryption', () => {
  it('round-trips a string through encrypt and decrypt', () => {
    const plaintext = 'sk-abc123-my-openai-key'
    const encrypted = encrypt(plaintext)
    expect(encrypted).not.toBe(plaintext)
    expect(decrypt(encrypted)).toBe(plaintext)
  })

  it('produces different ciphertext for the same input (random IV)', () => {
    const plaintext = 'sk-abc123'
    const a = encrypt(plaintext)
    const b = encrypt(plaintext)
    expect(a).not.toBe(b)
  })

  it('handles empty strings', () => {
    const encrypted = encrypt('')
    expect(decrypt(encrypted)).toBe('')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd server && pnpm test -- __tests__/encryption.test.ts
```

Expected: FAIL — `encrypt` and `decrypt` not found.

- [ ] **Step 3: Write implementation**

```typescript
// server/lib/encryption.ts
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

const ALGORITHM = 'aes-256-gcm'

function getKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY
  if (!key) throw new Error('ENCRYPTION_KEY environment variable is not set')
  // Ensure 32 bytes for AES-256
  return Buffer.from(key.padEnd(32, '0').slice(0, 32), 'utf-8')
}

export function encrypt(plaintext: string): string {
  const iv = randomBytes(16)
  const cipher = createCipheriv(ALGORITHM, getKey(), iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  // Format: iv:authTag:ciphertext (all hex)
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`
}

export function decrypt(ciphertext: string): string {
  const [ivHex, authTagHex, encryptedHex] = ciphertext.split(':')
  const iv = Buffer.from(ivHex, 'hex')
  const authTag = Buffer.from(authTagHex, 'hex')
  const encrypted = Buffer.from(encryptedHex, 'hex')
  const decipher = createDecipheriv(ALGORITHM, getKey(), iv)
  decipher.setAuthTag(authTag)
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd server && ENCRYPTION_KEY="dev-encryption-key-32-chars-long!" pnpm test -- __tests__/encryption.test.ts
```

Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add server/lib/encryption.ts server/__tests__/encryption.test.ts
git commit -m "feat: add AES-256-GCM encryption for API key storage"
```

---

### Task 5: Storage API Routes

**Files:**
- Create: `server/app/api/storage/route.ts`
- Create: `server/app/api/storage/[key]/route.ts`
- Create: `server/__tests__/storage-api.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// server/__tests__/storage-api.test.ts
import { describe, expect, it, beforeEach } from 'vitest'
import { prisma } from '../lib/prisma'

// These tests hit the actual API routes via fetch.
// Start the server before running: cd server && pnpm dev

const BASE = 'http://localhost:3000/api/storage'
const TEST_USER_ID = 'test-user-id'

// Helper: create a test session cookie
// For unit tests, we mock the auth. For integration, use a real login.
// This file tests the route logic directly by importing handlers.

import { GET as getAllHandler } from '../app/api/storage/route'
import { GET, PUT, DELETE } from '../app/api/storage/[key]/route'
import { getServerSession } from 'next-auth'
import { vi } from 'vitest'

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}))

const mockSession = {
  user: { id: TEST_USER_ID, email: 'test@test.com', name: 'Test' },
}

function jsonRequest(body: any): Request {
  return new Request('http://localhost/api/storage/test-key', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('storage API', () => {
  beforeEach(async () => {
    vi.mocked(getServerSession).mockResolvedValue(mockSession)
    // Clean up test data
    await prisma.userStorage.deleteMany({ where: { userId: TEST_USER_ID } })
  })

  it('PUT and GET a value', async () => {
    const putRes = await PUT(
      jsonRequest({ value: { theme: 'dark' } }),
      { params: Promise.resolve({ key: 'settings' }) }
    )
    expect(putRes.status).toBe(200)

    const getRes = await GET(
      new Request('http://localhost/api/storage/settings'),
      { params: Promise.resolve({ key: 'settings' }) }
    )
    const data = await getRes.json()
    expect(data.value).toEqual({ theme: 'dark' })
  })

  it('GET returns null for missing key', async () => {
    const res = await GET(
      new Request('http://localhost/api/storage/nonexistent'),
      { params: Promise.resolve({ key: 'nonexistent' }) }
    )
    const data = await res.json()
    expect(data.value).toBeNull()
  })

  it('DELETE removes a value', async () => {
    await PUT(
      jsonRequest({ value: 'to-delete' }),
      { params: Promise.resolve({ key: 'temp' }) }
    )

    const delRes = await DELETE(
      new Request('http://localhost/api/storage/temp'),
      { params: Promise.resolve({ key: 'temp' }) }
    )
    expect(delRes.status).toBe(200)

    const getRes = await GET(
      new Request('http://localhost/api/storage/temp'),
      { params: Promise.resolve({ key: 'temp' }) }
    )
    const data = await getRes.json()
    expect(data.value).toBeNull()
  })

  it('GET /api/storage returns all values', async () => {
    await PUT(jsonRequest({ value: 'a' }), { params: Promise.resolve({ key: 'key1' }) })
    await PUT(jsonRequest({ value: 'b' }), { params: Promise.resolve({ key: 'key2' }) })

    const res = await getAllHandler(new Request('http://localhost/api/storage'))
    const data = await res.json()
    expect(data.key1).toBe('a')
    expect(data.key2).toBe('b')
  })

  it('returns 401 when not authenticated', async () => {
    vi.mocked(getServerSession).mockResolvedValue(null)

    const res = await GET(
      new Request('http://localhost/api/storage/settings'),
      { params: Promise.resolve({ key: 'settings' }) }
    )
    expect(res.status).toBe(401)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd server && pnpm test -- __tests__/storage-api.test.ts
```

Expected: FAIL — route modules not found.

- [ ] **Step 3: Write GET all route**

```typescript
// server/app/api/storage/route.ts
import { getServerSession } from 'next-auth'
import { NextResponse } from 'next/server'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const userId = (session.user as any).id as string
  const rows = await prisma.userStorage.findMany({ where: { userId } })

  const result: Record<string, any> = {}
  for (const row of rows) {
    result[row.key] = row.value
  }

  return NextResponse.json(result)
}
```

- [ ] **Step 4: Write GET/PUT/DELETE single key route**

```typescript
// server/app/api/storage/[key]/route.ts
import { getServerSession } from 'next-auth'
import { NextResponse } from 'next/server'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

type RouteContext = { params: Promise<{ key: string }> }

export async function GET(_req: Request, context: RouteContext) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { key } = await context.params
  const userId = (session.user as any).id as string

  const row = await prisma.userStorage.findUnique({
    where: { userId_key: { userId, key } },
  })

  return NextResponse.json({ value: row?.value ?? null })
}

export async function PUT(req: Request, context: RouteContext) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { key } = await context.params
  const userId = (session.user as any).id as string
  const body = await req.json()

  await prisma.userStorage.upsert({
    where: { userId_key: { userId, key } },
    update: { value: body.value },
    create: { userId, key, value: body.value },
  })

  return NextResponse.json({ ok: true })
}

export async function DELETE(_req: Request, context: RouteContext) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { key } = await context.params
  const userId = (session.user as any).id as string

  await prisma.userStorage.deleteMany({
    where: { userId, key },
  })

  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd server && pnpm test -- __tests__/storage-api.test.ts
```

Expected: 5 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add server/app/api/storage/ server/__tests__/storage-api.test.ts
git commit -m "feat: add storage CRUD API routes with auth"
```

---

### Task 6: ServerPlatform Implementation

**Files:**
- Create: `src/renderer/platform/server_platform.ts`
- Modify: `src/renderer/platform/index.ts`

- [ ] **Step 1: Create ServerPlatform**

This implements the `Platform` interface by routing storage calls to the backend API. Non-storage methods (window controls, system info, etc.) delegate to a fallback platform (DesktopPlatform or WebPlatform) since they are client-side concerns.

```typescript
// src/renderer/platform/server_platform.ts
import type { Config, Language, Settings, ShortcutSetting } from '@shared/types'
import type { ImageGenerationStorage } from '@/storage/ImageGenerationStorage'
import type { Exporter, Platform, PlatformType } from './interfaces'
import type { KnowledgeBaseController } from './knowledge-base/interface'

const SERVER_URL = process.env.CHATBRIDGE_SERVER_URL || 'http://localhost:3000'

async function apiFetch(path: string, options?: RequestInit): Promise<Response> {
  return fetch(`${SERVER_URL}${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  })
}

export default class ServerPlatform implements Platform {
  private fallback: Platform

  constructor(fallback: Platform) {
    this.fallback = fallback
  }

  get type(): PlatformType {
    return this.fallback.type
  }

  get exporter(): Exporter {
    return this.fallback.exporter
  }

  // --- Storage (routed to server) ---

  getStorageType(): string {
    return 'SERVER'
  }

  async setStoreValue(key: string, value: any): Promise<void> {
    await apiFetch(`/api/storage/${encodeURIComponent(key)}`, {
      method: 'PUT',
      body: JSON.stringify({ value }),
    })
  }

  async getStoreValue(key: string): Promise<any> {
    const res = await apiFetch(`/api/storage/${encodeURIComponent(key)}`)
    const data = await res.json()
    return data.value
  }

  async delStoreValue(key: string): Promise<void> {
    await apiFetch(`/api/storage/${encodeURIComponent(key)}`, {
      method: 'DELETE',
    })
  }

  async getAllStoreValues(): Promise<{ [key: string]: any }> {
    const res = await apiFetch('/api/storage')
    return res.json()
  }

  async getAllStoreKeys(): Promise<string[]> {
    const values = await this.getAllStoreValues()
    return Object.keys(values)
  }

  async setAllStoreValues(data: { [key: string]: any }): Promise<void> {
    const promises = Object.entries(data).map(([key, value]) =>
      this.setStoreValue(key, value)
    )
    await Promise.all(promises)
  }

  // --- Blob storage (routed to server) ---

  async getStoreBlob(key: string): Promise<string | null> {
    const res = await apiFetch(`/api/storage/${encodeURIComponent('blob:' + key)}`)
    const data = await res.json()
    return data.value
  }

  async setStoreBlob(key: string, value: string): Promise<void> {
    await apiFetch(`/api/storage/${encodeURIComponent('blob:' + key)}`, {
      method: 'PUT',
      body: JSON.stringify({ value }),
    })
  }

  async delStoreBlob(key: string): Promise<void> {
    await apiFetch(`/api/storage/${encodeURIComponent('blob:' + key)}`, {
      method: 'DELETE',
    })
  }

  async listStoreBlobKeys(): Promise<string[]> {
    const allKeys = await this.getAllStoreKeys()
    return allKeys
      .filter((k) => k.startsWith('blob:'))
      .map((k) => k.slice(5))
  }

  // --- Everything else delegates to fallback ---

  getVersion() { return this.fallback.getVersion() }
  getPlatform() { return this.fallback.getPlatform() }
  getArch() { return this.fallback.getArch() }
  shouldUseDarkColors() { return this.fallback.shouldUseDarkColors() }
  onSystemThemeChange(cb: () => void) { return this.fallback.onSystemThemeChange(cb) }
  onWindowShow(cb: () => void) { return this.fallback.onWindowShow(cb) }
  onWindowFocused(cb: () => void) { return this.fallback.onWindowFocused(cb) }
  onUpdateDownloaded(cb: () => void) { return this.fallback.onUpdateDownloaded(cb) }
  get onNavigate() { return this.fallback.onNavigate }
  openLink(url: string) { return this.fallback.openLink(url) }
  getDeviceName() { return this.fallback.getDeviceName() }
  getInstanceName() { return this.fallback.getInstanceName() }
  getLocale() { return this.fallback.getLocale() }
  ensureShortcutConfig(c: ShortcutSetting) { return this.fallback.ensureShortcutConfig(c) }
  ensureProxyConfig(c: { proxy?: string }) { return this.fallback.ensureProxyConfig(c) }
  relaunch() { return this.fallback.relaunch() }
  getConfig() { return this.fallback.getConfig() }
  getSettings() { return this.fallback.getSettings() }
  initTracking() { return this.fallback.initTracking() }
  trackingEvent(n: string, p: { [key: string]: string }) { return this.fallback.trackingEvent(n, p) }
  shouldShowAboutDialogWhenStartUp() { return this.fallback.shouldShowAboutDialogWhenStartUp() }
  appLog(l: string, m: string) { return this.fallback.appLog(l, m) }
  exportLogs() { return this.fallback.exportLogs() }
  clearLogs() { return this.fallback.clearLogs() }
  ensureAutoLaunch(e: boolean) { return this.fallback.ensureAutoLaunch(e) }
  parseFileLocally(f: File) { return this.fallback.parseFileLocally(f) }
  get parseFileWithMineru() { return this.fallback.parseFileWithMineru }
  get cancelMineruParse() { return this.fallback.cancelMineruParse }
  isFullscreen() { return this.fallback.isFullscreen() }
  setFullscreen(e: boolean) { return this.fallback.setFullscreen(e) }
  installUpdate() { return this.fallback.installUpdate() }
  getKnowledgeBaseController() { return this.fallback.getKnowledgeBaseController() }
  getImageGenerationStorage() { return this.fallback.getImageGenerationStorage() }
  minimize() { return this.fallback.minimize() }
  maximize() { return this.fallback.maximize() }
  unmaximize() { return this.fallback.unmaximize() }
  closeWindow() { return this.fallback.closeWindow() }
  isMaximized() { return this.fallback.isMaximized() }
  onMaximizedChange(cb: (m: boolean) => void) { return this.fallback.onMaximizedChange(cb) }
}
```

- [ ] **Step 2: Update platform index to use ServerPlatform**

Replace the contents of `src/renderer/platform/index.ts`:

```typescript
// src/renderer/platform/index.ts
import { CHATBOX_BUILD_TARGET } from '@/variables'
import DesktopPlatform from './desktop_platform'
import type { Platform } from './interfaces'
import ServerPlatform from './server_platform'
import TestPlatform from './test_platform'
import WebPlatform from './web_platform'

function initPlatform(): Platform {
  if (process.env.NODE_ENV === 'test') {
    return new TestPlatform()
  }

  let basePlatform: Platform
  if (typeof window !== 'undefined' && window.electronAPI) {
    basePlatform = new DesktopPlatform(window.electronAPI)
  } else {
    basePlatform = new WebPlatform()
  }

  // Wrap with ServerPlatform when CHATBRIDGE_SERVER_URL is configured
  if (process.env.CHATBRIDGE_SERVER_URL) {
    return new ServerPlatform(basePlatform)
  }

  return basePlatform
}

export default initPlatform()
```

- [ ] **Step 3: Verify chatbox still builds without server configured**

```bash
pnpm build
```

Expected: Build succeeds. Without `CHATBRIDGE_SERVER_URL`, the app uses the original platform — no behavior change.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/platform/server_platform.ts src/renderer/platform/index.ts
git commit -m "feat: add ServerPlatform with fallback delegation"
```

---

### Task 7: Auth Gate in Renderer

**Files:**
- Modify: `src/renderer/index.tsx`

- [ ] **Step 1: Add auth check before app initialization**

In `src/renderer/index.tsx`, add an auth check that runs when `CHATBRIDGE_SERVER_URL` is set. If the user is not authenticated, redirect to the server's login page instead of rendering the app.

Add this before the `initializeApp()` call (after the imports, around line 55):

```typescript
// Auth gate: if server mode is enabled, check session before loading
const serverUrl = process.env.CHATBRIDGE_SERVER_URL
if (serverUrl) {
  const checkAuth = async () => {
    try {
      const res = await fetch(`${serverUrl}/api/auth/session`, {
        credentials: 'include',
      })
      const session = await res.json()
      if (!session?.user) {
        window.location.href = `${serverUrl}/login`
        return false
      }
      return true
    } catch {
      window.location.href = `${serverUrl}/login`
      return false
    }
  }

  checkAuth().then((authenticated) => {
    if (!authenticated) return
    // Continue with normal initialization (existing code below)
    startApp()
  })
} else {
  startApp()
}
```

Wrap the existing `initializeApp()` call and the `.finally()` block in a `function startApp()` so it can be called conditionally.

- [ ] **Step 2: Verify app works without server mode**

```bash
pnpm dev
```

Expected: App starts normally — no auth check, no redirect. Same behavior as before.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/index.tsx
git commit -m "feat: add auth gate for server mode in renderer"
```

---

### Task 8: End-to-End Verification

**Files:** None (manual testing)

- [ ] **Step 1: Start local Supabase**

```bash
cd server && npx supabase start
```

- [ ] **Step 2: Start the Next.js server**

```bash
cd server && pnpm dev
```

Expected: Running on http://localhost:3000

- [ ] **Step 3: Start chatbox in server mode**

```bash
CHATBRIDGE_SERVER_URL=http://localhost:3000 pnpm dev
```

Expected: Chatbox opens but immediately redirects to `http://localhost:3000/login`.

- [ ] **Step 4: Log in**

Enter any email and password on the login page. Expected: redirected back to chatbox, which now loads normally.

- [ ] **Step 5: Verify storage works**

1. Change a setting (e.g., switch theme to dark).
2. Check the database:

```bash
cd server && npx prisma studio
```

Open `UserStorage` table. Expected: a row with `key: "settings"` and the theme value in the JSON.

- [ ] **Step 6: Verify sessions persist**

1. Create a new chat session and send a test message.
2. Close and reopen the app (still with `CHATBRIDGE_SERVER_URL` set).
3. Expected: the session and message are still there — loaded from PostgreSQL, not local storage.

- [ ] **Step 7: Verify original mode still works**

```bash
pnpm dev
```

(Without `CHATBRIDGE_SERVER_URL`.) Expected: app works as before — local storage, no auth.

- [ ] **Step 8: Commit any fixes from testing**

```bash
git add -A
git commit -m "fix: resolve issues found during Phase 1 e2e testing"
```
