<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { errText } from '@/api'
import { useCommunityStore } from '@/store/community'
import { useDownloadsStore } from '@/store/downloads'
import { useToastStore } from '@/store/toasts'
import Drawer from '@/ui/primitives/Drawer.vue'
import Empty from '@/ui/primitives/Empty.vue'
import Pick from '@/ui/primitives/Pick.vue'
import Skeleton from '@/ui/primitives/Skeleton.vue'
import TextInput from '@/ui/primitives/TextInput.vue'
import Toggle from '@/ui/primitives/Toggle.vue'
import type { CommunityFile, CommunityKind } from '@shared/types'

const route = useRoute()
const router = useRouter()
const community = useCommunityStore()
const downloads = useDownloadsStore()
const toasts = useToastStore()

const KINDS: Array<{ value: CommunityKind; label: string }> = [
  { value: 'mod', label: '模组' },
  { value: 'modpack', label: '整合包' },
  { value: 'resourcepack', label: '资源包' },
  { value: 'shader', label: '光影' },
  { value: 'datapack', label: '数据包' }
]

const SORTS = [
  { value: 'relevance', label: '相关度' },
  { value: 'downloads', label: '最多下载' },
  { value: 'newest', label: '最新发布' }
]

const LOADERS = [
  { value: '', label: '任意加载器' },
  { value: 'fabric', label: 'Fabric' },
  { value: 'forge', label: 'Forge' },
  { value: 'quilt', label: 'Quilt' },
  { value: 'neoforge', label: 'NeoForge' }
]

const SOURCES = [
  { value: 'all', label: '全部来源' },
  { value: 'modrinth', label: 'Modrinth' },
  { value: 'curseforge', label: 'CurseForge（桌面版）' }
]

const RELEASE_LABEL: Record<string, string> = { release: '正式', beta: '测试', alpha: '早期' }

const LOADER_LABEL: Record<string, string> = { fabric: 'Fabric', forge: 'Forge', quilt: 'Quilt', neoforge: 'NeoForge' }

const kindLabel = computed(() => KINDS.find((item) => item.value === community.kind)?.label ?? '资源')

/** 实例选项带上「MC 版本 · 加载器」，选中后一眼可见兼容范围。 */
const targetOptions = computed(() =>
  community.installed.map((row) => ({
    value: row.id,
    label: row.id,
    hint: row.loader ? `${row.mcVersion} · ${LOADER_LABEL[row.loader] ?? row.loader}` : row.mcVersion
  }))
)

const compatNote = computed(() => {
  const target = community.target
  if (!target) return ''
  return target.loader ? `${target.mcVersion} · ${LOADER_LABEL[target.loader] ?? target.loader}` : target.mcVersion
})

function loaderLabel(name?: string): string {
  return name ? LOADER_LABEL[name] ?? name : ''
}

function setOnlyCompatible(value: boolean) {
  void community.setOnlyCompatible(value)
}

function setWithDeps(value: boolean) {
  void community.setWithDeps(value)
}

function pickTarget(value: string | number) {
  void community.selectTarget(String(value))
}

const CUSTOM_VERSION = 'custom'

const versionOptions = computed(() => [
  { value: '', label: '全部版本' },
  ...community.installed.map((row) => ({ value: `inst:${row.id}`, label: row.id, hint: row.mcVersion })),
  { value: CUSTOM_VERSION, label: '自定义版本' }
])

const customVersion = ref(false)
const versionPick = ref('')

function pickVersion(value: string | number) {
  const next = String(value)
  versionPick.value = next
  customVersion.value = next === CUSTOM_VERSION
  if (customVersion.value) {
    community.mcVersion = ''
    return
  }
  community.mcVersion = community.installed.find((row) => `inst:${row.id}` === next)?.mcVersion ?? ''
  void community.search(true)
}

function requiredCount(file: CommunityFile): number {
  return (file.dependencies ?? []).filter((dep) => dep.required).length
}

function installLabel(file: CommunityFile): string {
  const count = requiredCount(file)
  return community.withDeps && count ? `加入队列（含 ${count} 个前置）` : '加入队列'
}

