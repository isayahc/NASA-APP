#requires -Version 5.1
<#
.SYNOPSIS
  Launch the complete NASA-APP foundry from Windows PowerShell.
.DESCRIPTION
  Uses native Windows Node.js, Git, and npm to run the existing pinned
  OpenIndustries STEP importer, SQLite controller, API, and Vite/Three viewer.
  -UseWsl delegates to the existing tested Bash launcher instead.
.EXAMPLE
  .\scripts\run_foundry_live.ps1
.EXAMPLE
  .\scripts\run_foundry_live.ps1 -BuildOnly
.EXAMPLE
  .\scripts\run_foundry_live.ps1 -UseWsl
#>
[CmdletBinding()]
param(
    [switch]$BuildOnly,
    [switch]$NoBrowser,
    [switch]$SmokeTest,
    [switch]$UseWsl,
    [string]$OiRoot
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$root = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$dataDir = Join-Path $root '.generated'
$pin = '838ea330296148621f7a23f7cb647b11e73b5184'

function Require-Executable([string]$name) {
    <# Find the actual program without using a PowerShell script alias. #>
    $cmd = Get-Command $name -ErrorAction SilentlyContinue
    if (-not $cmd) { throw "Missing $name. Install Git and Node.js >= 22.16 on Windows." }
    return $cmd.Source
}
function Check-Result([string]$operation) {
    <# Native commands do not obey ErrorActionPreference on Windows PowerShell 5.1. #>
    if ($LASTEXITCODE -ne 0) { throw "$operation failed (exit code $LASTEXITCODE)." }
}
function Wait-ForVite([System.Diagnostics.Process]$api, [System.Diagnostics.Process]$vite) {
    <# Require actual HTTP readiness and live child processes. #>
    for ($i = 0; $i -lt 80; $i++) {
        if ($api.HasExited -or $vite.HasExited) { throw 'The local OI API or Vite process exited.' }
        try {
            $r = Invoke-WebRequest -Uri 'http://127.0.0.1:5173/' -UseBasicParsing -TimeoutSec 2
            if ($r.StatusCode -eq 200) { return }
        } catch { }
        Start-Sleep -Milliseconds 500
    }
    throw 'The OI workbench did not become reachable at http://127.0.0.1:5173.'
}

if ($UseWsl) {
    $null = Require-Executable 'wsl.exe'
    if ($SmokeTest) { throw '-SmokeTest is for native Windows mode only.' }
    if ($BuildOnly) {
        & wsl.exe --cd $root --exec bash ./scripts/run_foundry.sh --build-only
    } else {
        & wsl.exe --cd $root --exec bash ./scripts/run_foundry_live.sh
    }
    Check-Result 'WSL launcher'
    return
}
if ($env:OS -ne 'Windows_NT') { throw 'Native mode requires Windows PowerShell; use the Bash launcher on Linux.' }

$node = Require-Executable 'node.exe'
$npm = Require-Executable 'npm.cmd'
$git = Require-Executable 'git.exe'
$nodeVersion = (& $node -p 'process.versions.node').Trim()
Check-Result 'Read Node version'
if ([version]$nodeVersion -lt [version]'22.16.0') {
    throw "Node.js $nodeVersion is too old; install Node >=22.16."
}
if ([string]::IsNullOrWhiteSpace($OiRoot)) {
    $OiRoot = if ([string]::IsNullOrWhiteSpace($env:OI_ROOT)) {
        Join-Path $root 'vendor\openindustries'
    } else { $env:OI_ROOT }
}
$OiRoot = [System.IO.Path]::GetFullPath($OiRoot)
New-Item -ItemType Directory -Force -Path $dataDir | Out-Null

# Reuse or pin OI; NEVER reset an existing user's OpenIndustries checkout.
if (-not (Test-Path -LiteralPath (Join-Path $OiRoot '.git'))) {
    if (Test-Path -LiteralPath $OiRoot) {
        throw "Existing OI directory is not a Git checkout: $OiRoot. Supply a clean -OiRoot."
    }
    New-Item -ItemType Directory -Force -Path (Split-Path $OiRoot -Parent) | Out-Null
    & $git clone https://github.com/Mapped-Assembly/OpenIndustries.git $OiRoot
    Check-Result 'Clone OpenIndustries'
    & $git -C $OiRoot checkout --detach $pin
    Check-Result 'Pin OpenIndustries'
}
$currentPin = (& $git -C $OiRoot rev-parse HEAD).Trim()
Check-Result 'Read OpenIndustries revision'
if ($currentPin -ne $pin) {
    throw "OI checkout is $currentPin; this integration requires $pin. Use a separate -OiRoot."
}
if (-not (Test-Path -LiteralPath (Join-Path $OiRoot 'node_modules\occt-import-js\dist\occt-import-js.wasm'))) {
    & $npm ci --prefix $OiRoot
    Check-Result 'Install OpenIndustries'
}

$sceneStore = Join-Path $dataDir 'oi-scene-store'
$scene = Join-Path $dataDir 'lunar-foundry.oi.json'
$sessionFile = Join-Path $dataDir 'lunar-foundry.session.json'
Push-Location $OiRoot
try {
    & $node '--max-old-space-size=6144' '--import' 'tsx' (Join-Path $root 'scripts\build_lunar_scene.mjs') '--oi-root' $OiRoot '--app-root' $root '--output' $scene '--store' $sceneStore
    Check-Result 'Build real STEP-backed OI scene'
} finally { Pop-Location }
if (-not (Test-Path -LiteralPath $sessionFile)) { throw "Missing local scene receipt: $sessionFile" }
$session = Get-Content -LiteralPath $sessionFile -Raw | ConvertFrom-Json
if ([string]::IsNullOrWhiteSpace([string]$session.scene_id)) {
    throw 'OI scene receipt contains no scene_id.'
}

if ([string]::IsNullOrWhiteSpace($env:NASA_FOUNDRY_DB)) {
    $env:NASA_FOUNDRY_DB = Join-Path $dataDir 'foundry-live.sqlite'
}
if ([string]::IsNullOrWhiteSpace($env:NASA_FOUNDRY_INSTANCE_ID)) {
    $env:NASA_FOUNDRY_INSTANCE_ID = 'foundry-live-01'
}
if ([string]::IsNullOrWhiteSpace($env:NASA_FOUNDRY_PASSWORD)) {
    $passwordPath = Join-Path $dataDir 'foundry-local-password'
    if (-not (Test-Path -LiteralPath $passwordPath)) {
        $secret = (& $node -e 'process.stdout.write(require("node:crypto").randomBytes(24).toString("base64url"))').Trim()
        Check-Result 'Generate local operator secret'
        [System.IO.File]::WriteAllText($passwordPath, $secret, [System.Text.Encoding]::ASCII)
        $sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
        & icacls.exe $passwordPath '/inheritance:r' '/grant:r' "*$($sid):F" | Out-Null
        Check-Result 'Restrict local operator secret to current user'
    }
    $env:NASA_FOUNDRY_PASSWORD = [System.IO.File]::ReadAllText($passwordPath).Trim()
}
if ($env:NASA_FOUNDRY_PASSWORD.Length -lt 12) { throw 'NASA_FOUNDRY_PASSWORD must be at least 12 characters.' }
$env:NASA_FOUNDRY_OI_SCENE_ID = [string]$session.scene_id
$env:OI_ROOT = $OiRoot
$env:OI_SCENE_BACKEND = 'local'
$env:OI_SCENE_TOOLS_ENABLED = 'true'
$env:OI_SCENE_DATA_DIR = $sceneStore

Push-Location $OiRoot
try {
    & $node '--import' 'tsx' (Join-Path $root 'scripts\init_foundry_live.ts')
    Check-Result 'Initialize authenticated local foundry'
} finally { Pop-Location }

$url = 'http://127.0.0.1:5173/?localSceneId=' + $session.scene_id
Write-Host ''
Write-Host 'NASA-APP native Windows foundry initialized.' -ForegroundColor Green
Write-Host "Scene URL: $url"
Write-Host 'In OpenIndustries, click Start, then Step or Resume.'
Write-Host 'Machine motions are simulated joint poses, not lunar terrain physics.'
if ($BuildOnly) {
    Write-Host 'Build-only: controller and scene persisted; no servers started.'
    return
}

$apiOut = Join-Path $dataDir 'foundry-api.stdout.log'
$apiErr = Join-Path $dataDir 'foundry-api.stderr.log'
$viteOut = Join-Path $dataDir 'foundry-vite.stdout.log'
$viteErr = Join-Path $dataDir 'foundry-vite.stderr.log'
$viteConfig = Join-Path $root 'integrations\openindustries\vite.foundry.config.ts'
$api = $null
$vite = $null
try {
    $api = Start-Process -FilePath $node -WorkingDirectory $OiRoot -ArgumentList 'server/index.mjs' -PassThru -NoNewWindow -RedirectStandardOutput $apiOut -RedirectStandardError $apiErr
    $viteArgs = '--import tsx node_modules/vite/bin/vite.js --config "' + $viteConfig + '" --host 127.0.0.1'
    $vite = Start-Process -FilePath $node -WorkingDirectory $OiRoot -ArgumentList $viteArgs -PassThru -NoNewWindow -RedirectStandardOutput $viteOut -RedirectStandardError $viteErr
    Wait-ForVite $api $vite
    $config = Invoke-RestMethod -Uri 'http://127.0.0.1:5173/api/foundry/config' -TimeoutSec 10
    if ($config.protocol -ne 'nasa.foundry.snapshot.v1' -or [string]$config.oi_scene_id -ne [string]$session.scene_id) {
        throw 'The live SSE endpoint does not belong to the generated OI factory scene.'
    }
    Write-Host 'Native OI viewer and authoritative SSE are responding.' -ForegroundColor Green
    if ($SmokeTest) {
        Write-Host 'Smoke test PASS: no simulation time was advanced.'
        return
    }
    if (-not $NoBrowser) { Start-Process -FilePath $url | Out-Null }
    Write-Host 'Ctrl+C stops both local servers.'
    while (-not $api.HasExited -and -not $vite.HasExited) { Start-Sleep -Seconds 1 }
    throw 'A foundry process stopped unexpectedly.'
}
catch {
    Write-Warning "API log: $apiErr"
    Write-Warning "Vite log: $viteErr"
    throw
}
finally {
    foreach ($process in @($vite, $api)) {
        if ($null -ne $process -and -not $process.HasExited) {
            Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
        }
    }
}
