# 🚀 USG NAT Manager 部署完整指南

## 📚 文档索引

这是 USG NAT Manager 更新系统的完整部署指南索引。

---

## 🎯 我该从哪里开始？

### 场景 1: 我是服务器管理员（首次配置）

**目标：** 在 Linux 服务器上配置更新服务

**阅读顺序：**
1. 📖 [docs/SERVER-QUICKSTART.md](docs/SERVER-QUICKSTART.md) - 5 分钟快速开始
2. 🔧 运行安装脚本 `bash docs/server-scripts/install.sh`
3. ✅ 验证安装 `update-health-check.sh`

**进阶阅读：**
- 📖 [docs/SERVER-SETUP.md](docs/SERVER-SETUP.md) - 完整配置文档

---

### 场景 2: 我是开发者（Windows 开发机）

**目标：** 从开发机部署应用更新到服务器

**阅读顺序：**
1. 📖 [scripts/COMMANDS.txt](scripts/COMMANDS.txt) - 快速命令参考
2. 🔑 配置 SSH 密钥 `scripts\setup-ssh-key.bat`
3. 🧪 测试系统 `scripts\test-deploy.bat`
4. 🚀 部署 `scripts\deploy-to-linux.bat`

**进阶阅读：**
- 📖 [scripts/DEPLOY-README.md](scripts/DEPLOY-README.md) - 详细部署说明
- 📖 [scripts/SSH-SETUP.md](scripts/SSH-SETUP.md) - SSH 配置指南

---

### 场景 3: 我遇到了问题

**问题类型：** 部署失败、连接错误、上传超时

**快速解决：**
1. 📖 [scripts/FIX-CONNECTION-ERROR.txt](scripts/FIX-CONNECTION-ERROR.txt)
2. 🔧 运行诊断：`scripts\test-deploy.bat`
3. 🔑 配置 SSH：`scripts\setup-ssh-key.bat`

