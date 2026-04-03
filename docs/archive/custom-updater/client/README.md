# USG NAT Manager - 客户端更新文档

**版本:** 2.0  
**日期:** 2025-11-05  
**状态:** 基于完整 Web 管理后台系统

---

## 📚 文档导航

### 🎯 快速开始

| 文档 | 用途 | 适合人员 |
|------|------|---------|
| [QUICK_REFERENCE.md](./QUICK_REFERENCE.md) | 1分钟了解所有改动 | 所有开发者 ⭐ |
| [MIGRATION_GUIDE.md](./MIGRATION_GUIDE.md) | 详细迁移步骤 | 实施开发者 ⭐ |

### 📖 详细文档

| 文档 | 用途 | 适合人员 |
|------|------|---------|
| [CLIENT_UPDATE_WITH_API.md](./CLIENT_UPDATE_WITH_API.md) | API 集成方案详解 | 架构师、开发者 |
| [custom-updater-api-version.ts](./custom-updater-api-version.ts) | 完整代码实现 | 开发者 |

---

## 🚀 推荐阅读顺序

### 方案 A：快速上手（30 分钟）

```
1. QUICK_REFERENCE.md         (5 分钟)  ← 了解核心改动
   ↓
2. custom-updater-api-version.ts (15 分钟) ← 查看完整代码
   ↓
3. 本地测试 API                (10 分钟) ← 验证理解
```

**适合：** 有经验的开发者，想快速实施改造。

### 方案 B：深入理解（2 小时）

```
1. CLIENT_UPDATE_WITH_API.md   (30 分钟) ← 理解设计思路
   ↓
2. MIGRATION_GUIDE.md          (40 分钟) ← 学习详细步骤
   ↓
3. custom-updater-api-version.ts (30 分钟) ← 研究代码实现
   ↓
4. QUICK_REFERENCE.md          (20 分钟) ← 查漏补缺
```

**适合：** 新手开发者，或需要全面了解的技术负责人。

---

## 📝 文档概览

### 1. QUICK_REFERENCE.md - 快速参考 ⭐

**核心内容：**
- 一分钟了解核心改动
- 代码改动速查表
- API 接口速查
- 5 步快速迁移
- 测试速查
- 常见问题

**何时使用：**
- ✅ 需要快速查找具体改动点
- ✅ 忘记某个 API 接口格式
- ✅ 遇到常见问题需要快速解答
- ✅ 第一次了解项目改动

**推荐指数：** ⭐⭐⭐⭐⭐

---

### 2. MIGRATION_GUIDE.md - 迁移指南 ⭐

**核心内容：**
- 旧方案 vs 新方案详细对比
- 逐行代码差异展示
- 5 个阶段的迁移步骤
- 完整的测试方案
- 部署检查清单
- 注意事项和收益分析

**何时使用：**
- ✅ 准备实施代码改造
- ✅ 需要了解为什么要改
- ✅ 想看新旧代码的具体差异
- ✅ 需要制定迁移计划

**推荐指数：** ⭐⭐⭐⭐⭐

---

### 3. CLIENT_UPDATE_WITH_API.md - API 方案详解

**核心内容：**
- 方案对比（静态文件 vs API）
- 客户端改造详细方案
- API 接口规范
- UI 更新指南
- 统计数据上报实现
- 完整更新流程图
- 迁移步骤
- 安全考虑
- 收益分析

**何时使用：**
- ✅ 需要理解整体设计思路
- ✅ 想了解为什么这样设计
- ✅ 需要向团队讲解方案
- ✅ 准备进行技术评审

**推荐指数：** ⭐⭐⭐⭐

---

### 4. custom-updater-api-version.ts - 完整代码

**核心内容：**
- 完整的 TypeScript 实现
- 所有必需方法
- 详细的代码注释
- 错误处理逻辑
- 可直接使用的代码

**何时使用：**
- ✅ 需要参考具体实现
- ✅ 想直接复制粘贴代码
- ✅ 需要了解实现细节
- ✅ 遇到具体技术问题

**推荐指数：** ⭐⭐⭐⭐

---

## 🎯 核心改动速览

### 从静态文件到 API

