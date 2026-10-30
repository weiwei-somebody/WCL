<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { copyText, errText, exportLaunchLogs, getSkinProfile, launchGame, listServers, prepareServerLaunch } from '@/api'
import { createFallbackSkin } from '@/data/fallbackSkin'
import { bridge } from '@/bridge'
import { useAccountsStore } from '@/store/accounts'
import { useLaunchStore } from '@/store/launch'
import { useSettingsStore } from '@/store/settings'
import { useToastStore } from '@/store/toasts'
import { useVersionsStore } from '@/store/versions'
import { activeCarouselKeys, carouselDuration } from '@shared/appearancePolicy'
import { clampScale } from '@shared/freeLayout'
import type { Rect } from '@shared/freeLayout'
import { cleanDesign, emptyDesign, resolveComponentDesign } from '@shared/visualDesign'
import type { ComponentDesign, VisualDesign } from '@shared/visualDesign'
import type { ProfileSkins, ServerEntry } from '@shared/types'
import SkinViewer3D from '@/components/SkinViewer3D.vue'
import DraggableCard from '@/ui/primitives/DraggableCard.vue'
import Drawer from '@/ui/primitives/Drawer.vue'
import Empty from '@/ui/primitives/Empty.vue'
import Progress from '@/ui/primitives/Progress.vue'

const HOME_W = 1224
const HOME_H = 524

const KEYS = ['home/launch', 'home/account', 'home/strip', 'home/recent', 'home/about']

const TITLES: Record<string, string> = {
  'home/launch': '启动游戏',
  'home/account': '账号与皮肤',
  'home/strip': '运行环境',
  'home/recent': '最近游戏',
  'home/about': '快速启动服务器'
}

const GAP = 24

const MIN_SIZES: Record<string, { w: number, h: number }> = {
  'home/launch': { w: 420, h: 240 },
  'home/account': { w: 260, h: 320 },
  'home/strip': { w: 300, h: 56 },
  'home/recent': { w: 420, h: 100 },
  'home/about': { w: 260, h: 88 }
}


const router = useRouter()
const versions = useVersionsStore()
const launch = useLaunchStore()
const settings = useSettingsStore()
const accounts = useAccountsStore()
const toasts = useToastStore()

const editing = ref(false)
const logsOpen = ref(false)
const skinProfile = ref<ProfileSkins | null>(null)
const skinError = ref('')
const defaultSkinUrl = ref('')
const liveRects = ref<Record<string, Rect>>({})
const wrapRef = ref<HTMLElement | null>(null)
const wrapWidth = ref(HOME_W)
const availH = ref(HOME_H)
const pickerOpen = ref(false)
const servers = ref<ServerEntry[]>([])
const serverBusy = ref('')

let observer: ResizeObserver | null = null
let saveTimer: ReturnType<typeof setTimeout> | null = null

const activeInstance = computed(() => versions.installed.find((item) => item.id === versions.activeId) ?? null)
const design = computed<VisualDesign>(() => settings.data?.visualDesign ?? emptyDesign())
const percent = computed(() => Math.round((launch.progress?.overall ?? launch.progress?.progress ?? 0) * 100))
const skinUrl = computed(() => skinProfile.value?.skins[0]?.dataUrl || defaultSkinUrl.value)
const capeUrl = computed(() => skinProfile.value?.capes.find((item) => item.active)?.dataUrl || '')
const skinVariant = computed(() => skinProfile.value?.skins[0]?.variant ?? 'classic')
const accountInitial = computed(() => (accounts.current?.username?.[0] ?? '?').toUpperCase())
const logsText = computed(() => launch.logs.join('\n'))
const narrow = computed(() => wrapWidth.value < 720)
const canvasW = computed(() => (narrow.value ? HOME_W : Math.max(HOME_W, wrapWidth.value)))
const canvasH = computed(() => (narrow.value ? HOME_H : Math.max(HOME_H, availH.value)))
const fluidRects = computed<Record<string, Rect>>(() => {
  const w = canvasW.value
  const h = canvasH.value
  const right = Math.max(320, Math.min(420, Math.round(w * 0.294)))
  const left = w - GAP - right
  const recentH = Math.max(100, Math.round(h * 0.23))
  const recentY = h - recentH
  const stripY = recentY - 92
  const launchH = Math.max(240, stripY - 16)
  return {
    'home/launch': { x: 0, y: 0, w: left, h: launchH },
    'home/account': { x: left + GAP, y: 0, w: right, h: recentY - 12 },
    'home/strip': { x: 0, y: stripY, w: left, h: 64 },
    'home/recent': { x: 0, y: recentY, w: left, h: recentH },
    'home/about': { x: left + GAP, y: recentY, w: right, h: recentH }
  }
})
const scale = computed(() => {
  const byWidth = clampScale(wrapWidth.value - 2, canvasW.value)
  const byHeight = availH.value > 0 ? Math.min(1, availH.value / canvasH.value) : 1
  return Math.max(0.5, Math.min(byWidth, byHeight))
})
const bounds = computed(() => ({ w: canvasW.value, h: canvasH.value }))
const canvasStyle = computed(() =>
  narrow.value
    ? {}
    : {
        width: `${canvasW.value}px`,
        height: `${canvasH.value}px`,
        transform: `scale(${scale.value})`,
        transformOrigin: 'top left'
      }
)
const wrapStyle = computed(() => (narrow.value ? {} : { height: `${Math.round(canvasH.value * scale.value)}px` }))
const visibleKeys = computed(() => KEYS.filter((key) => editing.value || !isHidden(key)))
const cards = computed(() => visibleKeys.value.map((key) => ({ key, title: TITLES[key] })))
const loaderLabel = computed(() => {
  const item = activeInstance.value
  if (!item?.loader) return ''
  const name = item.loader[0].toUpperCase() + item.loader.slice(1)
  return item.loaderVersion ? `${name} ${item.loaderVersion}` : name
})
/** 启动卡封面：实例自定义封面优先，否则按设置里的轮播图片依次切换 */
const heroSlide = ref('')
let heroTimer: ReturnType<typeof setInterval> | null = null
let heroIndex = 0

