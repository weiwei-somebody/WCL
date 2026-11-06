<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  centerBackups,
  centerDiagnose,
  centerOperation,
  centerOverview,
  centerScreenshots,
  centerWorlds,
  errText,
  getIsolationPlan,
  migrateInstance,
  onInstanceMigrateProgress,
  openDir,
  removeFs,
  selectDir,
  setVersionIsolation,
  setVersionJava,
  setVersionResolution
} from '@/api'
import { bridge } from '@/bridge'
import { useDownloadsStore } from '@/store/downloads'
import { useLaunchStore } from '@/store/launch'
import { useToastStore } from '@/store/toasts'
import { useVersionsStore } from '@/store/versions'
import ResourceFiles from '@/components/ResourceFiles.vue'
import InstanceServers from '@/components/InstanceServers.vue'
import Empty from '@/ui/primitives/Empty.vue'
import Field from '@/ui/primitives/Field.vue'
import Modal from '@/ui/primitives/Modal.vue'
import Pick from '@/ui/primitives/Pick.vue'
import Skeleton from '@/ui/primitives/Skeleton.vue'
import TextInput from '@/ui/primitives/TextInput.vue'
import Toggle from '@/ui/primitives/Toggle.vue'
import type { DiagnosticFinding, InstanceOperation, InstanceOverview, InstanceScreenshot, InstanceWorld } from '@shared/instanceCenter'
import type { GameWindowMode, InstalledVersion, InstanceMigrationResult, IsolationMigrationPlan, ModpackExportOptions } from '@shared/types'

interface BackupRow {
  path: string
  size: number
  sha256: string
  createdAt: string
  title: string
}

const DESC_KEY = 'wcl.center.desc'

const SECTIONS = [
  { id: 'overview', label: '概览' },
  { id: 'settings', label: '设置' },
  { id: 'mods', label: '模组' },
  { id: 'packs', label: '资源包' },
  { id: 'shaders', label: '光影' },
  { id: 'screenshots', label: '截图' },
  { id: 'recordings', label: '录像' },
  { id: 'projections', label: '蓝图' },
  { id: 'worlds', label: '世界' },
  { id: 'servers', label: '服务器' },
  { id: 'backups', label: '备份' },
  { id: 'diagnose', label: '诊断' }
]

const MODE_LABELS: Record<string, string> = { windowed: '窗口', maximized: '最大化', fullscreen: '全屏' }
const LOADER_LABELS: Record<string, string> = { fabric: 'Fabric', forge: 'Forge', quilt: 'Quilt', neoforge: 'NeoForge' }
const CONFIDENCE_LABELS: Record<string, string> = { certain: '确定', possible: '可能', unknown: '未知' }
const EXPORT_FORMAT_OPTIONS = [
  { value: 'zip', label: '普通 zip' },
  { value: 'wcl', label: 'WCL 整合包' },
  { value: 'curseforge', label: 'CurseForge' },
  { value: 'modrinth', label: 'Modrinth' }
]
const EXPORT_TYPE_OPTIONS: Array<{ key: keyof ModpackExportOptions['types']; label: string }> = [
  { key: 'mods', label: '模组' },
  { key: 'config', label: '配置' },
  { key: 'resourcePacks', label: '资源包' },
  { key: 'shaderPacks', label: '光影' },
  { key: 'saves', label: '存档' },
  { key: 'servers', label: '服务器列表' },
  { key: 'launcherSettings', label: '启动器设置' }
]
const EXPORT_DEST_KEY = 'wcl.export.dest'

const route = useRoute()
const router = useRouter()
const versions = useVersionsStore()
const toasts = useToastStore()
const launch = useLaunchStore()
const downloads = useDownloadsStore()
const isDesktop = bridge.kind === 'electron'

const section = ref('overview')
const busy = ref('')
const modal = ref<'' | 'rename' | 'desc' | 'clone'>('')
const preview = ref<InstanceScreenshot | null>(null)
const renameName = ref('')
const cloneName = ref('')
const descInput = ref('')
const desc = ref('')
const exportOpen = ref(false)
const exportName = ref('')
const exportVersion = ref('')
const exportAuthor = ref('')
const exportDescription = ref('')
const exportFormat = ref<ModpackExportOptions['format']>('zip')
const exportEnabledOnly = ref(true)
const exportDest = ref('')
const exportTypes = ref<ModpackExportOptions['types']>({
  mods: true,
  config: true,
  resourcePacks: true,
  shaderPacks: false,
  saves: false,
  servers: false,
  launcherSettings: true
})
const overview = ref<InstanceOverview | null>(null)
const plan = ref<IsolationMigrationPlan | null>(null)
const worlds = ref<InstanceWorld[]>([])
const shots = ref<InstanceScreenshot[]>([])
const backups = ref<BackupRow[]>([])
const findings = ref<DiagnosticFinding[]>([])
const javaPath = ref('')
const javaAuto = ref(true)
const resWidth = ref(854)
const resHeight = ref(480)
const resMode = ref<GameWindowMode>('windowed')
const migrateOpen = ref(false)
const migrateTargetId = ref('')
const migrating = ref(false)
const migrateText = ref('')
const migrateResult = ref<InstanceMigrationResult | null>(null)

