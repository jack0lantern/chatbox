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
