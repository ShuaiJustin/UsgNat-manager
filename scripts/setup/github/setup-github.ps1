# GitHub repository setup script (PowerShell)
# Usage: .\scripts\setup\github\setup-github.ps1 -GitHubUser <GitHubUser> -RepoName <RepoName>

param(
    [Parameter(Mandatory = $true)]
    [string]$GitHubUser,

    [Parameter(Mandatory = $true)]
    [string]$RepoName
)

$RepoUrl = "https://github.com/${GitHubUser}/${RepoName}.git"

Write-Host "Configuring GitHub remote..." -ForegroundColor Green
Write-Host "Repository URL: $RepoUrl" -ForegroundColor Cyan

try {
    $existingUrl = git remote get-url origin 2>$null
    if ($existingUrl) {
        Write-Host "Existing origin detected, updating remote URL..." -ForegroundColor Yellow
        git remote set-url origin $RepoUrl
    }
} catch {
    Write-Host "No origin remote found, adding a new one..." -ForegroundColor Yellow
    git remote add origin $RepoUrl
}

Write-Host ""
Write-Host "Current remotes:" -ForegroundColor Green
git remote -v

Write-Host ""
Write-Host "GitHub remote configuration is complete." -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "1. Confirm the GitHub repository exists: $RepoName"
Write-Host "2. Stage changes: git add ."
Write-Host "3. Commit changes: git commit -m 'Initial commit'"
Write-Host "4. Push to GitHub: git push -u origin main"
