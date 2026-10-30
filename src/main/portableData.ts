/**
 * 便携式数据目录（对齐便携式布局）：打包后的启动器把设置、账号、日志、缓存等
 * 全部写在 exe 旁边的 WCL 目录，不再落到 %APPDATA%。
 * 开发运行（electron-vite dev）不打包，保持原有 AppData 行为。
 */
import { app } from 'electron'
import { dirname, join } from 'node:path'

/**
 * 打包后启动器所在目录；未打包返回 null。
 * portable 目标运行期 execPath 指向临时解压目录，真实位置需读 electron-builder 注入的环境变量。
 */
export function launcherBaseDir(): string | null {
  if (!app.isPackaged) return null
  const portableDir = process.env.PORTABLE_EXECUTABLE_DIR
  if (portableDir) return portableDir
  return dirname(process.env.PORTABLE_EXECUTABLE_FILE || process.execPath)
}

/** 必须在主进程任何模块读取 userData 之前调用 */
export function initializePortableDataDir(): string | null {
  const base = launcherBaseDir()
  if (!base) return null
  const target = join(base, 'WCL')
  app.setPath('userData', target)
  return target
}
