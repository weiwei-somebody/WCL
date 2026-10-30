/**
 * 每条 channel 在当前运行环境能达到的真实程度，以及缺失实现时的兜底返回。
 */
import { IPC, IPC_EVENT } from './contract'
import type { Capability } from './contract'

/** 走真实公开 HTTP API */
const REAL = new Set<string>([
  IPC.versionsManifest,
  IPC.versionsCatalog,
  IPC.communitySearch,
  IPC.communityProject,
  IPC.communityFiles,
  IPC.communityDownload,
  IPC.loadersList,
  IPC.fabricApiList
])

/** 用 Web API 近似实现 */
const APPROX = new Set<string>([
  IPC.serversPing,
  IPC.serversList,
  IPC.serversAdd,
  IPC.serversEdit,
  IPC.serversFavorite,
  IPC.serversRemove,
  IPC.serversBind,
  IPC.serversSyncFromDat,
  IPC.serversPrepareLaunch,
  IPC.foldersList,
  IPC.foldersAdd,
  IPC.foldersRemove,
  IPC.foldersRename,
  IPC.foldersSetDefault,
  IPC.foldersSetDownload,
  IPC.foldersSetActive,
  IPC.foldersScan,
  IPC.foldersOpen,
  IPC.foldersContextMenu,
  IPC.appOpenDir,
  IPC.fsList,
  IPC.fsPath,
  IPC.fsRemove,
  IPC.fsToggleDisable,
  IPC.fsImportResources,
  IPC.skinAvatar,
  IPC.skinProfile,
  IPC.skinUpload,
  IPC.skinOfflineApply,
  IPC.skinOfflineReset,
  IPC.skinCape,
  IPC.skinHistory,
  IPC.skinHistoryDelete,
  IPC.skinHistoryRename,
  IPC.skinUploadHistory,
  IPC.appSelectDir,
  IPC.appSelectFile,
  IPC.appSelectImage,
  IPC.appearanceImportBackground,
  IPC.appearanceImportBackgroundMulti,
  IPC.appearanceImportLaunchThumbnail,
  IPC.appearanceImportTheme,
  IPC.appearanceExportTheme,
  IPC.centerOverview,
  IPC.centerWorlds,
  IPC.centerScreenshots,
  IPC.centerBackups,
  IPC.centerOperation,
  IPC.centerDiagnose,
  IPC.centerFile
])

/** 只有桌面端能真正执行的通道前缀 */
const DESKTOP_PREFIXES = ['java:', 'game:', 'gameDir:', 'launch:', 'update:', 'plugins:', 'voxlink:', 'tc:', 'frp:', 'direct:']

/** 这些通道的兜底值应为空数组，其余为 null */
const LIST_CHANNELS = new Set<string>([
  IPC.accountsList,
  IPC.versionsInstalled,
  IPC.versionsManifest,
  IPC.foldersList,
  IPC.serversList,
  IPC.javaList,
  IPC.pluginsList,
  IPC.updateListReleases,
  IPC.skinHistory,
  IPC.skinHistoryDelete,
  IPC.skinHistoryRename,
  IPC.exitHistoryList,
  IPC.fsList,
  IPC.fsRemove,
  IPC.fsToggleDisable,
  IPC.modsTargets,
  IPC.modsDuplicates,
  IPC.modsCrossDuplicates,
  IPC.modsParse,
  IPC.voxlinkLobby,
  IPC.centerWorlds,
  IPC.centerScreenshots,
  IPC.centerBackups
])

export function capabilityOf(channel: string): Capability {
  if (REAL.has(channel)) return 'real'
  if (APPROX.has(channel)) return 'approx'
  for (const prefix of DESKTOP_PREFIXES) {
    if (channel.startsWith(prefix)) return 'desktop'
  }
  return 'mock'
}

export function emptyFallback(channel: string): unknown {
  return LIST_CHANNELS.has(channel) ? [] : null
}

export function allChannels(): string[] {
  return Object.values(IPC)
}

export function allEvents(): string[] {
  return Object.values(IPC_EVENT)
}

export function channelsOf(capability: Capability): string[] {
  return allChannels().filter((channel) => capabilityOf(channel) === capability)
}
