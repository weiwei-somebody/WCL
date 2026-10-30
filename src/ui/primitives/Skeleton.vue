<script setup lang="ts">
defineProps<{ rows?: number; height?: string }>()
</script>

<template>
  <div class="skeleton">
    <div v-for="row in rows ?? 3" :key="row" class="line" :style="{ height: height ?? '14px' }" />
  </div>
</template>

<style scoped>
.skeleton {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.line {
  border-radius: var(--radius-sm);
  background: linear-gradient(90deg, var(--surface-2), var(--surface-3), var(--surface-2));
  background-size: 200% 100%;
  animation: sweep 1.2s linear infinite;
}

@keyframes sweep {
  from {
    background-position: 200% 0;
  }
  to {
    background-position: -200% 0;
  }
}
</style>
