<script setup lang="ts">
import { computed, ref } from 'vue'
import { IPC, IPC_EVENT } from '@shared/types'
import { bridge } from '@/bridge'
import { capabilityOf } from '@/bridge/capabilities'
import { handlers } from '@/bridge/browser/handlers'
import { clearRecords } from '@/bridge/browser'
import { domainsFor } from '@/bridge/featureChecklist'
import { errText } from '@/api'
import type { Capability } from '@/bridge/contract'

interface CallResult {
  channel: string
  capability: Capability
  ok: boolean
  ms: number
  detail: string
}

const KINDS: Array<Capability | 'all'> = ['all', 'real', 'approx', 'mock', 'desktop']

const rows = computed(() =>
  Object.entries(IPC)
    .map(([key, channel]) => ({
      key,
      channel,
      capability: capabilityOf(channel),
      implemented: channel in handlers
    }))
    .sort((left, right) => left.channel.localeCompare(right.channel))
)

const kind = ref<Capability | 'all'>('all')
const keyword = ref('')

const shown = computed(() =>
  rows.value.filter((row) => {
    if (kind.value !== 'all' && row.capability !== kind.value) return false
    if (keyword.value && !row.channel.includes(keyword.value)) return false
    return true
  })
)

const countOf = (target: Capability) => rows.value.filter((row) => row.capability === target).length

const domains = computed(() =>
  domainsFor(Object.values(IPC)).map((item) => ({
    ...item,
    done: item.chains.filter((chain) => chain in handlers).length
  }))
)

function brief(value: unknown): string {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  if (Array.isArray(value)) return `数组(${value.length})`
  if (typeof value === 'object') return `对象(${Object.keys(value as object).length} 项)`
  return String(value).slice(0, 60)
}

const busy = ref(false)
const progress = ref(0)
const results = ref<CallResult[]>([])
const failed = computed(() => results.value.filter((item) => !item.ok))

async function runAll() {
  busy.value = true
  results.value = []
  progress.value = 0
  clearRecords()
  const target = rows.value
  for (const row of target) {
    const started = performance.now()
    try {
      const value = await bridge.invoke(row.channel)
      results.value.push({
        channel: row.channel,
        capability: row.capability,
        ok: true,
        ms: Math.round(performance.now() - started),
        detail: brief(value)
      })
    } catch (error) {
      results.value.push({
        channel: row.channel,
        capability: row.capability,
        ok: false,
        ms: Math.round(performance.now() - started),
        detail: errText(error)
      })
    }
    progress.value = results.value.length
  }
  busy.value = false
}
</script>

<template>
  <div class="page-head">
    <h1 class="page-title">桥接诊断</h1>
    <span class="page-note">
      运行环境 {{ bridge.kind }} · 通道 {{ rows.length }} 个 · 事件
      {{ Object.keys(IPC_EVENT).length }} 个 · 已实现 {{ rows.filter((r) => r.implemented).length }} 个
    </span>
  </div>

  <div class="card">
    <div class="filters">
      <button
        v-for="option in KINDS"
        :key="option"
        class="btn"
        :class="{ primary: kind === option }"
        @click="kind = option"
      >
        {{ option === 'all' ? `全部 ${rows.length}` : `${option} ${countOf(option)}` }}
      </button>
      <input v-model="keyword" class="search" placeholder="按通道名过滤" />
      <button class="btn primary" :disabled="busy" @click="runAll">
        {{ busy ? `调用中 ${progress}/${rows.length}` : '全部调用' }}
      </button>
    </div>

    <p v-if="results.length" class="page-note result-line">
      调用完成：成功 {{ results.length - failed.length }} · 失败 {{ failed.length }} · 平均耗时
      {{ Math.round(results.reduce((sum, item) => sum + item.ms, 0) / results.length) }}ms
    </p>
  </div>

  <div class="card domains">
    <h2 class="col-title">功能域进度（功能不砍对照）</h2>
    <div class="domain-grid">
      <div v-for="item in domains" :key="item.domain.key" class="domain">
        <span class="mono dname">{{ item.domain.key }}</span>
        <span class="dlabel">{{ item.domain.label }}</span>
        <span class="tag">{{ item.domain.stage }}</span>
        <span class="mono dcount">{{ item.done }}/{{ item.total }}</span>
      </div>
    </div>
  </div>

  <div class="grid">
    <div class="card col">
      <h2 class="col-title">通道清单</h2>
      <div class="list">
        <div v-for="row in shown" :key="row.key" class="line">
          <span class="tag" :class="row.capability">{{ row.capability }}</span>
          <span class="mono name">{{ row.channel }}</span>
          <span class="dot" :class="{ on: row.implemented }" :title="row.implemented ? '已实现' : '兜底返回'"></span>
        </div>
      </div>
    </div>

    <div class="card col">
      <h2 class="col-title">调用结果</h2>
      <div v-if="!results.length" class="page-note">点击"全部调用"后在此显示每条通道的返回情况。</div>
      <div v-else class="list">
        <div v-for="item in results" :key="item.channel" class="line">
          <span class="tag" :class="item.ok ? 'real' : 'desktop'">{{ item.ok ? 'ok' : 'err' }}</span>
          <span class="mono name">{{ item.channel }}</span>
          <span class="mono detail" :class="{ bad: !item.ok }">{{ item.detail }}</span>
          <span class="mono ms">{{ item.ms }}ms</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.filters {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
}

.search {
  flex: 1;
  min-width: 160px;
  height: var(--control-h);
  padding: 0 var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface-2);
  color: var(--text);
}

.result-line {
  margin-top: var(--space-3);
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(420px, 1fr));
  gap: var(--space-4);
  margin-top: var(--space-4);
}

.domains {
  margin-top: var(--space-4);
}

.domain-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: var(--space-2);
}

.domain {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface-2);
}

.dname {
  color: var(--text-mute);
  min-width: 78px;
}

.dlabel {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
}

.dcount {
  color: var(--text-dim);
}

.col {
  max-height: 62vh;
  overflow: auto;
}

.col-title {
  font-size: 14px;
  font-weight: 600;
  margin-bottom: var(--space-3);
}

.list {
  display: flex;
  flex-direction: column;
}

.line {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: 5px 0;
  border-bottom: 1px solid var(--border);
}

.name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.detail {
  color: var(--text-dim);
  max-width: 150px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.detail.bad {
  color: var(--danger);
}

.ms {
  color: var(--text-mute);
  width: 54px;
  text-align: right;
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--surface-3);
  flex: 0 0 auto;
}

.dot.on {
  background: var(--ok);
}
</style>
