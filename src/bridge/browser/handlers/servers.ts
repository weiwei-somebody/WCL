import { IPC } from '../../contract'
import { getJson, withTimeout } from '@/data/http'
import { readInstalled } from '../storage'
import type { ServerEntry, ServerLaunchPreparation, ServerPingResult, ServerSyncResult } from '@shared/types'

const KEY = 'wcl.servers'

interface RawStatus {
  online: boolean
  players?: { online?: number; max?: number }
  version?: string
  motd?: { clean?: string[]; raw?: string }
}

function read(): ServerEntry[] {
  try {
    const raw = localStorage.getItem(KEY)
    const list = raw ? (JSON.parse(raw) as ServerEntry[]) : []
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

function write(list: ServerEntry[]): ServerEntry[] {
  localStorage.setItem(KEY, JSON.stringify(list))
  return list
}

function normalize(address: string): { address: string; host: string; port: number } {
  const trimmed = address.trim()
  const index = trimmed.lastIndexOf(':')
  if (index > 0 && !trimmed.includes(']')) {
    const port = Number(trimmed.slice(index + 1))
    if (Number.isFinite(port)) return { address: trimmed, host: trimmed.slice(0, index), port }
  }
  return { address: trimmed, host: trimmed, port: 25565 }
}

function newId(): string {
  return `srv-${Math.random().toString(36).slice(2, 10)}`
}

export const serverHandlers = {
  [IPC.serversList]: (): ServerEntry[] => read(),
  [IPC.serversAdd]: (name: string, address: string): ServerEntry[] => {
    const { address: clean, host, port } = normalize(address)
    if (!clean) throw new Error('服务器地址不能为空')
    const entry: ServerEntry = {
      id: newId(),
      name: name.trim() || host,
      address: port === 25565 ? host : clean,
      normalizedAddress: `${host}:${port}`,
      host,
      port,
      source: 'launcher',
      lastSeenAt: new Date().toISOString()
    }
    return write([entry, ...read()])
  },
  [IPC.serversEdit]: (id: string, name: string, address: string): ServerEntry[] => {
    const { address: clean, host, port } = normalize(address)
    return write(
      read().map((row) =>
        row.id === id
          ? { ...row, name: name.trim() || host, address: port === 25565 ? host : clean, normalizedAddress: `${host}:${port}`, host, port }
          : row
      )
    )
  },
  [IPC.serversFavorite]: (id: string, favorite: boolean): ServerEntry[] =>
    write(read().map((row) => (row.id === id ? { ...row, favorite } : row))),
  [IPC.serversRemove]: (id: string): ServerEntry[] => write(read().filter((row) => row.id !== id)),
  [IPC.serversBind]: (id: string, versionId: string, folder?: string): ServerEntry[] =>
    write(
      read().map((row) =>
        row.id === id
          ? versionId
            ? { ...row, versionId, folder, lastUsedAt: new Date().toISOString() }
            : { ...row, versionId: undefined, folder: undefined }
          : row
      )
    ),
  [IPC.serversSyncFromDat]: (): ServerSyncResult => ({
    list: read(),
    targets: readInstalled(),
    added: 0,
    updated: 0,
    errors: ['浏览器阶段不读取实例内 servers.dat，桌面版将执行同步']
  }),
  [IPC.serversPrepareLaunch]: (id: string, versionId?: string): ServerLaunchPreparation => {
    const entry = read().find((row) => row.id === id)
    if (!entry) throw new Error('服务器不存在')
    const target = versionId || entry.versionId || readInstalled()[0]?.id || ''
    if (!target) throw new Error('尚未安装任何版本')
    const instance = readInstalled().find((row) => row.id === target)
    return {
      serverId: id,
      versionId: target,
      folder: entry.folder || instance?.folder || '',
      address: entry.address,
      minecraftVersion: instance?.mcVersion ?? '',
      loader: instance?.loader,
      loaderVersion: instance?.loaderVersion,
      directJoin: false
    }
  },
  [IPC.serversPing]: async (address: string): Promise<ServerPingResult> => {
    const { host, port } = normalize(address)
    const started = performance.now()
    try {
      const data = await withTimeout(
        getJson<RawStatus>(`https://api.mcsrvstat.us/3/${encodeURIComponent(host)}:${port}`),
        6000,
        '服务器探测超时'
      )
      const latencyMs = Math.round(performance.now() - started)
      if (!data.online) return { online: false, players: '0/0', motd: '服务器离线或不可达', version: '', latencyMs }
      return {
        online: true,
        players: `${data.players?.online ?? 0}/${data.players?.max ?? 0}`,
        motd: data.motd?.clean?.join('\n') ?? data.motd?.raw ?? '',
        version: data.version ?? '',
        latencyMs
      }
    } catch {
      return {
        online: false,
        players: '',
        motd: '探测服务不可达（网络或地址无效）',
        version: '',
        latencyMs: Math.round(performance.now() - started)
      }
    }
  }
}
