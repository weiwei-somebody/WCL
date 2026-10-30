<script setup lang="ts">
/**
 * 导入确认弹窗：整合包与存档共用一套宿主，由 downloads.pendingImport 驱动。
 * 整合包在「下载」页或全局拖拽后弹出，存档同时在实例详情页提供入口。
 */
import { computed, ref, watch } from 'vue'
import { errText, listFolders, listLoaders, scanFolder, selectDir } from '@/api'
import { bridge } from '@/bridge'
import { useDownloadsStore } from '@/store/downloads'
import { useToastStore } from '@/store/toasts'
import Modal from '@/ui/primitives/Modal.vue'
import Pick from '@/ui/primitives/Pick.vue'
import TextInput from '@/ui/primitives/TextInput.vue'
import Toggle from '@/ui/primitives/Toggle.vue'
import type {
  GameFolder,
  InstalledVersion,
  LoaderName,
  ModpackConflictAction,
  ModpackInfo,
  ModpackInstallRequest,
  WorldCandidateInfo,
  WorldImportInfo,
  WorldImportOptions
} from '@shared/types'

const downloads = useDownloadsStore()
const toasts = useToastStore()
const isDesktop = computed(() => bridge.kind === 'electron')

const packInfo = computed<ModpackInfo | null>(() => {
  const pending = downloads.pendingImport
  return pending?.kind === 'modpack' ? pending.info : null
})
const worldInfo = computed<WorldImportInfo | null>(() => {
  const pending = downloads.pendingImport
  return pending?.kind === 'world' ? pending.info : null
})

const FORMAT_LABEL: Record<string, string> = { mrpack: 'Modrinth 整合包', curseforge: 'CurseForge 整合包', fullpack: '完整整合包', wcl: 'WCL 整合包' }
const LOADERS: Array<{ value: LoaderName | ''; label: string }> = [
  { value: '', label: '仅原版客户端' },
  { value: 'fabric', label: 'Fabric' },
  { value: 'forge', label: 'Forge' },
  { value: 'quilt', label: 'Quilt' },
  { value: 'neoforge', label: 'NeoForge' }
]

// ---------------- 整合包 ----------------
const folders = ref<GameFolder[]>([])
const targetFolder = ref('')
const nameSource = ref<'file' | 'inner' | 'custom'>('file')
const customName = ref('')
const conflictAction = ref<ModpackConflictAction>('rename')
const existingId = ref('')
const keySyncOverride = ref(false)
const packBusy = ref(false)

const packConflict = computed(() => {
  const info = packInfo.value
  if (!info) return null
  return (
    info.existingInstances.find((item) => item.folder === targetFolder.value && item.samePackVersion) ??
    info.existingInstances.find((item) => item.folder === targetFolder.value && item.sameNormalizedName) ??
    null
  )
})
const packName = computed(() => {
  if (nameSource.value === 'inner') return packInfo.value?.innerName ?? ''
  if (nameSource.value === 'custom') return customName.value.trim()
  return packInfo.value?.fileName ?? ''
})
const packSameName = computed(() => {
  const name = packName.value
  const info = packInfo.value
  if (!name || !info) return false
  return info.existingInstances.some((item) => item.folder === targetFolder.value && item.id === name)
})
const packBlocked = computed(() => {
  if (!packName.value) return true
  if (conflictAction.value === 'overwrite') return false
  return packSameName.value
})

// ---------------- 存档 ----------------
const candidateId = ref('.')
const worldName = ref('')
const mode = ref<'existing' | 'new'>('existing')
const worldFolder = ref('')
const versions = ref<InstalledVersion[]>([])
const targetVersionId = ref('')
const newName = ref('')
const newMc = ref('')
const newLoader = ref<LoaderName | ''>('')
const newLoaderVersion = ref('')
const loaderVersions = ref<string[]>([])
const allowMismatch = ref(false)
const ackMods = ref(false)
const worldBusy = ref(false)

