# 测试 API 服务器使用说明

## 📦 安装依赖

```bash
pip install fastapi uvicorn
```

## 🚀 启动服务器

### 方式 1：直接运行

```bash
python test_api_server.py
```

### 方式 2：使用 uvicorn（支持热重载）

```bash
uvicorn test_api_server:app --host 0.0.0.0 --port 8123 --reload
```

## 📡 访问地址

- **API 文档（Swagger）:** http://localhost:8123/docs
- **根路径:** http://localhost:8123/
- **统计摘要:** http://localhost:8123/api/v1/stats/summary

## 🧪 测试场景

### 1. 正常更新（默认）

```bash
curl -X POST http://localhost:8123/api/v1/test/scenario/normal
```

**客户端行为：**
- ✅ 显示更新对话框
- ✅ 提供"立即下载"按钮
- ✅ 可以下载和安装

### 2. 灰度阻止

```bash
curl -X POST http://localhost:8123/api/v1/test/scenario/rollout_blocked
```

**客户端行为：**
- ⚠️ 显示"新版本发布中"提示
- ❌ 不提供下载按钮
- ℹ️ 显示当前发布比例

### 3. 无更新

```bash
curl -X POST http://localhost:8123/api/v1/test/scenario/no_update
```

**客户端行为：**
- ℹ️ 显示"当前已是最新版本"
- ✅ 无需任何操作

### 4. 服务器错误

```bash
curl -X POST http://localhost:8123/api/v1/test/scenario/error
```

**客户端行为：**
- ❌ 显示"检查更新失败"
- ⚠️ 显示错误信息

## 🎲 灰度发布控制

### 启用灰度（10% 用户）

```bash
curl -X POST "http://localhost:8123/api/v1/test/rollout/enable?percentage=10"
```

### 启用灰度（50% 用户）

```bash
curl -X POST "http://localhost:8123/api/v1/test/rollout/enable?percentage=50"
```

### 禁用灰度

```bash
curl -X POST http://localhost:8123/api/v1/test/rollout/disable
```

## 📊 查看统计

### 使用浏览器

访问：http://localhost:8123/api/v1/stats/summary

### 使用 curl

```bash
curl http://localhost:8123/api/v1/stats/summary
```

**返回示例：**

```json
{
  "download_stats": {
    "total": 5,
    "started": 5,
    "completed": 4,
    "failed": 1,
    "recent": [...]
  },
  "install_stats": {
    "total": 3,
    "started": 3,
    "completed": 2,
    "failed": 1,
    "recent": [...]
  }
}
```

## 🔧 完整测试流程

### 步骤 1：启动测试服务器

```bash
python test_api_server.py
```

### 步骤 2：修改客户端服务器地址

在 `src/main/services/custom-updater.ts` 中：

```typescript
private updateServerUrls = [
  'http://localhost:8123',  // 测试地址
];
```

### 步骤 3：启动客户端

```bash
npm run dev
```

### 步骤 4：测试场景

#### 测试 1：正常更新 ✅

1. 切换场景：`POST /api/v1/test/scenario/normal`
2. 客户端：点击"帮助" → "检查更新"
3. **预期结果：** 显示更新对话框，可以下载

#### 测试 2：灰度阻止 ⚠️

1. 切换场景：`POST /api/v1/test/scenario/rollout_blocked`
2. 客户端：点击"帮助" → "检查更新"
3. **预期结果：** 显示"新版本发布中"提示，无下载按钮

#### 测试 3：无更新 ℹ️

1. 切换场景：`POST /api/v1/test/scenario/no_update`
2. 客户端：点击"帮助" → "检查更新"
3. **预期结果：** 显示"当前已是最新版本"

#### 测试 4：统计上报 📊

1. 切换场景：`POST /api/v1/test/scenario/normal`
2. 客户端：检查更新 → 下载更新
3. 查看服务器控制台输出
4. 访问：http://localhost:8123/api/v1/stats/summary
5. **预期结果：** 看到下载统计数据

## 💡 常见问题

### Q: 为什么客户端报错 "所有更新服务器均无法访问"？

**A:** 检查：
1. 测试服务器是否正在运行
2. 客户端服务器地址是否正确配置为 `http://localhost:8123`
3. 防火墙是否阻止了 8123 端口

### Q: 如何测试不同用户是否进入灰度名单？

**A:** 测试服务器使用用户ID的哈希值来决定。你可以：
1. 多次重启客户端（会生成不同的用户ID）
2. 调整灰度比例（如 50%）增加进入概率

### Q: 统计数据存储在哪里？

**A:** 测试服务器的统计数据存储在内存中，重启服务器后会清空。

### Q: 如何模拟下载失败？

**A:** 当前测试服务器不模拟下载过程。下载失败需要在客户端测试（如断网）。

## 🎨 使用 Swagger UI 测试

访问 http://localhost:8123/docs，可以：

1. 查看所有 API 接口
2. 在线测试 API
3. 查看请求/响应格式
4. 下载 OpenAPI 规范

**推荐使用 Swagger UI 进行快速测试！**

## 📝 日志输出

服务器会在控制台实时输出：

```
[检查更新] 收到请求:
  当前版本: 1.0.7
  平台: win32
  架构: x64
  用户ID: a1b2c3d4e5f6...
  渠道: stable
  测试场景: normal
  → 发现新版本: 1.0.8

[下载统计] 收到上报:
  用户ID: a1b2c3d4e5f6...
  版本: 1.0.7 → 1.0.8
  平台: win32/x64
  状态: started

[下载统计] 收到上报:
  用户ID: a1b2c3d4e5f6...
  版本: 1.0.7 → 1.0.8
  平台: win32/x64
  状态: completed

[安装统计] 收到上报:
  用户ID: a1b2c3d4e5f6...
  版本: 1.0.7 → 1.0.8
  平台: win32/x64
  状态: started
```

## 🚦 下一步

测试完成后：

1. **恢复生产服务器地址：**
   ```typescript
   private updateServerUrls = [
     'http://shcrystal.top:8123',
     'http://192.168.1.164:8123',
   ];
   ```

2. **构建生产版本：**
   ```bash
   npm run build
   npm run make
   ```

3. **部署到生产服务器**

---

**测试服务器版本:** v1.0  
**最后更新:** 2025-11-05  
**维护者:** USG 开发团队

