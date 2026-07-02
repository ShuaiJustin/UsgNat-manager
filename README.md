# 华为 USG 防火墙 NAT 管理软件

![Version](https://img.shields.io/badge/version-1.1.6-blue.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS-lightgrey.svg)
![Electron](https://img.shields.io/badge/Electron-28-47848f.svg)

面向华为 USG 防火墙的 NAT Server 规则管理桌面应用。它把设备连接、规则同步、公网 IP 监控、自动更新和日志查询放在一个本地客户端里，适合公网 IP 会变化、但 NAT 映射规则需要保持可用的场景。

## 功能

- **设备管理**：维护 USG 设备信息，测试 SSH 连接。
- **规则同步**：从设备读取 NAT 规则，编辑本地规则并同步回设备。
- **批量更新**：批量替换规则公网 IP，减少重复手工配置。
- **IP 监控**：配置检测源、检测间隔和确认次数，识别公网 IP 变化。
- **自动化策略**：按立即、延迟或定时策略更新选定设备规则。
- **日志与数据**：查询/导出日志，备份数据，导入/导出配置。

## 技术栈

- Electron 28 + React 18 + TypeScript
- Ant Design + Tailwind CSS
- Zustand + TanStack Query
- Prisma + SQLite
- ssh2

## 快速开始

```bash
git clone https://github.com/chengchnegcheng/UsgNat-manager.git
cd UsgNat-manager
npm install
npx prisma db push
npm run dev
```

`npm install` 会自动执行 `prisma generate`。开发模式会先构建 Electron 主进程，再同时启动 Vite 和 Electron。

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 启动开发环境 |
| `npm run build` | 构建主进程和渲染进程 |
| `npm run package:win` | 打包 Windows 安装版和便携版 |
| `npm run package:mac` | 打包 macOS dmg/zip，需要 macOS 环境 |
| `npm test` | 运行源码测试 |
| `npm run lint` | 运行 ESLint |
| `npm run type-check` | 运行 TypeScript 类型检查 |

## 项目结构

```text
src/main/        Electron 主进程、IPC、窗口、托盘和业务服务
src/renderer/    React 页面、组件、状态和工具函数
prisma/          Prisma schema 与 SQLite 数据模型
resources/       应用图标和构建资源
scripts/         构建、发布、测试脚本
```

## 打包输出

Windows 打包产物输出到 `release/`：

- `USG-NAT-Manager-Setup-<version>.exe`
- `USG-NAT-Manager-Portable-<version>.exe`

macOS 打包需在 macOS 环境执行 `npm run package:mac`。

## 许可证

MIT
