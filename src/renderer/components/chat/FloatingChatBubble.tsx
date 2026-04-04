import { ActionIcon, Paper } from '@mantine/core'
import { IconMessage, IconMinus } from '@tabler/icons-react'
import { type ReactNode, useState } from 'react'

interface FloatingChatBubbleProps {
  children: ReactNode
}

export default function FloatingChatBubble({ children }: FloatingChatBubbleProps) {
  const [minimized, setMinimized] = useState(false)

  if (minimized) {
    return (
      <ActionIcon
        onClick={() => setMinimized(false)}
        size={48}
        radius="xl"
        variant="filled"
        style={{
          position: 'fixed',
          bottom: 24,
          right: 24,
          zIndex: 200,
          boxShadow: '0 4px 20px rgba(0, 0, 0, 0.25)',
        }}
      >
        <IconMessage size={24} />
      </ActionIcon>
    )
  }

  return (
    <Paper
      shadow="xl"
      radius="md"
      withBorder
      style={{
        position: 'fixed',
        top: 16,
        right: 16,
        bottom: 16,
        width: 400,
        zIndex: 200,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          padding: '4px 8px',
          borderBottom: '1px solid var(--mantine-color-default-border)',
          backgroundColor: 'var(--chatbox-background-gray-secondary)',
          flexShrink: 0,
        }}
      >
        <ActionIcon variant="subtle" size="sm" onClick={() => setMinimized(true)}>
          <IconMinus size={14} />
        </ActionIcon>
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {children}
      </div>
    </Paper>
  )
}
