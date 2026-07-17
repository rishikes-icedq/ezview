# EZView — start backend (dedicated .venv) + frontend, then open browser
$ErrorActionPreference = 'Stop'
$root = Split-Path $MyInvocation.MyCommand.Path

Write-Host "==> Starting EZView..." -ForegroundColor Cyan

$backendDir  = Join-Path $root "backend"
$venvDir     = Join-Path $root ".venv"
$venvPython  = Join-Path $venvDir "Scripts\python.exe"
$venvPip     = Join-Path $venvDir "Scripts\pip.exe"

# --- Create venv if missing ---
if (-not (Test-Path $venvPython)) {
    Write-Host "    Creating .venv ..." -ForegroundColor Gray

    # --without-pip avoids the ensurepip hang on some Windows installs
    python -m venv --without-pip $venvDir
}

# --- Bootstrap pip if missing (handles a partially-created venv too) ---
if (-not (Test-Path $venvPip)) {
    Write-Host "    Bootstrapping pip (downloading get-pip.py)..." -ForegroundColor Gray
    $getPip = Join-Path $env:TEMP "get-pip.py"
    Invoke-WebRequest -Uri "https://bootstrap.pypa.io/get-pip.py" -OutFile $getPip -UseBasicParsing
    & $venvPython $getPip -q
    Remove-Item $getPip -ErrorAction SilentlyContinue
}

# --- Install / verify backend packages ---
Write-Host "    Installing / verifying backend packages..." -ForegroundColor Gray
& $venvPip install -r (Join-Path $backendDir "requirements.txt") -q

# --- Free stale ports from a previous run ---
# Stop-Job does not reliably kill uvicorn's --reload worker, which Windows
# spawns as a separate multiprocessing child rather than a direct child of
# the job's process. A leftover instance from an earlier run can keep
# answering on :8000 while this run's own backend fails to bind (port
# already in use) and its health check then waits on nothing real. Killing
# whatever already owns our ports guarantees a clean slate every time.
function Stop-ProcessOnPort([int]$Port) {
    $pids = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -Unique
    foreach ($procId in $pids) {
        Write-Host "    Freeing port $Port (stopping stale process $procId from a previous run)..." -ForegroundColor Yellow
        # /T kills the process tree, since the reload worker is a grandchild, not a direct child
        taskkill /PID $procId /T /F 2>$null | Out-Null
    }
}
Stop-ProcessOnPort 8000
Stop-ProcessOnPort 5173

# --- Launch backend ---
Write-Host "    Backend: launching on :8000" -ForegroundColor Gray
$backendJob = Start-Job -ScriptBlock {
    param($dir, $py)
    Set-Location $dir
    & $py app.py
} -ArgumentList $backendDir, $venvPython

# --- Frontend ---
$frontendDir = Join-Path $root "frontend"
if (-not (Test-Path (Join-Path $frontendDir "node_modules"))) {
    Write-Host "    Frontend: npm install (first run)..." -ForegroundColor Gray
    Push-Location $frontendDir
    npm install --silent
    Pop-Location
}

Write-Host "    Frontend: launching on :5173" -ForegroundColor Gray
$frontendJob = Start-Job -ScriptBlock {
    param($dir)
    Set-Location $dir
    npm run dev
} -ArgumentList $frontendDir

# --- Wait for backend health ---
# Timeout is generous: uvicorn --reload spawns its worker via a second
# process (Windows multiprocessing "spawn"), and folders synced by OneDrive
# can add real I/O contention on top of that — cold starts here have taken
# 2+ minutes, well past a typical local-disk startup.
Write-Host "    Waiting for backend to be ready..." -ForegroundColor Gray -NoNewline
$ok = $false
for ($i = 0; $i -lt 180; $i++) {
    Start-Sleep -Seconds 1
    if ($i % 10 -eq 9) { Write-Host "." -ForegroundColor Gray -NoNewline }
    try {
        $r = Invoke-WebRequest -Uri "http://127.0.0.1:8000/api/health" -UseBasicParsing -TimeoutSec 2
        if ($r.StatusCode -eq 200) { $ok = $true; break }
    } catch { }
}
Write-Host ""

if (-not $ok) {
    Write-Host "Backend did not start. Backend logs:" -ForegroundColor Red
    # uvicorn logs to stderr, which Receive-Job surfaces as NativeCommandError;
    # -ErrorAction SilentlyContinue keeps that from aborting the script here.
    Receive-Job $backendJob -ErrorAction SilentlyContinue
    Stop-Job $backendJob, $frontendJob -ErrorAction SilentlyContinue
    Remove-Job $backendJob, $frontendJob -ErrorAction SilentlyContinue
    exit 1
}

Write-Host ""
Write-Host "  EZView is running:" -ForegroundColor Green
Write-Host "    http://localhost:5173  (UI)" -ForegroundColor Cyan
Write-Host "    http://localhost:8000  (API)" -ForegroundColor Gray
Write-Host ""
Write-Host "  Press Ctrl+C to stop." -ForegroundColor Gray

Start-Process "http://localhost:5173"

# Stream backend logs until Ctrl+C
try {
    while ($true) {
        Start-Sleep -Seconds 5
        $backendJob | Receive-Job -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "[backend] $_" -ForegroundColor DarkGray }
    }
} finally {
    Stop-Job $backendJob, $frontendJob -ErrorAction SilentlyContinue
    Remove-Job $backendJob, $frontendJob -ErrorAction SilentlyContinue
}
