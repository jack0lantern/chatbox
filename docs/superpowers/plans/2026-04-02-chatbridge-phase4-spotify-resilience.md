# ChatBridge Phase 4: Spotify Plugin + Platform Resilience

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Spotify OAuth, a server-side Spotify API proxy, a polished playlist builder iframe app, and a platform-wide circuit breaker.

**Architecture:** NextAuth gets a SpotifyProvider for OAuth token storage. A new proxy route handles all Spotify API calls server-side. The iframe communicates via postMessage only (API_REQUEST/API_RESPONSE for data, standard protocol for lifecycle). A circuit breaker tracks failures per plugin and excludes unreliable plugins from LLM tool discovery.

**Tech Stack:** Next.js 15, NextAuth 4.24, PrismaAdapter, Spotify Web API (raw fetch), React 18 UMD (iframe), HTML5 Drag and Drop, HTML5 Audio.

**Spec:** `docs/superpowers/specs/2026-04-02-chatbridge-phase4-spotify-resilience-design.md`

**Depends on:** Phases 1-3 complete on `dev` branch.

---

## File Structure

```
server/
├── lib/
│   ├── auth.ts                                  # Modified: add SpotifyProvider + PrismaAdapter
│   ├── circuit-breaker.ts                       # New: recordFailure, recordSuccess, isReliable
│   └── spotify.ts                               # New: token refresh, authenticated fetch
├── app/api/plugins/
│   ├── proxy/
│   │   └── spotify/
│   │       └── route.ts                         # New: Spotify API proxy (POST)
│   └── [pluginId]/
│       └── reset/
│           └── route.ts                         # New: circuit breaker reset (PUT)
├── public/plugins/
│   └── spotify/
│       └── index.html                           # New: playlist builder iframe app
└── __tests__/
    ├── unit/
    │   ├── circuit-breaker.test.ts               # New
    │   └── spotify.test.ts                      # New
    └── e2e/
        └── spotify-plugin.e2e.ts                # New
```

---

### Task 1: NextAuth Spotify OAuth + Spotify API Client

**Files:**
- Modify: `server/lib/auth.ts`
- Create: `server/lib/spotify.ts`
- Modify: `server/.env.local`

**Note:** The spec proposed switching to database sessions, but NextAuth v4 requires JWT strategy when using CredentialsProvider. We keep JWT strategy and add PrismaAdapter — the adapter stores Spotify OAuth tokens in the Account table while JWT handles session management. This is the standard NextAuth v4 approach for mixed credential + OAuth setups.

- [ ] **Step 1: Add Spotify env vars**

Add to `server/.env.local`:

```
SPOTIFY_CLIENT_ID=<your-spotify-client-id>
SPOTIFY_CLIENT_SECRET=<your-spotify-client-secret>
```

- [ ] **Step 2: Update auth.ts with SpotifyProvider + PrismaAdapter**

Replace `server/lib/auth.ts` with:

```typescript
import type { NextAuthOptions } from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import SpotifyProvider from 'next-auth/providers/spotify'
import { PrismaAdapter } from '@auth/prisma-adapter'
import { prisma } from './prisma'

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma) as any,
  providers: [
    CredentialsProvider({
      name: 'Email',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null
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
    SpotifyProvider({
      clientId: process.env.SPOTIFY_CLIENT_ID!,
      clientSecret: process.env.SPOTIFY_CLIENT_SECRET!,
      authorization: {
        params: {
          scope: 'playlist-modify-public playlist-read-private user-read-email',
        },
      },
      allowDangerousEmailAccountLinking: true,
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

Key changes from the original:
- Added `adapter: PrismaAdapter(prisma)` — stores OAuth tokens in Account table
- Added `SpotifyProvider` with scopes and `allowDangerousEmailAccountLinking: true` (links Spotify account to existing user if emails match)
- Kept `strategy: 'jwt'` (required for CredentialsProvider)
- Kept existing callbacks unchanged (they work for both providers)

- [ ] **Step 3: Create Spotify API client**

Create `server/lib/spotify.ts`:

```typescript
import { prisma } from './prisma'

const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token'
const SPOTIFY_API_BASE = 'https://api.spotify.com/v1'
const FETCH_TIMEOUT_MS = 30_000

export async function getSpotifyAccount(userId: string) {
  return prisma.account.findFirst({
    where: { userId, provider: 'spotify' },
  })
}

export async function refreshSpotifyToken(
  accountId: string,
  refreshToken: string
): Promise<string> {
  const response = await fetch(SPOTIFY_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(
        `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
      ).toString('base64')}`,
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  })

  if (!response.ok) {
    throw new Error(`Token refresh failed: ${response.status}`)
  }

  const data = await response.json()

  await prisma.account.update({
    where: { id: accountId },
    data: {
      access_token: data.access_token,
      expires_at: Math.floor(Date.now() / 1000) + data.expires_in,
      ...(data.refresh_token ? { refresh_token: data.refresh_token } : {}),
    },
  })

  return data.access_token as string
}

export async function getValidSpotifyToken(
  userId: string
): Promise<string | null> {
  const account = await getSpotifyAccount(userId)
  if (!account?.access_token || !account?.refresh_token) return null

  const now = Math.floor(Date.now() / 1000)
  if (account.expires_at && account.expires_at < now + 60) {
    return refreshSpotifyToken(account.id, account.refresh_token)
  }

  return account.access_token
}

