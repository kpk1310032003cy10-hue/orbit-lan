param(
    [ValidateSet('Inspect','Enable','Restore')][string]$Mode = 'Inspect',
    [string]$StatePath = (Join-Path $env:LOCALAPPDATA 'OrbitLAN'),
    [string]$IPAddress
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$reportPath = Join-Path $StatePath 'wake-result.json'

function Get-WakeTarget {
    if (-not $IPAddress) {
        $configPath = Join-Path $StatePath 'config.json'
        $config = Get-Content -LiteralPath $configPath -Raw -Encoding utf8 | ConvertFrom-Json
        $script:IPAddress = [string]$config.lanIP
    }
    $ip = Get-NetIPAddress -AddressFamily IPv4 -IPAddress $IPAddress -ErrorAction Stop
    if (@($ip).Count -ne 1) { throw 'The configured Orbit IP must identify exactly one interface.' }
    $adapter = Get-NetAdapter -InterfaceIndex $ip.InterfaceIndex -ErrorAction Stop
    if (-not $adapter.HardwareInterface) { throw 'Wake configuration requires a physical network adapter.' }
    return $adapter
}
function Get-WakeSnapshot($adapter) {
    $entry = Get-CimInstance -Namespace root/wmi -ClassName MSPower_DeviceWakeEnable -ErrorAction SilentlyContinue |
        Where-Object { $_.InstanceName.StartsWith($adapter.PnPDeviceID + '_', [StringComparison]::OrdinalIgnoreCase) } |
        Select-Object -First 1
    $property = Get-NetAdapterAdvancedProperty -Name $adapter.Name -AllProperties -ErrorAction SilentlyContinue |
        Where-Object { $_.RegistryKeyword -in @('*WakeOnMagicPacket','DisableWakeOnMagic') } |
        Select-Object -First 1
    $magic = $null
    if ($property) {
        $magic = if ($property.RegistryKeyword -eq 'DisableWakeOnMagic') { [string]$property.RegistryValue[0] -eq '0' } else { [string]$property.RegistryValue[0] -eq '1' }
    }
    return [pscustomobject]@{
        inspectedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
        adapter = $adapter.InterfaceDescription
        interfaceName = $adapter.Name
        mac = $adapter.MacAddress
        ip = $IPAddress
        armed = if ($entry) { [bool]$entry.Enable } else { $null }
        magicPacket = $magic
        magicKeyword = if ($property) { $property.RegistryKeyword } else { $null }
        magicValue = if ($property) { @($property.RegistryValue) } else { @() }
        deviceId = $adapter.PnPDeviceID
        needsAdapterRestart = $false
    }
}
try {
    $target = Get-WakeTarget
    $before = Get-WakeSnapshot $target
    if ($Mode -eq 'Inspect') { $before | ConvertTo-Json -Depth 4 -Compress; exit 0 }
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    if (-not ([Security.Principal.WindowsPrincipal]$identity).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'Windows administrator rights are required to change device wake permissions.'
    }
    $backupDir = Join-Path $StatePath 'wake-backups'
    New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
    $backupPath = Join-Path $backupDir ('adapter-' + $target.InterfaceGuid.ToString().Trim('{}') + '.json')
    $needsRestart = $false
    if ($Mode -eq 'Enable') {
        if ($null -eq $before.armed -or $null -eq $before.magicPacket) {
            throw 'The driver did not expose both wake permission and Magic Packet support. No settings were changed.'
        }
        if (-not (Test-Path -LiteralPath $backupPath)) { $before | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $backupPath -Encoding utf8 }
        if (-not $before.magicPacket) {
            $value = if ($before.magicKeyword -eq 'DisableWakeOnMagic') { '0' } else { '1' }
            Set-NetAdapterAdvancedProperty -Name $target.Name -RegistryKeyword $before.magicKeyword -RegistryValue $value -NoRestart
            $needsRestart = $true
        }
        $powerOutput = & powercfg.exe /deviceenablewake $target.InterfaceDescription 2>&1
        if ($LASTEXITCODE -ne 0) { throw ($powerOutput -join ' ') }
    } else {
        $backup = Get-Content -LiteralPath $backupPath -Raw -Encoding utf8 | ConvertFrom-Json
        if ($backup.deviceId -ne $target.PnPDeviceID -or $backup.mac -ne $target.MacAddress) { throw 'The backup belongs to a different adapter.' }
        if ($backup.magicKeyword -and $before.magicPacket -ne $backup.magicPacket) {
            Set-NetAdapterAdvancedProperty -Name $target.Name -RegistryKeyword $backup.magicKeyword -RegistryValue @($backup.magicValue) -NoRestart
            $needsRestart = $true
        }
        $action = if ($backup.armed) { '/deviceenablewake' } else { '/devicedisablewake' }
        $powerOutput = & powercfg.exe $action $target.InterfaceDescription 2>&1
        if ($LASTEXITCODE -ne 0) { throw ($powerOutput -join ' ') }
    }
    $after = Get-WakeSnapshot $target
    if ($Mode -eq 'Enable' -and -not $after.armed) { throw 'Windows did not confirm that this adapter is armed for wake.' }
    $after.needsAdapterRestart = $needsRestart
    $result = [pscustomobject]@{ ok = $true; mode = $Mode; changedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds(); snapshot = $after; testedFromSleep = $false }
    $result | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $reportPath -Encoding utf8
    $result | ConvertTo-Json -Depth 5 -Compress
} catch {
    $result = [pscustomobject]@{ ok = $false; mode = $Mode; changedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds(); error = $_.Exception.Message }
    if ($Mode -ne 'Inspect') { $result | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $reportPath -Encoding utf8 }
    $result | ConvertTo-Json -Depth 4 -Compress
    exit 1
}
