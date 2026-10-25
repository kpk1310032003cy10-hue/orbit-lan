$ErrorActionPreference = 'Stop'
$projectPath = Split-Path -Parent $PSScriptRoot
$claudePath = Join-Path $projectPath 'node_modules/@anthropic-ai/claude-agent-sdk-win32-x64/claude.exe'
if (-not (Test-Path -LiteralPath $claudePath)) { throw 'Run npm ci first' }
& $claudePath auth login
Read-Host 'Press Enter to close'