const heroKeys = computed(() => activeCarouselKeys(settings.data?.launchThumbnail))
const heroImage = computed(() => {
  if (bridge.kind !== 'electron') return ''
  const stored = activeInstance.value?.thumbnail || heroSlide.value
  if (!stored) return ''
  if (stored.startsWith('wcl-asset:')) return stored
  return `wcl-asset://local/?path=${encodeURIComponent(stored)}`
})
const heroFit = computed<'cover' | 'contain' | 'fill'>(() => {
  const fit = activeInstance.value?.thumbnailFit ?? settings.data?.launchThumbnail?.fit ?? 'crop'
  return fit === 'fit' ? 'contain' : fit === 'fill' ? 'fill' : 'cover'
})

function syncHero(): void {
  if (heroTimer) {
    clearInterval(heroTimer)
    heroTimer = null
  }
  const keys = heroKeys.value
  if (!keys.length) {
    heroSlide.value = ''
    return
  }
  const pick = settings.data?.launchThumbnail?.randomPlayback ? Math.floor(Math.random() * keys.length) : 0
  heroIndex = pick
  heroSlide.value = keys[pick]
  if (keys.length < 2) return
  const seconds = carouselDuration(settings.data?.launchThumbnail?.intervalSeconds)
  heroTimer = setInterval(() => {
    const list = heroKeys.value
    if (!list.length) return
    if (settings.data?.launchThumbnail?.randomPlayback) {
      heroIndex = Math.floor(Math.random() * list.length)
    } else {
      heroIndex = (heroIndex + 1) % list.length
    }
    heroSlide.value = list[heroIndex]
  }, seconds * 1000)
}
const envLabel = computed(() => (settings.data?.javaPath ? '已指定 Java' : '自动选择'))
const memoryLabel = computed(() => {
  if (settings.data?.memoryAuto !== false) return '自动'
  return `${settings.data?.memoryMB ?? 4096} MB`
})
const statusLabel = computed(() => (launch.running ? '运行中' : launch.launching ? '启动中' : '就绪'))
const accountType = computed(() => {
  const type = accounts.current?.type
  if (type === 'microsoft') return '正版账户'
  if (type === 'yggdrasil') return '外置账户'
  return '离线账户'
})
const recentGames = computed(() => {
  const list = versions.installed.filter((item) => !item.incomplete && !item.failed)
  return [...list]
    .sort((a, b) => (launch.lastPlayed[b.id] ?? 0) - (launch.lastPlayed[a.id] ?? 0) || a.id.localeCompare(b.id))
    .slice(0, 3)
})
const quickServers = computed(() =>
  [...servers.value]
    .sort((a, b) => Number(b.favorite === true) - Number(a.favorite === true) || (b.lastUsedAt ?? '').localeCompare(a.lastUsedAt ?? ''))
    .slice(0, 3)
)

function cardDesign(key: string): ComponentDesign | undefined {
  return resolveComponentDesign(design.value.pages.home?.components, key)
}

function isHidden(key: string): boolean {
  return cardDesign(key)?.hidden === true
}

function rectFor(key: string): Rect {
  const local = liveRects.value[key]
  if (local) return local
  const saved = cardDesign(key)
  if (
    typeof saved?.x === 'number' &&
    typeof saved?.y === 'number' &&
    typeof saved?.width === 'number' &&
    typeof saved?.height === 'number'
  ) {
    return { x: saved.x, y: saved.y, w: saved.width, h: saved.height }
  }
  return fluidRects.value[key]
}

function othersFor(key: string): Rect[] {
  return visibleKeys.value.filter((item) => item !== key).map((item) => rectFor(item))
}

function minWFor(key: string): number {
  return MIN_SIZES[key]?.w ?? 180
}

function minHFor(key: string): number {
  return MIN_SIZES[key]?.h ?? 80
}

async function patchCard(key: string, patch: ComponentDesign) {
  try {
    const base = cleanDesign(settings.data?.visualDesign ?? emptyDesign())
    const page = base.pages.home ?? { width: HOME_W, height: HOME_H, components: {} }
    page.components[key] = { ...(page.components[key] ?? {}), ...patch }
    base.pages.home = page
    await settings.patch({ visualDesign: base })
  } catch (error) {
    toasts.push(errText(error), 'error')
  }
}

