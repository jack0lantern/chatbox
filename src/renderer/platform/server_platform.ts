/** biome-ignore-all lint/suspicious/noExplicitAny: <any> */
import type { Config, Language, Settings, ShortcutSetting } from '@shared/types'
import type { ImageGenerationStorage } from '@/storage/ImageGenerationStorage'
import type { Exporter, Platform, PlatformType } from './interfaces'
import type { KnowledgeBaseController } from './knowledge-base/interface'

async function apiFetch(path: string, options?: RequestInit): Promise<Response> {
  return fetch(path, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  })
}

export default class ServerPlatform implements Platform {
  private fallback: Platform

  constructor(fallback: Platform) {
    this.fallback = fallback
  }

  get type(): PlatformType {
    return this.fallback.type
  }

  get exporter(): Exporter {
    return this.fallback.exporter
  }

  // --- Storage (routed to server) ---

  getStorageType(): string {
    return 'SERVER'
  }

  async setStoreValue(key: string, value: any): Promise<void> {
    await apiFetch(`/api/storage/${encodeURIComponent(key)}`, {
      method: 'PUT',
      body: JSON.stringify({ value }),
    })
  }

  async getStoreValue(key: string): Promise<any> {
    const res = await apiFetch(`/api/storage/${encodeURIComponent(key)}`)
    const data = await res.json()
    return data.value
  }

  async delStoreValue(key: string): Promise<void> {
    await apiFetch(`/api/storage/${encodeURIComponent(key)}`, {
      method: 'DELETE',
    })
  }

  async getAllStoreValues(): Promise<{ [key: string]: any }> {
    const res = await apiFetch('/api/storage')
    return res.json()
  }

  async getAllStoreKeys(): Promise<string[]> {
    const values = await this.getAllStoreValues()
    return Object.keys(values)
  }

  async setAllStoreValues(data: { [key: string]: any }): Promise<void> {
    const promises = Object.entries(data).map(([key, value]) =>
      this.setStoreValue(key, value)
    )
    await Promise.all(promises)
  }

  // --- Blob storage (routed to server) ---

  async getStoreBlob(key: string): Promise<string | null> {
    const res = await apiFetch(`/api/storage/${encodeURIComponent('blob:' + key)}`)
    const data = await res.json()
    return data.value
  }

  async setStoreBlob(key: string, value: string): Promise<void> {
    await apiFetch(`/api/storage/${encodeURIComponent('blob:' + key)}`, {
      method: 'PUT',
      body: JSON.stringify({ value }),
    })
  }

  async delStoreBlob(key: string): Promise<void> {
    await apiFetch(`/api/storage/${encodeURIComponent('blob:' + key)}`, {
      method: 'DELETE',
    })
  }

  async listStoreBlobKeys(): Promise<string[]> {
    const allKeys = await this.getAllStoreKeys()
    return allKeys
      .filter((k) => k.startsWith('blob:'))
      .map((k) => k.slice(5))
  }

  // --- Everything else delegates to fallback ---

  getVersion() { return this.fallback.getVersion() }
  getPlatform() { return this.fallback.getPlatform() }
  getArch() { return this.fallback.getArch() }
  shouldUseDarkColors() { return this.fallback.shouldUseDarkColors() }
  onSystemThemeChange(cb: () => void) { return this.fallback.onSystemThemeChange(cb) }
  onWindowShow(cb: () => void) { return this.fallback.onWindowShow(cb) }
  onWindowFocused(cb: () => void) { return this.fallback.onWindowFocused(cb) }
  onUpdateDownloaded(cb: () => void) { return this.fallback.onUpdateDownloaded(cb) }
  get onNavigate() { return this.fallback.onNavigate }
  openLink(url: string) { return this.fallback.openLink(url) }
  getDeviceName() { return this.fallback.getDeviceName() }
  getInstanceName() { return this.fallback.getInstanceName() }
  getLocale() { return this.fallback.getLocale() }
  ensureShortcutConfig(c: ShortcutSetting) { return this.fallback.ensureShortcutConfig(c) }
  ensureProxyConfig(c: { proxy?: string }) { return this.fallback.ensureProxyConfig(c) }
  relaunch() { return this.fallback.relaunch() }
  getConfig() { return this.fallback.getConfig() }
  getSettings() { return this.fallback.getSettings() }
  initTracking() { return this.fallback.initTracking() }
  trackingEvent(n: string, p: { [key: string]: string }) { return this.fallback.trackingEvent(n, p) }
  shouldShowAboutDialogWhenStartUp() { return this.fallback.shouldShowAboutDialogWhenStartUp() }
  appLog(l: string, m: string) { return this.fallback.appLog(l, m) }
  exportLogs() { return this.fallback.exportLogs() }
  clearLogs() { return this.fallback.clearLogs() }
  ensureAutoLaunch(e: boolean) { return this.fallback.ensureAutoLaunch(e) }
  parseFileLocally(f: File) { return this.fallback.parseFileLocally(f) }
  get parseFileWithMineru() { return this.fallback.parseFileWithMineru }
  get cancelMineruParse() { return this.fallback.cancelMineruParse }
  isFullscreen() { return this.fallback.isFullscreen() }
  setFullscreen(e: boolean) { return this.fallback.setFullscreen(e) }
  installUpdate() { return this.fallback.installUpdate() }
  getKnowledgeBaseController() { return this.fallback.getKnowledgeBaseController() }
  getImageGenerationStorage() { return this.fallback.getImageGenerationStorage() }
  minimize() { return this.fallback.minimize() }
  maximize() { return this.fallback.maximize() }
  unmaximize() { return this.fallback.unmaximize() }
  closeWindow() { return this.fallback.closeWindow() }
  isMaximized() { return this.fallback.isMaximized() }
  onMaximizedChange(cb: (m: boolean) => void) { return this.fallback.onMaximizedChange(cb) }
}
