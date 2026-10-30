<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ResourceFiles from '@/components/ResourceFiles.vue'

const route = useRoute()
const router = useRouter()

const meta = computed(() => route.meta as { rel?: string; label?: string; note?: string; disable?: boolean; kind?: string; community?: boolean })
const rel = computed(() => meta.value.rel ?? '')
const label = computed(() => meta.value.label ?? '资源')
const disable = computed(() => meta.value.disable === true)
const community = computed(() => meta.value.community !== false)

function goCommunity() {
  const kind = meta.value.kind
  router.push(kind ? { path: '/community', query: { kind } } : '/community')
}
</script>

<template>
  <div class="page-head">
    <h1 class="page-title">{{ label }}</h1>
    <span class="page-note">浏览器阶段写入虚拟游戏目录，桌面版读写真实磁盘</span>
    <div class="grow" />
    <button v-if="community" class="btn" @click="goCommunity">去社区找{{ label }}</button>
  </div>
  <ResourceFiles :rel="rel" :label="label" :note="meta.note" :disable="disable" />
</template>

<style scoped>
.grow {
  flex: 1;
}
</style>
