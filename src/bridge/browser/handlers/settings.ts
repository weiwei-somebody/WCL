import { IPC } from '../../contract'
import { normalizeSkinPalettePreferences } from '@shared/skinPalettePreferences'
import {
  MAX_VERSION_CATEGORIES,
  assertAvailableCategoryName,
  normalizeVersionCategoryState,
  versionCategoryKey
} from '@shared/versionCategories'
import {
  DEFAULT_BACKGROUND,
  DEFAULT_CUSTOM_THEME,
  DEFAULT_HOME_LAYOUT,
  DEFAULT_LAUNCH_THUMBNAIL,
  DEFAULT_MS_CLIENT_ID
} from '@shared/types'
import type { Settings, VersionCategoryAction } from '@shared/types'

const KEY = 'wcl.settings'

/** 浏览器阶段用占位游戏目录，桌面阶段由后端给出真实路径 */
const BROWSER_GAME_DIR = 'C:/WCL/.minecraft'

function defaults(): Settings {
  const gameDir = BROWSER_GAME_DIR
  return {
    gameDir,
    folders: [{ path: gameDir, name: '默认文件夹', isDefault: true }],
    activeFolder: gameDir,
    javaPath: '',
    javaAuto: true,
    javaCustom: [],
    javaHidden: [],
    memoryMB: 4096,
    memoryAuto: true,
    jvmArgs: '',
    resolution: { width: 854, height: 480, mode: 'windowed', fullscreen: false },
    rememberGameWindowSize: false,
    mirror: 'bmclapi',
    downloadThreads: 32,
    downloadSpeedKBps: 0,
    defaultIsolation: true,
    reduceMotion: false,
    uiWindowAutoFit: false,
    updateMirrorUrls: [],
    msClientId: DEFAULT_MS_CLIENT_ID,
    theme: 'transparent',
    custom: structuredClone(DEFAULT_CUSTOM_THEME),
    disabledFeatures: [],
    favoriteVersions: [],
    versionCategories: [],
    versionCategoryAssignments: {},
    homeLayout: structuredClone(DEFAULT_HOME_LAYOUT),
    background: structuredClone(DEFAULT_BACKGROUND),
    launchThumbnail: structuredClone(DEFAULT_LAUNCH_THUMBNAIL),
    skinEditorPalette: normalizeSkinPalettePreferences(undefined),
    closeAfterLaunch: false,
    configVersion: 1,
    wclTheme: 'dark'
  }
}

function read(): Settings {
  const base = defaults()
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return base
    const stored = JSON.parse(raw) as Partial<Settings>
    return {
      ...base,
      ...stored,
      resolution: { ...base.resolution, ...(stored.resolution ?? {}) },
      custom: {
        colors: { ...base.custom.colors, ...(stored.custom?.colors ?? {}) },
        layout: { ...base.custom.layout, ...(stored.custom?.layout ?? {}) }
      }
    }
  } catch {
    return base
  }
}

function write(value: Settings): Settings {
  localStorage.setItem(KEY, JSON.stringify(value))
  return value
}

function newCategoryId(): string {
  return `cat-${Math.random().toString(36).slice(2, 10)}`
}

/** 浏览器阶段用文件选择器代替系统对话框：图片读取为 dataURL，其余返回文件名 */
function pickFile(accept: string, asDataUrl: boolean): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.onchange = () => {
      const file = input.files?.[0]
      if (!file) {
        resolve(null)
        return
      }
      if (!asDataUrl) {
        resolve(file.name)
        return
      }
      const reader = new FileReader()
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null)
      reader.onerror = () => resolve(null)
      reader.readAsDataURL(file)
    }
    input.click()
  })
}

export const settingsHandlers = {
  [IPC.settingsGet]: () => read(),
  [IPC.settingsSet]: (patch: Partial<Settings>) => write({ ...read(), ...patch }),
  [IPC.appSelectDir]: async (): Promise<string | null> => {
    const picker = (window as unknown as { showDirectoryPicker?: () => Promise<{ name: string }> }).showDirectoryPicker
    if (!picker) return null
    try {
      const handle = await picker()
      return handle ? `${BROWSER_GAME_DIR}/${handle.name}` : null
    } catch {
      return null
    }
  },
  [IPC.appSelectFile]: () => pickFile('.mrpack,.zip,.jar', false),
  [IPC.appSelectImage]: () => pickFile('image/png,image/jpeg,image/webp', true),
  [IPC.versionCategoriesUpdate]: (action: VersionCategoryAction) => {
    const current = read()
    const state = normalizeVersionCategoryState(current)
    let categories = state.versionCategories
    let assignments = state.versionCategoryAssignments
    if (action.type === 'create') {
      if (categories.length >= MAX_VERSION_CATEGORIES) throw new Error('分类数量已达上限')
      categories = [...categories, { id: newCategoryId(), name: assertAvailableCategoryName(categories, action.name) }]
    } else if (action.type === 'rename') {
      if (!categories.some((row) => row.id === action.id)) throw new Error('分类不存在')
      const name = assertAvailableCategoryName(categories, action.name, action.id)
      categories = categories.map((row) => (row.id === action.id ? { ...row, name } : row))
    } else if (action.type === 'remove') {
      categories = categories.filter((row) => row.id !== action.id)
      assignments = Object.fromEntries(Object.entries(assignments).filter(([, value]) => value !== action.id))
    } else if (action.type === 'assign') {
      const key = versionCategoryKey(action.target.folder, action.target.id, 'web')
      if (action.categoryId) assignments = { ...assignments, [key]: action.categoryId }
      else {
        const next = { ...assignments }
        delete next[key]
        assignments = next
      }
    }
    return write({ ...current, versionCategories: categories, versionCategoryAssignments: assignments })
  },
  [IPC.appSystemInfo]: () => {
    const memoryGB = (navigator as unknown as { deviceMemory?: number }).deviceMemory ?? 8
    return { platform: 'web', totalMemMB: memoryGB * 1024, freeMemMB: Math.round(memoryGB * 512) }
  },
  [IPC.appearanceResetTheme]: () => write({ ...read(), theme: 'transparent' }),
  [IPC.appearanceResetBackground]: () => {
    const current = read()
    const background = structuredClone(DEFAULT_BACKGROUND)
    return write({ ...current, background })
  },
  [IPC.appearanceResetLaunchThumbnail]: () => {
    const current = read()
    const launchThumbnail = structuredClone(DEFAULT_LAUNCH_THUMBNAIL)
    return write({ ...current, launchThumbnail })
  }
}
