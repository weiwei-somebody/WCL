<script setup lang="ts">
import { useRoute } from 'vue-router'

const route = useRoute()
</script>

<template>
  <div class="page-head">
    <h1 class="page-title">{{ route.meta.label }}</h1>
    <span class="page-note">计划在 {{ route.meta.stage }} 阶段实现</span>
  </div>
  <div class="card">
    <p class="page-note">路由与骨架已就位，页面功能将在对应阶段补齐。</p>
  </div>
</template>
