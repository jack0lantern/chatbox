import { describe, expect, it, beforeEach } from 'vitest'
import { prisma } from '../lib/prisma'
import { encrypt } from '../lib/encryption'
import { getProviderConfig, buildProviderRequest } from '../lib/llm-proxy'

const TEST_USER_ID = 'test-user-llm-proxy'

describe('llm-proxy', () => {
  beforeEach(async () => {
    await prisma.user.upsert({
      where: { id: TEST_USER_ID },
      update: {},
      create: { id: TEST_USER_ID, email: 'test-llm@test.com' },
    })
    await prisma.userStorage.deleteMany({ where: { userId: TEST_USER_ID } })
  })

  it('getProviderConfig returns decrypted API key', async () => {
    const encryptedKey = encrypt('sk-test-key-123')
    await prisma.userStorage.create({
      data: {
        userId: TEST_USER_ID,
        key: 'settings',
        value: { providers: { openai: { apiKey: encryptedKey } } },
      },
    })
    const config = await getProviderConfig(TEST_USER_ID, 'openai')
    expect(config).not.toBeNull()
    expect(config!.apiKey).toBe('sk-test-key-123')
    expect(config!.apiHost).toBe('https://api.openai.com')
    expect(config!.apiPath).toBe('/v1/chat/completions')
  })

  it('getProviderConfig returns null for missing provider', async () => {
    await prisma.userStorage.create({
      data: { userId: TEST_USER_ID, key: 'settings', value: { providers: {} } },
    })
    const config = await getProviderConfig(TEST_USER_ID, 'openai')
    expect(config).toBeNull()
  })

  it('getProviderConfig uses custom host if set', async () => {
    const encryptedKey = encrypt('sk-custom')
    await prisma.userStorage.create({
      data: {
        userId: TEST_USER_ID,
        key: 'settings',
        value: { providers: { openai: { apiKey: encryptedKey, apiHost: 'https://my-proxy.example.com' } } },
      },
    })
    const config = await getProviderConfig(TEST_USER_ID, 'openai')
    expect(config!.apiHost).toBe('https://my-proxy.example.com')
  })

  it('buildProviderRequest creates OpenAI-compatible request', () => {
    const result = buildProviderRequest('openai', {
      provider: 'openai', model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'hello' }], temperature: 0.7,
    }, 'sk-test')
    expect(result.headers.Authorization).toBe('Bearer sk-test')
    const body = JSON.parse(result.body)
    expect(body.model).toBe('gpt-4o-mini')
    expect(body.stream).toBe(true)
  })

  it('buildProviderRequest includes tools when provided', () => {
    const tools = [{ type: 'function', function: { name: 'test', parameters: {} } }]
    const result = buildProviderRequest('openai', {
      provider: 'openai', model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'hello' }], tools,
    }, 'sk-test')
    const body = JSON.parse(result.body)
    expect(body.tools).toEqual(tools)
  })

  it('getProviderConfig returns null when settings key does not exist', async () => {
    // No UserStorage row created at all
    const config = await getProviderConfig(TEST_USER_ID, 'openai')
    expect(config).toBeNull()
  })

  it('getProviderConfig returns null when apiKey field is missing from provider config', async () => {
    await prisma.userStorage.create({
      data: {
        userId: TEST_USER_ID,
        key: 'settings',
        value: { providers: { openai: { apiHost: 'https://api.openai.com' } } },
      },
    })
    const config = await getProviderConfig(TEST_USER_ID, 'openai')
    expect(config).toBeNull()
  })

  it('buildProviderRequest does NOT include tools key when tools is undefined', () => {
    const result = buildProviderRequest('openai', {
      provider: 'openai', model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'hello' }],
      // tools intentionally omitted
    }, 'sk-test')
    const body = JSON.parse(result.body)
    expect('tools' in body).toBe(false)
  })

  it('buildProviderRequest handles missing optional fields (temperature, topP undefined)', () => {
    const result = buildProviderRequest('openai', {
      provider: 'openai', model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'hello' }],
      // temperature and topP intentionally omitted
    }, 'sk-test')
    const body = JSON.parse(result.body)
    expect(body.model).toBe('gpt-4o-mini')
    expect(body.stream).toBe(true)
    expect(body.temperature).toBeUndefined()
    expect(body.top_p).toBeUndefined()
  })
})
