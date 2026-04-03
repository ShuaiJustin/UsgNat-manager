# 客户端更新 - API 方案迁移指南

**版本:** 1.0  
**日期:** 2025-11-05  
**适用项目:** USG NAT Manager

---

## 📊 方案对比总览

### 方案演进

```
旧方案（静态文件）          →          新方案（API集成）
─────────────────────────────────────────────────────────
直接读取 latest.json      →     调用 RESTful API
无灰度控制                →     支持灰度发布
无统计数据                →     自动统计上报
功能受限                  →     功能完整可扩展
```

---

## 🔍 核心差异对比

### 1. 版本信息获取

#### 旧方案 - 静态文件

```typescript
// 直接 GET 请求 latest.json
private async fetchFromServer(serverUrl: string): Promise<any> {
  const url = `${serverUrl}/updates/latest.json`;
  
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || 80,
      path: parsedUrl.pathname,
      method: 'GET',  // ← GET 请求
      timeout: 10000
    };
    
    const client = parsedUrl.protocol === 'https:' ? https : http;
    
    const req = client.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        const jsonData = JSON.parse(data);
        resolve(jsonData); // ← 直接返回 JSON
      });
    });
    
    req.end();
  });
}
```

**静态 latest.json 格式：**
```json
{
  "version": "1.0.8",
  "releaseDate": "2025-11-10",
  "downloadUrl": "/updates/v1.0.8/USG-NAT-Manager-Setup-1.0.8.exe",
  "sha256": "a3f7b8c9...",
  "fileSize": 104857600,
  "changelog": [...]
}
```

#### 新方案 - API 调用

```typescript
// POST 请求 API 端点
private async fetchFromServer(serverUrl: string): Promise<any> {
  const apiUrl = `${serverUrl}/api/v1/updates/check`;
  
  return new Promise((resolve, reject) => {
    // 准备请求数据
    const postData = JSON.stringify({
      current_version: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
      user_id: await this.getUserId(),  // ← 上报用户ID
      channel: 'stable'                 // ← 渠道选择
    });
    
    const parsedUrl = new URL(apiUrl);
    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || 80,
      path: parsedUrl.pathname,
      method: 'POST',  // ← POST 请求
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        'User-Agent': `USG-NAT-Manager/${app.getVersion()}`
      },
      timeout: 10000
    };
    
    const client = parsedUrl.protocol === 'https:' ? https : http;
    
    const req = client.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        const jsonData = JSON.parse(data);
        
        // ← API 响应包含更多信息
        if (jsonData.success && jsonData.data) {
          // 转换为内部格式
          const versionInfo = {
            version: jsonData.data.latest_version,
            releaseDate: jsonData.data.release_date,
            downloadUrl: jsonData.data.download_url,
            sha256: jsonData.data.file_hash,
            fileSize: jsonData.data.file_size,
            mandatory: jsonData.data.is_mandatory,        // ← 强制更新
            changelog: jsonData.data.changelog,
            rolloutBlocked: jsonData.data.rollout_blocked, // ← 灰度阻止
            rolloutPercentage: jsonData.data.rollout_percentage,
          };
          resolve(versionInfo);
        }
      });
    });
    
    req.write(postData);  // ← 发送请求体
    req.end();
  });
}
```

**API 响应格式：**
```json
{
  "success": true,
  "data": {
    "has_update": true,
    "latest_version": "1.0.8",
    "release_date": "2025-11-10",
    "download_url": "/updates/v1.0.8/USG-NAT-Manager-Setup-1.0.8.exe",
    "file_hash": "a3f7b8c9...",
    "file_size": 104857600,
    "is_mandatory": false,
    "rollout_blocked": false,      // ← 新增：灰度控制
    "rollout_percentage": 100,     // ← 新增：发布比例
    "changelog": [...],
    "minimum_version": "1.0.0"     // ← 新增：最低版本
  }
}
```

---

### 2. 用户标识

#### 旧方案 - 无用户标识

```typescript
// 无需用户ID，所有用户看到相同的更新
```

#### 新方案 - 唯一用户标识

```typescript
/**
 * 获取机器唯一标识
 */
private async getUserId(): Promise<string> {
  if (this.userId) {
    return this.userId; // 缓存
  }

  const hostname = os.hostname();
  const networkInterfaces = os.networkInterfaces();
  
  // 获取 MAC 地址
  let macAddress = '';
  for (const name of Object.keys(networkInterfaces)) {
    const iface = networkInterfaces[name];
    if (iface) {
      for (const item of iface) {
        if (!item.internal && item.mac && item.mac !== '00:00:00:00:00:00') {
          macAddress = item.mac;
          break;
        }
      }
    }
    if (macAddress) break;
  }
  
  // 哈希保护隐私
  const identifier = `${hostname}-${macAddress}`;
  const hash = crypto.createHash('sha256').update(identifier).digest('hex');
  
  this.userId = hash.substring(0, 32);
  return this.userId;
}
```

