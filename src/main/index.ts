import { app, BrowserWindow, crashReporter, shell, ipcMain, net, powerMonitor, protocol, type BrowserWindowConstructorOptions } from 'electron'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { authorizeManagedImage } from './core/appearanceAssets'
import {
  initializeLauncherLog,
  launcherLogError,
  launcherLogInfo,
  launcherLogWarn,
  flushLauncherLog,
  flushLauncherLogSync,
  logScope
} from './core/launcherLog'
import { getSettings, migrateLegacyAppearanceAssets } from './core/settings'
import { windowAppearance } from './windowAppearance'
import { applyNativeAppearance } from './nativeAppearance'
import { loadWindowState, trackWindowState, applyMaximized, toggleMaximize, restoreWindowBounds } from './windowState'
import { stopDirectHost } from './core/directConnect'
import { stopVoxlinkOnQuit } from './core/voxlink'
import { stopTerracottaOnQuit } from './core/terracotta'
import { frpManager } from './core/frpService'
import { applyUpdateOnStartup, acknowledgeUpdateStartup, blockedUpdateVersion, getPendingUpdate } from './core/applyUpdate'
import { startMemoryTrim } from './core/memTrim'
import type { MemoryTrimController } from './core/memTrim'
import { getRunningGamePids } from './core/launch'
import { exitHistory, rememberExit } from './core/exitHistory'
import { configureRuntimeGraphics } from './runtimeGraphics'
import { resynchronizeWindowsRestore } from './windowRestoreVisibility'
import { adaptiveWindowOptions, attachUiWindowSizing } from './uiWindowSizing'
import { initializePortableDataDir } from './portableData'
import { showStartupWindow } from './nativeStartup'

// 便携式布局：userData 重定向到 exe 旁的 WCL 目录，必须早于任何模块读取 userData
initializePortableDataDir()

configureRuntimeGraphics(app.commandLine, process.platform, dirname(process.execPath))

const launcherExitRecord = rememberExit(() => {
  exitHistory().reconcile()
  return exitHistory().begin('launcher', process.pid, app.getVersion())
})

// ---------------- 内存极限压榨（任务A）：Chromium/V8 开关（必须 app ready 前注册） ----------------
app.commandLine.appendSwitch(
  'js-flags',
  [
    // 渲染层持有轮播图/皮肤/列表等图片型大对象，512MB 老生代上限防 OOM（上限≠预留，按需分配，主进程实际占用远低于此）
    '--max-old-space-size=512',
    // 年轻生代半空间 16MB→8MB：压低静默期年轻代常驻，代价是 Minor GC 稍频繁
    '--max-semi-space-size=8',
    // 暴露 window.gc()：idleTrim 瘦身时主动回收
    '--expose-gc'
  ].join(' ')
)
// 单窗口应用：限制渲染进程数量为 1，防止额外渲染进程常驻
app.commandLine.appendSwitch('renderer-process-limit', '1')
// 同站点共享渲染进程，避免按站点膨胀进程数
app.commandLine.appendSwitch('process-per-site')

// 启动日志尽 earliest 初始化：闪退发生在 app.whenReady 之前时也有据可查
try {
  initializeLauncherLog()
  launcherLogInfo('main', '主进程模块加载完成，开始初始化')
} catch {
  /* 日志不可影响启动 */
}

// 崩溃取证：minidump 落到 userData/Crashpad（不上传），配合 launcher-current.log 定位闪退
try {
  crashReporter.start({ uploadToServer: false, compress: false })
  launcherLogInfo('main', '崩溃报告器已启动（仅本地留存 minidump）')
} catch (error) {
  launcherLogWarn('main', 'crashReporter 初始化失败，不阻断启动', error)
}

launcherLogInfo('main', '注册特权协议方案：wcl-asset / wcl-plugin')

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'wcl-asset',
    // 仅供 <img>/CSS 读取，不开放 renderer fetch，缩小本地资源协议的攻击面。
    privileges: { standard: true, secure: true, stream: true }
  },
  {
    scheme: 'wcl-plugin',
    // 插件脚本协议：仅服务已启用插件的 main.js（见 core/plugins.ts registerPluginProtocol）。
    privileges: { standard: true, secure: true, stream: true }
  }
])

