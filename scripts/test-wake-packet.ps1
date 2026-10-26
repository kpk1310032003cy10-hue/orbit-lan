param(
    [ValidateRange(15,600)][int]$Seconds = 180,
    [string]$StatePath = (Join-Path $env:LOCALAPPDATA 'OrbitLAN'),
    [string]$IPAddress
)
# Run elevated while the PC is awake. This receives packets; it never sleeps or wakes the PC.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$reportPath = Join-Path $StatePath 'wake-packet-result.json'
$ruleName = 'Orbit-Wake-Probe-' + [guid]::NewGuid().ToString('N')
$receiver = $null
$ruleCreated = $false
$report = [ordered]@{
    state = 'starting'
    startedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    expiresAt = 0
    selfTest = $false
    matched = 0
    other = 0
    packets = @()
    firewallRemoved = $false
    testedFromSleep = $false
}
function Write-ProbeReport {
    $report | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $reportPath -Encoding utf8
}
try {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    if (-not ([Security.Principal.WindowsPrincipal]$identity).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'Run this packet test as administrator to create and remove its temporary local firewall rule.'
    }
    if (-not $IPAddress) {
        $config = Get-Content -LiteralPath (Join-Path $StatePath 'config.json') -Raw -Encoding utf8 | ConvertFrom-Json
        $IPAddress = [string]$config.lanIP
    }
    $ip = Get-NetIPAddress -AddressFamily IPv4 -IPAddress $IPAddress
    if (@($ip).Count -ne 1 -or $ip.PrefixLength -lt 1 -or $ip.PrefixLength -gt 30) { throw 'A single local IPv4 broadcast subnet is required.' }
    $adapter = Get-NetAdapter -InterfaceIndex $ip.InterfaceIndex
    if (-not $adapter.HardwareInterface -or $adapter.Status -ne 'Up') { throw 'The configured physical adapter must be connected.' }
    $mac = $adapter.MacAddress -replace '[:-]', ''
    if ($mac -notmatch '^[0-9A-Fa-f]{12}$') { throw 'The adapter did not expose a valid MAC address.' }
    $expected = [byte[]]::new(102)
    for ($i=0; $i -lt 6; $i++) { $expected[$i] = 255 }
    for ($i=0; $i -lt 96; $i++) { $expected[6+$i] = [Convert]::ToByte($mac.Substring(($i % 6)*2,2),16) }
    $receiver = [Net.Sockets.UdpClient]::new([Net.Sockets.AddressFamily]::InterNetwork)
    $receiver.ExclusiveAddressUse = $true
    $receiver.Client.ReceiveTimeout = 1000
    $receiver.Client.Bind([Net.IPEndPoint]::new([Net.IPAddress]::Any,9))
    $program = [Diagnostics.Process]::GetCurrentProcess().MainModule.FileName
    New-NetFirewallRule -Name $ruleName -DisplayName 'Orbit temporary wake packet test' -Direction Inbound -Action Allow -Protocol UDP -LocalPort 9 -RemoteAddress ($IPAddress + '/' + $ip.PrefixLength) -InterfaceAlias $adapter.Name -Program $program -Profile Any -Enabled True | Out-Null
    $ruleCreated = $true
    $report.state = 'listening'
    $report.expiresAt = [DateTimeOffset]::UtcNow.AddSeconds($Seconds).ToUnixTimeMilliseconds()
    Write-ProbeReport
    $sender = [Net.Sockets.UdpClient]::new([Net.IPEndPoint]::new([Net.IPAddress]::Parse($IPAddress),0))
    try { $sender.Send($expected,$expected.Length,$IPAddress,9) | Out-Null } finally { $sender.Dispose() }
    $deadline = [DateTimeOffset]::UtcNow.AddSeconds($Seconds)
    while ([DateTimeOffset]::UtcNow -lt $deadline) {
        $remote = [Net.IPEndPoint]::new([Net.IPAddress]::Any,0)
        try { $data = $receiver.Receive([ref]$remote) } catch [Net.Sockets.SocketException] {
            if ($_.Exception.SocketErrorCode -eq [Net.Sockets.SocketError]::TimedOut) { continue }
            throw
        }
        $valid = $data.Length -ge 102 -and $data.Length -le 4096
        if ($valid) {
            for ($i=0; $i -lt 102; $i++) { if ($data[$i] -ne $expected[$i]) { $valid=$false; break } }
        }
        if ($remote.Address.ToString() -eq $IPAddress) {
            if ($valid) { $report.selfTest = $true }
            Write-ProbeReport
            continue
        }
        if ($valid) { $report.matched++ } else { $report.other++ }
        if ($report.packets.Count -lt 30) {
            $report.packets += [pscustomobject]@{ at=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds(); from=$remote.Address.ToString(); correctMac=$valid; bytes=$data.Length }
        }
        Write-ProbeReport
    }
    $report.state = 'complete'
} catch {
    $report.state = 'error'
    $report.error = $_.Exception.Message
} finally {
    if ($receiver) { $receiver.Dispose() }
    if ($ruleCreated) {
        try {
            Remove-NetFirewallRule -Name $ruleName -ErrorAction Stop
            $report.firewallRemoved = $true
        } catch { $report.cleanupError = $_.Exception.Message }
    }
    New-Item -ItemType Directory -Path $StatePath -Force | Out-Null
    Write-ProbeReport
}
$report | ConvertTo-Json -Depth 5 -Compress
if ($report.state -eq 'error' -or $report.Contains('cleanupError')) { exit 1 }
