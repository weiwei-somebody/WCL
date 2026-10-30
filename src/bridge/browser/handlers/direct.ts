import { IPC } from '../../contract'
import { readInstalled } from '../storage'
import type {
  DirectEndpoint,
  DirectHostRequest,
  DirectHostState,
  DirectInvitation,
  DirectJoinResult,
  DirectOverview
} from '@shared/directConnect'

const PREFIX = 'WCL-DIRECT-1:'
let hostState: DirectHostState = { active: false, endpoints: [], messages: [], connections: 0 }
let localPort = 25565

function encodeBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function decodeBase64Url(text: string): string {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(padded.padEnd(padded.length + ((4 - (padded.length % 4)) % 4), '='))
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

function encodeInvitation(invitation: DirectInvitation): string {
  return PREFIX + encodeBase64Url(JSON.stringify(invitation))
}

function parseInvitation(input: string): DirectInvitation {
  if (typeof input !== 'string' || !input.trim()) throw new Error('邀请内容为空')
  if (input.length > 16384) throw new Error('邀请内容过大')
  let value: DirectInvitation
  try {
    const raw = input.trim()
    value = JSON.parse(raw.startsWith(PREFIX) ? decodeBase64Url(raw.slice(PREFIX.length)) : raw) as DirectInvitation
  } catch {
    throw new Error('无法识别邀请，请粘贴完整的 WCL-DIRECT-1 邀请信息')
  }
  if (
    !value ||
    value.format !== 'WCL-DIRECT' ||
    value.version !== 1 ||
    typeof value.name !== 'string' ||
    !Array.isArray(value.endpoints) ||
    !value.endpoints.length
  ) {
    throw new Error('邀请格式或版本无效')
  }
  const expires = Date.parse(value.expiresAt)
  if (!Number.isFinite(expires) || expires < Date.now()) throw new Error('邀请已过期，请让房主重新生成')
  return value
}

function endpointAddress(endpoint: DirectEndpoint): string {
  return `${endpoint.host.includes(':') ? `[${endpoint.host}]` : endpoint.host}:${endpoint.port}`
}

export const directHandlers = {
  [IPC.directOverview]: (): DirectOverview => ({
    network: {
      addresses: [],
      gateways: [],
      messages: ['浏览器阶段无法枚举本机网卡与网关，桌面版将显示局域网/公网地址与 UPnP 状态']
    },
    instances: readInstalled(),
    state: hostState,
    detectedPort: hostState.active ? localPort : undefined
  }),
  [IPC.directState]: (): DirectHostState => hostState,
  [IPC.directHost]: (request: DirectHostRequest): DirectHostState => {
    const instance = readInstalled().find((row) => row.id === request.versionId && (!request.folder || row.folder === request.folder))
    if (!instance) throw new Error('实例不存在或尚未安装')
    localPort = request.port && request.port > 0 ? request.port : 25565
    const endpoint: DirectEndpoint = { host: '127.0.0.1', port: localPort, kind: 'lan' }
    const invitation: DirectInvitation = {
      format: 'WCL-DIRECT',
      version: 1,
      name: instance.id,
      minecraftVersion: instance.mcVersion,
      loader: instance.loader,
      loaderVersion: instance.loaderVersion,
      endpoints: [endpoint],
      expiresAt: new Date(Date.now() + 4 * 3600 * 1000).toISOString()
    }
    hostState = {
      active: true,
      invite: encodeInvitation(invitation),
      endpoints: [endpoint],
      messages: ['浏览器阶段为本地模拟房间，真实端口映射（UPnP/FRP）需要桌面版', '开放局域网后可在游戏内「对局域网开放」，本邀请用于展示流程'],
      localPort,
      connections: 0,
      startedAt: new Date().toISOString()
    }
    return hostState
  },
  [IPC.directStop]: (): DirectHostState => {
    hostState = { active: false, endpoints: [], messages: [], connections: 0 }
    return hostState
  },
  [IPC.directResolve]: (text: string): DirectJoinResult => {
    const invitation = parseInvitation(text)
    const ordered = [...invitation.endpoints].sort(
      (a, b) => ['ipv6', 'ipv4', 'lan'].indexOf(a.kind) - ['ipv6', 'ipv4', 'lan'].indexOf(b.kind)
    )
    return {
      invitation,
      endpoint: ordered[0],
      failures: ['浏览器阶段不做真实连通性探测，桌面版将逐个探测地址']
    }
  },
  [IPC.directPrepareJoin]: (text: string, versionId: string, folder: string): { versionId: string; folder: string; address: string; directJoin: boolean } => {
    const result = parseInvitation(text)
    const target = versionId || readInstalled()[0]?.id || ''
    if (!target) throw new Error('尚未安装任何版本')
    const instance = readInstalled().find((row) => row.id === target)
    if (instance && instance.mcVersion && result.minecraftVersion && instance.mcVersion !== result.minecraftVersion) {
      throw new Error(`实例版本 ${instance.mcVersion} 与房主 ${result.minecraftVersion} 不一致`)
    }
    const endpoint = result.endpoints[0]
    return {
      versionId: target,
      folder: folder || instance?.folder || '',
      address: endpoint ? endpointAddress(endpoint) : '',
      directJoin: false
    }
  }
}
