import { IPC } from '../../contract'
import { createFallbackSkin } from '@/data/fallbackSkin'
import { capeTextureUrl } from '@/data/capeTexture'
import type { CapeInfo, ProfileSkins, SkinHistoryEntry, SkinVariant } from '@shared/types'

const KEY = 'wcl.skin.profile'

interface StoredState {
  variant: SkinVariant
  dataUrl: string
  capeActive: boolean
  history: SkinHistoryEntry[]
}

let defaultSkinUrl = ''

function defaultSkin(): string {
  if (!defaultSkinUrl) defaultSkinUrl = createFallbackSkin().toDataURL('image/png')
  return defaultSkinUrl
}

function readState(): StoredState {
  const base: StoredState = { variant: 'classic', dataUrl: '', capeActive: true, history: [] }
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return base
    const stored = JSON.parse(raw) as Partial<StoredState>
    return {
      variant: stored.variant === 'slim' ? 'slim' : 'classic',
      dataUrl: typeof stored.dataUrl === 'string' ? stored.dataUrl : '',
      capeActive: stored.capeActive !== false,
      history: Array.isArray(stored.history) ? stored.history : []
    }
  } catch {
    return base
  }
}

function writeState(state: StoredState): StoredState {
  localStorage.setItem(KEY, JSON.stringify(state))
  return state
}

function capes(state: StoredState): CapeInfo[] {
  return [
    {
      id: 'wcl-default',
      alias: 'WCL 默认披风',
      active: state.capeActive,
      url: '',
      dataUrl: capeTextureUrl()
    }
  ]
}

function profile(state: StoredState): ProfileSkins {
  return {
    username: 'WCL 模拟账号',
    skins: [{ variant: state.variant, url: '', dataUrl: state.dataUrl || defaultSkin(), state: 'ACTIVE' }],
    capes: capes(state)
  }
}

function resolveDataUrl(source: string): string {
  return typeof source === 'string' && source.startsWith('data:') ? source : defaultSkin()
}

function pushHistory(state: StoredState, dataUrl: string, variant: SkinVariant, name?: string): void {
  const id = `skin-${Date.now()}`
  state.history = [{ id, variant, time: Date.now(), name: name || `皮肤 ${state.history.length + 1}`, dataUrl }, ...state.history].slice(0, 24)
}

export const skinHandlers = {
  [IPC.skinProfile]: (): ProfileSkins => profile(readState()),
  [IPC.skinUpload]: (filePath: string, variant: SkinVariant): ProfileSkins => {
    const state = readState()
    state.dataUrl = resolveDataUrl(filePath)
    state.variant = variant === 'slim' ? 'slim' : 'classic'
    pushHistory(state, state.dataUrl, state.variant)
    return profile(writeState(state))
  },
  [IPC.skinOfflineApply]: (filePath: string, variant: SkinVariant): ProfileSkins => {
    const state = readState()
    state.dataUrl = resolveDataUrl(filePath)
    state.variant = variant === 'slim' ? 'slim' : 'classic'
    pushHistory(state, state.dataUrl, state.variant)
    return profile(writeState(state))
  },
  [IPC.skinOfflineApplyBytes]: (dataUrl: string, variant: SkinVariant): ProfileSkins => {
    const state = readState()
    state.dataUrl = resolveDataUrl(dataUrl)
    state.variant = variant === 'slim' ? 'slim' : 'classic'
    pushHistory(state, state.dataUrl, state.variant)
    return profile(writeState(state))
  },
  [IPC.skinUploadBytes]: (dataUrl: string, variant: SkinVariant): ProfileSkins => {
    const state = readState()
    state.dataUrl = resolveDataUrl(dataUrl)
    state.variant = variant === 'slim' ? 'slim' : 'classic'
    pushHistory(state, state.dataUrl, state.variant)
    return profile(writeState(state))
  },
  [IPC.skinOfflineReset]: (): ProfileSkins => {
    const state = readState()
    state.dataUrl = ''
    state.variant = 'classic'
    return profile(writeState(state))
  },
  [IPC.skinCape]: (capeId: string | null): ProfileSkins => {
    const state = readState()
    state.capeActive = !!capeId
    return profile(writeState(state))
  },
  [IPC.skinHistory]: (): SkinHistoryEntry[] => readState().history,
  [IPC.skinHistoryDelete]: (id: string): SkinHistoryEntry[] => {
    const state = readState()
    state.history = state.history.filter((item) => item.id !== id)
    return writeState(state).history
  },
  [IPC.skinHistoryRename]: (id: string, name: string): SkinHistoryEntry[] => {
    const state = readState()
    state.history = state.history.map((item) => (item.id === id ? { ...item, name } : item))
    return writeState(state).history
  },
  [IPC.skinUploadHistory]: (id: string): ProfileSkins => {
    const state = readState()
    const found = state.history.find((item) => item.id === id)
    if (found) {
      state.dataUrl = found.dataUrl
      state.variant = found.variant
    }
    return profile(writeState(state))
  },
  [IPC.skinAvatar]: (): string | null => {
    const state = readState()
    return state.dataUrl || defaultSkin()
  }
}