const candidates = computed<WorldCandidateInfo[]>(() => worldInfo.value?.candidates ?? [])
const candidate = computed(() => candidates.value.find((item) => item.id === candidateId.value) ?? null)
const loaderOptions = computed(() => [
  { value: '', label: '最新版' },
  ...loaderVersions.value.map((item) => ({ value: item, label: item }))
])
const worldVersions = computed(() => versions.value.filter((item) => !item.incomplete && !item.failed))
const worldBlocked = computed(() => {
  if (!worldName.value.trim()) return true
  if (mode.value === 'new') return !newName.value.trim() || !newMc.value.trim()
  return !targetVersionId.value
})
const worldNeedsAck = computed(() => {
  const info = candidate.value
  if (!info) return false
  return info.loaderConfidence === 'inferred' && info.modEvidence.length > 0
})

function resetPack() {
  nameSource.value = 'file'
  customName.value = ''
  conflictAction.value = 'rename'
  existingId.value = ''
  keySyncOverride.value = false
  packBusy.value = false
}

function resetWorld() {
  const info = worldInfo.value
  const first = info?.candidates[0] ?? null
  candidateId.value = first?.id ?? '.'
  worldName.value = first?.worldName ?? ''
  mode.value = 'existing'
  targetVersionId.value = ''
  newName.value = first?.worldName ?? ''
  newMc.value = first?.minecraftVersion ?? ''
  newLoader.value = first?.loaderConfidence === 'inferred' ? '' : (first?.loader ?? '')
  newLoaderVersion.value = ''
  loaderVersions.value = []
  allowMismatch.value = false
  ackMods.value = false
  worldBusy.value = false
}

async function loadFolders() {
  try {
    const result = await listFolders()
    folders.value = result.folders
    return result.active
  } catch {
    folders.value = []
    return ''
  }
}

async function loadWorldVersions(folder: string) {
  if (!folder) {
    versions.value = []
    return
  }
  try {
    versions.value = (await scanFolder(folder)).versions
  } catch {
    versions.value = []
  }
  const hint = downloads.importHint
  if (hint?.versionId && worldVersions.value.some((item) => item.id === hint.versionId)) {
    targetVersionId.value = hint.versionId
    return
  }
  if (!targetVersionId.value && worldVersions.value.length) targetVersionId.value = worldVersions.value[0].id
}

async function loadWorldLoaders() {
  newLoaderVersion.value = ''
  loaderVersions.value = []
  if (!newLoader.value || !newMc.value.trim()) return
  try {
    loaderVersions.value = await listLoaders(newLoader.value, newMc.value.trim())
  } catch (error) {
    toasts.push(`加载器版本读取失败：${errText(error)}`, 'error')
  }
}

watch(
  () => downloads.pendingImport,
  async (pending) => {
    if (!pending) return
    const active = await loadFolders()
    if (pending.kind === 'modpack') {
      resetPack()
      targetFolder.value = active || folders.value[0]?.path || ''
      return
    }
    resetWorld()
    worldFolder.value = active || folders.value[0]?.path || ''
    await loadWorldVersions(worldFolder.value)
  }
)

watch(candidateId, () => {
  const info = candidate.value
  if (!info) return
  worldName.value = info.worldName
  newName.value = info.worldName
  newMc.value = info.minecraftVersion ?? ''
  newLoader.value = info.loaderConfidence === 'inferred' ? '' : (info.loader ?? '')
  allowMismatch.value = info.versionConfidence === 'unknown'
})

watch(newLoader, () => void loadWorldLoaders())
watch(newMc, () => void loadWorldLoaders())

async function pickWorldFile() {
  const path = isDesktop.value ? await selectDir() : 'demo:/存档/生存世界'
  if (!path) return
  try {
    await downloads.openImport(path)
  } catch (error) {
    toasts.push(errText(error), 'error')
  }
}

function close() {
  if (packBusy.value || worldBusy.value) return
  downloads.closeImport()
}

function confirmPack() {
  const info = packInfo.value
  const pending = downloads.pendingImport
  if (!info || !pending) return
  const opts: ModpackInstallRequest = {
    targetFolder: targetFolder.value || undefined,
    conflictAction: conflictAction.value,
    keySyncOverride: keySyncOverride.value
  }
  if (nameSource.value === 'custom') opts.instanceName = customName.value.trim()
  else opts.nameSource = nameSource.value
  const conflict = packConflict.value
  if (conflict) opts.existingId = conflict.id
  if (conflictAction.value === 'overwrite') opts.confirmReplace = true
  packBusy.value = true
  try {
    downloads.queueModpack(pending.path, info, opts)
    toasts.push('已加入下载队列，可在「下载」页查看进度', 'ok')
    downloads.closeImport()
  } catch (error) {
    toasts.push(errText(error), 'error')
  } finally {
    packBusy.value = false
  }
}

