# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

华为USG防火墙NAT管理软件 - 基于 Electron + React 的跨平台桌面应用,用于自动化管理华为USG系列防火墙的NAT Server规则。

**核心功能:**
- 自动检测公网IP变化并批量更新NAT规则
- 设备管理和凭据安全存储 (支持密码/私钥/证书/多因子认证)
- 规则同步、批量编辑和导入导出
- 自动化配置和多渠道通知 (Windows/邮件/微信)
- 完整的日志系统和操作审计

## 技术栈

**前端:**
- React 18.2 + TypeScript 5.3
- Ant Design 5.12 + Tailwind CSS 3.4
- Zustand (状态管理) + TanStack Query (数据请求)
- React Router 6

**桌面框架:**
- Electron 28.3
- electron-builder 26.0 (打包)

**后端/主进程:**
- Node.js 18+
- Prisma 5.7 + SQLite (数据库ORM)
- ssh2 (SSH连接管理)
- Winston (日志)
- node-schedule (定时任务)

## 常用命令

### 开发环境

```bash
# 安装依赖
npm install

# 初始化数据库
npx prisma generate
npx prisma db push

# 开发模式 (主进程 + 渲染进程热重载)
npm run dev

# 仅开发渲染进程 (Vite开发服务器)
npm run dev:vite

# 仅开发主进程
npm run dev:electron
```

### 构建和打包

```bash
# 构建主进程
npm run build:main

# 构建渲染进程
npm run build:renderer

# 完整构建
npm run build

# 打包 Windows 安装程序 (生成 NSIS 和 Portable 版本)
npm run package:win

# 打包 macOS (需在 macOS 上执行)
npm run package:mac

# 通用打包 (自动检测当前系统)
npm run package

# 验证构建配置
npm run verify:build
```

### 代码质量

```bash
# 代码检查
npm run lint

# 自动修复 lint 问题
npm run lint:fix

# 格式化代码
npm run format

# 检查代码格式
npm run format:check

# 类型检查
npm run type-check
```

### 数据库管理

```bash
# 生成 Prisma Client
npx prisma generate

# 推送数据库模式 (开发环境)
npx prisma db push

# 创建数据库迁移
npx prisma migrate dev

# 打开 Prisma Studio (可视化数据库管理)
npx prisma studio
```

### 版本管理

```bash
# 更新版本号 (自动更新 package.json 和相关文件)
npm run version:update
```

## 项目架构

### 目录结构

