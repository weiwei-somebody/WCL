import { defineStore } from 'pinia'
import { getSettings, saveSettings } from '@/api'
import { DEFAULT_CUSTOM_THEME } from '@shared/types'
import type { Settings } from '@shared/types'

export type UiTheme = 'dark' | 'light'

const ACCENT_KEYS = ['--accent', '--accent-2', '--accent-soft', '--accent-line', '--accent-glow', '--accent-text']
const RADIUS_KEYS = ['--radius', '--radius-xs', '--radius-sm', '--radius-lg']
const DEFAULT_ACCENT = DEFAULT_CUSTOM_THEME.colors.accent.toLowerCase()
const DEFAULT_RADIUS = DEFAULT_CUSTOM_THEME.layout.radius

function hexRgb(hex: string): number[] | null {
  const match = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!match) return null
  const value = parseInt(match[1], 16)
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255]
}

function alphaOf(hex: string, alpha: number): string {
  const rgb = hexRgb(hex)
  return rgb ? `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})` : ''
}

function lighten(hex: string, ratio: number): string {
  const rgb = hexRgb(hex)
  if (!rgb) return ''
  const mixed = rgb.map((value) => Math.round(value + (255 - value) * ratio))
  return '#' + mixed.map((value) => value.toString(16).padStart(2, '0')).join('')
}

function readableOn(hex: string): string {
  const rgb = hexRgb(hex)
  if (!rgb) return ''
  const brightness = (rgb[0] * 299 + rgb[1] * 587 + rgb[2] * 114) / 1000
  return brightness > 150 ? '#1b1207' : '#fff8ef'
}

export const useSettingsStore = defineStore('settings', {
  state: () => ({
    data: null as Settings | null,
    ready: false,
    theme: 'dark' as UiTheme
  }),
  getters: {
    reduceMotion: (state) => state.data?.reduceMotion === true
  },
  actions: {
    async load() {
      this.data = await getSettings()
      this.theme = this.resolveTheme(this.data.wclTheme ?? 'dark')
      this.ready = true
      this.applyTheme()
    },
    async patch(part: Partial<Settings>) {
      this.data = await saveSettings(part)
      this.applyTheme()
    },
    async setTheme(theme: 'dark' | 'light' | 'auto') {
      await this.patch({ wclTheme: theme })
      this.theme = this.resolveTheme(theme)
      this.applyTheme()
    },
    resolveTheme(theme: 'dark' | 'light' | 'auto'): UiTheme {
      if (theme === 'auto') {
        return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
      }
      return theme
    },
    applyTheme() {
      document.documentElement.dataset.theme = this.theme
      document.documentElement.dataset.reduceMotion = this.reduceMotion ? 'true' : 'false'
      this.applyTokens()
    },
    applyTokens() {
      const root = document.documentElement.style
      const accent = this.data?.custom?.colors.accent ?? ''
      if (/^#[0-9a-f]{6}$/i.test(accent) && accent.toLowerCase() !== DEFAULT_ACCENT) {
        root.setProperty('--accent', accent)
        root.setProperty('--accent-2', lighten(accent, 0.28))
        root.setProperty('--accent-soft', alphaOf(accent, 0.16))
        root.setProperty('--accent-line', alphaOf(accent, 0.45))
        root.setProperty('--accent-glow', alphaOf(accent, 0.3))
        root.setProperty('--accent-text', readableOn(accent))
      } else {
        ACCENT_KEYS.forEach((key) => root.removeProperty(key))
      }
      const radius = this.data?.custom?.layout.radius
      if (typeof radius === 'number' && radius !== DEFAULT_RADIUS) {
        root.setProperty('--radius', `${radius}px`)
        root.setProperty('--radius-xs', `${Math.round(radius * 0.57)}px`)
        root.setProperty('--radius-sm', `${Math.round(radius * 0.71)}px`)
        root.setProperty('--radius-lg', `${Math.round(radius * 1.43)}px`)
      } else {
        RADIUS_KEYS.forEach((key) => root.removeProperty(key))
      }
    }
  }
})
