$ErrorActionPreference = 'Stop'
$wakeScript = Join-Path $PSScriptRoot 'wake.ps1'
$statePath = Join-Path $env:LOCALAPPDATA 'OrbitLAN'
Start-Process -FilePath powershell.exe -Verb RunAs -WindowStyle Hidden -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',('"' + $wakeScript + '"'),'-Mode','Enable','-StatePath',('"' + $statePath + '"'))
