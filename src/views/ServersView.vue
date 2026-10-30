<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { errText, launchGame, pingServer, prepareServerLaunch } from '@/api'
import { addServer, bindServer, editServer, favoriteServer, listServers, removeServer } from '@/api'
import { useVersionsStore } from '@/store/versions'
import { useToastStore } from '@/store/toasts'
import Empty from '@/ui/primitives/Empty.vue'
import Modal from '@/ui/primitives/Modal.vue'
import Pick from '@/ui/primitives/Pick.vue'
import Skeleton from '@/ui/primitives/Skeleton.vue'
import TextInput from '@/ui/primitives/TextInput.vue'
import type { ServerEntry, ServerPingResult } from '@shared/types'

const versions = useVersionsStore()
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

const options = computed(() => versions.installed.map((row) => ({ value: row.id, label: `${row.id}（${row.mcVersion}）` })))

function sortItems(list: ServerEntry[]): ServerEntry[] {
  return [...list].sort((a, b) => Number(!!b.favorite) - Number(!!a.favorite) || a.name.localeCompare(b.name))
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
    items.value = sortItems(editing ? await editServer(editId.value, name, address) : await addServer(name, address))
    modal.value = ''
    toasts.push(editing ? '服务器已更新' : '服务器已添加', 'ok')
  } catch (error) {
    toasts.push(errText(error), 'error')
  } finally {
    busy.value = false
  }
}

async function remove(entry: ServerEntry) {
  if (!window.confirm(`确定移除服务器 ${entry.name}？`)) return
  items.value = sortItems(await removeServer(entry.id))
}

async function favorite(entry: ServerEntry) {
  items.value = sortItems(await favoriteServer(entry.id, !entry.favorite))
}

async function bind(entry: ServerEntry, versionId: string) {
  items.value = sortItems(await bindServer(entry.id, versionId))
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
    const prep = await prepareServerLaunch(entry.id)
    await launchGame(prep.versionId, prep.address, prep.folder)
    toasts.push(`已准备用 ${prep.versionId} 启动（浏览器阶段不会真正拉起游戏）`, 'ok')
  } catch (error) {
    toasts.push(errText(error), 'error')
  }
}

onMounted(async () => {
  await versions.loadInstalled()
  await load()
})
</script>

<template>
  <div class="page-head">
    <h1 class="page-title">服务器</h1>
    <span class="page-note">共 {{ items.length }} 个条目 · 在线状态走 mcsrvstat 实时探测</span>
    <div class="grow" />
    <button class="btn primary" @click="openAdd">添加服务器</button>
  </div>

  <Skeleton v-if="!ready" :rows="4" />
  <section v-else class="card section">
    <Empty v-if="!items.length" text="还没有添加服务器" note="添加后可以探测在线状态，并绑定实例一键进入。" />
    <div v-else class="list">
      <div v-for="entry in items" :key="entry.id" class="row">
        <button class="star" :class="{ on: entry.favorite }" :title="entry.favorite ? '取消收藏' : '收藏'" @click="favorite(entry)">
          {{ entry.favorite ? '★' : '☆' }}
        </button>
        <div class="row-main">
          <span class="row-title">{{ entry.name }}</span>
          <span class="mono">{{ entry.address }}</span>
          <span v-if="pings[entry.id]" class="tag" :class="pings[entry.id].online ? 'real' : 'mock'">
            {{ pings[entry.id].online ? `在线 ${pings[entry.id].players}` : '离线' }}
          </span>
          <span v-if="pings[entry.id]?.online" class="page-note">{{ pings[entry.id].version }} · {{ pings[entry.id].latencyMs }}ms</span>
        </div>
        <div class="row-ops">
          <Pick
            v-if="versions.installed.length"
            :model-value="entry.versionId ?? ''"
            :options="[{ value: '', label: '未绑定实例' }, ...options]"
            @update:model-value="bind(entry, String($event))"
          />
          <button class="btn" :disabled="pinging === entry.id" @click="ping(entry)">
            {{ pinging === entry.id ? '探测中…' : '探测' }}
          </button>
          <button class="btn primary" :disabled="!versions.installed.length" @click="join(entry)">启动进入</button>
          <button class="btn" @click="openEdit(entry)">编辑</button>
          <button class="btn danger" @click="remove(entry)">移除</button>
        </div>
      </div>
    </div>
    <p v-if="items.length" class="page-note note-foot">
      浏览器阶段不读取实例内 servers.dat；桌面版将同步真实服务器列表并支持 --quickPlayMultiplayer 直连。
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
    <template #footer>
      <button class="btn" @click="modal = ''">取消</button>
      <button class="btn primary" :disabled="busy" @click="submit">保存</button>
    </template>
  </Modal>
</template>

<style scoped>
.grow {
  flex: 1;
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
  font-size: 13px;
  color: var(--text-dim);
}

.note-foot {
  margin-top: var(--space-3);
}
</style>
