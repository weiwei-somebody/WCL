/**
 * "功能不砍"清单：把全部通道按业务域归口到具体页面与实施阶段，
 * 作为后续阶段的验收对照表，也用于诊断页展示各域实现进度。
 * 参考实现的页面划分见 KMCL 的 views/ 与 App.vue 的资源管理分组。
 */
export interface FeatureDomain {
  key: string
  label: string
  page: string
  stage: string
}

export const featureDomains: FeatureDomain[] = [
  { key: 'settings', label: '设置项读写', page: '设置页', stage: 'P1' },
  { key: 'appearance', label: '外观与主题', page: '设置页', stage: 'P1' },
  { key: 'app', label: '系统信息与文件选择', page: '设置页', stage: 'P1' },
  { key: 'accounts', label: '账号与登录', page: '账号页', stage: 'P1' },
  { key: 'java', label: 'Java 探测与管理', page: '设置页', stage: 'P1' },
  { key: 'versions', label: '版本与实例', page: '游戏版本页', stage: 'P2' },
  { key: 'folders', label: '游戏文件夹管理', page: '游戏版本页', stage: 'P2' },
  { key: 'gameDir', label: '游戏目录迁移', page: '设置页', stage: 'P2' },
  { key: 'loaders', label: '模组加载器查询', page: '安装向导', stage: 'P2' },
  { key: 'fabricApi', label: 'Fabric API 查询', page: '安装向导', stage: 'P2' },
  { key: 'modpack', label: '整合包导入', page: '游戏版本页', stage: 'P2' },
  { key: 'import', label: '导入探测', page: '游戏版本页', stage: 'P2' },
  { key: 'world', label: '世界存档导入', page: '游戏版本页', stage: 'P2' },
  { key: 'game', label: '游戏启动与结束', page: '首页/游戏页', stage: 'P2' },
  { key: 'launch', label: '启动日志导出', page: '游戏页', stage: 'P2' },
  { key: 'tasks', label: '后台任务控制', page: '顶栏进度', stage: 'P2' },
  { key: 'exitHistory', label: '退出历史', page: '首页', stage: 'P2' },
  { key: 'community', label: '社区资源搜索与安装', page: '社区资源页', stage: 'P3' },
  { key: 'mods', label: '模组管理', page: '模组页', stage: 'P3' },
  { key: 'plugins', label: '插件系统', page: '设置页', stage: 'P3' },
  { key: 'keys', label: '默认按键', page: '默认配置页', stage: 'P3' },
  { key: 'gameOptions', label: '默认游戏选项', page: '默认配置页', stage: 'P3' },
  { key: 'defaultPacks', label: '默认资源包', page: '默认配置页', stage: 'P3' },
  { key: 'servers', label: '服务器列表', page: '服务器页', stage: 'P3' },
  { key: 'bridge', label: '桥接 MOD 配置面板', page: 'MOD 面板页', stage: 'P3' },
  { key: 'center', label: '实例中心', page: '实例中心', stage: 'P3' },
  { key: 'fs', label: '实例文件管理', page: '实例中心', stage: 'P3' },
  { key: 'skin', label: '皮肤与披风', page: '皮肤页', stage: 'P4' },
  { key: 'direct', label: '直连联机', page: '联机页', stage: 'P4' },
  { key: 'voxlink', label: '联机大厅', page: '联机页', stage: 'P4' },
  { key: 'tc', label: '内网穿透', page: '联机页', stage: 'P4' },
  { key: 'frp', label: 'FRP 隧道', page: '联机页', stage: 'P4' },
  { key: 'update', label: '启动器自更新', page: '设置页', stage: 'P5' }
]

export function domainOf(channel: string): string {
  return channel.split(':')[0] ?? ''
}

export function domainsFor(channels: string[]): Array<{ domain: FeatureDomain; total: number; done: number; chains: string[] }> {
  const buckets = new Map<string, string[]>()
  for (const channel of channels) {
    const key = domainOf(channel)
    const list = buckets.get(key)
    if (list) list.push(channel)
    else buckets.set(key, [channel])
  }
  const result: Array<{ domain: FeatureDomain; total: number; done: number; chains: string[] }> = []
  for (const domain of featureDomains) {
    const chains = buckets.get(domain.key) ?? []
    result.push({ domain, total: chains.length, done: 0, chains })
  }
  for (const [key, chains] of buckets) {
    if (featureDomains.some((domain) => domain.key === key)) continue
    result.push({ domain: { key, label: key, page: '待归口', stage: '—' }, total: chains.length, done: 0, chains })
  }
  return result
}
