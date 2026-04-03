import { decrypt } from './encryption'
import { prisma } from './prisma'

interface ProxyRequest {
  provider: string
  model: string
  messages: Array<{ role: string; content: string }>
  temperature?: number
  topP?: number
  tools?: Array<Record<string, unknown>>
}

interface ProviderConfig {
  apiKey: string
  apiHost: string
  apiPath: string
}

const PROVIDER_DEFAULTS: Record<string, { host: string; path: string }> = {
  openai: { host: 'https://api.openai.com', path: '/v1/chat/completions' },
  claude: { host: 'https://api.anthropic.com', path: '/v1/messages' },
  deepseek: { host: 'https://api.deepseek.com', path: '/v1/chat/completions' },
}

export async function getProviderConfig(userId: string, provider: string): Promise<ProviderConfig | null> {
  const settingsRow = await prisma.userStorage.findUnique({
    where: { userId_key: { userId, key: 'settings' } },
  })
  if (!settingsRow?.value) return null

  const settings = settingsRow.value as Record<string, unknown>
  const providers = settings.providers as Record<string, Record<string, unknown>> | undefined
  if (!providers?.[provider]) return null

  const providerSettings = providers[provider]
  const encryptedKey = providerSettings.apiKey as string | undefined
  if (!encryptedKey) return null

  const defaults = PROVIDER_DEFAULTS[provider] ?? { host: '', path: '/v1/chat/completions' }

  return {
    apiKey: decrypt(encryptedKey),
    apiHost: (providerSettings.apiHost as string) || defaults.host,
    apiPath: (providerSettings.apiPath as string) || defaults.path,
  }
}

export function buildProviderRequest(provider: string, req: ProxyRequest, apiKey: string) {
  return {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: req.model,
      messages: req.messages,
      temperature: req.temperature,
      top_p: req.topP,
      stream: true,
      ...(req.tools ? { tools: req.tools } : {}),
    }),
  }
}