```
src/
├── main/                          # Electron 主进程
│   ├── main.ts                    # 应用入口，初始化窗口和服务
│   ├── preload.ts                 # 预加载脚本，暴露安全的 API
│   ├── window.ts                  # 窗口管理和生命周期
│   ├── tray.ts                    # 系统托盘集成
│   ├── ipc/
│   │   └── index.ts               # IPC 通信处理器 (设备/规则/日志/配置等所有 API)
│   └── services/                  # 业务服务层
│       ├── prisma-client.ts       # Prisma 客户端初始化
│       ├── ip-monitor.ts          # IP 监控服务 (多源检测，多数投票)
│       ├── ssh-manager.ts         # SSH 连接管理 (连接池，多种认证)
│       ├── usg-parser.ts          # USG 防火墙配置解析器
│       ├── automation-service.ts  # 自动化服务 (监听 IP 变化，触发更新)
│       ├── credential-manager.ts  # 凭据管理 (Windows 凭据管理器集成)
│       ├── backup-service.ts      # 备份和回滚服务
│       ├── notifier.ts            # 通知服务 (Windows/邮件/微信)
│       ├── logger.ts              # 日志服务 (Winston)
│       ├── email-service.ts       # 邮件服务 (nodemailer)
│       ├── config-service.ts      # 配置管理
│       ├── database-service.ts    # 数据库服务
│       └── custom-updater.ts      # 自定义更新系统 (API 版本)
│
└── renderer/                      # React 渲染进程
    ├── App.tsx                    # 应用根组件，路由配置
    ├── main.tsx                   # 渲染进程入口
    ├── i18n/                      # 国际化配置 (i18next)
    ├── pages/                     # 页面组件
    │   ├── Dashboard/             # 主控制台 (状态监控，快速操作)
    │   ├── Devices/               # 设备管理 (添加/编辑/测试连接)
    │   │   └── DeviceModal.tsx    # 设备编辑弹窗
    │   ├── Rules/                 # 规则管理 (同步/批量编辑/导入导出)
    │   │   └── RuleModal.tsx      # 规则编辑弹窗
    │   ├── Automation/            # 自动化配置 (IP 监控/更新策略)
    │   ├── Logs/                  # 日志监控 (操作日志/事件日志)
    │   └── Settings/              # 系统设置 (主题/通知/服务管理)
    ├── components/                # 通用组件
    │   ├── Layout/                # 布局组件 (MainLayout, TitleBar, StatusBar)
    │   ├── UpdateDialog.tsx       # 更新对话框 (支持灰度发布)
    │   └── ErrorBoundary.tsx      # 错误边界
    ├── stores/                    # Zustand 状态管理
    │   ├── monitor.store.ts       # 监控状态
    │   └── app.store.ts           # 应用状态
    └── types/
        └── index.ts               # TypeScript 类型定义

prisma/
├── schema.prisma                  # 数据库模型定义
└── usg-nat.db                     # SQLite 数据库 (开发环境)
                                   # 生产环境: %APPDATA%/usg-nat-manager/usg-nat.db

resources/
├── icons/                         # 应用图标 (多平台多尺寸)
└── tray-icon.png                  # 托盘图标

scripts/
├── postpackage.js                 # 打包后处理脚本
├── verify-build-config.js         # 构建配置验证
├── update-version.js              # 版本更新脚本
├── VERSION-UPDATE-README.md       # 版本更新指南
└── VERSION-OPTIMIZE-GUIDE.md      # 版本优化指南

Docs/
├── 产品需求文档.md                 # 完整的产品需求和功能说明
├── 界面效果图.md                   # UI 设计说明
└── DEPLOYMENT-GUIDE.md            # 部署指南

USG Server Updates/                # 自定义更新系统文档
└── Docs/
    ├── CUSTOM_UPDATE_SYSTEM_DESIGN.md
    ├── ADMIN_SYSTEM_GUIDE.md      # 服务器端部署指南
    └── client/
        ├── README.md              # 客户端更新文档总索引
        ├── QUICK_REFERENCE.md     # 快速参考 (1分钟了解改动)
        ├── MIGRATION_GUIDE.md     # 迁移指南 (详细步骤)
        └── CLIENT_UPDATE_WITH_API.md  # API 方案详解
```

### 核心架构说明

#### 1. IPC 通信架构

主进程通过 `src/main/ipc/index.ts` 注册所有 IPC 处理器，渲染进程通过 `window.electron` (preload.ts 暴露) 调用。

**主要 IPC 频道:**
- `device:*` - 设备管理 (getAll, create, update, delete, testConnection)
- `rule:*` - 规则管理 (getAll, sync, updateIPs, import, export)
- `log:*` - 日志管理 (getAll, query, clear, export)
- `config:*` - 配置管理 (get, set, import, export)
- `credential:*` - 凭据管理 (save, get, delete)
- `monitor:*` - 监控管理 (start, stop, status, getCurrentIP)
- `automation:*` - 自动化管理 (enable, disable, config)
- `backup:*` - 备份管理 (create, restore, list)
- `notification:*` - 通知管理 (send, test)
- `updater:*` - 更新管理 (checkForUpdates, downloadUpdate, installUpdate)

#### 2. 数据库模型 (Prisma)

**核心模型:**
- `Device` - 防火墙设备 (名称, IP, 端口, 连接类型, 状态等)
- `NatRule` - NAT 规则 (规则名称, 协议, 全局IP/端口, 内部IP/端口等)
- `CredentialRef` - 凭据引用 (实际凭据存储在 Windows 凭据管理器)
- `Log` - 日志记录 (级别, 操作, 消息, 详细信息)
- `Config` - 配置存储 (键值对, JSON 格式)

