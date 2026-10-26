param(
    [ValidateSet('Inspect','Repair','Restore')][string]$Mode = 'Inspect',
    [string]$StatePath = (Join-Path $env:LOCALAPPDATA 'OrbitLAN')
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$reportPath = Join-Path $StatePath 'input-wake-result.json'
$backupPath = Join-Path $StatePath 'wake-backups/input-devices.json'

function Get-InputWakeSnapshot {
    $entries = @(Get-CimInstance -Namespace root/wmi -ClassName MSPower_DeviceWakeEnable)
    $devices = @(Get-PnpDevice -PresentOnly -Class Keyboard,Mouse | Where-Object { $_.Status -eq 'OK' })
    foreach ($device in $devices) {
        $entry = $entries | Where-Object {
            $_.InstanceName.StartsWith($device.InstanceId + '_', [StringComparison]::OrdinalIgnoreCase)
        } | Select-Object -First 1
        [pscustomobject]@{
            class = $device.Class
            name = $device.FriendlyName
            deviceId = $device.InstanceId
            instanceName = if ($entry) { $entry.InstanceName } else { $null }
            armed = if ($entry) { [bool]$entry.Enable } else { $null }
        }
    }
}
try {
    $before = @(Get-InputWakeSnapshot)
    if ($Mode -eq 'Inspect') {
        [pscustomobject]@{ devices = $before; testedFromSleep = $false } | ConvertTo-Json -Depth 5 -Compress
        exit 0
    }
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    if (-not ([Security.Principal.WindowsPrincipal]$identity).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'Windows administrator rights are required to change device wake permissions.'
    }
    $eligible = @($before | Where-Object { $null -ne $_.armed })
    if (-not $eligible.Count) { throw 'No present keyboard or mouse exposes a writable wake permission.' }
    if ($Mode -eq 'Repair') {
        if (-not (Test-Path -LiteralPath $backupPath)) {
            New-Item -ItemType Directory -Path (Split-Path -Parent $backupPath) -Force | Out-Null
            [pscustomobject]@{ machine = $env:COMPUTERNAME; devices = $eligible } |
                ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $backupPath -Encoding utf8
        }
        $targets = @($eligible | ForEach-Object { [pscustomobject]@{ deviceId = $_.deviceId; armed = $true } })
    } else {
        $backup = Get-Content -LiteralPath $backupPath -Raw -Encoding utf8 | ConvertFrom-Json
        if ($backup.machine -ne $env:COMPUTERNAME) { throw 'The input device backup belongs to another computer.' }
        $targets = @($backup.devices)
    }
    $changed = @()
    $missing = @()
    foreach ($target in $targets) {
        $device = $eligible | Where-Object { $_.deviceId -eq $target.deviceId } | Select-Object -First 1
        if (-not $device) { $missing += $target.deviceId; continue }
        if ($device.armed -eq [bool]$target.armed) { continue }
        $entry = Get-CimInstance -Namespace root/wmi -ClassName MSPower_DeviceWakeEnable |
            Where-Object { $_.InstanceName -eq $device.instanceName } | Select-Object -First 1
        if (-not $entry) { throw 'An input device disappeared during repair. Previous changes are recorded in the backup.' }
        Set-CimInstance -InputObject $entry -Property @{ Enable = [bool]$target.armed } | Out-Null
        $verified = Get-CimInstance -Namespace root/wmi -ClassName MSPower_DeviceWakeEnable |
            Where-Object { $_.InstanceName -eq $device.instanceName } | Select-Object -First 1
        if (-not $verified -or [bool]$verified.Enable -ne [bool]$target.armed) {
            throw 'Windows did not confirm the requested input device wake permission.'
        }
        $changed += $device.deviceId
    }
    $result = [pscustomobject]@{
        ok = $missing.Count -eq 0
        mode = $Mode
        changedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
        changed = $changed
        missing = $missing
        devices = @(Get-InputWakeSnapshot)
        testedFromSleep = $false
        needsRestart = $false
    }
    $result | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $reportPath -Encoding utf8
    $result | ConvertTo-Json -Depth 5 -Compress
    if (-not $result.ok) { exit 1 }
} catch {
    $result = [pscustomobject]@{ ok = $false; mode = $Mode; changedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds(); error = $_.Exception.Message }
    if ($Mode -ne 'Inspect') {
        New-Item -ItemType Directory -Path $StatePath -Force | Out-Null
        $result | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $reportPath -Encoding utf8
    }
    $result | ConvertTo-Json -Depth 4 -Compress
    exit 1
}
