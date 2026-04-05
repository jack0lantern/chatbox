import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

function chatbridgeServerOrigin(): string {
  const url = process.env.NEXTAUTH_URL
  if (url) {
    try {
      return new URL(url).origin
    } catch {
      /* fall through */
    }
  }
  return 'http://localhost:3000'
}

function withIframeMessageOrigins(permissions: unknown, serverOrigin: string) {
  const p = permissions && typeof permissions === 'object' ? { ...(permissions as Record<string, unknown>) } : {}
  const existing = Array.isArray(p.allowedOrigins)
    ? (p.allowedOrigins as string[]).filter((x) => typeof x === 'string')
    : []
  p.allowedOrigins = [...new Set([...existing, serverOrigin])]
  return p
}

// Plugin schemas are public data — the AI needs them for tool discovery.
// No auth required for listing active plugins.
export async function GET() {
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

  const serverOrigin = chatbridgeServerOrigin()
  return NextResponse.json(
    plugins.map((plugin) => ({
      ...plugin,
      permissions: withIframeMessageOrigins(plugin.permissions, serverOrigin),
    }))
  )
}