**关系:**
- Device (1) -> NatRule (N) - 级联删除
- Device (1) -> CredentialRef (1) - 一对一关联

#### 3. 服务层职责

**ip-monitor.ts** - IP 监控服务
- 支持多个检测源 (ipify, ip-api 等)
- 多数投票机制确保准确性
- 自动重试和错误恢复
- 发布 IP 变化事件

**ssh-manager.ts** - SSH 连接管理
- SSH 连接池管理
- 支持四种认证方式: 密码/私钥/证书/多因子
- 命令执行和输出解析
- 连接状态监控和自动重连

**usg-parser.ts** - USG 配置解析
- NAT Server 规则提取和解析
- 配置命令生成
- 规则对比和差异检测

**automation-service.ts** - 自动化协调
- 监听 IP 变化事件
- 触发规则更新流程
- 管理更新策略 (立即/延迟/定时)
- 发送通知报告

**credential-manager.ts** - 凭据安全管理
- Windows 凭据管理器集成
- AES-256-GCM 加密存储
- 支持多种认证类型
- 内存安全清理

**custom-updater.ts** - 自定义更新系统
- 基于 RESTful API (非 Electron 自带 autoUpdater)
- 支持灰度发布、强制更新、渠道控制
- 自动下载和安装
- 统计上报 (下载/安装数据)

#### 4. 自动化更新系统

项目使用自定义更新系统 (非 Electron autoUpdater)，通过 RESTful API 与服务器通信。

**核心功能:**
- 灰度发布控制 (服务器控制谁能看到更新)
- 统计数据上报 (下载/安装数据)
- 强制更新支持
- 多服务器冗余
- 渠道控制 (stable/beta/alpha)

**API 端点:**
- `POST /api/v1/updates/check` - 检查更新
- `POST /api/v1/updates/stats/download` - 下载统计
- `POST /api/v1/updates/stats/install` - 安装统计

**详细文档:** 参见 `USG Server Updates/Docs/client/`

## 开发注意事项

### 1. 数据库操作

- **开发环境:** 使用 `npx prisma db push` 快速同步模式
- **生产环境:** 使用 `npx prisma migrate` 创建迁移文件
- **数据库位置:**
  - 开发: `prisma/usg-nat.db`
  - 生产: `%APPDATA%/usg-nat-manager/usg-nat.db`
- 所有数据库操作通过 Prisma Client，导入自 `src/main/services/prisma-client.ts`

### 2. 日志记录

- 使用 `logger` 服务记录所有重要操作
- 日志级别: INFO, SUCCESS, WARNING, ERROR
- 日志自动持久化到数据库和文件
- 文件位置: `%APPDATA%/usg-nat-manager/logs/`

**示例:**
```typescript
await logger.success('设备管理', '设备创建成功', { deviceId });
await logger.error('设备管理', '连接失败', { error: err.message });
```

### 3. SSH 连接管理

- 使用 `sshManager.connect()` 建立连接
- 使用 `sshManager.executeCommand()` 执行命令
- 始终在 finally 块中调用 `sshManager.disconnect()`
- 凭据通过 `credentialManager` 获取，不在代码中硬编码

**示例:**
```typescript
try {
  await sshManager.connect(device.id);
  const output = await sshManager.executeCommand(device.id, 'display current-configuration');
  // 处理输出
} finally {
  await sshManager.disconnect(device.id);
}
```

### 4. 安全注意事项

- **凭据存储:** 所有密码/密钥通过 Windows 凭据管理器存储，不保存在数据库或配置文件
- **SSH 验证:** 使用主机密钥验证防止中间人攻击
- **加密:** 敏感数据使用 AES-256-GCM 加密
- **审计:** 所有敏感操作记录日志用于审计
- 不要在代码中硬编码任何凭据或密钥

### 5. 构建和打包

