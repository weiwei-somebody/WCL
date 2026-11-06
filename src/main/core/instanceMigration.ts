import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { downloadAll } from './download'
import { getSettings } from './settings'
import { httpFetch } from './httpClient'
import { resolveResourceDirectory } from './resourceDirectory'
import { folderOfVersion } from './paths'
import { readVersionJson } from './versions'
import { resolveInstanceMetadata } from './instanceMetadata'
import { logScope } from './launcherLog'
import type { InstanceMigrationItem, InstanceMigrationResult, LoaderName } from '../../shared/types'

const migrateLog = logScope('instance-migration')
const MR_BASES = ['https://api.modrinth.com/v2', 'https://mod.mcimirror.top/modrinth/v2']
const UA = { 'User-Agent': 'WCL-Launcher', 'Content-Type': 'application/json' }
const TIMEOUT = 20_000

type ResourceKind = InstanceMigrationItem['kind']

const KINDS: Array<{ kind: ResourceKind; dir: string; loaders: (loader: LoaderName | undefined) => string[] }> = [
  { kind: 'mod', dir: 'mods', loaders: (loader) => (loader ? [loader] : []) },
  { kind: 'resourcepack', dir: 'resourcepacks', loaders: () => ['minecraft'] },
  { kind: 'shader', dir: 'shaderpacks', loaders: () => ['iris', 'optifine', 'canvas', 'vanilla'] }
]

const KIND_LABEL: Record<ResourceKind, string> = { mod: '模组', resourcepack: '资源包', shader: '光影包' }

interface MrFile {
  url?: string
  filename?: string
  size?: number
  primary?: boolean
  hashes?: { sha1?: string }
}

interface MrVersion {
  project_id?: string
  version_number?: string
  game_versions?: string[]
  loaders?: string[]
  files?: MrFile[]
}

function sha1Of(file: string): string {
  return crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex')
}

function listFiles(dir: string, kind: ResourceKind): string[] {
  let names: fs.Dirent[]
  try {
    names = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const pattern = kind === 'mod' ? /^.+\.jar(?:\.disabled)?$/i : /^.+\.zip(?:\.disabled)?$/i
  return names.filter((row) => row.isFile() && !row.isSymbolicLink() && pattern.test(row.name)).map((row) => row.name)
}

async function postLookup(hashes: string[], loaders: string[], mcVersion: string): Promise<Record<string, MrVersion | undefined>> {
  let lastErr: unknown = null
  const bases = getSettings().mirror === 'bmclapi' ? [...MR_BASES].reverse() : MR_BASES
  for (const base of bases) {
    try {
      const res = await httpFetch(`${base}/version_files/update`, {
        method: 'POST',
        headers: UA,
        signal: AbortSignal.timeout(TIMEOUT),
        body: JSON.stringify({ hashes, algorithm: 'sha1', loaders, game_versions: [mcVersion] })
      })
      if (!res.ok) {
        await res.body?.cancel().catch(() => {})
        throw new Error(`HTTP ${res.status}`)
      }
      return (await res.json()) as Record<string, MrVersion | undefined>
    } catch (error) {
      lastErr = error
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}

function pickFile(version: MrVersion | undefined): MrFile | null {
  if (!version?.files?.length) return null
  const file = version.files.find((row) => row.primary) ?? version.files[0]
  return file?.url && file.filename ? file : null
}

/**
 * 实例资源迁移：把源实例的模组/资源包/光影按目标实例的 MC 版本与加载器重新从 Modrinth 匹配，
 * 命中则下载到目标实例对应目录；未命中或目标版本不兼容的逐项记录失败原因。
 */
export async function migrateInstance(
  sourceId: string,
  targetId: string,
  onProgress?: (done: number, total: number, text: string) => void
): Promise<InstanceMigrationResult> {
  if (sourceId === targetId) throw new Error('源实例与目标实例相同，无需迁移')
  const sourceFolder = folderOfVersion(sourceId)
  const targetFolder = folderOfVersion(targetId)
  const targetMeta = resolveInstanceMetadata(readVersionJson(targetId), (id) => {
    try { return readVersionJson(id) } catch { return undefined }
  })
  if (!targetMeta.mcVersion) throw new Error('目标实例缺少 Minecraft 版本信息，无法迁移')

  const plan: Array<{ fileName: string; kind: ResourceKind; dir: string; sha1: string; loaders: string[] }> = []
  for (const item of KINDS) {
    const dir = await resolveResourceDirectory(sourceFolder, sourceId, item.dir)
    const loaders = item.loaders(targetMeta.loader)
    for (const fileName of listFiles(dir, item.kind)) {
      try {
        plan.push({ fileName, kind: item.kind, dir: item.dir, sha1: sha1Of(path.join(dir, fileName)), loaders })
      } catch (error) {
        migrateLog.warn(`读取 ${fileName} 失败`, error)
      }
    }
  }
  const total = plan.length
  if (!total) return { source: sourceId, target: targetId, items: [], migrated: 0, failed: 0 }
  onProgress?.(0, total, `已发现 ${total} 个资源，开始匹配目标版本`)

  const items: InstanceMigrationItem[] = []
  const targetDirs = new Map<ResourceKind, string>()
  for (let index = 0; index < plan.length; index++) {
    const row = plan[index]
    onProgress?.(index, total, `匹配 ${KIND_LABEL[row.kind]} ${row.fileName}`)
    if (row.kind === 'mod' && !row.loaders.length) {
      items.push({ fileName: row.fileName, kind: row.kind, ok: false, detail: '目标实例没有加载器，无法迁移模组' })
      continue
    }
    try {
      const byHash = await postLookup([row.sha1], row.loaders, targetMeta.mcVersion)
      const version = byHash[row.sha1]
      const file = pickFile(version)
      if (!file) {
        items.push({ fileName: row.fileName, kind: row.kind, ok: false, detail: `Modrinth 没有 ${targetMeta.mcVersion} 的兼容版本（或该文件未收录）` })
        continue
      }
      let dir = targetDirs.get(row.kind)
      if (!dir) {
        dir = await resolveResourceDirectory(targetFolder, targetId, row.dir)
        fs.mkdirSync(dir, { recursive: true })
        targetDirs.set(row.kind, dir)
      }
      const disabled = /\.disabled$/i.test(row.fileName) ? '.disabled' : ''
      const name = file.filename!.replace(/\.disabled$/i, '') + disabled
      const dest = path.join(dir, name)
      if (fs.existsSync(dest)) {
        items.push({ fileName: row.fileName, kind: row.kind, ok: true, detail: `${name}（目标实例已存在）` })
        continue
      }
      onProgress?.(index, total, `下载 ${name}`)
      await downloadAll(
        [{ url: file.url!, dest, sha1: file.hashes?.sha1, size: file.size || undefined }],
        undefined,
        getSettings().downloadThreads,
        getSettings().mirror
      )
      items.push({ fileName: row.fileName, kind: row.kind, ok: true, detail: name })
      migrateLog.info(`迁移 ${row.fileName} → ${name}（${targetId}）`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      migrateLog.warn(`迁移 ${row.fileName} 失败`, error)
      items.push({ fileName: row.fileName, kind: row.kind, ok: false, detail: message })
    }
  }
  const migrated = items.filter((row) => row.ok).length
  onProgress?.(total, total, `迁移完成：成功 ${migrated} 个，失败 ${items.length - migrated} 个`)
  return { source: sourceId, target: targetId, items, migrated, failed: items.length - migrated }
}