**用途：**
- 灰度发布控制
- 统计分析
- 问题追踪

---

### 3. 灰度发布支持

#### 旧方案 - 不支持

```typescript
// 所有用户同时看到新版本，无法控制
```

#### 新方案 - 完整支持

```typescript
// API 返回灰度控制信息
if (versionInfo.rolloutBlocked) {
  logger.info('自动更新', '新版本发布中，您的设备暂未进入更新名单');
  
  this.sendMessage('show-update-dialog', {
    type: 'rollout-blocked',  // ← 新的对话框类型
    version: latestVersion,
    currentVersion,
    rolloutPercentage: versionInfo.rolloutPercentage,
  });
  
  return {
    success: true,
    message: '新版本发布中，您的设备暂未进入更新名单',
    hasUpdate: true,  // ← 有更新但不提供下载
  };
}
```

**UI 处理：**
```typescript
// UpdateDialog.tsx 新增
case 'rollout-blocked':
  modal.info({
    title: '新版本发布中',
    content: (
      <div>
        版本 v{version} 正在灰度发布中（{rolloutPercentage}%）。
        您的设备暂未进入本次更新名单，请耐心等待。
      </div>
    ),
  });
  break;
```

---

### 4. 统计数据上报

#### 旧方案 - 无统计

```typescript
// 无法知道：
// - 多少用户下载了更新
// - 多少用户成功安装
// - 失败原因是什么
```

#### 新方案 - 完整统计

```typescript
// 1. 下载开始时
async downloadUpdate(): Promise<void> {
  await this.reportDownloadStats('started');  // ← 上报
  
  try {
    await this.downloadUpdateWithRetry();
    await this.reportDownloadStats('completed');  // ← 上报
  } catch (error) {
    await this.reportDownloadStats('failed', error.message);  // ← 上报
    throw error;
  }
}

// 2. 安装开始时
async quitAndInstall(): Promise<void> {
  await this.reportInstallStats('started');  // ← 上报
  
  exec(`"${this.downloadedFilePath}"`, (error) => {
    if (error) {
      this.reportInstallStats('failed', error.message);  // ← 上报
    }
  });
  
  app.quit();
}

// 3. 上报实现
private async reportDownloadStats(status: string, errorMessage?: string) {
  const statsData = {
    user_id: await this.getUserId(),
    version: this.latestVersionInfo.version,
    from_version: this.getCurrentVersion(),
    platform: process.platform,
    arch: process.arch,
    status: status,  // started/completed/failed
    error_message: errorMessage || null,
  };
  
  // 发送到 API
  await this.sendStats(
    `${serverUrl}/api/v1/updates/stats/download`,
    statsData
  );
}
```

**获得的数据：**
```sql
-- 下载统计
SELECT 
  version,
  COUNT(*) as total_downloads,
  COUNT(CASE WHEN status='completed' THEN 1 END) as successful,
  COUNT(CASE WHEN status='failed' THEN 1 END) as failed
FROM download_logs
GROUP BY version;

-- 安装统计
SELECT
  to_version,
  COUNT(*) as total_installs,
  AVG(CASE WHEN status='completed' THEN 1 ELSE 0 END) * 100 as success_rate
FROM install_logs
GROUP BY to_version;
```

---

### 5. 服务器地址配置

#### 旧方案

```typescript
private updateServerUrls = [
  'http://shcrystal.top:8123/updates',      // ← 静态文件目录
  'http://192.168.1.164/updates',
];

// 访问：http://shcrystal.top:8123/updates/latest.json
```

#### 新方案

```typescript
private updateServerUrls = [
  'http://shcrystal.top:8123',      // ← API 根路径
  'http://192.168.1.164:8123',
];

// 访问：http://shcrystal.top:8123/api/v1/updates/check
```

---

## 🚀 迁移步骤

### 第一阶段：准备工作

#### 1. 备份现有代码

```bash
cd C:\Users\crystal\Desktop\USG1.0.2\src\main\services
copy custom-updater.ts custom-updater.ts.backup
```

#### 2. 复制新代码

```bash
copy "C:\Users\crystal\Desktop\USG1.0.2\USG Server Updates\Docs\client\custom-updater-api-version.ts" custom-updater.ts
```

---

### 第二阶段：代码修改

#### 1. 修改 `fetchFromServer` 方法

