import { defineStore } from 'pinia'
import {
  cancelTask,
  errText,
  exportModpack,
  importWorld,
  installModpack,
  installVersion,
  onInstallDone,
  onProgress,
  onTaskDone,
  probeImport,
  supplyModpackFiles
} from '@/api'
import { useVersionsStore } from '@/store/versions'
import type {
  ImportProbeResult,
  InstallOptions,
  ManualModpackRequest,
  ModpackExportOptions,
  ModpackInfo,
  ModpackInstallRequest,
  WorldImportInfo,
  WorldImportOptions
} from '@shared/types'

export type DownloadKind = 'version' | 'mod' | 'resource' | 'modpack' | 'world' | 'export'
export type DownloadStatus = 'pending' | 'running' | 'done' | 'error' | 'canceled'

export interface DownloadJob {
  id: string
  kind: DownloadKind
  title: string
  target: string
  note: string
  ref: string
  status: DownloadStatus
  percent: number
  text: string
  error: string
  taskId: string
  total: number
  done: number
  createdAt: number
}

export interface DownloadSpec {
  kind: DownloadKind
  title: string
  target: string
  ref?: string
  note?: string
  run: (id: string) => Promise<string | void>
}

export type PendingImport =
  | { path: string; kind: 'modpack'; info: ModpackInfo }
  | { path: string; kind: 'world'; info: WorldImportInfo }

/** 各任务的执行体按 job id 暂存，串行调度只负责排队与状态。 */
const runners = new Map<string, (id: string) => Promise<string | void>>()
const waiters = new Map<string, () => void>()

function isCancelText(text: string): boolean {
  return /取消|abort/i.test(text)
}

