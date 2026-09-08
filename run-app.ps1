# EZView - production launcher, meant to run hidden from a desktop shortcut.
# Builds the frontend once (if not already built), starts a single backend
# process that serves the built UI + API from :8000 in its own visible
# console window, and opens the browser once it's ready. Closing that
# console window stops EZView.
$ErrorActionPreference = 'Stop'
# Native executables (pip/npm) below run with $ErrorActionPreference reset to
# 'Continue' just for their invocation - under 'Stop', PowerShell promotes any
# stderr write from a native command into a terminating NativeCommandError
# even on success (e.g. pip's harmless warnings), which aborted this script
# with an empty "RemoteException" before this was added. Exit codes are
# checked explicitly instead.
$root = Split-Path $MyInvocation.MyCommand.Path

$backendDir  = Join-Path $root "backend"
$frontendDir = Join-Path $root "frontend"
$venvDir     = Join-Path $root ".venv"
$venvPython  = Join-Path $venvDir "Scripts\python.exe"
$venvPip     = Join-Path $venvDir "Scripts\pip.exe"
$distIndex   = Join-Path $frontendDir "dist\index.html"
$logFile     = Join-Path $root "ezview-launch.log"

function Log([string]$msg) {
    "$(Get-Date -Format 'HH:mm:ss')  $msg" | Out-File $logFile -Append -Encoding utf8
}

# Runs a native command with stderr chatter allowed (see note above), appends
# its combined output to the log, and throws only on a genuine nonzero exit.
function Invoke-Logged([string]$failureMessage, [scriptblock]$block) {
    $prevEAP = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        & $block *>> $logFile
    } finally {
        $ErrorActionPreference = $prevEAP
    }
    if ($LASTEXITCODE -ne 0) {
        throw "$failureMessage (exit code $LASTEXITCODE) - see ezview-launch.log"
    }
}

"==> EZView launch $(Get-Date)" | Out-File $logFile -Encoding utf8

try {
    # --- Create venv if missing ---
    if (-not (Test-Path $venvPython)) {
        Log "Creating .venv ..."
        python -m venv --without-pip $venvDir
    }

    # --- Bootstrap pip if missing (handles a partially-created venv too) ---
    if (-not (Test-Path $venvPip)) {
        Log "Bootstrapping pip..."
        $getPip = Join-Path $env:TEMP "get-pip.py"
        Invoke-WebRequest -Uri "https://bootstrap.pypa.io/get-pip.py" -OutFile $getPip -UseBasicParsing
        & $venvPython $getPip -q
        Remove-Item $getPip -ErrorAction SilentlyContinue
    }

    # --- Install / verify backend packages ---
    Log "Installing / verifying backend packages..."
    Invoke-Logged "pip install failed" { & $venvPip install -r (Join-Path $backendDir "requirements.txt") -q }

    # --- Build frontend if it hasn't been built yet ---
    # This only runs once (first launch). After that, use rebuild-frontend.ps1
    # whenever EZView's frontend code changes — this launcher does not
    # re-detect staleness on every run.
    if (-not (Test-Path $distIndex)) {
        Log "No frontend build found - building now (first run)..."
        if (-not (Test-Path (Join-Path $frontendDir "node_modules"))) {
            Push-Location $frontendDir
            Invoke-Logged "npm install failed" { npm install --silent }
            Pop-Location
        }
        Push-Location $frontendDir
        Invoke-Logged "npm run build failed" { npm run build }
        Pop-Location
    }

    # --- Free a stale port 8000 from a previous run ---
    $staleIds = Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -Unique
    foreach ($procId in $staleIds) {
        Log "Freeing port 8000 (stopping stale process $procId)..."
        taskkill /PID $procId /T /F 2>$null | Out-Null
    }

    # --- Launch backend (serves API + built UI) in its own visible console ---
    Log "Starting backend on :8000..."
    Start-Process -FilePath $venvPython -ArgumentList "app.py" -WorkingDirectory $backendDir -WindowStyle Normal

    # --- Wait for it to be ready, then open the browser ---
    $ok = $false
    for ($i = 0; $i -lt 180; $i++) {
        Start-Sleep -Seconds 1
        try {
            $r = Invoke-WebRequest -Uri "http://127.0.0.1:8000/api/health" -UseBasicParsing -TimeoutSec 2
            if ($r.StatusCode -eq 200) { $ok = $true; break }
        } catch { }
    }

    if ($ok) {
        Log "Backend ready - opening browser."
        Start-Process "http://localhost:8000"
    } else {
        Log "Backend did not respond after 180s."
        Add-Type -AssemblyName System.Windows.Forms
        [System.Windows.Forms.MessageBox]::Show(
            "EZView failed to start within 180 seconds. Check ezview-launch.log and the backend console window for errors.",
            "EZView", "OK", "Error"
        ) | Out-Null
    }
} catch {
    Log "ERROR: $($_.Exception.GetType().FullName): $($_.Exception.Message)"
    Log "STACK: $($_.ScriptStackTrace)"
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show(
        "EZView failed to start: $_`n`nSee ezview-launch.log for details.",
        "EZView", "OK", "Error"
    ) | Out-Null
}
