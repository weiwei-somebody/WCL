<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { bridgeStatus, errText } from '@/api'
import { useVersionsStore } from '@/store/versions'
import { useToastStore } from '@/store/toasts'
import DesktopOnly from '@/ui/primitives/DesktopOnly.vue'
import Empty from '@/ui/primitives/Empty.vue'
import Pick from '@/ui/primitives/Pick.vue'
import type { BridgeStatus } from '@shared/types'

const versions = useVersionsStore()
const toasts = useToastStore()

const targetId = ref('')
const status = ref<BridgeStatus | null>(null)
const loading = ref(false)

const options = computed(() => versions.installed.map((row) => ({ value: row.id, label: `${row.id}（${row.mcVersion}）` })))

async function probe() {
  if (!targetId.value) return
  loading.value = true
  try {
    status.value = await bridgeStatus(targetId.value)
  } catch (error) {
    toasts.push(errText(error), 'error')
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  await versions.loadInstalled()
  if (versions.installed.length) targetId.value = versions.installed[0].id
  await probe()
})
</script>

<template>
  <div class="page-head">
    <h1 class="page-title">MOD 面板</h1>
    <span class="page-note">桥接 MOD 实时配置：游戏内改动即时同步到面板</span>
  </div>

  <DesktopOnly note="桥接 MOD 需要本地游戏进程与文件系统，浏览器模式下只展示连接状态说明。" />

  <div class="toolbar card">
    <template v-if="versions.installed.length">
      <span class="page-note">目标实例</span>
      <Pick v-model="targetId" :options="options" @update:model-value="probe" />
      <button class="btn" :disabled="loading" @click="probe">{{ loading ? '查询中…' : '重新探测' }}</button>
    </template>
    <span v-else class="page-note">请先在「游戏版本」页安装一个实例</span>
  </div>

  <section class="card section">
    <Empty v-if="!versions.installed.length" text="没有可用实例" note="安装版本后再来查看桥接 MOD 状态。" />
    <template v-else>
      <div class="status-row">
        <span class="status-dot" :class="{ on: status?.connected }" />
        <span class="status-text">{{ status?.connected ? '已连接桥接 MOD' : '未连接桥接 MOD' }}</span>
        <span v-if="status?.modVersion" class="tag">{{ status.modVersion }}</span>
        <span v-if="status?.protocol" class="tag approx">protocol {{ status.protocol }}</span>
      </div>
      <p class="page-note">{{ status?.reason ?? '实例目录中未发现 .wcl-bridge.json，或游戏未运行。' }}</p>
      <p class="page-note">桌面版会在这里按 MOD 声明的参数自动生成控件，并把改动实时写回游戏配置。</p>
    </template>
  </section>
</template>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  margin: var(--space-3) 0;
}

.section {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.status-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.status-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--text-mute);
}

.status-dot.on {
  background: var(--ok);
}

.status-text {
  font-weight: 600;
}
</style>
