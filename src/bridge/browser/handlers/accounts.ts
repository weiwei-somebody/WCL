import { IPC } from '../../contract'
import type { Account, MsDeviceCodeInfo } from '@shared/types'

const KEY = 'wcl.accounts'
const SELECTED_KEY = 'wcl.accounts.selected'

function read(): Account[] {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as Account[]) : []
  } catch {
    return []
  }
}

function write(list: Account[]): Account[] {
  localStorage.setItem(KEY, JSON.stringify(list))
  return list
}

function selectedId(): string | null {
  return localStorage.getItem(SELECTED_KEY)
}

function current(): Account | null {
  const id = selectedId()
  if (!id) return null
  return read().find((item) => item.id === id) ?? null
}

/** 离线账号的 UUID 由用户名稳定派生，保证同一名字重复添加得到同一身份 */
function offlineUuid(username: string): string {
  const seed = `offline:${username}`
  let hash = 0
  for (let index = 0; index < seed.length; index++) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0
  }
  const block = hash.toString(16).padStart(8, '0')
  return `${block}-${block.slice(0, 4)}-4${block.slice(1, 4)}-a${block.slice(1, 4)}-${block}${block.slice(0, 4)}`
}

export const accountHandlers = {
  [IPC.accountsList]: () => read(),
  [IPC.accountsAddOffline]: (username?: string) => {
    const name = String(username ?? '').trim() || '玩家'
    const account: Account = { id: crypto.randomUUID(), type: 'offline', username: name, uuid: offlineUuid(name) }
    const exit = read().filter((item) => item.type !== 'offline' || item.username !== name)
    write([...exit, account])
    localStorage.setItem(SELECTED_KEY, account.id)
    return account
  },
  [IPC.accountsMsBegin]: (): MsDeviceCodeInfo => {
    return {
      userCode: 'WCL-DEMO-0000',
      verificationUri: 'https://www.microsoft.com/link',
      message: '浏览器演示模式：登录流程为模拟，不会真正完成授权'
    }
  },
  [IPC.accountsMsCancel]: () => true,
  [IPC.accountsRemove]: (id: string) => {
    const next = read().filter((item) => item.id !== id)
    if (selectedId() === id) localStorage.removeItem(SELECTED_KEY)
    return write(next)
  },
  [IPC.accountsSelect]: (id: string) => {
    const found = read().find((item) => item.id === id) ?? null
    if (found) localStorage.setItem(SELECTED_KEY, id)
    else localStorage.removeItem(SELECTED_KEY)
    return found
  },
  [IPC.accountsSelected]: () => current(),
  [IPC.skinAvatar]: () => null
}
