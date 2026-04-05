import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'

export default async function Home() {
  const session = await getServerSession(authOptions)

  if (!session?.user) {
    redirect('/login')
  }

  return (
    <div style={{ maxWidth: 600, margin: '100px auto', padding: 24, fontFamily: 'system-ui' }}>
      <h1>ChatBridge</h1>
      <p>Logged in as <strong>{session.user.email}</strong></p>
      <p style={{ color: '#666' }}>
        The server is running. Connect your chatbox client with:
      </p>
      <code style={{ display: 'block', padding: 12, background: '#f5f5f5', borderRadius: 4 }}>
        CHATBRIDGE_SERVER_URL=http://localhost:3000 pnpm dev
      </code>
    </div>
  )
}
