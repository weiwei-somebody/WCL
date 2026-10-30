<script setup lang="ts">
import { useToastStore } from '@/store/toasts'

const toasts = useToastStore()
</script>

<template>
  <div class="toasts">
    <div v-for="toast in toasts.items" :key="toast.id" class="toast" :class="toast.kind">
      {{ toast.text }}
    </div>
  </div>
</template>