const id = computed(() => String(route.params.id ?? ''))
const instance = computed(() => versions.installed.find((row) => row.id === id.value) ?? null)
const rootFolder = computed(() => instance.value?.folder ?? '')
const dir = computed(() => instance.value?.gameDirectory ?? instance.value?.folder ?? '')
const running = computed(() => launch.state?.versionId === id.value && (launch.running || launch.launching))
const modeOptions = Object.keys(MODE_LABELS).map((value) => ({ value, label: MODE_LABELS[value] }))
const migrateOptions = computed(() =>
  versions.installed
    .filter((row) => row.id !== id.value)
    .map((row) => ({ value: row.id, label: row.id, hint: `${row.mcVersion}${row.loader ? ` · ${LOADER_LABELS[row.loader] ?? row.loader}` : ''}` }))
)

function openMigrate() {
  migrateTargetId.value = migrateOptions.value[0]?.value ?? ''
  migrateResult.value = null
  migrateText.value = ''
  migrateOpen.value = true
}

async function runMigrate() {
  if (!migrateTargetId.value) {
    toasts.push('请先选择要迁移到的目标实例', 'error')
    return
  }
  if (launch.running && launch.state?.versionId === migrateTargetId.value) {
    toasts.push('目标实例正在运行，请先关闭游戏再迁移', 'error')
    return
  }
  migrating.value = true
  migrateResult.value = null
  migrateText.value = '正在读取源实例资源…'
  const off = onInstanceMigrateProgress((row) => {
    migrateText.value = row.text
  })
  try {
    migrateResult.value = await migrateInstance(id.value, migrateTargetId.value)
    const result = migrateResult.value
    toasts.push(`迁移完成：成功 ${result.migrated} 个，失败 ${result.failed} 个`, result.failed ? 'error' : 'ok')
    await versions.loadInstalled()
  } catch (error) {
    toasts.push(errText(error), 'error')
  } finally {
    off()
    migrating.value = false
  }
}

function readDesc(key: string): string {
  try {
    const raw = localStorage.getItem(DESC_KEY)
    const map = raw ? (JSON.parse(raw) as Record<string, string>) : {}
    return map[key] ?? ''
  } catch {
    return ''
  }
}

function writeDesc(key: string, text: string): void {
  let map: Record<string, string> = {}
  try {
    const raw = localStorage.getItem(DESC_KEY)
    map = raw ? (JSON.parse(raw) as Record<string, string>) : {}
  } catch {
    map = {}
  }
  map[key] = text
  localStorage.setItem(DESC_KEY, JSON.stringify(map))
}

