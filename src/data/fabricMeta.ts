/**
 * 加载器版本源：Fabric / Quilt 官方 meta，Forge / NeoForge 官方 maven。
 * 前两者开放 CORS，后两者若取不到则返回空数组，由 UI 降级。
 */
import { getJson, withTimeout } from './http'
import { fetchModrinthVersions } from './modrinth'
import type { FabricApiVersion, LoaderName } from '@shared/types'

const FABRIC_API_PROJECT = 'P7dR8mSH'

interface FabricLoaderRow {
  loader: { version: string; stable: boolean }
}

interface QuiltLoaderRow {
  loader: { version: string }
}

export async function listLoaderVersions(loader: LoaderName, mc: string): Promise<string[]> {
  const version = mc.trim()
  if (!version) return []
  if (loader === 'fabric') {
    const rows = await withTimeout(
      getJson<FabricLoaderRow[]>(`https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(version)}`),
      15000,
      'Fabric 加载器列表超时'
    )
    return rows.map((row) => row.loader.version)
  }
  if (loader === 'quilt') {
    const rows = await withTimeout(
      getJson<QuiltLoaderRow[]>(`https://meta.quiltmc.org/v3/versions/loader/${encodeURIComponent(version)}`),
      15000,
      'Quilt 加载器列表超时'
    )
    return rows.map((row) => row.loader.version)
  }
  if (loader === 'forge') {
    const table = await withTimeout(
      getJson<Record<string, string[]>>('https://files.minecraftforge.net/net/minecraftforge/forge/maven-metadata.json'),
      15000,
      'Forge 加载器列表超时'
    )
    return (table[version] ?? []).slice().reverse()
  }
  const rows = await withTimeout(
    getJson<{ versions: string[] }>('https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge'),
    15000,
    'NeoForge 加载器列表超时'
  )
  return (rows.versions ?? [])
    .filter((item) => item.startsWith(`${version}.`) || item === version)
    .reverse()
}

export async function listFabricApiVersions(mc: string): Promise<FabricApiVersion[]> {
  const files = await fetchModrinthVersions(FABRIC_API_PROJECT, { mcVersion: mc, loader: 'fabric', kind: 'mod' })
  return files
    .filter((file) => file.gameVersions.length === 1 && file.gameVersions[0] === mc)
    .map((file) => ({ version: file.version, date: file.date }))
}
