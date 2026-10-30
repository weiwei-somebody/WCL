import { createBrowserBridge } from './browser'
import { createElectronBridge } from './electron'
import type { Bridge } from './contract'

export const bridge: Bridge =
  typeof window !== 'undefined' && 'wcl' in window ? createElectronBridge() : createBrowserBridge()

export type { Bridge, Capability } from './contract'
