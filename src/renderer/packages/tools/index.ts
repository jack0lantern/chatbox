import { t } from 'i18next'

export function getToolName(toolName: string): string {
  // Handle plugin tool names: plugin__chess__start_game → Start Game
  if (toolName.startsWith('plugin__')) {
    const parts = toolName.split('__')
    const rawName = parts[2] || toolName
    return rawName
      .split('_')
      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ')
  }

  // Use translation keys that i18next cli can detect
  const toolNames: Record<string, string> = {
    query_knowledge_base: t('Query Knowledge Base'),
    get_files_meta: t('Get Files Meta'),
    read_file_chunks: t('Read File Chunks'),
    list_files: t('List Files'),
    web_search: t('Web Search'),
    file_search: t('File Search'),
    code_search: t('Code Search'),
    terminal: t('Terminal'),
    create_file: t('Create File'),
    edit_file: t('Edit File'),
    delete_file: t('Delete File'),
    parse_link: t('Parse Link'),
  }

  return toolNames[toolName] || toolName
}

export function isPluginTool(toolName: string): boolean {
  return toolName.startsWith('plugin__')
}

export function getPluginSlug(toolName: string): string | null {
  if (!toolName.startsWith('plugin__')) return null
  return toolName.split('__')[1] || null
}
