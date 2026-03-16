# GitHub 仓库配置指南

## 前置条件

1. ✅ GitHub账号已登录
2. ✅ 已在GitHub上创建仓库（如果还没有，请先在GitHub网站创建）

## 配置步骤

### 方法一：使用PowerShell脚本（推荐）

```powershell
# 在项目根目录执行
.\scripts\setup-github.ps1 -GitHubUser 你的GitHub用户名 -RepoName 仓库名

# 示例
.\scripts\setup-github.ps1 -GitHubUser crystal -RepoName usg-nat-manager
```

### 方法二：手动配置

```powershell
# 1. 添加远程仓库
git remote add origin https://github.com/你的用户名/仓库名.git

# 或者如果已存在，更新远程仓库地址
git remote set-url origin https://github.com/你的用户名/仓库名.git

# 2. 验证配置
git remote -v
```

### 方法三：使用SSH（如果已配置SSH密钥）

```powershell
# 使用SSH方式连接（更安全，无需每次输入密码）
git remote add origin git@github.com:你的用户名/仓库名.git
```

## 上传代码

配置完成后，执行以下命令上传代码：

```powershell
# 1. 切换到项目目录
cd "D:\Coding Project\usg-nat-manager\USG1.0.7"

# 2. 添加所有更改
git add .

# 3. 提交更改
git commit -m "Initial commit: USG NAT Manager v1.1.5"

# 4. 推送到GitHub
git push -u origin main
```

## 常见问题

### 1. 推送时提示需要身份验证

**解决方案：**
- 使用Personal Access Token (PAT)
- 或配置SSH密钥

### 2. 分支名称不匹配

如果本地分支是 `master` 而远程是 `main`：

```powershell
# 重命名本地分支
git branch -M main

# 然后推送
git push -u origin main
```

### 3. 推送被拒绝

如果远程仓库已有内容：

```powershell
# 先拉取远程内容
git pull origin main --allow-unrelated-histories

# 解决冲突后再推送
git push -u origin main
```

## 后续使用

配置完成后，日常推送代码：

```powershell
git add .
git commit -m "提交信息"
git push
```




