#!/bin/bash
# GitHub 仓库配置脚本
# 使用方法: bash scripts/setup-github.sh <GitHub用户名> <仓库名>

if [ -z "$1" ] || [ -z "$2" ]; then
    echo "使用方法: bash scripts/setup-github.sh <GitHub用户名> <仓库名>"
    echo "示例: bash scripts/setup-github.sh crystal usg-nat-manager"
    exit 1
fi

GITHUB_USER=$1
REPO_NAME=$2
REPO_URL="https://github.com/${GITHUB_USER}/${REPO_NAME}.git"

echo "正在配置GitHub远程仓库..."
echo "仓库地址: ${REPO_URL}"

# 检查是否已经存在远程仓库
if git remote get-url origin >/dev/null 2>&1; then
    echo "检测到已存在的远程仓库，正在更新..."
    git remote set-url origin ${REPO_URL}
else
    echo "添加新的远程仓库..."
    git remote add origin ${REPO_URL}
fi

# 验证配置
echo ""
echo "当前远程仓库配置:"
git remote -v

echo ""
echo "✅ GitHub远程仓库配置完成！"
echo ""
echo "下一步操作:"
echo "1. 确保GitHub上已创建仓库: ${REPO_NAME}"
echo "2. 添加所有更改: git add ."
echo "3. 提交更改: git commit -m 'Initial commit'"
echo "4. 推送到GitHub: git push -u origin main"




