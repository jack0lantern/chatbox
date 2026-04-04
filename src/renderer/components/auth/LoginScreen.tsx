import { Alert, Button, MantineProvider, Paper, PasswordInput, Stack, Text, TextInput, Title } from '@mantine/core'
import '@mantine/core/styles.css'
import { IconAlertCircle } from '@tabler/icons-react'
import { useCallback, useState } from 'react'

interface LoginScreenProps {
  serverUrl: string
  onSuccess: () => void
}

async function authenticate(serverUrl: string, email: string, password: string): Promise<void> {
  // 1. Get CSRF token
  const csrfRes = await fetch(`${serverUrl}/api/auth/csrf`, { credentials: 'include' })
  if (!csrfRes.ok) throw new Error('Could not reach server')
  const { csrfToken } = await csrfRes.json()

  // 2. Submit credentials to NextAuth
  const body = new URLSearchParams({ csrfToken, email, password, json: 'true' })
  const res = await fetch(`${serverUrl}/api/auth/callback/credentials`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })

  if (!res.ok) throw new Error('Invalid email or password')

  // 3. Verify session was created
  const sessionRes = await fetch(`${serverUrl}/api/auth/session`, { credentials: 'include' })
  const session = await sessionRes.json()
  if (!session?.user) throw new Error('Authentication failed. Please try again.')
}

export default function LoginScreen({ serverUrl, onSuccess }: LoginScreenProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [isSignUp, setIsSignUp] = useState(false)

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      setError('')
      setLoading(true)
      try {
        await authenticate(serverUrl, email, password)
        onSuccess()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong')
      } finally {
        setLoading(false)
      }
    },
    [serverUrl, email, password, onSuccess],
  )

  return (
    <MantineProvider defaultColorScheme="auto">
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          padding: 16,
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}
      >
        <Paper shadow="md" radius="lg" p="xl" withBorder style={{ width: '100%', maxWidth: 400 }}>
          <Stack align="center" gap="xs" mb="lg">
            <svg
              width="66"
              height="48"
              viewBox="0 0 132 96"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <mask
                id="logo-mask"
                maskUnits="userSpaceOnUse"
                x="35.0715"
                y="0"
                width="62"
                height="60"
                fill="black"
              >
                <rect fill="white" x="35.0715" width="62" height="60" />
                <path d="M83.0247 4C88.4948 4.00025 92.929 8.43512 92.929 13.9053V38.1172C92.9287 43.5872 88.4946 48.0212 83.0247 48.0215H53.1057L43.468 56.001V46.3486C40.8172 44.5713 39.0717 41.5485 39.0715 38.1172V13.9053C39.0715 8.43496 43.5065 4 48.9768 4H83.0247Z" />
              </mask>
              <path
                d="M83.0247 4L83.0248 0.148105H83.0247V4ZM92.929 38.1172L96.7808 38.1173V38.1172H92.929ZM83.0247 48.0215V51.8734H83.0248L83.0247 48.0215ZM53.1057 48.0215V44.1696C52.2088 44.1696 51.3401 44.4826 50.6492 45.0545L53.1057 48.0215ZM43.468 56.001H39.6161C39.6161 57.4934 40.4782 58.8514 41.8287 59.4866C43.1791 60.1218 44.775 59.9197 45.9245 58.9679L43.468 56.001ZM43.468 46.3486H47.3199C47.3199 45.0643 46.6798 43.8645 45.6131 43.1493L43.468 46.3486ZM39.0715 38.1172H35.2196V38.1173L39.0715 38.1172ZM83.0247 4L83.0245 7.8519C86.3671 7.85205 89.0771 10.5621 89.0771 13.9053H92.929H96.7808C96.7808 6.30809 90.6225 0.148449 83.0248 0.148105L83.0247 4ZM92.929 13.9053H89.0771V38.1172H92.929H96.7808V13.9053H92.929ZM92.929 38.1172L89.0771 38.117C89.0769 41.4598 86.3673 44.1694 83.0245 44.1696L83.0247 48.0215L83.0248 51.8734C90.622 51.873 96.7805 45.7146 96.7808 38.1173L92.929 38.1172ZM83.0247 48.0215V44.1696H53.1057V48.0215V51.8734H83.0247V48.0215ZM53.1057 48.0215L50.6492 45.0545L41.0115 53.034L43.468 56.001L45.9245 58.9679L55.5622 50.9884L53.1057 48.0215ZM43.468 56.001H47.3199V46.3486H43.468H39.6161V56.001H43.468ZM43.468 46.3486L45.6131 43.1493C43.9827 42.0562 42.9235 40.2094 42.9234 38.117L39.0715 38.1172L35.2196 38.1173C35.2198 42.8875 37.6516 47.0864 41.3229 49.548L43.468 46.3486ZM39.0715 38.1172H42.9234V13.9053H39.0715H35.2196V38.1172H39.0715ZM39.0715 13.9053H42.9234C42.9234 10.5623 45.6338 7.8519 48.9768 7.8519V4V0.148105C41.3792 0.148105 35.2196 6.30762 35.2196 13.9053H39.0715ZM48.9768 4V7.8519H83.0247V4V0.148105H48.9768V4Z"
                fill="currentColor"
                mask="url(#logo-mask)"
              />
              <circle cx="57.5052" cy="25.7339" r="3.02649" fill="currentColor" stroke="currentColor" strokeWidth="0.550271" />
              <circle cx="74.5641" cy="25.7339" r="3.02649" fill="currentColor" stroke="currentColor" strokeWidth="0.550271" />
            </svg>
            <Title order={3}>{isSignUp ? 'Create Account' : 'Welcome Back'}</Title>
            <Text size="sm" c="dimmed">
              {isSignUp ? 'Sign up for ChatBridge' : 'Sign in to ChatBridge'}
            </Text>
          </Stack>

          <form onSubmit={handleSubmit}>
            <Stack gap="sm">
              <TextInput
                label="Email"
                type="email"
                placeholder="you@example.com"
                required
                value={email}
                onChange={(e) => setEmail(e.currentTarget.value)}
                data-testid="login-email"
              />
              <PasswordInput
                label="Password"
                placeholder="Your password"
                required
                value={password}
                onChange={(e) => setPassword(e.currentTarget.value)}
                data-testid="login-password"
              />

              {error && (
                <Alert
                  icon={<IconAlertCircle size={16} />}
                  color="red"
                  variant="light"
                  data-testid="login-error"
                >
                  {error}
                </Alert>
              )}

              <Button type="submit" fullWidth loading={loading} data-testid="login-submit">
                {isSignUp ? 'Sign Up' : 'Sign In'}
              </Button>
            </Stack>
          </form>

          <Text size="sm" ta="center" mt="md" c="dimmed">
            {isSignUp ? 'Already have an account? ' : "Don't have an account? "}
            <Text
              component="span"
              size="sm"
              c="blue"
              style={{ cursor: 'pointer' }}
              onClick={() => {
                setIsSignUp(!isSignUp)
                setError('')
              }}
              data-testid="login-toggle"
            >
              {isSignUp ? 'Sign in' : 'Sign up'}
            </Text>
          </Text>
        </Paper>
      </div>
    </MantineProvider>
  )
}
