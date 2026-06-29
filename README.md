# 华为USG防火墙NAT管理软件

<div align="center">

![Version](https://img.shields.io/badge/version-1.0.6-blue.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS-lightgrey.svg)
![Node](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)

一款跨平台的企业级自动化管理工具，用于管理华为USG系列防火墙的NAT Server规则。支持 Windows 和 macOS 系统。

[功能特性](#功能特性) •
[快速开始](#快速开始) •
[使用指南](#使用指南) •
[开发文档](#开发文档) •
[常见问题](#常见问题)

</div>

---

## 📸 软件截图

<div align="center">

演示稿入口：[`docs/mockups/demo.html`](./docs/mockups/demo.html)

</div>

---

## 📖 项目简介

USG NAT Manager 是一款基于 Electron + React 开发的现代化桌面应用，旨在解决动态公网IP环境下，频繁手动更新防火墙NAT规则的痛点。通过自动化监控和智能更新机制，大幅提升运维效率。

### 适用场景

- 🏢 **企业网络环境** - 管理多台USG防火墙设备的NAT规则
- 🏠 **家庭办公** - 动态公网IP下的端口映射自动更新
- 🔧 **运维自动化** - 减少人工干预，降低配置错误
- 📊 **集中管理** - 统一管理多设备、多规则

## ✨ 功能特性

### 核心功能

- 🚀 **自动化IP监控**
  - 实时检测公网IP变化（支持多源验证）
  - 可配置检测间隔（1-60分钟）
  - 智能重试机制，网络故障自动恢复

- 🔄 **智能规则更新**
  - IP变化时自动批量更新NAT规则
  - 支持选择性更新指定设备
  - 事务性更新，确保一致性
  - 备份机制，支持快速回滚

- 🔐 **企业级安全**
  - 支持密码认证
  - 支持SSH私钥认证
  - 支持证书认证
  - 支持多因子认证（MFA）
  - Windows凭据管理器集成

- 📊 **可视化管理界面**
  - 现代化Fluent Design风格
  - 实时状态监控面板
  - 设备在线状态显示
  - 规则列表管理
  - 日志查询和导出

- 🔔 **多渠道通知**
  - Windows系统通知
  - 邮件通知（SMTP）
  - 微信通知（企业微信/Server酱）
  - 自定义通知规则

- 📝 **完整日志系统**
  - 操作日志记录
  - 错误日志追踪
  - 日志级别分类（info/warn/error）
  - 支持日志导出和检索

- ⚙️ **系统集成**
  - 支持作为Windows服务运行
  - 系统托盘常驻
  - 开机自启动
  - 最小化到托盘

### 设备管理

- ✅ 添加/编辑/删除设备
- ✅ 批量导入设备配置
- ✅ 设备连接测试
- ✅ 在线状态监控
- ✅ 设备分组管理

### 规则管理

- ✅ 从设备同步NAT规则
- ✅ 批量修改规则
- ✅ 规则搜索和筛选
- ✅ 规则导出（CSV/JSON）
- ✅ 规则优先级调整

### 自动化配置

- ✅ IP变化触发策略（立即/延迟/定时）
- ✅ 更新频率控制
- ✅ 设备选择性更新
- ✅ 通知策略配置

## 🛠️ 技术栈

### 前端技术

- **框架**: React 18.2 + TypeScript 5.3
- **UI组件**: Ant Design 5.12
- **样式**: Tailwind CSS 3.4
- **状态管理**: Zustand
- **数据请求**: TanStack Query (React Query)
- **路由**: React Router 6
- **图标**: Ant Design Icons

### 桌面框架

- **核心**: Electron 28.1
- **构建**: electron-builder 24.9
- **IPC通信**: 类型安全的IPC API

### 后端技术

- **运行时**: Node.js 18+
- **SSH客户端**: ssh2
- **HTTP客户端**: Axios
- **日志**: Winston
- **数据库ORM**: Prisma 5.8

### 数据库

- **类型**: SQLite 3
- **管理**: Prisma Studio

### 开发工具

- **构建工具**: Vite 5.0
- **代码规范**: ESLint + Prettier
- **类型检查**: TypeScript
- **包管理**: npm

## 📋 系统要求

### 最低要求

- **操作系统**: Windows 10 (64位) 或更高版本
- **内存**: 2GB RAM
- **磁盘空间**: 500MB
- **Node.js**: 18.0.0 或更高版本（开发环境）

### 推荐配置

- **操作系统**: Windows 11 (64位)
- **内存**: 4GB RAM 或更高
- **磁盘空间**: 1GB
- **网络**: 稳定的网络连接

## 🚀 快速开始

### 用户安装

1. **下载安装包**

   ```
   下载最新版本的安装包: USG-NAT-Manager-Setup-1.0.2.exe
   ```

2. **运行安装程序**
   - 双击运行安装包
   - 选择安装路径
   - 完成安装

3. **启动应用**
   - 从开始菜单启动应用
   - 或从桌面快捷方式启动

### 开发环境搭建

#### 1. 克隆项目

```bash
git clone https://github.com/chengchnegcheng/UsgNat-manager.git
cd UsgNat-manager
```

#### 2. 安装依赖

7

```bash
npm install
```

#### 3. 初始化数据库

```bash
npx prisma generate
npx prisma db push
```

#### 4. 启动开发模式

```bash
npm run dev
```

应用将在开发模式下启动，支持热重载。

#### 5. 构建生产版本

```bash
# 构建主进程和渲染进程
npm run build

# 打包 Windows 安装程序
npm run package:win

# 打包 macOS 安装程序（需在 macOS 系统上执行）
npm run package:mac

# 通用打包（自动检测当前系统）
npm run package
```

**打包说明：**

- **Windows**: 生成 NSIS 安装包和 Portable 便携版
- **macOS**: 生成 DMG 安装包和 ZIP 压缩包，支持 Intel 和 Apple Silicon
- macOS 签名相关配置位于 `package.json` 的 `build.mac` 和 `resources/build/entitlements.mac.plist`

## 📘 使用指南

### 第一次使用

#### 1. 添加设备

1. 点击左侧菜单的"设备管理"
2. 点击"添加设备"按钮
3. 填写设备信息：
   - 设备名称：如 "USG6000-01"
   - IP地址：防火墙管理IP
   - 端口：SSH端口（默认22）
   - 用户名和密码
4. 点击"测试连接"验证配置
5. 保存设备

#### 2. 同步规则

1. 在设备列表中找到已添加的设备
2. 确保设备状态为"在线"
3. 点击设备行的"同步规则"按钮
4. 等待同步完成

#### 3. 启动监控

1. 进入"主控制台"页面
2. 点击"启动监控"按钮
3. 系统开始监控公网IP变化

#### 4. 配置自动化

1. 进入"自动化配置"页面
2. 启用"自动更新"开关
3. 配置触发策略：
   - 立即更新：IP变化后立即更新
   - 延迟更新：等待N分钟后更新
   - 定时更新：在指定时间更新
4. 选择要自动更新的设备
5. 保存配置

### 日常使用

#### 查看系统状态

- **主控制台**: 查看当前IP、在线设备数、规则总数
- **最近事件**: 查看最近的系统活动
- **设备状态**: 查看设备在线/离线状态

#### 手动更新规则

1. 进入"规则管理"页面
2. 搜索或筛选需要更新的规则
3. 选择规则后点击"批量更新IP"
4. 输入新的公网IP
5. 确认更新

#### 查看日志

1. 进入"日志监控"页面
2. 使用筛选器查询日志：
   - 按时间范围
   - 按日志级别
   - 按关键词
3. 点击"导出日志"可导出CSV文件

## 🔧 开发文档

### 项目结构

```
USG1.0.7/
├── src/
│   ├── main/                   # Electron 主进程
│   │   ├── ipc/
│   │   │   ├── index.ts        # IPC 注册入口
│   │   │   └── handlers/       # 分领域 handler
│   │   └── services/           # 自动化、更新、配置等服务
│   └── renderer/               # React 渲染进程
│       ├── pages/
│       │   ├── Automation/
│       │   │   └── components/
│       │   ├── Devices/
│       │   │   └── components/
│       │   └── Settings/
│       │       └── components/
│       ├── components/         # 通用组件
│       ├── types/              # 分领域类型导出
│       └── utils/              # 渲染进程工具函数
├── prisma/                     # Prisma schema 与数据库
├── resources/
│   ├── build/
│   │   └── entitlements.mac.plist
│   └── icons/
├── scripts/
│   ├── assets/                 # 图标/资源处理脚本
│   ├── dev/                    # 开发辅助脚本
│   ├── release/                # 版本与发布脚本
│   └── setup/
│       └── github/             # GitHub 初始化脚本
├── docs/
│   ├── guides/                 # 使用与发布指南
│   ├── mockups/                # 演示稿与界面原型
│   ├── archive/                # 历史方案与归档资料
│   └── superpowers/            # 整理 spec / plan
├── .vscode/
│   └── settings.json           # 工作区视图收口
├── package.json                # 工程入口与构建脚本
├── tsconfig*.json              # TypeScript 配置组
├── vite.config.mts             # Vite 配置
└── README.md
```

根目录保留 `package.json`、`vite.config.mts`、`tsconfig*.json`、`index.html` 这类工具入口是有意的；工作区已通过 `.vscode/settings.json` 把关联配置折叠显示，避免 Explorer 继续散成一片。

### 核心模块说明

#### IP监控服务 (ip-monitor.ts)

负责定时检测公网IP变化：

- 支持多个IP检测源（ipify、ip-api等）
- 多数投票机制确保准确性
- 自动重试和错误恢复
- IP变化事件发布

#### SSH管理器 (ssh-manager.ts)

管理与防火墙的SSH连接：

- SSH连接池管理
- 支持多种认证方式
- 命令执行和输出解析
- 连接状态监控

#### USG解析器 (usg-parser.ts)

解析华为USG防火墙配置：

- NAT规则提取和解析
- 配置命令生成
- 规则对比和差异检测

#### 自动化服务 (automation-service.ts)

协调自动化流程：

- 监听IP变化事件
- 触发规则更新
- 管理更新策略
- 发送通知

### 数据库模型

```prisma
model Device {
  id              String   @id @default(uuid())
  name            String
  host            String
  port            Int      @default(22)
  connectionType  String   @default("SSH")
  enabled         Boolean  @default(true)
  online          Boolean  @default(false)
  lastConnected   DateTime?
  description     String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  rules           Rule[]
}

model Rule {
  id              String   @id @default(uuid())
  deviceId        String
  protocol        String
  globalInterface String
  globalIP        String
  globalStartPort Int
  globalEndPort   Int
  insideIP        String
  insidePort      Int
  description     String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  device          Device   @relation(fields: [deviceId], references: [id], onDelete: Cascade)
}

model Log {
  id          String   @id @default(uuid())
  level       String
  operation   String?
  message     String
  timestamp   DateTime @default(now())
}

model Config {
  id    String @id @default(uuid())
  key   String @unique
  value String
}
```

### API文档

IPC ???? `src/main/ipc/`??????? API ???? `src/main/preload.ts`?

### 开发命令

```bash
# 安装依赖
npm install

# 开发模式（主进程 + 渲染进程）
npm run dev

# 仅开发主进程
npm run dev:electron

# 仅开发渲染进程
npm run dev:vite

# 构建主进程
npm run build:main

# 构建渲染进程
npm run build:renderer

# 完整构建
npm run build

# 打包Windows安装程序
npm run package:win

# 数据库迁移
npx prisma migrate dev

# 查看数据库
npx prisma studio

# 代码检查
npm run lint

# 运行源码测试
npm test

# 仅运行 src 下测试
npm run test:src

# 格式化代码
npm run format
```

## ❓ 常见问题

### 1. 连接设备失败

**问题**: 提示"连接测试失败: 未配置凭据"

**解决**:

- 确保已保存设备凭据
- 检查用户名和密码是否正确
- 验证防火墙SSH服务是否开启

### 2. IP检测失败

**问题**: 提示"所有IP检测源都失败"

**解决**:

- 检查网络连接
- 确认可以访问外网
- 查看防火墙是否拦截

### 3. 规则同步失败

**问题**: 同步规则时出错

**解决**:

- 确认设备在线
- 检查SSH连接是否正常
- 验证用户权限是否足够

### 4. 自动更新不生效

**问题**: IP变化后没有自动更新规则

**解决**:

- 检查是否启动了监控
- 确认自动化配置已启用
- 查看日志了解详细错误

### 5. 应用无法启动

**问题**: 双击无反应或闪退

**解决**:

- 查看 `%APPDATA%\usg-nat-manager\logs` 日志
- 确认系统满足最低要求
- 尝试以管理员身份运行

## 🤝 贡献指南

欢迎贡献代码、报告问题或提出建议！

### 贡献流程

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 提交Pull Request

### 代码规范

- 使用TypeScript
- 遵循ESLint规则
- 使用Prettier格式化
- 编写清晰的注释
- 提交前运行测试

## 📝 更新日志

### v1.0.2 (2025-10-22)

**新增功能**

- ✅ 完整的设备管理功能
- ✅ NAT规则同步和管理
- ✅ IP自动监控和更新
- ✅ 多渠道通知系统
- ✅ 完整的日志系统
- ✅ 自动化配置

**优化改进**

- ✅ IP检测添加重试机制
- ✅ 测试连接后自动刷新状态
- ✅ 添加设备后自动测试连接
- ✅ 修复执行顺序问题
- ✅ Dashboard最近事件显示真实日志

**问题修复**

- ✅ 修复测试连接loading状态BUG
- ✅ 修复凭据保存顺序问题
- ✅ 修复SSH错误处理
- ✅ 统一日志记录

## 📄 许可证

本项目采用 MIT 许可证 - 详见 [LICENSE](LICENSE) 文件

## 📧 联系方式

- **问题反馈**: [GitHub Issues](https://github.com/chengchnegcheng/UsgNat-manager/issues)
- **功能建议**: [GitHub Discussions](https://github.com/chengchnegcheng/UsgNat-manager/discussions)

## 🙏 致谢

感谢以下开源项目：

- [Electron](https://www.electronjs.org/)
- [React](https://react.dev/)
- [Ant Design](https://ant.design/)
- [Prisma](https://www.prisma.io/)
- [ssh2](https://github.com/mscdex/ssh2)

---

<div align="center">

**[⬆ 回到顶部](#华为usg防火墙nat管理软件)**

Made with ❤️ by USG NAT Manager Team

</div>
