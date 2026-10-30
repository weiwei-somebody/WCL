<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  applyOfflineSkin,
  changeCape,
  deleteSkinHistory,
  errText,
  getSkinAvatar,
  getSkinHistory,
  getSkinProfile,
  renameSkinHistory,
  resetOfflineSkin,
  selectImage,
  uploadSkin,
  uploadSkinBytes,
  uploadSkinFromHistory
} from '@/api'
import type { CapeInfo, ProfileSkins, SkinHistoryEntry, SkinVariant } from '@shared/types'
import { useAccountsStore } from '@/store/accounts'
import { useToastStore } from '@/store/toasts'
import SkinViewer3D from '@/components/SkinViewer3D.vue'
import type { SkinPreviewAnimation } from '@/data/skinModel'
import DesktopOnly from '@/ui/primitives/DesktopOnly.vue'
import Empty from '@/ui/primitives/Empty.vue'
import Skeleton from '@/ui/primitives/Skeleton.vue'
import TextInput from '@/ui/primitives/TextInput.vue'
import Toggle from '@/ui/primitives/Toggle.vue'

const router = useRouter()
const accounts = useAccountsStore()
const toasts = useToastStore()

const profile = ref<ProfileSkins | null>(null)
const history = ref<SkinHistoryEntry[]>([])
const avatar = ref('')
const loading = ref(false)
const profileError = ref('')
const historyError = ref('')
const busy = ref(false)
const capeBusy = ref('')
const historyBusy = ref('')
const variant = ref<SkinVariant>('classic')
const previewAnim = ref<SkinPreviewAnimation>('walk')
const autoRotate = ref(true)
const renamingId = ref('')
const renameText = ref('')
const viewer = ref<InstanceType<typeof SkinViewer3D> | null>(null)

const animModes: Array<{ key: SkinPreviewAnimation; label: string }> = [
  { key: 'walk', label: '行走' },
  { key: 'idle', label: '待机' },
  { key: 'crouch', label: '蹲下' },
  { key: 'fly', label: '飞行' }
]

let profileToken = 0
let historyToken = 0

const currentSkin = computed(() => profile.value?.skins[0] ?? null)
const currentVariant = computed<SkinVariant>(() => (currentSkin.value?.variant === 'slim' ? 'slim' : 'classic'))
const capes = computed(() => profile.value?.capes ?? [])
const activeCape = computed(() => capes.value.find((item) => item.active)?.dataUrl ?? '')
const previewSkin = computed(() => currentSkin.value?.dataUrl ?? '')
const avatarStyle = computed(() => (avatar.value ? { backgroundImage: `url(${avatar.value})` } : {}))

function accountId(): string {
  return accounts.current?.id ?? ''
}

async function loadProfile(refresh = false): Promise<void> {
  const token = ++profileToken
  profileError.value = ''
  try {
    const next = await getSkinProfile(refresh, accountId() || undefined)
    if (token !== profileToken) return
    profile.value = next
  } catch (error) {
    if (token === profileToken) profileError.value = errText(error)
  }
}

async function loadHistory(): Promise<void> {
  const token = ++historyToken
  historyError.value = ''
  try {
    const next = await getSkinHistory(accountId() || undefined)
    if (token !== historyToken) return
    history.value = next
  } catch (error) {
    if (token === historyToken) historyError.value = errText(error)
  }
}

async function loadAvatar(): Promise<void> {
  try {
    avatar.value = (await getSkinAvatar(accountId() || undefined)) ?? ''
  } catch {
    avatar.value = ''
  }
}

async function load(): Promise<void> {
  loading.value = true
  await Promise.all([loadProfile(), loadHistory(), loadAvatar()])
  loading.value = false
}

async function refresh(): Promise<void> {
  await Promise.all([loadProfile(true), loadHistory()])
}

async function applyVariant(next: SkinVariant): Promise<void> {
  const url = currentSkin.value?.dataUrl
  const id = accountId()
  if (busy.value || !url || !id) {
    if (!url) toasts.push('当前没有皮肤，先上传一个再切换模型', 'error')
    return
  }
  busy.value = true
  try {
    profile.value = await uploadSkinBytes(url, next, id)
    variant.value = next
    toasts.push(`已切换为${next === 'slim' ? '纤细' : '经典'}模型`, 'ok')
  } catch (error) {
    toasts.push(errText(error), 'error')
  } finally {
    busy.value = false
  }
}