**详细排查：**
- 📖 [docs/SERVER-SETUP.md - 故障排除](docs/SERVER-SETUP.md#故障排除)

---

## 📁 完整文档结构

```
项目根目录/
├── DEPLOYMENT-GUIDE.md            # 本文档 - 部署指南索引
│
├── docs/                          # 文档目录
│   ├── README.md                  # 文档中心
│   ├── SERVER-QUICKSTART.md       # 服务器快速开始 ⭐
│   ├── SERVER-SETUP.md            # 服务器完整配置 📖
│   └── server-scripts/            # 服务器脚本
│       ├── install.sh             # 一键安装
│       └── install-scripts.sh     # 维护脚本安装
│
└── scripts/                       # 客户端脚本
    ├── deploy-to-linux.bat        # 主部署脚本 ⭐
    ├── setup-ssh-key.bat          # SSH 密钥配置 🔑
    ├── test-deploy.bat            # 测试工具 🧪
    ├── generate-json.ps1          # JSON 生成
    ├── COMMANDS.txt               # 快速命令参考 ⚡
    ├── DEPLOY-README.md           # 部署详细说明 📖
    ├── SSH-SETUP.md               # SSH 配置指南 🔑
    └── FIX-CONNECTION-ERROR.txt   # 错误快速修复 🔧
```

**图例：**
- ⭐ 最常用
- 📖 详细文档
- 🔑 配置指南
- 🧪 测试工具
- ⚡ 快速参考
- 🔧 故障排除

---

## 🚀 快速开始（3 步）

### 第 1 步：服务器配置（Linux）

```bash
# SSH 登录服务器
ssh root@192.168.1.164

# 下载并运行安装脚本
cd /tmp
# 将 docs/server-scripts/install.sh 复制到服务器
bash install.sh

# 安装维护脚本
bash install-scripts.sh

# 验证安装
update-health-check.sh
```

**详细说明：** [docs/SERVER-QUICKSTART.md](docs/SERVER-QUICKSTART.md)

---

### 第 2 步：配置 SSH（Windows）

```bash
# 配置无密码登录（一次性）
scripts\setup-ssh-key.bat
```

**详细说明：** [scripts/SSH-SETUP.md](scripts/SSH-SETUP.md)

---

### 第 3 步：部署更新（Windows）

```bash
# 测试部署系统
scripts\test-deploy.bat

# 打包应用
npm run package:win

# 部署到服务器
scripts\deploy-to-linux.bat
```

**详细说明：** [scripts/DEPLOY-README.md](scripts/DEPLOY-README.md)

---

## 📋 常用操作速查

### 服务器端（Linux）

| 操作 | 命令 | 文档 |
|------|------|------|
| 健康检查 | `update-health-check.sh` | [SERVER-SETUP.md](docs/SERVER-SETUP.md) |
| 修复权限 | `fix-update-permissions.sh` | [SERVER-SETUP.md](docs/SERVER-SETUP.md) |
| 清理备份 | `cleanup-old-backups.sh` | [SERVER-SETUP.md](docs/SERVER-SETUP.md) |
| 重启服务 | `systemctl restart nginx` | - |
| 查看日志 | `tail -f /www/...logs/access.log` | [SERVER-SETUP.md](docs/SERVER-SETUP.md) |

### 客户端（Windows）

| 操作 | 命令 | 文档 |
|------|------|------|
| 配置 SSH | `scripts\setup-ssh-key.bat` | [SSH-SETUP.md](scripts/SSH-SETUP.md) |
| 测试系统 | `scripts\test-deploy.bat` | - |
| 打包应用 | `npm run package:win` | - |
| 部署更新 | `scripts\deploy-to-linux.bat` | [DEPLOY-README.md](scripts/DEPLOY-README.md) |
| 查看命令 | `type scripts\COMMANDS.txt` | [COMMANDS.txt](scripts/COMMANDS.txt) |

---

## 🎯 按角色分类

### 🔧 运维工程师

**必读文档：**
1. [docs/SERVER-SETUP.md](docs/SERVER-SETUP.md) - 服务器完整配置
2. [docs/SERVER-QUICKSTART.md](docs/SERVER-QUICKSTART.md) - 快速部署

**日常工作：**
- 监控服务器状态
- 管理日志和备份
- 处理故障告警

---

### 💻 开发工程师

**必读文档：**
1. [scripts/DEPLOY-README.md](scripts/DEPLOY-README.md) - 部署流程
2. [scripts/SSH-SETUP.md](scripts/SSH-SETUP.md) - SSH 配置
3. [scripts/COMMANDS.txt](scripts/COMMANDS.txt) - 快速参考

**日常工作：**
- 打包新版本
- 部署到服务器
- 测试更新功能

---

### 👨‍💼 项目管理

**必读文档：**
1. [docs/README.md](docs/README.md) - 文档中心总览
2. 本文档 - 部署指南索引

**关注重点：**
- 部署流程理解
- 文档完整性
- 团队协作流程

---

## 🆘 故障排除流程

### 步骤 1: 识别问题类型

| 症状 | 问题类型 | 解决文档 |
|------|----------|----------|
| 每次都要输入密码 | SSH 配置 | [SSH-SETUP.md](scripts/SSH-SETUP.md) |
| 连接超时/关闭 | 网络/SSH | [FIX-CONNECTION-ERROR.txt](scripts/FIX-CONNECTION-ERROR.txt) |
| 403 Forbidden | 权限 | [SERVER-SETUP.md](docs/SERVER-SETUP.md#权限设置) |
| 无法访问端口 | 防火墙 | [SERVER-SETUP.md](docs/SERVER-SETUP.md#防火墙配置) |
| 文件上传失败 | SSH/权限 | [FIX-CONNECTION-ERROR.txt](scripts/FIX-CONNECTION-ERROR.txt) |

### 步骤 2: 运行诊断

```bash
# 客户端诊断
scripts\test-deploy.bat

# 服务器诊断
ssh root@192.168.1.164 "update-health-check.sh"
```

### 步骤 3: 查看文档

根据问题类型查看对应文档的故障排除章节。

---

## 📊 系统流程图

```
┌──────────────────────────────────────────────────────────┐
│                    部署流程总览                            │
└──────────────────────────────────────────────────────────┘

1. 开发阶段（Windows）
   ├─ 编写代码
   ├─ 本地测试
   └─ 更新版本号 (package.json)

2. 打包阶段
   ├─ npm run package:win
   ├─ 生成 .exe 文件
   ├─ 计算 SHA256
   └─ 创建 build-info.json

3. 部署阶段
   ├─ scripts\deploy-to-linux.bat
   ├─ 生成 latest.json
   ├─ SSH 上传到服务器
   ├─ 备份旧版本
   └─ 设置权限

4. 服务器端（Linux）
   ├─ Nginx 提供文件服务
   ├─ 客户端检查更新
   ├─ 下载并验证 SHA256
   └─ 自动安装

5. 监控维护
   ├─ 查看访问日志
   ├─ 检查磁盘空间
   ├─ 清理旧备份
   └─ 定期健康检查
```

---

## ✅ 部署检查清单

### 服务器端

- [ ] Linux 服务器准备完成
- [ ] 运行 `install.sh` 成功
- [ ] 运行 `install-scripts.sh` 成功
- [ ] Nginx 运行正常 (`systemctl status nginx`)
- [ ] 端口 8123 可访问 (`netstat -tlnp | grep 8123`)
- [ ] 防火墙已配置
- [ ] 目录权限正确
- [ ] 健康检查通过 (`update-health-check.sh`)

### 客户端

- [ ] SSH 客户端已安装
- [ ] SSH 密钥已配置 (`scripts\setup-ssh-key.bat`)
- [ ] 测试脚本通过 (`scripts\test-deploy.bat`)
- [ ] 首次部署成功
- [ ] 浏览器可访问 `http://192.168.1.164:8123/updates/latest.json`
- [ ] 应用可检测到更新

---

## 📖 推荐阅读顺序

### 🟢 初学者（第 1 天）

1. [docs/README.md](docs/README.md) - 了解文档结构（10 分钟）
2. [scripts/COMMANDS.txt](scripts/COMMANDS.txt) - 快速命令参考（5 分钟）
3. [docs/SERVER-QUICKSTART.md](docs/SERVER-QUICKSTART.md) - 服务器快速部署（15 分钟）
4. 实践操作 - 部署第一个版本（30 分钟）

**总时间：** 约 1 小时

---

### 🟡 进阶用户（第 2-3 天）

1. [scripts/DEPLOY-README.md](scripts/DEPLOY-README.md) - 详细部署流程（20 分钟）
2. [scripts/SSH-SETUP.md](scripts/SSH-SETUP.md) - SSH 高级配置（20 分钟）
3. [docs/SERVER-SETUP.md](docs/SERVER-SETUP.md) - 服务器完整配置（40 分钟）
4. 实践操作 - 优化和自动化（2 小时）

**总时间：** 约 3 小时

---

### 🔴 专家级（持续学习）

1. 完整阅读所有文档
2. 自定义监控脚本
3. 配置 SSL 证书
4. 性能优化和安全加固
5. 编写团队文档

**总时间：** 根据需求

---

## 🎓 培训材料

### 新员工入职培训

**第 1 周：基础知识**
- Linux 基础命令
- SSH 基础
- Nginx 基础

**第 2 周：实战操作**
- 部署服务器配置
- 客户端部署流程
- 故障排除练习

**第 3 周：独立操作**
- 独立完成部署
- 处理实际问题
- 编写操作文档

---

## 📞 技术支持

### 问题分类

| 类型 | 联系方式 | 响应时间 |
|------|----------|----------|
| 紧急问题 | 查看故障排除文档 | 立即 |
| 一般咨询 | 阅读相关文档 | - |
| 功能建议 | 提交到项目管理系统 | - |

### 自助资源

- 📖 完整文档：`docs/` 目录
- 🔧 故障排除：各文档的故障排除章节
- ⚡ 快速参考：`scripts/COMMANDS.txt`
- 🧪 测试工具：`scripts/test-deploy.bat`

---

## 🔄 持续改进

### 文档更新

- 定期审查文档准确性
- 收集用户反馈
- 补充常见问题
- 更新最佳实践

### 流程优化

- 简化部署步骤
- 增加自动化
- 提升用户体验
- 加强监控告警

---

## 🎉 开始你的部署之旅！

选择你的角色，开始阅读相应的文档：

**🖥️ 服务器管理员：**
```bash
# 5 分钟快速开始
docs/SERVER-QUICKSTART.md
```

**💻 开发工程师：**
```bash
# 快速命令参考
scripts/COMMANDS.txt

# 详细部署说明
scripts/DEPLOY-README.md
```

**🔧 运维工程师：**
```bash
# 完整配置文档
docs/SERVER-SETUP.md
```

---

**祝你部署顺利！** 🚀

如有问题，请参考相应文档或运行诊断工具。

---

**版本：** 1.0.0  
**最后更新：** 2025-11-03  
**维护者：** Development Team