function fmtSize(bytes: number): string {
  if (!bytes) return '未知'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function fmtTime(value: number | string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function runOperation(action: InstanceOperation, okText: string) {
  busy.value = 'op'
  return centerOperation(id.value, rootFolder.value, action)
    .then(async (result) => {
      if (result.ok) toasts.push(okText, 'ok')
      else toasts.push(result.error ?? '操作失败', 'error')
      await versions.loadInstalled()
      await loadSection()
      return result
    })
    .catch((error) => {
      toasts.push(errText(error), 'error')
      return { ok: false, error: errText(error) }
    })
    .finally(() => {
      busy.value = ''
    })
}

/** 从实例页发起存档导入：先选存档文件夹，再交给统一导入流程识别。 */
async function importWorld() {
  const row = instance.value
  if (!row) return
  try {
    const picked = await selectDir()
    if (!picked) return
    await downloads.openImport(picked, { versionId: row.id, folder: row.folder })
  } catch (error) {
    toasts.push(errText(error), 'error')
  }
}

function readExportDest(): string {
  try {
    return localStorage.getItem(EXPORT_DEST_KEY) ?? ''
  } catch {
    return ''
  }
}

function openExport() {
  const row = instance.value
  if (!row) return
  exportName.value = row.modpackName || row.id
  exportVersion.value = row.modpackVersion || '1.0.0'
  exportAuthor.value = ''
  exportDescription.value = ''
  exportFormat.value = 'zip'
  exportEnabledOnly.value = true
  exportTypes.value = {
    mods: true,
    config: true,
    resourcePacks: true,
    shaderPacks: false,
    saves: false,
    servers: false,
    launcherSettings: true
  }
  exportDest.value = readExportDest()
  exportOpen.value = true
}

async function pickExportDest() {
  try {
    const picked = await selectDir()
    if (picked) exportDest.value = picked
  } catch (error) {
    toasts.push(errText(error), 'error')
  }
}

function toggleExportType(key: keyof ModpackExportOptions['types']) {
  exportTypes.value[key] = !exportTypes.value[key]
}

function confirmExport() {
  const row = instance.value
  if (!row) return
  const name = exportName.value.trim()
  if (!name) {
    toasts.push('整合包名称不能为空', 'error')
    return
  }
  if (!exportDest.value.trim()) {
    toasts.push('请选择保存位置', 'error')
    return
  }
  if (!EXPORT_TYPE_OPTIONS.some((item) => exportTypes.value[item.key])) {
    toasts.push('至少勾选一项要导出的内容', 'error')
    return
  }
  const options: ModpackExportOptions = {
    versionId: row.id,
    folder: row.folder,
    name,
    version: exportVersion.value.trim() || '1.0.0',
    author: exportAuthor.value.trim(),
    description: exportDescription.value.trim(),
    format: exportFormat.value,
    types: { ...exportTypes.value },
    enabledModsOnly: exportEnabledOnly.value,
    destination: exportDest.value.trim()
  }
  try {
    localStorage.setItem(EXPORT_DEST_KEY, options.destination)
  } catch {
    /* 忽略本地存储不可用 */
  }
  const formatLabel = EXPORT_FORMAT_OPTIONS.find((item) => item.value === options.format)?.label ?? options.format
  downloads.queueExport(options, row.id, `${formatLabel} · ${row.mcVersion}`)
  exportOpen.value = false
  toasts.push('导出任务已加入下载队列', 'ok')
}

async function loadSection() {
  if (!instance.value) return
  try {
    if (section.value === 'worlds') worlds.value = await centerWorlds(id.value, rootFolder.value)
    else if (section.value === 'screenshots') shots.value = await centerScreenshots(id.value, rootFolder.value)
    else if (section.value === 'backups') {
      const rows = await centerBackups(id.value, rootFolder.value)
      backups.value = rows.map((row) => ({
        path: row.id,
        size: row.files.reduce((sum, file) => sum + file.size, 0),
        sha256: '',
        createdAt: row.createdAt,
        title: row.title
      }))
    }
    else if (section.value === 'diagnose') findings.value = await centerDiagnose(id.value, rootFolder.value)
  } catch (error) {
    toasts.push(errText(error), 'error')
  }
}

function syncForm(row: InstalledVersion) {
  desc.value = readDesc(row.id)
  javaPath.value = row.javaPath ?? ''
  javaAuto.value = row.javaAuto !== false
  resWidth.value = row.resolution?.width ?? 854
  resHeight.value = row.resolution?.height ?? 480
  resMode.value = row.resolution?.mode ?? 'windowed'
}

async function reload() {
  await versions.loadInstalled()
  if (!instance.value) return
  syncForm(instance.value)
  try {
    overview.value = await centerOverview(id.value, rootFolder.value)
    plan.value = await getIsolationPlan(id.value, rootFolder.value)
  } catch (error) {
    toasts.push(errText(error), 'error')
  }
  await loadSection()
}

async function startGame() {
  try {
    await launch.launch(id.value, rootFolder.value)
    toasts.push('已发出启动请求（浏览器阶段为模拟启动）', 'ok')
  } catch (error) {
    toasts.push(errText(error), 'error')
  }
}

async function setActive() {
  try {
    await versions.setActive(id.value)
    toasts.push(`${id.value} 已设为当前实例`, 'ok')
  } catch (error) {
    toasts.push(errText(error), 'error')
  }
}

function openRename() {
  renameName.value = id.value
  modal.value = 'rename'
}

async function confirmRename() {
  const name = renameName.value.trim()
  if (!name) {
    toasts.push('实例名不能为空', 'error')
    return
  }
  modal.value = ''
  if (name === id.value) return
  try {
    await versions.rename(id.value, name)
    writeDesc(name, readDesc(id.value))
    toasts.push(`已重命名为 ${name}`, 'ok')
    await router.replace({ name: 'instance', params: { id: name } })
    await reload()
  } catch (error) {
    toasts.push(errText(error), 'error')
  }
}

function openDesc() {
  descInput.value = desc.value
  modal.value = 'desc'
}

function confirmDesc() {
  writeDesc(id.value, descInput.value.trim())
  desc.value = descInput.value.trim()
  modal.value = ''
  toasts.push('描述已保存', 'ok')
}

function openClone() {
  cloneName.value = `${id.value}-副本`
  modal.value = 'clone'
}

async function confirmClone() {
  const name = cloneName.value.trim()
  modal.value = ''
  if (!name) {
    toasts.push('新实例名不能为空', 'error')
    return
  }
  await runOperation({ kind: 'clone', target: { folder: rootFolder.value, id: id.value }, name }, `已复制为 ${name}`)
}

async function removeInstance() {
  if (!window.confirm(`确定移除实例 ${id.value}？浏览器阶段仅删除登记记录。`)) return
  try {
    await versions.remove(id.value)
    toasts.push(`已移除 ${id.value}`, 'ok')
    await router.push('/game')
  } catch (error) {
    toasts.push(errText(error), 'error')
  }
}

async function saveJava() {
  try {
    await setVersionJava(id.value, javaPath.value.trim(), javaAuto.value, rootFolder.value)
    await versions.loadInstalled()
    toasts.push('该实例的 Java 设置已保存', 'ok')
  } catch (error) {
    toasts.push(errText(error), 'error')
  }
}

async function saveResolution() {
  try {
    await setVersionResolution(
      id.value,
      { width: resWidth.value, height: resHeight.value, mode: resMode.value, fullscreen: resMode.value === 'fullscreen' },
      rootFolder.value
    )
    await versions.loadInstalled()
    toasts.push('窗口设置已保存', 'ok')
  } catch (error) {
    toasts.push(errText(error), 'error')
  }
}

async function toggleIsolation(value: boolean) {
  try {
    await setVersionIsolation(id.value, value, rootFolder.value)
    plan.value = await getIsolationPlan(id.value, rootFolder.value)
    await versions.loadInstalled()
    await loadSection()
    toasts.push(value ? `${id.value} 已开启版本隔离` : `${id.value} 已关闭版本隔离`, 'ok')
  } catch (error) {
    toasts.push(errText(error), 'error')
  }
}

async function removeShot(shot: InstanceScreenshot) {
  try {
    await removeFs('screenshots', shot.id, dir.value)
    shots.value = shots.value.filter((row) => row.id !== shot.id)
    if (preview.value?.id === shot.id) preview.value = null
    toasts.push(`已移除 ${shot.id}`, 'ok')
  } catch (error) {
    toasts.push(errText(error), 'error')
  }
}

function downloadShot(shot: InstanceScreenshot) {
  const link = document.createElement('a')
  link.href = shot.image
  link.download = shot.id
  link.click()
}

async function removeBackup(row: BackupRow) {
  if (!window.confirm(`删除备份 ${row.path}？`)) return
  try {
    await removeFs('backups', row.path, dir.value)
    await loadSection()
    toasts.push('备份已删除', 'ok')
  } catch (error) {
    toasts.push(errText(error), 'error')
  }
}

function goFinding(finding: DiagnosticFinding) {
  if (finding.action === 'java') {
    section.value = 'settings'
    return
  }
  void openDir(finding.fileName ?? '', dir.value)
}

watch(section, loadSection)

watch(
  instance,
  (row) => {
    if (row) syncForm(row)
  },
  { immediate: true }
)

onMounted(reload)
</script>

<template>
  <div class="page-head">
    <h1 class="page-title">{{ instance?.id ?? '版本设置' }}</h1>
    <span class="page-note">版本设置 · 分区管理</span>
    <div class="grow" />
    <button class="btn" @click="router.push('/game')">返回版本列表</button>
  </div>

  <Skeleton v-if="!versions.installedReady" :rows="5" />
  <section v-else-if="!instance" class="card section">
    <Empty text="找不到该实例" note="它可能已经被移除，返回版本列表重新选择。" />
    <div class="row-ops center-ops">
      <button class="btn primary" @click="router.push('/game')">返回版本列表</button>
    </div>
  </section>

  <div v-else class="center">
    <aside class="nav">
      <button
        v-for="item in SECTIONS"
        :key="item.id"
        class="nav-item"
        :class="{ on: section === item.id }"
        @click="section = item.id"
      >
        {{ item.label }}
      </button>
    </aside>

    <div class="body">
      <section v-if="section === 'overview'" class="card section">
        <div class="row-main">
          <span class="row-title">{{ instance.id }}</span>
          <span class="tag">{{ instance.mcVersion }}</span>
          <span v-if="instance.loader" class="tag approx">{{ LOADER_LABELS[instance.loader] ?? instance.loader }}</span>
          <span v-if="instance.isolated" class="tag approx">隔离</span>
          <span v-if="versions.activeId === instance.id" class="tag real">当前实例</span>
          <span v-if="running" class="tag real">运行中</span>
        </div>
        <p class="page-note">{{ desc || '还没有填写描述，可以点「修改描述」记录这个实例的用途。' }}</p>
        <div class="facts">
          <div class="fact">
            <span class="fact-key">游戏目录</span>
            <span class="mono">{{ overview?.directory ?? dir }}</span>
          </div>
          <div class="fact">
            <span class="fact-key">所属文件夹</span>
            <span class="mono">{{ instance.folder }}</span>
          </div>
          <div class="fact">
            <span class="fact-key">Java</span>
            <span class="mono">{{ instance.javaAuto === false ? instance.javaPath || '未指定' : '自动匹配' }}</span>
          </div>
          <div class="fact">
            <span class="fact-key">窗口</span>
            <span class="mono">
              {{ instance.resolution ? `${instance.resolution.width}×${instance.resolution.height} · ${MODE_LABELS[instance.resolution.mode]}` : '跟随全局设置' }}
            </span>
          </div>
        </div>
        <div class="row-ops">
          <button class="btn primary" :disabled="running" @click="startGame">{{ running ? '运行中…' : '启动游戏' }}</button>
          <button class="btn" :disabled="versions.activeId === instance.id" @click="setActive">设为当前实例</button>
          <button class="btn" @click="openRename">重命名</button>
          <button class="btn" @click="openDesc">修改描述</button>
          <button class="btn" @click="openClone">复制实例</button>
          <button class="btn" :disabled="busy === 'op' || running" @click="openExport">
            导出整合包
          </button>
          <button class="btn" :disabled="busy === 'op' || migrating" @click="openMigrate">迁移</button>
          <button class="btn" :disabled="busy === 'op'" @click="runOperation({ kind: 'repair', target: { folder: rootFolder, id } }, '登记信息已补全')">
            补全文件
          </button>
        </div>
        <div class="row-ops">
          <button class="btn" @click="openDir('', dir)">打开游戏目录</button>
          <button class="btn" @click="openDir('saves', dir)">打开存档目录</button>
          <button class="btn" @click="openDir('mods', dir)">打开 Mod 目录</button>
          <button class="btn danger" @click="removeInstance">删除实例</button>
        </div>
        <p class="page-note">
          「导出整合包」提供名称、版本、作者、描述与内容勾选等参数，格式支持普通 zip、WCL 整合包、CurseForge 与 Modrinth；任务会进入下载队列执行，浏览器阶段不写入真实文件。
        </p>
      </section>

      <section v-else-if="section === 'settings'" class="card section">
        <Field title="该实例的 Java" note="关闭自动匹配后使用下方填写的路径，覆盖全局 Java 设置">
          <TextInput v-model="javaPath" placeholder="例如 C:/Java/jdk17/bin/java.exe" :disabled="javaAuto" />
        </Field>
        <Field title="自动匹配 Java" note="按实例的 MC 版本自动选择合适的 Java 运行时">
          <Toggle :model-value="javaAuto" @update:model-value="javaAuto = $event" />
        </Field>
        <div class="row-ops">
          <button class="btn primary" @click="saveJava">保存 Java 设置</button>
        </div>

        <Field title="窗口宽度">
          <input class="num" type="number" min="320" :value="resWidth" @input="resWidth = Number(($event.target as HTMLInputElement).value)" />
        </Field>
        <Field title="窗口高度">
          <input class="num" type="number" min="240" :value="resHeight" @input="resHeight = Number(($event.target as HTMLInputElement).value)" />
        </Field>
        <Field title="窗口模式">
          <Pick :model-value="resMode" :options="modeOptions" @update:model-value="resMode = String($event) as GameWindowMode" />
        </Field>
        <div class="row-ops">
          <button class="btn primary" @click="saveResolution">保存窗口设置</button>
          <span class="page-note">留空代表跟随「设置」页的全局分辨率</span>
        </div>

        <Field title="版本隔离" note="开启后该实例使用独立的存档与模组目录">
          <Toggle :model-value="instance.isolated === true" @update:model-value="toggleIsolation" />
        </Field>
        <p class="page-note mono" v-if="plan">
          迁移计划：{{ plan.source }} → {{ plan.destination }} · 待迁移 {{ plan.totalFiles }} 个文件 / {{ fmtSize(plan.totalBytes) }}
        </p>
      </section>

      <ResourceFiles
        v-else-if="section === 'mods'"
        rel="mods"
        label="模组"
        note="存放 Forge / Fabric / Quilt / NeoForge 模组文件。"
        disable
        :instance-id="id"
        :folder="dir"
      />
      <ResourceFiles
        v-else-if="section === 'packs'"
        rel="resourcepacks"
        label="资源包"
        note="存放材质与音效资源包。"
        :instance-id="id"
        :folder="dir"
      />
      <ResourceFiles
        v-else-if="section === 'shaders'"
        rel="shaderpacks"
        label="光影"
        note="存放光影包，配合 OptiFine / Iris 使用。"
        :instance-id="id"
        :folder="dir"
      />

      <section v-else-if="section === 'screenshots'" class="card section">
        <div class="row-ops">
          <button class="btn" @click="loadSection">刷新</button>
          <span class="page-note">浏览器阶段为确定性生成的模拟截图，桌面版读取 screenshots 目录</span>
        </div>
        <Empty v-if="!shots.length" text="还没有截图" note="游戏内按 F2 截图后会出现在这里。" />
        <div v-else class="album">
          <div v-for="shot in shots" :key="shot.id" class="shot">
            <button class="shot-img" @click="preview = shot">
              <img :src="shot.image" :alt="shot.id" />
            </button>
            <div class="shot-info mono">{{ shot.id }}</div>
            <div class="shot-time">{{ fmtTime(shot.date) }}</div>
            <div class="row-ops">
              <button class="btn" @click="preview = shot">看大图</button>
              <button class="btn" @click="downloadShot(shot)">下载</button>
              <button class="btn danger" @click="removeShot(shot)">移除</button>
            </div>
          </div>
        </div>
      </section>

      <ResourceFiles
        v-else-if="section === 'recordings'"
        rel="replay_recordings"
        label="录像"
        note="存放 ReplayMod 与 Flashback 录像文件。"
        :instance-id="id"
        :folder="dir"
      />
      <ResourceFiles
        v-else-if="section === 'projections'"
        rel="schematics"
        label="蓝图"
        note="存放 litematic / schem / nbt 投影文件。"
        :instance-id="id"
        :folder="dir"
      />

      <section v-else-if="section === 'worlds'" class="card section">
        <div class="row-ops">
          <button class="btn primary" @click="importWorld">导入存档</button>
          <button class="btn" @click="openDir('saves', dir)">打开存档目录</button>
          <button class="btn" @click="loadSection">刷新</button>
        </div>
        <Empty v-if="!worlds.length" text="还没有任何存档" note="启动游戏创建世界后会出现在这里。" />
        <div v-else class="list">
          <div v-for="world in worlds" :key="world.id" class="row">
            <span class="row-name">{{ world.name }}</span>
            <span v-if="world.mode" class="tag">{{ world.mode }}</span>
            <span v-if="world.version" class="tag approx">{{ world.version }}</span>
            <span class="row-time">{{ world.lastPlayed ? fmtTime(world.lastPlayed) : '' }}</span>
            <div class="row-ops">
              <button
                class="btn"
                :disabled="busy === 'op'"
                @click="runOperation({ kind: 'worldExport', target: { folder: rootFolder, id }, world: world.name }, `已导出存档 ${world.name}`)"
              >
                导出存档
              </button>
            </div>
          </div>
        </div>
      </section>

      <InstanceServers v-else-if="section === 'servers'" :instance-id="id" :folder="rootFolder" />

      <section v-else-if="section === 'backups'" class="card section">
        <div class="row-ops">
          <button class="btn primary" :disabled="busy === 'op'" @click="runOperation({ kind: 'backup', target: { folder: rootFolder, id } }, '备份已创建并下载')">
            新建备份
          </button>
          <button class="btn" @click="loadSection">刷新</button>
          <span class="page-note">备份清单保存在浏览器本地，桌面版写入实例目录</span>
        </div>
        <Empty v-if="!backups.length" text="还没有备份" note="点「新建备份」会把当前实例目录打包成 zip 并记录下来。" />
        <div v-else class="list">
          <div v-for="row in backups" :key="row.path" class="row">
            <span class="row-name">{{ row.title }}</span>
            <span class="row-size">{{ fmtSize(row.size) }}</span>
            <span class="row-time">{{ fmtTime(row.createdAt) }}</span>
            <div class="row-ops">
              <button
                class="btn"
                :disabled="busy === 'op'"
                @click="runOperation({ kind: 'restore', target: { folder: rootFolder, id }, backupId: row.path }, '已按备份恢复目录索引')"
              >
                恢复
              </button>
              <button class="btn danger" @click="removeBackup(row)">删除</button>
            </div>
          </div>
        </div>
      </section>

      <section v-else class="card section">
        <div class="row-ops">
          <button class="btn" @click="loadSection">重新诊断</button>
          <span class="page-note">基于本地登记与虚拟目录推导，桌面版读取真实文件</span>
        </div>
        <Empty v-if="!findings.length" text="没有发现问题" note="这个实例的登记信息与目录结构看起来都是正常状态。" />
        <div v-else class="list">
          <div v-for="finding in findings" :key="finding.rule" class="finding">
            <div class="row-main">
              <span class="row-title">{{ finding.title }}</span>
              <span class="tag" :class="{ approx: finding.confidence !== 'certain', real: finding.confidence === 'certain' }">
                {{ CONFIDENCE_LABELS[finding.confidence] }}
              </span>
            </div>
            <p class="page-note">{{ finding.evidence }}</p>
            <p class="page-note">{{ finding.advice }}</p>
            <div class="row-ops">
              <button class="btn" @click="goFinding(finding)">{{ finding.action === 'java' ? '去设置' : '打开目录' }}</button>
            </div>
          </div>
        </div>
      </section>
    </div>
  </div>

  <Modal :open="modal === 'rename'" title="重命名实例" @close="modal = ''">
    <TextInput v-model="renameName" placeholder="实例名称" />
    <div class="row-ops modal-ops">
      <button class="btn primary" @click="confirmRename">保存</button>
      <button class="btn" @click="modal = ''">取消</button>
    </div>
  </Modal>

  <Modal :open="modal === 'desc'" title="修改描述" @close="modal = ''">
    <TextInput v-model="descInput" placeholder="例如：整合包测试用，别删存档" />
    <div class="row-ops modal-ops">
      <button class="btn primary" @click="confirmDesc">保存</button>
      <button class="btn" @click="modal = ''">取消</button>
    </div>
  </Modal>

  <Modal :open="modal === 'clone'" title="复制实例" @close="modal = ''">
    <TextInput v-model="cloneName" placeholder="新实例名称" />
    <p class="page-note">复制会生成新的实例登记，并把该目录下的虚拟资源复制过去。</p>
    <div class="row-ops modal-ops">
      <button class="btn primary" @click="confirmClone">复制</button>
      <button class="btn" @click="modal = ''">取消</button>
    </div>
  </Modal>

  <Modal :open="migrateOpen" title="迁移资源到其他实例" width="600px" @close="migrateOpen = false">
    <Field title="目标实例" note="按目标实例的 Minecraft 版本与加载器重新匹配每个资源，找不到兼容版本的资源会列入失败清单">
      <Pick
        v-if="migrateOptions.length"
        :model-value="migrateTargetId"
        :options="migrateOptions"
        @update:model-value="(value) => (migrateTargetId = String(value))"
      />
      <p v-else class="page-note">没有其他已安装实例，请先在「游戏版本」页再装一个。</p>
    </Field>
    <p v-if="migrating" class="page-note">{{ migrateText || '迁移中…' }}</p>
    <div v-if="migrateResult" class="migrate-cols">
      <div>
        <p class="migrate-head">成功迁移 {{ migrateResult.migrated }} 个</p>
        <ul class="migrate-list">
          <li v-for="row in migrateResult.items.filter((item) => item.ok)" :key="`ok-${row.fileName}`">
            <span class="mono">{{ row.fileName }}</span>
            <span class="page-note">{{ row.detail }}</span>
          </li>
          <li v-if="!migrateResult.migrated" class="page-note">无</li>
        </ul>
      </div>
      <div>
        <p class="migrate-head">迁移失败 {{ migrateResult.failed }} 个</p>
        <ul class="migrate-list">
          <li v-for="row in migrateResult.items.filter((item) => !item.ok)" :key="`fail-${row.fileName}`">
            <span class="mono">{{ row.fileName }}</span>
            <span class="page-note">{{ row.detail }}</span>
          </li>
          <li v-if="!migrateResult.failed" class="page-note">无</li>
        </ul>
      </div>
    </div>
    <template #footer>
      <button class="btn" :disabled="migrating" @click="migrateOpen = false">关闭</button>
      <button class="btn primary" :disabled="migrating || !migrateOptions.length" @click="runMigrate">
        {{ migrating ? '迁移中…' : '开始迁移' }}
      </button>
    </template>
  </Modal>

  <Modal :open="exportOpen" title="导出整合包" width="560px" @close="exportOpen = false">
    <Field title="整合包名称">
      <TextInput v-model="exportName" placeholder="整合包名称" />
    </Field>
    <Field title="版本号">
      <TextInput v-model="exportVersion" placeholder="1.0.0" />
    </Field>
    <Field title="作者">
      <TextInput v-model="exportAuthor" placeholder="可选" />
    </Field>
    <Field title="描述">
      <TextInput v-model="exportDescription" placeholder="可选" />
    </Field>
    <Field title="导出格式" note="CurseForge 与 Modrinth 会额外生成清单文件">
      <Pick
        :model-value="exportFormat"
        :options="EXPORT_FORMAT_OPTIONS"
        @update:model-value="exportFormat = String($event) as ModpackExportOptions['format']"
      />
    </Field>
    <Field title="包含内容" stacked>
      <div class="chip-grid">
        <button
          v-for="item in EXPORT_TYPE_OPTIONS"
          :key="item.key"
          class="chip"
          :class="{ on: exportTypes[item.key] }"
          @click="toggleExportType(item.key)"
        >
          {{ item.label }}
        </button>
      </div>
    </Field>
    <Field title="仅包含已启用的模组" note="跳过 .disabled 后缀的文件">
      <Toggle :model-value="exportEnabledOnly" @update:model-value="exportEnabledOnly = $event" />
    </Field>
    <Field title="保存位置" stacked>
      <div class="dest-row">
        <TextInput v-model="exportDest" placeholder="选择导出文件的保存目录" />
        <button class="btn" @click="pickExportDest">浏览</button>
      </div>
    </Field>
    <div class="row-ops modal-ops">
      <button class="btn primary" :disabled="!isDesktop" @click="confirmExport">加入下载队列</button>
      <button class="btn" @click="exportOpen = false">取消</button>
    </div>
  </Modal>

  <Modal :open="Boolean(preview)" :title="preview?.id ?? '截图'" @close="preview = null">
    <img v-if="preview" class="preview" :src="preview.image" :alt="preview.id" />
    <p class="page-note">{{ preview ? fmtTime(preview.date) : '' }}</p>
    <div class="row-ops modal-ops">
      <button v-if="preview" class="btn primary" @click="downloadShot(preview)">下载</button>
      <button class="btn" @click="preview = null">关闭</button>
    </div>
  </Modal>
</template>

<style scoped>
.grow {
  flex: 1;
}

.center {
  display: flex;
  align-items: flex-start;
  gap: var(--space-4);
}

.nav {
  position: sticky;
  top: 0;
  flex: 0 0 156px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: var(--space-2);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius);
  background-color: var(--glass-bg);
  backdrop-filter: blur(var(--glass-blur)) saturate(150%);
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(150%);
  box-shadow: var(--shadow-1);
}

@supports not ((backdrop-filter: blur(2px)) or (-webkit-backdrop-filter: blur(2px))) {
  .nav {
    background-color: var(--glass-solid);
  }
}

.nav-item {
  height: 38px;
  padding: 0 var(--space-3);
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-dim);
  font-size: 13px;
  cursor: pointer;
  text-align: left;
  transition: background var(--dur) var(--ease), color var(--dur) var(--ease), box-shadow var(--dur) var(--ease);
}