let win: BrowserWindow | null = null
let skinEditorDirty=false
let skinEditorPrefsPending=false
const skinEditorPrefsOwners=new Set<string>()
let skinEditorBusy=false
const skinEditorBusyOwners=new Set<string>()
let deferredPaletteClose=false, deferredPaletteQuit=false
let mascotPending=false
/** 内存压榨控制器：whenReady 时初始化；createWindow 的窗口事件经此转发（静默瘦身） */
let memTrim: MemoryTrimController | null = null

function createWindow(): void {
  logScope('window').debug('开始创建主窗口')
  applyNativeAppearance(null, getSettings())
  const windowState = loadWindowState()
  const autoFit = getSettings().uiWindowAutoFit === true
  let initialWindow: BrowserWindowConstructorOptions = { ...windowAppearance(), ...(windowState
    ? { width: windowState.width, height: windowState.height, x: windowState.x, y: windowState.y }
    : {}) }
  if (autoFit) initialWindow = adaptiveWindowOptions(initialWindow)
  win = new BrowserWindow({
    ...initialWindow,
    icon: join(__dirname, '../../build/icon.png'),
    show: false,
    title: 'WCL',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: true
    }
  })
  // 淡入结束后由 showStartupWindow 发出 wcl:startup-opacity-complete，
  // WindowMaterial.exe 才能释放 setOpacity 留下的 WS_EX_LAYERED 并刷新帧样式
  win.on('ready-to-show', () => { if (win) showStartupWindow(win) })
  win.webContents.once('did-finish-load', () => { void frpManager.restore().catch(error => launcherLogWarn('frp', '恢复隧道失败', error)) })
  applyNativeAppearance(win, getSettings())
  if (process.platform === 'win32' && windowState) restoreWindowBounds(win, autoFit
    ? { ...windowState, width: initialWindow.width!, height: initialWindow.height!, x: initialWindow.x, y: initialWindow.y }
    : windowState)
  if (windowState?.maximized) applyMaximized(win)
  attachUiWindowSizing(win, autoFit)
  trackWindowState(win)
  win.once('show', () => { void acknowledgeUpdateStartup().catch(error => launcherLogWarn('update', '更新确认失败', error)) })
  const mainWindow = win
  skinEditorDirty=false
  skinEditorPrefsPending=false
  skinEditorPrefsOwners.clear()
  skinEditorBusy=false; skinEditorBusyOwners.clear()
  deferredPaletteClose=false; deferredPaletteQuit=false
  mascotPending=false
  mainWindow.on('close',event=>{
    if (mainWindow.webContents.isDestroyed()) return
    if (skinEditorDirty || skinEditorPrefsPending || skinEditorBusy) { event.preventDefault(); deferredPaletteClose=skinEditorPrefsPending&&!skinEditorDirty&&!skinEditorBusy; mainWindow.webContents.send('window:skinEditorClose'); return }
    if (mascotPending) { event.preventDefault(); mainWindow.webContents.send('window:mascotClose') }
  })
  mainWindow.once('closed', () => { if (win === mainWindow) win = null })
  mainWindow.webContents.on('render-process-gone', () => {
    if(win!==mainWindow)return
    // A crashed renderer cannot acknowledge an editor close request.
    skinEditorDirty=false; skinEditorPrefsPending=false; skinEditorPrefsOwners.clear()
    skinEditorBusy=false; skinEditorBusyOwners.clear()
    mascotPending=false; deferredPaletteClose=false; deferredPaletteQuit=false
  })
  // 静默瘦身钩子：最小化/隐藏触发工作集整理 + 渲染层瘦身广播；恢复不做处理（自然回涨）
  mainWindow.on('minimize', () => memTrim?.noteHidden())
  mainWindow.on('hide', () => memTrim?.noteHidden())
  mainWindow.on('restore', () => memTrim?.noteVisible())
  mainWindow.on('show', () => memTrim?.noteVisible())
  // Native hiding does not consistently update Page Visibility on every Electron/macOS combination.
  const reportVisibility = (visible: boolean) => {
    if (!mainWindow.webContents.isDestroyed()) mainWindow.webContents.send('window:visibility', visible)
  }
  mainWindow.on('hide', () => reportVisibility(false))
  mainWindow.on('minimize', () => reportVisibility(false))
  mainWindow.on('show', () => reportVisibility(mainWindow.isVisible() && !mainWindow.isMinimized()))
  mainWindow.on('restore', () => reportVisibility(mainWindow.isVisible() && !mainWindow.isMinimized()))
  resynchronizeWindowsRestore(mainWindow, process.platform, (phase, error) => {
    launcherLogWarn('window', `恢复窗口可见性同步失败：${phase}`, error)
  })
  if (process.platform === 'win32') {
    // Native draggable regions do not dispatch DOM clicks. Observe, never consume.
    mainWindow.hookWindowMessage(0x00A1, (wParam) => {
      if (wParam.readUInt32LE(0) === 2 && !mainWindow.webContents.isDestroyed()) {
        mainWindow.webContents.send('window:caption-pointerdown')
      }
    })
  }
  mainWindow.on('will-move', () => {
    if (!mainWindow.webContents.isDestroyed()) mainWindow.webContents.send('window:caption-pointerdown')
  })
  // 渲染进程崩溃/无响应取证（25h2 GPU 崩溃常见前兆），现有 splash 处理只覆盖初始化期
  win.webContents.on('render-process-gone', (_event, details) => {
    if (!['clean-exit', 'killed'].includes(details.reason)) rememberExit(() => exitHistory().fault('launcher', `启动器界面异常退出：${details.reason}（代码 ${details.exitCode}）。`))
    launcherLogWarn('window', `渲染进程退出：reason=${details.reason} exitCode=${details.exitCode}`)
  })
  win.webContents.on('unresponsive', () => {
    launcherLogWarn('window', '渲染进程无响应')
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  initializeLauncherLog()
  launcherLogInfo('main', `Electron 就绪（版本 ${app.getVersion()}）`)
  if (await applyUpdateOnStartup()) return
  // 内存压榨控制器：指标日志 + 静默期工作集整理（trim 进程清单来自 getAppMetrics，绝不触碰游戏进程）
  memTrim = await startMemoryTrim(() => win, (message) => launcherLogInfo('memory', message))
  launcherLogInfo('memory', '内存压榨控制器已启动（指标日志 5 分钟/条；静默 10 分钟后低频整理）')
  const { registerIpc } = await import('./ipc')
  try {
    await migrateLegacyAppearanceAssets()
  } catch (error) {
    launcherLogWarn('appearance', '旧版外观资源迁移失败，不阻断启动', error)
  }
  protocol.handle('wcl-asset', (request) => {
    if (request.method !== 'GET') return new Response('Method Not Allowed', { status: 405 })
    try {
      const candidate = new URL(request.url).searchParams.get('path') ?? ''
      const authorized = authorizeManagedImage(
        candidate,
        getSettings().folders.map((folder) => folder.path)
      )
      if (!authorized) return new Response('Not Found', { status: 404 })
      return net.fetch(pathToFileURL(authorized).toString())
    } catch {
      return new Response('Not Found', { status: 404 })
    }
  })
  const { registerPluginProtocol } = await import('./core/plugins')
  registerPluginProtocol()
  registerIpc(() => win && !win.isDestroyed() ? win : null)
  launcherLogInfo('main', 'IPC 通道与插件协议注册完成')

  // 存量实例自包含迁移（老式 inheritsFrom 继承 → 合并进实例，幂等）：基础版本改名/删除不再波及已装实例
  void import('./core/versions').then(({ migrateFlattenedInstances }) =>
    migrateFlattenedInstances((m) => launcherLogInfo('migrate', m)).then((n) => {
      if (n > 0) launcherLogInfo('migrate', `共 ${n} 个旧式继承实例已合并为自包含实例`)
      launcherLogInfo('migrate', '存量实例迁移检查完成')
    })
  )

  ipcMain.on('window:minimize', () => win?.minimize())
  ipcMain.on('window:maximize', () => win && toggleMaximize(win))
  ipcMain.on('window:close', () => win?.close())
  ipcMain.on('wcl:files-dropped', (event, paths) => {
    if (event.sender !== win?.webContents || !Array.isArray(paths)) return
    const list = paths.filter((item): item is string => typeof item === 'string')
    if (list.length) event.sender.send('wcl:files-dropped', list)
  })
  ipcMain.handle('window:visibility', event => event.sender === win?.webContents && win.isVisible() && !win.isMinimized())
  ipcMain.on('window:skinEditorQuit',event=>{if(event.sender===win?.webContents&&!skinEditorDirty&&!skinEditorPrefsPending&&!skinEditorBusy)app.quit()})
  ipcMain.on('window:skinEditorDirty',(event,value)=>{if(event.sender===win?.webContents)skinEditorDirty=value===true})
  ipcMain.on('window:skinEditorBusy',(event,value)=>{
    if(event.sender!==win?.webContents)return
    if(!value||typeof value.ownerId!=='string'||!/^[a-zA-Z0-9-]{1,64}$/.test(value.ownerId)||typeof value.pending!=='boolean')return
    if(value.pending)skinEditorBusyOwners.add(value.ownerId);else skinEditorBusyOwners.delete(value.ownerId)
    skinEditorBusy=skinEditorBusyOwners.size>0
  })
  ipcMain.on('window:skinEditorPrefsPending',(event,value)=>{
    if(event.sender!==win?.webContents)return
    if(!value||typeof value.ownerId!=='string'||!/^[a-zA-Z0-9-]{1,64}$/.test(value.ownerId)||typeof value.pending!=='boolean')return
    if(value.pending)skinEditorPrefsOwners.add(value.ownerId);else skinEditorPrefsOwners.delete(value.ownerId)
    skinEditorPrefsPending=skinEditorPrefsOwners.size>0
    if(!skinEditorPrefsPending){
      const close=deferredPaletteClose, quit=deferredPaletteQuit
      deferredPaletteClose=false; deferredPaletteQuit=false
      // An editor removed by navigation has no close subscriber; finish its pending exit here.
      if(!skinEditorDirty&&!skinEditorBusy){if(quit)app.quit();else if(close)win?.close()}
    }
  })
  ipcMain.on('window:mascotPending',(event,value)=>{if(event.sender===win?.webContents)mascotPending=value===true})
  ipcMain.on('window:mascotQuit',event=>{if(event.sender===win?.webContents&&!mascotPending&&!skinEditorDirty&&!skinEditorPrefsPending&&!skinEditorBusy)app.quit()})

  createWindow()
  launcherLogInfo('main', '主窗口创建完成')

  // 自动更新计时器只注册一次；游戏状态由每个窗口的 renderer-ready 重放。
  win?.webContents.once('did-finish-load', () => {
    // 启动即提醒上次更新结果/已就绪的更新包（不再走 GitHub Release 自动下载）
    const notifyPending = async () => {
      try {
        const applyMod = await import('./core/applyUpdate')
        if (applyMod.consumeUpdateFailedFlag()) win?.webContents.send('event:updatePrompt', { rollbackNotice: true })
        const pending = applyMod.getPendingUpdate()
        if (pending) win?.webContents.send('event:updateReady', { version: pending.release.version })
      } catch (e) {
        launcherLogInfo('main', `启动更新状态读取失败（静默降级）：${e instanceof Error ? e.message : String(e)}`)
      }
    }
    void notifyPending()
    // 仓库 latest.json 更新检查：加载完成即发起请求（并行镜像，最多 6 秒），10 秒后消费结果弹窗；
    // 休眠恢复后同样延迟 10 秒再查。
    let pendingLatest: Promise<import('../shared/types').LatestUpdateInfo | null> | null = null
    const probeLatest = () => {
      if (!pendingLatest) {
        pendingLatest = (async () => {
          try {
            const { checkLatestJson } = await import('./core/latestUpdate')
            return await checkLatestJson()
          } catch (e) {
            launcherLogInfo('main', `latest.json 检查失败（静默降级）：${e instanceof Error ? e.message : String(e)}`)
            return null
          }
        })()
      }
      return pendingLatest
    }
    const notifyLatest = async (refresh = false) => {
      if (refresh) pendingLatest = null
      const info = await probeLatest()
      if (info) win?.webContents.send('event:latestAvailable', info)
    }
    void probeLatest()
    setTimeout(() => void notifyLatest(), 10_000)
    setInterval(() => void notifyLatest(true), 6 * 3600_000)
    powerMonitor.on('resume', () => setTimeout(() => void notifyLatest(true), 10_000))
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      launcherLogInfo('window', 'macOS 激活事件：重新创建主窗口')
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', event => {
  if((skinEditorDirty||skinEditorPrefsPending||skinEditorBusy)&&win&&!win.webContents.isDestroyed()){event.preventDefault();deferredPaletteQuit=skinEditorPrefsPending&&!skinEditorDirty&&!skinEditorBusy;win.webContents.send('window:skinEditorClose',{quit:true});return}
  if(mascotPending&&win&&!win.webContents.isDestroyed()){event.preventDefault();win.webContents.send('window:mascotClose',{quit:true});return}
  // 仅清理联机相关子进程/监听器；不影响 Minecraft 生命周期。
  void stopDirectHost()
  void stopVoxlinkOnQuit()
  void stopTerracottaOnQuit()
  void frpManager.shutdown().catch(error => launcherLogWarn('frp', '关闭隧道失败', error))
  launcherLogInfo('main', '所有窗口已关闭，开始清理联机相关资源')
})

// ---------------- 崩溃取证（win11 25h2 概率闪退排查） ----------------
// 主进程未捕获异常：记录完整堆栈并保持进程存活（活着 > 闪退；日志可回溯）
process.on('uncaughtException', (error) => {
  rememberExit(() => exitHistory().fault('launcher', '启动器发生未捕获异常，详情已记录到启动器日志。'))
  launcherLogError('crash', '主进程未捕获异常（进程保持存活）', error)
})
process.on('unhandledRejection', (reason) => {
  rememberExit(() => exitHistory().fault('launcher', '启动器发生未处理的异步错误，详情已记录到启动器日志。'))
  launcherLogError('crash', '未处理的 Promise 拒绝', reason)
})
// 子进程（GPU/渲染/网络等）异常退出记录：25h2 上 GPU 进程崩溃是常见闪退前兆
app.on('child-process-gone', (_event, details) => {
  if (!['clean-exit', 'killed'].includes(details.reason)) rememberExit(() => exitHistory().fault('launcher', `启动器子进程异常退出：${details.type} / ${details.reason}（代码 ${details.exitCode}）。`))
  launcherLogWarn(
    'crash',
    `子进程异常退出：type=${details.type} reason=${details.reason} exitCode=${details.exitCode}`
  )
})
app.on('before-quit', () => {
  // 任务B：任何正常退出路径都不终止游戏——游戏进程以脱离方式创建（gracefulClose.spawnGameProcess），
  // 这里只记录「游戏继续运行」，绝无 taskkill/树杀。
  const gamePids = getRunningGamePids()
  if (gamePids.length) launcherLogInfo('exit', `启动器已退出，游戏(进程 PID ${gamePids.join('、')})继续运行`)
  // 尽早异步刷盘；quit 事件里还有同步兜底
  void flushLauncherLog()
})
app.on('quit', (_event, exitCode) => {
  if (launcherExitRecord) rememberExit(() => exitHistory().end(launcherExitRecord, exitCode ?? Number(process.exitCode ?? 0)))
  try {
    launcherLogInfo('main', `应用退出，退出码 ${exitCode ?? process.exitCode ?? 0}`)
  } catch {
    /* 忽略 */
  }
  flushLauncherLogSync()
})
