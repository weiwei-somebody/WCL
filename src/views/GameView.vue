<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import type { FabricApiVersion, InstallOptions, InstalledVersion, LoaderName, RemoteVersion } from '@shared/types'
import { versionCategories } from '@shared/versionPicker'
import { cleanupPartialInstall, errText, listFabricApi, listLoaders } from '@/api'
import { useDownloadsStore } from '@/store/downloads'
import { useSettingsStore } from '@/store/settings'
import { useToastStore } from '@/store/toasts'
import { useVersionsStore } from '@/store/versions'
import Empty from '@/ui/primitives/Empty.vue'
import Modal from '@/ui/primitives/Modal.vue'
import Pick from '@/ui/primitives/Pick.vue'
import Skeleton from '@/ui/primitives/Skeleton.vue'
import TextInput from '@/ui/primitives/TextInput.vue'
import Toggle from '@/ui/primitives/Toggle.vue'

const versions = useVersionsStore()
const downloads = useDownloadsStore()
const settings = useSettingsStore()
const toasts = useToastStore()
const router = useRouter()

const tab = ref<'installed' | 'remote'>('installed')
const modal = ref<'' | 'install' | 'rename'>('')
const target = ref<RemoteVersion | null>(null)
const instName = ref('')
const renameId = ref('')
const renameName = ref('')
const loader = ref<LoaderName | ''>('')
const loaderVersion = ref('')
const loaderVersions = ref<string[]>([])
const fabricApi = ref('')
const fabricVersions = ref<FabricApiVersion[]>([])
const loadingLoader = ref(false)
const bulk = ref(false)

const TYPE_LABELS: Record<string, string> = {
  release: '正式版',
  snapshot: '快照',
  old_beta: '远古 Beta',
  old_alpha: '远古 Alpha'
}

const LOADERS: Array<{ value: LoaderName | ''; label: string }> = [
  { value: '', label: '仅原版客户端' },
  { value: 'fabric', label: 'Fabric' },
  { value: 'forge', label: 'Forge' },
  { value: 'quilt', label: 'Quilt' },
  { value: 'neoforge', label: 'NeoForge' }
]

const MAX_ROWS = 300

const favorites = computed(() => settings.data?.favoriteVersions ?? [])
const rows = computed(() => versions.filtered.slice(0, MAX_ROWS))
const truncated = computed(() => versions.filtered.length > MAX_ROWS)
const installedCount = computed(() => versions.installed.length)
const loaderOptions = computed(() => [
  { value: '', label: loadingLoader.value ? '读取中…' : '最新版' },
  ...loaderVersions.value.map((item) => ({ value: item, label: item }))
])
const fabricOptions = computed(() => [
  { value: '', label: '不安装 Fabric API' },
  ...fabricVersions.value.map((item) => ({ value: item.version, label: item.version }))
])

function typeLabel(type: string): string {
  return TYPE_LABELS[type] ?? type
}

function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function isFavorite(id: string): boolean {
  return favorites.value.includes(id)
}

async function toggleFavorite(id: string) {
  const next = isFavorite(id) ? favorites.value.filter((item) => item !== id) : [id, ...favorites.value]
  try {
    await settings.patch({ favoriteVersions: next })
  } catch (error) {
    toasts.push(errText(error), 'error')
  }
}

function openInstall(version: RemoteVersion) {
  target.value = version
  instName.value = version.id
  loader.value = ''
  loaderVersion.value = ''
  loaderVersions.value = []
  fabricApi.value = ''
  fabricVersions.value = []
  modal.value = 'install'
}

function closeModal() {
  modal.value = ''
  target.value = null
}

/** 选择加载器后按其官方清单取可用版本；Fabric 另取 Fabric API 版本供选装。 */
async function loadLoaderVersions() {
  const mc = target.value?.id ?? ''
  const name = loader.value
  loaderVersion.value = ''
  loaderVersions.value = []
  if (!name || !mc) return
  loadingLoader.value = true
  try {
    loaderVersions.value = await listLoaders(name, mc)
  } catch (error) {
    toasts.push(`加载器版本读取失败：${errText(error)}`, 'error')
  } finally {
    loadingLoader.value = false
  }
}

