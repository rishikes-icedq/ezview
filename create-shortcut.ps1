# One-time setup: creates a Desktop shortcut that launches EZView via
# run-app.ps1 (see that file for what launching actually does). Safe to
# re-run any time — it just overwrites the existing shortcut.
#
# Requires Python 3.11 and Node.js already installed; run-app.ps1 handles
# everything else (venv, pip packages, first frontend build) on first launch.
$ErrorActionPreference = 'Stop'
$root = Split-Path $MyInvocation.MyCommand.Path
$launcher = Join-Path $root "run-app.ps1"

$desktop = [Environment]::GetFolderPath("Desktop")
$shortcutPath = Join-Path $desktop "EZView.lnk"

$WshShell = New-Object -ComObject WScript.Shell
$shortcut = $WshShell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = "powershell.exe"
$shortcut.Arguments = "-WindowStyle Hidden -ExecutionPolicy Bypass -File `"$launcher`""
$shortcut.WorkingDirectory = $root
$shortcut.IconLocation = "shell32.dll,13"
$shortcut.Description = "Launch EZView"
$shortcut.Save()

Write-Host "Created Desktop shortcut: $shortcutPath" -ForegroundColor Green
Write-Host "Double-click it any time to open EZView - the first run installs" -ForegroundColor Gray
Write-Host "dependencies and builds the frontend, which can take a minute or two." -ForegroundColor Gray
