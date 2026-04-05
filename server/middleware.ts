import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const DEFAULT_ORIGINS = ['http://localhost:1212', 'http://localhost:3000'] as const
const EXTRA_ORIGINS =
  process.env.CHATBRIDGE_ALLOWED_ORIGINS?.split(',')
    .map((s) => s.trim())
    .filter(Boolean) ?? []

const ALLOWED_ORIGINS = new Set<string>([...DEFAULT_ORIGINS, ...EXTRA_ORIGINS])

export function middleware(request: NextRequest) {
  const origin = request.headers.get('origin') ?? ''
  const isAllowed = ALLOWED_ORIGINS.has(origin)

  // Handle preflight OPTIONS requests
  if (request.method === 'OPTIONS') {
    return new NextResponse(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': isAllowed ? origin : '',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-CSRF-Token, X-Requested-With',
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Max-Age': '86400',
      },
    })
  }

  const response = NextResponse.next()
  if (isAllowed) {
    response.headers.set('Access-Control-Allow-Origin', origin)
    response.headers.set('Access-Control-Allow-Credentials', 'true')
  }
  return response
}

export const config = {
  matcher: '/api/:path*',
}
