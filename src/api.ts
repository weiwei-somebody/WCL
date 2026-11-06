/**
 * 视图层统一后端入口。channel 取值与参考实现一致，
 * 浏览器模式与桌面模式共用同一份调用面，视图代码不感知运行环境。
 */
import { bridge } from './bridge'
import { IPC, IPC_EVENT } from '@shared/types'
import type {
  Account,
  CommunityFile,
  CommunityKind,
  CommunityModProject,
  CommunityQuery,
  CommunitySearchPage,
  CommunitySource,
  DefaultResourcePack,
  FabricApiVersion,
  FolderScanResult,
  FsEntry,
  GameFolder,
  GameResolution,
  ImageFit,
  ImportProbeResult,
  InstallOptions,
  InstalledVersion,
  InstanceMigrationResult,
  IsolationMigrationPlan,
  JavaInfo,
  LaunchState,
  LoaderName,
  ModCrossDuplicate,
  ModDuplicateGroup,
  ModInfo,
  ModInstallPlan,
  ModInstallResult,
  ModpackExportOptions,
  ModpackInfo,
  ModpackInstallRequest,
  MsDeviceCodeInfo,
  ProgressEvent,
  ProfileSkins,
  RemoteVersion,
  ServerEntry,
  ServerLaunchPreparation,
  ServerPingResult,
  ServerSyncResult,
  Settings,
  SkinHistoryEntry,
  SkinVariant,
  SystemInfo,
  VersionCategoryAction,
  WorldImportInfo,
  WorldImportOptions,
  WorldImportResult,
  YggdrasilLoginResult,
  YggdrasilProvider,
  YggdrasilProviderCandidate,
  YggdrasilProviderInput,
  YggdrasilRuntimeInfo
} from '@shared/types'

function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const clean = args.map((item) => {
    if (item === undefined || item === null) return item
    try {
      return JSON.parse(JSON.stringify(item)) as unknown
    } catch {
      return item
    }
  })
  return bridge.invoke<T>(channel, ...clean)
}

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  return bridge.on(channel, (payload) => cb(payload as T))
}

// ---------------- 设置 ----------------
export const getSettings = () => invoke<Settings>(IPC.settingsGet)
export const saveSettings = (patch: Partial<Settings>) => invoke<Settings>(IPC.settingsSet, patch)
export const getSystemInfo = () => invoke<SystemInfo>(IPC.appSystemInfo)
export const selectDir = () => invoke<string | null>(IPC.appSelectDir)
export const selectFile = () => invoke<string | null>(IPC.appSelectFile)
export const selectImage = () => invoke<string | null>(IPC.appSelectImage)
export const importBackground = () => invoke<Settings | null>(IPC.appearanceImportBackground)
export const importBackgroundMulti = () => invoke<Settings | null>(IPC.appearanceImportBackgroundMulti)
export const resetBackground = () => invoke<Settings>(IPC.appearanceResetBackground)
export const importLaunchThumbnail = () => invoke<Settings | null>(IPC.appearanceImportLaunchThumbnail)
export const resetLaunchThumbnail = () => invoke<Settings>(IPC.appearanceResetLaunchThumbnail)
export const migrateGameDir = (newDir: string, migrate: boolean) =>
  invoke<void>(IPC.gameDirMigrate, newDir, migrate)
export const onGameDirDone = (cb: (r: { ok: boolean; error?: string; gameDir?: string }) => void) =>
  subscribe<{ ok: boolean; error?: string; gameDir?: string }>(IPC_EVENT.gameDirDone, cb)

// ---------------- 账号 ----------------
export const listAccounts = () => invoke<Account[]>(IPC.accountsList)
export const addOfflineAccount = (username: string) => invoke<Account>(IPC.accountsAddOffline, username)
export const removeAccount = (id: string) => invoke<Account[]>(IPC.accountsRemove, id)
export const selectAccount = (id: string) => invoke<Account | null>(IPC.accountsSelect, id)
export const getSelectedAccount = () => invoke<Account | null>(IPC.accountsSelected)
export const msBeginLogin = () => invoke<MsDeviceCodeInfo>(IPC.accountsMsBegin)
export const msCancelLogin = () => invoke<void>(IPC.accountsMsCancel)
export const listYggdrasilProviders = () => invoke<YggdrasilProvider[]>(IPC.accountsYggProviders)
export const probeYggdrasilProvider = (input: YggdrasilProviderInput, allowInsecure = false) =>
  invoke<YggdrasilProviderCandidate>(IPC.accountsYggProbe, input, allowInsecure)
