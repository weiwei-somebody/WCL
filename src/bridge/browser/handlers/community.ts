import { IPC, IPC_EVENT } from '../../contract'
import { publish } from '../../bus'
import { fetchModrinthProject, fetchModrinthVersions, searchModrinth, downloadModrinthFile } from '@/data/modrinth'
import { listFabricApiVersions, listLoaderVersions } from '@/data/fabricMeta'
import { activeFolder, instanceGameDir, readSettings, writeInstalled, readInstalled } from '../storage'
import { vfsPut } from '../vfs'
import type {
  CommunityFile,
  CommunityKind,
  CommunityQuery,
  CommunitySearchPage,
  CommunitySource,
  InstallOptions,
  InstalledVersion,
  LoaderName
} from '@shared/types'

const REL_BY_KIND: Record<CommunityKind, string> = {
  mod: 'mods',
  resourcepack: 'resourcepacks',
  shader: 'shaderpacks',
  datapack: 'datapacks',
  modpack: ''
}

function unsupported(source: CommunitySource): never {
  throw new Error(`${source} 在当前浏览器阶段不可用，请改用 Modrinth 来源`)
}

function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

async function runModpackInstall(file: CommunityFile, target: { versionId: string; kind: CommunityKind; folder?: string }, taskId: string): Promise<void> {
  const name = file.fileName.replace(/\.mrpack?$|\.zip$/i, '') || file.version
  for (let step = 0; step <= 4; step++) {
    publish(IPC_EVENT.progress, {
      taskId,
      versionId: name,
      stage: 'modpack',
      progress: step / 4,
      overall: step / 4,
      text: '解析整合包',
      taskTitle: `安装整合包 ${name}`
    })
    await sleep(80)
  }
  const folder = activeFolder()
  const isolated = readSettings().defaultIsolation !== false
  const record: InstalledVersion = {
    id: name,
    mcVersion: file.gameVersions[0] ?? '',
    modpackName: name,
    modpackVersion: file.version,
    isolated,
    gameDirectory: isolated ? `${folder}/versions/${name}` : folder,
    folder,
    javaPath: '',
    javaAuto: true
  }
  writeInstalled([record, ...readInstalled().filter((item) => item.id !== name)])
  publish(IPC_EVENT.progress, { taskId, versionId: name, stage: 'done', progress: 1, overall: 1, text: '安装完成', taskTitle: `安装整合包 ${name}` })
  publish(IPC_EVENT.installDone, { versionId: name, installedId: name, ok: true, taskId })
  publish(IPC_EVENT.taskDone, { taskId, ok: true })
}

export const communityHandlers = {
  [IPC.communitySearch]: (query: CommunityQuery): Promise<CommunitySearchPage> => {
    if (query.source === 'curseforge') unsupported('curseforge')
    return searchModrinth(query)
  },
  [IPC.communityProject]: (source: CommunitySource, projectId: string) => {
    if (source === 'curseforge') unsupported('curseforge')
    return fetchModrinthProject(projectId)
  },
  [IPC.communityFiles]: (
    source: CommunitySource,
    projectId: string,
    filter?: { mcVersion?: string; loader?: LoaderName | ''; kind?: CommunityKind }
  ) => {
    if (source === 'curseforge') unsupported('curseforge')
    return fetchModrinthVersions(projectId, filter)
  },
  [IPC.communityDownload]: async (file: CommunityFile, target: { versionId: string; kind: CommunityKind }, operationId?: string) => {
    const taskId = operationId || `res-${file.fileId}-${Date.now()}`
    const taskTitle = `下载 ${file.fileName}`
    publish(IPC_EVENT.progress, { taskId, stage: 'resource', progress: 0, overall: 0, text: '连接资源地址', taskTitle })
    if (target.kind === 'modpack') {
      const blob = await downloadModrinthFile(file)
      void blob
      await runModpackInstall(file, target, taskId)
      return `整合包已解析并创建实例 ${file.version}`
    }
    let blob: Blob
    try {
      blob = await downloadModrinthFile(file)
    } catch (error) {
      publish(IPC_EVENT.taskDone, { taskId, ok: false, error: error instanceof Error ? error.message : String(error) })
      throw error
    }
    publish(IPC_EVENT.progress, { taskId, stage: 'resource', progress: 1, overall: 1, text: '写入实例目录', taskTitle })
    const dir = instanceGameDir(target.versionId)
    vfsPut(dir, REL_BY_KIND[target.kind], file.fileName, blob.size || file.size)
    publish(IPC_EVENT.taskDone, { taskId, ok: true })
    return `${dir}/${REL_BY_KIND[target.kind]}/${file.fileName}`
  },
  [IPC.loadersList]: (loader: LoaderName, mc: string) => listLoaderVersions(loader, mc),
  [IPC.fabricApiList]: (mc: string) => listFabricApiVersions(mc)
}
