/**
 * 浏览器阶段的整合包／存档导入：没有本地文件系统，按路径名做内容识别，
 * 安装过程用定时进度模拟，保证「下载」页与导入弹窗在浏览器下可完整走通。
 */
import { IPC, IPC_EVENT } from '../../contract'
import { publish } from '../../bus'
import { activeFolder, readInstalled, readSettings, writeInstalled, writeSettings } from '../storage'
import { vfsPut } from '../vfs'
import type {
  ImportProbeResult,
  InstalledVersion,
  ModpackInfo,
  ModpackInstallRequest,
  WorldCandidateInfo,
  WorldImportInfo,
  WorldImportOptions,
  WorldImportResult
} from '@shared/types'

const CANDIDATE: WorldCandidateInfo = {
  id: '.',
  worldName: '生存世界',
  dataVersion: 3465,
  minecraftVersion: '1.20.1',
  versionConfidence: 'exact',
  gameMode: '生存',
  hardcore: false,
  datapackCount: 1,
  resourcePacks: [],
  hasWorldResourcePack: false,
  modEvidence: [],
  loader: 'forge',
  loaderConfidence: 'metadata',
  fileCount: 24,
  totalBytes: 41943040
}

function stem(input: string): string {
  const base = input.split(/[\\/]/).pop() ?? input
  return base.replace(/\.(zip|mrpack)$/i, '')
}

function isWorldPath(input: string): boolean {
  const text = input.toLowerCase()
  return !/\.(zip|mrpack|jar)$/.test(text) && /(存档|世界|world|saves)/.test(text)
}

function modpackOf(inputPath: string): ModpackInfo {
  const fileName = stem(inputPath)
  const installed = readInstalled()
  return {
    format: inputPath.toLowerCase().endsWith('.mrpack') ? 'mrpack' : 'curseforge',
    innerName: fileName.replace(/-(?:forge|fabric|neoforge|quilt)?-?\d[\d.]*$/i, '') || fileName,
    fileName,
    version: '1.6.1',
    mcVersion: '1.20.1',
    loader: 'forge',
    loaderVersion: '47.2.0',
    fileCount: 168,
    downloadBytes: 268435456,
    hasOverrides: true,
    hasClientOverrides: false,
    hasPresetKeys: true,
    existingInstances: installed.map((row) => ({
      id: row.id,
      folder: row.folder,
      sameNormalizedName: row.id === fileName,
      samePackVersion: false
    }))
  }
}

function worldOf(inputPath: string): WorldImportInfo {
  return {
    sourcePath: inputPath,
    sourceType: 'zip',
    candidates: [{ ...CANDIDATE, worldName: stem(inputPath) || CANDIDATE.worldName }],
    warnings: ['浏览器阶段为模拟识别，不会读取真实存档内容']
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function simulate(taskId: string, title: string): Promise<void> {
  const stages: Array<{ stage: string; text: string }> = [
    { stage: 'modpack', text: '解析整合包清单' },
    { stage: 'download', text: '下载模组与依赖' },
    { stage: 'overrides', text: '写入整合包配置' }
  ]
  for (let i = 0; i < stages.length; i++) {
    for (let part = 0; part <= 4; part++) {
      publish(IPC_EVENT.progress, {
        taskId,
        stage: stages[i].stage,
        progress: part / 4,
        overall: (i + part / 4) / stages.length,
        text: stages[i].text,
        taskTitle: title
      })
      await sleep(70)
    }
  }
}

async function runModpack(filePath: string, opts?: ModpackInstallRequest): Promise<void> {
  const info = modpackOf(filePath)
  const name = opts?.instanceName?.trim() || info.fileName
  const taskId = `modpack-${Date.now()}`
  await simulate(taskId, `导入整合包 ${info.fileName}`)
  const folder = activeFolder()
  const isolated = readSettings().defaultIsolation !== false
  const record: InstalledVersion = {
    id: name,
    mcVersion: info.mcVersion,
    loader: info.loader,
    loaderVersion: info.loaderVersion,
    isolated,
    gameDirectory: isolated ? `${folder}/versions/${name}` : folder,
    folder,
    javaPath: '',
    javaAuto: true
  }
  writeInstalled([record, ...readInstalled().filter((item) => item.id !== name)])
  vfsPut(record.gameDirectory ?? folder, 'mods', `${info.innerName}-1.0.jar`, 1024000)
  if (!readSettings().activeInstanceId) writeSettings({ activeInstanceId: name })
  publish(IPC_EVENT.installDone, { versionId: name, installedId: name, ok: true, taskId })
  publish(IPC_EVENT.taskDone, { taskId, ok: true })
  publish(IPC_EVENT.progress, { taskId, stage: 'done', progress: 1, overall: 1, text: '整合包安装完成', taskTitle: record.id })
}

async function runWorld(inputPath: string, options: WorldImportOptions): Promise<WorldImportResult> {
  const info = worldOf(inputPath)
  const candidate = info.candidates.find((item) => item.id === options.candidateId) ?? info.candidates[0]
  const taskId = `world-${Date.now()}`
  await simulate(taskId, `导入存档 ${candidate.worldName}`)
  const folder = options.targetFolder || activeFolder()
  let versionId = options.targetVersionId ?? ''
  let createdInstance = false
  if (options.newInstance) {
    const name = options.newInstance.instanceName.trim()
    versionId = name
    createdInstance = true
    const isolated = readSettings().defaultIsolation !== false
    const record: InstalledVersion = {
      id: name,
      mcVersion: options.newInstance.minecraftVersion,
      loader: options.newInstance.loader,
      loaderVersion: options.newInstance.loaderVersion,
      isolated,
      gameDirectory: isolated ? `${folder}/versions/${name}` : folder,
      folder,
      javaPath: '',
      javaAuto: true
    }
    writeInstalled([record, ...readInstalled().filter((item) => item.id !== name)])
  }
  const instance = readInstalled().find((item) => item.id === versionId)
  vfsPut(instance?.gameDirectory ?? folder, 'saves', options.worldName, candidate.totalBytes)
  publish(IPC_EVENT.taskDone, { taskId, ok: true })
  return {
    versionId,
    worldName: options.worldName,
    worldDirectory: `${instance?.gameDirectory ?? folder}/saves/${options.worldName}`,
    installedResourcePacks: [],
    createdInstance
  }
}

export const packHandlers = {
  [IPC.importProbe]: (inputPath: string): ImportProbeResult => {
    const path = String(inputPath ?? '')
    if (!path) throw new Error('请选择要导入的文件或文件夹')
    if (/\.jar$/i.test(path)) return { kind: 'mod' }
    if (/\.(zip|mrpack)$/i.test(path)) return { kind: 'modpack', info: modpackOf(path) }
    if (isWorldPath(path)) return { kind: 'world', info: worldOf(path) }
    return { kind: 'unsupported', message: '浏览器阶段无法识别该路径，请改用「导入」按钮提供的示例内容' }
  },
  [IPC.modpackProbe]: (filePath: string) => modpackOf(String(filePath ?? 'demo.zip')),
  [IPC.worldProbe]: (inputPath: string) => (isWorldPath(String(inputPath ?? '')) ? worldOf(String(inputPath)) : null),
  [IPC.modpackInstall]: (filePath: string, opts?: ModpackInstallRequest) => {
    void runModpack(String(filePath ?? ''), opts)
    return null
  },
  [IPC.worldImport]: (inputPath: string, options: WorldImportOptions) =>
    runWorld(String(inputPath ?? ''), options)
}
