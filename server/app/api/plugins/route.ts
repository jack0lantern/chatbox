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
