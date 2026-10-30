import { defineStore } from 'pinia'
import { errText, killGame, launchGame, onLaunchLog, onLaunchState, onProgress, restartGame, cancelGameRestart } from '@/api'
import type { LaunchState, ProgressEvent } from '@shared/types'

const LAST_PLAYED_KEY = 'wcl.lastPlayed'

function readLastPlayed(): Record<string, number> {
  try {
    const raw = localStorage.getItem(LAST_PLAYED_KEY)
    return raw ? (JSON.parse(raw) as Record<string, number>) : {}
  } catch {
    return {}
  }
}

export const useLaunchStore = defineStore('launch', {
  state: () => ({
    state: null as LaunchState | null,
    progress: null as ProgressEvent | null,
    logs: [] as string[],
    activeId: '',
    activeFolder: '',
    watching: false,
    lastPlayed: readLastPlayed() as Record<string, number>
  }),
  getters: {
    launching: (state) => state.state?.status === 'launching',
    running: (state) => state.state?.status === 'running',
    failed: (state) =>
      state.state?.status === 'error' || (state.state?.status === 'exited' && (state.state?.code ?? 0) !== 0)
  },
  actions: {
    watch() {
      if (this.watching) return
      this.watching = true
      onLaunchState((next) => {
        this.state = next
        if (next.status === 'running' && next.versionId) this.recordLastPlayed(next.versionId)
      })
      onLaunchLog((line) => {
        this.logs.push(line)
        if (this.logs.length > 2000) this.logs.splice(0, this.logs.length - 2000)
      })
      onProgress((event) => {
        if (event.stage === 'launch' || event.taskId?.startsWith('run-')) this.progress = event
      })
    },
    recordLastPlayed(id: string) {
      this.lastPlayed = { ...this.lastPlayed, [id]: Date.now() }
      localStorage.setItem(LAST_PLAYED_KEY, JSON.stringify(this.lastPlayed))
    },
    async launch(id: string, folder = '', serverAddress = '') {
      if (!id || this.launching) return
      this.watch()
      this.activeId = id
      this.activeFolder = folder
      this.logs = []
      this.progress = null
      this.state = { status: 'launching', text: '正在准备启动…' }
      try {
        await launchGame(id, serverAddress || undefined, folder)
      } catch (error) {
        this.state = { status: 'error', text: errText(error) }
        throw error
      }
    },
    async kill() {
      this.watch()
      await killGame()
      this.recordLastPlayed(this.activeId)
    },
    async restart(id: string, folder = '', forceToken?: string) {
      this.watch()
      const result = await restartGame(id, folder, forceToken)
      if (!result.requiresForce) this.activeId = id
      return result
    },
    async cancelRestart() {
      await cancelGameRestart()
    }
  }
})
