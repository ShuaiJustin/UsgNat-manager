# 版本号更新工具使用说明

## 功能说明

这个脚本可以一键更新软件的所有版本号，包括：

1. ✅ `package.json` 中的版本号
2. ✅ 设置页面显示的版本号 (`src/renderer/pages/Settings/index.tsx`)

## 使用方法

### 方法一：使用 npm 命令（推荐）

```bash
# 方式 1：直接指定版本号
npm run version:update 1.0.8

# 方式 2：交互式输入
npm run version:update
```

### 方法二：直接运行脚本

```bash
# 指定版本号
node scripts/update-version.js 1.0.8

# 或交互式输入
node scripts/update-version.js
```

## 版本号格式

支持以下格式：
- `1.0.8` ✅
- `v1.0.8` ✅（自动移除 v 前缀）

## 使用示例

### 示例 1：快速更新

```bash
npm run version:update 1.0.8
```

输出：
```
========================================
   USG NAT Manager 版本号更新工具
========================================

当前版本: 1.0.7

准备将版本号更新为: 1.0.8

开始更新...

✅ package.json: 1.0.7 → 1.0.8
✅ Settings 页面: V1.0.6 → V1.0.8

========================================
✅ 版本号更新完成！(2/2)

新版本号: 1.0.8

建议执行以下命令：
  npm run build      # 重新构建
  npm run package    # 打包发布
========================================
```

### 示例 2：交互式更新

```bash
npm run version:update
```

会提示：
```
当前版本: 1.0.7

请输入新版本号 (例如: 1.0.8 或 v1.0.8): 1.0.8
确认更新？(y/n): y
```

## 完整发布流程

```bash
# 1. 更新版本号
npm run version:update 1.0.8

# 2. 重新构建
npm run build

# 3. 打包发布（Windows）
npm run package:win

# 4. 检查生成的安装包
# 文件位置：release/USG-NAT-Manager-Setup-1.0.8.exe
```

## 注意事项

1. **备份数据**：更新前建议先提交代码到 Git
2. **版本规范**：遵循语义化版本号规则 (major.minor.patch)
3. **测试验证**：更新后务必测试应用是否正常运行
4. **文档同步**：如有必要，同步更新 README.md 等文档

## 错误处理

### 版本号格式错误

```
❌ 版本号格式错误！请使用 x.x.x 格式 (例如: 1.0.8)
```

**解决方法**：确保版本号是 `1.0.8` 这种格式

### 文件读取失败

```
❌ 更新 package.json 失败: ENOENT: no such file or directory
```

**解决方法**：确保在项目根目录执行命令

## 脚本位置

- 主脚本：`scripts/update-version.js`
- 说明文档：`scripts/VERSION-UPDATE-README.md`

## 版本号位置汇总

当前脚本会自动更新以下位置：

| 文件 | 位置 | 格式 |
|------|------|------|
| `package.json` | 第 3 行 | `"version": "1.0.8"` |
| `Settings/index.tsx` | 第 855 行 | `V1.0.8` |

## 后续优化建议

- [ ] 自动更新 CHANGELOG.md
- [ ] 自动创建 Git tag
- [ ] 自动提交版本号变更
- [ ] 支持回退到上一版本

## 技术支持

如有问题，请联系开发团队。

