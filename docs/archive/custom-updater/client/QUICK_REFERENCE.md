# 客户端更新 API 方案 - 快速参考

**版本:** 1.0  
**日期:** 2025-11-05

---

## 🎯 一分钟了解改动

### 核心变化

```typescript
// 旧方案：GET 静态文件
GET http://shcrystal.top:8123/updates/latest.json

// 新方案：POST API 调用
POST http://shcrystal.top:8123/api/v1/updates/check
{
  "current_version": "1.0.7",
  "user_id": "abc123...",
  "platform": "win32",
  "arch": "x64",
  "channel": "stable"
}
```

### 新增功能

- ✅ **灰度发布** - 服务器控制谁能看到新版本
- ✅ **统计上报** - 自动收集下载/安装数据
- ✅ **强制更新** - 支持必须更新的版本
- ✅ **渠道控制** - stable/beta/alpha 分离

---

## 📝 代码改动速查

### 1. 服务器地址

```typescript
// 旧
private updateServerUrls = [
  'http://shcrystal.top:8123/updates',  // ❌ 删除 /updates
];

// 新
private updateServerUrls = [
  'http://shcrystal.top:8123',          // ✅ API 根路径
];
```

### 2. 请求方法

```typescript
// 旧 - GET 请求
method: 'GET',
path: '/updates/latest.json'

// 新 - POST 请求
method: 'POST',
path: '/api/v1/updates/check',
headers: {
  'Content-Type': 'application/json',
},
body: JSON.stringify({
  current_version: "1.0.7",
  platform: "win32",
  arch: "x64",
  user_id: await this.getUserId(),
  channel: "stable"
})
```

### 3. 响应处理

```typescript
// 旧 - 直接解析
const versionInfo = JSON.parse(data);

// 新 - 检查 success 字段
const jsonData = JSON.parse(data);
if (!jsonData.success || !jsonData.data) {
  throw new Error('响应格式错误');
}

// 转换字段名
const versionInfo = {
  version: jsonData.data.latest_version,      // ← 字段名变化
  sha256: jsonData.data.file_hash,            // ← 字段名变化
  rolloutBlocked: jsonData.data.rollout_blocked,  // ← 新增
};
```

### 4. 灰度检查

```typescript
// 新增逻辑
if (versionInfo.rolloutBlocked) {
  this.sendMessage('show-update-dialog', {
    type: 'rollout-blocked',  // ← 新的对话框类型
    version: latestVersion,
    currentVersion,
  });
  
  return {
    success: true,
    message: '新版本发布中，您的设备暂未进入更新名单',
    hasUpdate: true,  // 有更新但不让下载
  };
}
```

### 5. 统计上报

```typescript
// 新增方法
private async reportDownloadStats(status: string, error?: string) {
  const data = {
    user_id: await this.getUserId(),
    version: this.latestVersionInfo.version,
    from_version: this.getCurrentVersion(),
    platform: process.platform,
    arch: process.arch,
    status,  // started/completed/failed
    error_message: error || null,
  };
  
  await this.sendStats(
    `${serverUrl}/api/v1/updates/stats/download`,
    data
  );
}

// 调用位置
async downloadUpdate() {
  await this.reportDownloadStats('started');     // ← 开始时
  try {
    await this.downloadUpdateWithRetry();
    await this.reportDownloadStats('completed'); // ← 成功时
  } catch (error) {
    await this.reportDownloadStats('failed', error.message); // ← 失败时
    throw error;
  }
}
```

### 6. 用户ID 生成

```typescript
// 新增方法
private async getUserId(): Promise<string> {
  if (this.userId) return this.userId;
  
  const hostname = os.hostname();
  const macAddress = this.getMacAddress();
  
  const identifier = `${hostname}-${macAddress}`;
  const hash = crypto.createHash('sha256')
    .update(identifier)
    .digest('hex');
  
  this.userId = hash.substring(0, 32);
  return this.userId;
}
```

---

## 🎨 UI 改动速查

### UpdateDialog.tsx 新增

```typescript
case 'rollout-blocked':
  modal.info({
    title: '新版本发布中',
    content: (
      <div style={{
        padding: 16,
        background: '#fffbe6',
        border: '1px solid #ffe58f',
      }}>
        <Text strong>版本 v{data.version} 正在灰度发布中</Text>
        <br />
        <Text type="secondary">
          您的设备暂未进入本次更新名单，请耐心等待。
        </Text>
      </div>
    ),
  });
  break;
```

---

## 🔌 API 接口速查

### 1. 检查更新

```
POST /api/v1/updates/check
```

**请求：**
```json
{
  "current_version": "1.0.7",
  "platform": "win32",
  "arch": "x64",
  "user_id": "abc123...",
  "channel": "stable"
}
```

**响应（有更新）：**
```json
{
  "success": true,
  "data": {
    "has_update": true,
    "latest_version": "1.0.8",
    "release_date": "2025-11-10",
    "download_url": "/updates/v1.0.8/*.exe",
    "file_hash": "sha256...",
    "file_size": 104857600,
    "is_mandatory": false,
    "rollout_blocked": false,
    "rollout_percentage": 100,
    "changelog": [...]
  }
}
```

**响应（灰度阻止）：**
```json
{
  "success": true,
  "data": {
    "has_update": true,
    "latest_version": "1.0.8",
    "rollout_blocked": true,   // ← 关键字段
    "rollout_percentage": 10
  }
}
```

**响应（无更新）：**
```json
{
  "success": true,
  "data": {
    "has_update": false
  }
}
```

### 2. 下载统计

```
POST /api/v1/updates/stats/download
```

