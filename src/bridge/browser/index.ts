/**
 * 浏览器实现：handler 表 + Proxy 兜底。
 * 未注册的通道不抛错，按 capability 返回空值，保证界面在浏览器下不会因缺后端而中断。
 */
import { capabilityOf, emptyFallback } from '../capabilities'
import { subscribe, publish } from '../bus'
import { handlers } from './handlers'
import type { Bridge, Capability } from '../contract'

export interface CallRecord {
  channel: string
  ok: boolean
  capability: Capability
  error?: string
  at: number
}

const records: CallRecord[] = []
const MAX_RECORDS = 800
const warned = new Set<string>()

export function callRecords(): readonly CallRecord[] {
  return records
}

export function clearRecords(): void {
  records.length = 0
}

function record(channel: string, ok: boolean, error?: string): void {
  records.unshift({ channel, ok, capability: capabilityOf(channel), error, at: Date.now() })
  if (records.length > MAX_RECORDS) records.length = MAX_RECORDS
}

const table = new Proxy(handlers, {
  get(target, prop) {
    if (typeof prop !== 'string') return undefined
    const found = target[prop]
    if (found) return found
    if (prop.includes(':') && !warned.has(prop)) {
      warned.add(prop)
      console.info('[wcl.bridge] 通道未实现，返回兜底值', prop, capabilityOf(prop))
    }
    return undefined
  }
})

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const handler = table[channel]
  if (!handler) {
    record(channel, true)
    return emptyFallback(channel) as T
  }
  try {
    const value = await handler(...args)
    record(channel, true)
    return value as T
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    record(channel, false, message)
    throw new Error(message)
  }
}

export function createBrowserBridge(): Bridge {
  return {
    kind: 'browser',
    platform: 'web',
    invoke,
    on: (channel, cb) => subscribe(channel, cb),
    send: (channel, ...args) => publish(channel, args[0]),
    getFilePath: (file) => file.name
  }
}
