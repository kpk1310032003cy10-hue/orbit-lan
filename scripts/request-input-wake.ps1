$ErrorActionPreference = 'Stop'
$scriptPath = Join-Path $PSScriptRoot 'input-wake.ps1'
$statePath = Join-Path $env:LOCALAPPDATA 'OrbitLAN'
$child = Start-Process -FilePath powershell.exe -Verb RunAs -WindowStyle Hidden -Wait -PassThru -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',('"' + $scriptPath + '"'),'-Mode','Repair','-StatePath',('"' + $statePath + '"'))
$result = Get-Content -LiteralPath (Join-Path $statePath 'input-wake-result.json') -Raw -Encoding utf8 | ConvertFrom-Json
if ($child.ExitCode -ne 0 -or -not $result.ok) { throw $result.error }
$count = @($result.devices | Where-Object armed).Count
Write-Output "Windows enabled wake permission for $count keyboard/mouse interfaces."
Write-Output 'No restart is needed for this permission. Test sleep and wake separately.'
Write-Output 'If wake still fails, see docs/wake.md: BIOS must allow USB wake.'
