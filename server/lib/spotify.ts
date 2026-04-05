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