async function loadFabricVersions() {
  const mc = target.value?.id ?? ''
  fabricApi.value = ''
  fabricVersions.value = []
  if (loader.value !== 'fabric' || !mc) return
  try {
    fabricVersions.value = await listFabricApi(mc)
  } catch {
    fabricVersions.value = []
  }
}

watch(loader, (value) => {
  void loadLoaderVersions()
  if (value === 'fabric') void loadFabricVersions()
  else fabricVersions.value = []
})

function confirmInstall() {
  if (!target.value) return
  const opts: InstallOptions = {}
  const name = instName.value.trim()
  if (name && name !== target.value.id) opts.instanceName = name
  if (loader.value) {
    opts.loader = loader.value
    if (loaderVersion.value) opts.loaderVersion = loaderVersion.value
  }
  if (loader.value === 'fabric' && fabricApi.value) opts.fabricApi = fabricApi.value
  try {
    downloads.queueVersion(target.value.id, opts)
    toasts.push(`已加入下载队列，可在「下载」页查看进度`, 'ok')
    closeModal()
  } catch (error) {
    toasts.push(errText(error), 'error')
  }
}

function openRename(item: InstalledVersion) {
  renameId.value = item.id
  renameName.value = item.id
  modal.value = 'rename'
}

async function confirmRename() {
  const name = renameName.value.trim()
  if (!name) {
    toasts.push('实例名不能为空', 'error')
    return
  }
  try {
    await versions.rename(renameId.value, name)
    toasts.push(`已重命名为 ${name}`, 'ok')
    modal.value = ''
  } catch (error) {
    toasts.push(errText(error), 'error')
  }
}

async function remove(item: InstalledVersion) {
  if (!window.confirm(`确定移除实例 ${item.id}？浏览器阶段仅删除登记记录。`)) return
  try {
    await versions.remove(item.id)
    toasts.push(`已移除 ${item.id}`, 'ok')
  } catch (error) {
    toasts.push(errText(error), 'error')
  }
}

async function cleanup(item: InstalledVersion) {
  if (!window.confirm(`清理 ${item.id} 的残留安装？将删除该版本整个目录，需要重新安装。`)) return
  try {
    await cleanupPartialInstall(item.id, item.folder)
    await versions.loadInstalled()
    toasts.push(`已清理 ${item.id} 的残留文件`, 'ok')
  } catch (error) {
    toasts.push(errText(error), 'error')
  }
}

async function isolateAll() {
  const rows = versions.installed.filter((item) => item.isolated !== true)
  if (!rows.length) {
    toasts.push('所有实例都已开启版本隔离', 'ok')
    return
  }
  if (!window.confirm(`为 ${rows.length} 个实例开启版本隔离？共享目录里的存档与模组会复制到各自实例目录。`)) return
  bulk.value = true
  try {
    for (const row of rows) await versions.setIsolation(row.id, true)
    toasts.push(`已为 ${rows.length} 个实例开启版本隔离`, 'ok')
  } catch (error) {
    toasts.push(errText(error), 'error')
  } finally {
    bulk.value = false
  }
}

async function setIsolation(item: InstalledVersion, value: boolean) {
  try {
    await versions.setIsolation(item.id, value)
    toasts.push(value ? `${item.id} 已开启版本隔离` : `${item.id} 已关闭版本隔离`, 'ok')
  } catch (error) {
    toasts.push(errText(error), 'error')
  }
}

async function setActive(item: InstalledVersion) {
  try {
    await versions.setActive(item.id)
    toasts.push(`${item.id} 已设为当前实例`, 'ok')
  } catch (error) {
    toasts.push(errText(error), 'error')
  }
}

onMounted(async () => {
  versions.watch()
  downloads.watch()
  if (!settings.ready) await settings.load()
  await versions.loadInstalled()
  await versions.loadRemote()
})
</script>

