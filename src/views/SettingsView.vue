<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { settingsCatalog, settingsCategories, settingsScopes } from '@shared/settingsCatalog'
import type { SettingsCategory, SettingsScope } from '@shared/settingsCatalog'
import type { Settings } from '@shared/types'
import type { JavaInfo, PluginInfo } from '@shared/types'
import {
  errText,
  importBackground,
  importBackgroundMulti,
  importLaunchThumbnail,
  installPlugin,
  listJava,
  listPlugins,
  openPluginsDir,
  pickAddJava,
  refreshJava,
  removePlugin,
  resetBackground,
  resetLaunchThumbnail,
  selectDir,
  setPluginEnabled
} from '@/api'
import { bridge } from '@/bridge'
import { useSettingsStore } from '@/store/settings'
import { useToastStore } from '@/store/toasts'
import Field from '@/ui/primitives/Field.vue'
import Pick from '@/ui/primitives/Pick.vue'
import Skeleton from '@/ui/primitives/Skeleton.vue'
import TextInput from '@/ui/primitives/TextInput.vue'
import Toggle from '@/ui/primitives/Toggle.vue'

const settings = useSettingsStore()
const toasts = useToastStore()
const isDesktop = bridge.kind === 'electron'
const javas = ref<JavaInfo[]>([])
const plugins = ref<PluginInfo[]>([])
const busy = ref(false)

const scope = ref<SettingsScope>('launcher')
const category = ref<SettingsCategory>('appearance')
const query = ref('')

const categories = computed(() => settingsCategories.filter((item) => item.scope === scope.value))

const matched = computed(() => {
  const text = query.value.trim().toLowerCase()
  if (!text) return null
  return settingsCatalog.filter((item) => `${item.name} ${item.keywords}`.toLowerCase().includes(text))
})

const items = computed(() =>
  (matched.value ?? settingsCatalog.filter((item) => item.category === category.value)).map((item) => ({
    ...item,
    owner: settingsCategories.find((entry) => entry.id === item.category)
  }))
)

const data = computed(() => settings.data)

const themeOptions = [
  { value: 'dark', label: '深色' },
  { value: 'light', label: '浅色' },
  { value: 'auto', label: '跟随系统' }
]

const mirrorOptions = [
  { value: 'official', label: '官方源' },
  { value: 'bmclapi', label: 'BMCLAPI 镜像' }
]

const modeOptions = [
  { value: 'windowed', label: '窗口化' },
  { value: 'borderless', label: '无边框' },
  { value: 'fullscreen', label: '全屏' }
]

const bgModeOptions = [
  { value: 'none', label: '跟随主题' },
  { value: 'color', label: '纯色' },
  { value: 'image', label: '自定义图片' }
]

const fitOptions = [
  { value: 'crop', label: '裁切铺满' },
  { value: 'fill', label: '拉伸铺满' },
  { value: 'fit', label: '完整显示' }
]

const switchOptions = [
  { value: 'off', label: '固定第一张' },
  { value: 'order', label: '按顺序' },
  { value: 'random', label: '随机' }
]

const sourceOptions = [
  { value: 'auto', label: '自动（直连优先，镜像兜底）' },
  { value: 'direct', label: '仅直连' },
  { value: 'mirror', label: '仅自定义镜像' }
]

const featureToggles = [
  { key: 'mods', label: '模组' },
  { key: 'packs', label: '资源包' },
  { key: 'shaders', label: '光影包' },
  { key: 'servers', label: '服务器' },
  { key: 'skins', label: '皮肤' },
  { key: 'community', label: '社区资源' }
]

function pickScope(next: SettingsScope) {
  scope.value = next
  query.value = ''
  const first = settingsCategories.find((item) => item.scope === next)
  if (first) category.value = first.id
}

function pickCategory(next: SettingsCategory) {
  category.value = next
  query.value = ''
}

async function update(part: Partial<Settings>) {
  try {
    await settings.patch(part)
  } catch (error) {
    toasts.push(errText(error), 'error')
  }
}