async function pickSkin(): Promise<void> {
  const id = accountId()
  if (busy.value || !id) return
  busy.value = true
  try {
    const picked = await selectImage()
    if (!picked) return
    if (picked.startsWith('data:')) profile.value = await uploadSkinBytes(picked, variant.value, id)
    else if (accounts.current?.type === 'offline') profile.value = await applyOfflineSkin(picked, variant.value, id)
    else profile.value = await uploadSkin(picked, variant.value)
    toasts.push('皮肤已应用', 'ok')
    await loadHistory()
  } catch (error) {
    toasts.push(errText(error), 'error')
  } finally {
    busy.value = false
  }
}

async function resetSkin(): Promise<void> {
  const id = accountId()
  if (busy.value || !id) return
  busy.value = true
  try {
    profile.value = await resetOfflineSkin(id)
    toasts.push('已恢复默认皮肤', 'ok')
  } catch (error) {
    toasts.push(errText(error), 'error')
  } finally {
    busy.value = false
  }
}

async function pickCape(cape: CapeInfo): Promise<void> {
  if (capeBusy.value) return
  capeBusy.value = cape.id
  try {
    profile.value = await changeCape(cape.active ? null : cape.id)
    toasts.push(cape.active ? '已卸下披风' : `已换上披风「${cape.alias}」`, 'ok')
  } catch (error) {
    toasts.push(errText(error), 'error')
  } finally {
    capeBusy.value = ''
  }
}

function historyName(item: SkinHistoryEntry): string {
  return item.name || `${item.id}.png`
}

function startRename(item: SkinHistoryEntry): void {
  renamingId.value = item.id
  renameText.value = item.name ?? ''
}

function cancelRename(): void {
  renamingId.value = ''
  renameText.value = ''
}

async function commitRename(item: SkinHistoryEntry): Promise<void> {
  if (renamingId.value !== item.id) return
  const name = renameText.value.trim()
  cancelRename()
  if (name === (item.name ?? '')) return
  historyBusy.value = item.id
  try {
    history.value = await renameSkinHistory(item.id, name, accountId() || undefined)
    toasts.push('已重命名该记录', 'ok')
  } catch (error) {
    toasts.push(errText(error), 'error')
  } finally {
    historyBusy.value = ''
  }
}

async function removeHistory(item: SkinHistoryEntry): Promise<void> {
  if (historyBusy.value) return
  historyBusy.value = item.id
  try {
    history.value = await deleteSkinHistory(item.id, accountId() || undefined)
    toasts.push('已删除该历史记录', 'ok')
  } catch (error) {
    toasts.push(errText(error), 'error')
  } finally {
    historyBusy.value = ''
  }
}

async function applyHistory(item: SkinHistoryEntry): Promise<void> {
  const id = accountId()
  if (historyBusy.value || !id) return
  historyBusy.value = item.id
  try {
    profile.value = await uploadSkinFromHistory(item.id, id)
    variant.value = item.variant
    toasts.push('已换回该历史皮肤', 'ok')
  } catch (error) {
    toasts.push(errText(error), 'error')
  } finally {
    historyBusy.value = ''
  }
}

