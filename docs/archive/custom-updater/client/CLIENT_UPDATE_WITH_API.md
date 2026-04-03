# USG NAT Manager 客户端更新 - API 集成方案

**版本:** 2.0  
**日期:** 2025-11-05  
**状态:** 基于完整 Web 管理后台系统

---

## 📋 方案对比

### 旧方案（静态文件）

```typescript
// 直接读取 latest.json
const response = await fetch('http://shcrystal.top:8123/updates/latest.json');
const versionInfo = await response.json();
```

**缺点：**
- ❌ 无法进行灰度控制
- ❌ 无法收集统计数据
- ❌ 无法动态配置
- ❌ 功能受限

### 新方案（API 集成）

```typescript
// 调用 RESTful API
const response = await fetch('http://shcrystal.top:8123/api/v1/updates/check', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    current_version: '1.0.7',
    platform: 'win32',
    arch: 'x64',
    user_id: getUserId(),
    channel: 'stable'
  })
});
const result = await response.json();
```

**优点：**
- ✅ 支持灰度发布控制
- ✅ 自动收集统计数据
- ✅ 动态配置更新策略
- ✅ 功能完整可扩展

---

## 🔧 客户端改造方案

### 需要修改的文件

#### 1. `src/main/services/custom-updater.ts`

**修改 `fetchFromServer` 方法：**

```typescript
/**
 * 从 API 服务器获取版本信息
 */
private async fetchFromServer(serverUrl: string): Promise<any> {
  // 获取客户端信息
  const currentVersion = app.getVersion();
  const platform = process.platform;
  const arch = process.arch;
  const userId = await this.getUserId(); // 机器唯一标识
  
  // 调用检查更新 API
  const apiUrl = `${serverUrl}/api/v1/updates/check`;
  
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      current_version: currentVersion,
      platform: platform,
      arch: arch,
      user_id: userId,
      channel: 'stable' // stable/beta/alpha
    });
    
    const parsedUrl = new URL(apiUrl);
    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
      path: parsedUrl.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        'User-Agent': `USG-NAT-Manager/${currentVersion}`
      },
      timeout: 10000
    };
    
    const client = parsedUrl.protocol === 'https:' ? https : http;
    
    const req = client.request(options, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`服务器返回错误: ${res.statusCode}`));
        return;
      }
      
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const jsonData = JSON.parse(data);
          
          // API 响应格式
          if (jsonData.success && jsonData.data) {
            // 转换为内部格式
            const versionInfo = {
              version: jsonData.data.latest_version,
              releaseDate: jsonData.data.release_date,
              downloadUrl: jsonData.data.download_url,
              sha256: jsonData.data.file_hash,
              fileSize: jsonData.data.file_size,
              mandatory: jsonData.data.is_mandatory || false,
              changelog: jsonData.data.changelog || [],
              rolloutBlocked: jsonData.data.rollout_blocked || false,
              _serverUrl: serverUrl
            };
            
            resolve(versionInfo);
          } else {
            reject(new Error(jsonData.message || '获取版本信息失败'));
          }
        } catch (error) {
          reject(new Error('解析版本信息失败'));
        }
      });
    });
    
    req.on('error', (error) => {
      reject(error);
    });
    
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('请求超时'));
    });
    
    // 发送请求数据
    req.write(postData);
    req.end();
  });
}
```

**添加获取用户ID方法：**

```typescript
/**
 * 获取机器唯一标识
 */
private async getUserId(): Promise<string> {
  const os = require('os');
  const crypto = require('crypto');
  
  // 使用机器名 + MAC 地址生成唯一标识
  const hostname = os.hostname();
  const networkInterfaces = os.networkInterfaces();
  
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
  
  // 生成唯一标识
  const identifier = `${hostname}-${macAddress}`;
  const hash = crypto.createHash('sha256').update(identifier).digest('hex');
  
  return hash.substring(0, 32); // 返回32位ID
}
```

**处理灰度阻止：**

