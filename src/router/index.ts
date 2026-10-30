import { createRouter, createWebHashHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'

/** 与参考实现对齐的页面清单；未给出 view 的页先统一走占位组件。 */
export const pageViews: Array<{
  path: string
  label: string
  stage: string
  view?: string
  meta?: Record<string, unknown>
}> = [
  { path: '/', label: '首页', stage: 'P4', view: 'HomeView' },
  { path: '/game', label: '游戏版本', stage: 'P2', view: 'GameView' },
  { path: '/downloads', label: '下载', stage: 'P4', view: 'DownloadsView' },
  { path: '/community', label: '社区资源', stage: 'P3', view: 'CommunityView' },
  { path: '/friends', label: '联机', stage: 'P4', view: 'FriendsView' },
  { path: '/skins', label: '皮肤', stage: 'P4', view: 'SkinsView' },
  { path: '/keys', label: '默认配置', stage: 'P3' },
  { path: '/settings', label: '设置', stage: 'P1', view: 'SettingsView' },
  { path: '/accounts', label: '账号', stage: 'P1', view: 'AccountsView' },
  { path: '/mods', label: '模组', stage: 'P3', view: 'ResourceView', meta: { rel: 'mods', disable: true, kind: 'mod' } },
  { path: '/packs', label: '资源包', stage: 'P3', view: 'ResourceView', meta: { rel: 'resourcepacks', kind: 'resourcepack' } },
  { path: '/shaders', label: '光影包', stage: 'P3', view: 'ResourceView', meta: { rel: 'shaderpacks', kind: 'shader' } },
  {
    path: '/recordings',
    label: '录像',
    stage: 'P3',
    view: 'ResourceView',
    meta: { rel: 'replay_recordings', note: '存放 ReplayMod 与 Flashback 录像文件。', community: false }
  },
  {
    path: '/projections',
    label: '投影',
    stage: 'P3',
    view: 'ResourceView',
    meta: { rel: 'schematics', note: '存放 litematic / schem / nbt 投影文件。', community: false }
  },
  { path: '/bridge', label: 'MOD 面板', stage: 'P3', view: 'BridgeView' },
  { path: '/servers', label: '服务器', stage: 'P3', view: 'ServersView' }
]

const views: Record<string, () => Promise<unknown>> = {
  HomeView: () => import('@/views/HomeView.vue'),
  SettingsView: () => import('@/views/SettingsView.vue'),
  AccountsView: () => import('@/views/AccountsView.vue'),
  GameView: () => import('@/views/GameView.vue'),
  DownloadsView: () => import('@/views/DownloadsView.vue'),
  CommunityView: () => import('@/views/CommunityView.vue'),
  ResourceView: () => import('@/views/ResourceView.vue'),
  ServersView: () => import('@/views/ServersView.vue'),
  FriendsView: () => import('@/views/FriendsView.vue'),
  SkinsView: () => import('@/views/SkinsView.vue'),
  BridgeView: () => import('@/views/BridgeView.vue')
}

/** 侧栏只展示核心入口，其余页面通过各自的入口进入。 */
export const railViews = ['/', '/game', '/downloads', '/community', '/friends', '/skins', '/settings', '/accounts']

const routes: RouteRecordRaw[] = pageViews.map((page) => ({
  path: page.path,
  name: page.path === '/' ? 'home' : page.path.slice(1),
  component: page.view ? views[page.view] : () => import('@/views/PlaceholderView.vue'),
  meta: { label: page.label, stage: page.stage, ...(page.meta ?? {}) }
}))

routes.push({
  path: '/game/:id',
  name: 'instance',
  component: () => import('@/views/InstanceView.vue'),
  meta: { label: '版本设置' }
})

routes.push({
  path: '/debug/bridge',
  name: 'bridge-debug',
  component: () => import('@/views/BridgeDebugView.vue'),
  meta: { label: '桥接诊断' }
})

routes.push({ path: '/:pathMatch(.*)*', redirect: '/' })

export const router = createRouter({
  history: createWebHashHistory(),
  routes
})
