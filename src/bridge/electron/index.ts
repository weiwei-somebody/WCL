/**
 * 桌面实现：转发到 preload 暴露的 window.wcl，与浏览器实现同形。
 */
import type { Bridge } from '../contract'

interface WclHost {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>
  on(channel: string, cb: (payload: unknown) => void): () => void
  send(channel: string, ...args: unknown[]): void
  getFilePath(file: { name: string }): string
  platform: string
}

export function createElectronBridge(): Bridge {
  const host = (window as unknown as { wcl: WclHost }).wcl
  return {
    kind: 'electron',
    platform: host.platform,
    invoke: <T>(channel: string, ...args: unknown[]) => host.invoke(channel, ...args) as Promise<T>,
    on: (channel, cb) => host.on(channel, cb),
    send: (channel, ...args) => host.send(channel, ...args),
    getFilePath: (file) => host.getFilePath(file)
  }
}
