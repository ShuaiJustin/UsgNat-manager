# GitHub Setup Guide

## Prerequisites

1. You already created the target repository on GitHub.
2. You are running commands from the project root:

```powershell
cd "D:\Coding Project\usg-nat-manager\USG1.0.7"
```

## Option 1: PowerShell Script

```powershell
.\scripts\setup\github\setup-github.ps1 -GitHubUser crystal -RepoName usg-nat-manager
```

## Option 2: Shell Script

```bash
bash scripts/setup/github/setup-github.sh crystal usg-nat-manager
```

## Option 3: Manual Setup

```powershell
git remote add origin https://github.com/<GitHubUser>/<RepoName>.git
git remote -v
```

If `origin` already exists:

```powershell
git remote set-url origin https://github.com/<GitHubUser>/<RepoName>.git
git remote -v
```

## Push The Repository

```powershell
git add .
git commit -m "Initial commit"
git push -u origin main
```

## Notes

- If Git asks for authentication, use a Personal Access Token or SSH key.
- If your local default branch is `master`, rename it first with `git branch -M main`.
