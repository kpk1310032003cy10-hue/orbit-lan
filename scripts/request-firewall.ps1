$ErrorActionPreference = 'Stop'
$firewallScriptPath = Join-Path $PSScriptRoot 'firewall.ps1'
Start-Process -FilePath powershell.exe -Verb RunAs -WindowStyle Hidden -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',('"' + $firewallScriptPath + '"'))
