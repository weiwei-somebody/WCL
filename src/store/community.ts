import { defineStore } from 'pinia'
import {
  communityDownload,
  communityFiles,
  communityProject,
  communitySearch,
  errText,
  getInstalled,
  getSettings,
  saveSettings
} from '@/api'
import { useDownloadsStore } from '@/store/downloads'
import type { DownloadJob } from '@/store/downloads'
import { lookupModName, mcmodEntryUrl, mcmodTypeOf, reverseLookupMod, translateNames } from '@/data/mcmod'
import { fetchModrinthProjectBriefs, fetchModrinthVersionById } from '@/data/modrinth'
import type { ModrinthProjectBrief } from '@/data/modrinth'
import type {
  CommunityDependency,
  CommunityFile,
  CommunityKind,
  CommunityModProject,
  CommunityResult,
  CommunitySource,
  InstalledVersion,
  LoaderName
} from '@shared/types'

/** 一次安装里的单个文件：dependency 为真表示它是被递归带进来的前置模组。 */
export interface PlanRow {
  file: CommunityFile
  name: string
  dependency: boolean
}

export interface ResolvedPlan {
  rows: PlanRow[]
  missing: string[]
}

const PAGE = 20

const KIND_LABEL: Record<CommunityKind, string> = {
  mod: '模组',
  modpack: '整合包',
  resourcepack: '资源包',
  shader: '光影',
  datapack: '数据包'
}