async function updateColor(key: string, value: string) {
  const current = data.value
  if (!current) return
  await update({ custom: { ...current.custom, colors: { ...current.custom.colors, [key]: value } } })
}

async function updateRadius(value: number) {
  const current = data.value
  if (!current) return
  await update({ custom: { ...current.custom, layout: { ...current.custom.layout, radius: value } } })
}

async function updateResolution(key: 'width' | 'height', value: number) {
  const current = data.value
  if (!current) return
  await update({ resolution: { ...current.resolution, [key]: value } })
}

function toggleFeature(key: string, on: boolean) {
  const list = data.value?.disabledFeatures ?? []
  update({ disabledFeatures: on ? list.filter((entry) => entry !== key) : [...list, key] })
}

async function pickGameDir() {
  try {
    const dir = await selectDir()
    if (dir) {
      await update({ gameDir: dir })
      toasts.push('默认下载位置已更新', 'ok')
    } else {
      toasts.push('浏览器模式无法选择本地目录，请在桌面版中操作', 'error')
    }
  } catch (error) {
    toasts.push(errText(error), 'error')
  }
}

async function afterChange(run: () => Promise<Settings | null>, okText: string) {
  if (busy.value) return
  busy.value = true
  try {
    const saved = await run()
    if (!saved) {
      toasts.push('浏览器模式无法读取本地文件，请在桌面版中操作', 'error')
      return
    }
    await settings.load()
    toasts.push(okText, 'ok')
  } catch (error) {
    toasts.push(errText(error), 'error')
  } finally {
    busy.value = false
  }
}

function pickBackground(multi: boolean) {
  afterChange(multi ? importBackgroundMulti : importBackground, multi ? '已添加背景图' : '背景图已更新')
}

function clearBackground() {
  afterChange(resetBackground, '已恢复主题背景')
}

function pickThumbnail() {
  afterChange(importLaunchThumbnail, '启动卡缩略图已更新')
}

function clearThumbnail() {
  afterChange(resetLaunchThumbnail, '已恢复默认缩略图')
}

async function loadJava() {
  try {
    javas.value = await listJava()
  } catch (error) {
    toasts.push(errText(error), 'error')
  }
}

async function scanJava() {
  if (busy.value) return
  busy.value = true
  try {
    javas.value = await refreshJava(true)
    toasts.push(`已检测到 ${javas.value.length} 个 Java`, 'ok')
  } catch (error) {
    toasts.push(errText(error), 'error')
  } finally {
    busy.value = false
  }
}

async function addJava() {
  try {
    const list = await pickAddJava()
    if (list) {
      javas.value = list
      toasts.push('已添加 Java', 'ok')
    }
  } catch (error) {
    toasts.push(errText(error), 'error')
  }
}

async function loadPlugins() {
  try {
    plugins.value = await listPlugins()
  } catch (error) {
    toasts.push(errText(error), 'error')
  }
}

async function installPl() {
  try {
    plugins.value = await installPlugin()
    toasts.push('插件已导入', 'ok')
  } catch (error) {
    toasts.push(errText(error), 'error')
  }
}

async function togglePl(item: PluginInfo, enabled: boolean) {
  try {
    plugins.value = await setPluginEnabled(item.id, enabled)
  } catch (error) {
    toasts.push(errText(error), 'error')
  }
}

async function removePl(item: PluginInfo) {
  if (!window.confirm(`删除插件「${item.name}」？`)) return
  try {
    plugins.value = await removePlugin(item.id)
    toasts.push('插件已删除', 'ok')
  } catch (error) {
    toasts.push(errText(error), 'error')
  }
}

async function openPlDir() {
  try {
    await openPluginsDir()
  } catch (error) {
    toasts.push(errText(error), 'error')
  }
}

onMounted(async () => {
  if (!settings.ready) await settings.load()
  if (isDesktop) {
    await loadJava()
    await loadPlugins()
  }
})
</script>

