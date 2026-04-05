/**
 * ChatBridge Next.js server base URL (no trailing slash).
 * Empty when the renderer uses same-origin paths (Vite dev proxy to the server).
 */
export function getChatbridgeServerBaseUrl(): string {
  const v = process.env.CHATBRIDGE_SERVER_URL
  if (!v || v === 'proxy') return ''
  return v.replace(/\/$/, '')
}

/** Absolute API path on the ChatBridge server, or a same-origin path when using the dev proxy. */
export function chatbridgeApiUrl(path: string): string {
  const base = getChatbridgeServerBaseUrl()
  const normalized = path.startsWith('/') ? path : `/${path}`
  return base ? `${base}${normalized}` : normalized
}