<template>
  <div class="page-head">
    <h1 class="page-title">游戏版本</h1>
    <span class="page-note">已安装 {{ installedCount }} 个实例 · 远端清单 {{ versions.remote.length }} 条</span>
  </div>

  <div class="toolbar card">
    <div class="tabs">
      <button class="tab" :class="{ on: tab === 'installed' }" @click="tab = 'installed'">已安装</button>
      <button class="tab" :class="{ on: tab === 'remote' }" @click="tab = 'remote'">下载版本</button>
    </div>
    <div class="grow" />
    <template v-if="tab === 'remote'">
      <TextInput v-model="versions.query" placeholder="搜索版本号，如 1.20" class="search" />
      <button class="btn" :disabled="versions.loadingRemote" @click="versions.loadRemote(true)">
        {{ versions.loadingRemote ? '刷新中…' : '刷新清单' }}
      </button>
    </template>
    <template v-else>
      <span class="page-note">新装实例默认开启版本隔离，可在此统一补齐旧实例</span>
      <button class="btn" :disabled="bulk || !versions.installed.length" @click="isolateAll">
        {{ bulk ? '处理中…' : '全部开启版本隔离' }}
      </button>
    </template>
  </div>

  <section v-if="tab === 'installed'" class="card section">
    <Skeleton v-if="!versions.installedReady" :rows="3" />
    <Empty
      v-else-if="!versions.installed.length"
      text="还没有安装任何版本"
      note="切换到「下载版本」标签，从远端清单里选一个版本安装。"
    />
    <div v-else class="list">
      <div v-for="item in versions.installed" :key="item.id" class="row">
        <div class="row-main">
          <span class="row-title">{{ item.id }}</span>
          <span class="tag">{{ item.mcVersion }}</span>
          <span v-if="item.loader" class="tag mock">{{ item.loader }}</span>
          <span v-if="item.isolated" class="tag approx">隔离</span>
          <span v-if="versions.activeId === item.id" class="tag real">当前实例</span>
          <span v-if="item.failed" class="tag bad" title="上次安装未正常结束，启动会被拒绝；清理残留后可重新安装">安装未完成</span>
          <span v-else-if="item.incomplete" class="tag approx" title="缺少核心文件，需要重新安装">文件不完整</span>
        </div>
        <div class="row-info mono">{{ item.gameDirectory ?? item.folder }}</div>
        <div class="row-ops">
          <label class="op-toggle">
            <Toggle :model-value="item.isolated === true" @update:model-value="setIsolation(item, $event)" />
            <span class="page-note">版本隔离</span>
          </label>
          <button v-if="item.failed || item.incomplete" class="btn" @click="cleanup(item)">清理残留</button>
          <button class="btn primary" @click="router.push({ name: 'instance', params: { id: item.id } })">管理</button>
          <button class="btn" :disabled="versions.activeId === item.id" @click="setActive(item)">设为当前实例</button>
          <button class="btn" @click="openRename(item)">重命名</button>
          <button class="btn danger" @click="remove(item)">移除</button>
        </div>
      </div>
    </div>
  </section>

  <section v-else class="card section">
    <div class="chips">
      <button
        v-for="option in versionCategories"
        :key="option.value"
        class="chip"
        :class="{ on: versions.category === option.value }"
        @click="versions.category = option.value"
      >
        {{ option.label }}
      </button>
      <span class="page-note">匹配 {{ versions.filtered.length }} 条</span>
    </div>

    <div v-if="versions.remoteError" class="error-note">
      远端清单获取失败：{{ versions.remoteError }}
      <button class="btn" @click="versions.loadRemote(true)">重试</button>
    </div>
    <Skeleton v-else-if="!versions.remoteReady" :rows="6" />
    <Empty v-else-if="!rows.length" text="没有匹配的版本" note="换个分类或清空搜索词再试。" />
    <div v-else class="list">
      <div v-for="version in rows" :key="version.id" class="row remote">
        <div class="row-main">
          <button class="star" :class="{ on: isFavorite(version.id) }" :title="isFavorite(version.id) ? '取消收藏' : '收藏'" @click="toggleFavorite(version.id)">
            {{ isFavorite(version.id) ? '★' : '☆' }}
          </button>
          <span class="row-title">{{ version.id }}</span>
          <span class="tag">{{ typeLabel(version.type) }}</span>
          <span v-if="versions.installedIds.has(version.id)" class="tag real">已安装</span>
        </div>
        <div class="row-info mono">{{ formatDate(version.releaseTime) }}</div>
        <div class="row-ops">
          <button class="btn primary" :disabled="versions.installedIds.has(version.id)" @click="openInstall(version)">
            {{ versions.installedIds.has(version.id) ? '已安装' : '安装' }}
          </button>
        </div>
      </div>
    </div>
    <div v-if="truncated" class="page-note note-foot">仅显示前 {{ MAX_ROWS }} 条，请用搜索缩小范围。</div>
  </section>

  <Modal :open="modal === 'install'" :title="`安装 ${target?.id ?? ''}`" @close="closeModal">
    <p class="page-note">基于 Minecraft {{ target?.id }} 创建实例；可直接选择 Forge / Fabric / Quilt / NeoForge 加载器。</p>
    <label class="form-row">
      <span class="form-label">实例名称</span>
      <TextInput v-model="instName" placeholder="实例名称" />
    </label>
    <label class="form-row">
      <span class="form-label">模组加载器</span>
      <Pick v-model="loader" :options="LOADERS" />
    </label>
    <label v-if="loader" class="form-row">
      <span class="form-label">加载器版本</span>
      <Pick v-model="loaderVersion" :options="loaderOptions" />
    </label>
    <label v-if="loader === 'fabric'" class="form-row">
      <span class="form-label">Fabric API</span>
      <Pick v-model="fabricApi" :options="fabricOptions" />
    </label>
    <p class="page-note note-foot">
      留空加载器版本表示使用最新版；加入队列后可在「下载」页查看进度与队列。
    </p>
    <template #footer>
      <button class="btn" @click="closeModal">取消</button>
      <button class="btn primary" @click="confirmInstall">加入下载队列</button>
    </template>
  </Modal>

  <Modal :open="modal === 'rename'" title="重命名实例" @close="modal = ''">
    <label class="form-row">
      <span class="form-label">实例名称</span>
      <TextInput v-model="renameName" placeholder="实例名称" />
    </label>
    <template #footer>
      <button class="btn" @click="modal = ''">取消</button>
      <button class="btn primary" @click="confirmRename">保存</button>
    </template>
  </Modal>