async function persistRects() {
  try {
    const base = cleanDesign(settings.data?.visualDesign ?? emptyDesign())
    const page = base.pages.home ?? { width: HOME_W, height: HOME_H, components: {} }
    const components: Record<string, ComponentDesign> = { ...page.components }
    for (const key of Object.keys(liveRects.value)) {
      const rect = liveRects.value[key]
      components[key] = { ...(components[key] ?? {}), x: rect.x, y: rect.y, width: rect.w, height: rect.h, mode: 'free' }
    }
    page.components = components
    page.width = HOME_W
    page.height = HOME_H
    base.pages.home = page
    await settings.patch({ visualDesign: base })
  } catch (error) {
    toasts.push(errText(error), 'error')
  }
}

function onRect(key: string, rect: Rect) {
  liveRects.value = { ...liveRects.value, [key]: rect }
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => void persistRects(), 300)
}

function enterEdit() {
  editing.value = true
}

async function finishEdit() {
  editing.value = false
  if (saveTimer) clearTimeout(saveTimer)
  await persistRects()
  toasts.push('首页布局已保存', 'ok')
}

async function resetLayout() {
  try {
    await settings.patch({ visualDesign: emptyDesign() })
    liveRects.value = {}
    editing.value = false
    toasts.push('首页布局已恢复默认', 'ok')
  } catch (error) {
    toasts.push(errText(error), 'error')
  }
}

function toggleHidden(key: string) {
  void patchCard(key, { hidden: !isHidden(key) })
}

async function chooseInstance(id: string) {
  pickerOpen.value = false
  try {
    await versions.setActive(id)
  } catch (error) {
    toasts.push(errText(error), 'error')
  }
}

async function endGame() {
  try {
    await launch.kill()
    toasts.push('已请求结束游戏（模拟）', 'ok')
  } catch (error) {
    toasts.push(errText(error), 'error')
  }
}

function openInstance(id: string): void {
  router.push(`/game/${encodeURIComponent(id)}`)
}

async function launchInstance(id: string): Promise<void> {
  const instance = versions.installed.find((item) => item.id === id)
  if (!instance || launch.launching) return
  pickerOpen.value = false
  try {
    await versions.setActive(id)
    await launch.launch(instance.id, instance.folder ?? '')
    toasts.push('已发出启动请求（浏览器阶段为模拟启动）', 'ok')
  } catch (error) {
    toasts.push(errText(error), 'error')
  }
}

async function loadServers(): Promise<void> {
  try {
    servers.value = await listServers()
  } catch {
    servers.value = []
  }
}

async function joinServer(entry: ServerEntry): Promise<void> {
  if (serverBusy.value) return
  serverBusy.value = entry.id
  try {
    const prep = await prepareServerLaunch(entry.id)
    await launchGame(prep.versionId, prep.address, prep.folder)
    servers.value = servers.value.map((item) => (item.id === entry.id ? { ...item, lastUsedAt: new Date().toISOString() } : item))
    toasts.push(`已用 ${prep.versionId} 进入 ${entry.name}`, 'ok')
  } catch (error) {
    toasts.push(errText(error), 'error')
  } finally {
    serverBusy.value = ''
  }
}

async function primaryAction() {
  if (launch.launching) return
  if (launch.running) {
    await endGame()
    return
  }
  if (!activeInstance.value) {
    router.push('/game')
    return
  }
  try {
    await launch.launch(activeInstance.value.id, activeInstance.value.folder ?? '')
    toasts.push('已发出启动请求（浏览器阶段为模拟启动）', 'ok')
  } catch (error) {
    toasts.push(errText(error), 'error')
  }
}

async function exportLogs() {
  try {
    const name = await exportLaunchLogs(versions.activeId, activeInstance.value?.folder)
    toasts.push(name ? `已导出日志 ${name}` : '没有可导出的日志', name ? 'ok' : 'error')
  } catch (error) {
    toasts.push(errText(error), 'error')
  }
}

async function copyLogs() {
  if (!logsText.value) return
  await copyText(logsText.value)
  toasts.push('已复制启动日志', 'ok')
}

function measure() {
  const el = wrapRef.value
  if (!el) return
  const stage = el.closest('.stage') as HTMLElement | null
  const width = Math.round(el.clientWidth)
  const padBottom = stage ? Number.parseFloat(getComputedStyle(stage).paddingBottom) || 0 : 0
  const limit = stage
    ? stage.getBoundingClientRect().top - stage.scrollTop + stage.clientHeight - padBottom
    : window.innerHeight
  const avail = Math.round(limit - el.getBoundingClientRect().top)
  if (width && Math.abs(width - wrapWidth.value) >= 1) wrapWidth.value = width
  if (avail > 0 && Math.abs(avail - availH.value) >= 1) availH.value = avail
}

