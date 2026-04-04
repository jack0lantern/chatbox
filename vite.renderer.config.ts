/**
 * Standalone Vite config for the renderer process — used by Playwright e2e tests.
 * Runs the renderer dev server without Electron.
 *
 * Usage: CHATBRIDGE_SERVER_URL=http://localhost:3000 npx vite -c vite.renderer.config.ts
 */
import path from 'node:path'
import { TanStackRouterVite } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  root: path.resolve(__dirname, 'src/renderer'),
  plugins: [
    TanStackRouterVite({
      routesDirectory: path.resolve(__dirname, 'src/renderer/routes'),
      generatedRouteTree: path.resolve(__dirname, 'src/renderer/routeTree.gen.ts'),
    }),
    react(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src/renderer'),
      '@shared': path.resolve(__dirname, 'src/shared'),
    },
  },
  server: {
    port: 1212,
    strictPort: true,
    proxy: process.env.CHATBRIDGE_SERVER_URL
      ? {
          '/api': {
            target: process.env.CHATBRIDGE_SERVER_URL,
            changeOrigin: true,
            cookieDomainRewrite: 'localhost',
          },
          '/plugins': {
            target: process.env.CHATBRIDGE_SERVER_URL,
            changeOrigin: true,
          },
        }
      : undefined,
  },
  define: {
    'process.type': '"renderer"',
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development'),
    'process.env.CHATBOX_BUILD_TARGET': JSON.stringify('web'),
    'process.env.CHATBOX_BUILD_PLATFORM': JSON.stringify('web'),
    'process.env.CHATBOX_BUILD_CHANNEL': JSON.stringify('unknown'),
    'process.env.USE_LOCAL_API': JSON.stringify(''),
    'process.env.USE_BETA_API': JSON.stringify(''),
    // Proxy handles /api routing. Use empty base URL so fetches are same-origin.
    // CHATBRIDGE_ENABLED activates ChatBridge mode independently from the URL.
    'process.env.CHATBRIDGE_SERVER_URL': JSON.stringify(''),
    'process.env.CHATBRIDGE_ENABLED': JSON.stringify(process.env.CHATBRIDGE_SERVER_URL ? 'true' : ''),
  },
})