function fmtTime(time: number): string {
  const date = new Date(time)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

watch(currentVariant, (next) => {
  variant.value = next
})

watch(
  () => accounts.current?.id,
  () => {
    profileToken++
    historyToken++
    profile.value = null
    history.value = []
    avatar.value = ''
    profileError.value = ''
    historyError.value = ''
    cancelRename()
    void load()
  }
)

onMounted(async () => {
  if (!accounts.ready) await accounts.load()
  await load()
})

onUnmounted(() => {
  profileToken++
  historyToken++
})
</script>

<template>
  <div class="page-head">
    <h1 class="page-title">皮肤与披风</h1>
    <span class="page-note">离线账号也可自定义皮肤，启动时由本地皮肤服务注入到游戏中</span>
    <div class="grow" />
    <button class="btn" :disabled="loading || !accountId()" @click="refresh">刷新档案</button>
  </div>

  <Skeleton v-if="loading && !profile" :rows="6" />

  <div v-else class="layout">
    <section class="card pane preview-pane">
      <header class="pane-head">
        <h2 class="pane-title">3D 预览</h2>
        <div class="head-ops">
          <span class="page-note">自动旋转</span>
          <Toggle v-model="autoRotate" />
        </div>
      </header>
      <SkinViewer3D
        ref="viewer"
        :skin="previewSkin"
        :cape="activeCape"
        :variant="currentVariant"
        :animation="previewAnim"
        :auto-rotate="autoRotate"
        height="320px"
      />
      <div class="seg">
        <button
          v-for="mode in animModes"
          :key="mode.key"
          class="seg-btn"
          :class="{ active: previewAnim === mode.key }"
          @click="previewAnim = mode.key"
        >
          {{ mode.label }}
        </button>
      </div>
      <div class="preview-foot">
        <span class="page-note">拖动旋转 · 滚轮缩放</span>
        <button class="btn" @click="viewer?.resetView()">回正视角</button>
      </div>
    </section>

    <section class="card pane info-pane">
      <header class="pane-head">
        <h2 class="pane-title">皮肤档案</h2>
        <span class="tag mock">模拟</span>
      </header>

      <div v-if="profileError" class="alert">
        <span>读取皮肤档案失败：{{ profileError }}</span>
        <button class="btn" @click="loadProfile(true)">重试</button>
      </div>

      <div v-if="!accounts.current" class="alert">
        <span>未选择账号：预览使用内置皮肤，换肤与披风需要先添加账号。</span>
        <button class="btn" @click="router.push('/accounts')">前往账号页</button>
      </div>

      <div class="account">
        <span class="avatar" :style="avatarStyle" />
        <div class="account-main">
          <span class="account-name">{{ profile?.username ?? accounts.current?.username ?? '未选择账号' }}</span>
          <span class="page-note">{{ accounts.current?.type === 'offline' ? '离线档案：皮肤只在本机生效，进服后同样显示' : '正版档案：改动会同步到账号' }}</span>
        </div>
        <span class="tag" :class="currentVariant === 'slim' ? 'approx' : ''">
          {{ currentVariant === 'slim' ? '纤细' : '经典' }}
        </span>
      </div>

      <div class="field">
        <span class="field-label">皮肤模型</span>
        <div class="seg">
          <button
            class="seg-btn"
            :class="{ active: variant === 'classic' }"
            :disabled="busy || !accountId()"
            @click="applyVariant('classic')"
          >
            经典 Classic
          </button>
          <button
            class="seg-btn"
            :class="{ active: variant === 'slim' }"
            :disabled="busy || !accountId()"
            @click="applyVariant('slim')"
          >
            纤细 Slim
          </button>
        </div>
      </div>

      <div class="actions">
        <button class="btn primary" :disabled="busy || !accountId()" @click="pickSkin">
          {{ busy ? '处理中…' : '上传皮肤' }}
        </button>
        <button class="btn" :disabled="busy || !accountId()" @click="resetSkin">恢复默认皮肤</button>
      </div>
      <p class="page-note">支持 64×64 的 PNG；离线账号选择文件后立即生效，下次启动游戏即按此皮肤渲染。</p>
      <DesktopOnly note="正版账号上传与真实生效需要桌面版" />
    </section>

    <section class="card pane cape-pane">
      <header class="pane-head">
        <h2 class="pane-title">披风（{{ capes.length }}）</h2>
        <span v-if="activeCape" class="tag real">使用中</span>
      </header>
      <Empty v-if="!capes.length" text="该账号暂无披风" note="披风由账号档案提供，可在桌面版与正版账号同步。" />
      <div v-else class="cape-grid">
        <button
          v-for="cape in capes"
          :key="cape.id"
          class="cape-item"
          :class="{ active: cape.active }"
          :disabled="!!capeBusy"
          @click="pickCape(cape)"
        >
          <span class="cape-preview">
            <img v-if="cape.dataUrl" :src="cape.dataUrl" class="cape-img" :alt="cape.alias" />
            <span v-else class="cape-alias">{{ cape.alias }}</span>
          </span>
          <span class="cape-name">{{ cape.alias }}</span>
          <span class="cape-state">
            <span v-if="capeBusy === cape.id" class="page-note">处理中…</span>
            <span v-else-if="cape.active" class="tag real">使用中</span>
            <span v-else class="tag">点击使用</span>
          </span>
        </button>
      </div>
    </section>

    <section class="card pane history-pane">
      <header class="pane-head">
        <h2 class="pane-title">历史皮肤（{{ history.length }}）</h2>
        <button v-if="history.length" class="btn" :disabled="loading" @click="loadHistory">重新读取</button>
      </header>

      <div v-if="historyError" class="alert">
        <span>读取历史失败：{{ historyError }}</span>
        <button class="btn" @click="loadHistory">重试</button>
      </div>
      <Empty
        v-else-if="!history.length"
        text="暂无历史皮肤"
        note="上传过的皮肤会保存在这里，方便随时换回。"
      />
      <div v-else class="history-list">
        <div v-for="item in history" :key="item.id" class="history-item">
          <span class="history-preview">
            <img :src="item.dataUrl" class="history-img" :alt="historyName(item)" />
          </span>
          <div class="history-main">
            <TextInput
              v-if="renamingId === item.id"
              v-model="renameText"
              @keydown.enter="!$event.isComposing && commitRename(item)"
              @keydown.esc="cancelRename"
              @blur="commitRename(item)"
            />
            <button v-else class="history-name" title="点击重命名" @click="startRename(item)">
              {{ historyName(item) }}
            </button>
            <div class="history-meta">
              <span class="tag" :class="item.variant === 'slim' ? 'approx' : ''">
                {{ item.variant === 'slim' ? '纤细' : '经典' }}
              </span>
              <span class="page-note">{{ fmtTime(item.time) }}</span>
            </div>
          </div>
          <div class="history-ops">
            <button class="btn primary" :disabled="!!historyBusy" @click="applyHistory(item)">
              {{ historyBusy === item.id ? '处理中…' : '换回' }}
            </button>
            <button class="btn danger" :disabled="!!historyBusy" @click="removeHistory(item)">删除</button>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.grow {
  flex: 1;
}

.layout {
  display: grid;
  grid-template-columns: minmax(280px, 1fr) minmax(320px, 1.2fr);
  gap: var(--space-4);
  align-items: start;
}

.preview-pane {
  grid-column: 1;
}

.info-pane {
  grid-column: 2;
}

.cape-pane {
  grid-column: 1;
}

.history-pane {
  grid-column: 1 / -1;
}

@media (max-width: 900px) {
  .layout {
    grid-template-columns: 1fr;
  }

  .preview-pane,
  .info-pane,
  .cape-pane,
  .history-pane {
    grid-column: 1;
  }
}

.pane {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.pane-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
}

.pane-title {
  font-size: 14px;
  font-weight: 600;
}

.head-ops {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.seg {
  display: flex;
  gap: 2px;
  padding: 3px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface-2);
}

.seg-btn {
  flex: 1;
  height: 26px;
  padding: 0 var(--space-3);
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text-dim);
  cursor: pointer;
  white-space: nowrap;
  transition: background var(--dur) var(--ease), color var(--dur) var(--ease);
}

