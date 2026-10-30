import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

const abs = (path: string) => fileURLToPath(new URL(path, import.meta.url))

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': abs('./src'),
      '@shared': abs('./src/shared')
    }
  },
  server: {
    port: 5178,
    host: '127.0.0.1'
  },
  build: {
    target: 'es2022'
  }
})
