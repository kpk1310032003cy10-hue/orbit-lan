param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$projectPath = Split-Path -Parent $PSScriptRoot
$statePath = Join-Path $env:LOCALAPPDATA 'OrbitLAN'
$runtimePath = Join-Path $statePath 'runtime.json'
$alreadyRunning = $false
if (Test-Path -LiteralPath $runtimePath) {
    try {
        $runtime = Get-Content -LiteralPath $runtimePath -Raw -Encoding utf8 | ConvertFrom-Json
        $response = Invoke-WebRequest -UseBasicParsing -Uri ($runtime.localURL + '/api/session') -TimeoutSec 3
        $alreadyRunning = $response.StatusCode -eq 200
    } catch {}
}
if (-not $alreadyRunning) {
    $nodePath = (Get-Command node -ErrorAction Stop).Source
    if (-not (Test-Path -LiteralPath (Join-Path $projectPath 'node_modules/@peculiar/x509'))) {
        Push-Location -LiteralPath $projectPath
        try { & npm.cmd ci --no-fund --no-audit; if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed' } } finally { Pop-Location }
    }
    New-Item -ItemType Directory -Path $statePath -Force | Out-Null
    $serverPath = Join-Path $projectPath 'server/main.mjs'
    Start-Process -FilePath $nodePath -ArgumentList @('"' + $serverPath + '"') -WorkingDirectory $projectPath -WindowStyle Hidden -RedirectStandardOutput (Join-Path $statePath 'server.log') -RedirectStandardError (Join-Path $statePath 'error.log') | Out-Null
    for ($attempt = 0; $attempt -lt 35; $attempt++) {
        Start-Sleep -Milliseconds 400
        try { $runtime = Get-Content -LiteralPath $runtimePath -Raw -Encoding utf8 | ConvertFrom-Json; $response = Invoke-WebRequest -UseBasicParsing -Uri ($runtime.localURL + '/api/session') -TimeoutSec 2; if ($response.StatusCode -eq 200) { $alreadyRunning = $true; break } } catch {}
    }
    if (-not $alreadyRunning) { throw "Service did not start. See $statePath\error.log" }
}
Write-Output "Orbit LAN: $($runtime.localURL)"
Write-Output "iPhone / iPad: $($runtime.setupURL)"
if (-not $NoBrowser) { Start-Process $runtime.localURL }
