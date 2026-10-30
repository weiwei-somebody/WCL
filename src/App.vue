<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { errText } from '@/api'
import { pageViews, railViews } from '@/router'
import { useAccountsStore } from '@/store/accounts'
import { useDownloadsStore } from '@/store/downloads'
import { useSettingsStore } from '@/store/settings'
import { useToastStore } from '@/store/toasts'
import ImportDialogs from '@/components/ImportDialogs.vue'
import Toasts from '@/components/Toasts.vue'
import { bridge } from '@/bridge'
import type { Settings } from '@shared/types'

const ICONS: Record<string, string> = {
  '/': 'M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-5v-5h-4v5H5a1 1 0 0 1-1-1z',
  '/game': 'M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12L4 7.5',
  '/downloads': 'M12 4v10M8 10l4 4 4-4M5 19h14',
  '/community': 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  '/friends': 'M9 13a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1M15 11a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1',
  '/skins': 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  '/settings': 'M4 7h10M18 7h2M4 12h4M12 12h8M4 17h12M20 17h0',
  '/accounts': 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM5 20a7 7 0 0 1 14 0',
  '/debug/bridge': 'M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M18 6l-2.5 2.5M8.5 15.5L6 18'
}

const rail = computed(() => railViews.map((path) => pageViews.find((page) => page.path === path)).filter(Boolean))

const route = useRoute()
const toasts = useToastStore()
const downloads = useDownloadsStore()

function isActive(path: string): boolean {
  if (route.path === path) return true
  return path !== '/' && route.path.startsWith(`${path}/`)
}

const settings = useSettingsStore()
const accounts = useAccountsStore()

/** 多图背景每次启动轮换一张：off 取第一张，random 随机，order 按顺序取第一张 */
const bgPick = ref('')

function pickBackgroundImage(bg: NonNullable<Settings['background']>): string {
  const list = bg.images?.length ? bg.images : bg.image ? [bg.image] : []
  if (!list.length) return ''
  if (bg.switchMode === 'random') return list[Math.floor(Math.random() * list.length)]
  return list[0]
}

/** 窗口背景：设置里选图片或纯色时才渲染背景层，none 交给主题底色与系统毛玻璃 */
const backgroundStyle = computed<Record<string, string>>(() => {
  const bg = settings.data?.background
  if (!bg || bg.mode === 'none') return {}
  const opacity = String(Math.min(1, Math.max(0, bg.opacity)))
  const blur = Math.max(0, bg.blur)
  if (bg.mode === 'color') return bg.color ? { backgroundColor: bg.color, opacity } : {}
  const picked = bgPick.value || pickBackgroundImage(bg)
  if (!picked || bridge.kind !== 'electron') return {}
  const url = picked.startsWith('wcl-asset:') || picked.startsWith('builtin:') ? picked : `wcl-asset://local/?path=${encodeURIComponent(picked)}`
  const size = bg.fit === 'fill' ? '100% 100%' : bg.fit === 'fit' ? 'contain' : 'cover'
  const style: Record<string, string> = {
    backgroundImage: `url("${url}")`,
    backgroundSize: size,
    backgroundPosition: 'center',
    backgroundRepeat: 'no-repeat',
    opacity
  }
  if (blur > 0) {
    style.filter = `blur(${blur}px)`
    style.transform = 'scale(1.06)'
  }
  return style
})

/** 定义背景图时常量：只在背景支持变化时重新挑选一次，避免每帧随机跳图 */
watch(
  () => [settings.data?.background.mode, settings.data?.background.switchMode, settings.data?.background.images?.join('|'), settings.data?.background.image],
  () => {
    const bg = settings.data?.background
    bgPick.value = bg ? pickBackgroundImage(bg) : ''
  },
  { immediate: true }
)

/** 运行中按 switchIntervalSec 自动轮换背景 */
let bgTimer: ReturnType<typeof setInterval> | null = null

function syncBgTimer(): void {
  if (bgTimer) {
    clearInterval(bgTimer)
    bgTimer = null
  }
  const bg = settings.data?.background
  const list = bg?.images ?? []
  if (!bg || bg.mode !== 'image' || bg.switchMode === 'off' || list.length < 2) return
  const seconds = Math.max(30, bg.switchIntervalSec ?? 300)
  let index = Math.max(0, list.indexOf(bgPick.value))
  bgTimer = setInterval(() => {
    index = (index + 1) % list.length
    bgPick.value = list[index]
  }, seconds * 1000)
}

