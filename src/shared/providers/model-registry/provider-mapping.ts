import { getProviderDefinition } from '../registry'

export function getModelsDevProviderId(providerId: string): string | undefined {
  return getProviderDefinition(providerId)?.modelsDevProviderId
}
