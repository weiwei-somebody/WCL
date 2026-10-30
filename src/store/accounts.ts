import { defineStore } from 'pinia'
import { addOfflineAccount, getSelectedAccount, listAccounts, removeAccount, selectAccount } from '@/api'
import type { Account } from '@shared/types'

export const useAccountsStore = defineStore('accounts', {
  state: () => ({
    items: [] as Account[],
    current: null as Account | null,
    ready: false
  }),
  actions: {
    async load() {
      this.items = await listAccounts()
      this.current = await getSelectedAccount()
      this.ready = true
    },
    async addOffline(username: string) {
      await addOfflineAccount(username)
      await this.load()
    },
    async remove(id: string) {
      await removeAccount(id)
      await this.load()
    },
    async select(id: string) {
      await selectAccount(id)
      await this.load()
    }
  }
})