export const saveYggdrasilProvider = (candidate: YggdrasilProviderCandidate, allowInsecure = false) =>
  invoke<YggdrasilProvider[]>(IPC.accountsYggSaveProvider, candidate, allowInsecure)
export const removeYggdrasilProvider = (id: string) =>
  invoke<YggdrasilProvider[]>(IPC.accountsYggRemoveProvider, id)
export const loginYggdrasil = (providerId: string, identifier: string, password: string) =>
  invoke<YggdrasilLoginResult>(IPC.accountsYggLogin, providerId, identifier, password)
export const selectYggdrasilProfile = (challengeId: string, profileId: string) =>
  invoke<Account>(IPC.accountsYggSelectProfile, challengeId, profileId)
export const prepareYggdrasilRuntime = () => invoke<YggdrasilRuntimeInfo>(IPC.accountsYggRuntime)
export const refreshAccount = (id: string) => invoke<Account>(IPC.accountsRefresh, id)

// ---------------- 版本 ----------------
export const getVersionCatalog = (refresh = false) =>
  invoke<{ versions: RemoteVersion[]; checkedAt: number; stale: boolean }>(IPC.versionsCatalog, refresh)
export const getManifest = (refresh = false) => invoke<RemoteVersion[]>(IPC.versionsManifest, refresh)
export const getInstalled = (all = false) => invoke<InstalledVersion[]>(IPC.versionsInstalled, all)
export const updateVersionCategories = (action: VersionCategoryAction) =>
  invoke<Settings>(IPC.versionCategoriesUpdate, action)
export const installVersion = (id: string, opts?: InstallOptions, folder?: string) =>
  invoke<void>(IPC.versionsInstall, id, opts, folder)
export const removeVersion = (id: string, folder?: string) =>
  invoke<void>(IPC.versionsRemove, id, folder)
export const renameVersion = (id: string, newName: string, folder?: string) =>
  invoke<void>(IPC.versionsRename, id, newName, folder)
export const setVersionJava = (id: string, javaPath: string, automatic = false, folder?: string) =>
  invoke<void>(IPC.versionsSetJava, id, javaPath, automatic, folder)
export const setVersionResolution = (id: string, resolution: GameResolution | null, folder?: string) =>
  invoke<void>(IPC.versionsSetResolution, id, resolution, folder)
export const cleanupPartialInstall = (id: string, folder?: string) =>
  invoke<boolean>(IPC.versionsCleanup, id, folder)

// ---------------- 游戏文件夹管理 ----------------
export const listFolders = () => invoke<{ folders: GameFolder[]; active: string }>(IPC.foldersList)
export const addFolder = (path: string) =>
  invoke<{ folders: GameFolder[]; folder: GameFolder; structure: FolderScanResult['structure'] }>(
    IPC.foldersAdd,
    path
  )
export const removeFolder = (path: string) => invoke<GameFolder[]>(IPC.foldersRemove, path)
export const renameFolder = (path: string, displayName: string) =>
  invoke<GameFolder[]>(IPC.foldersRename, path, displayName)
export const setDefaultFolder = (path: string) => invoke<GameFolder[]>(IPC.foldersSetDefault, path)
export const setDownloadFolder = (path: string) => invoke<GameFolder[]>(IPC.foldersSetDownload, path)
export const setActiveFolder = (path: string) => invoke<string>(IPC.foldersSetActive, path)
export const scanFolder = (path: string) => invoke<FolderScanResult>(IPC.foldersScan, path)
export const openGameFolder = (path: string) => invoke<void>(IPC.foldersOpen, path)
export const showFolderContextMenu = (folder: string, versionId?: string) =>
  invoke<void>(IPC.foldersContextMenu, folder, versionId)
export const setVersionIsolation = (id: string, isolated: boolean, folder?: string) =>
  invoke<void>(IPC.versionsSetIsolation, id, isolated, folder)
export const getIsolationPlan = (id: string, folder?: string) =>
  invoke<IsolationMigrationPlan>(IPC.versionsIsolationPlan, id, folder)
export const setVersionIcon = (id: string, icon: string, folder?: string) =>
  invoke<void>(IPC.versionsSetIcon, id, icon, folder)
export const uploadVersionIcon = (id: string, folder?: string) =>
  invoke<string | null>(IPC.versionsUploadIcon, id, folder)