**关键改动：**
- GET → POST
- 添加请求体（version, platform, arch, user_id, channel）
- 解析新的 API 响应格式
- 处理 `rollout_blocked` 字段

#### 2. 添加 `getUserId` 方法

**新增方法：**
```typescript
private async getUserId(): Promise<string> {
  // ... 完整实现见 custom-updater-api-version.ts
}
```

#### 3. 处理灰度阻止

**在 `checkForUpdates` 中添加：**
```typescript
if (versionInfo.rolloutBlocked) {
  // 显示灰度阻止提示
  // 不提供下载按钮
}
```

#### 4. 添加统计上报

**新增方法：**
```typescript
private async reportDownloadStats(status, errorMessage?)
private async reportInstallStats(status, errorMessage?)
private sendStats(url, data)
```

**调用位置：**
- `downloadUpdate()` 开始/成功/失败时
- `quitAndInstall()` 开始时

#### 5. 更新服务器地址

```typescript
// 移除 /updates 后缀
private updateServerUrls = [
  'http://shcrystal.top:8123',
  'http://192.168.1.164:8123',
];
```

---

### 第三阶段：UI 修改

#### 1. 修改 `UpdateDialog.tsx`

**添加灰度阻止处理：**

```typescript
// src/renderer/components/UpdateDialog.tsx

const handleUpdaterMessage = (_event: any, payload: any) => {
  // ... 现有代码 ...
  
  switch (type) {
    // ... 现有 cases ...
    
    // ← 新增
    case 'rollout-blocked':
      modal.info({
        title: (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <InfoCircleOutlined style={{ color: '#faad14' }} />
            <span>新版本发布中</span>
          </div>
        ),
        icon: null,
        width: 500,
        content: (
          <div style={{ padding: '16px 0' }}>
            <div style={{
              marginBottom: 16,
              padding: 16,
              background: '#fffbe6',
              border: '1px solid #ffe58f',
              borderRadius: 6,
            }}>
              <div style={{ marginBottom: 8 }}>
                <Text strong>版本 v{data.version} 正在灰度发布中</Text>
              </div>
              <Text type="secondary">
                您的设备暂未进入本次更新名单。新版本将分阶段向所有用户开放，
                请耐心等待或联系管理员。
              </Text>
              {data.rolloutPercentage && (
                <div style={{ marginTop: 8 }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    当前发布比例: {data.rolloutPercentage}%
                  </Text>
                </div>
              )}
            </div>
            
            <div style={{ marginTop: 16 }}>
              <Text type="secondary" style={{ fontSize: 13 }}>
                当前版本: v{data.currentVersion}
              </Text>
            </div>
          </div>
        ),
        okText: '知道了',
        centered: true,
      });
      break;
  }
};
```

---

### 第四阶段：测试

#### 1. 本地 API 测试

**启动测试 API 服务器：**

```python
# test_api.py
from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI()

class UpdateCheckRequest(BaseModel):
    current_version: str
    platform: str
    arch: str
    user_id: str
    channel: str

@app.post("/api/v1/updates/check")
async def check_updates(req: UpdateCheckRequest):
    print(f"收到更新检查: {req.current_version} - {req.user_id}")
    
    # 测试响应
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
            "rollout_blocked": False,
            "rollout_percentage": 100,
            "changelog": [
                {"type": "feature", "description": "测试功能"}
            ]
        }
    }

# 运行: uvicorn test_api:app --host 0.0.0.0 --port 8123
```

**修改客户端服务器地址：**
```typescript
private updateServerUrls = [
  'http://localhost:8123',  // 测试地址
];
```

**启动客户端测试：**
```bash
npm run dev
```

#### 2. 测试场景

**场景 1: 正常更新**
```json
{
  "has_update": true,
  "rollout_blocked": false
}
```
→ 应显示更新对话框，提供下载按钮

**场景 2: 灰度阻止**
```json
{
  "has_update": true,
  "rollout_blocked": true,
  "rollout_percentage": 10
}
```
→ 应显示"新版本发布中"提示，不提供下载按钮

**场景 3: 无更新**
```json
{
  "has_update": false
}
```
→ 应显示"当前已是最新版本"

**场景 4: API 错误**
```json
{
  "success": false,
  "message": "服务器错误"
}
```
→ 应显示错误提示

#### 3. 统计上报测试

**添加统计端点：**
```python
@app.post("/api/v1/updates/stats/download")
async def download_stats(data: dict):
    print(f"下载统计: {data}")
    return {"success": True}

@app.post("/api/v1/updates/stats/install")
async def install_stats(data: dict):
    print(f"安装统计: {data}")
    return {"success": True}
```

**测试步骤：**
1. 启动客户端
2. 检查更新
3. 下载更新
4. 观察服务器日志，应该看到统计上报

