import { Box, Button, Flex, Loader, Text, Tooltip } from '@mantine/core'
import { IconLogout } from '@tabler/icons-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ScalableIcon } from '@/components/common/ScalableIcon'

const serverUrl = process.env.CHATBRIDGE_SERVER_URL

type NextAuthSession = {
  user?: {
    name?: string | null
    email?: string | null
  }
}

async function fetchSession(): Promise<NextAuthSession> {
  if (!serverUrl) {
    return {}
  }
  const res = await fetch(`${serverUrl}/api/auth/session`, { credentials: 'include' })
  if (!res.ok) {
    throw new Error('session request failed')
  }
  return res.json()
}

async function signOutViaNextAuth(): Promise<void> {
  if (!serverUrl) {
    throw new Error('ChatBridge server URL not configured')
  }
  const csrfRes = await fetch(`${serverUrl}/api/auth/csrf`, { credentials: 'include' })
  if (!csrfRes.ok) {
    throw new Error('csrf request failed')
  }
  const { csrfToken } = (await csrfRes.json()) as { csrfToken?: string }
  if (!csrfToken) {
    throw new Error('missing csrf token')
  }
  const body = new URLSearchParams({
    csrfToken,
    callbackUrl: `${serverUrl}/login`,
  })
  const signOutRes = await fetch(`${serverUrl}/api/auth/signout`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!signOutRes.ok) {
    throw new Error('sign out failed')
  }
}

/**
 * Sidebar block for ChatBridge server mode: shows NextAuth user and sign-out.
 */
export function ChatBridgeAccountSection() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  const {
    data: session,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['chatbridge-session', serverUrl],
    queryFn: fetchSession,
    enabled: Boolean(serverUrl),
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  })

  const signOutMutation = useMutation({
    mutationFn: signOutViaNextAuth,
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: ['chatbridge-session'] })
      window.location.href = `${serverUrl}/login`
    },
  })

  if (!serverUrl) {
    return null
  }

  const displayName = session?.user?.email ?? session?.user?.name ?? ''

  if (isLoading) {
    return (
      <Box mb="xs" px="xs" py="xs" className="rounded-md" bg="var(--chatbox-background-gray-secondary)">
        <Flex align="center" gap="sm" justify="center" py={4}>
          <Loader size="sm" color="chatbox-tertiary" />
        </Flex>
      </Box>
    )
  }

  if (isError || !displayName) {
    return (
      <Box mb="xs" px="xs" py="xs" className="rounded-md" bg="var(--chatbox-background-gray-secondary)">
        <Text size="xs" c="chatbox-tertiary" mb="xs">
          {t('ChatBridge session unavailable')}
        </Text>
        <Button
          variant="light"
          size="xs"
          fullWidth
          onClick={() => {
            window.location.href = `${serverUrl}/login`
          }}
        >
          {t('Login')}
        </Button>
      </Box>
    )
  }

  return (
    <Box
      mb="xs"
      px="xs"
      py="xs"
      className="rounded-md"
      bg="var(--chatbox-background-gray-secondary)"
      aria-label={t('ChatBridge account')}
    >
      <Text size="xs" c="chatbox-tertiary" mb={4}>
        {t('ChatBridge account')}
      </Text>
      <Flex align="center" gap="xs" justify="space-between">
        <Tooltip label={displayName} openDelay={400} position="top-start" withArrow>
          <Text size="sm" c="chatbox-secondary" fw={500} lineClamp={1} style={{ flex: 1, minWidth: 0 }}>
            {displayName}
          </Text>
        </Tooltip>
        <Button
          variant="subtle"
          color="chatbox-tertiary"
          size="xs"
          px={6}
          loading={signOutMutation.isPending}
          loaderProps={{ size: 14 }}
          leftSection={<ScalableIcon icon={IconLogout} size={16} />}
          onClick={() => signOutMutation.mutate()}
        >
          {signOutMutation.isPending ? t('Signing out') : t('Log out')}
        </Button>
      </Flex>
      {signOutMutation.isError && (
        <Text size="xs" c="red" mt="xs">
          {t('Could not sign out. Try again.')}
        </Text>
      )}
    </Box>
  )
}
