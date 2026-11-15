# Native Windows PowerShell launcher for NASA-APP

The PowerShell launcher starts the **actual live OpenIndustries factory**, not the
static CAD preview. It reuses the same source code, STEP assets, local SQLite
controller, SSE transport, and original OI React/Three workbench as
`scripts/run_foundry_live.sh`, without requiring WSL2.

## Requirements

- Windows 10 or 11, Windows PowerShell 5.1 or PowerShell 7.
- Git for Windows and **Windows** Node.js 22.16.0 or newer, including `npm.cmd`.
- Available TCP ports `127.0.0.1:5173` and `127.0.0.1:8787`.
- Run from your NASA-APP working tree in PowerShell. The script resolves paths from
  its own directory, so it also works when invoked from another current directory.

## Start the complete live factory

```powershell
.\scripts\run_foundry_live.ps1
```

The first run checks out the pinned OpenIndustries revision in
`vendor/openindustries` (only if absent), installs dependencies, imports the real
ten-machine STEP assets, persists the native scene, and initializes the locally
authenticated factory controller. It then launches the existing OI API and Vite
server, verifies the SSE endpoint matches the factory scene, and opens the browser.

Select **Foundry controls**, then **Start** and **Step** or **Resume**. The
kinematics, material balances, and machine inspector consume committed controller
state. Their simulated trajectories are not actual excavator travel/terrain
physics. The modeled preheater is not molten regolith electrolysis.

Press **Ctrl+C** to stop both local server processes. Logs are written to
`.generated/foundry-api.*.log` and `.generated/foundry-vite.*.log`.

## Options

```powershell
# Build the CAD scene and initialize the controller without opening servers
.\scripts\run_foundry_live.ps1 -BuildOnly

# Start native Windows processes but don't open a browser tab
.\scripts\run_foundry_live.ps1 -NoBrowser

# Reuse existing WSL2 Bash workflow instead of native Windows Node.js
.\scripts\run_foundry_live.ps1 -UseWsl

# Use an existing OpenIndustries checkout (must match the tested commit)
.\scripts\run_foundry_live.ps1 -OiRoot "D:\Projects\OpenIndustries"
```

For a temporary end-to-end launcher diagnostic, `-SmokeTest -NoBrowser` starts the
services, checks the live SSE/config endpoint, then stops both processes.
The Windows GitHub Actions job uses this mode.

## Persistence, configuration and security

- Uses `.generated/oi-scene-store` for OI's scene history and
  `.generated/foundry-live.sqlite` for the **separate** runtime/controller data.
- Defaults to stable instance `foundry-live-01`; opening the app again does not
  overwrite the previous run. The Reset control creates a new preserved run.
- Generates a local random password at `.generated/foundry-local-password`
  on first launch, restricts it to your Windows user, and reuses it on later
  launches. You can instead provide `NASA_FOUNDRY_PASSWORD` explicitly.
- Optional `NASA_FOUNDRY_DB`, `NASA_FOUNDRY_INSTANCE_ID`, and `OI_ROOT`
  environment values override the defaults. Never commit your database or secret.
- The script refuses to reset/modify an existing checkout at an unexpected commit.
- The API and browser bind to loopback; this is a **local development tool**, not
  an Internet-facing deployment.
- Native Windows and WSL2 use separate runtimes/paths and may use different
  SQLite instances. Don't try to run them against the same DB concurrently.

## Execution policy

Windows PowerShell may block local scripts under its execution policy. You can
run this script **for this one process only** without changing machine-wide policy:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\run_foundry_live.ps1
```

Only do this for a script you've inspected and trust. If you do not want to run
the native Windows pipeline, use `-UseWsl` to delegate to the Bash launcher.

## CI contract

`.github/workflows/windows-foundry-launcher.yml` checks the syntax and runs the
actual PowerShell `-SmokeTest` against the pinned OI source. It fails on missing
dependencies, bad STEP imports, failed SQLite initialization, dead child processes,
or an SSE service that does not match the opened scene. Windows launch evidence is
not a physics simulation acceptance test; see
`docs/architecture/foundry-slice-verification.md` for the real controller tests.
