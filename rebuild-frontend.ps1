# Rebuilds the production frontend bundle that run-app.ps1 / the EZView desktop
# shortcut serves from :8000. Run this after changing any frontend code —
# the launcher only builds automatically the very first time.
$ErrorActionPreference = 'Stop'
$root = Split-Path $MyInvocation.MyCommand.Path
$frontendDir = Join-Path $root "frontend"

Write-Host "==> Rebuilding EZView frontend..." -ForegroundColor Cyan
Push-Location $frontendDir
try {
    if (-not (Test-Path "node_modules")) {
        Write-Host "    Installing frontend dependencies (first run)..." -ForegroundColor Gray
        npm install
    }
    npm run build
} finally {
    Pop-Location
}

Write-Host ""
Write-Host "  Done. Restart EZView (close its console window and reopen the desktop shortcut) to serve the new build." -ForegroundColor Green
