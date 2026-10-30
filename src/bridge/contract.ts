/**
 * 桥接契约：channel 常量与后端接口形状。
 * channel 取值与参考实现保持一致，浏览器实现与桌面实现共用同一份契约，
 * 因此视图层与 api.ts 在两种模式下零改动。
 */
import { IPC, IPC_EVENT } from '@shared/types'

export { IPC, IPC_EVENT }

/** 某条 channel 在当前运行环境下能达到的真实程度 */
export type Capability =
  /** 走真实公开 HTTP API，结果可信 */
  | 'real'
  /** 用 Web API 近似实现，结果范围有限 */
  | 'approx'
  /** 本地模拟数据，仅为打通界面与交互 */
  | 'mock'
  /** 只有桌面端才能实现，浏览器下为只读占位 */
  | 'desktop'

export interface Bridge {
  readonly kind: 'browser' | 'electron'
  readonly platform: string
  invoke<T = unknown>(channel: string, ...args: unknown[]): Promise<T>
  on(channel: string, cb: (payload: unknown) => void): () => void
  send(channel: string, ...args: unknown[]): void
  getFilePath(file: { name: string }): string
}