```typescript
async checkForUpdates(showNoUpdateMessage = true): Promise<{
  success: boolean;
  message?: string;
  hasUpdate?: boolean;
  currentVersion?: string;
  latestVersion?: string;
}> {
  // ... 现有代码 ...
  
  // 获取版本信息
  const versionInfo = await this.fetchVersionInfo();
  
  // 检查是否被灰度阻止
  if (versionInfo.rolloutBlocked) {
    logger.info('自动更新', '新版本发布中，您的设备暂未进入更新名单');
    
    if (showNoUpdateMessage) {
      this.sendMessage('show-update-dialog', {
        type: 'rollout-blocked',
        version: versionInfo.version,
        currentVersion,
      });
    }
    
    this.isChecking = false;
    return {
      success: true,
      message: '新版本发布中，您的设备暂未进入更新名单',
      hasUpdate: false,
      currentVersion,
      latestVersion: versionInfo.version,
    };
  }
  
  // ... 其他逻辑 ...
}
```

#### 2. 更新服务器地址配置

```typescript
// 修改为 API 地址
private updateServerUrls = [
  'http://shcrystal.top:8123',      // 主服务器（API根路径）
  'http://192.168.1.164:8123',      // 备用服务器
];
```

---

## 📡 API 接口规范

### 1. 检查更新

**Endpoint:** `POST /api/v1/updates/check`

**请求体：**
```json
{
  "current_version": "1.0.7",
  "platform": "win32",
  "arch": "x64",
  "user_id": "a1b2c3d4e5f6...",
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
    "download_url": "/updates/v1.0.8/USG-NAT-Manager-Setup-1.0.8.exe",
    "file_hash": "a3f7b8c9d2e1f4a5...",
    "file_size": 104857600,
    "is_mandatory": false,
    "rollout_blocked": false,
    "changelog": [
      {
        "type": "feature",
        "description": "新增 IPv6 NAT 规则支持"
      },
      {
        "type": "improve",
        "description": "优化 SSH 连接稳定性"
      }
    ],
    "minimum_version": "1.0.0"
  }
}
```

**响应（无更新）：**
```json
{
  "success": true,
  "data": {
    "has_update": false,
    "current_version": "1.0.7",
    "message": "当前已是最新版本"
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
    "rollout_blocked": true,
    "rollout_percentage": 10,
    "message": "新版本发布中，您的设备暂未进入更新名单"
  }
}
```

**响应（错误）：**
```json
{
  "success": false,
  "message": "版本信息不存在"
}
```

### 2. 下载统计（自动上报）

**Endpoint:** `POST /api/v1/updates/stats/download`

**请求体：**
```json
{
  "user_id": "a1b2c3d4e5f6...",
  "version": "1.0.8",
  "from_version": "1.0.7",
  "platform": "win32",
  "arch": "x64",
  "status": "started"  // started/completed/failed
}
```

**响应：**
```json
{
  "success": true,
  "message": "统计已记录"
}
```

### 3. 安装统计（自动上报）

**Endpoint:** `POST /api/v1/updates/stats/install`

**请求体：**
```json
{
  "user_id": "a1b2c3d4e5f6...",
  "from_version": "1.0.7",
  "to_version": "1.0.8",
  "platform": "win32",
  "arch": "x64",
  "status": "started"  // started/completed/failed
}
```

---

## 🎨 UI 更新

### UpdateDialog 组件新增灰度阻止提示

```typescript
// src/renderer/components/UpdateDialog.tsx

case 'rollout-blocked':
  // 灰度阻止 - 新版本发布中但用户未进入名单
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
        <div
          style={{
            marginBottom: 16,
            padding: 16,
            background: '#fffbe6',
            border: '1px solid #ffe58f',
            borderRadius: 6,
          }}
        >
          <div style={{ marginBottom: 8 }}>
            <Text strong>版本 v{version} 正在灰度发布中</Text>
          </div>
          <Text type="secondary">
            您的设备暂未进入本次更新名单。新版本将分阶段向所有用户开放，
            请耐心等待或联系管理员。
          </Text>
        </div>
        
        <div style={{ marginTop: 16 }}>
          <Text type="secondary" style={{ fontSize: 13 }}>
            当前版本: v{currentVersion}
          </Text>
        </div>
      </div>
    ),
    okText: '知道了',
    centered: true,
  });
  break;
```