export const uploadVersionThumbnail = (id: string, folder?: string) =>
  invoke<string | null>(IPC.versionsUploadThumbnail, id, folder)
export const setVersionThumbnailFit = (id: string, fit: ImageFit, folder?: string) =>
  invoke<void>(IPC.versionsSetThumbnailFit, id, fit, folder)
export const resetVersionThumbnail = (id: string, folder?: string) =>
  invoke<void>(IPC.versionsResetThumbnail, id, folder)
export const listLoaders = (loader: LoaderName, mc: string) => invoke<string[]>(IPC.loadersList, loader, mc)
export const listFabricApi = (mc: string) => invoke<FabricApiVersion[]>(IPC.fabricApiList, mc)

// ---------------- 整合包 ----------------
export const probeModpack = (filePath: string) => invoke<ModpackInfo>(IPC.modpackProbe, filePath)
export const probeImport = (inputPath: string) => invoke<ImportProbeResult>(IPC.importProbe, inputPath)
export const supplyModpackFiles = (token: string) =>
  invoke<{ accepted: number; remaining: number; rejected: string[] }>(IPC.modpackSupplyFiles, token)
export const openModpackFile = (token: string, fileID: number) =>
  invoke<void>(IPC.modpackOpenFile, token, fileID)
export const installModpack = (filePath: string, opts?: ModpackInstallRequest) =>
  invoke<void>(IPC.modpackInstall, filePath, opts)
export const exportModpack = (options: ModpackExportOptions) =>
  invoke<string>(IPC.modpackExport, options)

// ---------------- 世界存档 ----------------
export const probeWorld = (inputPath: string) => invoke<WorldImportInfo | null>(IPC.worldProbe, inputPath)
export const importWorld = (inputPath: string, options: WorldImportOptions) =>
  invoke<WorldImportResult>(IPC.worldImport, inputPath, options)

// ---------------- 社区资源 ----------------
export const communitySearch = (q: CommunityQuery) =>
  invoke<CommunitySearchPage>(IPC.communitySearch, q)
export const communityProject = (source: CommunitySource, projectId: string, kind: CommunityKind = 'mod') =>
  invoke<CommunityModProject>(IPC.communityProject, source, projectId, kind)
export const communityFiles = (
  source: CommunitySource,
  projectId: string,
  filter?: { mcVersion?: string; loader?: LoaderName | ''; kind?: CommunityKind }
) => invoke<CommunityFile[]>(IPC.communityFiles, source, projectId, filter)
export const communityDownload = (
  file: CommunityFile,
  target: { versionId: string; kind: CommunityKind; folder?: string },
  operationId?: string
) => invoke<string>(IPC.communityDownload, file, target, operationId)

// ---------------- 实例资源迁移 ----------------
export const migrateInstance = (sourceId: string, targetId: string) =>
  invoke<InstanceMigrationResult>(IPC.instanceMigrate, sourceId, targetId)
export const onInstanceMigrateProgress = (cb: (r: { done: number; total: number; text: string }) => void) =>
  subscribe<{ done: number; total: number; text: string }>(IPC_EVENT.instanceMigrateProgress, cb)

// ---------------- Java ----------------
export const listJava = () => invoke<JavaInfo[]>(IPC.javaList)
export const refreshJava = (refresh = true) => invoke<JavaInfo[]>(IPC.javaRefresh, refresh)
export const cancelJavaScan = () => invoke<boolean>(IPC.javaCancelScan)
export const addCustomJava = (path: string) => invoke<void>(IPC.javaAddCustom, path)
export const pickAddJava = () => invoke<JavaInfo[] | null>(IPC.javaPickAdd)
export const hideJava = (path: string) => invoke<void>(IPC.javaHide, path)

// ---------------- 皮肤/披风 ----------------
export const getSkinProfile = (refresh = false, accountId?: string) =>
  invoke<ProfileSkins>(IPC.skinProfile, refresh, accountId)
export const uploadSkin = (filePath: string, variant: SkinVariant) =>
  invoke<ProfileSkins>(IPC.skinUpload, filePath, variant)
export const applyOfflineSkin = (filePath: string, variant: SkinVariant, accountId: string) =>
  invoke<ProfileSkins>(IPC.skinOfflineApply, filePath, variant, accountId)
export const applyOfflineSkinBytes = (dataUrl: string, variant: SkinVariant, accountId: string) =>
  invoke<ProfileSkins>(IPC.skinOfflineApplyBytes, dataUrl, variant, accountId)