**请求：**
```json
{
  "user_id": "abc123...",
  "version": "1.0.8",
  "from_version": "1.0.7",
  "platform": "win32",
  "arch": "x64",
  "status": "started",  // started/completed/failed
  "error_message": null
}
```

**响应：**
```json
{
  "success": true
}
```

### 3. 安装统计

```
POST /api/v1/updates/stats/install
```

**请求：**
```json
{
  "user_id": "abc123...",
  "from_version": "1.0.7",
  "to_version": "1.0.8",
  "platform": "win32",
  "arch": "x64",
  "status": "started",  // started/completed/failed
  "error_message": null
}
```

**响应：**
```json
{
  "success": true
}
```

---

## ⚡ 快速迁移（5 步）

### 步骤 1：备份

```bash
copy custom-updater.ts custom-updater.ts.backup
```

### 步骤 2：修改服务器地址

```typescript
private updateServerUrls = [
  'http://shcrystal.top:8123',  // 移除 /updates
];
```

### 步骤 3：替换 fetchFromServer

复制 `custom-updater-api-version.ts` 中的 `fetchFromServer` 方法。

### 步骤 4：添加辅助方法

```typescript
// 必需
private async getUserId(): Promise<string>
private async reportDownloadStats(status, error?)
private async reportInstallStats(status, error?)
private sendStats(url, data): Promise<void>
```

### 步骤 5：更新 UI

在 `UpdateDialog.tsx` 添加 `rollout-blocked` case。

---

## 🧪 测试速查

### 本地测试 API

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
            "download_url": "/updates/v1.0.8/*.exe",
            "file_hash": "test_hash",
            "file_size": 104857600,
            "is_mandatory": False,
            "rollout_blocked": False,  # ← 改为 True 测试灰度
            "rollout_percentage": 100,
            "changelog": []
        }
    }

@app.post("/api/v1/updates/stats/download")
async def download_stats(data: dict):
    print(f"下载统计: {data}")
    return {"success": True}

@app.post("/api/v1/updates/stats/install")
async def install_stats(data: dict):
    print(f"安装统计: {data}")
    return {"success": True}

# 运行
# uvicorn test_api:app --host 0.0.0.0 --port 8123
```

### 测试场景

```typescript
// 1. 正常更新
rollout_blocked: false
→ 显示更新对话框 + 下载按钮

// 2. 灰度阻止
rollout_blocked: true
→ 显示"新版本发布中" + 无下载按钮

// 3. 无更新
has_update: false
→ 显示"已是最新版本"

// 4. 统计上报
→ 观察服务器日志输出
```

---

## 🔍 常见问题

### Q1: 旧版本客户端还能用吗？

**A:** 能。保留 `latest.json` 静态文件即可。

```nginx
# Nginx 配置
location /updates/latest.json {
    alias /var/www/usg-updates/latest.json;
}
```

### Q2: 统计上报失败会影响更新吗？

**A:** 不会。所有统计上报都包裹在 `try-catch` 中。

```typescript
try {
  await this.reportDownloadStats('started');
} catch (error) {
  // 静默失败，不影响主流程
  console.error('统计上报失败');
}
```

### Q3: 用户ID 会暴露隐私吗？

**A:** 不会。使用 SHA256 哈希。

```typescript
const identifier = `${hostname}-${macAddress}`;
const hash = crypto.createHash('sha256').update(identifier).digest('hex');
return hash.substring(0, 32);  // 只返回哈希值
```

### Q4: API 超时时间多少合适？

**A:**
- 检查更新 API: `10000ms` (10秒)
- 统计上报 API: `5000ms` (5秒，不重要)

### Q5: 如何测试灰度功能？

**A:** 修改测试 API 返回：

```python
@app.post("/api/v1/updates/check")
async def check_updates(req: dict):
    user_id = req["user_id"]
    
    # 简单灰度逻辑：用户ID最后一位数字
    last_digit = int(user_id[-1], 16) % 10
    blocked = last_digit >= 1  # 只有 10% 用户能更新
    
    return {
        "success": True,
        "data": {
            "has_update": True,
            "latest_version": "1.0.8",
            "rollout_blocked": blocked,
            "rollout_percentage": 10,
            # ...
        }
    }
```

---

## 📊 字段对照表

### API 响应 → 内部格式

| API 字段 | 内部字段 | 说明 |
|----------|---------|------|
| `latest_version` | `version` | 版本号 |
| `release_date` | `releaseDate` | 发布日期 |
| `download_url` | `downloadUrl` | 下载地址 |
| `file_hash` | `sha256` | 文件哈希 |
| `file_size` | `fileSize` | 文件大小 |
| `is_mandatory` | `mandatory` | 强制更新 |
| `rollout_blocked` | `rolloutBlocked` | 灰度阻止 |
| `rollout_percentage` | `rolloutPercentage` | 发布比例 |
| `changelog` | `changelog` | 更新日志 |

---

## 📦 文件清单

```
C:\Users\crystal\Desktop\USG1.0.2\USG Server Updates\Docs\client\
├── CLIENT_UPDATE_WITH_API.md          # 详细方案说明
├── custom-updater-api-version.ts      # 完整代码示例
├── MIGRATION_GUIDE.md                 # 迁移指南
└── QUICK_REFERENCE.md                 # 本文档（快速参考）
```

---

## 🚀 立即开始

1. **阅读:** [MIGRATION_GUIDE.md](./MIGRATION_GUIDE.md)
2. **参考:** [custom-updater-api-version.ts](./custom-updater-api-version.ts)
3. **测试:** 启动本地测试 API
4. **部署:** 修改代码并测试
5. **发布:** 上传新版本到服务器

---

**文档版本:** v1.0  
**最后更新:** 2025-11-05  
**维护者:** USG 开发团队

