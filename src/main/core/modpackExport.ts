import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { pipeline } from 'node:stream/promises'
import yazl from 'yazl'
import type { ModpackExportOptions } from '../../shared/types'
import { waitIfTaskPaused } from './tasks'
import { centerTarget, assertInstanceIdle } from './instanceCenter'
import { listAllInstalled } from './versions'
import { safePath, type BackupProgress } from './backupStore'

interface ZipEntry { file: string; name: string }

const LAUNCHER_FILES = ['options.txt', 'keybindings.txt', 'optionsof.txt', 'servers.dat']

function safeFilePart(value: string): string {
  const cleaned = value.trim().replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/[. ]+$/, '')
  return cleaned || 'modpack'
}

async function collectDir(root: string, rel: string, prefix: string, skipDisabled: boolean, out: ZipEntry[], signal?: AbortSignal): Promise<void> {
  const full = path.join(root, rel)
  let stat: fs.Stats
  try { stat = fs.lstatSync(full) } catch { return }
  if (stat.isSymbolicLink()) return
  if (stat.isFile()) {
    out.push({ file: await safePath(root, rel), name: prefix + rel })
    return
  }
  if (!stat.isDirectory()) return
  const names = (await fs.promises.readdir(full)).sort()
  for (const name of names) {
    await waitIfTaskPaused(signal)
    signal?.throwIfAborted()
    if (skipDisabled && name.endsWith('.disabled')) continue
    await collectDir(root, rel + '/' + name, prefix, skipDisabled, out, signal)
  }
}

function loaderId(loader?: string): string {
  return loader === 'neoforge' ? 'neoforge' : loader === 'fabric' ? 'fabric' : loader === 'quilt' ? 'quilt' : 'forge'
}

function modrinthDependency(loader: string | undefined, version: string | undefined): Record<string, string> {
  if (!loader) return {}
  if (loader === 'fabric') return { 'fabric-loader': version || '' }
  if (loader === 'quilt') return { 'quilt-loader': version || '' }
  if (loader === 'neoforge') return { neoforge: version || '' }
  return { forge: version || '' }
}

function buildManifest(options: ModpackExportOptions, mcVersion: string, loader?: string, loaderVersion?: string): Buffer | null {
  const common = {
    name: options.name.trim() || options.versionId,
    version: options.version.trim() || '1.0.0',
    author: options.author.trim(),
    description: options.description.trim()
  }
  if (options.format === 'curseforge') {
    return Buffer.from(JSON.stringify({
      minecraft: {
        version: mcVersion,
        modLoaders: loader ? [{ id: `${loaderId(loader)}-${loaderVersion || ''}`.replace(/-$/, ''), primary: true }] : []
      },
      manifestType: 'minecraftModpack',
      manifestVersion: 1,
      ...common,
      files: []
    }, null, 2))
  }
  if (options.format === 'modrinth') {
    return Buffer.from(JSON.stringify({
      formatVersion: 1,
      game: 'minecraft',
      versionId: common.version,
      name: common.name,
      summary: common.description,
      files: [],
      dependencies: { minecraft: mcVersion, ...modrinthDependency(loader, loaderVersion) }
    }, null, 2))
  }
  return null
}

function buildWclPack(options: ModpackExportOptions, mcVersion: string, loader?: string, loaderVersion?: string): Buffer | null {
  if (options.format !== 'wcl' && options.format !== 'zip') return null
  return Buffer.from(JSON.stringify({
    formatVersion: 1,
    launcher: 'WCL',
    name: options.name.trim() || options.versionId,
    version: options.version.trim() || '1.0.0',
    author: options.author.trim(),
    description: options.description.trim(),
    minecraftVersion: mcVersion,
    loader: loader || '',
    loaderVersion: loaderVersion || ''
  }, null, 2), 'utf8')
}

export async function exportModpack(options: ModpackExportOptions, signal?: AbortSignal, progress?: BackupProgress): Promise<string> {
  const c = centerTarget({ id: options.versionId, folder: options.folder })
  const root = c.dir
  await assertInstanceIdle(root)
  const installed = listAllInstalled().find((row) => row.id === options.versionId)
  const json = c.json as { inheritsFrom?: string; id?: string } | undefined
  const mcVersion = installed?.mcVersion || json?.inheritsFrom || json?.id || options.versionId
  const prefix = options.format === 'curseforge' || options.format === 'modrinth' ? 'overrides/' : ''
  const types = options.types
  const collected: ZipEntry[] = []

  progress?.(0, 1, '正在整理实例文件…')
  if (types.mods) await collectDir(root, 'mods', prefix, options.enabledModsOnly, collected, signal)
  if (types.config) await collectDir(root, 'config', prefix, false, collected, signal)
  if (types.resourcePacks) await collectDir(root, 'resourcepacks', prefix, false, collected, signal)
  if (types.shaderPacks) await collectDir(root, 'shaderpacks', prefix, false, collected, signal)
  if (types.saves) await collectDir(root, 'saves', prefix, false, collected, signal)
  if (types.servers) await collectDir(root, 'servers.dat', prefix, false, collected, signal)
  if (types.launcherSettings) {
    for (const name of LAUNCHER_FILES) await collectDir(root, name, prefix, false, collected, signal)
  }
  collected.sort((a, b) => a.name.localeCompare(b.name))
  const seen = new Set<string>()
  const files = collected.filter((entry) => {
    const key = entry.name.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  if (!files.length) throw new Error('没有勾选任何要导出的内容')

  const dir = options.destination.trim()
  if (!dir) throw new Error('请选择导出的保存位置')
  if (!fs.existsSync(dir)) throw new Error('保存位置不存在')
  const fileName = `${safeFilePart(options.name.trim() || options.versionId)}-${safeFilePart(options.version.trim() || '1.0.0')}.zip`
  const destination = path.join(dir, fileName)
  const rel = path.relative(root, destination)
  if (!rel.startsWith('..') && !path.isAbsolute(rel)) throw new Error('请选择实例目录之外的保存位置')
  if (fs.existsSync(destination)) throw new Error('同名整合包已存在，请更换名称或保存位置')

  const zip = new yazl.ZipFile()
  const temporary = destination + '.' + crypto.randomUUID() + '.tmp'
  const output = pipeline(zip.outputStream, fs.createWriteStream(temporary, { flags: 'wx' }), { signal })
  void output.catch(() => undefined)
  try {
    const manifest = buildManifest(options, mcVersion, installed?.loader, installed?.loaderVersion)
    if (manifest) zip.addBuffer(manifest, options.format === 'modrinth' ? 'modrinth.index.json' : 'manifest.json')
    const pack = buildWclPack(options, mcVersion, installed?.loader, installed?.loaderVersion)
    if (pack) zip.addBuffer(pack, 'WCL/pack.json')
    const total = files.length
    let done = 0
    for (const entry of files) {
      await waitIfTaskPaused(signal)
      signal?.throwIfAborted()
      zip.addFile(entry.file, entry.name)
      done++
      progress?.(done, total, `打包 ${done}/${total} · ${path.basename(entry.name)}`)
    }
    zip.end()
    await output
    signal?.throwIfAborted()
    await fs.promises.copyFile(temporary, destination, fs.constants.COPYFILE_EXCL)
    return destination
  } finally {
    await fs.promises.rm(temporary, { force: true })
  }
}
