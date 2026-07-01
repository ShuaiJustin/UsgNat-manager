# 华为 USG 防火墙 NAT 管理软件

华为 USG 防火墙 NAT Server 规则管理桌面应用。适用于公网 IP 变化后需要维护 NAT 映射规则的场景，提供设备管理、规则同步、IP 监控、自动更新和日志查询能力。

## 功能概览

- 设备管理：维护 USG 设备信息，测试 SSH 连接。
- NAT 规则：从设备同步规则，编辑本地规则，批量更新公网 IP。
- IP 监控：检测公网 IP，支持检测间隔、确认次数和检测源配置。
- 自动化更新：按立即、延迟或定时策略更新选定设备规则。
- 日志与备份：记录操作日志，支持日志导出、数据备份和配置导入导出。
- 桌面体验：系统托盘、开机自启、窗口控制、中文/英文界面。

## 技术栈

- Electron 28
- React 18 + TypeScript
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

```bash
npm run dev          # 启动开发环境
npm run build        # 构建主进程和渲染进程
npm run package:win  # 打包 Windows 安装版和便携版
npm run package:mac  # 打包 macOS dmg/zip，需要 macOS 环境
npm test             # 运行源码测试
npm run lint         # 运行 ESLint
npm run type-check   # 运行 TypeScript 类型检查
```

## 项目结构

```text
src/main/        Electron 主进程、IPC、窗口、托盘和业务服务
src/renderer/    React 页面、组件、状态和工具函数
prisma/          Prisma schema 与 SQLite 数据模型
resources/       应用图标和构建资源
scripts/         构建、发布、测试脚本
docs/            发布、设置和历史文档
```

## 打包输出

Windows 打包产物输出到 `release/`：

- `USG-NAT-Manager-Setup-<version>.exe`
- `USG-NAT-Manager-Portable-<version>.exe`

macOS 打包需在 macOS 环境执行 `npm run package:mac`。

## 相关文档

- [GitHub 设置指南](docs/guides/setup/github-setup.md)
- [版本更新说明](docs/guides/release/version-update.md)
- [版本优化说明](docs/guides/release/version-optimization.md)
- [图标资源说明](docs/icons.md)

## 许可证

MIT
