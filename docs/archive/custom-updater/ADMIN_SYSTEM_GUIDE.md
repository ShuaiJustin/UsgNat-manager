# USG NAT Manager 更新服务器部署和管理指南

## 📖 文档概述

本文档提供 USG NAT Manager 更新服务器的完整部署和管理指南。对于企业内部工具，我们采用简单可靠的静态文件服务器方案，无需复杂的后台管理系统。

**适用场景:**
- Linux 服务器（推荐 Ubuntu 22.04 / CentOS 8+ / Alma Linux 9）
- Windows Server 2019/2022
- 内网 + 公网双部署

**服务器地址:**
- 主服务器：http://shcrystal.top:8123/updates/
- 备用服务器：http://192.168.1.164/updates/

**当前版本:** v1.0.7

---

## 📋 目录

1. [服务器准备](#服务器准备)
2. [Nginx 部署](#nginx-部署)
3. [文件管理](#文件管理)
4. [版本发布](#版本发布)
5. [自动化脚本](#自动化脚本)
6. [备份和恢复](#备份和恢复)
7. [监控和维护](#监控和维护)
8. [安全配置](#安全配置)
9. [故障排查](#故障排查)

---

## 服务器准备

### 系统要求

#### 最低配置
- **CPU:** 1 核
- **内存:** 1GB RAM
- **硬盘:** 20GB（根据版本数量调整）
- **网络:** 稳定的网络连接

#### 推荐配置
- **CPU:** 2 核
- **内存:** 2GB RAM
- **硬盘:** 50GB SSD
- **网络:** 10Mbps+ 带宽

### Linux 服务器安装

#### Ubuntu/Debian 系统

```bash
# 1. 更新系统
sudo apt update
sudo apt upgrade -y

# 2. 安装 Nginx
sudo apt install nginx -y

# 3. 安装必要工具
sudo apt install curl wget nano vim ufw -y

# 4. 启动 Nginx
sudo systemctl start nginx
sudo systemctl enable nginx

# 5. 验证安装
nginx -v
```

#### CentOS/RHEL/Alma Linux 系统

```bash
# 1. 更新系统
sudo dnf update -y

# 2. 安装 Nginx
sudo dnf install nginx -y

# 3. 安装必要工具
sudo dnf install curl wget nano vim firewalld -y

# 4. 启动 Nginx
sudo systemctl start nginx
sudo systemctl enable nginx

# 5. 验证安装
nginx -v
```

### Windows Server 部署

#### 方式1: 使用 IIS

```powershell
# 1. 启用 IIS
Enable-WindowsOptionalFeature -Online -FeatureName IIS-WebServerRole -All

# 2. 安装 URL Rewrite（可选）
# 下载地址: https://www.iis.net/downloads/microsoft/url-rewrite

# 3. 创建站点目录
New-Item -Path "C:\inetpub\usg-updates" -ItemType Directory

# 4. 创建站点
Import-Module WebAdministration
New-Website -Name "USG-Updates" `
            -Port 8123 `
            -PhysicalPath "C:\inetpub\usg-updates"

# 5. 启动站点
Start-Website -Name "USG-Updates"
```

#### 方式2: 使用 Nginx for Windows

```powershell
# 1. 下载 Nginx
# https://nginx.org/download/nginx-1.24.0.zip

# 2. 解压到 C:\nginx

# 3. 修改配置（参考下面的 Nginx 配置）

# 4. 启动 Nginx
C:\nginx\nginx.exe

# 5. 注册为 Windows 服务（使用 NSSM）
# https://nssm.cc/download
```

---

## Nginx 部署

### 创建目录结构

```bash
# 创建更新文件根目录
sudo mkdir -p /var/www/usg-updates

# 设置权限
sudo chown -R www-data:www-data /var/www/usg-updates  # Ubuntu/Debian
# 或
sudo chown -R nginx:nginx /var/www/usg-updates        # CentOS/RHEL

# 创建版本目录
cd /var/www/usg-updates
sudo mkdir -p v1.0.7 v1.0.8 archive

# 目录结构
# /var/www/usg-updates/
# ├── latest.json              # 最新版本信息
# ├── v1.0.7/                  # 版本目录
# │   ├── USG-NAT-Manager-Setup-1.0.7.exe
# │   ├── USG-NAT-Manager-Portable-1.0.7.exe
# │   ├── manifest.json
# │   ├── changelog.json
# │   └── SHA256SUMS.txt
# ├── v1.0.8/
# │   └── ...
# └── archive/                 # 历史版本归档
#     ├── v1.0.5/
#     └── v1.0.6/
```

### Nginx 配置文件

#### 完整配置

创建配置文件：`/etc/nginx/sites-available/usg-updates`

```nginx
# USG NAT Manager 更新服务器配置
server {
    listen 8123;
    server_name shcrystal.top;
    
    # 根目录
    root /var/www/usg-updates;
    
    # 字符集
    charset utf-8;
    
    # 日志
    access_log /var/log/nginx/usg-updates-access.log;
    error_log /var/log/nginx/usg-updates-error.log;
    
    # CORS 配置（允许客户端跨域访问）
    add_header 'Access-Control-Allow-Origin' '*' always;
    add_header 'Access-Control-Allow-Methods' 'GET, HEAD, OPTIONS' always;
    add_header 'Access-Control-Allow-Headers' 'Range' always;
    add_header 'Access-Control-Expose-Headers' 'Content-Length, Content-Range' always;
    
    # 处理 OPTIONS 请求
    if ($request_method = 'OPTIONS') {
        return 204;
    }
    
    # 大文件配置
    client_max_body_size 500M;
    client_body_timeout 600s;
    send_timeout 600s;
    
    # 安装包文件 - 长时间缓存
    location ~* \.(exe|dmg|zip|tar\.gz)$ {
        # 缓存1天
        expires 1d;
        add_header Cache-Control "public, immutable";
        
        # 支持断点续传
        add_header Accept-Ranges bytes;
        
        # 禁止目录列表
        autoindex off;
    }
    
    # JSON 文件 - 短时间缓存
    location ~* \.(json)$ {
        # 缓存5分钟
        expires 5m;
        add_header Cache-Control "public, must-revalidate";
        
        # 允许目录列表（方便查看）
        autoindex on;
    }
    
    # 文本文件
    location ~* \.(txt|md)$ {
        # 缓存10分钟
        expires 10m;
        add_header Cache-Control "public";
    }
    
    # 根目录和版本目录 - 启用目录索引
    location / {
        autoindex on;                    # 启用目录列表
        autoindex_exact_size off;        # 显示友好的文件大小
        autoindex_localtime on;          # 显示本地时间
        
        # 默认索引文件
        index index.html index.htm;
    }
    
    # 禁止访问隐藏文件
    location ~ /\. {
        deny all;
        access_log off;
        log_not_found off;
    }
    
    # 禁止访问备份文件
    location ~ ~$ {
        deny all;
        access_log off;
        log_not_found off;
    }
    
    # 健康检查端点
    location /health {
        access_log off;
        return 200 "healthy\n";
        add_header Content-Type text/plain;
    }
}
```

#### 启用配置

```bash
# 1. 创建软链接
sudo ln -s /etc/nginx/sites-available/usg-updates /etc/nginx/sites-enabled/

# 2. 测试配置
sudo nginx -t

# 3. 重新加载 Nginx
sudo systemctl reload nginx

# 4. 查看状态
sudo systemctl status nginx
```

### 防火墙配置

#### Ubuntu/Debian (UFW)

```bash
# 允许 Nginx 端口
sudo ufw allow 8123/tcp

# 或允许 Nginx Full（80, 443, 8123）
sudo ufw allow 'Nginx Full'

# 启用防火墙
sudo ufw enable

# 查看状态
sudo ufw status
```

#### CentOS/RHEL/Alma (Firewalld)

```bash
# 开放端口
sudo firewall-cmd --permanent --add-port=8123/tcp

# 重新加载
sudo firewall-cmd --reload

# 查看规则
sudo firewall-cmd --list-all
```

#### Windows Server 防火墙

```powershell
# 添加入站规则
New-NetFirewallRule -DisplayName "USG Updates" `
                    -Direction Inbound `
                    -LocalPort 8123 `
                    -Protocol TCP `
                    -Action Allow
```

---

## 文件管理

### 版本文件命名规范

```
USG-NAT-Manager-Setup-{version}.exe       # Windows 安装包
USG-NAT-Manager-Portable-{version}.exe    # Windows 便携版
USG-NAT-Manager-{version}-mac-x64.dmg     # macOS Intel 版本
USG-NAT-Manager-{version}-mac-arm64.dmg   # macOS Apple Silicon 版本
USG-NAT-Manager-{version}-linux-x64.tar.gz # Linux 版本
```

示例：
```
USG-NAT-Manager-Setup-1.0.8.exe
USG-NAT-Manager-Portable-1.0.8.exe
```

### 必需文件

每个版本目录必须包含：

#### 1. latest.json（根目录）

```json
{
  "version": "1.0.8",
  "releaseDate": "2025-11-10",
  "downloadUrl": "v1.0.8/USG-NAT-Manager-Setup-1.0.8.exe",
  "sha256": "a3f7b8c9d2e1f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9",
  "fileSize": 104857600,
  "mandatory": false,
  "changelog": [
    {
      "type": "feature",
      "description": "新增 IPv6 NAT 规则支持"
    },
    {
      "type": "improve",
      "description": "优化 SSH 连接稳定性"
    },
    {
      "type": "fix",
      "description": "修复设备掉线问题"
    }
  ],
  "minimumVersion": "1.0.0"
}
```

#### 2. manifest.json（版本目录）

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
  "releaseNotes": "详见 changelog.json"
}
```

#### 3. changelog.json（版本目录）

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
      "type": "improve",
      "title": "SSH 连接优化",
      "description": "优化 SSH 连接池管理，提升并发连接稳定性"
    },
    {
      "type": "fix",
      "title": "修复设备掉线问题",
      "description": "修复长时间运行后部分设备显示掉线的问题"
    }
  ],
  "breaking": false,
  "upgradeNotes": "本次更新建议所有用户升级"
}
```

#### 4. SHA256SUMS.txt（版本目录）

```txt
a3f7b8c9d2e1f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9  USG-NAT-Manager-Setup-1.0.8.exe
b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5  USG-NAT-Manager-Portable-1.0.8.exe
```

---

## 版本发布

### 手动发布流程

#### 1. 准备文件

```bash
# 在本地构建项目
cd /path/to/USG1.0.2
npm run build
npm run package:win

# 构建产物位于 release/ 目录
# release/
# ├── USG-NAT-Manager-Setup-1.0.8.exe
# ├── USG-NAT-Manager-Portable-1.0.8.exe
# └── ...
```

#### 2. 上传到服务器

```bash
# 使用 scp 上传
scp release/USG-NAT-Manager-Setup-1.0.8.exe \
    user@shcrystal.top:/var/www/usg-updates/v1.0.8/

scp release/USG-NAT-Manager-Portable-1.0.8.exe \
    user@shcrystal.top:/var/www/usg-updates/v1.0.8/

# 或使用 rsync（推荐）
rsync -avz --progress \
      release/*.exe \
      user@shcrystal.top:/var/www/usg-updates/v1.0.8/
```

#### 3. 计算 SHA-256

```bash
# SSH 登录服务器
ssh user@shcrystal.top

# 进入版本目录
cd /var/www/usg-updates/v1.0.8

# 计算所有 exe 文件的 SHA-256
sha256sum *.exe > SHA256SUMS.txt

# 查看结果
cat SHA256SUMS.txt

# 提取单个文件的哈希（用于 latest.json）
sha256sum USG-NAT-Manager-Setup-1.0.8.exe | cut -d' ' -f1
```

#### 4. 创建 manifest.json

```bash
cd /var/www/usg-updates/v1.0.8

cat > manifest.json <<'EOF'
{
  "version": "1.0.8",
  "buildDate": "2025-11-10T08:30:00Z",
  "buildNumber": 108,
  "files": [
    {
      "name": "USG-NAT-Manager-Setup-1.0.8.exe",
      "size": 104857600,
      "sha256": "替换为实际的SHA256",
      "type": "installer"
    },
    {
      "name": "USG-NAT-Manager-Portable-1.0.8.exe",
      "size": 105906176,
      "sha256": "替换为实际的SHA256",
      "type": "portable"
    }
  ],
  "dependencies": {
    "electron": "28.1.0",
    "node": "18.17.0"
  },
  "releaseNotes": "详见 changelog.json"
}
EOF

# 编辑文件，替换 SHA256 和 size
nano manifest.json
```

#### 5. 创建 changelog.json

```bash
cat > changelog.json <<'EOF'
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
      "type": "improve",
      "title": "SSH 连接优化",
      "description": "优化 SSH 连接池管理，提升并发连接稳定性"
    },
    {
      "type": "fix",
      "title": "修复设备掉线问题",
      "description": "修复长时间运行后部分设备显示掉线的问题"
    }
  ],
  "breaking": false,
  "upgradeNotes": "本次更新建议所有用户升级"
}
EOF
```

#### 6. 更新 latest.json

```bash
cd /var/www/usg-updates

# 备份旧版本
cp latest.json latest.json.bak

# 创建新的 latest.json
cat > latest.json <<'EOF'
{
  "version": "1.0.8",
  "releaseDate": "2025-11-10",
  "downloadUrl": "v1.0.8/USG-NAT-Manager-Setup-1.0.8.exe",
  "sha256": "替换为实际的SHA256",
  "fileSize": 104857600,
  "mandatory": false,
  "changelog": [
    {
      "type": "feature",
      "description": "新增 IPv6 NAT 规则支持"
    },
    {
      "type": "improve",
      "description": "优化 SSH 连接稳定性"
    },
    {
      "type": "fix",
      "description": "修复设备掉线问题"
    }
  ],
  "minimumVersion": "1.0.0"
}
EOF

# 编辑文件
nano latest.json
```

#### 7. 验证发布

```bash
# 测试访问
curl http://shcrystal.top:8123/updates/latest.json

# 测试下载
curl -I http://shcrystal.top:8123/updates/v1.0.8/USG-NAT-Manager-Setup-1.0.8.exe
```

---

## 自动化脚本

### 部署脚本

创建文件：`/opt/scripts/deploy-usg-update.sh`

```bash
#!/bin/bash
#
# USG NAT Manager 更新部署脚本
# 用法: ./deploy-usg-update.sh <版本号> <安装包路径>
#
# 示例: ./deploy-usg-update.sh 1.0.8 /path/to/USG-NAT-Manager-Setup-1.0.8.exe

set -e

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 配置
UPDATE_ROOT="/var/www/usg-updates"
BACKUP_DIR="/var/backups/usg-updates"

# 检查参数
if [ $# -lt 2 ]; then
    echo -e "${RED}错误: 参数不足${NC}"
    echo "用法: $0 <版本号> <安装包路径>"
    echo "示例: $0 1.0.8 /path/to/USG-NAT-Manager-Setup-1.0.8.exe"
    exit 1
fi

VERSION=$1
INSTALLER_PATH=$2
VERSION_DIR="$UPDATE_ROOT/v$VERSION"

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  USG NAT Manager 更新部署脚本${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""

# 检查文件是否存在
if [ ! -f "$INSTALLER_PATH" ]; then
    echo -e "${RED}错误: 安装包文件不存在: $INSTALLER_PATH${NC}"
    exit 1
fi

FILENAME=$(basename "$INSTALLER_PATH")
echo -e "${YELLOW}版本号:${NC} $VERSION"
echo -e "${YELLOW}文件名:${NC} $FILENAME"
echo ""

# 1. 创建版本目录
echo -e "${GREEN}[1/7] 创建版本目录...${NC}"
mkdir -p "$VERSION_DIR"

# 2. 复制安装包
echo -e "${GREEN}[2/7] 复制安装包...${NC}"
cp "$INSTALLER_PATH" "$VERSION_DIR/"

# 3. 计算 SHA-256
echo -e "${GREEN}[3/7] 计算 SHA-256...${NC}"
cd "$VERSION_DIR"
SHA256=$(sha256sum "$FILENAME" | cut -d' ' -f1)
FILE_SIZE=$(stat -c%s "$FILENAME" 2>/dev/null || stat -f%z "$FILENAME")

echo "SHA-256: $SHA256"
echo "文件大小: $FILE_SIZE 字节"

# 保存到文件
sha256sum *.exe > SHA256SUMS.txt

# 4. 创建 manifest.json
echo -e "${GREEN}[4/7] 创建 manifest.json...${NC}"
cat > manifest.json <<EOF
{
  "version": "$VERSION",
  "buildDate": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "buildNumber": $(echo $VERSION | tr -d '.' | sed 's/^0*//'),
  "files": [
    {
      "name": "$FILENAME",
      "size": $FILE_SIZE,
      "sha256": "$SHA256",
      "type": "installer"
    }
  ],
  "dependencies": {
    "electron": "28.1.0",
    "node": "18.17.0"
  },
  "releaseNotes": "详见 changelog.json"
}
EOF

# 5. 创建 changelog.json 模板
echo -e "${GREEN}[5/7] 创建 changelog.json 模板...${NC}"
cat > changelog.json <<EOF
{
  "version": "$VERSION",
  "releaseDate": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "changes": [
    {
      "type": "feature",
      "title": "新功能",
      "description": "请手动编辑此文件添加更新说明"
    }
  ],
  "breaking": false,
  "upgradeNotes": "请手动编辑升级说明"
}
EOF

echo -e "${YELLOW}⚠️  请手动编辑 $VERSION_DIR/changelog.json 添加更新说明${NC}"

# 6. 备份旧的 latest.json
echo -e "${GREEN}[6/7] 备份配置...${NC}"
if [ -f "$UPDATE_ROOT/latest.json" ]; then
    mkdir -p "$BACKUP_DIR"
    cp "$UPDATE_ROOT/latest.json" "$BACKUP_DIR/latest.json.$(date +%Y%m%d_%H%M%S)"
    echo "已备份: $BACKUP_DIR/latest.json.$(date +%Y%m%d_%H%M%S)"
fi

# 7. 更新 latest.json
echo -e "${GREEN}[7/7] 更新 latest.json...${NC}"
cat > "$UPDATE_ROOT/latest.json" <<EOF
{
  "version": "$VERSION",
  "releaseDate": "$(date +%Y-%m-%d)",
  "downloadUrl": "v$VERSION/$FILENAME",
  "sha256": "$SHA256",
  "fileSize": $FILE_SIZE,
  "mandatory": false,
  "changelog": [
    {
      "type": "feature",
      "description": "请手动编辑更新说明"
    }
  ],
  "minimumVersion": "1.0.0"
}
EOF

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  ✅ 部署完成！${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "${YELLOW}下一步操作:${NC}"
echo "1. 编辑 $VERSION_DIR/changelog.json 添加详细更新说明"
echo "2. 编辑 $UPDATE_ROOT/latest.json 添加简短更新说明"
echo "3. 验证访问: curl http://shcrystal.top:8123/updates/latest.json"
echo "4. 测试下载: curl -I http://shcrystal.top:8123/updates/v$VERSION/$FILENAME"
echo ""
echo -e "${YELLOW}版本信息:${NC}"
echo "  版本: $VERSION"
echo "  SHA-256: $SHA256"
echo "  文件大小: $(numfmt --to=iec-i --suffix=B $FILE_SIZE)"
echo ""
```

#### 使用方法

```bash
# 1. 赋予执行权限
chmod +x /opt/scripts/deploy-usg-update.sh

# 2. 执行部署
sudo /opt/scripts/deploy-usg-update.sh 1.0.8 /path/to/USG-NAT-Manager-Setup-1.0.8.exe

# 3. 根据提示编辑 changelog.json 和 latest.json
```

### 同步脚本（备份服务器）

创建文件：`/opt/scripts/sync-updates.sh`

```bash
#!/bin/bash
#
# 同步更新文件到备份服务器
# 每小时执行一次: 0 * * * * /opt/scripts/sync-updates.sh
#

SOURCE="user@shcrystal.top:/var/www/usg-updates/"
DEST="/mnt/share/usg-updates/"

echo "[$(date)] 开始同步更新文件..."

# 使用 rsync 同步
rsync -avz --delete \
  --exclude 'archive/' \
  --exclude '*.log' \
  --exclude '.DS_Store' \
  --exclude 'Thumbs.db' \
  $SOURCE $DEST

if [ $? -eq 0 ]; then
    echo "[$(date)] ✅ 同步完成"
else
    echo "[$(date)] ❌ 同步失败"
fi

echo ""
```

#### 添加 cron 任务

```bash
# 编辑 crontab
crontab -e

# 添加以下行（每小时同步一次）
0 * * * * /opt/scripts/sync-updates.sh >> /var/log/usg-update-sync.log 2>&1
```

---

## 备份和恢复

### 备份策略

#### 自动备份脚本

创建文件：`/opt/scripts/backup-updates.sh`

```bash
#!/bin/bash
#
# 备份更新文件
# 每天凌晨2点执行: 0 2 * * * /opt/scripts/backup-updates.sh
#

BACKUP_DIR="/var/backups/usg-updates"
SOURCE_DIR="/var/www/usg-updates"
DATE=$(date +%Y%m%d)
BACKUP_FILE="$BACKUP_DIR/usg-updates-$DATE.tar.gz"

echo "[$(date)] 开始备份..."

# 创建备份目录
mkdir -p "$BACKUP_DIR"

# 创建压缩包
tar -czf "$BACKUP_FILE" -C "$(dirname $SOURCE_DIR)" "$(basename $SOURCE_DIR)"

if [ $? -eq 0 ]; then
    echo "[$(date)] ✅ 备份完成: $BACKUP_FILE"
    echo "文件大小: $(du -h $BACKUP_FILE | cut -f1)"
    
    # 删除30天前的备份
    find "$BACKUP_DIR" -name "usg-updates-*.tar.gz" -mtime +30 -delete
    echo "[$(date)] 已清理30天前的备份"
else
    echo "[$(date)] ❌ 备份失败"
fi
```

#### 添加 cron 任务

```bash
crontab -e

# 每天凌晨2点备份
0 2 * * * /opt/scripts/backup-updates.sh >> /var/log/usg-update-backup.log 2>&1
```

### 恢复数据

```bash
# 查看可用备份
ls -lh /var/backups/usg-updates/

# 恢复备份
sudo tar -xzf /var/backups/usg-updates/usg-updates-20251110.tar.gz -C /var/www/

# 设置权限
sudo chown -R www-data:www-data /var/www/usg-updates

# 重启 Nginx
sudo systemctl reload nginx
```

---

## 监控和维护

### 日志监控

#### 查看访问日志

```bash
# 实时查看
tail -f /var/log/nginx/usg-updates-access.log

# 统计下载次数
grep "GET.*\.exe" /var/log/nginx/usg-updates-access.log | wc -l

# 统计各版本下载量
grep "GET.*v1.0.8.*\.exe" /var/log/nginx/usg-updates-access.log | wc -l

# 查看最近的下载（最近10次）
grep "GET.*\.exe" /var/log/nginx/usg-updates-access.log | tail -10

# 统计IP地址访问次数
awk '{print $1}' /var/log/nginx/usg-updates-access.log | sort | uniq -c | sort -rn | head -10
```

#### 查看错误日志

```bash
# 实时查看
tail -f /var/log/nginx/usg-updates-error.log

# 查看最近的错误
tail -50 /var/log/nginx/usg-updates-error.log
```

### 健康检查脚本

创建文件：`/opt/scripts/health-check.sh`

```bash
#!/bin/bash
#
# 更新服务器健康检查
# 每5分钟执行一次: */5 * * * * /opt/scripts/health-check.sh
#

SERVERS=(
  "http://shcrystal.top:8123/updates/latest.json"
  "http://192.168.1.164/updates/latest.json"
)

ERROR_COUNT=0

for server in "${SERVERS[@]}"; do
  response=$(curl -s -o /dev/null -w "%{http_code}" "$server" --max-time 10)
  
  if [ "$response" -eq 200 ]; then
    echo "[$(date)] ✅ $server - OK"
  else
    echo "[$(date)] ❌ $server - FAILED (HTTP $response)"
    ERROR_COUNT=$((ERROR_COUNT + 1))
  fi
done

# 如果所有服务器都失败，发送告警
if [ $ERROR_COUNT -eq ${#SERVERS[@]} ]; then
    echo "[$(date)] ⚠️  所有服务器都无法访问！"
    # 这里可以添加邮件或其他告警通知
fi
```

#### 添加 cron 任务

```bash
crontab -e

# 每5分钟检查一次
*/5 * * * * /opt/scripts/health-check.sh >> /var/log/usg-health-check.log 2>&1
```

### 磁盘空间监控

```bash
# 检查更新目录大小
du -sh /var/www/usg-updates/*

# 按版本统计
for dir in /var/www/usg-updates/v*/; do
  echo "$(basename $dir): $(du -sh $dir | cut -f1)"
done

# 清理旧版本（保留最近5个版本）
cd /var/www/usg-updates
ls -t | grep "^v" | tail -n +6 | xargs -I {} mv {} archive/
```

---

## 安全配置

### HTTPS 部署（推荐）

#### 使用 Let's Encrypt

```bash
# 1. 安装 Certbot
sudo apt install certbot python3-certbot-nginx -y  # Ubuntu
sudo dnf install certbot python3-certbot-nginx -y  # CentOS

# 2. 获取证书
sudo certbot --nginx -d shcrystal.top

# 3. 自动续期
sudo systemctl enable certbot-renew.timer
sudo systemctl start certbot-renew.timer

# 4. 测试自动续期
sudo certbot renew --dry-run
```

#### HTTPS Nginx 配置

```nginx
server {
    listen 443 ssl http2;
    server_name shcrystal.top;
    
    # SSL 证书
    ssl_certificate /etc/letsencrypt/live/shcrystal.top/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/shcrystal.top/privkey.pem;
    ssl_trusted_certificate /etc/letsencrypt/live/shcrystal.top/chain.pem;
    
    # SSL 配置
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers 'ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256';
    ssl_prefer_server_ciphers on;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;
    
    # 其他配置同上...
}

# HTTP 重定向到 HTTPS
server {
    listen 80;
    server_name shcrystal.top;
    return 301 https://$server_name$request_uri;
}
```

### 访问控制（可选）

```nginx
# IP 白名单
location /updates/ {
    allow 192.168.1.0/24;  # 内网
    allow 123.45.67.89;     # 公司公网IP
    deny all;
}

# 或使用 HTTP Basic Auth
location /updates/ {
    auth_basic "Restricted";
    auth_basic_user_file /etc/nginx/.htpasswd;
}
```

### 限流配置

```nginx
# 在 http 块中添加
limit_req_zone $binary_remote_addr zone=update_limit:10m rate=10r/m;

# 在 server 块中应用
location ~* \.(exe|dmg|zip)$ {
    limit_req zone=update_limit burst=5 nodelay;
}
```

---

## 故障排查

### 常见问题

#### 1. 无法访问更新服务器

**症状：** 客户端提示"所有更新服务器均无法访问"

**排查步骤：**

```bash
# 1. 检查 Nginx 状态
sudo systemctl status nginx

# 2. 检查端口是否监听
sudo netstat -tlnp | grep 8123
# 或
sudo ss -tlnp | grep 8123

# 3. 检查防火墙
sudo ufw status  # Ubuntu
sudo firewall-cmd --list-all  # CentOS

# 4. 测试本地访问
curl http://localhost:8123/updates/latest.json

# 5. 测试外部访问
curl http://shcrystal.top:8123/updates/latest.json

# 6. 查看错误日志
sudo tail -50 /var/log/nginx/error.log
```

#### 2. 下载速度慢

**原因可能是：**
- 服务器带宽不足
- 客户端网络问题
- Nginx 配置限制

**优化方法：**

```nginx
# 调整 Nginx 配置
worker_connections 1024;
keepalive_timeout 65;
client_body_buffer_size 128k;
client_max_body_size 500M;
sendfile on;
tcp_nopush on;
tcp_nodelay on;
```

#### 3. 文件损坏或校验失败

**排查步骤：**

```bash
# 1. 重新计算服务器文件 SHA-256
cd /var/www/usg-updates/v1.0.8
sha256sum USG-NAT-Manager-Setup-1.0.8.exe

# 2. 对比 latest.json 中的值
cat /var/www/usg-updates/latest.json | grep sha256

# 3. 如果不匹配，更新 latest.json
nano /var/www/usg-updates/latest.json

# 4. 如果文件本身损坏，重新上传
```

#### 4. 磁盘空间不足

```bash
# 检查磁盘使用情况
df -h

# 清理旧版本
cd /var/www/usg-updates
mv v1.0.5 archive/
mv v1.0.6 archive/

# 或删除非常旧的版本
rm -rf archive/v1.0.3
```

---

## 📚 相关文档

- [CUSTOM_UPDATE_SYSTEM_DESIGN.md](CUSTOM_UPDATE_SYSTEM_DESIGN.md) - 更新系统设计文档
- [UPDATE_IMPLEMENTATION_SUMMARY.md](UPDATE_IMPLEMENTATION_SUMMARY.md) - 客户端实施总结
- [ADMIN_SYSTEM_SUMMARY.md](ADMIN_SYSTEM_SUMMARY.md) - 服务器管理方案总结
- [../../README.md](../../README.md) - 项目主文档

---

**文档版本:** v1.0  
**最后更新:** 2025-11-05  
**维护团队:** USG NAT Manager 开发团队