export const uploadSkinBytes = (dataUrl: string, variant: SkinVariant, accountId?: string) =>
  invoke<ProfileSkins>(IPC.skinUploadBytes, dataUrl, variant, accountId)
export const resetOfflineSkin = (accountId: string) =>
  invoke<ProfileSkins>(IPC.skinOfflineReset, accountId)
export const changeCape = (capeId: string | null) => invoke<ProfileSkins>(IPC.skinCape, capeId)
export const getSkinHistory = (accountId?: string) =>
  invoke<SkinHistoryEntry[]>(IPC.skinHistory, accountId)
export const deleteSkinHistory = (id: string, accountId?: string) =>
  invoke<SkinHistoryEntry[]>(IPC.skinHistoryDelete, id, accountId)
export const renameSkinHistory = (id: string, name: string, accountId?: string) =>
  invoke<SkinHistoryEntry[]>(IPC.skinHistoryRename, id, name, accountId)
export const uploadSkinFromHistory = (id: string, accountId?: string) =>
  invoke<ProfileSkins>(IPC.skinUploadHistory, id, accountId)
export const getSkinAvatar = (accountId?: string) => invoke<string | null>(IPC.skinAvatar, accountId)

// ---------------- 直连联机 ----------------
export const getDirectOverview = () =>
  invoke<import('@shared/directConnect').DirectOverview>(IPC.directOverview)
export const getDirectState = () => invoke<import('@shared/directConnect').DirectHostState>(IPC.directState)
export const startDirectHost = (request: import('@shared/directConnect').DirectHostRequest) =>
  invoke<import('@shared/directConnect').DirectHostState>(IPC.directHost, request)
export const stopDirectHost = () => invoke<import('@shared/directConnect').DirectHostState>(IPC.directStop)
export const resolveDirectInvitation = (text: string) =>
  invoke<import('@shared/directConnect').DirectJoinResult>(IPC.directResolve, text)
export const prepareDirectJoin = (text: string, versionId: string, folder: string) =>
  invoke<{ versionId: string; folder: string; address: string; directJoin: boolean }>(
    IPC.directPrepareJoin,
    text,
    versionId,
    folder
  )

// ---------------- 游戏 ----------------
export const launchGame = (
  id: string,
  serverAddress?: string,
  folder?: string,
  createCommandWorld = false
) => invoke<void>(IPC.gameLaunch, id, serverAddress, folder, createCommandWorld)
export const restartGame = (id: string, folder: string, forceToken?: string) =>
  invoke<{ requiresForce: boolean; forceToken?: string }>(IPC.gameRestart, id, folder, forceToken)
export const cancelGameRestart = () => invoke<void>(IPC.gameRestartCancel)
export const killGame = (forceToken?: string) =>
  invoke<{ requiresForce: boolean; forceToken?: string }>(IPC.gameKill, forceToken)

// ---------------- 服务器 ----------------
export const favoriteServer = (id: string, favorite: boolean) =>
  invoke<ServerEntry[]>(IPC.serversFavorite, id, favorite)
export const listServers = () => invoke<ServerEntry[]>(IPC.serversList)
export const addServer = (name: string, address: string) =>
  invoke<ServerEntry[]>(IPC.serversAdd, name, address)
export const removeServer = (id: string) => invoke<ServerEntry[]>(IPC.serversRemove, id)
export const editServer = (id: string, name: string, address: string) =>
  invoke<ServerEntry[]>(IPC.serversEdit, id, name, address)
export const pingServer = (address: string) => invoke<ServerPingResult>(IPC.serversPing, address)
export const bindServer = (id: string, versionId: string, folder?: string) =>
  invoke<ServerEntry[]>(IPC.serversBind, id, versionId, folder)
export const syncServersFromDat = (versionId?: string, folder?: string) =>
  invoke<ServerSyncResult>(IPC.serversSyncFromDat, versionId, folder)
export const prepareServerLaunch = (id: string, versionId?: string, folder?: string) =>
  invoke<ServerLaunchPreparation>(IPC.serversPrepareLaunch, id, versionId, folder)

// ---------------- MOD 拖入即装 ----------------
export const getModTargets = () =>
  invoke<{ versions: InstalledVersion[]; errors: string[] }>(IPC.modsTargets)
