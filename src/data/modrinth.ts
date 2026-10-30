/**
 * Modrinth 公开 API v2，开放 CORS，浏览器阶段即真实可用。
 */
import { getJson, withTimeout } from './http'
import { MODRINTH_RESOURCE_LOADERS, usesCommunityLoader } from '@shared/communityPolicy'
import type {
  CommunityFile,
  CommunityKind,
  CommunityModProject,
  CommunityQuery,
  CommunityResult,
  CommunitySearchPage,
  LoaderName
} from '@shared/types'

const BASE = 'https://api.modrinth.com/v2'

const PROJECT_TYPE: Record<CommunityKind, string> = {
  mod: 'mod',
  modpack: 'modpack',
  resourcepack: 'resourcepack',
  shader: 'shader',
  datapack: 'datapack'
}

const INDEX: Record<string, string> = { relevance: 'relevance', downloads: 'downloads', newest: 'newest' }

interface RawHit {
  project_id: string
  slug: string
  author: string
  title: string
  description: string
  categories: string[]
  display_categories?: string[]
  downloads: number
  icon_url: string | null
  date_modified: string
}

interface RawSearch {
  hits: RawHit[]
  offset: number
  limit: number
  total_hits: number
}

interface RawProject {
  id: string
  slug: string
  title: string
  description: string
  categories: string[]
  downloads: number
  followers: number
  icon_url: string | null
  updated: string
  project_type: string
  license?: { id: string; name: string }
}

interface RawFile {
  hashes: { sha1?: string }
  url: string
  filename: string
  primary: boolean
  size: number
}

interface RawDependency {
  version_id: string | null
  project_id: string | null
  dependency_type: string
}

interface RawVersion {
  id: string
  project_id: string
  version_number: string
  game_versions: string[]
  loaders: string[]
  version_type: 'release' | 'beta' | 'alpha'
  date_published: string
  files: RawFile[]
  dependencies: RawDependency[]
}

export const RESOURCE_LOADER_HINT = MODRINTH_RESOURCE_LOADERS

function facetsOf(query: CommunityQuery): string[][] {
  const groups: string[][] = [[`project_type:${PROJECT_TYPE[query.kind]}`]]
  const version = query.mcVersion?.trim()
  if (version) groups.push([`versions:${version}`])
  if (usesCommunityLoader(query.kind) && query.loader) groups.push([`categories:${query.loader}`])
  return groups
}

function mapHit(hit: RawHit): CommunityResult {
  return {
    source: 'modrinth',
    projectId: hit.project_id,
    slug: hit.slug,
    title: hit.title,
    author: hit.author,
    description: hit.description,
    iconUrl: hit.icon_url ?? '',
    downloads: hit.downloads,
    updatedAt: hit.date_modified,
    categories: hit.display_categories?.length ? hit.display_categories : hit.categories ?? []
  }
}

export async function searchModrinth(query: CommunityQuery): Promise<CommunitySearchPage> {
  const params = new URLSearchParams()
  params.set('query', query.keyword)
  params.set('limit', String(query.limit))
  params.set('offset', String(query.offset))
  params.set('index', INDEX[query.sort ?? 'relevance'] ?? 'relevance')
  params.set('facets', JSON.stringify(facetsOf(query)))
  const data = await withTimeout(
    getJson<RawSearch>(`${BASE}/search?${params.toString()}`),
    15000,
    'Modrinth 搜索超时'
  )
  return {
    items: (data.hits ?? []).map(mapHit),
    total: data.total_hits ?? 0,
    offset: data.offset ?? query.offset,
    limit: data.limit ?? query.limit
  }
}

export async function fetchModrinthProject(projectId: string): Promise<CommunityModProject> {
  const data = await withTimeout(
    getJson<RawProject>(`${BASE}/project/${encodeURIComponent(projectId)}`),
    15000,
    'Modrinth 项目请求超时'
  )
  return {
    source: 'modrinth',
    projectId: data.id,
    slug: data.slug,
    title: data.title,
    kind: 'mod',
    iconUrl: data.icon_url ?? '',
    description: data.description,
    license: data.license?.name,
    categories: data.categories ?? [],
    downloads: data.downloads,
    followers: data.followers,
    updatedAt: data.updated,
    webpage: `https://modrinth.com/project/${data.slug}`
  }
}

function mapVersion(row: RawVersion): CommunityFile {
  const primary = row.files.find((file) => file.primary) ?? row.files[0]
  return {
    source: 'modrinth' as const,
    projectId: row.project_id,
    dependencies: (row.dependencies ?? []).map((dep) => ({
      projectId: dep.project_id ?? undefined,
      fileId: dep.version_id ?? undefined,
      required: dep.dependency_type === 'required'
    })),
    fileId: row.id,
    fileName: primary?.filename ?? `${row.project_id}-${row.version_number}.jar`,
    version: row.version_number,
    url: primary?.url ?? '',
    sha1: primary?.hashes?.sha1,
    size: primary?.size ?? 0,
    releaseType: row.version_type,
    gameVersions: row.game_versions ?? [],
    loaders: row.loaders ?? [],
    date: row.date_published
  }
}

export async function fetchModrinthVersions(
  projectId: string,
  filter?: { mcVersion?: string; loader?: LoaderName | ''; kind?: CommunityKind }
): Promise<CommunityFile[]> {
  const params: string[] = []
  const version = filter?.mcVersion?.trim()
  if (version) params.push(`game_versions=${encodeURIComponent(JSON.stringify([version]))}`)
  if (usesCommunityLoader(filter?.kind) && filter?.loader) {
    params.push(`loaders=${encodeURIComponent(JSON.stringify([filter.loader]))}`)
  }
  const suffix = params.length ? `?${params.join('&')}` : ''
  const rows = await withTimeout(
    getJson<RawVersion[]>(`${BASE}/project/${encodeURIComponent(projectId)}/version${suffix}`),
    15000,
    'Modrinth 版本列表请求超时'
  )
  return (rows ?? []).map(mapVersion)
}

/** 按版本 id 精确取回文件，用于下载前置模组时锁定同一版本。 */
export async function fetchModrinthVersionById(versionId: string): Promise<CommunityFile> {
  const row = await withTimeout(
    getJson<RawVersion>(`${BASE}/version/${encodeURIComponent(versionId)}`),
    15000,
    'Modrinth 版本请求超时'
  )
  return mapVersion(row)
}

export interface ModrinthProjectBrief {
  title: string
  slug: string
  iconUrl: string
}

/** 批量取项目名，用于在文件行里展示前置模组的可读名称。 */
export async function fetchModrinthProjectBriefs(ids: string[]): Promise<Record<string, ModrinthProjectBrief>> {
  const unique = [...new Set(ids.filter((id) => !!id))]
  if (!unique.length) return {}
  const map: Record<string, ModrinthProjectBrief> = {}
  for (let index = 0; index < unique.length; index += 50) {
    const chunk = unique.slice(index, index + 50)
    const params = new URLSearchParams({ ids: JSON.stringify(chunk) })
    const rows = await withTimeout(
      getJson<RawProject[]>(`${BASE}/projects?${params.toString()}`),
      15000,
      'Modrinth 项目信息请求超时'
    )
    for (const row of rows ?? []) map[row.id] = { title: row.title, slug: row.slug, iconUrl: row.icon_url ?? '' }
  }
  return map
}

export async function downloadModrinthFile(file: CommunityFile): Promise<Blob> {
  const response = await withTimeout(fetch(file.url), 60000, '资源下载超时')
  if (!response.ok) throw new Error(`资源下载失败 ${response.status}`)
  return response.blob()
}
