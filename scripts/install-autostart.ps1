$ErrorActionPreference = 'Stop'
$startupPath = [Environment]::GetFolderPath('Startup')
$shortcutPath = Join-Path $startupPath 'Orbit LAN.lnk'
$shellObject = New-Object -ComObject WScript.Shell
$shortcut = $shellObject.CreateShortcut($shortcutPath)
$shortcut.TargetPath = (Get-Command powershell.exe).Source
$startScriptPath = Join-Path $PSScriptRoot 'start.ps1'
$shortcut.Arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $startScriptPath + '" -NoBrowser'
$shortcut.WorkingDirectory = Split-Path -Parent $PSScriptRoot
$shortcut.WindowStyle = 7
$shortcut.Description = 'Orbit LAN - personal projects and agents'
$shortcut.Save()
Write-Output "Autostart installed: $shortcutPath"
