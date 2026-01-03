# GitHub 仓库配置脚本 (PowerShell版本)
# 使用方法: .\scripts\setup-github.ps1 -GitHubUser <GitHub用户名> -RepoName <仓库名>

param(
    [Parameter(Mandatory=$true)]
    [string]$GitHubUser,
    
    [Parameter(Mandatory=$true)]
    [string]$RepoName
)

$RepoUrl = "https://github.com/${GitHubUser}/${RepoName}.git"

Write-Host "正在配置GitHub远程仓库..." -ForegroundColor Green
Write-Host "仓库地址: $RepoUrl" -ForegroundColor Cyan

# 检查是否已经存在远程仓库
try {
    $existingUrl = git remote get-url origin 2>$null
    if ($existingUrl) {
        Write-Host "检测到已存在的远程仓库，正在更新..." -ForegroundColor Yellow
        git remote set-url origin $RepoUrl
    }
} catch {
    Write-Host "添加新的远程仓库..." -ForegroundColor Yellow
    git remote add origin $RepoUrl
}

# 验证配置
Write-Host ""
Write-Host "当前远程仓库配置:" -ForegroundColor Green
git remote -v

Write-Host ""
Write-Host "✅ GitHub远程仓库配置完成！" -ForegroundColor Green
Write-Host ""
Write-Host "下一步操作:" -ForegroundColor Yellow
Write-Host "1. 确保GitHub上已创建仓库: $RepoName"
Write-Host "2. 添加所有更改: git add ."
Write-Host "3. 提交更改: git commit -m 'Initial commit'"
Write-Host "4. 推送到GitHub: git push -u origin main"


