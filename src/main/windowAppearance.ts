import type { BrowserWindowConstructorOptions } from 'electron'

/**
 * 主窗口的固定外观基线。
 *
 * renderer 只负责绘制带 alpha 的界面层；Windows 11 22H2+ 的桌面模糊由
 * DWM acrylic material 完成，旧版 Windows 则稳定降级为透明窗口 + 半透明色板。
 */
export function windowAppearance(
  platform: NodeJS.Platform = process.platform
): Pick<
  BrowserWindowConstructorOptions,
  | 'width'
  | 'height'
  | 'minWidth'
  | 'minHeight'
  | 'frame'
  | 'transparent'
  | 'backgroundColor'
  | 'backgroundMaterial'
  | 'roundedCorners'
  | 'hasShadow'
  | 'thickFrame'
  | 'titleBarStyle'
  | 'trafficLightPosition'
  | 'vibrancy'
  | 'visualEffectState'
> {
  return {
    width: 1360,
    height: 860,
    minWidth: 960,
    minHeight: 620,
    frame: platform === 'darwin',
    titleBarStyle: platform === 'darwin' ? 'hiddenInset' : undefined,
    trafficLightPosition: platform === 'darwin' ? { x: 16, y: 16 } : undefined,
    vibrancy: platform === 'darwin' ? 'sidebar' : undefined,
    visualEffectState: platform === 'darwin' ? 'active' : undefined,
    // Windows：保持普通 HWND 交给 DWM acrylic 合成，backgroundColor 必须是
    // 不透明值，带 alpha 会被 Electron 当成透明窗口并跳过材质绘制。
    // 渲染层再用半透明底色叠在材质上，才能看到后方窗口的模糊颜色。
    transparent: platform !== 'win32',
    backgroundColor: platform === 'darwin' ? '#00000000' : '#000000',
    backgroundMaterial: platform === 'win32' ? 'acrylic' : undefined,
    roundedCorners: true,
    hasShadow: true,
    thickFrame: true
  }
}
