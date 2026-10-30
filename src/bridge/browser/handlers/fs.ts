import { IPC } from '../../contract'
import { activeFolder, instanceGameDir } from '../storage'
import { vfsList, vfsPut, vfsRemove, vfsToggle } from '../vfs'
import type { FsEntry } from '@shared/types'

function resolve(rel: string, folder?: string): string {
  return folder?.trim() || activeFolder()
}

export const fsHandlers = {
  [IPC.fsList]: (rel: string, folder?: string): FsEntry[] => vfsList(resolve(rel, folder), rel),
  [IPC.fsPath]: (rel: string, folder?: string): string => `${resolve(rel, folder)}/${rel}`,
  [IPC.fsRemove]: (rel: string, name: string, folder?: string): FsEntry[] =>
    vfsRemove(resolve(rel, folder), rel, name),
  [IPC.fsToggleDisable]: (rel: string, name: string, folder?: string): FsEntry[] =>
    vfsToggle(resolve(rel, folder), rel, name),
  [IPC.fsImportResources]: (files: string[], id: string, folder: string, kind: string): number => {
    const dir = instanceGameDir(id, folder)
    for (const name of files) vfsPut(dir, kind, name, 0)
    return files.length
  },
  [IPC.appOpenDir]: () => null
}
