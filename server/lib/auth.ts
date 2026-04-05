import type { NextAuthOptions } from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import SpotifyProvider from 'next-auth/providers/spotify'
import { PrismaAdapter } from '@auth/prisma-adapter'
import bcrypt from 'bcryptjs'
import { prisma } from './prisma'

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma) as any,
  providers: [
    CredentialsProvider({
      name: 'Email',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null
        const password = credentials.password
        let user = await prisma.user.findUnique({
          where: { email: credentials.email },
        })
        if (!user) {
          const passwordHash = await bcrypt.hash(password, 10)
          user = await prisma.user.create({
            data: {
              email: credentials.email,
              name: credentials.email.split('@')[0],
              passwordHash,
            },
          })
        } else if (user.passwordHash) {
          const valid = await bcrypt.compare(password, user.passwordHash)
          if (!valid) return null
        } else {
          // OAuth user or pre-migration user without a password — set hash
          const passwordHash = await bcrypt.hash(password, 10)
          user = await prisma.user.update({
            where: { id: user.id },
            data: { passwordHash },
          })
        }
        return { id: user.id, email: user.email, name: user.name }
      },
    }),
    SpotifyProvider({
      clientId: process.env.SPOTIFY_CLIENT_ID!,
      clientSecret: process.env.SPOTIFY_CLIENT_SECRET!,
      authorization: {
        params: {
          scope: 'playlist-modify-public playlist-read-private user-read-email',
        },
      },
      allowDangerousEmailAccountLinking: true,
    }),
  ],
  session: {
    strategy: 'jwt',
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id
      }
      return token
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).id = token.id
      }
      return session
    },
  },
  pages: {
    signIn: '/login',
  },
}