<template>
  <div class="page-head">
    <h1 class="page-title">设置</h1>
    <span class="page-note">共 {{ settingsCatalog.length }} 组设置项 · 改动即时保存</span>
  </div>

  <div class="scope-row">
    <button
      v-for="item in settingsScopes"
      :key="item.id"
      class="btn"
      :class="{ primary: scope === item.id }"
      @click="pickScope(item.id)"
    >
      {{ item.label }}
    </button>
    <input v-model="query" class="search" placeholder="搜索设置项" />
  </div>

  <div class="layout">
    <aside class="cats">
      <button
        v-for="item in categories"
        :key="item.id"
        class="cat"
        :class="{ active: category === item.id && !query }"
        @click="pickCategory(item.id)"
      >
        {{ item.label }}
      </button>
    </aside>

    <section class="body">
      <Skeleton v-if="!data" :rows="6" />
      <template v-else>
        <div v-for="item in items" :key="item.id" class="card">
          <h2 class="cat-title">
            {{ item.name }}
            <span v-if="query" class="tag">{{ item.owner?.label }}</span>
          </h2>

          <template v-if="item.id === 'theme'">
            <Field title="主题模式" note="深色为默认，跟随系统会读取系统偏好">
              <Pick
                :model-value="data.wclTheme ?? 'dark'"
                :options="themeOptions"
                @update:model-value="(value) => settings.setTheme(value as 'dark' | 'light' | 'auto')"
              />
            </Field>
            <Field title="强调色" note="按钮与高亮使用的主色，改动立即生效">
              <input
                class="color"
                type="color"
                :value="data.custom.colors.accent"
                @input="updateColor('accent', ($event.target as HTMLInputElement).value)"
              />
            </Field>
            <Field title="圆角" :note="`当前 ${data.custom.layout.radius}px`">
              <input
                class="range"
                type="range"
                min="0"
                max="24"
                step="1"
                :value="data.custom.layout.radius"
                @input="updateRadius(Number(($event.target as HTMLInputElement).value))"
              />
            </Field>
          </template>

          <template v-else-if="item.id === 'background'">
            <Field title="背景模式" note="跟随主题会使用内置极光背景">
              <Pick
                :model-value="data.background.mode"
                :options="bgModeOptions"
                @update:model-value="(value) => update({ background: { ...data!.background, mode: value as Settings['background']['mode'] } })"
              />
            </Field>
            <Field v-if="data.background.mode === 'color'" title="背景颜色">
              <input
                class="color"
                type="color"
                :value="data.background.color"
                @input="update({ background: { ...data!.background, color: ($event.target as HTMLInputElement).value } })"
              />
            </Field>
            <Field v-if="data.background.mode === 'image'" title="背景图片" :note="data.background.image || '尚未导入'">
              <div class="btn-row">
                <button class="btn" :disabled="busy" @click="pickBackground(false)">{{ busy ? '导入中…' : '选择图片' }}</button>
                <button class="btn" :disabled="busy" @click="pickBackground(true)">批量添加</button>
                <button class="btn" :disabled="busy" @click="clearBackground">恢复默认</button>
              </div>
            </Field>
            <Field title="不透明度" :note="`当前 ${Math.round(data.background.opacity * 100)}%`">
              <input
                class="range"
                type="range"
                min="0"
                max="100"
                step="1"
                :value="Math.round(data.background.opacity * 100)"
                @input="update({ background: { ...data!.background, opacity: Number(($event.target as HTMLInputElement).value) / 100 } })"
              />
            </Field>
            <Field title="模糊强度" :note="`当前 ${data.background.blur}px`">
              <input
                class="range"
                type="range"
                min="0"
                max="40"
                step="1"
                :value="data.background.blur"
                @input="update({ background: { ...data!.background, blur: Number(($event.target as HTMLInputElement).value) } })"
              />
            </Field>
            <Field title="填充方式">
              <Pick
                :model-value="data.background.fit"
                :options="fitOptions"
                @update:model-value="(value) => update({ background: { ...data!.background, fit: value as Settings['background']['fit'] } })"
              />
            </Field>
            <Field title="多图切换" note="每次启动轮换一张背景">
              <Pick
                :model-value="data.background.switchMode ?? 'off'"
                :options="switchOptions"
                @update:model-value="(value) => update({ background: { ...data!.background, switchMode: value as 'off' | 'order' | 'random' } })"
              />
            </Field>
          </template>

          <template v-else-if="item.id === 'thumbnail'">
            <Field title="首页启动卡图片" :note="data.launchThumbnail.image || '使用内置轮播图'">
              <div class="btn-row">
                <button class="btn" :disabled="busy" @click="pickThumbnail">选择图片</button>
                <button class="btn" :disabled="busy" @click="clearThumbnail">恢复默认</button>
              </div>
            </Field>
            <Field title="切换间隔（秒）" note="内置轮播的停留时长，1-120">
              <input
                class="num"
                type="number"
                min="1"
                max="120"
                :value="data.launchThumbnail.intervalSeconds ?? 8"
                @input="update({ launchThumbnail: { ...data!.launchThumbnail, intervalSeconds: Number(($event.target as HTMLInputElement).value) } })"
              />
            </Field>
            <Field title="随机顺序" note="不修改已保存的显示顺序">
              <Toggle
                :model-value="data.launchThumbnail.randomPlayback === true"
                @update:model-value="(value) => update({ launchThumbnail: { ...data!.launchThumbnail, randomPlayback: value } })"
              />
            </Field>
          </template>

          <template v-else-if="item.id === 'motion'">
            <Field title="减少动态效果" note="关闭过渡与动画，适合对动效敏感的场景">
              <Toggle
                :model-value="data.reduceMotion === true"
                @update:model-value="(value) => update({ reduceMotion: value })"
              />
            </Field>
          </template>

          <template v-else-if="item.id === 'ui-window-fit'">
            <Field title="UI 窗口自适应" note="仅在桌面端窗口过小时压缩布局">
              <Toggle
                :model-value="data.uiWindowAutoFit === true"
                @update:model-value="(value) => update({ uiWindowAutoFit: value })"
              />
            </Field>
          </template>

          <template v-else-if="item.id === 'launch'">
            <Field title="启动游戏后关闭启动器">
              <Toggle
                :model-value="data.closeAfterLaunch"
                @update:model-value="(value) => update({ closeAfterLaunch: value })"
              />
            </Field>
            <Field title="微软登录 Client ID" note="device code 登录使用的 Azure 应用 ID">
              <TextInput
                :model-value="data.msClientId"
                @update:model-value="(value) => update({ msClientId: value })"
              />
            </Field>
            <Field title="正版登录使用系统代理" note="默认直连，直连失败时再开启">
              <Toggle
                :model-value="data.msUseProxy === true"
                @update:model-value="(value) => update({ msUseProxy: value })"
              />
            </Field>
            <Field title="默认按键同步" note="启动时把启动器默认键位写入实例 options.txt">
              <Toggle
                :model-value="data.keySync === true"
                @update:model-value="(value) => update({ keySync: value })"
              />
            </Field>
            <Field title="默认资源包同步" note="启动时把默认资源包复制到实例目录">
              <Toggle
                :model-value="data.resourcePackSync === true"
                @update:model-value="(value) => update({ resourcePackSync: value })"
              />
            </Field>
          </template>

          <template v-else-if="item.id === 'installation'">
            <Field title="默认下载位置" :note="data.gameDir">
              <button class="btn" @click="pickGameDir">选择目录</button>
            </Field>
          </template>

          <template v-else-if="item.id === 'downloads'">
            <Field title="下载并发线程" note="跨任务统一的 HTTP 并发上限">
              <input
                class="num"
                type="number"
                min="1"
                max="128"
                :value="data.downloadThreads"
                @input="update({ downloadThreads: Number(($event.target as HTMLInputElement).value) })"
              />
            </Field>
            <Field title="合计限速（KiB/s）" note="0 表示不限速">
              <input
                class="num"
                type="number"
                min="0"
                :value="data.downloadSpeedKBps"
                @input="update({ downloadSpeedKBps: Number(($event.target as HTMLInputElement).value) })"
              />
            </Field>
            <Field title="CurseForge API Key" note="留空时走镜像兜底">
              <TextInput
                :model-value="data.curseforgeApiKey ?? ''"
                placeholder="未填写"
                @update:model-value="(value) => update({ curseforgeApiKey: value })"
              />
            </Field>
          </template>

          <template v-else-if="item.id === 'mirror'">
            <Field title="下载镜像">
              <Pick
                :model-value="data.mirror"
                :options="mirrorOptions"
                @update:model-value="(value) => update({ mirror: value as Settings['mirror'] })"
              />
            </Field>
          </template>

          <template v-else-if="item.id === 'features'">
            <Field
              v-for="entry in featureToggles"
              :key="entry.key"
              :title="entry.label"
              note="关闭后侧栏入口隐藏"
            >
              <Toggle
                :model-value="!(data.disabledFeatures ?? []).includes(entry.key)"
                @update:model-value="(value) => toggleFeature(entry.key, value)"
              />
            </Field>
          </template>

          <template v-else-if="item.id === 'plugins'">
            <Field title="已安装插件" :note="plugins.length ? `共 ${plugins.length} 个` : '尚未安装插件'">
              <div class="btn-row">
                <button class="btn" @click="installPl">导入插件</button>
                <button class="btn" @click="openPlDir">打开插件目录</button>
              </div>
            </Field>
            <div v-for="plugin in plugins" :key="plugin.id" class="pl-row">
              <div class="pl-main">
                <span class="pl-name">{{ plugin.name }}</span>
                <span class="tag">v{{ plugin.version }}</span>
                <span class="pl-author">{{ plugin.author }}</span>
              </div>
              <p class="pl-desc">{{ plugin.description }}</p>
              <div class="pl-actions">
                <Toggle :model-value="plugin.enabled" @update:model-value="(value) => togglePl(plugin, value)" />
                <button class="btn ghost" @click="removePl(plugin)">删除</button>
              </div>
            </div>
          </template>

          <template v-else-if="item.id === 'update'">
            <Field title="当前版本" note="WCL 0.2.0">
              <span class="tag real">已是最新</span>
            </Field>
            <Field title="启动器自更新" note="启动后自动检查新版本，确认后下载并重启">
              <span class="tag">自动更新</span>
            </Field>
          </template>

          <template v-else-if="item.id === 'memory'">
            <Field title="自动分配内存" note="按物理内存比例自动计算">
              <Toggle
                :model-value="data.memoryAuto === true"
                @update:model-value="(value) => update({ memoryAuto: value })"
              />
            </Field>
            <Field title="手动内存（MB）" :note="data.memoryAuto === true ? '自动模式下忽略此值' : ''">
              <input
                class="num"
                type="number"
                min="512"
                step="256"
                :disabled="data.memoryAuto === true"
                :value="data.memoryMB"
                @input="update({ memoryMB: Number(($event.target as HTMLInputElement).value) })"
              />
            </Field>
          </template>

          <template v-else-if="item.id === 'java'">
            <Field title="Java 运行时" :note="isDesktop ? '自动检测版本所需 Java，缺失时下载' : '桌面版可扫描本机 Java'">
              <div class="btn-row">
                <button class="btn" :disabled="busy" @click="scanJava">{{ busy ? '扫描中…' : '重新扫描' }}</button>
                <button class="btn" @click="addJava">手动添加</button>
              </div>
            </Field>
            <div v-for="java in javas" :key="java.path" class="java-row">
              <span class="java-ver">Java {{ java.major }}</span>
              <span class="java-meta">{{ java.version }}</span>
              <span class="tag">{{ java.is64Bit ? '64 位' : '32 位' }}</span>
              <span class="java-path">{{ java.path }}</span>
              <button
                class="btn ghost"
                :disabled="data.javaPath === java.path"
                @click="update({ javaPath: java.path })"
              >
                {{ data.javaPath === java.path ? '已指定' : '使用' }}
              </button>
            </div>
            <Field title="指定 Java 路径" note="留空表示自动">
              <TextInput
                :model-value="data.javaPath"
                placeholder="自动"
                @update:model-value="(value) => update({ javaPath: value })"
              />
            </Field>
          </template>

          <template v-else-if="item.id === 'jvm'">
            <Field title="JVM 参数" stacked note="高级参数，谨慎修改">
              <TextInput
                :model-value="data.jvmArgs"
                placeholder="-XX:+UseG1GC"
                @update:model-value="(value) => update({ jvmArgs: value })"
              />
            </Field>
          </template>

          <template v-else-if="item.id === 'resolution'">
            <Field title="窗口宽度">
              <input
                class="num"
                type="number"
                min="320"
                :value="data.resolution.width"
                @input="updateResolution('width', Number(($event.target as HTMLInputElement).value))"
              />
            </Field>
            <Field title="窗口高度">
              <input
                class="num"
                type="number"
                min="240"
                :value="data.resolution.height"
                @input="updateResolution('height', Number(($event.target as HTMLInputElement).value))"
              />
            </Field>
            <Field title="窗口模式">
              <Pick
                :model-value="data.resolution.mode"
                :options="modeOptions"
                @update:model-value="
                  (value) =>
                    update({
                      resolution: { ...data!.resolution, mode: value as Settings['resolution']['mode'] }
                    })
                "
              />
            </Field>
          </template>

          <template v-else-if="item.id === 'isolation'">
            <Field title="新版本默认隔离" note="每个版本使用独立的存档与模组目录">
              <Toggle
                :model-value="data.defaultIsolation"
                @update:model-value="(value) => update({ defaultIsolation: value })"
              />
            </Field>
          </template>
        </div>
      </template>
    </section>
  </div>