onMounted(async () => {
  defaultSkinUrl.value = createFallbackSkin().toDataURL('image/png')
  observer = new ResizeObserver(() => requestAnimationFrame(measure))
  if (wrapRef.value) observer.observe(wrapRef.value)
  window.addEventListener('resize', measure)
  measure()
  if (!settings.ready) {
    try {
      await settings.load()
    } catch (error) {
      toasts.push(errText(error), 'error')
    }
  }
  if (!accounts.ready) {
    try {
      await accounts.load()
    } catch (error) {
      toasts.push(errText(error), 'error')
    }
  }
  launch.watch()
  try {
    await versions.loadInstalled()
  } catch (error) {
    toasts.push(errText(error), 'error')
  }
  await loadServers()
  syncHero()
  try {
    skinProfile.value = await getSkinProfile()
  } catch (error) {
    skinError.value = errText(error)
  }
})

watch(
  () => JSON.stringify(settings.data?.launchThumbnail ?? null),
  () => syncHero()
)

onUnmounted(() => {
  observer?.disconnect()
  window.removeEventListener('resize', measure)
  if (saveTimer) clearTimeout(saveTimer)
  if (heroTimer) clearInterval(heroTimer)
  logsOpen.value = false
})
</script>

<template>
  <div class="home">
    <div class="home-tools">
      <button v-if="!editing" class="home-tool" @click="enterEdit">自定义布局</button>
      <template v-else>
        <button class="home-tool" @click="resetLayout">恢复默认</button>
        <button class="home-tool on" @click="finishEdit">完成</button>
      </template>
    </div>

  <div class="canvas-wrap" ref="wrapRef" :style="wrapStyle">
    <div class="canvas" :class="{ editing, narrow }" :style="canvasStyle">
      <DraggableCard
        v-for="card in cards"
        :key="card.key"
        :rect="rectFor(card.key)"
        :others="othersFor(card.key)"
        :bounds="bounds"
        :min-w="minWFor(card.key)"
        :min-h="minHFor(card.key)"
        :editing="editing && !narrow"
        :scale="scale"
        :flow="narrow"
        @update="onRect(card.key, $event)"
      >
        <section class="card block" :class="[`block-${card.key.split('/')[1]}`, { ghost: isHidden(card.key) }]">
          <header v-if="card.key === 'home/recent' || card.key === 'home/about' || editing" class="block-head">
            <span v-if="card.key === 'home/recent'" class="block-bar" />
            <span class="block-title">{{ card.title }}</span>
            <div class="grow" />
            <button v-if="card.key === 'home/recent'" class="head-btn" @click.stop="router.push('/game')">
              <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="7" height="7" rx="1.5" /><rect x="13" y="4" width="7" height="7" rx="1.5" /><rect x="4" y="13" width="7" height="7" rx="1.5" /><rect x="13" y="13" width="7" height="7" rx="1.5" /></svg>
              管理实例
            </button>
            <button v-if="card.key === 'home/about'" class="head-btn" @click.stop="router.push('/servers')">
              <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="7" rx="2" /><rect x="3" y="13" width="18" height="7" rx="2" /><path d="M7 7.5h.01M7 16.5h.01" /></svg>
              管理服务器
            </button>
            <button v-if="editing && !narrow" class="head-btn" @click.stop="toggleHidden(card.key)">
              {{ isHidden(card.key) ? '显示' : '隐藏' }}
            </button>
          </header>

          <div v-if="card.key === 'home/launch'" class="block-body launch-body">
            <div class="hero">
              <img v-if="heroImage" class="hero-img" :src="heroImage" :style="{ objectFit: heroFit }" alt="" />
              <span v-else class="hero-fallback" />
              <div class="hero-mask" />
              <div class="hero-top">
                <span class="hero-badge">当前版本</span>
                <span class="hero-name">{{ activeInstance?.id ?? '还没有可用实例' }}</span>
                <div class="hero-tags">
                  <template v-if="activeInstance">
                    <span class="hero-version">{{ activeInstance.mcVersion }}</span>
                    <span v-if="loaderLabel" class="hero-loader">{{ loaderLabel }}</span>
                  </template>
                  <span v-else class="hero-version">先到版本管理安装一个版本</span>
                </div>
              </div>
              <div class="hero-bottom">
                <div class="hero-meta">
                  <button class="hero-pill" :disabled="!activeInstance" @click="activeInstance && openInstance(activeInstance.id)">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" /></svg>
                    版本设置
                  </button>
                  <button class="hero-pill icon" :disabled="!activeInstance" @click="activeInstance && openInstance(activeInstance.id)">
                    <span class="dots">···</span>
                  </button>
                </div>
                <span v-if="launch.launching || launch.running" class="hero-note">
                  {{ launch.launching ? `启动中 ${percent}%` : '游戏运行中' }}
                </span>
                <div class="hero-play">
                  <button class="btn play" :class="{ on: launch.running }" @click="primaryAction">
                    <svg v-if="!launch.running" class="play-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5Z" /></svg>
                    <template v-if="!activeInstance">前往版本页</template>
                    <template v-else-if="launch.running">结束游戏</template>
                    <template v-else-if="launch.launching">启动中 {{ percent }}%</template>
                    <template v-else>开始游戏</template>
                  </button>
                  <button class="btn play-arrow" title="选择版本" @click="pickerOpen = true">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5" /></svg>
                  </button>
                </div>
              </div>
              <Progress v-if="launch.launching" class="hero-progress" :value="percent" />
            </div>
          </div>

          <div v-else-if="card.key === 'home/account'" class="block-body account-body">
            <div class="account-row">
              <span class="acct-avatar">{{ accountInitial }}</span>
              <div class="account-main">
                <span class="account-name">{{ accounts.current?.username ?? '未选择账号' }}</span>
                <span class="acct-state"><i class="dot" />{{ accounts.current ? accountType : '尚未登录' }}</span>
              </div>
              <button class="icon-btn" @click="router.push('/accounts')"><span class="dots">···</span></button>
            </div>
            <button class="acct-type" @click="router.push('/accounts')">
              <span class="acct-type-mark" />
              <span class="acct-type-text">{{ accounts.current ? accountType : '添加账户' }}</span>
              <svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
            </button>
            <div class="skin-head">
              <div class="skin-titles">
                <span class="skin-title">皮肤预览</span>
                <span class="skin-sub">动态角色</span>
              </div>
              <button class="icon-btn" @click="router.push('/skins')">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 1 1-3-6.7M21 4v5h-5" /></svg>
              </button>
            </div>
            <div class="skin-stage">
              <SkinViewer3D :skin="skinUrl" :cape="capeUrl" :variant="skinVariant" height="100%" />
            </div>
            <p v-if="skinError" class="page-note danger">{{ skinError }}</p>
            <button v-else class="skin-hint" @click="router.push('/skins')">
              <span>拖动可旋转 · 行走动画</span>
              <svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
            </button>
          </div>

          <div v-else-if="card.key === 'home/strip'" class="block-body strip-body">
            <button class="strip-cell" @click="router.push('/settings')">
              <svg class="strip-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h13v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Zm13 3h2a2 2 0 0 1 0 4h-2M7 4v2M11 4v2M15 4v2" /></svg>
              <span class="strip-main">
                <span class="strip-label">运行环境</span>
                <span class="strip-value">{{ envLabel }}</span>
              </span>
              <svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
            </button>
            <span class="strip-line" />
            <button class="strip-cell" @click="router.push('/settings')">
              <svg class="strip-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="2" /><path d="M9 3v2M15 3v2M9 19v2M15 19v2M3 9h2M3 15h2M19 9h2M19 15h2" /></svg>
              <span class="strip-main">
                <span class="strip-label">内存分配</span>
                <span class="strip-value">{{ memoryLabel }}</span>
              </span>
              <svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
            </button>
            <span class="strip-line" />
            <button class="strip-cell" @click="logsOpen = true">
              <svg class="strip-icon accent" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12h4l2-6 4 12 2-6h6" /></svg>
              <span class="strip-main">
                <span class="strip-label">运行状态</span>
                <span class="strip-value"><i class="dot" />{{ statusLabel }}</span>
              </span>
              <svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
            </button>
          </div>

          <div v-else-if="card.key === 'home/recent'" class="block-body recent-body">
            <div v-if="recentGames.length" class="recent-list">
              <button v-for="item in recentGames" :key="item.id" class="recent-item" @click="openInstance(item.id)">
                <span class="recent-thumb">
                  <img v-if="item.thumbnail && bridge.kind === 'electron'" :src="`wcl-asset://local/?path=${encodeURIComponent(item.thumbnail)}`" alt="" />
                </span>
                <span class="recent-main">
                  <span class="recent-name">{{ item.id }}</span>
                  <span class="recent-note">{{ item.mcVersion }}<template v-if="item.loader"> · {{ item.loader }}</template></span>
                </span>
                <span class="recent-more" @click.stop="openInstance(item.id)"><span class="dots">···</span></span>
                <span class="recent-go" @click.stop="launchInstance(item.id)">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5Z" /></svg>
                </span>
              </button>
            </div>
            <Empty v-else text="还没有玩过任何版本" note="安装一个实例后，这里会记录最近的启动。" />
          </div>

          <div v-else-if="card.key === 'home/about'" class="block-body server-body">
            <div v-if="quickServers.length" class="server-list">
              <div v-for="item in quickServers" :key="item.id" class="server-row">
                <button class="server-main" @click="joinServer(item)">
                  <span class="server-star" :class="{ on: item.favorite }">{{ item.favorite ? '★' : '·' }}</span>
                  <span class="server-text">
                    <span class="server-name">{{ item.name }}</span>
                    <span class="server-addr">{{ item.address }}</span>
                  </span>
                </button>
                <button class="server-go" :disabled="serverBusy === item.id" :title="`用 ${item.versionId || '默认实例'} 进入`" @click="joinServer(item)">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5Z" /></svg>
                </button>
              </div>
            </div>
            <Empty v-else text="还没有服务器" note="到服务器页添加后，这里可直接一键进入。" />
          </div>
        </section>
      </DraggableCard>
    </div>
  </div>
  </div>

  <Drawer :open="pickerOpen" title="选择版本" @close="pickerOpen = false">
    <div class="pick-list">
      <button
        v-for="item in versions.installed"
        :key="item.id"
        class="pick-row"
        :class="{ on: item.id === versions.activeId }"
        @click="chooseInstance(item.id)"
      >
        <span class="pick-main">
          <span class="pick-name">{{ item.id }}</span>
          <span class="pick-note">{{ item.mcVersion }}<template v-if="item.loader"> · {{ item.loader }}</template></span>
        </span>
        <span v-if="item.incomplete" class="tag approx">不完整</span>
      </button>
      <Empty v-if="!versions.installed.length" text="没有可用实例" note="前往版本管理安装一个版本。" />
    </div>
  </Drawer>

  <Drawer :open="logsOpen" title="启动日志" @close="logsOpen = false">
    <div class="log-ops">
      <button class="btn" @click="copyLogs" :disabled="!logsText">复制全部</button>
      <button class="btn" @click="exportLogs">导出日志</button>
    </div>
    <Empty v-if="!logsText" text="暂无日志" note="启动或重启一次游戏后，这里会实时输出日志。" />
    <pre v-else class="logs mono">{{ logsText }}</pre>
  </Drawer>
