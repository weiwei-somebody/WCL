import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { router } from './router'
import { bridge } from './bridge'
import './ui/tokens.css'
import './ui/base.css'

if (bridge.kind === 'electron') document.documentElement.dataset.desktop = '1'

createApp(App).use(createPinia()).use(router).mount('#app')

if (bridge.kind === 'electron') bridge.send('boot:renderer-ready')