</template>

<style scoped>
.scope-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-bottom: var(--space-4);
}

.search {
  flex: 1;
  min-width: 160px;
  height: var(--control-h);
  padding: 0 var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface-2);
  color: var(--text);
}

.layout {
  display: grid;
  grid-template-columns: 180px 1fr;
  gap: var(--space-4);
  align-items: start;
}

.cats {
  display: flex;
  flex-direction: column;
  gap: 2px;
  position: sticky;
  top: 0;
}

.cat {
  padding: var(--space-2) var(--space-3);
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-dim);
  text-align: left;
  cursor: pointer;
}

.cat:hover {
  background: var(--surface-2);
  color: var(--text);
}

.cat.active {
  background: var(--accent-soft);
  color: var(--accent);
}

.body {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  min-width: 0;
}

.cat-title {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-bottom: var(--space-2);
  font-size: 14px;
  font-weight: 600;
}

.color {
  width: 44px;
  height: var(--control-h);
  padding: 2px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface-2);
  cursor: pointer;
}

.range {
  width: 200px;
  accent-color: var(--accent);
}

.num {
  width: 110px;
  height: var(--control-h);
  padding: 0 var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface-2);
  color: var(--text);
}

.num:disabled {
  opacity: 0.5;
}

.btn-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
}

.pl-row,
.java-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface-2);
}

.pl-row {
  flex-wrap: wrap;
}

.pl-main {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex: 1;
}

.pl-name {
  font-weight: 600;
}

.pl-author,
.java-meta,
.java-path {
  color: var(--text-dim);
  font-size: 12px;
}

.pl-desc {
  width: 100%;
  margin: 0;
  color: var(--text-dim);
  font-size: 13px;
}

.pl-actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.java-row {
  flex-wrap: wrap;
}

.java-ver {
  font-weight: 600;
}

.java-path {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