</template>

<style scoped>
.home {
  position: relative;
  padding-top: 4px;
}

.home-tools {
  position: absolute;
  top: -6px;
  right: 0;
  z-index: 40;
  display: flex;
  gap: 6px;
  opacity: 0.45;
  transition: opacity var(--dur) var(--ease);
}

.home-tools:hover {
  opacity: 1;
}

.home-tool {
  height: 24px;
  padding: 0 var(--space-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-xs);
  background-color: var(--surface);
  color: var(--text-dim);
  font-size: 11px;
  cursor: pointer;
  transition: border-color var(--dur) var(--ease), color var(--dur) var(--ease);
}

.home-tool:hover,
.home-tool.on {
  border-color: var(--accent-line);
  color: var(--accent);
}

.canvas-wrap {
  position: relative;
  width: 100%;
  overflow: hidden;
}

.canvas {
  position: absolute;
  top: 0;
  left: 0;
  border-radius: var(--radius);
}

.canvas.narrow {
  position: static;
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.canvas.editing {
  background-color: var(--surface-soft);
  border: 1px dashed var(--accent-line);
  border-radius: var(--radius-lg);
}

.canvas:not(.narrow) .card.block {
  transition: border-color var(--dur) var(--ease), box-shadow var(--dur) var(--ease);
}

.canvas:not(.narrow) .card.block:hover {
  border-color: var(--border-strong);
  box-shadow: inset 0 1px 0 var(--edge-hi), var(--shadow-2);
}

.block {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  height: 100%;
  overflow: hidden;
}

.block.ghost {
  opacity: 0.45;
}

.block-head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex: 0 0 auto;
  padding-bottom: 10px;
}

