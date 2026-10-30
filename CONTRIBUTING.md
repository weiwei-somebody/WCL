# 贡献指南

## 环境

- Windows 11、Node.js 18+、npm
- 编译 `bridge`（Fabric 模组）需要 JDK 17+
- 编译 `native` 原生助手需要 .NET SDK

## 常用命令

```bash
npm install
npm run dev          # Electron 开发环境
npm run dev:web      # 仅渲染层
npm run typecheck    # 类型检查
npm test             # 测试
npm run build        # 完整构建
npm run dist:win     # 打包便携版 exe
```

提交前请至少通过 `npm run typecheck`。

## 目录约定

- `src/main`：主进程逻辑，按功能拆分到 `core/` 下的独立模块
- `src/preload`：只暴露 IPC 通道，不承载业务逻辑
- `src/views`、`src/components`：视图与组件，不直接引用 Electron API
- `src/shared`：渲染层与主进程共享的类型、策略与纯函数
- `src/api.ts`：渲染层 IPC 调用封装，新增通道需同步类型定义

## 代码风格

- 统一使用 TypeScript，函数与变量命名简洁且可读
- 不使用无意义的注释与调试日志
- 大括号独占一行，缩进统一
- 视图层样式优先使用 `src/ui` 中的设计变量，不写死颜色
- 提交前清理临时文件与本地构建产物

## 提交信息

使用 `类型: 说明` 的格式，类型包括 `feat`、`fix`、`refactor`、`docs`、`build`、`test`、`chore`。

## 提交内容

- 不要提交 `node_modules`、`out`、`dist`、`release` 等生成目录（已在 `.gitignore` 中排除）
- 不要提交任何账号凭据、访问令牌或本地游戏数据
