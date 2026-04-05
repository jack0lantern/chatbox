import { getServerSession } from 'next-auth'
import { NextResponse } from 'next/server'
import { authOptions } from '@/lib/auth'
import { getProviderConfig, buildProviderRequest } from '@/lib/llm-proxy'

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const userId = (session.user as any).id as string
  const body = await req.json()
  const { provider, model, messages, temperature, topP, tools } = body

  if (!provider || !model || !messages) {
    return NextResponse.json(
      { error: 'Missing required fields: provider, model, messages' },
      { status: 400 }
    )
  }

  const config = await getProviderConfig(userId, provider)
  if (!config) {
    return NextResponse.json(
      { error: `No API key configured for provider: ${provider}` },
      { status: 400 }
    )
  }

  const { headers, body: requestBody } = buildProviderRequest(
    provider,
    { provider, model, messages, temperature, topP, tools },
    config.apiKey
  )

  const url = `${config.apiHost}${config.apiPath}`

  try {
    const providerResponse = await fetch(url, {
      method: 'POST',
      headers,
      body: requestBody,
    })

    if (!providerResponse.ok) {
      const errorText = await providerResponse.text()
      return NextResponse.json(
        { error: `Provider error: ${providerResponse.status}`, details: errorText },
        { status: providerResponse.status }
      )
    }

    if (!providerResponse.body) {
      return NextResponse.json({ error: 'No response body from provider' }, { status: 502 })
    }

    return new Response(providerResponse.body, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    })
  } catch (error) {
    return NextResponse.json(
      { error: `Failed to reach provider: ${error}` },
      { status: 502 }
    )
  }
}
