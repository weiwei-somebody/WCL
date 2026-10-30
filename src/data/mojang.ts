/**
 * Mojang 官方版本清单，浏览器可直接跨域读取。
 */
import { getJson, withTimeout } from './http'
import type { RemoteVersion } from '@shared/types'

const MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json'

interface RawManifest {
  latest: { release: string; snapshot: string }
  versions: Array<{ id: string; type: string; url: string; time: string; releaseTime: string }>
}

export async function fetchRemoteVersions(): Promise<RemoteVersion[]> {
  const data = await withTimeout(getJson<RawManifest>(MANIFEST_URL), 15000, '版本清单请求超时')
  return data.versions.map((item) => ({
    id: item.id,
    type: item.type as RemoteVersion['type'],
    url: item.url,
    releaseTime: item.releaseTime
  }))
}

export async function fetchLatestRelease(): Promise<string> {
  const data = await getJson<RawManifest>(MANIFEST_URL)
  return data.latest.release
}
