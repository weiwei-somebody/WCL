<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  addServer,
  bindServer,
  editServer,
  errText,
  favoriteServer,
  listServers,
  pingServer,
  prepareServerLaunch,
  removeServer
} from '@/api'
import { useLaunchStore } from '@/store/launch'
import { useToastStore } from '@/store/toasts'
import Empty from '@/ui/primitives/Empty.vue'
import Modal from '@/ui/primitives/Modal.vue'
import Skeleton from '@/ui/primitives/Skeleton.vue'
import TextInput from '@/ui/primitives/TextInput.vue'
import type { ServerEntry, ServerPingResult } from '@shared/types'

const props = defineProps<{ instanceId: string; folder?: string }>()

const router = useRouter()
const launch = useLaunchStore()
const toasts = useToastStore()

const items = ref<ServerEntry[]>([])
const ready = ref(false)
const pings = ref<Record<string, ServerPingResult>>({})
const pinging = ref('')
const modal = ref<'' | 'add' | 'edit'>('')
const editId = ref('')
const formName = ref('')
const formAddress = ref('')
const busy = ref(false)

function sortItems(list: ServerEntry[]): ServerEntry[] {
  return [...list].sort(
    (a, b) =>
      Number(b.versionId === props.instanceId) - Number(a.versionId === props.instanceId) ||
      Number(!!b.favorite) - Number(!!a.favorite) ||
      a.name.localeCompare(b.name, 'zh-Hans-CN')
  )
}

async function load() {
  items.value = sortItems(await listServers())
  ready.value = true
}

function openAdd() {
  editId.value = ''
  formName.value = ''
  formAddress.value = ''
  modal.value = 'add'
}

function openEdit(entry: ServerEntry) {
  editId.value = entry.id
  formName.value = entry.name
  formAddress.value = entry.address
  modal.value = 'edit'
}

async function submit() {
  const name = formName.value.trim()
  const address = formAddress.value.trim()
  if (!address) {
    toasts.push('服务器地址不能为空', 'error')
    return
  }
  busy.value = true
  const editing = modal.value === 'edit'
  try {
    if (editing) items.value = sortItems(await editServer(editId.value, name, address))
    else {
      const list = await addServer(name, address)
      items.value = sortItems(await bindServer(list[0].id, props.instanceId, props.folder))
    }
    modal.value = ''
    toasts.push(editing ? '服务器已更新' : `服务器已添加并绑定到 ${props.instanceId}`, 'ok')
  } catch (error) {
    toasts.push(errText(error), 'error')
  } finally {
    busy.value = false
  }
}

async function favorite(entry: ServerEntry) {
  items.value = sortItems(await favoriteServer(entry.id, !entry.favorite))
}

async function bind(entry: ServerEntry, versionId: string) {
  items.value = sortItems(await bindServer(entry.id, versionId, props.folder))
}

async function remove(entry: ServerEntry) {
  if (!window.confirm(`确定移除服务器 ${entry.name}？`)) return
  items.value = sortItems(await removeServer(entry.id))
}

async function ping(entry: ServerEntry) {
  pinging.value = entry.id
  try {
    pings.value = { ...pings.value, [entry.id]: await pingServer(entry.address) }
  } catch (error) {
    toasts.push(errText(error), 'error')
  } finally {
    pinging.value = ''
  }
}

async function join(entry: ServerEntry) {
  try {
    const prep = await prepareServerLaunch(entry.id, props.instanceId, props.folder)
    await launch.launch(prep.versionId, prep.folder, prep.address)
    toasts.push(`已用 ${prep.versionId} 进入 ${entry.name}（浏览器阶段为模拟启动）`, 'ok')
  } catch (error) {
    toasts.push(errText(error), 'error')
  }
}

onMounted(load)

watch(() => [props.instanceId, props.folder], load)
</script>

<template>
  <section class="card section">
    <div class="toolbar">
      <span class="page-note">该实例的多人游戏条目</span>
      <div class="grow" />
      <button class="btn primary" @click="openAdd">添加服务器</button>
      <button class="btn" @click="load">刷新</button>
      <button class="btn" @click="router.push('/servers')">服务器页</button>
    </div>

    <Skeleton v-if="!ready" :rows="3" />
    <Empty
      v-else-if="!items.length"
      text="还没有服务器"
      note="点「添加服务器」新建一条并绑定到本实例，也可以去「服务器页」添加后回来绑定。"
    />
    <div v-else class="list">
      <div v-for="entry in items" :key="entry.id" class="row">
        <button class="star" :class="{ on: entry.favorite }" :title="entry.favorite ? '取消收藏' : '收藏'" @click="favorite(entry)">
          {{ entry.favorite ? '★' : '☆' }}
        </button>
        <div class="row-main">
          <span class="row-title">{{ entry.name }}</span>
          <span class="mono">{{ entry.address }}</span>
          <span v-if="entry.versionId === instanceId" class="tag real">本实例</span>
          <span v-else-if="entry.versionId" class="tag approx">{{ entry.versionId }}</span>
          <span v-else class="tag">未绑定</span>
          <span v-if="pings[entry.id]" class="tag" :class="pings[entry.id].online ? 'real' : 'mock'">
            {{ pings[entry.id].online ? `在线 ${pings[entry.id].players}` : '离线' }}
          </span>
          <span v-if="pings[entry.id]?.online" class="page-note">{{ pings[entry.id].version }} · {{ pings[entry.id].latencyMs }}ms</span>
        </div>
        <div class="row-ops">
          <button v-if="entry.versionId !== instanceId" class="btn" @click="bind(entry, instanceId)">绑定到本实例</button>
          <button v-else class="btn" @click="bind(entry, '')">解除绑定</button>
          <button class="btn" :disabled="pinging === entry.id" @click="ping(entry)">
            {{ pinging === entry.id ? '探测中…' : '探测' }}
          </button>
          <button class="btn primary" @click="join(entry)">用本实例进入</button>
          <button class="btn" @click="openEdit(entry)">编辑</button>
          <button class="btn danger" @click="remove(entry)">移除</button>
        </div>
      </div>
    </div>
    <p v-if="items.length" class="page-note">
      浏览器阶段不读取实例内 servers.dat；桌面版会同步真实服务器列表，并用本实例直连进入。
    </p>
  </section>

  <Modal :open="!!modal" :title="modal === 'edit' ? '编辑服务器' : '添加服务器'" @close="modal = ''">
    <div class="form">
      <label class="form-row">
        <span class="form-label">名称（留空取地址）</span>
        <TextInput v-model="formName" placeholder="服务器名称" />
      </label>
      <label class="form-row">
        <span class="form-label">地址</span>
        <TextInput v-model="formAddress" placeholder="如 play.example.com 或 1.2.3.4:25566" />
      </label>
    </div>
    <p v-if="modal === 'add'" class="page-note">新建后会自动绑定到 {{ instanceId }}。</p>
    <template #footer>
      <button class="btn" @click="modal = ''">取消</button>
      <button class="btn primary" :disabled="busy" @click="submit">保存</button>
    </template>
  </Modal>
</template>

<style scoped>
.section {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.toolbar {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.grow {
  flex: 1;
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
  flex-wrap: wrap;
}

.row-title {
  font-weight: 600;
}

.row-ops {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
}

.star {
  width: 22px;
  border: 0;
  background: transparent;
  color: var(--text-mute);
  font-size: 15px;
  cursor: pointer;
  padding: 0;
}

.star.on {
  color: var(--warn);
}

.form {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.form-row {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.form-label {
  color: var(--text-mute);
  font-size: 12px;
}

.btn.danger {
  color: var(--danger);
}
</style>
