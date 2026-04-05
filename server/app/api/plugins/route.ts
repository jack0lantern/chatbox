import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

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

  return NextResponse.json(plugins)
}
