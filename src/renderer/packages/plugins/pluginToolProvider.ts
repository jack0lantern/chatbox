import { tool, type ToolSet } from 'ai'
import z from 'zod'
import type { PluginManager } from './pluginManager'

interface PluginToolSchema {
  name: string
  description: string
  parameters: {
    type: string
    properties: Record<string, unknown>
    required?: string[]
  }
}

export interface PluginDefinition {
  appSlug: string
  appName: string
  description: string
  iframeUrl: string
  authPattern: string
  toolSchemas: PluginToolSchema[]
  permissions: {
    maxIframeHeight: number
    allowedOrigins: string[]
    timeouts: { ready: number; taskComplete: number }
  }
}

function jsonSchemaToZod(schema: PluginToolSchema['parameters']): z.ZodTypeAny {
  const shape: Record<string, z.ZodTypeAny> = {}
  const properties = schema.properties || {}
  const required = schema.required || []

  for (const [key, prop] of Object.entries(properties)) {
    const p = prop as Record<string, unknown>
    let field: z.ZodTypeAny

    if (p.type === 'string') {
      if (Array.isArray(p.enum)) {
        field = z.enum(p.enum as [string, ...string[]])
      } else {
        field = z.string()
      }
    } else if (p.type === 'number') {
      field = z.number()
    } else if (p.type === 'boolean') {
      field = z.boolean()
    } else if (p.type === 'array') {
      field = z.array(z.unknown())
    } else {
      field = z.unknown()
    }

    if (p.description) {
      field = field.describe(p.description as string)
    }

    if (!required.includes(key)) {
      field = field.optional()
    }

    shape[key] = field
  }

  return z.object(shape)
}

export class PluginToolProvider {
  private plugins: PluginDefinition[] = []
  private tools: ToolSet = {}
  private toolToPlugin: Map<string, PluginDefinition> = new Map()
  private manager: PluginManager
  private fetchFn: typeof fetch

  constructor(manager: PluginManager, fetchFn: typeof fetch = fetch) {
    this.manager = manager
    this.fetchFn = fetchFn
  }

  async loadPlugins(serverBaseUrl: string): Promise<void> {
    const response = await this.fetchFn(`${serverBaseUrl}/api/plugins`)
    if (!response.ok) {
      console.error('Failed to fetch plugins:', response.status)
      return
    }

    this.plugins = await response.json()
    this.tools = {}
    this.toolToPlugin.clear()

    for (const plugin of this.plugins) {
      for (const schema of plugin.toolSchemas) {
        const toolKey = `plugin__${plugin.appSlug}__${schema.name}`
        const inputSchema = jsonSchemaToZod(schema.parameters)

        this.tools[toolKey] = tool({
          description: `[${plugin.appName}] ${schema.description}`,
          inputSchema,
          execute: async (args: Record<string, unknown>) => {
            return await this.manager.invoke(plugin.appSlug, schema.name, args)
          },
        })

        this.toolToPlugin.set(toolKey, plugin)
      }
    }
  }

  getAvailableTools(): ToolSet {
    return { ...this.tools }
  }

  getPluginForTool(toolKey: string): PluginDefinition | undefined {
    return this.toolToPlugin.get(toolKey)
  }

  getPlugins(): PluginDefinition[] {
    return this.plugins
  }
}

import { pluginManager } from './pluginManager'

export const pluginToolProviderInstance = new PluginToolProvider(pluginManager)