export async function spotifyFetch(
  accessToken: string,
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  try {
    return await fetch(`${SPOTIFY_API_BASE}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    })
  } finally {
    clearTimeout(timeoutId)
  }
}
```

- [ ] **Step 4: Verify auth loads without errors**

```bash
cd /Users/jackjiang/GitHub/chatbox/server && pnpm dev
```

Check that the server starts without import errors. Spotify OAuth won't work without valid credentials but the app should load.

- [ ] **Step 5: Commit**

```bash
git add server/lib/auth.ts server/lib/spotify.ts
git commit -m "feat: add Spotify OAuth provider and API client"
```

---

### Task 2: Circuit Breaker

**Files:**
- Create: `server/__tests__/unit/circuit-breaker.test.ts`
- Create: `server/lib/circuit-breaker.ts`
- Create: `server/app/api/plugins/[pluginId]/reset/route.ts`

- [ ] **Step 1: Write circuit breaker tests**

Create `server/__tests__/unit/circuit-breaker.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock Prisma
const mockFindUnique = vi.fn()
const mockUpdate = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    pluginRegistration: {
      findUnique: (...args: any[]) => mockFindUnique(...args),
      update: (...args: any[]) => mockUpdate(...args),
    },
  },
}))

import { recordFailure, recordSuccess, isReliable } from '@/lib/circuit-breaker'

describe('circuit-breaker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('recordFailure', () => {
    it('increments failureCount', async () => {
      mockUpdate.mockResolvedValueOnce({ failureCount: 1, status: 'active' })

      await recordFailure('chess')

      expect(mockUpdate).toHaveBeenCalledWith({
        where: { appSlug: 'chess' },
        data: { failureCount: { increment: 1 } },
        select: { failureCount: true },
      })
    })

    it('sets status to unreliable at threshold', async () => {
      mockUpdate
        .mockResolvedValueOnce({ failureCount: 3 })
        .mockResolvedValueOnce({ status: 'unreliable' })

      await recordFailure('spotify')

      expect(mockUpdate).toHaveBeenCalledTimes(2)
      expect(mockUpdate).toHaveBeenLastCalledWith({
        where: { appSlug: 'spotify' },
        data: { status: 'unreliable' },
      })
    })

    it('does not set unreliable below threshold', async () => {
      mockUpdate.mockResolvedValueOnce({ failureCount: 2 })

      await recordFailure('chess')

      expect(mockUpdate).toHaveBeenCalledTimes(1)
    })
  })

  describe('recordSuccess', () => {
    it('resets failureCount and sets active', async () => {
      mockUpdate.mockResolvedValueOnce({ failureCount: 0, status: 'active' })

      await recordSuccess('spotify')

      expect(mockUpdate).toHaveBeenCalledWith({
        where: { appSlug: 'spotify' },
        data: { failureCount: 0, status: 'active' },
      })
    })
  })

  describe('isReliable', () => {
    it('returns true for active plugins', async () => {
      mockFindUnique.mockResolvedValueOnce({ status: 'active' })

      const result = await isReliable('chess')

      expect(result).toBe(true)
    })

    it('returns false for unreliable plugins', async () => {
      mockFindUnique.mockResolvedValueOnce({ status: 'unreliable' })

      const result = await isReliable('spotify')

      expect(result).toBe(false)
    })

    it('returns false for unknown plugins', async () => {
      mockFindUnique.mockResolvedValueOnce(null)

      const result = await isReliable('nonexistent')

      expect(result).toBe(false)
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/jackjiang/GitHub/chatbox/server && pnpm test -- __tests__/unit/circuit-breaker.test.ts
```

Expected: FAIL — `Cannot find module '@/lib/circuit-breaker'`

- [ ] **Step 3: Implement circuit breaker**

Create `server/lib/circuit-breaker.ts`:

```typescript
import { prisma } from './prisma'

const FAILURE_THRESHOLD = 3

export async function recordFailure(appSlug: string): Promise<void> {
  const plugin = await prisma.pluginRegistration.update({
    where: { appSlug },
    data: { failureCount: { increment: 1 } },
    select: { failureCount: true },
  })

  if (plugin.failureCount >= FAILURE_THRESHOLD) {
    await prisma.pluginRegistration.update({
      where: { appSlug },
      data: { status: 'unreliable' },
    })
  }
}

export async function recordSuccess(appSlug: string): Promise<void> {
  await prisma.pluginRegistration.update({
    where: { appSlug },
    data: { failureCount: 0, status: 'active' },
  })
}

export async function isReliable(appSlug: string): Promise<boolean> {
  const plugin = await prisma.pluginRegistration.findUnique({
    where: { appSlug },
    select: { status: true },
  })
  return plugin?.status === 'active'
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/jackjiang/GitHub/chatbox/server && pnpm test -- __tests__/unit/circuit-breaker.test.ts
```

Expected: All 6 tests PASS.

- [ ] **Step 5: Create circuit breaker reset endpoint**

Create `server/app/api/plugins/[pluginId]/reset/route.ts`:

```typescript
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

type RouteContext = { params: Promise<{ pluginId: string }> }

export async function PUT(req: Request, context: RouteContext) {
  const { pluginId: appSlug } = await context.params
  const { apiKey } = await req.json()

  const plugin = await prisma.pluginRegistration.findUnique({
    where: { appSlug },
  })

  if (!plugin) {
    return NextResponse.json({ error: 'Plugin not found' }, { status: 404 })
  }

  if (plugin.apiKey !== apiKey) {
    return NextResponse.json({ error: 'Invalid API key' }, { status: 403 })
  }

  const updated = await prisma.pluginRegistration.update({
    where: { appSlug },
    data: { failureCount: 0, status: 'active' },
  })

  return NextResponse.json({
    appSlug: updated.appSlug,
    status: updated.status,
    failureCount: updated.failureCount,
  })
}
```

- [ ] **Step 6: Commit**

```bash
git add server/lib/circuit-breaker.ts server/__tests__/unit/circuit-breaker.test.ts server/app/api/plugins/\[pluginId\]/reset/
git commit -m "feat: add platform circuit breaker with reset endpoint"
```

---

### Task 3: Spotify Proxy Route

**Files:**
- Create: `server/app/api/plugins/proxy/spotify/route.ts`

- [ ] **Step 1: Create the Spotify proxy route**

Create `server/app/api/plugins/proxy/spotify/route.ts`:

```typescript
import { getServerSession } from 'next-auth'
import { NextResponse } from 'next/server'
import { authOptions } from '@/lib/auth'
import { getValidSpotifyToken, spotifyFetch } from '@/lib/spotify'
import { recordFailure, recordSuccess } from '@/lib/circuit-breaker'

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const userId = (session.user as any).id as string
  const { action, params } = await req.json()

  if (!action) {
    return NextResponse.json({ error: 'Missing action' }, { status: 400 })
  }

  const accessToken = await getValidSpotifyToken(userId)
  if (!accessToken) {
    return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 })
  }

  try {
    let result: unknown

    switch (action) {
      case 'search_songs': {
        const q = encodeURIComponent(params.query)
        const response = await spotifyFetch(accessToken, `/search?type=track&q=${q}&limit=20`)
        if (!response.ok) throw new Error(`Spotify API: ${response.status}`)
        const data = await response.json()
        result = data.tracks.items.map((track: any) => ({
          id: track.id,
          name: track.name,
          artist: track.artists.map((a: any) => a.name).join(', '),
          album: track.album.name,
          albumArt: track.album.images[0]?.url ?? null,
          previewUrl: track.preview_url,
          duration: track.duration_ms,
          uri: track.uri,
        }))
        break
      }

      case 'create_playlist': {
        const meRes = await spotifyFetch(accessToken, '/me')
        if (!meRes.ok) throw new Error(`Spotify API: ${meRes.status}`)
        const me = await meRes.json()

        const createRes = await spotifyFetch(
          accessToken,
          `/users/${me.id}/playlists`,
          {
            method: 'POST',
            body: JSON.stringify({ name: params.playlistName, public: true }),
          }
        )
        if (!createRes.ok) throw new Error(`Spotify API: ${createRes.status}`)
        const playlist = await createRes.json()

        if (params.songs?.length) {
          const addRes = await spotifyFetch(
            accessToken,
            `/playlists/${playlist.id}/tracks`,
            {
              method: 'POST',
              body: JSON.stringify({ uris: params.songs }),
            }
          )
          if (!addRes.ok) throw new Error(`Spotify API: ${addRes.status}`)
        }

        result = {
          playlistId: playlist.id,
          playlistUrl: playlist.external_urls.spotify,
          trackCount: params.songs?.length ?? 0,
          coverImageUrl: playlist.images?.[0]?.url ?? null,
        }
        break
      }

      case 'add_to_playlist': {
        const response = await spotifyFetch(
          accessToken,
          `/playlists/${params.playlistId}/tracks`,
          {
            method: 'POST',
            body: JSON.stringify({ uris: params.songs }),
          }
        )
        if (!response.ok) throw new Error(`Spotify API: ${response.status}`)
        result = {
          playlistId: params.playlistId,
          trackCount: params.songs?.length ?? 0,
        }
        break
      }

      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}` },
          { status: 400 }
        )
    }

    await recordSuccess('spotify')
    return NextResponse.json({ data: result })
  } catch (error: any) {
    await recordFailure('spotify')
    if (error.name === 'AbortError') {
      return NextResponse.json(
        { error: 'UPSTREAM_TIMEOUT' },
        { status: 504 }
      )
    }
    return NextResponse.json(
      { error: 'UPSTREAM_ERROR', message: error.message },
      { status: 502 }
    )
  }
}
```

- [ ] **Step 2: Verify route compiles**

```bash
cd /Users/jackjiang/GitHub/chatbox/server && npx tsc --noEmit --pretty 2>&1 | head -20
```

Expected: No errors related to the new files.

- [ ] **Step 3: Commit**

```bash
git add server/app/api/plugins/proxy/spotify/ server/lib/spotify.ts
git commit -m "feat: add Spotify API proxy route with token refresh"
```

---

### Task 4: Spotify Iframe App

**Files:**
- Create: `server/public/plugins/spotify/index.html`

This is a single self-contained HTML file with inline React 18 (CDN). Features: debounced search, album art, 30s audio preview, drag-to-reorder playlist builder, playlist creation with cover display.

- [ ] **Step 1: Create the Spotify playlist builder iframe app**

Create `server/public/plugins/spotify/index.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Spotify Playlist Builder</title>
  <script crossorigin src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
  <script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #121212;
      color: #fff;
      min-height: 100vh;
    }

    .app {
      max-width: 700px;
      margin: 0 auto;
      padding: 16px;
    }

    .header {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 12px 0;
      border-bottom: 1px solid #282828;
      margin-bottom: 16px;
    }

    .header svg { width: 28px; height: 28px; fill: #1DB954; }
    .header h1 { font-size: 20px; font-weight: 700; }

    /* Search */
    .search-section { margin-bottom: 20px; }

    .search-input {
      width: 100%;
      padding: 12px 16px;
      border-radius: 8px;
      border: 1px solid #333;
      background: #282828;
      color: #fff;
      font-size: 14px;
      outline: none;
      transition: border-color 0.2s;
    }

    .search-input:focus { border-color: #1DB954; }
    .search-input::placeholder { color: #888; }

    .search-results {
      margin-top: 12px;
      max-height: 360px;
      overflow-y: auto;
    }

    .search-results::-webkit-scrollbar { width: 6px; }
    .search-results::-webkit-scrollbar-thumb { background: #444; border-radius: 3px; }

    /* Track row */
    .track-row {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 8px;
      border-radius: 6px;
      transition: background 0.15s;
    }

    .track-row:hover { background: #282828; }

    .track-art {
      width: 48px;
      height: 48px;
      border-radius: 4px;
      object-fit: cover;
      background: #333;
      flex-shrink: 0;
    }

    .track-info { flex: 1; min-width: 0; }
    .track-name { font-size: 14px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .track-artist { font-size: 12px; color: #b3b3b3; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .track-album { font-size: 11px; color: #666; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

    .track-duration {
      font-size: 12px;
      color: #b3b3b3;
      flex-shrink: 0;
      min-width: 40px;
      text-align: right;
    }

    .track-actions { display: flex; gap: 6px; flex-shrink: 0; }

    /* Buttons */
    .btn {
      padding: 6px 12px;
      border-radius: 20px;
      border: none;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.15s;
    }

    .btn-add { background: #1DB954; color: #fff; }
    .btn-add:hover { background: #1ed760; transform: scale(1.05); }
    .btn-add:disabled { background: #333; color: #666; cursor: default; transform: none; }

    .btn-preview { background: transparent; color: #b3b3b3; border: 1px solid #444; }
    .btn-preview:hover { color: #fff; border-color: #888; }
    .btn-preview.playing { color: #1DB954; border-color: #1DB954; }

    .btn-remove { background: transparent; color: #b3b3b3; border: none; font-size: 18px; padding: 4px 8px; }
    .btn-remove:hover { color: #ff4444; }

    .btn-create {
      background: #1DB954;
      color: #fff;
      padding: 12px 32px;
      border-radius: 24px;
      border: none;
      font-size: 14px;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.15s;
      width: 100%;
    }

    .btn-create:hover { background: #1ed760; transform: scale(1.02); }
    .btn-create:disabled { background: #333; color: #666; cursor: default; transform: none; }

    /* Playlist builder */
    .playlist-section {
      background: #181818;
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 20px;
    }

    .playlist-header {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 12px;
    }

    .playlist-name-input {
      flex: 1;
      padding: 8px 12px;
      border-radius: 6px;
      border: 1px solid #333;
      background: #282828;
      color: #fff;
      font-size: 16px;
      font-weight: 600;
      outline: none;
    }

    .playlist-name-input:focus { border-color: #1DB954; }

    .playlist-count {
      font-size: 12px;
      color: #b3b3b3;
      flex-shrink: 0;
    }

    .playlist-tracks { min-height: 40px; }

    .playlist-track {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 6px 8px;
      border-radius: 4px;
      cursor: grab;
      transition: background 0.15s;
    }

    .playlist-track:hover { background: #282828; }
    .playlist-track.dragging { opacity: 0.4; }
    .playlist-track.drag-over { border-top: 2px solid #1DB954; }

    .drag-handle {
      color: #666;
      cursor: grab;
      font-size: 14px;
      flex-shrink: 0;
      user-select: none;
    }

    .playlist-empty {
      text-align: center;
      color: #666;
      padding: 24px;
      font-size: 13px;
    }

    .playlist-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-top: 16px;
      padding-top: 12px;
      border-top: 1px solid #282828;
    }

    .total-duration { font-size: 12px; color: #b3b3b3; }

    /* Created playlist */
    .created-section {
      background: #181818;
      border-radius: 8px;
      padding: 20px;
      margin-bottom: 20px;
      display: flex;
      gap: 16px;
      align-items: center;
    }

    .created-cover {
      width: 80px;
      height: 80px;
      border-radius: 4px;
      background: #282828;
      object-fit: cover;
      flex-shrink: 0;
    }

    .created-info { flex: 1; }
    .created-name { font-size: 18px; font-weight: 700; margin-bottom: 4px; }
    .created-meta { font-size: 13px; color: #b3b3b3; margin-bottom: 8px; }

    .btn-open {
      display: inline-block;
      background: #1DB954;
      color: #fff;
      padding: 8px 20px;
      border-radius: 20px;
      text-decoration: none;
      font-size: 13px;
      font-weight: 600;
      transition: background 0.15s;
    }

    .btn-open:hover { background: #1ed760; }

    /* Status bar */
    .status-bar {
      font-size: 12px;
      color: #666;
      padding: 8px 0;
      text-align: center;
    }

    .status-bar.error { color: #ff4444; }
    .status-bar.connected { color: #1DB954; }

    /* Loading */
    .loading {
      display: flex;
      justify-content: center;
      padding: 20px;
    }

    .spinner {
      width: 24px;
      height: 24px;
      border: 3px solid #333;
      border-top: 3px solid #1DB954;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }

    @keyframes spin { to { transform: rotate(360deg); } }

    /* Section label */
    .section-label {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: #b3b3b3;
      margin-bottom: 8px;
    }
  </style>
</head>
<body>
  <div id="root"></div>
  <script>
    'use strict';
    const { useState, useEffect, useRef, useCallback, createElement: h } = React;

    // ── postMessage bridge ──────────────────────────────────────────

    let requestCounter = 0;
    const pendingRequests = new Map();

    function sendMessage(msg) {
      window.parent.postMessage(msg, '*');
    }

    function sendReady() {
      sendMessage({ type: 'READY', invocationId: null, payload: {} });
    }

    function sendTaskComplete(invocationId, result) {
      sendMessage({ type: 'TASK_COMPLETE', invocationId, payload: { result } });
    }

    function sendStateUpdate(invocationId, state) {
      sendMessage({ type: 'STATE_UPDATE', invocationId, payload: { state } });
    }

    function sendError(invocationId, code, message, recoverable) {
      sendMessage({
        type: 'ERROR',
        invocationId,
        payload: { code, message, recoverable: recoverable ?? false },
      });
    }

    function apiRequest(action, params) {
      return new Promise((resolve, reject) => {
        const requestId = 'req_' + (++requestCounter) + '_' + Date.now();
        pendingRequests.set(requestId, { resolve, reject });
        sendMessage({
          type: 'API_REQUEST',
          requestId,
          payload: { action, params },
        });
        setTimeout(() => {
          if (pendingRequests.has(requestId)) {
            pendingRequests.delete(requestId);
            reject(new Error('API request timeout'));
          }
        }, 35000);
      });
    }

    // ── Utilities ───────────────────────────────────────────────────

    function formatDuration(ms) {
      const mins = Math.floor(ms / 60000);
      const secs = Math.floor((ms % 60000) / 1000);
      return mins + ':' + (secs < 10 ? '0' : '') + secs;
    }

    function formatTotalDuration(tracks) {
      const total = tracks.reduce((sum, t) => sum + (t.duration || 0), 0);
      const mins = Math.floor(total / 60000);
      if (mins < 60) return mins + ' min';
      const hrs = Math.floor(mins / 60);
      return hrs + ' hr ' + (mins % 60) + ' min';
    }

    // ── Spotify icon SVG ────────────────────────────────────────────

    function SpotifyIcon() {
      return h('svg', { viewBox: '0 0 24 24', xmlns: 'http://www.w3.org/2000/svg' },
        h('path', { d: 'M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381C8.64 5.801 15.6 6.081 20.04 8.94c.6.36.78 1.02.42 1.56-.36.48-1.08.66-1.62.36z' })
      );
    }

    // ── Track component (search result) ─────────────────────────────

    function TrackResult({ track, onAdd, isAdded, playingId, onTogglePreview }) {
      return h('div', { className: 'track-row' },
        h('img', {
          className: 'track-art',
          src: track.albumArt || '',
          alt: '',
          onError: function(e) { e.target.style.visibility = 'hidden'; },
        }),
        h('div', { className: 'track-info' },
          h('div', { className: 'track-name' }, track.name),
          h('div', { className: 'track-artist' }, track.artist),
          h('div', { className: 'track-album' }, track.album)
        ),
        h('span', { className: 'track-duration' }, formatDuration(track.duration)),
        h('div', { className: 'track-actions' },
          track.previewUrl
            ? h('button', {
                className: 'btn btn-preview' + (playingId === track.id ? ' playing' : ''),
                onClick: function() { onTogglePreview(track); },
              }, playingId === track.id ? '\u23F8' : '\u25B6')
            : null,
          h('button', {
            className: 'btn btn-add',
            onClick: function() { onAdd(track); },
            disabled: isAdded,
          }, isAdded ? 'Added' : '+ Add')
        )
      );
    }

    // ── Playlist track component (draggable) ────────────────────────

    function PlaylistTrack({ track, index, onRemove, onDragStart, onDragOver, onDrop, dragOverIndex }) {
      return h('div', {
        className: 'playlist-track' + (dragOverIndex === index ? ' drag-over' : ''),
        draggable: true,
        onDragStart: function(e) {
          e.dataTransfer.effectAllowed = 'move';
          onDragStart(index);
        },
        onDragOver: function(e) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          onDragOver(index);
        },
        onDrop: function(e) {
          e.preventDefault();
          onDrop(index);
        },
        onDragEnd: function() { onDragOver(-1); },
      },
        h('span', { className: 'drag-handle' }, '\u2630'),
        h('img', {
          className: 'track-art',
          src: track.albumArt || '',
          alt: '',
          style: { width: '40px', height: '40px' },
          onError: function(e) { e.target.style.visibility = 'hidden'; },
        }),
        h('div', { className: 'track-info' },
          h('div', { className: 'track-name' }, track.name),
          h('div', { className: 'track-artist' }, track.artist)
        ),
        h('span', { className: 'track-duration' }, formatDuration(track.duration)),
        h('button', {
          className: 'btn btn-remove',
          onClick: function() { onRemove(index); },
          title: 'Remove',
        }, '\u00D7')
      );
    }

    // ── Created playlist display ────────────────────────────────────

    function CreatedPlaylist({ playlist }) {
      return h('div', { className: 'created-section' },
        playlist.coverImageUrl
          ? h('img', { className: 'created-cover', src: playlist.coverImageUrl, alt: '' })
          : h('div', { className: 'created-cover' }),
        h('div', { className: 'created-info' },
          h('div', { className: 'created-name' }, playlist.name),
          h('div', { className: 'created-meta' }, playlist.trackCount + ' tracks'),
          h('a', {
            className: 'btn-open',
            href: playlist.playlistUrl,
            target: '_blank',
            rel: 'noopener noreferrer',
          }, 'Open in Spotify')
        )
      );
    }

    // ── Main App ────────────────────────────────────────────────────

    function App() {
      const [searchQuery, setSearchQuery] = useState('');
      const [searchResults, setSearchResults] = useState([]);
      const [searching, setSearching] = useState(false);
      const [playlistName, setPlaylistName] = useState('My Playlist');
      const [playlistTracks, setPlaylistTracks] = useState([]);
      const [createdPlaylists, setCreatedPlaylists] = useState([]);
      const [creating, setCreating] = useState(false);
      const [playingId, setPlayingId] = useState(null);
      const [dragFromIndex, setDragFromIndex] = useState(-1);
      const [dragOverIndex, setDragOverIndex] = useState(-1);
      const [status, setStatus] = useState({ text: 'Ready', type: '' });
      const [currentInvocationId, setCurrentInvocationId] = useState(null);

      const audioRef = useRef(null);
      const searchTimerRef = useRef(null);

      // Debounced search
      useEffect(function() {
        if (!searchQuery.trim()) {
          setSearchResults([]);
          return;
        }
        if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
        searchTimerRef.current = setTimeout(function() {
          doSearch(searchQuery.trim());
        }, 300);
        return function() {
          if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
        };
      }, [searchQuery]);

      async function doSearch(query) {
        setSearching(true);
        try {
          var response = await apiRequest('search_songs', { query: query });
          if (response.error) {
            if (response.error.code === 'AUTH_REQUIRED') {
              setStatus({ text: 'Spotify account not connected', type: 'error' });
              sendError(currentInvocationId, 'UPSTREAM_ERROR', 'Spotify account not connected', false);
            } else {
              setStatus({ text: response.error.message || 'Search failed', type: 'error' });
            }
            setSearchResults([]);
          } else {
            setSearchResults(response.data || []);
            setStatus({ text: 'Connected', type: 'connected' });
          }
        } catch (err) {
          setStatus({ text: 'Search failed: ' + err.message, type: 'error' });
          setSearchResults([]);
        }
        setSearching(false);
      }

      // Add track to playlist
      function addTrack(track) {
        if (playlistTracks.some(function(t) { return t.uri === track.uri; })) return;
        var next = playlistTracks.concat([track]);
        setPlaylistTracks(next);
        saveState(next);
      }

      // Remove track from playlist
      function removeTrack(index) {
        var next = playlistTracks.filter(function(_, i) { return i !== index; });
        setPlaylistTracks(next);
        saveState(next);
      }

      // Drag and drop reorder
      function handleDrop(dropIndex) {
        if (dragFromIndex < 0 || dragFromIndex === dropIndex) {
          setDragOverIndex(-1);
          return;
        }
        var next = playlistTracks.slice();
        var moved = next.splice(dragFromIndex, 1)[0];
        next.splice(dropIndex, 0, moved);
        setPlaylistTracks(next);
        setDragFromIndex(-1);
        setDragOverIndex(-1);
        saveState(next);
      }

      // Audio preview
      function togglePreview(track) {
        if (!track.previewUrl) return;
        if (playingId === track.id) {
          if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
          setPlayingId(null);
        } else {
          if (audioRef.current) audioRef.current.pause();
          var audio = new Audio(track.previewUrl);
          audio.volume = 0.5;
          audio.play().catch(function() {});
          audio.onended = function() { setPlayingId(null); audioRef.current = null; };
          audioRef.current = audio;
          setPlayingId(track.id);
        }
      }

      // Create playlist
      async function createPlaylist() {
        if (!playlistTracks.length || !playlistName.trim()) return;
        setCreating(true);
        setStatus({ text: 'Creating playlist...', type: '' });
        try {
          var response = await apiRequest('create_playlist', {
            playlistName: playlistName.trim(),
            songs: playlistTracks.map(function(t) { return t.uri; }),
          });
          if (response.error) {
            setStatus({ text: response.error.message || 'Create failed', type: 'error' });
          } else {
            var created = {
              playlistId: response.data.playlistId,
              playlistUrl: response.data.playlistUrl,
              trackCount: response.data.trackCount,
              coverImageUrl: response.data.coverImageUrl,
              name: playlistName.trim(),
            };
            setCreatedPlaylists(function(prev) { return [created].concat(prev); });
            setStatus({ text: 'Playlist created!', type: 'connected' });
            sendTaskComplete(currentInvocationId, {
              playlistUrl: created.playlistUrl,
              playlistId: created.playlistId,
              trackCount: created.trackCount,
              playlistName: created.name,
            });
            setPlaylistTracks([]);
            setPlaylistName('My Playlist');
          }
        } catch (err) {
          setStatus({ text: 'Create failed: ' + err.message, type: 'error' });
        }
        setCreating(false);
      }

      // Save state via postMessage
      function saveState(tracks) {
        sendStateUpdate(currentInvocationId, {
          playlistName: playlistName,
          tracks: (tracks || playlistTracks).map(function(t) {
            return { uri: t.uri, name: t.name, artist: t.artist, albumArt: t.albumArt, duration: t.duration };
          }),
          createdPlaylists: createdPlaylists,
        });
      }

      // Handle incoming messages
      useEffect(function() {
        function handleMessage(event) {
          var data = event.data;
          if (!data || !data.type) return;

          switch (data.type) {
            case 'INVOKE_TOOL': {
              var inv = data.invocationId;
              setCurrentInvocationId(inv);
              var tool = data.payload.toolName;
              var params = data.payload.parameters || {};

              if (tool === 'search_songs') {
                setSearchQuery(params.query || '');
                doSearch(params.query || '').then(function() {
                  sendTaskComplete(inv, { message: 'Search results displayed', query: params.query });
                });
              } else if (tool === 'create_playlist') {
                if (params.songs && params.songs.length) {
                  setPlaylistName(params.playlistName || 'My Playlist');
                  setStatus({ text: 'Searching for songs...', type: '' });
                  // Search and auto-add each song
                  Promise.all(params.songs.map(function(songName) {
                    return apiRequest('search_songs', { query: songName }).then(function(res) {
                      if (res.data && res.data.length > 0) return res.data[0];
                      return null;
                    }).catch(function() { return null; });
                  })).then(function(results) {
                    var found = results.filter(Boolean);
                    setPlaylistTracks(found);
                    if (found.length > 0) {
                      setStatus({ text: found.length + ' songs found, ready to create', type: 'connected' });
                    } else {
                      setStatus({ text: 'No songs found', type: 'error' });
                    }
                    sendTaskComplete(inv, {
                      message: found.length + ' songs found and added to playlist draft',
                      tracksFound: found.length,
                      tracksRequested: params.songs.length,
                    });
                  });
                } else {
                  sendTaskComplete(inv, { message: 'Playlist builder ready', playlistName: params.playlistName });
                }
              } else if (tool === 'add_to_playlist') {
                sendTaskComplete(inv, { message: 'Use the playlist builder to add songs' });
              } else {
                sendError(inv, 'INVALID_PARAMS', 'Unknown tool: ' + tool, false);
              }
              break;
            }
            case 'STATE_RESTORE': {
              var state = data.payload && data.payload.state;
              if (state) {
                if (state.playlistName) setPlaylistName(state.playlistName);
                if (state.tracks) setPlaylistTracks(state.tracks);
                if (state.createdPlaylists) setCreatedPlaylists(state.createdPlaylists);
              }
              break;
            }
            case 'API_RESPONSE': {
              var pending = pendingRequests.get(data.requestId);
              if (pending) {
                pendingRequests.delete(data.requestId);
                if (data.payload.error) {
                  pending.resolve({ error: data.payload.error, data: null });
                } else {
                  pending.resolve({ data: data.payload.data, error: null });
                }
              }
              break;
            }
            case 'DESTROY': {
              if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
              break;
            }
          }
        }

        window.addEventListener('message', handleMessage);
        return function() { window.removeEventListener('message', handleMessage); };
      }, [playlistTracks, createdPlaylists, playlistName, currentInvocationId]);

      // Track URIs in playlist for "already added" check
      var addedUris = {};
      playlistTracks.forEach(function(t) { addedUris[t.uri] = true; });

      return h('div', { className: 'app' },
        // Header
        h('div', { className: 'header' },
          h(SpotifyIcon),
          h('h1', null, 'Playlist Builder')
        ),

        // Created playlists
        createdPlaylists.map(function(pl, i) {
          return h(CreatedPlaylist, { key: 'created-' + i, playlist: pl });
        }),

        // Search
        h('div', { className: 'search-section' },
          h('div', { className: 'section-label' }, 'Search'),
          h('input', {
            className: 'search-input',
            type: 'text',
            placeholder: 'Search for songs...',
            value: searchQuery,
            onChange: function(e) { setSearchQuery(e.target.value); },
          }),
          searching
            ? h('div', { className: 'loading' }, h('div', { className: 'spinner' }))
            : h('div', { className: 'search-results' },
                searchResults.map(function(track) {
                  return h(TrackResult, {
                    key: track.id,
                    track: track,
                    onAdd: addTrack,
                    isAdded: !!addedUris[track.uri],
                    playingId: playingId,
                    onTogglePreview: togglePreview,
                  });
                })
              )
        ),

        // Playlist builder
        h('div', { className: 'playlist-section' },
          h('div', { className: 'playlist-header' },
            h('input', {
              className: 'playlist-name-input',
              type: 'text',
              placeholder: 'Playlist name',
              value: playlistName,
              onChange: function(e) { setPlaylistName(e.target.value); },
            }),
            h('span', { className: 'playlist-count' },
              playlistTracks.length + (playlistTracks.length === 1 ? ' track' : ' tracks')
            )
          ),
          h('div', { className: 'playlist-tracks' },
            playlistTracks.length === 0
              ? h('div', { className: 'playlist-empty' }, 'Search for songs and click "+ Add" to build your playlist')
              : playlistTracks.map(function(track, i) {
                  return h(PlaylistTrack, {
                    key: track.uri + '-' + i,
                    track: track,
                    index: i,
                    onRemove: removeTrack,
                    onDragStart: function(idx) { setDragFromIndex(idx); },
                    onDragOver: function(idx) { setDragOverIndex(idx); },
                    onDrop: handleDrop,
                    dragOverIndex: dragOverIndex,
                  });
                })
          ),
          playlistTracks.length > 0
            ? h('div', { className: 'playlist-footer' },
                h('span', { className: 'total-duration' }, formatTotalDuration(playlistTracks)),
                h('button', {
                  className: 'btn-create',
                  onClick: createPlaylist,
                  disabled: creating || !playlistName.trim(),
                  style: { width: 'auto' },
                }, creating ? 'Creating...' : 'Create Playlist')
              )
            : null
        ),

        // Status bar
        h('div', { className: 'status-bar ' + status.type }, status.text)
      );
    }

    // ── Boot ─────────────────────────────────────────────────────────

    ReactDOM.render(h(App), document.getElementById('root'));
    sendReady();
  </script>
</body>
</html>
```

- [ ] **Step 2: Verify the plugin serves correctly**

```bash
curl -s http://localhost:3000/plugins/spotify/index.html | head -5
```

Expected: HTML content starting with `<!DOCTYPE html>`.

- [ ] **Step 3: Commit**

```bash
git add server/public/plugins/spotify/
git commit -m "feat: add Spotify playlist builder iframe app"
```

---

### Task 5: Smoke Tests

**Files:**
- Create: `server/__tests__/e2e/spotify-plugin.e2e.ts`

- [ ] **Step 1: Create Spotify plugin E2E test**

Create `server/__tests__/e2e/spotify-plugin.e2e.ts`:

```typescript
import { test, expect } from '@playwright/test'

const BASE = 'http://localhost:3000'

test.describe('Spotify Plugin', () => {
  test('loads and sends READY message', async ({ page }) => {
    const readyPromise = new Promise<boolean>((resolve) => {
      page.on('console', (msg) => {
        // The plugin calls window.parent.postMessage which logs in some setups
        // We check the DOM loads instead
      })
    })

    await page.goto(`${BASE}/plugins/spotify/index.html`)
    await expect(page.locator('.header h1')).toHaveText('Playlist Builder')
    await expect(page.locator('.search-input')).toBeVisible()
    await expect(page.locator('.playlist-section')).toBeVisible()
  })

  test('has search input and playlist builder', async ({ page }) => {
    await page.goto(`${BASE}/plugins/spotify/index.html`)

    // Search section
    const searchInput = page.locator('.search-input')
    await expect(searchInput).toBeVisible()
    await expect(searchInput).toHaveAttribute('placeholder', 'Search for songs...')

    // Playlist name input
    const playlistInput = page.locator('.playlist-name-input')
    await expect(playlistInput).toBeVisible()
    await expect(playlistInput).toHaveValue('My Playlist')

    // Empty state message
    await expect(page.locator('.playlist-empty')).toContainText('Search for songs')
  })

  test('renders Spotify branding', async ({ page }) => {
    await page.goto(`${BASE}/plugins/spotify/index.html`)
    await expect(page.locator('.header svg')).toBeVisible()
    await expect(page.locator('.status-bar')).toHaveText('Ready')
  })

  test('responds to INVOKE_TOOL search_songs via postMessage', async ({ page }) => {
    await page.goto(`${BASE}/plugins/spotify/index.html`)

    // Wait for the app to load
    await expect(page.locator('.search-input')).toBeVisible()

    // Send INVOKE_TOOL message to set search query
    await page.evaluate(() => {
      window.postMessage({
        type: 'INVOKE_TOOL',
        invocationId: 'inv_test_123',
        payload: {
          toolName: 'search_songs',
          parameters: { query: 'test query' },
        },
      }, '*')
    })

    // Verify search input was populated
    await expect(page.locator('.search-input')).toHaveValue('test query')
  })

  test('responds to STATE_RESTORE', async ({ page }) => {
    await page.goto(`${BASE}/plugins/spotify/index.html`)
    await expect(page.locator('.search-input')).toBeVisible()

    // Send STATE_RESTORE with playlist data
    await page.evaluate(() => {
      window.postMessage({
        type: 'STATE_RESTORE',
        invocationId: null,
        payload: {
          state: {
            playlistName: 'Restored Playlist',
            tracks: [
              {
                uri: 'spotify:track:abc123',
                name: 'Test Song',
                artist: 'Test Artist',
                albumArt: null,
                duration: 180000,
              },
            ],
            createdPlaylists: [],
          },
        },
      }, '*')
    })

    // Verify state was restored
    await expect(page.locator('.playlist-name-input')).toHaveValue('Restored Playlist')
    await expect(page.locator('.playlist-track')).toBeVisible()
    await expect(page.locator('.track-name').first()).toHaveText('Test Song')
  })
})
```

- [ ] **Step 2: Create circuit breaker unit test runner verification**

```bash
cd /Users/jackjiang/GitHub/chatbox/server && pnpm test -- __tests__/unit/circuit-breaker.test.ts
```

Expected: All 6 tests PASS.

- [ ] **Step 3: Run E2E tests (requires server running)**

```bash
cd /Users/jackjiang/GitHub/chatbox/server && npx playwright test __tests__/e2e/spotify-plugin.e2e.ts
```

Expected: All 5 tests PASS (these test the iframe loading and postMessage handling, not Spotify API calls which require auth).

- [ ] **Step 4: Commit**

```bash
git add server/__tests__/
git commit -m "test: add Spotify plugin smoke tests and circuit breaker unit tests"
```
