import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './server/__tests__',
  testMatch: '**/*.e2e.ts',
  timeout: 30000,
  use: {
    headless: true,
    baseURL: 'http://localhost:3000',
  },
})
