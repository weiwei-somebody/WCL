# WCL

WCL（W Craft Launcher）是一个面向 Windows 的 Minecraft 启动器，使用 Vue 3 + Electron 构建，界面采用深板岩与铜色的暖色配色和毛玻璃材质。

当前版本为 **0.1.0**，已提供可执行的便携版安装包：[Releases](https://github.com/weiwei-somebody/WCL/releases)。

## 功能

### 实例与启动

- 版本安装：支持原版、Forge、Fabric、Quilt、NeoForge，可指定加载器版本并可自动补装 Fabric API
- 版本管理：调整游戏设置、管理模组、重命名、导出整合包
- Java 管理：自动扫描与探测本机 Java、按版本要求选择、支持自动下载运行时
- 启动准备：版本链解析、资源与库补全、账号注入、离线皮肤注入、启动日志记录
- 实例内资源：模组、资源包、光影、录像、投影按实例独立管理

### 下载与资源

- 统一下载队列：实例安装、模组、整合包、导出等任务集中到一个下载页面，串行排队执行，可暂停与取消
- 模组来源：Modrinth 与 CurseForge，按实例的 Minecraft 版本与加载器自动过滤，可关闭过滤开关
- 模组信息：解析前置依赖并以 BFS 递归下载、展示 MC 百科中文译名与图标、支持中文关键词反查
- 整合包：支持 WCL 自有格式导入导出，导入时探测 `WCL/pack.json` 并补齐缺失文件
- 存档导入：支持实例内与全局两种导入流程

### 账号与皮肤

- 账号类型：微软正版登录、离线账号、Yggdrasil 外置登录
- 凭据保护：本地加密存储 accessToken / refreshToken / clientToken
- 皮肤：3D 皮肤预览、皮肤库浏览、披风与皮肤模型切换、离线皮肤启动注入

### 联机与服务器

- 服务器管理：实例绑定/解绑服务器、在线状态探测、直接用当前实例进服
- 快捷进服：首页快捷进入收藏与最近使用的服务器
- 联机：内置 Terracotta 与 FRP 穿透相关能力

### 界面

- 首页自由画布：卡片可拖动、可缩放、互不重叠，布局可自定义，窄屏自动退回单列
- 主题：暗色近黑底 + 铜色强调，亮色为暖瓷白 + 铜色；卡片毛玻璃配合颗粒噪点
- 外观设置：强调色、圆角、背景等修改实时写入全局样式变量
- 窗口：Electron 无边框窗口，34px 拖拽区，双击最大化，配合原生助手实现材质与淡入

## 技术栈

| 层 | 技术 |
| --- | --- |
| 渲染层 | Vue 3、Vue Router、Pinia、TypeScript、Vite |
| 桌面层 | Electron、electron-vite、electron-builder |
| 桥接层 | Fabric 模组（Java）+ WebSocket 桥接，`src/bridge` 契约 |
| 原生助手 | C#（窗口材质、游戏窗口聚焦），随包 `asarUnpack` |
| 网络 | undici、ws；压缩 yauzl / yazl / adm-zip |

渲染层通过 `src/api.ts` 与 IPC 契约访问主进程能力，视图层不直接依赖 Electron。

## 目录结构

```
WCL
├── src
│   ├── main          Electron 主进程（实例、下载、启动、账号、服务器、更新等核心逻辑）
│   ├── preload       预加载脚本，暴露 window.wcl
│   ├── views         页面视图
│   ├── components    通用组件
│   ├── shared        渲染层与主进程共享的类型与策略
│   ├── store         Pinia 状态
│   ├── data          外部接口（Modrinth、MC 百科、Mojang、皮肤渲染）
│   ├── ui            设计变量与基础样式
│   └── api.ts        渲染层 IPC 调用封装
├── bridge            Fabric 模组源码（MOD 面板桥接）
├── native            C# 原生助手源码
├── offline-skin-agent 离线皮肤注入代理
├── scripts           构建原生助手与图标的脚本
├── tests             Node 测试
└── build             应用图标
```

## 开发

环境要求：Windows 11、Node.js 18+、npm；编译 `bridge` 需要 JDK 17+，编译原生助手需要 .NET SDK。

```bash
npm install
npm run dev          # 启动 Electron 开发环境
npm run dev:web      # 仅启动浏览器版渲染层
npm run typecheck    # 类型检查
npm test             # 运行测试
```

## 构建与打包

```bash
npm run build        # 构建主进程、预加载、渲染层，并编译原生助手
npm run dist:win     # 构建并生成便携版 exe
```

打包产物输出到 `release/`，便携版为 `WCL-0.1.0.exe`。运行后在 exe 同级目录生成 `WCL` 数据文件夹，游戏目录默认使用同级 `.minecraft`；开发环境下仍使用系统默认的 `%APPDATA%` 路径。

## 说明

- 浏览器端（`npm run dev:web`）无法访问桌面能力，相关功能以「模拟」角标标识。
- 整合包格式为 WCL 自有格式，压缩包内通过 `WCL/pack.json` 标识，导入时忽略路径大小写差异。

## 致谢

启动逻辑与交互设计参考 PCL2 与 KAMUCL 的实现思路，模组中文译名数据来自 MC 百科，模组与整合包资源来自 Modrinth 与 CurseForge。
