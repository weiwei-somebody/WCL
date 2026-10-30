/**
 * 基于仓库根目录 latest.json 的自更新：
 * 读取最新版本号与更新说明 → 与当前版本比较 → 下载便携 exe →
 * 立即由 PowerShell 助手替换当前 exe 并重启（与手动更新相同的替换/回滚流程）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import { GITHUB_REPO } from '../../shared/branding'
import { isNewerVersion } from '../../shared/semver'
import type { LatestUpdateInfo } from '../../shared/types'
import { applyUpdateOnStartup, currentPortableExe } from './applyUpdate'
import { currentVersion } from './selfUpdate'
import { getSettings } from './settings'
import { updateAssetName } from './updateTrust'
import { downloadUpdatePayload } from './updateDownload'
import { updateDownloadCandidates } from './updateSources'
import { atomicUpdateJson, updateMarker, validateUpdatePayload, type UpdateTransaction } from './updateTransaction'
import { logScope } from './launcherLog'

const updateLog = logScope('self-update')
const RAW_BASE = `https://raw.githubusercontent.com/${GITHUB_REPO}`
const MIRROR_BASE = `https://cdn.jsdelivr.net/gh/${GITHUB_REPO}`

export type LatestProgress = (done: number, total: number) => void

/** 远端 latest.json 的结构（notes 可为数组或字符串，url 缺省时按版本拼 Release 地址） */
interface LatestJson {
  version?: unknown
  notes?: unknown
  url?: unknown
  sha256?: unknown
  size?: unknown
}

function assetUrlOf(version: string): string {
  return `https://github.com/${GITHUB_REPO}/releases/download/v${version}/${updateAssetName(version)}`
}

function notesOf(value: unknown): string {
  const list = Array.isArray(value) ? value : [value]
  return list.map((item) => String(item ?? '').trim()).filter(Boolean).join('\n')
}

async function fetchLatestJson(): Promise<LatestJson | null> {
  const urls = [`${RAW_BASE}/main/latest.json`, `${RAW_BASE}/master/latest.json`, `${MIRROR_BASE}@main/latest.json`, `${MIRROR_BASE}@master/latest.json`]
  for (const url of urls) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
      if (!res.ok) {
        await res.body?.cancel().catch(() => {})
        continue
      }
      return JSON.parse((await res.text()).replace(/^\uFEFF/, '')) as LatestJson
    } catch (error) {
      updateLog.debug(`读取 latest.json 失败：${url}`, error)
    }
  }
  return null
}

/** 远端版本高于当前版本时返回更新信息，否则返回 null（网络失败一律静默） */
export async function checkLatestJson(): Promise<LatestUpdateInfo | null> {
  const json = await fetchLatestJson()
  if (!json) return null
  const version = String(json.version ?? '').trim().replace(/^v/i, '')
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    updateLog.info(`latest.json 版本号无效：${version}`)
    return null
  }
  const current = currentVersion()
  if (!isNewerVersion(version, current)) return null
  const info: LatestUpdateInfo = {
    version,
    current,
    notes: notesOf(json.notes),
    url: String(json.url ?? '').trim() || assetUrlOf(version),
    sha256: /^[a-f\d]{64}$/i.test(String(json.sha256 ?? '')) ? String(json.sha256).toLowerCase() : '',
    size: Number(json.size) > 0 ? Number(json.size) : 0
  }
  return info
}

/** HEAD 探测更新包大小；失败返回 0（仅影响进度显示） */
async function headSize(url: string): Promise<number> {
  try {
    const res = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(15_000) })
    const size = Number(res.headers.get('content-length') ?? 0)
    await res.body?.cancel().catch(() => {})
    return Number.isFinite(size) && size > 0 ? size : 0
  } catch {
    return 0
  }
}

/**
 * 立刻更新：下载并校验新 exe → 写入更新事务 → 启动替换助手后退出，
 * 助手等待本进程结束后覆盖 exe 并重新启动（当前版本号随新 exe 更新，不会重复提示）。
 */
export async function installLatestUpdate(info: LatestUpdateInfo, progress?: LatestProgress): Promise<void> {
  if (!/^[a-f\d]{64}$/i.test(info.sha256)) throw new Error('latest.json 缺少 sha256 校验值，已取消更新')
  const exe = currentPortableExe()
  if (!exe) throw new Error('当前运行形态不支持自更新（仅便携版 exe）')
  const assetName = updateAssetName(info.version)
  const dest = path.join(path.dirname(exe), 'WCL-update', info.version, assetName)
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.rmSync(dest, { force: true })
  const size = info.size || await headSize(info.url)
  await downloadUpdatePayload(
    { urls: updateDownloadCandidates(info.url, getSettings()), dest, sha256: info.sha256, size: size || undefined },
    (done, total) => progress?.(done, total)
  )
  const stat = fs.statSync(dest)
  const release = { version: info.version, publishedAt: '', body: info.notes, assetUrl: info.url, assetSize: stat.size, assetName }
  const transaction: UpdateTransaction = {
    schema: 1,
    id: randomUUID(),
    target: path.resolve(exe),
    file: path.resolve(dest),
    sha256: info.sha256,
    size: stat.size,
    from: currentVersion(),
    release,
    mode: 'upgrade'
  }
  await validateUpdatePayload(transaction)
  atomicUpdateJson(updateMarker(path.resolve(exe)), transaction)
  updateLog.info(`开始替换启动器 exe：${info.version}`)
  await applyUpdateOnStartup()
  // applyUpdateOnStartup 已在替换助手启动后退出进程；走到这里说明助手启动失败
  throw new Error('更新助手启动失败，当前启动器已保留')
}

export function launcherVersion(): string {
  return app.getVersion()
}
