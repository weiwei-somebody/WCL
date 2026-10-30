import { accountHandlers } from './accounts'
import { centerHandlers } from './center'
import { communityHandlers } from './community'
import { directHandlers } from './direct'
import { fsHandlers } from './fs'
import { launchHandlers } from './launch'
import { packHandlers } from './packs'
import { serverHandlers } from './servers'
import { settingsHandlers } from './settings'
import { skinHandlers } from './skin'
import { versionHandlers } from './versions'

/** 通道名 -> 处理函数；未注册的通道由 Proxy 兜底 */
export type BridgeHandler = (...args: any[]) => unknown

export const handlers: Record<string, BridgeHandler> = {
  ...settingsHandlers,
  ...accountHandlers,
  ...versionHandlers,
  ...communityHandlers,
  ...centerHandlers,
  ...fsHandlers,
  ...serverHandlers,
  ...launchHandlers,
  ...packHandlers,
  ...skinHandlers,
  ...directHandlers
}