export const useDownloadsStore = defineStore('downloads', {
  state: () => ({
    jobs: [] as DownloadJob[],
    queueRunning: false,
    manual: null as ManualModpackRequest | null,
    pendingImport: null as PendingImport | null,
    /** 从实例页发起导入时带上目标实例，弹窗据此预选目标。 */
    importHint: null as { versionId: string; folder: string } | null,
    watching: false
  }),
  getters: {
    current(state): DownloadJob | null {
      return state.jobs.find((row) => row.status === 'running') ?? null
    },
    pendingCount(state): number {
      return state.jobs.filter((row) => row.status === 'pending').length
    },
    finishedCount(state): number {
      return state.jobs.filter(
        (row) => row.status === 'done' || row.status === 'error' || row.status === 'canceled'
      ).length
    }
  },
  actions: {
    enqueue(spec: DownloadSpec): DownloadJob {
      const job: DownloadJob = {
        id: `dl-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        kind: spec.kind,
        title: spec.title,
        target: spec.target,
        note: spec.note ?? '',
        ref: spec.ref ?? '',
        status: 'pending',
        percent: 0,
        text: '等待中',
        error: '',
        taskId: '',
        total: 0,
        done: 0,
        createdAt: Date.now()
      }
      runners.set(job.id, spec.run)
      this.jobs = [...this.jobs, job]
      void this.drain()
      return job
    },
    patch(id: string, patch: Partial<DownloadJob>) {
      this.jobs = this.jobs.map((row) => (row.id === id ? { ...row, ...patch } : row))
    },
    find(id: string): DownloadJob | null {
      return this.jobs.find((row) => row.id === id) ?? null
    },
    /** 串行执行：同一时刻只跑一个任务，结束自动接下一个。 */
    async drain() {
      if (this.queueRunning) return
      this.queueRunning = true
      try {
        let job = this.jobs.find((row) => row.status === 'pending')
        while (job) {
          await this.start(job)
          job = this.jobs.find((row) => row.status === 'pending')
        }
      } finally {
        this.queueRunning = false
      }
    },
    async start(job: DownloadJob) {
      this.watch()
      this.patch(job.id, { status: 'running', percent: 0, text: '准备中', taskId: '', error: '', done: 0 })
      const waiter = new Promise<void>((resolve) => waiters.set(job.id, resolve))
      const runner = runners.get(job.id)
      if (!runner) {
        this.finish(job.id, 'error', '任务已失效，请重新加入队列')
        return
      }
      void runner(job.id)
        .then((note) => {
          const row = this.find(job.id)
          if (row?.status !== 'running') return
          // 实例与整合包由主进程异步执行，成功结果经 event:installDone 落地
          if (job.kind === 'version' || job.kind === 'modpack') return
          this.finish(job.id, 'done', '', String(note ?? '已完成'))
        })
        .catch((error) => {
          const row = this.find(job.id)
          if (row?.status !== 'running') return
          const text = errText(error)
          this.finish(job.id, isCancelText(text) ? 'canceled' : 'error', text)
        })
      await waiter
    },
    finish(id: string, status: DownloadStatus, error = '', note = '') {
      const job = this.find(id)
      const patch: Partial<DownloadJob> = { status, error }
      if (note) patch.note = note
      if (status === 'done') {
        patch.percent = 100
        patch.text = '已完成'
      } else if (status === 'canceled') {
        patch.text = '已取消'
      } else if (status === 'error') {
        patch.text = '失败'
      }
      this.patch(id, patch)
      waiters.get(id)?.()
      waiters.delete(id)
      if (status === 'done' && job && ['version', 'modpack', 'world'].includes(job.kind)) {
        void useVersionsStore().loadInstalled()
      }
    },
    async cancelJob(id: string) {
      const job = this.find(id)
      if (!job) return
      if (job.taskId) {
        await cancelTask(job.taskId)
        return
      }
      if (job.status === 'pending') this.finish(id, 'canceled')
    },
    retry(id: string) {
      const job = this.find(id)
      if (!job || !runners.has(id)) return
      if (job.status === 'running' || job.status === 'pending') return
      this.patch(id, { status: 'pending', percent: 0, text: '等待中', error: '', taskId: '', done: 0 })
      void this.drain()
    },
    remove(id: string) {
      const job = this.find(id)
      if (!job || job.status === 'running') return
      runners.delete(id)
      waiters.delete(id)
      this.jobs = this.jobs.filter((row) => row.id !== id)
    },
    clearFinished() {
      for (const row of this.jobs) {
        if (row.status === 'pending' || row.status === 'running') continue
        runners.delete(row.id)
        waiters.delete(row.id)
      }
      this.jobs = this.jobs.filter((row) => row.status === 'pending' || row.status === 'running')
    },
    queueVersion(versionId: string, opts?: InstallOptions): DownloadJob {
      const bits = [versionId]
      if (opts?.loader) bits.push(opts.loader)
      if (opts?.fabricApi) bits.push(`Fabric API ${opts.fabricApi}`)
      return this.enqueue({
        kind: 'version',
        title: `安装实例 ${opts?.instanceName?.trim() || versionId}`,
        target: versionId,
        ref: versionId,
        note: bits.join(' · '),
        run: async () => {
          await installVersion(versionId, opts)
        }
      })
    },
    queueModpack(path: string, info: ModpackInfo, opts: ModpackInstallRequest): DownloadJob {
      const bits: string[] = [info.mcVersion]
      if (info.loader) bits.push(`${info.loader}${info.loaderVersion ? ` ${info.loaderVersion}` : ''}`)
      return this.enqueue({
        kind: 'modpack',
        title: `导入整合包 ${info.fileName || info.innerName}`,
        target: opts.instanceName?.trim() || info.fileName || info.innerName,
        note: `${bits.join(' · ')} · 共 ${info.fileCount} 个文件`,
        run: async () => {
          await installModpack(path, opts)
        }
      })
    },
    queueWorld(path: string, options: WorldImportOptions, label: string): DownloadJob {
      return this.enqueue({
        kind: 'world',
        title: `导入存档 ${options.worldName}`,
        target: label,
        note: options.newInstance
          ? `新建实例 ${options.newInstance.instanceName}`
          : `导入到实例 ${options.targetVersionId ?? ''}`,
        run: async () => {
          const result = await importWorld(path, options)
          return result.createdInstance
            ? `已新建实例 ${result.versionId} 并导入存档`
            : `已导入到实例 ${result.versionId}`
        }
      })
    },
    queueExport(options: ModpackExportOptions, target: string, note: string): DownloadJob {
      return this.enqueue({
        kind: 'export',
        title: `导出整合包 ${options.name.trim() || options.versionId}`,
        target,
        note,
        run: async () => {
          const file = await exportModpack(options)
          return `已导出到 ${file}`
        }
      })
    },
    /** 按路径探测导入内容；整合包与存档挂起等待确认弹窗。 */
    async openImport(path: string, hint?: { versionId: string; folder: string }): Promise<void> {
      const result = (await probeImport(path)) as ImportProbeResult | null
      if (!result) throw new Error('浏览器阶段无法读取本地文件，请使用「导入示例」按钮体验流程')
      this.importHint = hint ?? null
      if (result.kind === 'modpack') {
        this.pendingImport = { path, kind: 'modpack', info: result.info }
        return
      }
      if (result.kind === 'world') {
        this.pendingImport = { path, kind: 'world', info: result.info }
        return
      }
      if (result.kind === 'mod') throw new Error('单个模组文件请到「社区资源」页加入下载队列')
      throw new Error(result.message)
    },
    closeImport() {
      this.pendingImport = null
      this.importHint = null
    },
    /** 整合包缺文件时按批次补充；主进程会弹出文件选择框。 */
    async supplyFiles(): Promise<string> {
      const manual = this.manual
      if (!manual) return '当前没有待补充的文件'
      const result = (await supplyModpackFiles(manual.token)) as
        | { accepted: number; remaining: number; rejected: string[] }
        | null
      if (!result) return '未补充任何文件'
      if (result.remaining <= 0) {
        this.manual = null
        return `已补齐全部缺失文件（${result.accepted} 个）`
      }
      return `已接受 ${result.accepted} 个，仍缺 ${result.remaining} 个`
    },
    watch() {
      if (this.watching) return
      this.watching = true
      onProgress((event) => {
        if (!event.taskId || event.taskId.startsWith('run-')) return
        const job = this.current
        if (!job) return
        if (job.taskId && job.taskId !== event.taskId) return
        const patch: Partial<DownloadJob> = {
          percent: Math.round((event.overall ?? event.progress) * 100),
          text: event.text
        }
        if (!job.taskId) patch.taskId = event.taskId
        this.patch(job.id, patch)
        if (event.manualFiles !== undefined) this.manual = event.manualFiles ?? null
      })
      onTaskDone((result) => {
        const job = this.current
        if (!job || !job.taskId || job.taskId !== result.taskId || result.ok) return
        this.finish(job.id, result.cancelled ? 'canceled' : 'error', result.error ?? '任务失败')
      })
      onInstallDone((result) => {
        const job = this.current
        if (!job) return
        const matched =
          (!!job.taskId && !!result.taskId && job.taskId === result.taskId) ||
          (job.kind === 'version' && !!job.ref && job.ref === result.versionId)
        if (!matched) return
        if (result.ok) {
          this.finish(job.id, 'done', '', `已安装 ${result.installedId ?? result.versionId ?? job.title}`)
          return
        }
        this.finish(job.id, result.cancelled ? 'canceled' : 'error', result.error ?? '安装失败')
      })
    }
  }
})