function confirmWorld() {
  const pending = downloads.pendingImport
  if (!pending) return
  const options: WorldImportOptions = {
    candidateId: candidateId.value,
    worldName: worldName.value.trim(),
    targetFolder: worldFolder.value,
    allowVersionMismatch: allowMismatch.value
  }
  if (mode.value === 'new') {
    options.newInstance = {
      instanceName: newName.value.trim(),
      minecraftVersion: newMc.value.trim()
    }
    if (newLoader.value) {
      options.newInstance.loader = newLoader.value
      if (newLoaderVersion.value) options.newInstance.loaderVersion = newLoaderVersion.value
    }
  } else {
    options.targetVersionId = targetVersionId.value
  }
  const label =
    mode.value === 'new' ? `新建实例 ${newName.value.trim()}` : (worldVersions.value.find((item) => item.id === targetVersionId.value)?.id ?? '')
  worldBusy.value = true
  try {
    downloads.queueWorld(pending.path, options, label)
    toasts.push('已加入下载队列，可在「下载」页查看进度', 'ok')
    downloads.closeImport()
  } catch (error) {
    toasts.push(errText(error), 'error')
  } finally {
    worldBusy.value = false
  }
}

defineExpose({ pickWorldFile })
</script>

<template>
  <Modal :open="!!packInfo" :title="`导入整合包 ${packInfo?.fileName ?? ''}`" width="620px" @close="close">
    <template v-if="packInfo">
      <div class="facts">
        <span class="tag">{{ FORMAT_LABEL[packInfo.format] ?? packInfo.format }}</span>
        <span class="tag">MC {{ packInfo.mcVersion }}</span>
        <span v-if="packInfo.loader" class="tag">{{ packInfo.loader }} {{ packInfo.loaderVersion }}</span>
        <span class="tag approx">文件 {{ packInfo.fileCount }} 个</span>
        <span v-if="packInfo.hasPresetKeys" class="tag">含作者预设</span>
      </div>
      <label class="form-row">
        <span class="form-label">安装位置</span>
        <Pick v-model="targetFolder" :options="folders.map((item) => ({ value: item.path, label: item.name }))" />
      </label>
      <label class="form-row">
        <span class="form-label">实例名称</span>
        <Pick
          v-model="nameSource"
          :options="[
            { value: 'file', label: `按文件名：${packInfo.fileName}` },
            { value: 'inner', label: `按包内名称：${packInfo.innerName}` },
            { value: 'custom', label: '自定义' }
          ]"
        />
      </label>
      <label v-if="nameSource === 'custom'" class="form-row">
        <span class="form-label">自定义名称</span>
        <TextInput v-model="customName" placeholder="实例名称" />
      </label>
      <label v-if="packConflict" class="form-row">
        <span class="form-label">{{ packConflict.samePackVersion ? '同名同版本实例' : '同名实例' }}</span>
        <Pick
          v-model="conflictAction"
          :options="[
            { value: 'new', label: '保留两份（新实例自动编号）' },
            { value: 'overwrite', label: `覆盖既有实例 ${packConflict.id}` }
          ]"
        />
      </label>
      <label class="form-row">
        <span class="form-label">键位预设</span>
        <span class="op-toggle">
          <Toggle v-model="keySyncOverride" />
          <span class="page-note">用启动器默认键位覆盖整合包预设</span>
        </span>
      </label>
      <p v-if="conflictAction === 'overwrite'" class="warn-note">
        覆盖会清除既有实例 {{ existingId || packConflict?.id }} 的模组与配置，此操作不可撤销。
      </p>
      <p class="page-note note-foot">
        加入队列后由下载页串行执行；CurseForge 包内需要登录才能下载的文件会在下载页提示手动补充。
      </p>
    </template>
    <template #footer>
      <button class="btn" @click="close">取消</button>
      <button class="btn primary" :disabled="packBlocked || packBusy" @click="confirmPack">加入下载队列</button>
    </template>
  </Modal>

  <Modal :open="!!worldInfo" :title="`导入存档 ${worldInfo?.candidates[0]?.worldName ?? ''}`" width="620px" @close="close">
    <template v-if="worldInfo">
      <div class="facts">
        <span class="tag">{{ worldInfo.sourceType === 'zip' ? '压缩包' : '文件夹' }}</span>
        <span class="tag approx">候选 {{ candidates.length }} 个</span>
      </div>
      <label v-if="candidates.length > 1" class="form-row">
        <span class="form-label">要导入的世界</span>
        <Pick v-model="candidateId" :options="candidates.map((item) => ({ value: item.id, label: item.worldName }))" />
      </label>
      <div v-if="candidate" class="facts">
        <span v-if="candidate.minecraftVersion" class="tag">MC {{ candidate.minecraftVersion }}</span>
        <span class="tag approx">{{ candidate.versionConfidence === 'exact' ? '版本精确' : candidate.versionConfidence === 'approximate' ? '版本近似' : '版本未知' }}</span>
        <span v-if="candidate.gameMode" class="tag">{{ candidate.gameMode }}</span>
        <span v-if="candidate.hardcore" class="tag">极限模式</span>
        <span v-if="candidate.datapackCount" class="tag">数据包 {{ candidate.datapackCount }}</span>
        <span v-if="candidate.loader" class="tag">{{ candidate.loader }}</span>
      </div>
      <label class="form-row">
        <span class="form-label">存档名称</span>
        <TextInput v-model="worldName" placeholder="存档名称" />
      </label>
      <label class="form-row">
        <span class="form-label">导入方式</span>
        <Pick
          v-model="mode"
          :options="[
            { value: 'existing', label: '导入到已有实例' },
            { value: 'new', label: '新建实例并导入' }
          ]"
        />
      </label>
      <label class="form-row">
        <span class="form-label">游戏文件夹</span>
        <Pick v-model="worldFolder" :options="folders.map((item) => ({ value: item.path, label: item.name }))" />
      </label>
      <template v-if="mode === 'existing'">
        <label class="form-row">
          <span class="form-label">目标实例</span>
          <Pick v-model="targetVersionId" :options="worldVersions.map((item) => ({ value: item.id, label: `${item.id}（MC ${item.mcVersion}）` }))" />
        </label>
      </template>
      <template v-else>
        <label class="form-row">
          <span class="form-label">实例名称</span>
          <TextInput v-model="newName" placeholder="实例名称" />
        </label>
        <label class="form-row">
          <span class="form-label">Minecraft 版本</span>
          <TextInput v-model="newMc" placeholder="如 1.20.1" />
        </label>
        <label class="form-row">
          <span class="form-label">模组加载器</span>
          <Pick v-model="newLoader" :options="LOADERS" />
        </label>
        <label v-if="newLoader" class="form-row">
          <span class="form-label">加载器版本</span>
          <Pick v-model="newLoaderVersion" :options="loaderOptions" />
        </label>
      </template>
      <label class="form-row">
        <span class="form-label">版本校验</span>
        <span class="op-toggle">
          <Toggle v-model="allowMismatch" />
          <span class="page-note">允许存档版本与目标实例不一致</span>
        </span>
      </label>
      <label v-if="worldNeedsAck" class="form-row">
        <span class="form-label">模组确认</span>
        <span class="op-toggle">
          <Toggle v-model="ackMods" />
          <span class="page-note">已确认存档依赖这些模组：{{ candidate?.modEvidence.join('、') }}</span>
        </span>
      </label>
      <p v-if="worldInfo.warnings.length" class="warn-note">{{ worldInfo.warnings.join('；') }}</p>
    </template>
    <template #footer>
      <button class="btn" @click="close">取消</button>
      <button class="btn primary" :disabled="worldBlocked || worldBusy || (worldNeedsAck && !ackMods)" @click="confirmWorld">
        加入下载队列
      </button>
    </template>
  </Modal>
</template>

<style scoped>
.facts {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-bottom: var(--space-3);
}

.form-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin-bottom: var(--space-3);
}

.form-label {
  flex: 0 0 96px;
  color: var(--text-dim);
  font-size: 12px;
}

.op-toggle {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.warn-note {
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--danger);
  border-radius: var(--radius-sm);
  background: var(--danger-soft);
  color: var(--text);
  font-size: 12px;
  line-height: 1.6;
}
</style>
