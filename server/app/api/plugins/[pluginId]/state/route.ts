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