.block-bar {
  width: 3px;
  height: 14px;
  border-radius: 2px;
  background-color: var(--accent);
}

.block-title {
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.2px;
}

.head-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 24px;
  padding: 0 var(--space-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-xs);
  background: transparent;
  color: var(--text-dim);
  font-size: 11px;
  cursor: pointer;
  transition: border-color var(--dur) var(--ease), color var(--dur) var(--ease);
}

.head-btn:hover {
  border-color: var(--border-strong);
  color: var(--text);
}

.head-btn svg {
  width: 12px;
  height: 12px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.6;
  stroke-linejoin: round;
}

.grow {
  flex: 1;
}

.btn.tiny {
  height: 26px;
  padding: 0 var(--space-2);
  font-size: 12px;
}

.block-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.block-body > p.page-note {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.tag-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
}

/* 启动卡：封面铺满整卡，信息与按钮压在底部 */
.card.block-launch {
  padding: 0;
  overflow: hidden;
}

.card.block-strip {
  padding: 0;
  overflow: hidden;
}

.launch-body {
  overflow: hidden;
}

.hero {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-5);
  overflow: hidden;
  background-color: var(--surface-3);
}

.hero-img,
.hero-fallback {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.hero-fallback {
  background-color: var(--surface-3);
  box-shadow: inset 0 0 160px var(--accent-soft);
}

.hero-mask {
  position: absolute;
  inset: 0;
  background-color: rgba(9, 8, 7, 0.34);
}

.hero-top {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-2);
  min-width: 0;
}

.hero-badge {
  color: rgba(255, 255, 255, 0.86);
  font-size: 11px;
  letter-spacing: 0.4px;
}

.hero-name {
  font-family: var(--font-display);
  font-size: 32px;
  font-weight: 600;
  line-height: 1.1;
  letter-spacing: 0.01em;
  color: #fff;
  text-shadow: 0 2px 16px rgba(0, 0, 0, 0.55);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  max-width: 100%;
}

.hero-tags {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  min-width: 0;
}

.hero-version {
  color: rgba(255, 255, 255, 0.82);
  font-size: 13px;
}

.hero-loader {
  color: var(--accent-2);
  font-size: 12px;
  font-weight: 600;
}

.hero-bottom {
  position: relative;
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--space-3);
}

.hero-meta {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex: 0 0 auto;
}

.hero-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 36px;
  padding: 0 var(--space-4);
  border: 1px solid rgba(255, 246, 236, 0.16);
  border-radius: var(--radius-sm);
  background-color: rgba(18, 16, 14, 0.5);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  color: #f3ece4;
  font-size: 12px;
  cursor: pointer;
  transition: background-color var(--dur) var(--ease), border-color var(--dur) var(--ease);
}

