import fs from 'node:fs'
import path from 'node:path'
import { launcherBaseDir } from '../portableData'

/** 打包后默认游戏目录取 exe 旁的 .minecraft（便携式布局）；未打包沿用 AppData 下的 .minecraft */
export const defaultGameFolder = (appData: string): string => path.join(launcherBaseDir() ?? appData, '.minecraft')

/** Only the launcher-owned default may be created implicitly; missing external roots stay missing. */
export function ensureDefaultGameFolder(appData: string, folders: readonly { path: string }[]): void {
  // A registered legacy default remains supported without moving existing games.
  for (const root of [defaultGameFolder(appData), path.join(appData, '.wcl')]) {
    if (folders.some(folder => path.resolve(folder.path) === path.resolve(root))) {
      fs.mkdirSync(root, { recursive: true })
    }
  }
}
