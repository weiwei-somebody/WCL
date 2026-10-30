<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import {
  errText,
  getSettings,
  importResources,
  listFs,
  openDir,
  removeFs,
  saveSettings,
  toggleDisableFs
} from '@/api'
import { useVersionsStore } from '@/store/versions'
import { useToastStore } from '@/store/toasts'
import Empty from '@/ui/primitives/Empty.vue'
import Pick from '@/ui/primitives/Pick.vue'
import Skeleton from '@/ui/primitives/Skeleton.vue'
import type { FsEntry } from '@shared/types'

const props = defineProps<{
  rel: string
  label: string
  note?: string
  disable?: boolean
  instanceId?: string
  folder?: string
}>()

const versions = useVersionsStore()
const toasts = useToastStore()

const targetId = ref('')
const entries = ref<FsEntry[]>([])
const ready = ref(false)
const busy = ref(false)
const input = ref<HTMLInputElement | null>(null)

const LOADER_LABEL: Record<string, string> = { fabric: 'Fabric', forge: 'Forge', quilt: 'Quilt', neoforge: 'NeoForge' }

const locked = computed(() => Boolean(props.instanceId))
const importable = computed(() => ['mods', 'resourcepacks', 'shaderpacks'].includes(props.rel))
const lockId = computed(() => props.instanceId ?? '')
const target = computed(() => versions.installed.find((row) => row.id === (locked.value ? lockId.value : targetId.value)) ?? null)
const dir = computed(() => {
  if (locked.value) return props.folder || target.value?.gameDirectory || target.value?.folder || ''
  return target.value?.gameDirectory ?? target.value?.folder ?? ''
})
const options = computed(() =>
  versions.installed.map((row) => ({
    value: row.id,
    label: row.id,
    hint: row.loader ? `${row.mcVersion} · ${LOADER_LABEL[row.loader] ?? row.loader}` : row.mcVersion
  }))
)
const usable = computed(() => (locked.value ? Boolean(dir.value) : Boolean(target.value)))
const targetFolder = computed(() => (locked.value ? props.folder || target.value?.folder || '' : target.value?.folder || ''))

async function selectTarget(id: string) {
  targetId.value = String(id)
  await saveSettings({ activeInstanceId: targetId.value })
}

async function load() {
  if (!usable.value) {
    entries.value = []
    ready.value = true
    return
  }
  ready.value = false
  try {
    entries.value = await listFs(props.rel, dir.value)
  } catch (error) {
    entries.value = []
    toasts.push(errText(error), 'error')
  } finally {
    ready.value = true
  }
}

function openPicker() {
  input.value?.click()
}

async function onPick(event: Event) {
  const area = event.target as HTMLInputElement
  const files = Array.from(area.files ?? [])
  if (!files.length || !usable.value) return
  busy.value = true
  try {
    await importResources(files.map((file) => file.name), lockId.value || target.value?.id || '', targetFolder.value, props.rel)
    toasts.push(`已导入 ${files.length} 个文件`, 'ok')
    await load()
  } catch (error) {
    toasts.push(errText(error), 'error')
  } finally {
    busy.value = false
    area.value = ''
  }
}

async function remove(name: string) {
  try {
    entries.value = await removeFs(props.rel, name, dir.value)
    toasts.push(`已移除 ${name}`, 'ok')
  } catch (error) {
    toasts.push(errText(error), 'error')
  }
}

async function toggle(name: string) {
  try {
    entries.value = await toggleDisableFs(props.rel, name, dir.value)
  } catch (error) {
    toasts.push(errText(error), 'error')
  }
}

function fmtSize(bytes: number): string {
  if (!bytes) return '未知'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function fmtTime(value: number): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

onMounted(async () => {
  await versions.loadInstalled()
  if (locked.value) {
    targetId.value = lockId.value
  } else {
    const active = (await getSettings()).activeInstanceId ?? ''
    targetId.value = versions.installed.some((row) => row.id === active) ? active : versions.installed[0]?.id ?? ''
  }
  await load()
})

async function reloadLocked() {
  if (!locked.value) return
  targetId.value = lockId.value
  await load()
}

watch(targetId, load)
watch(() => [props.instanceId, props.folder], reloadLocked)
</script>

<template>
  <div class="toolbar card">
    <template v-if="!locked && versions.installed.length">
      <span class="page-note">目标实例</span>
      <Pick :model-value="targetId" :options="options" @update:model-value="selectTarget(String($event))" />
    </template>
    <span v-if="locked" class="page-note">{{ target?.id ?? props.instanceId }}</span>
    <span v-if="target?.loader" class="tag approx">{{ LOADER_LABEL[target.loader] ?? target.loader }}</span>
    <div class="grow" />
    <input ref="input" class="hidden-input" type="file" multiple @change="onPick" />
    <button class="btn" :disabled="!usable || busy" @click="openPicker" v-if="importable">导入文件</button>
    <button class="btn" :disabled="!usable" @click="openDir(rel, dir)">打开目录</button>
    <button class="btn" :disabled="!usable" @click="load">刷新</button>
  </div>

  <section class="card section">
    <Empty v-if="!usable" text="找不到可用的实例目录" note="返回「游戏版本」页刷新或重新选择实例后再试。" />
    <Skeleton v-else-if="!ready" :rows="4" />
    <Empty v-else-if="!entries.length" :text="`${label}目录为空`" :note="note ?? '可以从社区下载，或手动导入文件。'" />
    <div v-else class="list">
      <div v-for="entry in entries" :key="entry.name" class="row">
        <span class="row-name mono" :class="{ off: entry.name.endsWith('.disabled') }">{{ entry.name }}</span>
        <span v-if="entry.name.endsWith('.disabled')" class="tag approx">已禁用</span>
        <span class="row-size">{{ fmtSize(entry.size) }}</span>
        <span class="row-time">{{ fmtTime(entry.mtime) }}</span>
        <div class="row-ops">
          <button v-if="disable" class="btn" @click="toggle(entry.name)">
            {{ entry.name.endsWith('.disabled') ? '启用' : '禁用' }}
          </button>
          <button class="btn danger" @click="remove(entry.name)">移除</button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  margin-bottom: var(--space-3);
}

.grow {
  flex: 1;
}

.hidden-input {
  display: none;
}

.section {
  display: flex;
  flex-direction: column;
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

.row-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row-name.off {
  color: var(--text-mute);
  text-decoration: line-through;
}

.row-size,
.row-time {
  min-width: 90px;
  color: var(--text-mute);
  font-size: 12px;
}

.row-ops {
  display: flex;
  gap: var(--space-2);
}

.btn.danger {
  color: var(--danger);
}
</style>
