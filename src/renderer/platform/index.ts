import { CHATBOX_BUILD_TARGET } from '@/variables'
import DesktopPlatform from './desktop_platform'
import type { Platform } from './interfaces'
import ServerPlatform from './server_platform'
import TestPlatform from './test_platform'
import WebPlatform from './web_platform'

function initPlatform(): Platform {
  // 测试环境使用 TestPlatform
  if (process.env.NODE_ENV === 'test') {
    return new TestPlatform()
  }

  let basePlatform: Platform
  if (typeof window !== 'undefined' && window.electronAPI) {
    basePlatform = new DesktopPlatform(window.electronAPI)
  } else {
    basePlatform = new WebPlatform()
  }

  // Wrap with ServerPlatform when ChatBridge mode is enabled
  if (process.env.CHATBRIDGE_SERVER_URL) {
    return new ServerPlatform(basePlatform)
  }

  return basePlatform
}

export default initPlatform()