export const useCommunityStore = defineStore('community', {
  state: () => ({
    keyword: '',
    kind: 'mod' as CommunityKind,
    source: 'all' as 'all' | CommunitySource,
    mcVersion: '',
    loader: '' as LoaderName | '',
    sort: 'relevance' as 'relevance' | 'downloads' | 'newest',
    offset: 0,
    limit: PAGE,
    items: [] as CommunityResult[],
    total: 0,
    loading: false,
    ready: false,
    error: '',
    translating: false,
    searchNote: '',
    project: null as CommunityModProject | null,
    projectFiles: [] as CommunityFile[],
    loadingFiles: false,
    fileFilter: { mcVersion: '', loader: '' as LoaderName | '', kind: 'mod' as CommunityKind },
    entryUrl: '',
    onlyCompatible: true,
    withDeps: true,
    depTitles: {} as Record<string, ModrinthProjectBrief>,
    installed: [] as InstalledVersion[],
    targetId: ''
  }),
  getters: {
    pageCount(state): number {
      return Math.max(1, Math.ceil(state.total / state.limit))
    },
    page(state): number {
      return Math.floor(state.offset / state.limit) + 1
    },
    target(state): InstalledVersion | null {
      return state.installed.find((row) => row.id === state.targetId) ?? null
    },
    compatibility(state): { mcVersion: string; loader: LoaderName | '' } {
      const target = state.installed.find((row) => row.id === state.targetId)
      if (!state.onlyCompatible || !target) return { mcVersion: '', loader: '' }
      return { mcVersion: target.mcVersion, loader: target.loader ?? '' }
    }
  },
  actions: {
    async search(reset = true) {
      if (reset) this.offset = 0
      this.loading = true
      this.error = ''
      this.searchNote = ''
      try {
        const page = await communitySearch({
          keyword: await this.resolveKeyword(),
          kind: this.kind,
          source: this.source,
          mcVersion: this.mcVersion.trim() || undefined,
          loader: this.loader || undefined,
          sort: this.sort,
          offset: this.offset,
          limit: this.limit
        })
        this.items = page.items
        this.total = page.total
        this.offset = page.offset
        void this.translate()
      } catch (error) {
        this.error = errText(error)
        this.items = []
        this.total = 0
      } finally {
        this.loading = false
        this.ready = true
      }
    },
    /** 中文关键词先用 MC百科反查英文名，让搜索框也支持中文。 */
    async resolveKeyword(): Promise<string> {
      const keyword = this.keyword.trim()
      const type = mcmodTypeOf(this.kind)
      if (!type || !/[\u4e00-\u9fff]/.test(keyword)) return keyword
      const en = await reverseLookupMod(keyword, type)
      if (!en) return keyword
      this.searchNote = `中文关键词已按「${en}」检索`
      return en
    },
    async translate() {
      const type = mcmodTypeOf(this.kind)
      if (!type) return
      const rows = this.items.filter((row) => !row.originalTitle)
      if (!rows.length) return
      rows.forEach((row) => {
        row.originalTitle = row.title
      })
      this.translating = true
      try {
        await translateNames(
          rows,
          (row) => ({ title: row.originalTitle ?? row.title, slug: row.slug, type }),
          (row, zh) => {
            row.title = `${zh} (${row.originalTitle})`
          },
          4
        )
        for (const row of rows) {
          if (row.originalTitle && row.title === row.originalTitle) delete row.originalTitle
        }
      } catch {
        /* 译名补全失败不影响列表展示 */
      } finally {
        this.translating = false
      }
    },
    async goPage(page: number) {
      this.offset = Math.max(0, (page - 1) * this.limit)
      await this.search(false)
    },
    syncFilter() {
      const filter = this.compatibility
      this.fileFilter = { kind: this.kind, mcVersion: filter.mcVersion, loader: filter.loader }
    },
    async openProject(projectId: string, source: CommunitySource = 'modrinth') {
      this.projectFiles = []
      this.entryUrl = ''
      this.project = await communityProject(source, projectId, this.kind)
      this.syncFilter()
      void this.translateProject()
      await this.loadProjectFiles()
    },
    async translateProject() {
      const project = this.project
      if (!project) return
      const type = mcmodTypeOf(this.kind)
      if (!type) return
      const original = project.originalTitle ?? project.title
      if (project.title !== original) return
      const result = await lookupModName(original, project.slug ?? '', type)
      if (!result.zh) return
      project.originalTitle = original
      project.title = `${result.zh} (${original})`
      this.entryUrl = mcmodEntryUrl(result.entryId, result.type ?? type)
    },
    async loadProjectFiles() {
      if (!this.project) return
      this.loadingFiles = true
      try {
        this.projectFiles = await communityFiles('modrinth', this.project.projectId, this.fileFilter)
        void this.loadDepTitles()
      } catch (error) {
        this.error = errText(error)
        this.projectFiles = []
      } finally {
        this.loadingFiles = false
      }
    },
    /** 批量取回前置模组的可读名称，供文件行展示。 */
    async loadDepTitles() {
      const ids = new Set<string>()
      for (const file of this.projectFiles) {
        for (const dep of file.dependencies ?? []) if (dep.projectId) ids.add(dep.projectId)
      }
      const missing = [...ids].filter((id) => !this.depTitles[id])
      if (!missing.length) return
      try {
        const briefs = await fetchModrinthProjectBriefs(missing)
        this.depTitles = { ...this.depTitles, ...briefs }
      } catch {
        /* 名称取不到时回落到项目 id，不影响下载 */
      }
    },
    depTitle(projectId?: string): string {
      if (!projectId) return '未知前置'
      return this.depTitles[projectId]?.title ?? projectId
    },
    /**
     * 递归展开必需前置：已锁定的版本按 fileId 精确取回，否则在目标实例的
     * 版本+加载器条件下取该项目最新的兼容文件，边展开边去重防止循环依赖。
     */
    async resolvePlan(file: CommunityFile): Promise<ResolvedPlan> {
      const rows: PlanRow[] = [{ file, name: this.depTitle(file.projectId), dependency: false }]
      const seen = new Set<string>()
      if (file.projectId) seen.add(file.projectId)
      seen.add(file.fileId)
      const queue: CommunityDependency[] = (file.dependencies ?? []).filter((dep) => dep.required)
      const missing: string[] = []
      let guard = 0
      while (queue.length && guard++ < 80) {
        const dep = queue.shift() as CommunityDependency
        const key = dep.projectId ?? dep.fileId ?? ''
        if (!key || seen.has(key)) continue
        seen.add(key)
        let resolved: CommunityFile | null = null
        if (dep.fileId) {
          try {
            resolved = await fetchModrinthVersionById(dep.fileId)
          } catch {
            resolved = null
          }
        }
        if (!resolved && dep.projectId) {
          try {
            const list = await communityFiles('modrinth', dep.projectId, this.fileFilter)
            resolved = list[0] ?? null
          } catch {
            resolved = null
          }
        }
        if (!resolved) {
          missing.push(this.depTitle(dep.projectId))
          continue
        }
        if (resolved.projectId) seen.add(resolved.projectId)
        seen.add(resolved.fileId)
        rows.push({ file: resolved, name: this.depTitle(dep.projectId ?? resolved.projectId), dependency: true })
        for (const child of resolved.dependencies ?? []) if (child.required) queue.push(child)
      }
      return { rows, missing }
    },
    async setWithDeps(value: boolean) {
      this.withDeps = value
    },
    /**
     * 把一次安装加入统一下载队列：立即返回，后台串行下载；
     * 已锁定的必需前置按 fileId 精确取回，取不到时在目标实例条件下取最新兼容文件。
     */
    enqueue(file: CommunityFile): DownloadJob {
      const target = this.target
      if (!target) throw new Error('请先选择目标实例')
      const downloads = useDownloadsStore()
      downloads.watch()
      const required = (file.dependencies ?? []).filter((dep) => dep.required)
      const withDeps = this.withDeps && !!required.length
      const kind = this.kind
      const folder = target.folder
      const label = target.gameDirectory ?? target.folder
      return downloads.enqueue({
        kind: kind === 'mod' ? 'mod' : 'resource',
        title: file.fileName,
        target: label,
        note: withDeps ? `${KIND_LABEL[kind]} · 含 ${required.length} 个必需前置` : KIND_LABEL[kind],
        run: async (id) => {
          const plan = withDeps
            ? await this.resolvePlan(file)
            : { rows: [{ file, name: file.fileName, dependency: false }], missing: [] }
          downloads.patch(id, { total: plan.rows.length, done: 0, note: '下载中' })
          for (let index = 0; index < plan.rows.length; index++) {
            downloads.patch(id, { done: index })
            await communityDownload(plan.rows[index].file, { versionId: target.id, kind, folder }, id)
          }
          if (plan.missing.length) {
            return `已安装 ${plan.rows.length} 个文件，${plan.missing.length} 个前置未找到兼容版本：${plan.missing.join('、')}`
          }
          return `已安装 ${plan.rows.length} 个文件到 ${label}`
        }
      })
    },
    closeProject() {
      this.project = null
      this.projectFiles = []
      this.entryUrl = ''
    },
    async loadInstalled() {
      this.installed = await getInstalled()
      const active = (await getSettings()).activeInstanceId ?? ''
      this.targetId = this.installed.some((row) => row.id === active) ? active : this.installed[0]?.id ?? ''
      this.syncFilter()
    },
    async selectTarget(id: string) {
      this.targetId = id
      await saveSettings({ activeInstanceId: id })
      this.syncFilter()
      if (this.project) await this.loadProjectFiles()
    },
    async setOnlyCompatible(value: boolean) {
      this.onlyCompatible = value
      this.syncFilter()
      if (this.project) await this.loadProjectFiles()
    }
  }
})
