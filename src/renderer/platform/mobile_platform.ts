import * as defaults from '@shared/defaults'
import type { Config, Settings, ShortcutSetting } from '@shared/types'
import { v4 as uuidv4 } from 'uuid'
import { type ImageGenerationStorage, IndexedDBImageGenerationStorage } from '@/storage/ImageGenerationStorage'
import type { Platform, PlatformType } from './interfaces'
import type { KnowledgeBaseController } from './knowledge-base/interface'
import { MobileSQLiteStorage } from './storages'

export default class MobilePlatform extends MobileSQLiteStorage implements Platform {
  public type: PlatformType = 'mobile'

  public exporter = {
    exportBlob: async () => {},
    exportTextFile: async () => {},
    exportImageFile: async () => {},
    exportByUrl: async () => {},
    exportStreamingJson: async () => {},
  }

  async getVersion() {
    return '0.0.0'
  }
  async getPlatform() {
    return 'mobile'
  }
  async getArch() {
    return 'unknown'
  }
  async shouldUseDarkColors() {
    return false
  }
  onSystemThemeChange() {
    return () => {}
  }
  onWindowShow() {
    return () => {}
  }
  onWindowFocused() {
    return () => {}
  }
  onUpdateDownloaded() {
    return () => {}
  }
  async openLink() {}
  async getDeviceName() {
    return 'mobile-device'
  }
  async getInstanceName() {
    return `mobile-${uuidv4()}`
  }
  async getLocale() {
    return 'en' as const
  }
  async ensureShortcutConfig(_config: ShortcutSetting) {}
  async ensureProxyConfig(_config: { proxy?: string }) {}
  async relaunch() {}
  async getConfig(): Promise<Config> {
    return defaults.newConfigs()
  }
  async getSettings(): Promise<Settings> {
    return defaults.settings()
  }
  async getStoreBlob() {
    return null
  }
  async setStoreBlob() {}
  async delStoreBlob() {}
  async listStoreBlobKeys() {
    return []
  }
  initTracking() {}
  trackingEvent() {}
  async shouldShowAboutDialogWhenStartUp() {
    return false
  }
  async appLog() {}
  async exportLogs() {
    return ''
  }
  async clearLogs() {}
  async ensureAutoLaunch() {}
  async parseFileLocally() {
    return { isSupported: false }
  }
  async isFullscreen() {
    return false
  }
  async setFullscreen() {}
  async installUpdate() {}
  getKnowledgeBaseController(): KnowledgeBaseController {
    throw new Error('Not implemented on mobile')
  }
  getImageGenerationStorage(): ImageGenerationStorage {
    return new IndexedDBImageGenerationStorage()
  }
  async minimize() {}
  async maximize() {}
  async unmaximize() {}
  async closeWindow() {}
  async isMaximized() {
    return false
  }
  onMaximizedChange() {
    return () => {}
  }
}
