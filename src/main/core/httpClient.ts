/**
 * 共享 HTTP 客户端：undici Agent，keepAlive 连接复用，用法与全局 fetch 一致
 * （httpFetch 内部带共享 dispatcher）。
 *
 * allowH2 固定关闭：undici 的 h2 会话在收到服务端 GOAWAY 时会触发
 * assert(client[kRunning] === 0) 断言异常（client-h2.js:onHTTP2GoAway），
 * 使下载中途异常终止并留下未完成的安装标记，故统一走 HTTP/1.1 连接复用。
 *
 * bodyTimeoutMs（可选增量参数，仅下载路径使用）：undici 的 bodyTimeout 监测「socket 层
 * 相邻两次收到响应数据的间隔」。共享 Agent 默认 30s；下载在读循环里做限速/暂停时，
 * TCP 背压会让服务端合法停发数据，低档限速（如 1KiB/s 放行一个 64KB 读块需 ~64s）
 * 会被 30s 默认值误判为死链而反复中止（表现为「下载总是被取消」），因此下载路径显式
 * 传更长的 bodyTimeoutMs，其余调用方（frp 等）行为不变。
 */
import { Agent, fetch as undiciFetch } from 'undici'
import { waitIfTaskPaused } from './tasks'

/** 共享 Agent 与按 bodyTimeout 派生 Agent 的公共参数；调整时两者保持一致。 */
const AGENT_BASE_OPTIONS = {
  allowH2: false,
  keepAliveTimeout: 10_000,
  keepAliveMaxTimeout: 60_000,
  connections: 32,
  headersTimeout: 30_000
}

const sharedAgent = new Agent({ ...AGENT_BASE_OPTIONS, bodyTimeout: 30_000 })

/** bodyTimeoutMs → 派生 Agent 缓存。键空间恒定（下载路径只用一个常量值），不会无限增长。 */
const bodyTimeoutAgents = new Map<number, Agent>()
// Range workers need separate TCP connections rather than reusing one shared connection.
const rangeAgent = new Agent({ ...AGENT_BASE_OPTIONS, bodyTimeout: 120_000 })

function agentWithBodyTimeout(bodyTimeoutMs: number): Agent {
  let agent = bodyTimeoutAgents.get(bodyTimeoutMs)
  if (!agent) {
    agent = new Agent({ ...AGENT_BASE_OPTIONS, bodyTimeout: bodyTimeoutMs })
    bodyTimeoutAgents.set(bodyTimeoutMs, agent)
  }
  return agent
}

/** 与全局 fetch 同签名；signal/headers/redirect 等透传，dispatcher 固定为共享连接池 Agent。
 *  bodyTimeoutMs 为可选增量参数：不传时行为与旧版完全一致。 */
export function httpFetch(
  url: string,
  init: { signal?: AbortSignal; headers?: Record<string, string>; redirect?: 'follow' | 'manual' | 'error'; method?: string; body?: string; bodyTimeoutMs?: number; separateConnection?: boolean; systemProxy?: boolean } = {}
): Promise<Response> {
  // Runtime downloads must use the same OS proxy/PAC and certificate store as
  // the desktop app. Node fetch/undici do not inherit macOS system proxy settings.
  if (init.systemProxy && process.versions.electron) {
    const { systemProxy, bodyTimeoutMs, separateConnection, ...request } = init
    if (request.redirect === 'manual') return import('./systemDownload').then(({ systemDownload }) => systemDownload(url, request))
    return import('electron').then(async ({ net }) => {
      // A pause/cancel can arrive while the module is loading. Recheck at the
      // actual transport boundary, not only in the caller before this await.
      await waitIfTaskPaused(request.signal)
      request.signal?.throwIfAborted()
      return net.fetch(url, request)
    }) as Promise<Response>
  }
  if (init.separateConnection) {
    const { separateConnection, bodyTimeoutMs, ...rest } = init
    return undiciFetch(url, { ...rest, dispatcher: rangeAgent }) as unknown as Promise<Response>
  }
  if (init.bodyTimeoutMs != null) {
    const { bodyTimeoutMs, ...rest } = init
    return undiciFetch(url, { ...rest, dispatcher: agentWithBodyTimeout(bodyTimeoutMs) }) as unknown as Promise<Response>
  }
  return undiciFetch(url, { ...init, dispatcher: sharedAgent }) as unknown as Promise<Response>
}

/** 重试间隔（毫秒）：只针对网络层瞬时失败与限流/5xx，避开连接抖动窗口。 */
const RETRY_DELAYS = [400, 1200]

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve()
    let timer: ReturnType<typeof setTimeout> | undefined
    const onAbort = (): void => {
      if (timer) clearTimeout(timer)
      resolve()
    }
    timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * 轻量 JSON 接口请求（版本清单、加载器列表、社区搜索等）：
 * Node fetch 在网络抖动/限流时可能直接抛 `fetch failed`，这里按退避重试；
 * 仍失败则改走 Electron 系统网络（系统代理 + 系统证书库），避免 Node 侧连不通时功能整块不可用。
 * HTTP 4xx（除 429）不重试，直接抛出，保持原有错误语义。
 */
export async function fetchJsonResilient(url: string, init: { signal?: AbortSignal; headers?: Record<string, string> } = {}): Promise<unknown> {
  let last: unknown = new Error(`请求失败：${url}`)
  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
    init.signal?.throwIfAborted()
    let res: Response | null = null
    try {
      res = await fetch(url, { signal: init.signal, headers: init.headers })
    } catch (error) {
      last = error
    }
    if (res) {
      if (res.ok) return await res.json()
      last = new Error(`HTTP ${res.status}: ${url}`)
      if (res.status !== 429 && res.status < 500) throw last
    }
    if (init.signal?.aborted) throw last
    if (attempt < RETRY_DELAYS.length) await sleep(RETRY_DELAYS[attempt], init.signal)
  }
  if (process.versions.electron) {
    const res = await httpFetch(url, { signal: init.signal, headers: init.headers, systemProxy: true })
    if (res.ok) return await res.json()
    throw new Error(`HTTP ${res.status}: ${url}`)
  }
  throw last
}

/** 进程退出时关闭连接池（Electron 退出由主进程生命周期管理，这里仅防御性提供）。 */
export async function closeHttpClient(): Promise<void> {
  await Promise.all([sharedAgent.close(), rangeAgent.close(), ...[...bodyTimeoutAgents.values()].map((agent) => agent.close())])
}
