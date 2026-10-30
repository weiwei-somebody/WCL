import { defineStore } from 'pinia'
import {
  errText,
  getInstalled,
  getSettings,
  getVersionCatalog,
  onInstallDone,
  removeVersion,
  renameVersion,
  saveSettings,
  setVersionIsolation
} from '@/api'
import { filterVersions } from '@shared/versionPicker'
import type { VersionCategory } from '@shared/versionPicker'
import type { InstalledVersion, RemoteVersion } from '@shared/types'

export const useVersionsStore = defineStore('versions', {
  state: () => ({
    remote: [] as RemoteVersion[],
    checkedAt: 0,
    stale: false,
    remoteReady: false,
    remoteError: '',
    loadingRemote: false,
    installed: [] as InstalledVersion[],
    installedReady: false,
    category: 'all' as VersionCategory,
    query: '',
    watching: false,
    activeId: ''
  }),
  getters: {
    filtered(state): RemoteVersion[] {
      return filterVersions(state.remote, state.category, state.query)
    },
    latestRelease(state): string {
      return state.remote.find((item) => item.type === 'release')?.id ?? ''
    },
    installedIds(state): Set<string> {
      return new Set(state.installed.map((item) => item.id))
    }
  },
  actions: {
    async loadRemote(refresh = false) {
      this.loadingRemote = true
      try {
        const result = await getVersionCatalog(refresh)
        this.remote = result.versions
        this.checkedAt = result.checkedAt
        this.stale = result.stale
        this.remoteError = ''
      } catch (error) {
        this.remoteError = errText(error)
      } finally {
        this.remoteReady = true
        this.loadingRemote = false
      }
    },
    async loadInstalled() {
      this.installed = await getInstalled()
      const active = (await getSettings()).activeInstanceId ?? ''
      if (this.installed.some((item) => item.id === active)) this.activeId = active
      else this.activeId = this.installed[0]?.id ?? ''
      this.installedReady = true
    },
    /** 设为当前实例：首页启动卡与各资源页都以它为目标。 */
    async setActive(id: string) {
      this.activeId = id
      await saveSettings({ activeInstanceId: id })
    },
    watch() {
      if (this.watching) return
      this.watching = true
      onInstallDone(async () => {
        await this.loadInstalled()
      })
    },
    async remove(id: string) {
      await removeVersion(id)
      await this.loadInstalled()
    },
    async rename(id: string, name: string) {
      await renameVersion(id, name)
      await this.loadInstalled()
    },
    async setIsolation(id: string, isolated: boolean) {
      await setVersionIsolation(id, isolated)
      await this.loadInstalled()
    }
  }
})
