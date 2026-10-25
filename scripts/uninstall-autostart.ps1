$shortcutPath = Join-Path ([Environment]::GetFolderPath('Startup')) 'Orbit LAN.lnk'
if (Test-Path -LiteralPath $shortcutPath) { Remove-Item -LiteralPath $shortcutPath }
Write-Output 'Orbit autostart disabled'
