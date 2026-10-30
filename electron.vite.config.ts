import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'node:path'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/main',
      minify: true,
      sourcemap: false,
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          modScanWorker: resolve(__dirname, 'src/main/core/modScanWorker.ts'),
          projectionWorker: resolve(__dirname, 'src/main/core/projectionWorker.ts')
        },
        output: {
          entryFileNames: (chunk) => (chunk.name === 'index' ? 'index.js' : '[name].cjs'),
          chunkFileNames: '[name]-[hash].js'
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/preload',
      minify: true,
      sourcemap: false,
      rollupOptions: { input: { index: resolve(__dirname, 'src/preload/index.ts') } }
    }
  },
  renderer: {
    root: '.',
    base: './',
    plugins: [vue()],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
        '@shared': resolve(__dirname, 'src/shared')
      }
    },
    build: {
      outDir: 'out/renderer',
      emptyOutDir: true,
      target: 'es2022',
      rollupOptions: { input: resolve(__dirname, 'index.html') }
    }
  }
})
