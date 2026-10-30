<script setup lang="ts">
/**
 * 统一下载页：实例、模组、整合包、存档的下载任务都进入同一队列，
 * 自上而下按加入顺序展示，同一时刻只执行一个任务。
 */
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { errText, selectDir, selectFile } from '@/api'
import { bridge } from '@/bridge'
import { useDownloadsStore } from '@/store/downloads'
import type { DownloadJob } from '@/store/downloads'
import { useToastStore } from '@/store/toasts'
import Empty from '@/ui/primitives/Empty.vue'
import Progress from '@/ui/primitives/Progress.vue'

const downloads = useDownloadsStore()
const toasts = useToastStore()
const router = useRouter()

const isDesktop = computed(() => bridge.kind === 'electron')
const importing = ref(false)

const KIND_LABEL: Record<string, string> = {
  version: '实例',
  mod: '模组',
  modpack: '整合包',
  world: '存档',
  export: '导出'
}

const STATUS_LABEL: Record<string, string> = {
  pending: '等待中',
  running: '进行中',
  done: '已完成',
  error: '失败',
  canceled: '已取消'
}

function kindLabel(job: DownloadJob): string {
  return KIND_LABEL[job.kind] ?? job.kind
}

function statusLabel(job: DownloadJob): string {
  return STATUS_LABEL[job.status] ?? job.status
}

function canControl(job: DownloadJob): boolean {
  return job.status === 'running' || job.status === 'pending'
}

function canRetry(job: DownloadJob): boolean {
  return job.status === 'error' || job.status === 'canceled'
}

async function importModpack() {
  importing.value = true
  try {
    const path = isDesktop.value ? await selectFile() : 'demo:/下载/Cobblemon-Forge-1.6.1.zip'
    if (!path) {
      toasts.push('未选择整合包文件', 'error')
      return
    }
    await downloads.openImport(path)
  } catch (error) {
    toasts.push(errText(error), 'error')
  } finally {
    importing.value = false
  }
}

async function importWorld() {
  importing.value = true
  try {
    const path = isDesktop.value ? await selectDir() : 'demo:/存档/生存世界'
    if (!path) {
      toasts.push('未选择存档文件夹', 'error')
      return
    }
    await downloads.openImport(path)
  } catch (error) {
    toasts.push(errText(error), 'error')
  } finally {
    importing.value = false
  }
}

async function supply() {
  try {
    const note = await downloads.supplyFiles()
    toasts.push(note, 'ok')
  } catch (error) {
    toasts.push(errText(error), 'error')
  }
}

async function cancel(job: DownloadJob) {
  try {
    await downloads.cancelJob(job.id)
  } catch (error) {
    toasts.push(errText(error), 'error')
  }
}
</script>

<template>
  <div class="page-head">
    <h1 class="page-title">下载</h1>
    <span class="page-note">
      队列 {{ downloads.jobs.length }} 项 · 等待 {{ downloads.pendingCount }} 项 · 完成 {{ downloads.finishedCount }} 项
    </span>
    <span v-if="!isDesktop" class="tag mock">模拟</span>
  </div>

  <div class="toolbar card">
    <button class="btn primary" :disabled="importing" @click="importModpack">导入整合包</button>
    <button class="btn" @click="importWorld">导入存档</button>
    <button class="btn" @click="router.push({ name: 'community' })">前往社区资源</button>
    <div class="grow" />
    <button class="btn" :disabled="!downloads.finishedCount" @click="downloads.clearFinished()">清除已完成</button>
  </div>

  <div v-if="downloads.manual" class="card manual">
    <div class="manual-head">
      <span class="manual-title">整合包缺 {{ downloads.manual.files.length }} 个文件，需要手动提供</span>
      <div class="grow" />
      <button class="btn" @click="supply">补充文件</button>
    </div>
    <div class="manual-list">
      <span v-for="file in downloads.manual.files.slice(0, 12)" :key="file.fileID" class="tag approx truncate">
        {{ file.fileName }}
      </span>
    </div>
    <p class="page-note note-foot">补充后队列会继续执行当前整合包安装，无需重新入队。</p>
  </div>

  <section class="card section">
    <div v-if="downloads.current" class="now">
      <span class="now-text">{{ downloads.current.title }} · {{ downloads.current.text }}</span>
      <Progress :value="downloads.current.percent" />
    </div>

    <Empty
      v-if="!downloads.jobs.length"
      text="下载队列为空"
      note="安装实例、加入模组、导入整合包或存档都会进入这里，按加入顺序依次执行。"
    />
    <div v-else class="list">
      <div v-for="(job, index) in downloads.jobs" :key="job.id" class="row" :class="{ dim: job.status === 'done' }">
        <div class="row-main">
          <span class="index mono">{{ String(index + 1).padStart(2, '0') }}</span>
          <span class="tag approx">{{ kindLabel(job) }}</span>
          <span class="row-title truncate">{{ job.title }}</span>
          <span
            class="tag"
            :class="{
              real: job.status === 'done',
              approx: job.status === 'running' || job.status === 'pending',
              bad: job.status === 'error'
            }"
          >
            {{ statusLabel(job) }}
          </span>
          <template v-if="job.total">
            <span class="page-note">{{ job.done }} / {{ job.total }}</span>
          </template>
        </div>
        <div class="row-info">目标 {{ job.target }}<template v-if="job.note"> · {{ job.note }}</template></div>
        <Progress v-if="job.status === 'running'" :value="job.percent" :show-text="false" />
        <div v-if="job.error" class="error-note">{{ job.error }}</div>
        <div class="row-ops">
          <template v-if="canControl(job)">
            <button class="btn danger" @click="cancel(job)">取消</button>
          </template>
          <template v-else>
            <button v-if="canRetry(job)" class="btn" @click="downloads.retry(job.id)">重试</button>
            <button class="btn" @click="downloads.remove(job.id)">移除</button>
          </template>
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
  margin-bottom: var(--space-3);
}

.grow {
  flex: 1;
}

.section {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.list {
  display: flex;
  flex-direction: column;
}

.row {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-3);
  border-bottom: 1px solid var(--border);
}

.row-main {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}

.row-title {
  font-weight: 600;
}

.row-info {
  color: var(--text-mute);
  font-size: 12px;
}

.row-ops {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.error-note {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  color: var(--danger);
  font-size: 13px;
}

.note-foot {
  margin-top: var(--space-3);
}

.manual {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin-bottom: var(--space-3);
}

.manual-head {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.manual-title {
  font-weight: 600;
  font-size: 13px;
}

.manual-list {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.now {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding-bottom: var(--space-3);
  margin-bottom: var(--space-3);
  border-bottom: 1px solid var(--border);
}

.now-text {
  font-size: 13px;
}

.index {
  min-width: 24px;
  color: var(--text-mute);
  font-size: 12px;
}

.row.dim {
  opacity: 0.62;
}

.row-title {
  max-width: 320px;
}

.truncate {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