```diff
- GET /updates/latest.json
+ POST /api/v1/updates/check
```

### 新增功能

| 功能 | 说明 | 收益 |
|------|------|------|
| 🎲 **灰度发布** | 服务器控制谁能看到新版本 | 降低风险，平滑发布 |
| 📊 **统计上报** | 自动收集下载/安装数据 | 数据驱动，优化体验 |
| 🔒 **强制更新** | 支持必须更新的版本 | 确保安全，修复漏洞 |
| 🔀 **渠道控制** | stable/beta/alpha 分离 | 多环境管理 |
| 🆔 **用户标识** | 匿名设备 ID（SHA256） | 问题追踪，精准控制 |

---

## 🔧 快速实施

### 前提条件

**服务器端：**
- ✅ FastAPI 后端已部署
- ✅ PostgreSQL 数据库已配置
- ✅ Nginx 反向代理已配置
- ✅ API 接口已测试通过

**客户端：**
- ✅ Node.js 环境
- ✅ TypeScript 编译器
- ✅ Electron 项目结构

### 5 分钟快速改造

```bash
# 1. 备份
cd src/main/services
copy custom-updater.ts custom-updater.ts.backup

# 2. 修改服务器地址
# updateServerUrls 移除 /updates 后缀

# 3. 替换 fetchFromServer 方法
# 复制 custom-updater-api-version.ts 中的实现

# 4. 添加辅助方法
# getUserId, reportDownloadStats, reportInstallStats, sendStats

# 5. 更新 UI
# UpdateDialog.tsx 添加 rollout-blocked case

# 6. 测试
npm run dev
```

---

## 🧪 测试指南

### 启动本地测试服务器

```python
# test_api.py
from fastapi import FastAPI

app = FastAPI()

@app.post("/api/v1/updates/check")
async def check_updates(req: dict):
    return {
        "success": True,
        "data": {
            "has_update": True,
            "latest_version": "1.0.8",
            "release_date": "2025-11-10",
            "download_url": "/updates/v1.0.8/USG-NAT-Manager-Setup-1.0.8.exe",
            "file_hash": "test_hash_123",
            "file_size": 104857600,
            "is_mandatory": False,
            "rollout_blocked": False,  # ← 改为 True 测试灰度
            "rollout_percentage": 100,
            "changelog": []
        }
    }

@app.post("/api/v1/updates/stats/{stat_type}")
async def report_stats(stat_type: str, data: dict):
    print(f"{stat_type} 统计: {data}")
    return {"success": True}
```

**运行：**
```bash
pip install fastapi uvicorn
uvicorn test_api:app --host 0.0.0.0 --port 8123
```

### 测试场景

```
✅ 场景1：正常更新
   rollout_blocked: false
   → 应显示更新对话框 + 下载按钮

✅ 场景2：灰度阻止
   rollout_blocked: true
   → 应显示"新版本发布中" + 无下载按钮

✅ 场景3：无更新
   has_update: false
   → 应显示"已是最新版本"

✅ 场景4：统计上报
   → 观察服务器日志，应看到统计数据
```

---

## 📡 API 接口速查

### 检查更新

```http
POST /api/v1/updates/check
Content-Type: application/json

{
  "current_version": "1.0.7",
  "platform": "win32",
  "arch": "x64",
  "user_id": "abc123...",
  "channel": "stable"
}
```

### 下载统计

```http
POST /api/v1/updates/stats/download
Content-Type: application/json

{
  "user_id": "abc123...",
  "version": "1.0.8",
  "from_version": "1.0.7",
  "platform": "win32",
  "arch": "x64",
  "status": "started"
}
```

### 安装统计

```http
POST /api/v1/updates/stats/install
Content-Type: application/json

{
  "user_id": "abc123...",
  "from_version": "1.0.7",
  "to_version": "1.0.8",
  "platform": "win32",
  "arch": "x64",
  "status": "started"
}
```

---

## 🔍 常见问题

### Q: 旧版本客户端还能用吗？

**A:** 能。保留 `latest.json` 静态文件即可向后兼容。

### Q: 统计上报失败会影响更新吗？

**A:** 不会。所有统计上报都包裹在 `try-catch` 中，失败不影响主流程。

