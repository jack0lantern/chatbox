// server/prisma/seed.ts
import { PrismaClient } from '@prisma/client'
import { randomUUID } from 'crypto'
import { bundledPlugins } from '../lib/plugin-seed'

const prisma = new PrismaClient()

async function main() {
  for (const plugin of bundledPlugins) {
    await prisma.pluginRegistration.upsert({
      where: { appSlug: plugin.appSlug },
      update: {
        appName: plugin.appName,
        description: plugin.description,
        iframeUrl: plugin.iframeUrl,
        authPattern: plugin.authPattern,
        oauthProvider: plugin.oauthProvider ?? null,
        toolSchemas: plugin.toolSchemas,
        permissions: plugin.permissions,
      },
      create: {
        appSlug: plugin.appSlug,
        appName: plugin.appName,
        description: plugin.description,
        iframeUrl: plugin.iframeUrl,
        authPattern: plugin.authPattern,
        oauthProvider: plugin.oauthProvider ?? null,
        toolSchemas: plugin.toolSchemas,
        permissions: plugin.permissions,
        apiKey: randomUUID(),
      },
    })
    console.log(`Seeded plugin: ${plugin.appSlug}`)
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e)
    prisma.$disconnect()
    process.exit(1)
  })
