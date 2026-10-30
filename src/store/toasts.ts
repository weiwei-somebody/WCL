import { defineStore } from 'pinia'

export type ToastKind = 'info' | 'ok' | 'error'

export interface ToastItem {
  id: number
  text: string
  kind: ToastKind
}

let seed = 0

export const useToastStore = defineStore('toasts', {
  state: () => ({ items: [] as ToastItem[] }),
  actions: {
    push(text: string, kind: ToastKind = 'info', ms = 3200) {
      const id = ++seed
      this.items.push({ id, text, kind })
      setTimeout(() => this.drop(id), ms)
    },
    drop(id: number) {
      this.items = this.items.filter((item) => item.id !== id)
    }
  }
})
