import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './server/__tests__',
  testMatch: '**/*.e2e.ts',
  timeout: 60000,
  use: {
    headless: true,
    baseURL: 'http://localhost:3000',
  },
  webServer: [
    {
      command: 'npm run dev',
      url: 'http://localhost:3000',
      cwd: './server',
      reuseExistingServer: true,
      timeout: 30000,
    },
    {
      command: 'CHATBRIDGE_SERVER_URL=http://localhost:3000 npx vite -c vite.renderer.config.ts',
      url: 'http://localhost:1212',
      reuseExistingServer: true,
      timeout: 60000,
    },
  ],
})
