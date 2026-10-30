import { IPC } from '../../contract'
import { activeFolder, instanceGameDir, patchInstalled, readInstalled, writeInstalled } from '../storage'
import { vfsList, vfsPut } from '../vfs'
import { createZip, downloadBlob } from '@shared/zipStore'
import type {
  BackupEntry,
  DiagnosticFinding,
  InstanceOperation,
  InstanceOverview,
  InstanceScreenshot,
  InstanceWorld
} from '@shared/instanceCenter'
import type { InstalledVersion } from '@shared/types'

const BACKUP_KEY = 'wcl.center.backups'
const SEED_KEY = 'wcl.center.seeded'

const RELS = ['', 'mods', 'resourcepacks', 'shaderpacks', 'saves', 'screenshots', 'replay_recordings', 'schematics']

const SEED_WORLDS = ['新的世界', '生存世界']
const SEED_SHOTS = ['2026-10-11_20.31.45.png', '2026-10-12_21.04.18.png', '2026-10-13_19.52.07.png', '2026-10-14_22.10.33.png', '2026-10-15_20.07.12.png', '2026-10-16_21.38.49.png']
const SEED_MOD = 'example-mod.jar.disabled'

const WORLD_MODES = ['生存模式', '创造模式', '冒险模式']

interface BackupRecord extends BackupEntry {
  createdAt: string
  title: string
  automatic: boolean
  roots: string[]
  entries: Array<{ rel: string; name: string; size: number }>
}

function readMap<T>(key: string): Record<string, T> {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, T>) : {}
  } catch {
    return {}
  }
}

function writeMap<T>(key: string, value: Record<string, T>): void {
  localStorage.setItem(key, JSON.stringify(value))
}

function installedOf(id: string): InstalledVersion | null {
  return readInstalled().find((row) => row.id === id) ?? null
}

function requireInstance(id: string): InstalledVersion {
  const found = installedOf(id)
  if (!found) throw new Error('实例不存在或尚未安装')
  return found
}

function dirOf(id: string, folder?: string): string {
  const found = installedOf(id)
  return found ? instanceGameDir(found.id) : folder?.trim() || activeFolder()
}

function fingerprint(text: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0').repeat(4)
}

function hashOf(text: string): number {
  let hash = 0
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) >>> 0
  return hash
}