- **Prisma 打包:** Prisma 引擎需要 unpack，已在 `electron-builder` 配置中设置 `asarUnpack`
- **静态文件:** 资源文件放在 `resources/` 目录，会自动复制到打包输出
- **多平台:** Windows 生成 NSIS 和 Portable 版本，macOS 生成 DMG 和 ZIP
- **图标:**
  - Windows: `resources/icons/icon.ico`
  - macOS: `resources/icons/icon.icns`
- **打包前:** 确保运行 `npm run build` 完成构建

### 6. 更新系统开发

当修改更新相关代码时:
1. 参考 `USG Server Updates/Docs/client/QUICK_REFERENCE.md` 了解核心改动
2. 测试时使用 `USG Server Updates/test_api_server.py` 启动本地测试服务器
3. 测试灰度发布功能 (修改 `rollout_blocked` 字段)
4. 确保统计上报不影响主流程 (包裹在 try-catch 中)
5. UI 更新需同步修改 `UpdateDialog.tsx`

### 7. 国际化

- 支持中文和英文
- 翻译文件: `src/renderer/locales/zh-CN.json` 和 `en-US.json`
- 使用 `useTranslation` hook 获取翻译函数
- 根据用户全局 CLAUDE.md 指令，所有对话和文档应使用中文

### 8. 错误处理

- IPC 处理器中的错误应记录日志并抛出友好的错误消息
- 前端使用 ErrorBoundary 捕获 React 组件错误
- 网络请求使用 try-catch 并提供重试机制
- SSH 连接失败时提供详细的诊断信息

### 9. 性能优化

- 规则列表使用虚拟滚动 (Ant Design Table virtualScroll)
- 大量数据操作使用 Prisma 事务
- SSH 连接使用连接池避免频繁建立连接
- 定时任务使用 node-schedule 而非 setInterval

### 10. 测试

- 连接测试: 使用 `device:testConnection` IPC 接口
- 更新测试: 启动 `test_api_server.py` 进行本地测试
- 数据库测试: 使用 Prisma Studio 查看数据
- 日志测试: 查看 `%APPDATA%/usg-nat-manager/logs/` 目录

## 常见任务

### 添加新的 IPC 接口

1. 在 `src/main/ipc/index.ts` 中注册处理器
2. 在 `src/main/preload.ts` 中暴露接口
3. 在前端调用 `window.electron.ipcRenderer.invoke()`

### 添加新的数据库模型

1. 修改 `prisma/schema.prisma`
2. 运行 `npx prisma generate`
3. 运行 `npx prisma db push` (开发) 或 `npx prisma migrate dev` (生产)
4. 在 IPC 处理器中添加 CRUD 操作

### 添加新的服务

1. 在 `src/main/services/` 创建服务文件
2. 导出单例实例
3. 在 `src/main/ipc/index.ts` 中导入并使用
4. 在 `src/main/main.ts` 中初始化 (如需要)

### 修改 UI 样式

- 使用 Tailwind CSS 工具类优先
- Ant Design 主题配置在 `src/renderer/App.tsx`
- 全局样式在 `src/renderer/index.css`
- 主题色: `#d33f2f` (主题红), `#c62829` (深度红)

## 相关文档

- **产品需求:** `Docs/产品需求文档.md` - 完整的功能规格和设计说明
- **UI 设计:** `Docs/界面效果图.md` - 界面设计规范
- **部署指南:** `Docs/DEPLOYMENT-GUIDE.md` - 生产环境部署
- **更新系统:** `USG Server Updates/Docs/client/README.md` - 自定义更新系统文档
- **版本管理:** `scripts/VERSION-UPDATE-README.md` - 版本更新流程

## 项目特点

1. **企业级安全:** 支持多种 SSH 认证方式，Windows 凭据管理器集成
2. **自动化运维:** IP 变化自动检测和规则更新，减少人工干预
3. **可扩展性:** 模块化设计，清晰的服务层和 IPC 接口
4. **跨平台:** 支持 Windows 和 macOS (主要面向 Windows)
5. **现代化 UI:** Fluent Design 风格，深色/浅色主题切换
6. **完整审计:** 所有操作记录日志，满足企业合规要求
7. **灰度发布:** 自定义更新系统支持灰度发布和统计数据收集