export const prepareModInstall = (
  target: { id: string; folder: string },
  input: { paths?: string[]; file?: CommunityFile },
  operationId?: string
) => invoke<ModInstallPlan>(IPC.modsPrepare, target, input, operationId)
export const commitModInstall = (id: string, includeDependencies: boolean, operationId?: string) =>
  invoke<string>(IPC.modsCommit, id, includeDependencies, operationId)
export const discardModInstall = (id: string) => invoke<void>(IPC.modsDiscard, id)
export const parseMods = (paths: string[]) => invoke<ModInfo[]>(IPC.modsParse, paths)
export const installMods = (files: string[], targetVersionId: string, folder?: string) =>
  invoke<ModInstallResult[]>(IPC.modsInstall, files, targetVersionId, folder)
export const findModDuplicates = (versionId: string, folder?: string) =>
  invoke<ModDuplicateGroup[]>(IPC.modsDuplicates, versionId, folder)
export const getModIcons = (versionId: string, names: string[], folder?: string, kind = 'mods') =>
  invoke<Record<string, string>>(IPC.modsIcons, versionId, names, folder, kind)
export const checkModUpdates = (versionId: string, folder?: string) =>
  invoke<import('@shared/types').ModUpdateReport>(IPC.modsCheckUpdates, versionId, folder)
export const applyModUpdates = (
  versionId: string,
  items: import('@shared/types').ModUpdateTarget[],
  folder?: string
) => invoke<Array<{ fileName: string; ok: boolean; error?: string }>>(IPC.modsApplyUpdates, versionId, items, folder)

// ---------------- 插件系统 ----------------
export const listPlugins = () => invoke<import('@shared/types').PluginInfo[]>(IPC.pluginsList)
export const installPlugin = () => invoke<import('@shared/types').PluginInfo[]>(IPC.pluginsInstall)
export const setPluginEnabled = (id: string, enabled: boolean) =>
  invoke<import('@shared/types').PluginInfo[]>(IPC.pluginsSetEnabled, id, enabled)
export const removePlugin = (id: string) =>
  invoke<import('@shared/types').PluginInfo[]>(IPC.pluginsRemove, id)
export const readPluginCode = (id: string) => invoke<string>(IPC.pluginsReadCode, id)
export const openPluginsDir = () => invoke<void>(IPC.pluginsOpenDir)

// ---------------- 默认按键与默认资源包 ----------------
export const getDefaultKeys = () => invoke<Record<string, string>>(IPC.keysGetDefault)
export const getDefaultGameOptions = () =>
  invoke<import('@shared/gameOptions').DefaultGameOptions>(IPC.gameOptionsGet)
export const setDefaultGameOptions = (change: {
  enabled?: boolean
  id?: string
  value?: import('@shared/gameOptions').GameOptionValue | null
}) => invoke<import('@shared/gameOptions').DefaultGameOptions>(IPC.gameOptionsSet, change)
export const setDefaultKey = (id: string, bind: string) =>
  invoke<Record<string, string>>(IPC.keysSetDefault, id, bind)
export const resetDefaultKeys = () => invoke<Record<string, string>>(IPC.keysReset)
export const getDefaultResourcePacks = () => invoke<DefaultResourcePack[]>(IPC.defaultPacksGet)
export const importDefaultResourcePacks = (files: string[]) =>
  invoke<DefaultResourcePack[]>(IPC.defaultPacksImport, files)
export const pickDefaultResourcePacks = () => invoke<DefaultResourcePack[]>(IPC.defaultPacksPick)
export const removeDefaultResourcePack = (id: string) =>
  invoke<DefaultResourcePack[]>(IPC.defaultPacksRemove, id)
export const moveDefaultResourcePack = (id: string, direction: number) =>
  invoke<DefaultResourcePack[]>(IPC.defaultPacksMove, id, direction)
export const setDefaultResourcePackEnabled = (id: string, enabled: boolean) =>
  invoke<DefaultResourcePack[]>(IPC.defaultPacksSetEnabled, id, enabled)
export const reapplyDefaultResourcePacks = (folder: string, id: string) =>
  invoke<{ count: number; shared: boolean }>(IPC.defaultPacksApply, folder, id)

// ---------------- 启动器自更新 ----------------
export const checkUpdate = (force = false) =>
  invoke<import('@shared/types').UpdateCheckResult>(IPC.updateCheck, force)