function fmtCount(value: number): string {
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K`
  return String(value)
}

function fmtSize(bytes: number): string {
  if (!bytes) return '未知'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function fmtDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

async function runSearch() {
  await community.search(true)
}

async function changeKind(value: CommunityKind) {
  community.kind = value
  await community.search(true)
}

async function openProject(projectId: string) {
  try {
    await community.openProject(projectId)
  } catch (error) {
    toasts.push(errText(error), 'error')
  }
}

function install(file: CommunityFile) {
  try {
    community.enqueue(file)
    toasts.push(`已加入下载队列（第 ${downloads.jobs.length} 项），可在「下载」页查看进度`, 'ok')
  } catch (error) {
    toasts.push(errText(error), 'error')
  }
}

onMounted(async () => {
  const kind = route.query.kind
  if (typeof kind === 'string' && KINDS.some((item) => item.value === kind)) community.kind = kind as CommunityKind
  await community.loadInstalled()
  await community.search(true)
})
</script>

<template>
  <div class="page-head">
    <h1 class="page-title">社区资源</h1>
    <span class="page-note">Modrinth 实时检索 · 共 {{ community.total }} 条结果</span>
    <span v-if="community.searchNote" class="page-note">{{ community.searchNote }}</span>
    <span v-if="community.translating" class="page-note">正在补全 MC百科中文译名…</span>
  </div>

  <div class="toolbar card">
    <TextInput v-model="community.keyword" placeholder="搜索名称、作者或关键词（支持中文）" class="search" @keyup.enter="runSearch" />
    <button class="btn primary" :disabled="community.loading" @click="runSearch">
      {{ community.loading ? '检索中…' : '搜索' }}
    </button>
    <div class="grow" />
    <Pick v-model="community.source" :options="SOURCES" @update:model-value="runSearch" />
    <Pick v-model="community.sort" :options="SORTS" @update:model-value="runSearch" />
  </div>

  <div class="filters card">
    <div class="chips">
      <button
        v-for="item in KINDS"
        :key="item.value"
        class="chip"
        :class="{ on: community.kind === item.value }"
        @click="changeKind(item.value)"
      >
        {{ item.label }}
      </button>
    </div>
    <div class="filters-right">
      <Pick :model-value="versionPick" :options="versionOptions" @update:model-value="pickVersion" />
      <TextInput
        v-if="customVersion"
        v-model="community.mcVersion"
        placeholder="MC 版本，如 1.20.1"
        class="ver"
        @keyup.enter="runSearch"
      />
      <Pick v-model="community.loader" :options="LOADERS" @update:model-value="runSearch" />
    </div>
  </div>

  <div v-if="downloads.jobs.length" class="queue-bar card">
    <span class="page-note">
      下载队列共 {{ downloads.jobs.length }} 项 · 等待中 {{ downloads.pendingCount }} 项
      <template v-if="downloads.current"> · 正在下载 {{ downloads.current.title }}</template>
    </span>
    <div class="grow" />
    <button class="btn" @click="router.push('/downloads')">打开下载页</button>
  </div>

  <div v-if="community.error" class="error-note card">
    {{ community.error }}
    <button class="btn" @click="runSearch">重试</button>
  </div>

  <Skeleton v-else-if="!community.ready" :rows="6" />
  <Empty v-else-if="!community.items.length" text="没有匹配的资源" note="换个关键词、类型或版本条件再试。" />

  <section v-else class="grid">
    <article v-for="item in community.items" :key="item.projectId" class="entry card" @click="openProject(item.projectId)">
      <img v-if="item.iconUrl" class="entry-icon" :src="item.iconUrl" :alt="item.title" />
      <div v-else class="entry-icon placeholder">{{ item.title.slice(0, 1) }}</div>
      <div class="entry-body">
        <div class="entry-head">
          <span class="entry-title">{{ item.title }}</span>
          <span class="tag real">Modrinth</span>
          <span v-if="item.originalTitle && item.title !== item.originalTitle" class="tag">MC百科译名</span>
        </div>
        <p class="entry-desc">{{ item.description }}</p>
        <div class="entry-meta">
          <span>{{ item.author }}</span>
          <span>↓ {{ fmtCount(item.downloads) }}</span>
          <span>{{ fmtDate(item.updatedAt) }}</span>
          <span v-for="cat in item.categories.slice(0, 3)" :key="cat" class="tag">{{ cat }}</span>
        </div>
      </div>
    </article>
  </section>

  <div v-if="community.items.length" class="pager">
    <button class="btn" :disabled="community.page <= 1 || community.loading" @click="community.goPage(community.page - 1)">
      上一页
    </button>
    <span class="page-note">第 {{ community.page }} / {{ community.pageCount }} 页</span>
    <button class="btn" :disabled="community.page >= community.pageCount || community.loading" @click="community.goPage(community.page + 1)">
      下一页
    </button>
  </div>

  <Drawer :open="!!community.project" :title="community.project?.title ?? '项目详情'" @close="community.closeProject()">
    <template v-if="community.project">
      <div class="detail-head">
        <img v-if="community.project.iconUrl" class="detail-icon" :src="community.project.iconUrl" alt="" />
        <div>
          <div class="detail-title">{{ community.project.title }}</div>
          <div class="page-note">{{ community.project.author ?? '未知作者' }} · 许可 {{ community.project.license ?? '未标注' }}</div>
        </div>
      </div>
      <p class="detail-desc">{{ community.project.description }}</p>
      <div class="detail-meta">
        <span>下载 {{ fmtCount(community.project.downloads ?? 0) }}</span>
        <span>关注 {{ fmtCount(community.project.followers ?? 0) }}</span>
        <span v-for="cat in community.project.categories" :key="cat" class="tag">{{ cat }}</span>
      </div>
      <div class="detail-links">
        <a v-if="community.project.webpage" :href="community.project.webpage" target="_blank" rel="noreferrer">在 Modrinth 打开</a>
        <a v-if="community.entryUrl" :href="community.entryUrl" target="_blank" rel="noreferrer">查看 MC百科条目</a>
      </div>

      <div class="install-bar">
        <div class="install-head">
          <span class="install-label">安装到实例</span>
          <Pick
            v-if="community.installed.length"
            :model-value="community.targetId"
            :options="targetOptions"
            @update:model-value="pickTarget"
          />
          <span v-else class="page-note">请先在「游戏版本」页安装一个实例</span>
          <label v-if="community.target" class="compat-toggle">
            <Toggle :model-value="community.onlyCompatible" @update:model-value="setOnlyCompatible" />
            <span class="page-note">只看兼容版本</span>
          </label>
          <label v-if="community.kind === 'mod'" class="compat-toggle">
            <Toggle :model-value="community.withDeps" @update:model-value="setWithDeps" />
            <span class="page-note">递归下载前置模组</span>
          </label>
        </div>
        <p v-if="community.target" class="install-note">
          {{
            community.onlyCompatible
              ? `下方只列出 ${compatNote} 可用的文件，加入队列后写入该实例目录`
              : '已关闭兼容过滤，下方列出该项目全部文件'
          }}
        </p>
        <p v-if="downloads.current" class="install-note">
          下载队列正在处理 {{ downloads.current.title }}（等待中 {{ downloads.pendingCount }} 项）·
          可在「下载」页查看完整队列
        </p>
      </div>

      <h3 class="files-title">
        {{ kindLabel }}文件
        <span v-if="community.onlyCompatible && compatNote" class="tag approx">{{ compatNote }}</span>
      </h3>
      <Skeleton v-if="community.loadingFiles" :rows="4" />
      <Empty
        v-else-if="!community.projectFiles.length"
        :text="community.onlyCompatible ? `${compatNote} 下没有可用文件` : '该项目没有可用文件'"
        :note="community.onlyCompatible ? '关闭「只看兼容版本」可以查看全部文件。' : '换个资源类型或稍后再试。'"
      />
      <div v-else class="files">
        <div v-for="file in community.projectFiles" :key="file.fileId" class="file">
          <div class="file-body">
            <div class="file-main">
              <span class="file-name mono">{{ file.fileName }}</span>
              <span class="tag">{{ RELEASE_LABEL[file.releaseType] ?? file.releaseType }}</span>
              <span class="tag">{{ file.version }}</span>
              <span v-for="loader in file.loaders.slice(0, 2)" :key="loader" class="tag approx">{{ loaderLabel(loader) }}</span>
            </div>
            <div class="file-meta">
              <span>{{ fmtSize(file.size) }}</span>
              <span>{{ fmtDate(file.date) }}</span>
              <span class="truncate">{{ file.gameVersions.slice(0, 6).join(' / ') }}</span>
            </div>
            <div v-if="(file.dependencies ?? []).length" class="file-deps">
              <span class="page-note">前置</span>
              <span
                v-for="dep in file.dependencies"
                :key="`${dep.projectId ?? ''}-${dep.fileId ?? ''}-${dep.required}`"
                class="tag"
                :class="dep.required ? 'approx' : ''"
              >
                {{ dep.required ? '必需' : '可选' }} · {{ community.depTitle(dep.projectId) }}
              </span>
            </div>
          </div>
          <button class="btn primary" :disabled="!community.targetId" @click="install(file)">
            {{ installLabel(file) }}
          </button>
        </div>
      </div>
    </template>
  </Drawer>
</template>

<style scoped>
.toolbar,
.filters {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  margin-bottom: var(--space-3);
}

.filters {
  flex-wrap: wrap;
}

.filters-right {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-left: auto;
}

.grow {
  flex: 1;
}

.search {
  width: 320px;
}

.ver {
  width: 180px;
}

.chips {
  display: flex;
  gap: var(--space-2);
  flex-wrap: wrap;
}

.chip {
  height: 30px;
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

.queue-bar {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin-bottom: var(--space-3);
}

.error-note {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  color: var(--danger);
  font-size: 13px;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
  gap: var(--space-3);
}

.entry {
  display: flex;
  gap: var(--space-3);
  cursor: pointer;
  transition: border-color var(--dur) var(--ease);
}

.entry:hover {
  border-color: var(--border-strong);
}

.entry-icon,
.detail-icon {
  width: 48px;
  height: 48px;
  flex: 0 0 48px;
  border-radius: var(--radius-sm);
  object-fit: cover;
  background: var(--surface-2);
}

.detail-icon {
  width: 56px;
  height: 56px;
  flex-basis: 56px;
}

.entry-icon.placeholder {
  display: grid;
  place-items: center;
  color: var(--text-dim);
  font-size: 20px;
  font-weight: 600;
}

.entry-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.entry-head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.entry-title {
  font-weight: 600;
}

.entry-desc {
  color: var(--text-dim);
  font-size: 13px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.entry-meta,
.detail-meta {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
  color: var(--text-mute);
  font-size: 12px;
}

.pager {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-3);
  margin-top: var(--space-4);
}

.detail-head {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.detail-title {
  font-size: 16px;
  font-weight: 600;
}

.detail-desc {
  margin: var(--space-3) 0;
  color: var(--text-dim);
  font-size: 13px;
}

.detail-meta {
  margin-bottom: var(--space-3);
}

.install-bar {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-3);
  margin: var(--space-3) 0;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface-2);
}

.install-head {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-wrap: wrap;
}

.install-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-dim);
}

.install-note {
  color: var(--text-mute);
  font-size: 12px;
}

.compat-toggle {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-left: auto;
  cursor: pointer;
}

.detail-links {
  display: flex;
  gap: var(--space-3);
  font-size: 13px;
}

.files-title {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: 14px;
  font-weight: 600;
  margin-bottom: var(--space-2);
}

.files {
  display: flex;
  flex-direction: column;
}

.file {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) 0;
  border-bottom: 1px solid var(--border);
}

.file-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.file-main {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
}

.file-deps {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
}

.file-name {
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  color: var(--text-mute);
  font-size: 12px;
  min-width: 150px;
}

.truncate {
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