watch(
  () => [settings.data?.background.mode, settings.data?.background.switchMode, settings.data?.background.switchIntervalSec, settings.data?.background.images?.join('|')],
  () => syncBgTimer(),
  { immediate: true }
)

/** 桌面版窗口是无边框的，标题栏拖拽区与窗口按钮由渲染层提供；浏览器版不显示 */
const isDesktop = bridge.kind === 'electron'
const dropping = ref(false)

function sendWindow(channel: string): void {
  if (isDesktop) bridge.send(channel)
}

/** 拖入整合包/存档：桌面端由 preload 取真实路径后回传，浏览器端用文件名走模拟流程。 */
function hasFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files')
}

function onDragOver(event: DragEvent): void {
  if (!hasFiles(event)) return
  event.preventDefault()
  dropping.value = true
}

function onDrop(event: DragEvent): void {
  if (isDesktop) return
  if (!hasFiles(event)) return
  event.preventDefault()
  dropping.value = false
  const file = event.dataTransfer?.files?.[0]
  if (!file) return
  void openImport(file.name)
}

async function openImport(path: string) {
  try {
    await downloads.openImport(path)
  } catch (error) {
    toasts.push(errText(error), 'error')
  }
}

let offDropped: (() => void) | undefined

onBeforeUnmount(() => {
  offDropped?.()
  if (bgTimer) clearInterval(bgTimer)
})

onMounted(async () => {
  if (isDesktop) {
    offDropped = bridge.on('wcl:files-dropped', (payload) => {
      dropping.value = false
      const paths = Array.isArray(payload) ? (payload as string[]) : []
      if (paths.length) void openImport(paths[0])
    })
  }
  settings.applyTheme()
  try {
    await settings.load()
  } catch (error) {
    console.error('[wcl] 设置加载失败', error)
  }
  try {
    await accounts.load()
  } catch (error) {
    console.error('[wcl] 账号加载失败', error)
  }
})
</script>

<template>
  <div class="app-shell" @dragover="onDragOver" @dragleave="dropping = false" @drop="onDrop">
    <div v-if="Object.keys(backgroundStyle).length" class="bg-layer" :style="backgroundStyle" />
    <aside class="rail">
      <div class="rail-brand">WCL</div>
      <RouterLink
        v-for="item in rail"
        :key="item!.path"
        :to="item!.path"
        class="rail-item"
        :class="{ active: isActive(item!.path) }"
        :title="item!.label"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path :d="ICONS[item!.path]" />
        </svg>
        <span v-if="item!.path === '/downloads' && downloads.jobs.length" class="rail-badge">
          {{ downloads.jobs.length }}
        </span>
      </RouterLink>
      <div class="rail-spacer" />
      <RouterLink to="/debug/bridge" class="rail-item" :class="{ active: route.path === '/debug/bridge' }" title="桥接诊断">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path :d="ICONS['/debug/bridge']" />
        </svg>
      </RouterLink>
      <button
        class="rail-item"
        :title="settings.theme === 'dark' ? '切换到浅色主题' : '切换到深色主题'"
        @click="settings.setTheme(settings.theme === 'dark' ? 'light' : 'dark')"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path v-if="settings.theme === 'dark'" d="M20 14a8 8 0 0 1-10-10 8 8 0 1 0 10 10z" />
          <path v-else d="M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 2v2M12 20v2M4 12H2M22 12h-2M5 5L3.5 3.5M20.5 20.5L19 19M19 5l1.5-1.5M3.5 20.5L5 19" />
        </svg>
      </button>
    </aside>
    <div class="layer">
      <header v-if="isDesktop" class="titlebar" @dblclick="sendWindow('window:maximize')">
        <button class="titlebar-btn" title="最小化" @click="sendWindow('window:minimize')">
          <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round">
            <path d="M2.5 6h7" />
          </svg>
        </button>
        <button class="titlebar-btn" title="最大化 / 还原" @click="sendWindow('window:maximize')">
          <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 3h6v6H3z" />
          </svg>
        </button>
        <button class="titlebar-btn close" title="关闭" @click="sendWindow('window:close')">
          <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round">
            <path d="M3 3l6 6M9 3l-6 6" />
          </svg>
        </button>
      </header>
      <main class="stage">
        <RouterView />
      </main>
    </div>
    <div v-if="dropping" class="drop-veil">松开以导入整合包 / 存档</div>
    <ImportDialogs />
    <Toasts />
  </div>
</template>