---

### 第五阶段：部署

#### 1. 更新生产服务器

确保生产服务器已部署：
- FastAPI 后端
- PostgreSQL 数据库
- Nginx 反向代理

#### 2. 修改客户端服务器地址

```typescript
private updateServerUrls = [
  'http://shcrystal.top:8123',
  'http://192.168.1.164:8123',
];
```

#### 3. 构建新版本

```bash
npm run build
npm run make
```

#### 4. 发布新版本

- 上传到服务器
- 在 Web 管理后台创建新版本
- 设置灰度比例（如 10%）
- 观察统计数据
- 逐步提升灰度比例

---

## 📋 检查清单

### 代码修改

- [ ] `custom-updater.ts` - 修改 `fetchFromServer` 方法（GET → POST）
- [ ] `custom-updater.ts` - 添加 `getUserId` 方法
- [ ] `custom-updater.ts` - 处理 `rolloutBlocked` 逻辑
- [ ] `custom-updater.ts` - 添加统计上报方法
- [ ] `custom-updater.ts` - 更新服务器地址（移除 /updates）
- [ ] `UpdateDialog.tsx` - 添加 `rollout-blocked` case
- [ ] `UpdateDialog.tsx` - 更新 UI 样式

### 测试

- [ ] 本地 API 测试 - 正常更新
- [ ] 本地 API 测试 - 灰度阻止
- [ ] 本地 API 测试 - 无更新
- [ ] 本地 API 测试 - API 错误
- [ ] 本地 API 测试 - 统计上报
- [ ] 生产环境测试 - 完整流程

### 部署

- [ ] 服务器端 API 已部署
- [ ] 数据库已配置
- [ ] Nginx 反向代理已配置
- [ ] 客户端服务器地址已更新
- [ ] 新版本已构建
- [ ] 新版本已上传到服务器
- [ ] Web 管理后台已配置
- [ ] 灰度发布已设置

---

## ⚠️ 注意事项

### 1. 向后兼容

**问题：** 旧版本客户端仍然访问 `latest.json`

**解决方案：** 保留 `latest.json` 静态文件

```bash
# 在服务器上同时维护两种方式
/var/www/usg-updates/
├── latest.json          # ← 旧版本客户端使用
├── updates/
│   └── v1.0.8/
│       └── *.exe
```

**Nginx 配置：**
```nginx
location /updates/latest.json {
    alias /var/www/usg-updates/latest.json;
    add_header Cache-Control "no-cache, no-store, must-revalidate";
}
```

### 2. 统计上报失败不影响主流程

```typescript
private async reportDownloadStats(...) {
  try {
    await this.sendStats(...);
  } catch (error) {
    // ← 捕获错误，不抛出
    console.error('统计上报失败:', error);
  }
}
```

### 3. 用户ID 生成失败降级

```typescript
private async getUserId(): Promise<string> {
  try {
    // 尝试生成标准ID
    return hash.substring(0, 32);
  } catch (error) {
    // ← 降级：使用随机ID
    return crypto.randomBytes(16).toString('hex');
  }
}
```

### 4. API 超时设置

```typescript
// 检查更新 API - 10秒超时
timeout: 10000

// 统计上报 API - 5秒超时（不影响主流程）
timeout: 5000
```

---

## 🎯 预期收益

### 功能提升

| 功能 | 旧方案 | 新方案 |
|------|--------|--------|
| 灰度发布 | ❌ | ✅ |
| 统计分析 | ❌ | ✅ |
| 强制更新 | ❌ | ✅ |
| 渠道控制 | ❌ | ✅ |
| 最低版本限制 | ❌ | ✅ |

### 数据获得

- **版本分布** - 了解用户版本情况
- **更新成功率** - 发现潜在问题
- **失败原因** - 针对性优化
- **灰度效果** - 验证发布策略

### 管理提升

- **可视化管理** - Web 后台操作
- **灵活控制** - 动态调整策略
- **问题追踪** - 快速定位用户
- **数据驱动** - 优化发布流程

---

## 📚 相关文档

- [CLIENT_UPDATE_WITH_API.md](./CLIENT_UPDATE_WITH_API.md) - API 集成方案详解
- [custom-updater-api-version.ts](./custom-updater-api-version.ts) - 完整代码示例
- [../ADMIN_SYSTEM_SUMMARY.md](../ADMIN_SYSTEM_SUMMARY.md) - 服务器端方案
- [../ADMIN_SYSTEM_GUIDE.md](../ADMIN_SYSTEM_GUIDE.md) - 部署指南

---

**文档版本:** v1.0  
**最后更新:** 2025-11-05  
**维护者:** USG 开发团队