---

## 📊 统计数据上报

### 在关键节点自动上报

```typescript
// 1. 下载开始时
private async downloadUpdate(): Promise<void> {
  // ... 开始下载 ...
  
  // 上报下载开始
  await this.reportDownloadStats('started');
  
  try {
    await this.downloadUpdateWithRetry();
    
    // 上报下载成功
    await this.reportDownloadStats('completed');
  } catch (error) {
    // 上报下载失败
    await this.reportDownloadStats('failed', error.message);
    throw error;
  }
}

// 2. 安装开始时
async quitAndInstall(): Promise<void> {
  // 上报安装开始
  await this.reportInstallStats('started');
  
  // ... 启动安装程序 ...
}

/**
 * 上报下载统计
 */
private async reportDownloadStats(status: string, error?: string): Promise<void> {
  try {
    const versionInfo = this.latestVersionInfo; // 保存的版本信息
    if (!versionInfo) return;
    
    const userId = await this.getUserId();
    const currentVersion = this.getCurrentVersion();
    
    const statsData = {
      user_id: userId,
      version: versionInfo.version,
      from_version: currentVersion,
      platform: process.platform,
      arch: process.arch,
      status: status,
      error_message: error || null,
    };
    
    // 发送到所有可用服务器
    for (const serverUrl of this.updateServerUrls) {
      try {
        await this.sendStats(`${serverUrl}/api/v1/updates/stats/download`, statsData);
        break; // 成功则退出
      } catch (err) {
        // 继续尝试下一个服务器
      }
    }
  } catch (error) {
    // 统计上报失败不影响主流程
    console.error('上报下载统计失败:', error);
  }
}

/**
 * 上报安装统计
 */
private async reportInstallStats(status: string, error?: string): Promise<void> {
  try {
    const versionInfo = this.latestVersionInfo;
    if (!versionInfo) return;
    
    const userId = await this.getUserId();
    const currentVersion = this.getCurrentVersion();
    
    const statsData = {
      user_id: userId,
      from_version: currentVersion,
      to_version: versionInfo.version,
      platform: process.platform,
      arch: process.arch,
      status: status,
      error_message: error || null,
    };
    
    for (const serverUrl of this.updateServerUrls) {
      try {
        await this.sendStats(`${serverUrl}/api/v1/updates/stats/install`, statsData);
        break;
      } catch (err) {
        // 继续尝试
      }
    }
  } catch (error) {
    console.error('上报安装统计失败:', error);
  }
}

/**
 * 发送统计数据
 */
private sendStats(url: string, data: any): Promise<void> {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(data);
    const parsedUrl = new URL(url);
    
    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || 80,
      path: parsedUrl.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      },
      timeout: 5000 // 统计上报超时时间较短
    };
    
    const client = parsedUrl.protocol === 'https:' ? https : http;
    
    const req = client.request(options, (res) => {
      if (res.statusCode === 200) {
        resolve();
      } else {
        reject(new Error(`HTTP ${res.statusCode}`));
      }
    });
    
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Timeout'));
    });
    
    req.write(postData);
    req.end();
  });
}
```

---

## 🔄 完整更新流程

```
客户端启动
  ↓
延迟 5 秒
  ↓
调用 API 检查更新
  POST /api/v1/updates/check
  {
    current_version: "1.0.7",
    user_id: "a1b2c3d4...",
    platform: "win32",
    arch: "x64"
  }
  ↓
[服务器端处理]
  1. 查询数据库最新版本
  2. 检查灰度配置
  3. 决定是否返回更新
  ↓
[情况1: 有更新且未被灰度阻止]
  ↓
显示更新弹窗
  ↓
用户点击下载
  ↓
上报统计: download/started
  ↓
下载文件（从静态文件服务器）
  GET /updates/v1.0.8/*.exe
  ↓
SHA-256 校验
  ↓
上报统计: download/completed
  ↓
显示安装确认
  ↓
用户点击安装
  ↓
创建备份
  ↓
上报统计: install/started
  ↓
启动安装程序
  ↓
退出应用

[情况2: 被灰度阻止]
  ↓
显示"新版本发布中"提示
  ↓
不提供下载选项

[情况3: 无更新]
  ↓
（静默或提示）已是最新版本
```

