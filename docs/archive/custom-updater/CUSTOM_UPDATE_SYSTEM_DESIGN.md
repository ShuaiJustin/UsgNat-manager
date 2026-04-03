# USG NAT Manager 自研更新系统设计文档

**版本:** 1.0  
**日期:** 2025-11-05  
**状态:** 已实施  
**部署环境:** Linux / Windows Server  
**服务地址:** http://shcrystal.top:8123/updates/ (主服务器)  
**备用地址:** http://192.168.1.164/updates/ (内网备用)

---

## 📋 目录

1. [系统概述](#系统概述)
2. [架构设计](#架构设计)
3. [服务端设计](#服务端设计)
4. [客户端设计](#客户端设计)
5. [API 接口规范](#api-接口规范)
6. [安全机制](#安全机制)
7. [部署配置](#部署配置)
8. [监控和维护](#监控和维护)
9. [灰度发布](#灰度发布)
10. [故障处理](#故障处理)

---

## 系统概述

### 项目简介

**USG NAT Manager** 是一款企业级的华为USG防火墙NAT规则管理工具，采用自研更新系统代替 electron-updater，实现完全自主可控的更新机制。

### 设计目标

与 electron-updater 相比，自研更新系统提供：

- ✅ **完全自主控制** - 不依赖第三方服务，不生成 app-update.yml 暴露服务器地址
- ✅ **多服务器冗余** - 支持主备服务器自动切换，提高可用性
- ✅ **灵活的更新策略** - 支持定期自动检查（每日/每周/手动）
- ✅ **安全性增强** - SHA-256 完整性校验，更新前自动备份
- ✅ **智能重试机制** - 下载失败自动重试（最多3次，指数退避）
- ✅ **私有部署** - 支持内网和公网双部署模式
- ✅ **企业级可靠性** - 适合防火墙管理这类关键业务系统

### 技术栈

#### 客户端技术
- **Electron:** 28.1.0
- **React:** 18.2.0 + TypeScript 5.3
- **更新器:** 自研 CustomUpdater
- **完整性校验:** SHA-256
- **备份系统:** 集成 backup-service

#### 服务端技术
- **操作系统:** Linux / Windows Server
- **Web 服务器:** Nginx 1.24+
- **文件服务:** 静态文件托管
- **备用服务器:** 内网文件服务器（可选）

#### 当前项目信息
- **项目名称:** USG NAT Manager
- **应用ID:** com.crystal.usg-nat-manager
- **产品名称:** 华为USG防火墙NAT管理软件
- **当前版本:** 1.0.7
- **数据库:** SQLite (Prisma)

---

## 架构设计

### 整体架构图

```
┌─────────────────────────────────────────────────────────────┐
│              USG NAT Manager 客户端 (v1.0.7)                │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐  │
│  │  前端 UI     │───▶│ Electron     │───▶│ Custom       │  │
│  │  更新界面    │    │ Main Process │    │ Updater      │  │
│  └──────────────┘    └──────┬───────┘    └──────┬───────┘  │
│                              │                     │          │
│                              │ IPC                │ HTTP     │
└──────────────────────────────┼─────────────────────┼──────────┘
                               │                     │
                               │                     ▼
                    ┌──────────┴─────────────────────────────┐
                    │  多服务器负载均衡 (自动切换)           │
                    ├────────────────────────────────────────┤
                    │  [1] shcrystal.top:8123 (公网主)      │
                    │  [2] 192.168.1.164 (内网备用)          │
                    └──────────────┬─────────────────────────┘
                                   │
                    ┌──────────────┴─────────────────┐
                    │   Nginx 静态文件服务           │
                    ├────────────────────────────────┤
                    │  • 版本信息 API                │
                    │  • 文件下载服务                │
                    │  • 断点续传支持                │
                    └───────────────┬────────────────┘
                                    │
                    ┌───────────────┴────────────────┐
                    │  文件存储 /updates/            │
                    ├────────────────────────────────┤
                    │  • latest.json (版本信息)      │
                    │  • v1.0.7/                     │
                    │    └─ USG-NAT-Manager-*.*      │
                    │  • v1.0.8/                     │
                    │    ├─ USG-NAT-Manager-*.*      │
                    │    ├─ changelog.json           │
                    │    └─ manifest.json            │
                    └────────────────────────────────┘
```

### 核心特性

#### 1. 多服务器冗余机制
```javascript
private updateServerUrls = [
  'http://shcrystal.top:8123/updates',  // 公网主服务器
  'http://192.168.1.164/updates',       // 内网备用服务器
];
```

- 自动尝试所有配置的服务器
- 主服务器故障时自动切换到备用服务器
- 适合企业内外网混合部署场景

#### 2. 定期自动检查
```javascript
const checkFrequency = {
  daily: 24 * 60 * 60 * 1000,   // 每天检查一次
  weekly: 7 * 24 * 60 * 60 * 1000, // 每周检查一次
  manual: 'disabled'             // 仅手动检查
};
```

- 用户可配置检查频率
- 防止重复检查（最小间隔1小时）
- 支持静默检查（不打扰用户）

#### 3. 智能重试机制
- 下载失败自动重试（最多3次）
- 指数退避策略（1s, 2s, 4s...）
- 避免服务器过载

#### 4. 安全性保障
- **SHA-256 完整性校验** - 防止文件损坏或篡改
- **更新前自动备份** - 支持快速回滚
- **不暴露服务器地址** - 无 app-update.yml 文件

---

## 服务端设计

### 目录结构

```
/var/www/usg-updates/          # 公网服务器
├── latest.json                 # 最新版本信息
├── v1.0.7/
│   ├── USG-NAT-Manager-Setup-1.0.7.exe
│   ├── USG-NAT-Manager-Portable-1.0.7.exe
│   ├── manifest.json
│   └── SHA256SUMS.txt
├── v1.0.8/
│   ├── USG-NAT-Manager-Setup-1.0.8.exe
│   ├── USG-NAT-Manager-Portable-1.0.8.exe
│   ├── changelog.json           # 更新日志
│   ├── manifest.json            # 版本清单
│   └── SHA256SUMS.txt           # 校验文件
└── archive/                     # 历史版本归档
    ├── v1.0.5/
    └── v1.0.6/

/mnt/share/usg-updates/         # 内网备份服务器（可选）
├── latest.json
└── v1.0.8/
    └── ...（同上）
```

### 核心文件格式

#### 1. latest.json（版本信息）

```json
{
  "version": "1.0.8",
  "releaseDate": "2025-11-10",
  "downloadUrl": "v1.0.8/USG-NAT-Manager-Setup-1.0.8.exe",
  "sha256": "a3f7b8c9d2e1f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9",
  "fileSize": 104857600,
  "mandatory": false,
  "changelog": [
    "新增：支持 IPv6 NAT 规则管理",
    "优化：提升 SSH 连接稳定性",
    "修复：部分场景下设备掉线问题",
    "安全：更新依赖库，修复安全漏洞"
  ],
  "minimumVersion": "1.0.0",
  "platforms": {
    "win32": {
      "x64": "v1.0.8/USG-NAT-Manager-Setup-1.0.8.exe"
    }
  }
}
```

#### 2. changelog.json（详细更新日志）

```json
{
  "version": "1.0.8",
  "releaseDate": "2025-11-10T10:00:00Z",
  "changes": [
    {
      "type": "feature",
      "title": "支持 IPv6 NAT 规则",
      "description": "新增对 IPv6 网络环境的 NAT Server 规则管理支持"
    },
    {
      "type": "improvement",
      "title": "SSH 连接优化",
      "description": "优化 SSH 连接池管理，提升并发连接稳定性"
    },
    {
      "type": "bugfix",
      "title": "修复设备掉线问题",
      "description": "修复长时间运行后部分设备显示掉线的问题"
    },
    {
      "type": "security",
      "title": "安全更新",
      "description": "更新 Electron 和依赖库版本，修复已知安全漏洞"
    }
  ],
  "breaking": false,
  "upgradeNotes": "本次更新建议所有用户升级，特别是使用 IPv6 环境的用户。"
}
```

#### 3. manifest.json（版本清单）

```json
{
  "version": "1.0.8",
  "buildDate": "2025-11-10T08:30:00Z",
  "buildNumber": 108,
  "files": [
    {
      "name": "USG-NAT-Manager-Setup-1.0.8.exe",
      "size": 104857600,
      "sha256": "a3f7b8c9d2e1f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9",
      "type": "installer"
    },
    {
      "name": "USG-NAT-Manager-Portable-1.0.8.exe",
      "size": 105906176,
      "sha256": "b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5",
      "type": "portable"
    }
  ],
  "dependencies": {
    "electron": "28.1.0",
    "node": "18.17.0"
  },
  "changelog": "v1.0.8/changelog.json"
}
```

### Nginx 配置示例

```nginx
# /etc/nginx/sites-available/usg-updates
server {
    listen 8123;
    server_name shcrystal.top;
    
    # 根目录
    root /var/www/usg-updates;
    
    # 日志
    access_log /var/log/nginx/usg-updates-access.log;
    error_log /var/log/nginx/usg-updates-error.log;
    
    # CORS 配置（允许客户端跨域访问）
    add_header 'Access-Control-Allow-Origin' '*' always;
    add_header 'Access-Control-Allow-Methods' 'GET, HEAD, OPTIONS' always;
    add_header 'Access-Control-Allow-Headers' 'Range' always;
    
    # 缓存策略
    location ~* \.(exe|zip)$ {
        # 大文件，缓存1天
        expires 1d;
        add_header Cache-Control "public, immutable";
        
        # 支持断点续传
        add_header Accept-Ranges bytes;
    }
    
    location ~* \.(json)$ {
        # JSON 文件，缓存5分钟
        expires 5m;
        add_header Cache-Control "public, must-revalidate";
    }
    
    # 目录索引
    autoindex on;
    autoindex_exact_size off;
    autoindex_localtime on;
    
    # 安全配置
    location ~ /\. {
        deny all;
    }
}
```

---

## 客户端设计

### 核心类: CustomUpdater

#### 类结构

```typescript
class CustomUpdater {
  // 状态管理
  private mainWindow: BrowserWindow | null = null;
  private isChecking = false;
  private isDownloading = false;
  
  // 服务器配置（多服务器支持）
  private updateServerUrls = [
    'http://shcrystal.top:8123/updates',
    'http://192.168.1.164/updates',
  ];
  
  // 下载管理
  private downloadedFilePath: string | null = null;
  private downloadRetryCount = 0;
  private maxRetries = 3;
  
  // 定期检查
  private periodicCheckTimer: NodeJS.Timeout | null = null;
  private lastCheckTime: number = 0;
  
  // 核心方法
  setMainWindow(window: BrowserWindow): void;
  async checkForUpdates(showNoUpdateMessage = true): Promise<Result>;
  async downloadUpdate(): Promise<void>;
  async quitAndInstall(): Promise<void>;
  getCurrentVersion(): string;
}
```

#### 主要功能

##### 1. 定期检查更新

```typescript
async startPeriodicCheck() {
  // 获取用户配置
  const updateConfig = await configService.getConfig('update');
  const autoCheck = updateConfig?.autoCheck !== false;
  const checkFrequency = updateConfig?.checkFrequency || 'daily';
  
  if (!autoCheck || checkFrequency === 'manual') {
    return;
  }
  
  // 计算检查间隔
  const intervals = {
    daily: 24 * 60 * 60 * 1000,
    weekly: 7 * 24 * 60 * 60 * 1000,
  };
  
  // 设置定时器
  this.periodicCheckTimer = setInterval(async () => {
    await this.checkForUpdates(false); // 静默检查
  }, intervals[checkFrequency]);
}
```

##### 2. 多服务器容错

```typescript
private async fetchVersionInfo(): Promise<any> {
  let lastError: Error | null = null;
  
  // 依次尝试所有服务器地址
  for (const serverUrl of this.updateServerUrls) {
    try {
      const versionInfo = await this.fetchFromServer(serverUrl);
      logger.info('从服务器获取版本信息成功', serverUrl);
      return versionInfo;
    } catch (error) {
      logger.warning(`服务器 ${serverUrl} 访问失败`);
      lastError = error;
      // 继续尝试下一个服务器
    }
  }
  
  throw lastError || new Error('所有更新服务器均无法访问');
}
```

##### 3. 智能重试下载

```typescript
private async downloadUpdateWithRetry(): Promise<void> {
  for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
    try {
      await this.downloadFile(url, filePath);
      
      // SHA-256 完整性校验
      const fileHash = await this.calculateSHA256(filePath);
      if (fileHash !== expectedHash) {
        fs.unlinkSync(filePath); // 删除损坏文件
        throw new Error('文件校验失败');
      }
      
      return; // 成功
    } catch (error) {
      if (attempt < this.maxRetries) {
        // 指数退避重试
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw new Error('下载失败，已重试3次');
}
```

##### 4. 更新前自动备份

```typescript
async quitAndInstall(): Promise<void> {
  try {
    // 创建更新前备份
    const currentVersion = this.getCurrentVersion();
    const backupInfo = await backupService.createBackup(
      `更新前自动备份 (v${currentVersion})`
    );
    
    logger.success('备份创建成功', backupInfo);
  } catch (error) {
    logger.warning('备份失败，但将继续安装');
  }
  
  // 启动安装程序
  exec(`"${this.downloadedFilePath}"`);
  
  // 退出应用
  setTimeout(() => app.quit(), 500);
}
```

### IPC 通信协议

#### 前端调用

```typescript
// 检查更新
const result = await window.electron.updater.checkForUpdates(true);

// 下载更新
await window.electron.updater.downloadUpdate();

// 安装更新
await window.electron.updater.quitAndInstall();

// 获取当前版本
const version = await window.electron.updater.getCurrentVersion();
```

#### 事件监听

```typescript
// 监听更新事件
window.electron.on('updater-message', (message) => {
  switch (message.event) {
    case 'checking-for-update':
      console.log('正在检查更新...');
      break;
      
    case 'update-available':
      console.log('发现新版本:', message.data);
      break;
      
    case 'update-not-available':
      console.log('当前已是最新版本');
      break;
      
    case 'download-progress':
      console.log('下载进度:', message.data.percent);
      break;
      
    case 'update-downloaded':
      console.log('更新下载完成');
      break;
      
    case 'update-error':
      console.error('更新错误:', message.data);
      break;
      
    case 'show-update-dialog':
      // 显示更新对话框
      showUpdateDialog(message.data);
      break;
  }
});
```

---

## API 接口规范

### 版本信息接口

#### GET /updates/latest.json

**请求:**
```
GET http://shcrystal.top:8123/updates/latest.json
```

**响应:**
```json
{
  "version": "1.0.8",
  "releaseDate": "2025-11-10",
  "downloadUrl": "v1.0.8/USG-NAT-Manager-Setup-1.0.8.exe",
  "sha256": "a3f7...f8a9",
  "fileSize": 104857600,
  "mandatory": false,
  "changelog": ["更新内容..."],
  "minimumVersion": "1.0.0"
}
```

### 文件下载接口

#### GET /updates/{version}/{filename}

**请求:**
```
GET http://shcrystal.top:8123/updates/v1.0.8/USG-NAT-Manager-Setup-1.0.8.exe
Range: bytes=0-
```

**响应头:**
```
HTTP/1.1 200 OK
Content-Type: application/octet-stream
Content-Length: 104857600
Accept-Ranges: bytes
ETag: "a3f7b8c9d2e1f4a5"
Cache-Control: public, max-age=86400
```

**支持断点续传:**
```
GET http://shcrystal.top:8123/updates/v1.0.8/USG-NAT-Manager-Setup-1.0.8.exe
Range: bytes=52428800-

HTTP/1.1 206 Partial Content
Content-Range: bytes 52428800-104857599/104857600
```

---

## 安全机制

### 1. 文件完整性校验

**SHA-256 计算:**
```typescript
private calculateSHA256(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}
```

**校验流程:**
```
1. 下载文件
2. 计算 SHA-256
3. 与服务器提供的哈希对比
4. 不匹配则删除文件并重新下载
5. 匹配后才允许安装
```

### 2. 更新前自动备份

**备份内容:**
- 数据库文件 (usg-nat.db)
- 用户配置
- 设备凭据（加密存储）
- 应用日志

**备份位置:**
```
%APPDATA%/usg-nat-manager/backups/
├── backup_20251110_143022.zip
│   ├── database/usg-nat.db
│   ├── config.json
│   ├── credentials.encrypted
│   └── logs/
└── backup_20251109_102015.zip
```

**恢复机制:**
- 更新失败自动提示恢复
- 用户可在设置中手动恢复
- 保留最近10个备份

### 3. 服务器地址隐藏

**为什么不使用 electron-updater？**

electron-updater 会生成 `app-update.yml` 文件暴露更新服务器地址：
```yaml
provider: generic
url: http://shcrystal.top:8123/updates
```

**自研系统的优势：**
- 服务器地址硬编码在源码中
- 打包后用户无法轻易获取
- 支持多服务器配置
- 可动态调整服务器列表

### 4. 企业级安全建议

**HTTPS 部署（推荐）:**
```nginx
server {
    listen 443 ssl http2;
    server_name shcrystal.top;
    
    ssl_certificate /etc/letsencrypt/live/shcrystal.top/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/shcrystal.top/privkey.pem;
    
    # ... 其他配置
}
```

**访问控制:**
```nginx
# IP 白名单（可选）
location /updates/ {
    allow 192.168.1.0/24;  # 内网
    allow 123.45.67.89;     # 公司公网IP
    deny all;
}
```

**流量限制:**
```nginx
# 防止滥用
limit_req_zone $binary_remote_addr zone=update_limit:10m rate=10r/m;

location ~* \.(exe|zip)$ {
    limit_req zone=update_limit burst=5;
}
```

---

## 部署配置

### Linux 服务器部署

#### 1. 安装 Nginx

```bash
# Ubuntu/Debian
sudo apt update
sudo apt install nginx -y

# CentOS/RHEL/Alma Linux
sudo dnf install nginx -y

# 启动服务
sudo systemctl start nginx
sudo systemctl enable nginx
```

#### 2. 创建更新目录

```bash
# 创建目录
sudo mkdir -p /var/www/usg-updates
sudo chown -R www-data:www-data /var/www/usg-updates

# 创建版本目录
cd /var/www/usg-updates
mkdir -p v1.0.7 v1.0.8 archive
```

#### 3. 配置 Nginx

```bash
# 创建配置文件
sudo nano /etc/nginx/sites-available/usg-updates

# 复制上面的 Nginx 配置

# 启用站点
sudo ln -s /etc/nginx/sites-available/usg-updates /etc/nginx/sites-enabled/

# 测试配置
sudo nginx -t

# 重启 Nginx
sudo systemctl restart nginx
```

#### 4. 上传文件

```bash
# 方式1: scp 上传
scp USG-NAT-Manager-Setup-1.0.8.exe user@shcrystal.top:/var/www/usg-updates/v1.0.8/

# 方式2: rsync 同步
rsync -avz --progress release/*.exe user@shcrystal.top:/var/www/usg-updates/v1.0.8/

# 计算 SHA-256
cd /var/www/usg-updates/v1.0.8
sha256sum *.exe > SHA256SUMS.txt
```

#### 5. 创建 latest.json

```bash
cd /var/www/usg-updates
cat > latest.json <<EOF
{
  "version": "1.0.8",
  "releaseDate": "$(date -I)",
  "downloadUrl": "v1.0.8/USG-NAT-Manager-Setup-1.0.8.exe",
  "sha256": "$(sha256sum v1.0.8/USG-NAT-Manager-Setup-1.0.8.exe | cut -d' ' -f1)",
  "fileSize": $(stat -f%z v1.0.8/USG-NAT-Manager-Setup-1.0.8.exe 2>/dev/null || stat -c%s v1.0.8/USG-NAT-Manager-Setup-1.0.8.exe),
  "mandatory": false,
  "changelog": [
    "新增：某某功能",
    "优化：某某性能",
    "修复：某某问题"
  ]
}
EOF
```

#### 6. 防火墙配置

```bash
# UFW (Ubuntu)
sudo ufw allow 8123/tcp

# Firewalld (CentOS/Alma)
sudo firewall-cmd --permanent --add-port=8123/tcp
sudo firewall-cmd --reload
```

### Windows Server 部署

#### 1. 安装 IIS

```powershell
# 启用 IIS
Enable-WindowsOptionalFeature -Online -FeatureName IIS-WebServerRole

# 安装 URL Rewrite（可选）
# 从 https://www.iis.net/downloads/microsoft/url-rewrite 下载安装
```

#### 2. 创建站点

```powershell
# 创建目录
New-Item -Path "C:\inetpub\usg-updates" -ItemType Directory

# 创建 IIS 站点
Import-Module WebAdministration
New-Website -Name "USG-Updates" `
            -Port 8123 `
            -PhysicalPath "C:\inetpub\usg-updates"

# 启动站点
Start-Website -Name "USG-Updates"
```

#### 3. 配置 MIME 类型

```powershell
# 添加 .json MIME 类型
Add-WebConfigurationProperty -pspath 'MACHINE/WEBROOT/APPHOST' `
  -filter "system.webServer/staticContent" `
  -name "." `
  -value @{fileExtension='.json'; mimeType='application/json'}
```

### 内网备份服务器

#### 文件同步脚本

```bash
#!/bin/bash
# sync-updates.sh - 同步更新文件到内网服务器

SOURCE="user@shcrystal.top:/var/www/usg-updates/"
DEST="/mnt/share/usg-updates/"

# 使用 rsync 同步
rsync -avz --delete \
  --exclude 'archive/' \
  --exclude '*.log' \
  $SOURCE $DEST

# 记录日志
echo "[$(date)] 同步完成" >> /var/log/usg-update-sync.log
```

#### 定时任务

```bash
# 添加 cron 任务（每小时同步一次）
crontab -e

# 添加以下行
0 * * * * /opt/scripts/sync-updates.sh
```

---

## 监控和维护

### 1. 日志监控

#### Nginx 访问日志

```bash
# 实时查看访问
tail -f /var/log/nginx/usg-updates-access.log

# 统计下载次数
grep "GET.*\.exe" /var/log/nginx/usg-updates-access.log | wc -l

# 统计各版本下载量
grep "GET.*v1.0.8.*\.exe" /var/log/nginx/usg-updates-access.log | wc -l
```

#### 客户端日志

```
%APPDATA%/usg-nat-manager/logs/app.log
```

关键日志格式：
```
[2025-11-10 14:30:15] [INFO] [自动更新] 正在检查更新...
[2025-11-10 14:30:16] [INFO] [自动更新] 发现新版本 1.0.8
[2025-11-10 14:30:45] [SUCCESS] [自动更新] 文件完整性校验通过
[2025-11-10 14:30:50] [SUCCESS] [自动更新] 备份创建成功
```

### 2. 健康检查脚本

```bash
#!/bin/bash
# health-check.sh - 检查更新服务健康状态

SERVERS=(
  "http://shcrystal.top:8123/updates/latest.json"
  "http://192.168.1.164/updates/latest.json"
)

for server in "${SERVERS[@]}"; do
  response=$(curl -s -o /dev/null -w "%{http_code}" $server)
  if [ $response -eq 200 ]; then
    echo "✅ $server - OK"
  else
    echo "❌ $server - FAILED (HTTP $response)"
    # 发送告警邮件/通知
  fi
done
```

### 3. 磁盘空间监控

```bash
# 检查更新目录大小
du -sh /var/www/usg-updates/*

# 清理旧版本（保留最近5个版本）
ls -t /var/www/usg-updates/ | tail -n +6 | xargs -I {} mv /var/www/usg-updates/{} /var/www/usg-updates/archive/
```

### 4. 自动化部署脚本

```bash
#!/bin/bash
# deploy-update.sh - 自动部署新版本

VERSION=$1
FILE=$2

if [ -z "$VERSION" ] || [ -z "$FILE" ]; then
  echo "用法: $0 <版本号> <安装包文件>"
  exit 1
fi

# 1. 创建版本目录
mkdir -p /var/www/usg-updates/v$VERSION

# 2. 复制文件
cp $FILE /var/www/usg-updates/v$VERSION/

# 3. 计算 SHA-256
cd /var/www/usg-updates/v$VERSION
SHA256=$(sha256sum $(basename $FILE) | cut -d' ' -f1)
echo "SHA-256: $SHA256"

# 4. 更新 latest.json
cat > /var/www/usg-updates/latest.json <<EOF
{
  "version": "$VERSION",
  "releaseDate": "$(date -I)",
  "downloadUrl": "v$VERSION/$(basename $FILE)",
  "sha256": "$SHA256",
  "fileSize": $(stat -c%s $FILE),
  "mandatory": false,
  "changelog": ["请手动编辑更新日志"]
}
EOF

# 5. 同步到备份服务器
rsync -avz /var/www/usg-updates/ user@192.168.1.164:/mnt/share/usg-updates/

echo "✅ 版本 $VERSION 部署完成"
```

---

## 灰度发布

### 为什么需要灰度发布？

对于企业级防火墙管理工具，灰度发布可以：
- 降低大规模更新风险
- 提前发现潜在问题
- 给用户足够的适应时间
- 保障关键业务稳定性

### 实施策略

#### 阶段1: 内部测试（1-3天）
- **对象:** 开发团队和测试设备
- **规模:** 2-3台设备
- **目标:** 验证基本功能

#### 阶段2: 小范围试点（3-5天）
- **对象:** 非关键业务设备
- **规模:** 10-20% 设备
- **目标:** 验证稳定性

#### 阶段3: 扩大范围（5-7天）
- **对象:** 大部分设备
- **规模:** 50-70% 设备
- **目标:** 全面验证

#### 阶段4: 全量发布
- **对象:** 所有设备
- **规模:** 100%
- **目标:** 完成升级

### 简单实现方案

#### 方案1: 基于时间的灰度

```json
// latest.json
{
  "version": "1.0.8",
  "releaseDate": "2025-11-10",
  "rolloutStart": "2025-11-10T00:00:00Z",
  "rolloutPhases": [
    { "date": "2025-11-10", "percentage": 10 },
    { "date": "2025-11-13", "percentage": 50 },
    { "date": "2025-11-17", "percentage": 100 }
  ]
}
```

客户端逻辑：
```typescript
function shouldUpdate(currentVersion, latestInfo) {
  // 找到当前日期对应的灰度比例
  const today = new Date();
  let percentage = 0;
  
  for (const phase of latestInfo.rolloutPhases) {
    if (new Date(phase.date) <= today) {
      percentage = phase.percentage;
    }
  }
  
  // 基于用户ID生成随机数（0-100）
  const userId = getUserId(); // 机器唯一标识
  const random = hashToNumber(userId) % 100;
  
  return random < percentage;
}
```

#### 方案2: 配置文件控制

```json
// rollout-config.json（独立配置文件）
{
  "v1.0.8": {
    "enabled": true,
    "percentage": 50,
    "whitelist": [
      "device-001",
      "device-002"
    ],
    "blacklist": [
      "device-999"
    ]
  }
}
```

---

## 故障处理

### 常见问题

#### 1. 检查更新失败

**症状:**
```
[ERROR] 所有更新服务器均无法访问
```

**原因:**
- 网络连接问题
- 服务器宕机
- 防火墙拦截

**解决方法:**
```bash
# 1. 检查服务器状态
curl http://shcrystal.top:8123/updates/latest.json

# 2. 检查防火墙
sudo ufw status
sudo firewall-cmd --list-all

# 3. 检查 Nginx 状态
sudo systemctl status nginx

# 4. 查看错误日志
sudo tail -f /var/log/nginx/error.log
```

#### 2. 下载失败

**症状:**
```
[ERROR] 下载失败，已重试3次
```

**原因:**
- 网络不稳定
- 磁盘空间不足
- 下载链接错误

**解决方法:**
```typescript
// 客户端检查
const tempDir = app.getPath('temp');
const diskSpace = await getDiskSpace(tempDir);
console.log('可用空间:', diskSpace);

// 服务器检查
df -h /var/www/usg-updates
```

#### 3. 校验失败

**症状:**
```
[ERROR] 文件校验失败，SHA256不匹配
```

**原因:**
- 文件在传输过程中损坏
- 服务器文件损坏
- latest.json 中的 SHA-256 错误

**解决方法:**
```bash
# 重新计算服务器文件 SHA-256
cd /var/www/usg-updates/v1.0.8
sha256sum USG-NAT-Manager-Setup-1.0.8.exe

# 更新 latest.json
nano /var/www/usg-updates/latest.json
```

#### 4. 安装失败

**症状:**
- 安装程序无法启动
- 安装过程中断

**解决方法:**
```
1. 检查备份是否创建成功
2. 从备份恢复数据
3. 手动下载安装包重新安装
```

### 紧急回滚

#### 服务端回滚

```bash
# 1. 备份当前 latest.json
cp /var/www/usg-updates/latest.json /var/www/usg-updates/latest.json.bak

# 2. 恢复到上一版本
cat > /var/www/usg-updates/latest.json <<EOF
{
  "version": "1.0.7",
  "releaseDate": "2025-11-01",
  "downloadUrl": "v1.0.7/USG-NAT-Manager-Setup-1.0.7.exe",
  "sha256": "...",
  "fileSize": 104857600,
  "mandatory": false,
  "changelog": ["回滚到稳定版本 1.0.7"]
}
EOF

# 3. 通知用户
echo "已回滚到 v1.0.7" | mail -s "更新回滚通知" admin@company.com
```

#### 客户端恢复

```
1. 打开应用
2. 进入 "设置" -> "数据备份"
3. 选择更新前的备份
4. 点击"恢复"
5. 重启应用
```

---

## 开发计划

### 已完成 ✅

- [x] CustomUpdater 核心模块
- [x] 多服务器冗余机制
- [x] SHA-256 完整性校验
- [x] 自动备份系统
- [x] 智能重试机制
- [x] 定期自动检查
- [x] IPC 通信协议
- [x] 基础服务端部署

### 待优化 📝

- [ ] 前端更新 UI 组件（参考 UPDATE_IMPLEMENTATION_SUMMARY.md）
- [ ] 灰度发布功能实现
- [ ] 后台管理系统（版本管理、统计分析）
- [ ] 更新统计和分析
- [ ] HTTPS 部署
- [ ] CDN 加速
- [ ] 增量更新支持

---

## 总结

### 技术优势

| 特性 | electron-updater | 自研系统 |
|------|-----------------|---------|
| 开发成本 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ |
| 灵活性 | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| 安全性 | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| 服务器控制 | ⭐⭐ | ⭐⭐⭐⭐⭐ |
| 企业部署 | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| 多服务器 | ❌ | ✅ |
| 自动备份 | ❌ | ✅ |
| 灰度发布 | ⭐⭐ | ⭐⭐⭐⭐⭐ |

### 适用场景

**选择自研系统的理由:**
- ✅ 企业内部工具，需要完全控制
- ✅ 需要内外网双部署
- ✅ 对安全性要求高
- ✅ 需要自动备份和回滚
- ✅ 需要精细的灰度控制
- ✅ 不希望暴露服务器地址

---

## 相关文档

- [UPDATE_IMPLEMENTATION_SUMMARY.md](UPDATE_IMPLEMENTATION_SUMMARY.md) - 客户端实施总结
- [ADMIN_SYSTEM_GUIDE.md](ADMIN_SYSTEM_GUIDE.md) - 管理后台使用指南
- [ADMIN_SYSTEM_SUMMARY.md](ADMIN_SYSTEM_SUMMARY.md) - 管理后台功能总结
- [../README.md](../../README.md) - 项目主文档
- [DEPLOYMENT-GUIDE.md](../../DEPLOYMENT-GUIDE.md) - 完整部署指南

---

**文档维护:**
- **作者:** USG NAT Manager 开发团队
- **当前版本:** v1.0.7
- **更新服务器:** http://shcrystal.top:8123/updates/
- **备用服务器:** http://192.168.1.164/updates/
- **版本历史:**
  - v1.0 (2025-11-05): 根据实际实现重写文档

**参考资料:**
- [Electron 文档](https://www.electronjs.org/)
- [Nginx 文档](https://nginx.org/en/docs/)
- [Node.js Crypto](https://nodejs.org/api/crypto.html)
