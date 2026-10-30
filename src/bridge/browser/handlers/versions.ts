import { IPC, IPC_EVENT } from '../../contract'
import { publish } from '../../bus'
import { fetchRemoteVersions } from '@/data/mojang'
import { activeFolder, patchInstalled, readInstalled, readSettings, writeInstalled, writeSettings } from '../storage'
import type {
  GameResolution,
  InstallOptions,
  InstalledVersion,
  IsolationMigrationPlan,
  RemoteVersion
} from '@shared/types'

const CACHE_TTL = 10 * 60 * 1000

const STAGES: Array<{ stage: string; text: string }> = [
  { stage: 'version-json', text: '获取版本信息' },
  { stage: 'client', text: '下载客户端' },
  { stage: 'libraries', text: '下载依赖库' },
  { stage: 'assets', text: '下载资源文件' }
]

let cache: { versions: RemoteVersion[]; checkedAt: number } | null = null
const cancelled = new Set<string>()

function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

function instanceId(versionId: string, opts?: InstallOptions): string {
  const name = opts?.instanceName?.trim()
  if (name) return name
  return opts?.loader ? `${versionId}-${opts.loader}` : versionId
}

async function runInstall(versionId: string, opts?: InstallOptions): Promise<void> {
  const folder = activeFolder()
  const id = instanceId(versionId, opts)
  const taskId = `install-${id}-${Date.now()}`
  const title = `安装 ${id}`
  for (let i = 0; i < STAGES.length; i++) {
    const step = STAGES[i]
    for (let part = 0; part <= 4; part++) {
      if (cancelled.has(taskId)) {
        cancelled.delete(taskId)
        publish(IPC_EVENT.installDone, { versionId, installedId: id, ok: false, cancelled: true, taskId, stage: step.stage })
        publish(IPC_EVENT.taskDone, { taskId, ok: false, cancelled: true, stage: step.stage })
        return
      }
      publish(IPC_EVENT.progress, {
        taskId,
        versionId,
        stage: step.stage,
        progress: part / 4,
        overall: (i + part / 4) / STAGES.length,
        text: step.text,
        taskTitle: title
      })
      await sleep(90)
    }
  }
  const isolated = readSettings().defaultIsolation !== false
  const record: InstalledVersion = {
    id,
    mcVersion: versionId,
    loader: opts?.loader,
    loaderVersion: opts?.loaderVersion,
    isolated,
    gameDirectory: isolated ? `${folder}/versions/${id}` : folder,
    folder,
    javaPath: '',
    javaAuto: true
  }
  writeInstalled([record, ...readInstalled().filter((item) => item.id !== id)])
  if (!readSettings().activeInstanceId) writeSettings({ activeInstanceId: id })
  publish(IPC_EVENT.progress, { taskId, versionId, stage: 'done', progress: 1, overall: 1, text: '安装完成', taskTitle: title })
  publish(IPC_EVENT.installDone, { versionId, installedId: id, ok: true, taskId })
  publish(IPC_EVENT.taskDone, { taskId, ok: true })
}

export const versionHandlers = {
  [IPC.versionsManifest]: async () => fetchRemoteVersions(),
  [IPC.versionsCatalog]: async (refresh?: boolean) => {
    if (!refresh && cache && Date.now() - cache.checkedAt < CACHE_TTL) {
      return { versions: cache.versions, checkedAt: cache.checkedAt, stale: false }
    }
    const versions = await fetchRemoteVersions()
    cache = { versions, checkedAt: Date.now() }
    return { versions, checkedAt: cache.checkedAt, stale: false }
  },
  [IPC.versionsInstalled]: () => readInstalled(),
  [IPC.versionsInstall]: (versionId: string, opts?: InstallOptions) => {
    void runInstall(versionId, opts)
    return null
  },
  [IPC.versionsRemove]: (id: string) => {
    writeInstalled(readInstalled().filter((item) => item.id !== id))
    if (readSettings().activeInstanceId === id) writeSettings({ activeInstanceId: '' })
    return null
  },
  [IPC.versionsRename]: (id: string, newName: string) => {
    patchInstalled(id, { id: newName })
    return null
  },
  [IPC.versionsSetJava]: (id: string, javaPath: string, automatic = false) => {
    patchInstalled(id, { javaPath, javaAuto: automatic })
    return null
  },
  [IPC.versionsSetResolution]: (id: string, resolution: GameResolution | null) => {
    patchInstalled(id, { resolution: resolution ?? undefined })
    return null
  },
  [IPC.versionsSetIsolation]: (id: string, isolated: boolean) => {
    const item = readInstalled().find((row) => row.id === id)
    const root = item?.folder || activeFolder()
    patchInstalled(id, { isolated, gameDirectory: isolated ? `${root}/versions/${id}` : root })
    return null
  },
  [IPC.versionsIsolationPlan]: (id: string): IsolationMigrationPlan => {
    const item = readInstalled().find((row) => row.id === id)
    const root = item?.folder || activeFolder()
    return {
      versionId: id,
      source: root,
      destination: `${root}/versions/${id}`,
      items: [],
      conflicts: [],
      totalFiles: 0,
      totalBytes: 0
    }
  },
  [IPC.versionsSetIcon]: (id: string, icon: string) => {
    patchInstalled(id, { icon })
    return null
  },
  [IPC.versionsCleanup]: () => false,
  [IPC.tasksCancel]: (taskId: string) => {
    cancelled.add(taskId)
    return true
  },
  [IPC.tasksPause]: () => false,
  [IPC.tasksResume]: () => false
}
