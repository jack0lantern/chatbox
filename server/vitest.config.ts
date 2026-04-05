import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    env: (() => {
      const fs = require('fs')
      const envPath = path.resolve(__dirname, '.env.local')
      if (!fs.existsSync(envPath)) return {}
      const content = fs.readFileSync(envPath, 'utf-8')
      const env: Record<string, string> = {}
      for (const line of content.split('\n')) {
        const match = line.match(/^([^#=]+)=(.*)$/)
        if (match) {
          env[match[1].trim()] = match[2].trim().replace(/^["']|["']$/g, '')
        }
      }
      return env
    })(),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
})
