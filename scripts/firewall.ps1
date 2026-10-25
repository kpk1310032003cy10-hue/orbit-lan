$ErrorActionPreference = 'Stop'
$configPath = Join-Path $env:LOCALAPPDATA 'OrbitLAN/config.json'
if (-not (Test-Path -LiteralPath $configPath)) { throw 'Start Orbit first' }
$config = Get-Content -LiteralPath $configPath -Raw -Encoding utf8 | ConvertFrom-Json
$networkInterface = Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -eq $config.lanIP } | Select-Object -First 1
if (-not $networkInterface) { throw 'Configured Wi-Fi IP is unavailable. Check Orbit config.' }
$nodePath = (Get-Command node).Source
$ruleName = 'OrbitLAN-HomeWiFi'
$existingRule = Get-NetFirewallRule -Name $ruleName -ErrorAction SilentlyContinue
if ($existingRule) { Remove-NetFirewallRule -Name $ruleName }
New-NetFirewallRule -Name $ruleName -DisplayName 'Orbit LAN - home Wi-Fi only' -Direction Inbound -Action Allow -Protocol TCP -LocalPort @($config.httpPort,$config.httpsPort) -LocalAddress $config.lanIP -RemoteAddress LocalSubnet -InterfaceAlias $networkInterface.InterfaceAlias -Program $nodePath -Profile Any | Out-Null
Write-Output "Allowed Orbit ports $($config.httpPort), $($config.httpsPort) on $($networkInterface.InterfaceAlias), IP $($config.lanIP), local subnet only."
