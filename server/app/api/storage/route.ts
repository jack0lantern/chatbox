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
