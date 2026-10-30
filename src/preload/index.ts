import { contextBridge, ipcRenderer, webUtils } from 'electron'

/**
 * 拖拽文件取真实路径：File 经由 contextBridge 传参时已丢失内部路径映射，
 * getPathForFile 会给出错误结果，因此必须在 preload 内直接监听 drop，
 * 拿同进程的真实 File 再求路径，随后交给主进程转发给渲染层。
 */
window.addEventListener('drop', (event) => {
  const data = (event as DragEvent).dataTransfer
  const files = data?.files
  if (!files?.length) return
  const paths: string[] = []
  for (const file of Array.from(files)) {
    const path = webUtils.getPathForFile(file)
    if (path) paths.push(path)
  }
  if (!paths.length) return
  event.preventDefault()
  event.stopPropagation()
  ipcRenderer.send('wcl:files-dropped', paths)
}, true)

const api = {
  invoke: (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args),
  on: (channel: string, cb: (...args: unknown[]) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, ...args: unknown[]) => cb(...args)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  },
  send: (channel: string, ...args: unknown[]) => ipcRenderer.send(channel, ...args),
  platform: process.platform
}

contextBridge.exposeInMainWorld('wcl', api)