export const skipUpdateVersion = (version: string) => invoke<void>(IPC.updateSkip, version)
export const startUpdateDownload = (
  release: import('@shared/types').ReleaseInfo,
  mode: 'upgrade' | 'rollback' = 'upgrade'
) => invoke<{ taskId: string }>(IPC.updateStart, release, mode)
export const applyUpdate = (release: import('@shared/types').ReleaseInfo) =>
  invoke<void>(IPC.updateApply, release)
export const listUpdateReleases = () => invoke<import('@shared/types').ReleaseInfo[]>(IPC.updateListReleases)
export const getUpdateState = () =>
  invoke<import('@shared/types').UpdateStateInfo | null>(IPC.updateGetState)
export const restoreUpdateBackup = () => invoke<void>(IPC.updateRestoreBackup)
export const pickLocalUpdateFile = () =>
  invoke<import('@shared/types').LocalUpdateCheck | null>(IPC.updatePickLocalFile)
export const applyLocalUpdate = (check: import('@shared/types').LocalUpdateCheck) =>
  invoke<void>(IPC.updateApplyLocal, check)
export const getConfigStatus = () =>
  invoke<{ configVersion: number; current: number; mismatch: 'newer' | null }>(IPC.updateGetConfigStatus)
export const resetSettingsToDefaults = () => invoke<void>(IPC.updateResetSettings)
export const getPendingUpdate = () =>
  invoke<{ release: import('@shared/types').ReleaseInfo; file: string } | null>(IPC.updateGetPending)
export const applyPendingUpdate = () => invoke<void>(IPC.updateApplyPending)
export const onUpdatePrompt = (
  cb: (r: import('@shared/types').ReleaseInfo & { rollbackNotice?: boolean }) => void
) => subscribe<import('@shared/types').ReleaseInfo & { rollbackNotice?: boolean }>(IPC_EVENT.updatePrompt, cb)
export const onUpdateSlowHint = (cb: (r: { taskId: string }) => void) =>
  subscribe<{ taskId: string }>(IPC_EVENT.updateSlowHint, cb)
export const onUpdateReady = (cb: (r: { version: string }) => void) =>
  subscribe<{ version: string }>(IPC_EVENT.updateReady, cb)
export const checkLatestJson = () =>
  invoke<import('@shared/types').LatestUpdateInfo | null>(IPC.latestCheck)
export const installLatestUpdate = (info: import('@shared/types').LatestUpdateInfo) =>
  invoke<void>(IPC.latestInstall, info)
export const onLatestAvailable = (cb: (r: import('@shared/types').LatestUpdateInfo) => void) =>
  subscribe<import('@shared/types').LatestUpdateInfo>(IPC_EVENT.latestAvailable, cb)
export const onLatestProgress = (cb: (r: { version: string; percent: number }) => void) =>
  subscribe<{ version: string; percent: number }>(IPC_EVENT.latestProgress, cb)

// ---------------- 桥接 MOD 实时配置面板 ----------------
export const bridgeStatus = (versionId: string) =>
  invoke<import('@shared/types').BridgeStatus>(IPC.bridgeStatus, versionId)
export const bridgeManifest = (versionId: string) =>
  invoke<{ protocol: number; params: import('@shared/types').BridgeParam[] }>(
    IPC.bridgeManifest,
    versionId
  )
export const bridgeSet = (versionId: string, id: string, value: unknown) =>
  invoke<{ ok: boolean; value?: unknown; notice?: string; error?: string }>(
    IPC.bridgeSet,
    versionId,
    id,
    value
  )
export const bridgeReset = (versionId: string, id?: string) =>
  invoke<{ ok: boolean; error?: string }>(IPC.bridgeReset, versionId, id)
export const bridgeInstalled = (versionId: string) => invoke<boolean>(IPC.bridgeInstalled, versionId)
export const bridgeInstall = (versionId: string) =>
  invoke<{ ok: boolean; already?: boolean; error?: string }>(IPC.bridgeInstall, versionId)
export const findModCrossDuplicates = (versionIds: string[], folder?: string) =>
  invoke<ModCrossDuplicate[]>(IPC.modsCrossDuplicates, versionIds, folder)

// ---------------- 实例中心 ----------------
export const centerOverview = (versionId: string, folder?: string) =>
  invoke<import('@shared/instanceCenter').InstanceOverview>(IPC.centerOverview, versionId, folder)
export const centerWorlds = (versionId: string, folder?: string) =>
  invoke<import('@shared/instanceCenter').InstanceWorld[]>(IPC.centerWorlds, versionId, folder)
