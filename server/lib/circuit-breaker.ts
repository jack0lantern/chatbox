import { prisma } from './prisma'

const FAILURE_THRESHOLD = 3

export async function recordFailure(appSlug: string): Promise<void> {
  try {
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
  } catch {
    // Plugin not registered; nothing to track
  }
}

export async function recordSuccess(appSlug: string): Promise<void> {
  try {
    await prisma.pluginRegistration.update({
      where: { appSlug },
      data: { failureCount: 0, status: 'active' },
    })
  } catch {
    // Plugin not registered; nothing to track
  }
}

export async function isReliable(appSlug: string): Promise<boolean> {
  const plugin = await prisma.pluginRegistration.findUnique({
    where: { appSlug },
    select: { status: true },
  })
  return plugin?.status === 'active'
}
