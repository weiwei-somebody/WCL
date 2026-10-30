/**
 * 浏览器阶段的虚拟游戏目录：以「游戏目录 + 子目录」为键，把资源文件记录在 localStorage。
 * 桌面阶段由 fs handlers 换成真实磁盘读写，接口形态不变。
 */
import type { FsEntry } from '@shared/types'

const KEY = 'wcl.vfs'

type VfsMap = Record<string, FsEntry[]>

function read(): VfsMap {
  try {
    const raw = localStorage.getItem(KEY)
    const map = raw ? (JSON.parse(raw) as VfsMap) : {}
    return map && typeof map === 'object' ? map : {}
  } catch {
    return {}
  }
}

function write(map: VfsMap): void {
  localStorage.setItem(KEY, JSON.stringify(map))
}

export function vfsKey(folder: string, rel: string): string {
  return `${folder}::${rel}`
}

export function vfsList(folder: string, rel: string): FsEntry[] {
  return read()[vfsKey(folder, rel)] ?? []
}

export function vfsPut(folder: string, rel: string, name: string, size: number): FsEntry[] {
  const map = read()
  const key = vfsKey(folder, rel)
  const rows = (map[key] ?? []).filter((row) => row.name !== name)
  rows.push({ name, size, isDir: false, mtime: Date.now() })
  rows.sort((a, b) => a.name.localeCompare(b.name))
  map[key] = rows
  write(map)
  return rows
}

export function vfsRemove(folder: string, rel: string, name: string): FsEntry[] {
  const map = read()
  const key = vfsKey(folder, rel)
  const rows = (map[key] ?? []).filter((row) => row.name !== name)
  map[key] = rows
  write(map)
  return rows
}

export function vfsToggle(folder: string, rel: string, name: string): FsEntry[] {
  const map = read()
  const key = vfsKey(folder, rel)
  const rows = map[key] ?? []
  const found = rows.find((row) => row.name === name)
  if (!found) return rows
  const disabled = name.endsWith('.disabled')
  const next = disabled ? name.slice(0, -'.disabled'.length) : `${name}.disabled`
  if (rows.some((row) => row.name === next)) throw new Error(`${next} 已存在`)
  const list = rows
    .filter((row) => row.name !== name)
    .concat([{ ...found, name: next, mtime: Date.now() }])
    .sort((a, b) => a.name.localeCompare(b.name))
  map[key] = list
  write(map)
  return list
}
