import type { NextConfig } from 'next'

// Inlined at build so Edge middleware sees Railway build-time env (runtime-only env is empty in middleware).
const nextConfig: NextConfig = {
  env: {
    CHATBRIDGE_ALLOWED_ORIGINS: process.env.CHATBRIDGE_ALLOWED_ORIGINS ?? '',
  },
}

export default nextConfig
