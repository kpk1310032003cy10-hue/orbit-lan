$ErrorActionPreference = 'Stop'
$statePath = Join-Path $env:LOCALAPPDATA 'OrbitLAN'
$runtimePath = Join-Path $statePath 'runtime.json'
if (-not (Test-Path -LiteralPath $runtimePath)) { Write-Output 'Orbit is not running'; exit }
$runtime = Get-Content -LiteralPath $runtimePath -Encoding utf8 -Raw | ConvertFrom-Json
$processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $($runtime.pid)"
$expectedScript = Join-Path $runtime.base 'server/main.mjs'
if ($processInfo.Name -eq 'node.exe' -and $processInfo.CommandLine.Contains($expectedScript)) {
    # Kill only the recorded owned server tree; never stop a VS Code process.
    & taskkill.exe /PID $runtime.pid /T /F
    Remove-Item -LiteralPath $runtimePath -ErrorAction SilentlyContinue
} else { throw 'PID no longer belongs to Orbit; no process was stopped' }
