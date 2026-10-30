<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import type { MsDeviceCodeInfo } from '@shared/types'
import { errText, msBeginLogin, msCancelLogin, onMsLoginDone } from '@/api'
import { useAccountsStore } from '@/store/accounts'
import { useToastStore } from '@/store/toasts'
import Modal from '@/ui/primitives/Modal.vue'
import Skeleton from '@/ui/primitives/Skeleton.vue'
import TextInput from '@/ui/primitives/TextInput.vue'

const accounts = useAccountsStore()
const toasts = useToastStore()

const name = ref('')
const busy = ref(false)
const msInfo = ref<MsDeviceCodeInfo | null>(null)
const msOpen = ref(false)

const LABELS: Record<string, string> = { offline: '离线', msa: '微软', yggdrasil: '外置登录' }

const total = computed(() => accounts.items.length)

function label(type: string): string {
  return LABELS[type] ?? type
}

function initial(username: string): string {
  return username.slice(0, 1).toUpperCase() || '?'
}

async function addOffline() {
  const value = name.value.trim()
  if (!value) {
    toasts.push('请输入离线账号名', 'error')
    return
  }
  busy.value = true
  try {
    await accounts.addOffline(value)
    name.value = ''
    toasts.push(`已添加离线账号 ${value}`, 'ok')
  } catch (error) {
    toasts.push(errText(error), 'error')
  } finally {
    busy.value = false
  }
}

async function remove(id: string, username: string) {
  try {
    await accounts.remove(id)
    toasts.push(`已移除 ${username}`, 'ok')
  } catch (error) {
    toasts.push(errText(error), 'error')
  }
}

async function select(id: string) {
  try {
    await accounts.select(id)
  } catch (error) {
    toasts.push(errText(error), 'error')
  }
}

async function beginMs() {
  try {
    msInfo.value = await msBeginLogin()
    msOpen.value = true
  } catch (error) {
    toasts.push(errText(error), 'error')
  }
}

async function cancelMs() {
  try {
    await msCancelLogin()
  } catch (error) {
    console.error('[wcl] 取消登录失败', error)
  }
  msOpen.value = false
  msInfo.value = null
}

let stopLogin: (() => void) | null = null

onMounted(async () => {
  if (!accounts.ready) await accounts.load()
  stopLogin = onMsLoginDone(async (result) => {
    msOpen.value = false
    if (result.account) {
      await accounts.load()
      toasts.push(`已登录 ${result.account.username}`, 'ok')
    } else if (result.error) {
      toasts.push(result.error, 'error')
    }
  })
})

onUnmounted(() => {
  stopLogin?.()
})
</script>

<template>
  <div class="page-head">
    <h1 class="page-title">账号</h1>
    <span class="page-note">已登记 {{ total }} 个账号</span>
  </div>

  <div class="layout">
    <section class="card list-card">
      <h2 class="col-title">账号列表</h2>
      <Skeleton v-if="!accounts.ready" :rows="3" />
      <div v-else-if="!accounts.items.length" class="page-note">还没有账号，先在右侧添加一个离线账号。</div>
      <div v-else class="list">
        <div
          v-for="item in accounts.items"
          :key="item.id"
          class="row"
          :class="{ active: accounts.current?.id === item.id }"
          @click="select(item.id)"
        >
          <span class="avatar">{{ initial(item.username) }}</span>
          <span class="name">
            {{ item.username }}
            <span class="mono uuid">{{ item.uuid.slice(0, 8) }}</span>
          </span>
          <span class="tag">{{ label(item.type) }}</span>
          <span v-if="accounts.current?.id === item.id" class="tag real">当前</span>
          <button class="btn danger" @click.stop="remove(item.id, item.username)">移除</button>
        </div>
      </div>
    </section>

    <section class="card side">
      <h2 class="col-title">添加离线账号</h2>
      <p class="page-note">离线账号可正常启动游戏，但无法进入正版服务器。</p>
      <div class="add">
        <TextInput v-model="name" placeholder="账号名" />
        <button class="btn primary" :disabled="busy" @click="addOffline">添加</button>
      </div>

      <h2 class="col-title mt">微软正版登录</h2>
      <p class="page-note">浏览器阶段为演示流程，不会真正完成授权；桌面版将接入 device code 登录。</p>
      <button class="btn" @click="beginMs">开始登录</button>
    </section>
  </div>

  <Modal :open="msOpen" title="微软登录（演示）" @close="cancelMs">
    <template v-if="msInfo">
      <p class="page-note">{{ msInfo.message }}</p>
      <p class="code mono">{{ msInfo.userCode }}</p>
      <p class="page-note">验证地址：{{ msInfo.verificationUri }}</p>
    </template>
    <template #footer>
      <button class="btn" @click="cancelMs">取消</button>
    </template>
  </Modal>
</template>

<style scoped>
.layout {
  display: grid;
  grid-template-columns: minmax(320px, 1fr) 380px;
  gap: var(--space-4);
  align-items: start;
}

@media (max-width: 900px) {
  .layout {
    grid-template-columns: 1fr;
  }
}

.col-title {
  font-size: 14px;
  font-weight: 600;
  margin-bottom: var(--space-2);
}

.col-title.mt {
  margin-top: var(--space-5);
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
  border: 1px solid transparent;
  border-bottom-color: var(--border);
  border-radius: var(--radius-sm);
  cursor: pointer;
}

.row:hover {
  background: var(--surface-2);
}

.row.active {
  border-color: var(--accent);
  background: var(--accent-soft);
}

.avatar {
  width: 34px;
  height: 34px;
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  border-radius: var(--radius-sm);
  background: var(--surface-3);
  font-weight: 600;
}

.name {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.uuid {
  color: var(--text-mute);
}

.add {
  display: flex;
  gap: var(--space-2);
}

.btn.danger {
  color: var(--danger);
}

.code {
  margin: var(--space-3) 0;
  padding: var(--space-3);
  border-radius: var(--radius-sm);
  background: var(--surface-2);
  font-size: 18px;
  letter-spacing: 2px;
  text-align: center;
}
</style>