.hero-pill:hover:not(:disabled) {
  background-color: rgba(30, 27, 24, 0.68);
  border-color: rgba(255, 246, 236, 0.3);
}

.hero-pill:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.hero-pill svg {
  width: 14px;
  height: 14px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.6;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.hero-pill.icon {
  width: 42px;
  padding: 0;
  justify-content: center;
}

.dots {
  letter-spacing: 1px;
  line-height: 1;
}

.hero-note {
  flex: 1;
  min-width: 0;
  align-self: center;
  padding-bottom: 2px;
  color: rgba(255, 255, 255, 0.75);
  font-size: 12px;
  text-align: right;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.hero-play {
  display: flex;
  align-items: center;
  gap: 0;
  flex: 0 0 auto;
}

.btn.play {
  width: auto;
  flex: 0 0 auto;
  min-width: 190px;
  height: 54px;
  padding: 0 var(--space-6);
  font-size: 17px;
  font-weight: 600;
  border-color: transparent;
  border-radius: var(--radius-sm) 0 0 var(--radius-sm);
  background-color: var(--accent);
  color: var(--accent-text);
  box-shadow: 0 12px 30px var(--accent-glow);
}

.btn.play:hover:not(:disabled) {
  filter: brightness(1.05);
  box-shadow: 0 16px 36px var(--accent-glow);
}

.btn.play.on {
  background-color: var(--surface-3);
  border-color: var(--border-strong);
  color: var(--danger);
  box-shadow: none;
}

.play-icon {
  width: 18px;
  height: 18px;
  fill: currentColor;
  stroke: none;
}

.btn.play-arrow {
  width: 46px;
  height: 54px;
  padding: 0;
  border-color: transparent;
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
  background-color: var(--accent);
  color: var(--accent-text);
  filter: brightness(0.9);
  box-shadow: 0 12px 30px var(--accent-glow);
}

.btn.play-arrow svg {
  width: 16px;
  height: 16px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.btn.play-arrow:hover:not(:disabled) {
  filter: brightness(1.05);
}

.hero-progress {
  position: relative;
  margin-top: var(--space-1);
}

/* 账号与皮肤卡 */
.account-body {
  gap: 10px;
  overflow: hidden;
}

.account-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex: 0 0 auto;
}

.acct-avatar {
  width: 40px;
  height: 40px;
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  border-radius: 9px;
  background-color: var(--accent);
  color: #fff;
  font-family: var(--font-display);
  font-size: 19px;
  font-weight: 700;
  box-shadow: 0 6px 18px var(--accent-glow);
}

.account-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}

.account-name {
  font-size: 15px;
  font-weight: 600;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.acct-state {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--text-mute);
  font-size: 11px;
}

.dot {
  width: 6px;
  height: 6px;
  flex: 0 0 auto;
  display: inline-block;
  border-radius: 50%;
  background-color: var(--ok);
}

.icon-btn {
  width: 26px;
  height: 26px;
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: var(--radius-xs);
  background: transparent;
  color: var(--text-mute);
  cursor: pointer;
  transition: background-color var(--dur) var(--ease), color var(--dur) var(--ease);
}

.icon-btn:hover {
  background-color: var(--surface-soft);
  color: var(--text);
}

.icon-btn svg {
  width: 14px;
  height: 14px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.6;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.acct-type {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  height: 34px;
  padding: 0 var(--space-3);
  flex: 0 0 auto;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background-color: var(--surface-soft);
  color: var(--text-dim);
  font-size: 12px;
  cursor: pointer;
  transition: border-color var(--dur) var(--ease), color var(--dur) var(--ease);
}

.acct-type:hover {
  border-color: var(--border-strong);
  color: var(--text);
}

.acct-type-mark {
  width: 14px;
  height: 14px;
  flex: 0 0 auto;
  border: 1px solid var(--text-mute);
  border-radius: 50%;
}

.acct-type-text {
  flex: 1;
  text-align: left;
}

.chev {
  width: 14px;
  height: 14px;
  flex: 0 0 auto;
  fill: none;
  stroke: var(--text-mute);
  stroke-width: 1.6;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.skin-head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex: 0 0 auto;
  margin-top: 2px;
}

.skin-titles {
  display: flex;
  flex-direction: column;
  gap: 1px;
  flex: 1;
  min-width: 0;
}

.skin-title {
  font-size: 13px;
  font-weight: 600;
}

.skin-sub {
  color: var(--text-mute);
  font-size: 11px;
}

.skin-stage {
  flex: 1;
  min-height: 120px;
  min-width: 0;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background-color: var(--surface-soft);
  overflow: hidden;
}

.canvas.narrow .skin-stage {
  height: 220px;
  flex: 0 0 auto;
}

.skin-hint {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  flex: 0 0 auto;
  width: 100%;
  padding: 0 var(--space-1);
  border: 0;
  background: transparent;
  color: var(--text-mute);
  font-size: 11px;
  text-align: left;
  cursor: pointer;
  transition: color var(--dur) var(--ease);
}

.skin-hint .chev {
  width: 12px;
  height: 12px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.6;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.skin-hint:hover {
  color: var(--text-dim);
}

/* 运行环境 / 内存 / 状态 横条 */
.strip-body {
  flex-direction: row;
  align-items: stretch;
  gap: 0;
  overflow: hidden;
}

.strip-cell {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex: 1;
  min-width: 0;
  padding: 0 var(--space-4);
  border: 0;
  background: transparent;
  color: var(--text);
  text-align: left;
  cursor: pointer;
  transition: background-color var(--dur) var(--ease);
}

.strip-cell:hover {
  background-color: var(--surface-soft);
}

.strip-line {
  width: 1px;
  flex: 0 0 1px;
  margin: var(--space-3) 0;
  background-color: var(--border);
}

.strip-icon {
  width: 18px;
  height: 18px;
  flex: 0 0 auto;
  fill: none;
  stroke: var(--text-dim);
  stroke-width: 1.6;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.strip-icon.accent {
  stroke: var(--accent);
}

.strip-main {
  display: flex;
  flex-direction: column;
  gap: 1px;
  flex: 1;
  min-width: 0;
}

.strip-label {
  color: var(--text-mute);
  font-size: 10px;
}

.strip-value {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

/* 最近游戏 */
.recent-body {
  overflow: auto;
}

.recent-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.recent-item {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background-color: var(--surface-soft);
  color: var(--text);
  text-align: left;
  cursor: pointer;
  transition: background-color var(--dur) var(--ease), border-color var(--dur) var(--ease);
}

.recent-item:hover {
  background-color: var(--accent-soft);
  border-color: var(--accent-line);
}

.recent-thumb {
  width: 36px;
  height: 36px;
  flex: 0 0 auto;
  border: 1px solid var(--border);
  border-radius: var(--radius-xs);
  background-color: var(--surface-3);
  overflow: hidden;
}

.recent-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.recent-main {
  display: flex;
  flex-direction: column;
  gap: 1px;
  flex: 1;
  min-width: 0;
}

.recent-name {
  font-size: 13px;
  font-weight: 600;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.recent-note {
  color: var(--text-mute);
  font-size: 11px;
}

.recent-more {
  width: 26px;
  height: 26px;
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  border-radius: var(--radius-xs);
  color: var(--text-mute);
  transition: background-color var(--dur) var(--ease), color var(--dur) var(--ease);
}

.recent-more:hover {
  background-color: var(--surface-soft);
  color: var(--text);
}

.recent-go {
  width: 26px;
  height: 26px;
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  border: 1px solid var(--border);
  border-radius: var(--radius-xs);
  color: var(--text-dim);
  transition: background-color var(--dur) var(--ease), border-color var(--dur) var(--ease), color var(--dur) var(--ease);
}

.recent-go svg {
  width: 12px;
  height: 12px;
  fill: currentColor;
  stroke: none;
}

.recent-go:hover {
  background-color: var(--accent-soft);
  border-color: var(--accent-line);
  color: var(--accent);
}

/* 快速启动服务器 */
.server-body {
  gap: 6px;
  overflow: hidden;
}

.server-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-height: 0;
  overflow: auto;
}

.server-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex: 0 0 auto;
  padding: 2px 4px 2px 2px;
  border-radius: var(--radius-xs);
  transition: background-color var(--dur) var(--ease);
}

.server-row:hover {
  background-color: var(--surface-soft);
}

.server-main {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex: 1;
  min-width: 0;
  padding: 4px;
  border: 0;
  background: transparent;
  color: var(--text);
  text-align: left;
  cursor: pointer;
}

.server-star {
  flex: 0 0 auto;
  width: 12px;
  color: var(--text-mute);
  font-size: 11px;
  text-align: center;
}

.server-star.on {
  color: var(--accent);
}

.server-text {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.server-name {
  overflow: hidden;
  font-size: 12px;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.server-addr {
  overflow: hidden;
  color: var(--text-mute);
  font-size: 10px;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.server-go {
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  width: 24px;
  height: 24px;
  border: 1px solid var(--border);
  border-radius: var(--radius-xs);
  background: transparent;
  color: var(--text-dim);
  cursor: pointer;
  transition: background-color var(--dur) var(--ease), border-color var(--dur) var(--ease), color var(--dur) var(--ease);
}

.server-go svg {
  width: 11px;
  height: 11px;
  fill: currentColor;
  stroke: none;
}

.server-go:hover:not(:disabled) {
  border-color: var(--accent-line);
  background-color: var(--accent-soft);
  color: var(--accent);
}

.server-go:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

/* 版本选择抽屉 */
.pick-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.pick-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface-soft);
  color: var(--text);
  text-align: left;
  cursor: pointer;
  transition: background-color var(--dur) var(--ease), border-color var(--dur) var(--ease);
}

.pick-row:hover {
  background-color: var(--surface-3);
}

.pick-row.on {
  border-color: var(--accent-line);
  background-color: var(--accent-soft);
}

.pick-main {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
  flex: 1;
}

.pick-name {
  font-size: 13px;
  font-weight: 600;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.pick-note {
  color: var(--text-mute);
  font-size: 11px;
}

.danger {
  color: var(--danger);
}

.log-ops {
  display: flex;
  gap: var(--space-2);
  margin-bottom: var(--space-3);
}

.logs {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-all;
  color: var(--text-dim);
  line-height: 1.5;
}
</style>
