/**
 * 浏览器阶段的持久化：设置与已安装实例，语义与桌面端的配置文件对齐。
 */
import type { InstalledVersion } from '@shared/types'

export const SETTINGS_KEY = 'wcl.settings'
export const INSTALLED_KEY = 'wcl.installed'
export const DEFAULT_FOLDER = 'C:/WCL/.minecraft'

export interface LocalSettings {
  activeFolder?: string
  gameDir?: string
  defaultIsolation?: boolean
  activeInstanceId?: string
}

export function readSettings(): LocalSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    return raw ? (JSON.parse(raw) as LocalSettings) : {}
  } catch {
    return {}
  }
}

export function writeSettings(patch: LocalSettings): LocalSettings {
  let base: Record<string, unknown> = {}
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    base = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
  } catch {
    base = {}
  }
  const next = { ...base, ...patch } as LocalSettings
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(next))
  return next
}

export function activeFolder(): string {
  const stored = readSettings()
  return stored.activeFolder || stored.gameDir || DEFAULT_FOLDER
}

export function readInstalled(): InstalledVersion[] {
  try {
    const raw = localStorage.getItem(INSTALLED_KEY)
    const list = raw ? (JSON.parse(raw) as InstalledVersion[]) : []
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

export function writeInstalled(list: InstalledVersion[]): InstalledVersion[] {
  localStorage.setItem(INSTALLED_KEY, JSON.stringify(list))
  return list
}

export function patchInstalled(id: string, patch: Partial<InstalledVersion>): InstalledVersion[] {
  return writeInstalled(readInstalled().map((item) => (item.id === id ? { ...item, ...patch } : item)))
}

export function instanceGameDir(versionId: string, folder?: string): string {
  const found = readInstalled().find((item) => item.id === versionId && (!folder || item.folder === folder))
  if (found?.gameDirectory) return found.gameDirectory
  const root = found?.folder || folder || activeFolder()
  return found?.isolated ? `${root}/versions/${found.id}` : root
}
