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
