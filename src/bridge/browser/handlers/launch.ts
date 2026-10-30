import { IPC, IPC_EVENT } from '../../contract'
import { publish } from '../../bus'
import { readInstalled } from '../storage'
import type { LaunchState } from '@shared/types'

const STEPS = ['校验实例完整性', '解析版本 JSON', '准备依赖库与资源', '检查 Java 运行时', '注入启动参数', '启动游戏进程']

interface Session {
  launchId: string
  versionId: string
  folder: string
  logs: string[]
  stopped: boolean
  running: boolean
}

let session: Session | null = null
let ticker: ReturnType<typeof setInterval> | null = null

function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

function stamp(): string {
  return new Date().toTimeString().slice(0, 8)
}

function log(line: string): void {
  const text = `[${stamp()}] ${line}`
  if (session) session.logs.push(text)
  publish(IPC_EVENT.launchLog, text)
}

function state(next: LaunchState): void {
  publish(IPC_EVENT.launchState, next)
}

function stopTicker(): void {
  if (ticker) clearInterval(ticker)
  ticker = null
}

async function runLaunch(id: string, folder: string, serverAddress?: string, createCommandWorld = false): Promise<void> {
  const instance = readInstalled().find((row) => row.id === id && (!folder || row.folder === folder))
  if (!instance) throw new Error('实例不存在或尚未安装')
  const launchId = `run-${Date.now()}`
  session = { launchId, versionId: id, folder: instance.folder, logs: [], stopped: false, running: false }
  state({ launchId, versionId: id, folder: instance.folder, status: 'launching', text: '正在准备启动…' })
  log(`浏览器模拟启动 ${id}（Minecraft ${instance.mcVersion}）`)
  if (instance.loader) log(`加载器 ${instance.loader} ${instance.loaderVersion ?? ''}`.trim())
  if (serverAddress) log(`指定服务器 ${serverAddress}`)
  if (createCommandWorld) log('请求创建调试世界')
  for (let i = 0; i < STEPS.length; i++) {
    if (!session || session.stopped) return
    const step = STEPS[i]
    for (let part = 0; part <= 4; part++) {
      if (!session || session.stopped) return
      publish(IPC_EVENT.progress, {
        taskId: launchId,
        versionId: id,
        stage: 'launch',
        progress: part / 4,
        overall: (i + part / 4) / STEPS.length,
        text: step,
        taskTitle: `启动 ${id}`
      })
      await sleep(70)
    }
    log(step)
  }
  if (!session || session.stopped) return
  log('游戏进程已启动（模拟）')
  session.running = true
  state({ launchId, versionId: id, folder: instance.folder, status: 'running', text: '游戏运行中（模拟）' })
  const startedAt = Date.now()
  ticker = setInterval(() => {
    if (!session || !session.running) return
    log(`[客户端] 模拟运行中，已运行 ${Math.round((Date.now() - startedAt) / 1000)} 秒`)
  }, 5000)
}

function exitSession(intentional: boolean, text: string): void {
  if (!session) return
  session.running = false
  session.stopped = true
  stopTicker()
  log(text)
  state({ launchId: session.launchId, versionId: session.versionId, folder: session.folder, status: 'exited', text, code: 0, intentionalStop: intentional })
}

export const launchHandlers = {
  [IPC.gameLaunch]: (id: string, serverAddress?: string, folder?: string, createCommandWorld = false) => {
    void runLaunch(id, folder ?? '', serverAddress, createCommandWorld)
    return null
  },
  [IPC.gameKill]: () => {
    if (!session) return { requiresForce: false }
    exitSession(true, '已请求结束游戏进程（模拟）')
    return { requiresForce: false }
  },
  [IPC.gameRestart]: (id: string, folder: string, forceToken?: string) => {
    if (!session?.running) {
      void runLaunch(id, folder)
      return { requiresForce: false }
    }
    if (!forceToken) return { requiresForce: true, forceToken: `force-${Date.now()}` }
    exitSession(true, '正在正常退出并重新启动（模拟）')
    session = null
    const instance = readInstalled().find((row) => row.id === id && (!folder || row.folder === folder))
    void runLaunch(id, instance?.folder ?? folder)
    return { requiresForce: false }
  },
  [IPC.gameRestartCancel]: () => null,
  [IPC.launchExportLogs]: (versionId: string) => {
    const lines = session?.logs ?? []
    if (!lines.length) return null
    const name = `wcl-launch-${versionId || 'log'}-${Date.now()}.log`
    try {
      const blob = new Blob([lines.join('\n')], { type: 'text/plain' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = name
      link.click()
      URL.revokeObjectURL(url)
    } catch {
      return null
    }
    return name
  }
}