---

## 🎯 迁移步骤

### 1. 备份现有代码

```bash
cd src/main/services
cp custom-updater.ts custom-updater.ts.bak
```

### 2. 修改 custom-updater.ts

按照上面的代码修改：
- `fetchFromServer` 方法
- 添加 `getUserId` 方法
- 添加统计上报方法
- 更新服务器地址

### 3. 测试 API 连接

```typescript
// 临时测试代码
async testApiConnection() {
  try {
    const result = await this.fetchFromServer('http://shcrystal.top:8123');
    console.log('API 测试成功:', result);
  } catch (error) {
    console.error('API 测试失败:', error);
  }
}
```

### 4. 更新 UI 组件

在 `UpdateDialog.tsx` 中添加 `rollout-blocked` 类型处理。

### 5. 渐进式切换

**阶段1：** API + 静态文件双支持
```typescript
// 先尝试 API，失败则降级到静态文件
try {
  return await this.fetchFromApi(serverUrl);
} catch (error) {
  logger.warning('API 调用失败，降级到静态文件');
  return await this.fetchFromStaticFile(serverUrl);
}
```

**阶段2：** 仅使用 API
```typescript
// 移除静态文件支持
return await this.fetchFromApi(serverUrl);
```

---

## 🔒 安全考虑

### 1. 用户ID 隐私

```typescript
// 用户ID 使用哈希，不暴露真实机器信息
const hash = crypto.createHash('sha256')
  .update(identifier)
  .digest('hex');
```

### 2. HTTPS 通信（推荐）

```typescript
// 生产环境使用 HTTPS
private updateServerUrls = [
  'https://shcrystal.top:8123',  // HTTPS
];
```

### 3. API 响应验证

```typescript
// 验证响应数据结构
if (!jsonData.success || !jsonData.data) {
  throw new Error('Invalid response format');
}

if (jsonData.data.has_update) {
  // 必需字段验证
  if (!jsonData.data.latest_version || 
      !jsonData.data.download_url || 
      !jsonData.data.file_hash) {
    throw new Error('Missing required fields');
  }
}
```

---

## 📊 收益分析

### 功能对比

| 功能 | 静态文件方案 | API 方案 |
|------|-------------|----------|
| 版本检查 | ✅ | ✅ |
| 文件下载 | ✅ | ✅ |
| 灰度发布 | ❌ | ✅ |
| 统计分析 | ❌ | ✅ |
| 动态配置 | ❌ | ✅ |
| 用户管理 | ❌ | ✅ |
| 回滚控制 | 手动 | 自动 |

### 数据价值

有了 API 后，可以获得：

- **更新成功率** - 多少用户成功更新
- **版本分布** - 各版本用户占比
- **下载统计** - 哪些版本下载量高
- **失败分析** - 更新失败的原因
- **灰度效果** - 灰度策略的效果

这些数据对优化产品和发布策略非常重要。

---

## 📚 相关文档

- [CUSTOM_UPDATE_SYSTEM_DESIGN.md](../CUSTOM_UPDATE_SYSTEM_DESIGN.md) - 更新系统设计（已更新为 API 方案）
- [UPDATE_IMPLEMENTATION_SUMMARY.md](../UPDATE_IMPLEMENTATION_SUMMARY.md) - 客户端实施总结
- [ADMIN_SYSTEM_GUIDE.md](../ADMIN_SYSTEM_GUIDE.md) - 服务器部署指南
- [ADMIN_SYSTEM_SUMMARY.md](../ADMIN_SYSTEM_SUMMARY.md) - 管理后台方案总结

---

**文档版本:** v2.0  
**最后更新:** 2025-11-05  
**适用版本:** USG NAT Manager v1.0.7+