export const centerScreenshots = async (versionId: string, folder?: string, page = 0) => {
  const result = await invoke<
    import('@shared/instanceCenter').InstanceScreenshot[] | { total: number; items: import('@shared/instanceCenter').InstanceScreenshot[] }
  >(IPC.centerScreenshots, versionId, folder, page)
  return Array.isArray(result) ? result : result.items
}
export const centerBackups = (versionId: string, folder?: string) =>
  invoke<import('@shared/instanceCenter').BackupManifest[]>(IPC.centerBackups, versionId, folder)
export const centerOperation = (
  versionId: string,
  folder: string,
  action: import('@shared/instanceCenter').InstanceOperation
) => invoke<{ ok: boolean; error?: string }>(IPC.centerOperation, versionId, folder, action)
export const centerDiagnose = (versionId: string, folder?: string) =>
  invoke<import('@shared/instanceCenter').DiagnosticFinding[]>(IPC.centerDiagnose, versionId, folder)
export const centerFile = (
  target: import('@shared/instanceCenter').InstanceTarget,
  kind: string,
  rel: string
) => invoke<void>(IPC.centerFile, target, kind, rel)

// ---------------- 文件/目录 ----------------
export const openDir = (rel = '', folder?: string) => invoke<void>(IPC.appOpenDir, rel, folder)
export const listFs = (rel: string, folder?: string) => invoke<FsEntry[]>(IPC.fsList, rel, folder)
export const fsPath = (rel: string, folder?: string) => invoke<string>(IPC.fsPath, rel, folder)
export const removeFs = (rel: string, name: string, folder?: string) =>
  invoke<FsEntry[]>(IPC.fsRemove, rel, name, folder)
export const toggleDisableFs = (rel: string, name: string, folder?: string) =>
  invoke<FsEntry[]>(IPC.fsToggleDisable, rel, name, folder)
export const importResources = (files: string[], id: string, folder: string, kind: string) =>
  invoke<number>(IPC.fsImportResources, files, id, folder, kind)

// ---------------- 事件订阅 ----------------
export const onProgress = (cb: (e: ProgressEvent) => void) => subscribe<ProgressEvent>(IPC_EVENT.progress, cb)
export const onLaunchLog = (cb: (line: string) => void) => subscribe<string>(IPC_EVENT.launchLog, cb)
export const onLaunchState = (cb: (s: LaunchState) => void) => subscribe<LaunchState>(IPC_EVENT.launchState, cb)
export const onMsLoginDone = (cb: (result: { account: Account | null; error?: string | null }) => void) =>
  subscribe<{ account: Account | null; error?: string | null }>(IPC_EVENT.msLoginDone, cb)
export const onInstallDone = (
  cb: (r: {
    versionId: string
    installedId?: string
    ok: boolean
    error?: string
    taskId?: string
    cancelled?: boolean
    stage?: string
  }) => void
) =>
  subscribe<{
    versionId: string
    installedId?: string
    ok: boolean
    error?: string
    taskId?: string
    cancelled?: boolean
    stage?: string
  }>(IPC_EVENT.installDone, cb)
export const onTaskDone = (
  cb: (r: { taskId: string; ok: boolean; error?: string; cancelled?: boolean; stage?: string }) => void
) =>
  subscribe<{ taskId: string; ok: boolean; error?: string; cancelled?: boolean; stage?: string }>(
    IPC_EVENT.taskDone,
    cb
  )

export const cancelTask = (taskId: string) => invoke<boolean>(IPC.tasksCancel, taskId)
export const pauseTask = (taskId: string) => invoke<boolean>(IPC.tasksPause, taskId)
export const resumeTask = (taskId: string) => invoke<boolean>(IPC.tasksResume, taskId)
export const exportLaunchLogs = (versionId: string, folder?: string) =>
  invoke<string | null>(IPC.launchExportLogs, versionId, folder)

// ---------------- 工具 ----------------
export function errText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  return msg.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, '') || '未知错误'
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const area = document.createElement('textarea')
      area.value = text
      area.style.position = 'fixed'
      area.style.opacity = '0'
      document.body.appendChild(area)
      area.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(area)
      return ok
    } catch {
      return false
    }
  }
}

export function formatSpeed(bytes?: number): string {
  if (!bytes || bytes <= 0) return ''
  if (bytes < 1024) return `${bytes.toFixed(0)} B/s`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB/s`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB/s`
}