.seg-btn:hover:not(.active):not(:disabled) {
  color: var(--text);
}

.seg-btn.active {
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 600;
}

.seg-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.preview-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}

.alert {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  padding: var(--space-3);
  border: 1px solid rgba(241, 106, 106, 0.5);
  border-radius: var(--radius-sm);
  color: var(--danger);
  font-size: 13px;
}

.account {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.avatar {
  width: 40px;
  height: 40px;
  flex: 0 0 auto;
  border-radius: var(--radius-sm);
  background-color: var(--surface-3);
  background-size: 800% 800%;
  background-position: -100% -100%;
  image-rendering: pixelated;
}

.account-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.account-name {
  font-weight: 600;
}

.field {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.field-label {
  flex: 0 0 auto;
  color: var(--text-dim);
  font-size: 13px;
}

.field .seg {
  flex: 1;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.cape-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: var(--space-3);
}

.cape-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface-2);
  color: var(--text);
  cursor: pointer;
  transition: border-color var(--dur) var(--ease), background var(--dur) var(--ease);
}

.cape-item:hover:not(:disabled) {
  border-color: var(--border-strong);
}

.cape-item:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.cape-item.active {
  border-color: var(--accent);
  background: var(--accent-soft);
}

.cape-preview {
  display: grid;
  place-items: center;
  width: 64px;
  height: 96px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface);
  overflow: hidden;
}

.cape-img {
  width: 48px;
  image-rendering: pixelated;
}

.cape-alias {
  padding: 0 var(--space-2);
  color: var(--text-dim);
  font-size: 12px;
  text-align: center;
  word-break: break-all;
}

.cape-name {
  max-width: 100%;
  overflow: hidden;
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.history-list {
  display: flex;
  flex-direction: column;
}

.history-item {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3);
  border-bottom: 1px solid var(--border);
}

.history-preview {
  display: grid;
  place-items: center;
  width: 56px;
  height: 88px;
  flex: 0 0 auto;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface-2);
  overflow: hidden;
}

.history-img {
  height: 80px;
  image-rendering: pixelated;
}

.history-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.history-name {
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--text);
  font-size: 13px;
  text-align: left;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  cursor: text;
}

.history-name:hover {
  color: var(--accent);
}

.history-meta {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.history-ops {
  display: flex;
  gap: var(--space-2);
}

.btn.danger {
  color: var(--danger);
}
</style>
