/**
 * MC百科（mcmod.cn）中文译名查询。页面为公开 HTML，浏览器阶段可直接跨域读取。
 * 只用「中文名 (English)」形式的结果做名称匹配，不做模糊关联，避免译错项目。
 */
import type { CommunityKind } from '@shared/types'

const SEARCH_URL = 'https://search.mcmod.cn/s'
const CACHE_KEY = 'wcl.mcmod3'
const OK_TTL = 7 * 24 * 60 * 60 * 1000
const MISS_TTL = 30 * 60 * 1000

/** MC百科只有模组与整合包两类条目，光影/资源包/数据包没有对应词条。 */
export type McmodEntryType = 'mod' | 'modpack'

const KIND_TYPE: Partial<Record<CommunityKind, McmodEntryType>> = { mod: 'mod', modpack: 'modpack' }

/** 资源类型映射到 MC百科词条类型，映射不到说明该类型在 MC百科没有译名。 */
export function mcmodTypeOf(kind: CommunityKind): McmodEntryType | null {
  return KIND_TYPE[kind] ?? null
}

const ENTRY_URL: Record<McmodEntryType, string> = {
  mod: 'https://www.mcmod.cn/class',
  modpack: 'https://www.mcmod.cn/modpack'
}

interface CacheRow {
  zh: string
  entryId: string
  at: number
  en?: string
  type?: McmodEntryType
}

export interface McmodHit {
  entryId: string
  cn: string
  en: string
  type: McmodEntryType
}

type CacheMap = Record<string, CacheRow>

function readCache(): CacheMap {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    const map = raw ? (JSON.parse(raw) as CacheMap) : {}
    return map && typeof map === 'object' ? map : {}
  } catch {
    return {}
  }
}

function writeCache(key: string, row: CacheRow): void {
  try {
    const map = readCache()
    map[key] = row
    const keys = Object.keys(map)
    if (keys.length > 400) {
      keys.sort((a, b) => map[a].at - map[b].at)
        .slice(0, keys.length - 400)
        .forEach((item) => delete map[item])
    }
    localStorage.setItem(CACHE_KEY, JSON.stringify(map))
  } catch {
    /* 缓存失败不影响展示 */
  }
}

function text(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_match, value: string) => {
      const point = value[0].toLowerCase() === 'x' ? parseInt(value.slice(1), 16) : Number(value)
      return point >= 0 && point <= 0x10ffff ? String.fromCodePoint(point) : ''
    })
    .replace(/&(?:amp|quot|apos|lt|gt|nbsp);/gi, (entity) => {
      const table: Record<string, string> = { '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>', '&nbsp;': ' ' }
      return table[entity.toLowerCase()] ?? ''
    })
    .replace(/\s+/g, ' ')
    .trim()
}

export function normalizeModKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function splitName(raw: string): { cn: string; en: string } {
  const name = raw.replace(/^\[[^\]]+\]\s*/, '').trim()
  const matched = name.match(/^(.*?)\s*\(([^()]*)\)\s*$/)
  return matched ? { cn: matched[1].trim(), en: matched[2].trim() } : { cn: name, en: '' }
}