.nav-item:hover {
  background: var(--surface-soft);
  color: var(--text);
}

.nav-item.on {
  background: var(--accent-soft);
  color: var(--accent);
  box-shadow: inset 0 0 0 1px var(--accent-line);
}

.body {
  flex: 1;
  min-width: 0;
}

.section {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.facts {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: var(--space-2) var(--space-4);
}

.fact {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.fact-key {
  color: var(--text-mute);
  font-size: 12px;
}

.row-main {
  display: flex;
  align-items: center;
  gap: var(--space-2);
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

.center-ops {
  justify-content: center;
}

.modal-ops {
  margin-top: var(--space-3);
}

.chip-grid {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  padding-top: var(--space-2);
}

.chip {
  height: 30px;
  padding: 0 var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface-2);
  color: var(--text-dim);
  font-size: 12px;
  cursor: pointer;
  transition: border-color var(--dur) var(--ease), background var(--dur) var(--ease), color var(--dur) var(--ease);
}

.chip:hover {
  border-color: var(--border-strong);
  color: var(--text);
}

.chip.on {
  border-color: var(--accent-line);
  background: var(--accent-soft);
  color: var(--accent);
  box-shadow: inset 0 0 0 1px var(--accent-line);
}

.dest-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  padding-top: var(--space-2);
}

.dest-row :deep(input) {
  flex: 1;
}

.num {
  height: var(--control-h);
  width: 120px;
  padding: 0 var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface-2);
  color: var(--text);
}

.num:focus {
  outline: none;
  border-color: var(--accent);
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

.row-size,
.row-time {
  min-width: 130px;
  color: var(--text-mute);
  font-size: 12px;
}

.album {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: var(--space-3);
}

.shot {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface-2);
}

.shot-img {
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
  line-height: 0;
}

.shot-img img {
  width: 100%;
  border-radius: 6px;
  display: block;
}

.shot-info {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.shot-time {
  color: var(--text-mute);
  font-size: 12px;
}

.preview {
  width: 100%;
  border-radius: var(--radius-sm);
}

.finding {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-3);
  border-bottom: 1px solid var(--border);
}

.btn.danger {
  color: var(--danger);
}

.migrate-cols {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-3);
}

.migrate-head {
  margin: 0 0 var(--space-2);
  font-size: 13px;
  font-weight: 600;
}

.migrate-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  max-height: 220px;
  overflow: auto;
}

.migrate-list li {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 12px;
  overflow-wrap: anywhere;
}
</style>