function shotImage(name: string): string {
  const canvas = document.createElement('canvas')
  canvas.width = 320
  canvas.height = 180
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''
  const hash = hashOf(name)
  const sky = ctx.createLinearGradient(0, 0, 0, canvas.height)
  sky.addColorStop(0, `hsl(${hash % 360} 42% 26%)`)
  sky.addColorStop(1, `hsl(${(hash >> 5) % 360} 46% 58%)`)
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = 'rgba(255,255,255,0.16)'
  for (let i = 0; i < 6; i++) ctx.fillRect(i * 64 + (hash % 24), canvas.height - 64, 32, 64)
  ctx.fillStyle = `hsl(${(hash >> 3) % 360} 54% 72%)`
  ctx.beginPath()
  ctx.arc(48 + (hash % 160), 48, 16, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = 'rgba(0,0,0,0.28)'
  ctx.fillRect(0, canvas.height - 30, canvas.width, 30)
  ctx.fillStyle = '#f2f4f8'
  ctx.font = '12px monospace'
  ctx.fillText(name.replace(/\.png$/, ''), 10, canvas.height - 11)
  return canvas.toDataURL('image/png')
}

function seed(id: string): void {
  const seeded = readMap<boolean>(SEED_KEY)
  if (seeded[id]) return
  const instance = installedOf(id)
  const dir = dirOf(id)
  vfsPut(dir, '', `${instance?.mcVersion ?? id}.jar`, 24812000)
  vfsPut(dir, 'mods', SEED_MOD, 486000)
  for (const name of SEED_WORLDS) vfsPut(dir, 'saves', name, 0)
  for (const name of SEED_SHOTS) vfsPut(dir, 'screenshots', name, 812000)
  seeded[id] = true
  writeMap(SEED_KEY, seeded)
}

function snapshot(dir: string): Array<{ rel: string; name: string; size: number }> {
  const rows: Array<{ rel: string; name: string; size: number }> = []
  for (const rel of RELS) {
    for (const entry of vfsList(dir, rel)) rows.push({ rel, name: entry.name, size: entry.size })
  }
  return rows
}

function overviewOf(id: string, folder?: string): InstanceOverview {
  const instance = requireInstance(id)
  const dir = dirOf(id, folder)
  const roots = [instance.folder, dir].filter((value, index, list) => list.indexOf(value) === index)
  return {
    target: { folder: instance.folder, id: instance.id },
    directory: dir,
    shared: instance.isolated !== true,
    name: instance.id,
    mcVersion: instance.mcVersion,
    loader: instance.loader,
    running: false,
    roots
  }
}

function worldsOf(id: string, folder?: string): InstanceWorld[] {
  seed(id)
  const dir = dirOf(id, folder)
  const mcVersion = installedOf(id)?.mcVersion
  return vfsList(dir, 'saves').map((row) => ({
    id: row.name,
    name: row.name,
    version: mcVersion,
    mode: WORLD_MODES[hashOf(row.name) % WORLD_MODES.length],
    lastPlayed: row.mtime
  }))
}

function screenshotsOf(id: string, folder?: string): InstanceScreenshot[] {
  seed(id)
  const dir = dirOf(id, folder)
  return vfsList(dir, 'screenshots')
    .map((row) => ({ id: row.name, date: row.mtime, image: shotImage(row.name) }))
    .sort((a, b) => b.date - a.date)
}

function backupsOf(id: string, folder?: string): BackupRecord[] {
  const dir = dirOf(id, folder)
  const map = readMap<BackupRecord[]>(BACKUP_KEY)
  const kept = vfsList(dir, 'backups').map((row) => row.name)
  const rows = (map[id] ?? []).filter((row) => kept.includes(row.path))
  if (rows.length !== (map[id] ?? []).length) {
    map[id] = rows
    writeMap(BACKUP_KEY, map)
  }
  return rows
}

function runOperation(id: string, folder: string, action: InstanceOperation): { ok: boolean; error?: string } {
  const instance = requireInstance(id)
  const dir = dirOf(id, folder)
  if (action.kind === 'backup' || action.kind === 'worldExport') {
    const world = action.world ?? ''
    const entries = snapshot(dir).filter((row) => (world ? row.rel === 'saves' && row.name === world : true))
    if (world && !entries.length) return { ok: false, error: `世界 ${world} 不存在` }
    const manifest = {
      format: 1,
      id,
      mcVersion: instance.mcVersion,
      loader: instance.loader ?? '',
      directory: dir,
      world,
      createdAt: new Date().toISOString(),
      files: entries,
      note: '浏览器阶段导出的是虚拟目录索引，不含真实游戏文件'
    }
    const files = [{ name: 'wcl-instance.json', data: JSON.stringify(manifest, null, 2) }]
    for (const rel of RELS) {
      const rows = entries.filter((row) => row.rel === rel)
      if (!rows.length) continue
      files.push({ name: `index/${rel || 'root'}.txt`, data: rows.map((row) => `${row.name}\t${row.size}`).join('\n') })
    }
    const zip = createZip(files)
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const name = world
      ? `wcl-world-${id}-${world}-${stamp}.zip`
      : `wcl-backup-${id}-${stamp}.zip`
    downloadBlob(zip.blob, name)
    const map = readMap<BackupRecord[]>(BACKUP_KEY)
    const record: BackupRecord = {
      path: name,
      size: zip.blob.size,
      sha256: zip.checksum,
      createdAt: new Date().toISOString(),
      title: world ? `存档导出 ${world}` : `${id} 备份`,
      automatic: false,
      roots: world ? ['saves'] : RELS.filter((rel) => rel),
      entries
    }
    map[id] = [record, ...(map[id] ?? [])].slice(0, 30)
    writeMap(BACKUP_KEY, map)
    vfsPut(dir, 'backups', name, zip.blob.size)
    return { ok: true }
  }
  if (action.kind === 'clone') {
    const name = (action.name ?? `${id}-副本`).trim()
    if (!name) return { ok: false, error: '新实例名不能为空' }
    if (installedOf(name)) return { ok: false, error: `${name} 已存在` }
    const isolated = instance.isolated !== true
    const dest = isolated ? `${instance.folder}/versions/${name}` : instance.folder
    const next: InstalledVersion = { ...instance, id: name, gameDirectory: dest }
    writeInstalled([...readInstalled(), next])
    if (dest !== dir) {
      for (const rel of RELS) {
        for (const row of vfsList(dir, rel)) vfsPut(dest, rel, row.name, row.size)
      }
    }
    return { ok: true }
  }
  if (action.kind === 'restore') {
    const record = backupsOf(id, folder).find((row) => row.path === action.backupId)
    if (!record) return { ok: false, error: '备份记录不存在' }
    for (const row of record.entries) vfsPut(dir, row.rel, row.name, row.size)
    return { ok: true }
  }
  if (action.kind === 'repair') {
    const expected = instance.isolated === true ? `${instance.folder}/versions/${instance.id}` : instance.folder
    if (instance.gameDirectory !== expected) patchInstalled(id, { gameDirectory: expected })
    const jars = vfsList(dir, '').filter((row) => row.name.endsWith('.jar'))
    if (!jars.length) return { ok: false, error: '缺少客户端 jar，请在「游戏版本」页重新安装或补全文件' }
    return { ok: true }
  }
  return { ok: false, error: `浏览器阶段不支持 ${String(action.kind)} 操作` }
}

function diagnoseOf(id: string, folder?: string): DiagnosticFinding[] {
  const instance = requireInstance(id)
  const dir = dirOf(id, folder)
  const findings: DiagnosticFinding[] = []
  if (!instance.javaPath && instance.javaAuto !== true) {
    findings.push({
      rule: 'java-auto',
      title: '未指定该实例的 Java 运行时',
      confidence: 'possible',
      evidence: '实例登记里 javaPath 为空且未开启自动匹配，启动时会退回全局 Java 设置。',
      advice: '在「设置」分区开启自动匹配，或手动填入 Java 可执行文件路径。',
      action: 'java'
    })
  }
  const expected = instance.isolated === true ? `${instance.folder}/versions/${instance.id}` : instance.folder
  if (instance.gameDirectory && instance.gameDirectory !== expected) {
    findings.push({
      rule: 'isolation-path',
      title: '版本隔离与游戏目录不一致',
      confidence: 'certain',
      evidence: `记录目录为 ${instance.gameDirectory}，隔离开关推导出的目录为 ${expected}。`,
      advice: '在「设置」分区重新保存一次隔离状态，让目录与开关同步。',
      action: 'files',
      fileName: 'versions'
    })
  }
  const disabled = vfsList(dir, 'mods').filter((row) => row.name.endsWith('.disabled'))
  if (disabled.length) {
    findings.push({
      rule: 'mods-disabled',
      title: '存在被禁用的模组',
      confidence: 'certain',
      evidence: `${disabled.length} 个文件以 .disabled 结尾，启动后不会加载。`,
      advice: '确认这些模组是否需要启用，不需要的话可以直接移除。',
      action: 'mods',
      fileName: disabled[0].name,
      mods: disabled.map((row) => ({ fileName: row.name, name: row.name.replace(/\.disabled$/, '') }))
    })
  }
  if (!vfsList(dir, '').some((row) => row.name.endsWith('.jar'))) {
    findings.push({
      rule: 'client-jar',
      title: '缺少客户端 jar',
      confidence: 'certain',
      evidence: `目录 ${dir} 下没有找到 .jar 文件。`,
      advice: '在「概览」分区执行「补全文件」，或重新安装该版本。',
      action: 'files'
    })
  }
  const worlds = vfsList(dir, 'saves')
  if (!worlds.length) {
    findings.push({
      rule: 'worlds-empty',
      title: '没有任何存档',
      confidence: 'possible',
      evidence: 'saves 目录为空，首次启动时会创建新世界。',
      advice: '如果这是预期行为可以忽略；也可以从「世界」分区导出、导入存档。',
      action: 'files',
      fileName: 'saves'
    })
  }
  return findings.slice(0, 4)
}

export const centerHandlers = {
  [IPC.centerOverview]: (id: string, folder?: string) => overviewOf(id, folder),
  [IPC.centerWorlds]: (id: string, folder?: string) => worldsOf(id, folder),
  [IPC.centerScreenshots]: (id: string, folder?: string) => screenshotsOf(id, folder),
  [IPC.centerBackups]: (id: string, folder?: string) => backupsOf(id, folder),
  [IPC.centerOperation]: (id: string, folder: string, action: InstanceOperation) => runOperation(id, folder, action),
  [IPC.centerDiagnose]: (id: string, folder?: string) => diagnoseOf(id, folder),
  [IPC.centerFile]: () => null
}