export function parseMcmodSearch(html: string): McmodHit[] {
  const list = html.match(
    /<div\b[^>]*class=["'][^"']*\bsearch-result-list\b[^"']*["'][^>]*>([\s\S]*?)(?=<div\b[^>]*class=["'][^"']*search-result-pages|<footer\b|$)/i
  )?.[1]
  if (list == null) throw new Error('MC百科搜索页面格式变化或访问受限')
  const hits: McmodHit[] = []
  for (const item of list.split(/<div\b[^>]*class=["']result-item["'][^>]*>/i).slice(1)) {
    const head = item.split(/<div\b[^>]*class=["']body["']/i)[0]
    const anchor = head.match(
      /<a\b[^>]*\bhref\s*=\s*["']([^"']*?\/(class|modpack)\/(\d+)\.html)["'][^>]*>([\s\S]*?)<\/a\s*>/i
    )
    if (!anchor) continue
    const name = text(anchor[4])
    if (!name) continue
    const { cn, en } = splitName(name)
    if (!en || !/[\u4e00-\u9fff]/.test(cn)) continue
    const type: McmodEntryType = anchor[2].toLowerCase() === 'modpack' ? 'modpack' : 'mod'
    hits.push({ entryId: anchor[3], cn, en, type })
  }
  return hits
}

/** 去掉「[BMC]」「(xxx)」标记与「xxx - yyy」后缀，整合包标题常带这些尾巴。 */
function coreName(value: string): string {
  return value
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .split(/\s+-\s+/)[0]
    .replace(/\s+/g, ' ')
    .trim()
}

function strippedKey(value: string): string {
  return normalizeModKey(coreName(value))
}

export function pickMcmodHit(hits: McmodHit[], title: string, slug: string, type?: McmodEntryType): McmodHit | null {
  const pool = type ? hits.filter((hit) => hit.type === type) : hits
  const keys = [normalizeModKey(title), normalizeModKey(slug)].filter((item) => item.length > 1)
  const exact = pool.find((hit) => keys.includes(normalizeModKey(hit.en)))
  if (exact) return exact
  const loose = [strippedKey(title), strippedKey(slug)].filter((item) => item.length > 2)
  return pool.find((hit) => {
    const en = strippedKey(hit.en)
    return en.length > 2 && loose.includes(en)
  }) ?? null
}

async function readHtml(url: string, ms = 8000): Promise<string> {
  const response = await fetch(url, { signal: AbortSignal.timeout(ms), headers: { Accept: 'text/html' } })
  if (!response.ok) throw new Error(`MC百科 HTTP ${response.status}`)
  const body = await response.text()
  if (body.length > 2 * 1024 * 1024) throw new Error('MC百科页面超出读取限制')
  return body
}

/** 带随机参数的搜索地址：搜索页约有一半概率返回「无结果」骨架页，靠重试换新响应。 */
function searchUrl(word: string): string {
  const params = new URLSearchParams({ key: word })
  params.set('t', Date.now().toString(36) + Math.random().toString(36).slice(2, 6))
  return `${SEARCH_URL}?${params.toString()}`
}

interface LookupResult {
  zh: string
  entryId: string
  type?: McmodEntryType
}

async function queryHit(
  word: string,
  title: string,
  slug: string,
  type?: McmodEntryType
): Promise<McmodHit | null> {
  return pickMcmodHit(parseMcmodSearch(await readHtml(searchUrl(word))), title, slug, type)
}

/** MC百科搜索页约有一半概率返回没有结果区的骨架页，多次重试把成功率拉高。 */
const RETRIES = 6

const pending = new Map<string, Promise<LookupResult>>()

function retryWait(attempt: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 150 * (attempt + 1)))
}

/** 用源站原名检索 MC百科，只接受英文副标题与项目名完全一致的条目。 */
export async function lookupModName(title: string, slug: string, type?: McmodEntryType): Promise<LookupResult> {
  const key = slug || title
  if (!key) return { zh: '', entryId: '' }
  const cached = readCache()[key]
  if (cached && Date.now() - cached.at < (cached.zh ? OK_TTL : MISS_TTL)) {
    return { zh: cached.zh, entryId: cached.entryId, type: cached.type }
  }
  const running = pending.get(key)
  if (running) return running
  const run = async (): Promise<LookupResult> => {
    const word = coreName(title) || slug.trim()
    let hit: McmodHit | null = null
    let reached = false
    for (let attempt = 0; attempt < RETRIES && !reached; attempt++) {
      try {
        hit = await queryHit(word, title, slug, type)
        reached = true
      } catch {
        if (attempt < RETRIES - 1) await retryWait(attempt)
      }
    }
    if (!reached) {
      writeCache(key, { zh: '', entryId: '', at: Date.now() })
      return { zh: '', entryId: '' }
    }
    const result = { zh: hit?.cn ?? '', entryId: hit?.entryId ?? '', type: hit?.type }
    writeCache(key, { ...result, at: Date.now() })
    return result
  }
  const promise = run()
  pending.set(key, promise)
  try {
    return await promise
  } finally {
    if (pending.get(key) === promise) pending.delete(key)
  }
}

const reversePending = new Map<string, Promise<string>>()

/** 用中文关键词反查源站英文名，使搜索框支持中文输入。 */
export async function reverseLookupMod(keyword: string, type: McmodEntryType): Promise<string> {
  const key = `zh:${type}:${keyword}`
  const cached = readCache()[key]
  if (cached && Date.now() - cached.at < (cached.en ? OK_TTL : MISS_TTL)) return cached.en ?? ''
  const running = reversePending.get(key)
  if (running) return running
  const run = async (): Promise<string> => {
    let hits: McmodHit[] | null = null
    for (let attempt = 0; attempt < RETRIES && !hits; attempt++) {
      try {
        hits = parseMcmodSearch(await readHtml(searchUrl(keyword)))
      } catch {
        if (attempt < RETRIES - 1) await retryWait(attempt)
      }
    }
    if (!hits) return ''
    const hit = hits.find((row) => row.cn === keyword) ?? hits.find((row) => row.type === type) ?? null
    writeCache(key, { zh: '', entryId: hit?.entryId ?? '', en: hit?.en ?? '', type, at: Date.now() })
    return hit?.en ?? ''
  }
  const promise = run()
  reversePending.set(key, promise)
  try {
    return await promise
  } finally {
    if (reversePending.get(key) === promise) reversePending.delete(key)
  }
}

export function mcmodEntryUrl(entryId: string, type: McmodEntryType = 'mod'): string {
  return entryId ? `${ENTRY_URL[type]}/${entryId}.html` : ''
}

/** 有限并发查询译名，命中即回调，用于把结果增量写回列表。 */
export async function translateNames<T>(
  items: T[],
  key: (item: T) => { title: string; slug: string; type?: McmodEntryType },
  apply: (item: T, zh: string) => void,
  limit = 3
): Promise<void> {
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor++]
      const names = key(item)
      const result = await lookupModName(names.title, names.slug, names.type)
      if (result.zh) apply(item, result.zh)
    }
  })
  await Promise.all(workers)
}