</template>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  margin-bottom: var(--space-4);
}

.grow {
  flex: 1;
}

.tabs {
  display: flex;
  gap: var(--space-1);
}

.tab {
  height: var(--control-h);
  padding: 0 var(--space-4);
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-dim);
  cursor: pointer;
}

.tab.on {
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 600;
}

.search {
  width: 220px;
}

.section {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.chips {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
}

.chip {
  height: 28px;
  padding: 0 var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  background: transparent;
  color: var(--text-dim);
  cursor: pointer;
}

.chip.on {
  background: var(--accent-soft);
  border-color: transparent;
  color: var(--accent);
}

.error-note {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  color: var(--danger);
  font-size: 13px;
}

.list {
  display: flex;
  flex-direction: column;
}

.row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3);
  border-bottom: 1px solid var(--border);
}

.row-main {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.row-title {
  font-weight: 600;
}

.row-info {
  color: var(--text-mute);
}

.row-ops {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.op-toggle {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.star {
  width: 22px;
  border: 0;
  background: transparent;
  color: var(--text-mute);
  font-size: 15px;
  cursor: pointer;
}

.star.on {
  color: var(--warn);
}

.btn.danger {
  color: var(--danger);
}

.form-row {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.form-label {
  font-size: 13px;
  color: var(--text-dim);
}

.note-foot {
  margin-top: var(--space-3);
}
</style>
