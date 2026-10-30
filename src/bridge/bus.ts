/**
 * 事件总线：后端 -> 前端的事件送达通道。
 * 事件统一走 queueMicrotask，保证"事件晚于本次 Promise 决议"的时序，
 * 与参考实现的安装/任务完成流程一致。
 */
type Payload = unknown
type Handler = (payload: Payload) => void

const listeners = new Map<string, Set<Handler>>()

export function subscribe(channel: string, cb: Handler): () => void {
  let set = listeners.get(channel)
  if (!set) {
    set = new Set()
    listeners.set(channel, set)
  }
  set.add(cb)
  return () => {
    const target = listeners.get(channel)
    if (!target) return
    target.delete(cb)
    if (target.size === 0) listeners.delete(channel)
  }
}

export function publish(channel: string, payload?: Payload): void {
  const set = listeners.get(channel)
  if (!set || set.size === 0) return
  queueMicrotask(() => {
    for (const cb of [...set]) {
      try {
        cb(payload)
      } catch (error) {
        console.error('[wcl.bridge] 事件处理失败', channel, error)
      }
    }
  })
}

export function subscriberCount(channel: string): number {
  return listeners.get(channel)?.size ?? 0
}
