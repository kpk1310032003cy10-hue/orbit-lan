$ErrorActionPreference = 'Stop'
$scriptPath = Join-Path $PSScriptRoot 'test-wake-packet.ps1'
$statePath = Join-Path $env:LOCALAPPDATA 'OrbitLAN'
Write-Output 'Keep the computer awake. Send the wake command from your iPhone now.'
Write-Output 'The packet test runs for 3 minutes and removes its temporary firewall rule.'
$child = Start-Process -FilePath powershell.exe -Verb RunAs -WindowStyle Hidden -Wait -PassThru -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',('"' + $scriptPath + '"'),'-StatePath',('"' + $statePath + '"'))
$result = Get-Content -LiteralPath (Join-Path $statePath 'wake-packet-result.json') -Raw -Encoding utf8 | ConvertFrom-Json
if ($child.ExitCode -ne 0 -or $result.state -eq 'error') {
    $failure = if ($result.error) { $result.error } elseif ($result.cleanupError) { $result.cleanupError } else { 'Packet test did not complete successfully.' }
    throw $failure
}
if (-not $result.firewallRemoved) { throw 'The temporary firewall rule was not removed. Check wake-packet-result.json.' }
Write-Output ('Receiver self-test: ' + $result.selfTest)
Write-Output ('Correct wake packets from other LAN devices: ' + $result.matched)
Write-Output 'Packet delivery while awake does not confirm waking from sleep.'
