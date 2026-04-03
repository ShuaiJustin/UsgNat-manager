#!/bin/bash
# GitHub repository setup script
# Usage: bash scripts/setup/github/setup-github.sh <GitHubUser> <RepoName>

set -euo pipefail

if [ -z "${1:-}" ] || [ -z "${2:-}" ]; then
    echo "Usage: bash scripts/setup/github/setup-github.sh <GitHubUser> <RepoName>"
    echo "Example: bash scripts/setup/github/setup-github.sh crystal usg-nat-manager"
    exit 1
fi

GITHUB_USER=$1
REPO_NAME=$2
REPO_URL="https://github.com/${GITHUB_USER}/${REPO_NAME}.git"

echo "Configuring GitHub remote..."
echo "Repository URL: ${REPO_URL}"

if git remote get-url origin >/dev/null 2>&1; then
    echo "Existing origin detected, updating remote URL..."
    git remote set-url origin "${REPO_URL}"
else
    echo "No origin remote found, adding a new one..."
    git remote add origin "${REPO_URL}"
fi

echo ""
echo "Current remotes:"
git remote -v

echo ""
echo "GitHub remote configuration is complete."
echo ""
echo "Next steps:"
echo "1. Confirm the GitHub repository exists: ${REPO_NAME}"
echo "2. Stage changes: git add ."
echo "3. Commit changes: git commit -m 'Initial commit'"
echo "4. Push to GitHub: git push -u origin main"