### Q: 用户ID 会暴露隐私吗？

**A:** 不会。使用 SHA256 哈希，只保存哈希值不保存原始信息。

### Q: 如何测试灰度功能？

**A:** 修改测试 API 的 `rollout_blocked` 字段为 `true`。

### Q: API 超时时间多少合适？

**A:** 
- 检查更新 API: 10秒
- 统计上报 API: 5秒（不重要）

更多问题请参考：[QUICK_REFERENCE.md](./QUICK_REFERENCE.md)

---

## 📦 相关服务器端文档

| 文档 | 路径 | 说明 |
|------|------|------|
| 管理后台方案 | `../ADMIN_SYSTEM_SUMMARY.md` | 服务器端架构设计 |
| 部署指南 | `../ADMIN_SYSTEM_GUIDE.md` | 服务器部署步骤 |
| 更新系统设计 | `../CUSTOM_UPDATE_SYSTEM_DESIGN.md` | 整体系统设计 |
| 实施总结 | `../UPDATE_IMPLEMENTATION_SUMMARY.md` | 客户端实施总结 |

---

## 📞 技术支持

### 问题反馈

- **项目路径:** `C:\Users\crystal\Desktop\USG1.0.2`
- **文档路径:** `USG Server Updates\Docs\client\`
- **代码路径:** `src\main\services\custom-updater.ts`

### 更新记录

| 日期 | 版本 | 说明 |
|------|------|------|
| 2025-11-05 | 2.0 | 完整 API 方案文档 |
| 2025-11-04 | 1.0 | 初始静态文件方案 |

---

## ✅ 实施检查清单

### 代码改造

- [ ] 备份原有代码
- [ ] 修改服务器地址（移除 /updates）
- [ ] 替换 `fetchFromServer` 方法
- [ ] 添加 `getUserId` 方法
- [ ] 添加统计上报方法
- [ ] 处理灰度阻止逻辑
- [ ] 更新 UI 组件（UpdateDialog）

### 测试验证

- [ ] 本地测试 API - 正常更新
- [ ] 本地测试 API - 灰度阻止
- [ ] 本地测试 API - 无更新
- [ ] 本地测试 API - 统计上报
- [ ] 生产环境联调

### 部署发布

- [ ] 服务器端 API 已部署
- [ ] 数据库已配置
- [ ] 客户端已构建
- [ ] 新版本已上传
- [ ] 灰度发布已配置
- [ ] 监控已启用

---

## 🎓 学习路径

### 初学者

```
1. 阅读 QUICK_REFERENCE.md（了解改动）
   ↓
2. 运行测试 API（实践验证）
   ↓
3. 阅读 MIGRATION_GUIDE.md（深入理解）
   ↓
4. 参考代码实施改造
```

### 有经验开发者

```
1. 快速浏览 QUICK_REFERENCE.md
   ↓
2. 直接查看 custom-updater-api-version.ts
   ↓
3. 实施改造
   ↓
4. 参考 MIGRATION_GUIDE.md 解决问题
```

### 技术负责人

```
1. 阅读 CLIENT_UPDATE_WITH_API.md（理解设计）
   ↓
2. 评审代码实现
   ↓
3. 制定迁移计划
   ↓
4. 监督实施和测试
```

---

## 🌟 推荐学习顺序

### 第一天：了解方案（1-2 小时）

- ✅ 阅读本 README
- ✅ 阅读 QUICK_REFERENCE.md
- ✅ 浏览 custom-updater-api-version.ts

### 第二天：实践验证（2-3 小时）

- ✅ 搭建测试 API 环境
- ✅ 测试所有场景
- ✅ 理解数据流向

### 第三天：实施改造（4-6 小时）

- ✅ 备份代码
- ✅ 实施修改
- ✅ 本地测试
- ✅ 修复问题

### 第四天：部署验证（2-3 小时）

- ✅ 连接生产 API
- ✅ 集成测试
- ✅ 发布新版本
- ✅ 监控数据

---

**文档版本:** v2.0  
**最后更新:** 2025-11-05  
**维护者:** USG 开发团队  
**项目:** USG NAT Manager

