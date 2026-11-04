# Run from an Administrator CMD: powershell -File scripts\lan_firewall.ps1
$ErrorActionPreference = 'Stop'
$taskRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$taskPython = Join-Path $taskRoot '.venv\Scripts\python.exe'
$taskPortText = & $taskPython -c "import sys; sys.path.insert(0,sys.argv[1]); from app.core.config import get_settings; print(get_settings().port)" $taskRoot
if ($LASTEXITCODE -ne 0) { throw 'Cannot read AI_SERVER_PORT.' }
$taskPort = [int]$taskPortText
if ($taskPort -lt 1 -or $taskPort -gt 65535) { throw 'Invalid port.' }
$taskRule = "AIVA AI_SERVER LAN TCP $taskPort"
if (-not (Get-NetFirewallRule -DisplayName $taskRule -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName $taskRule -Direction Inbound -Action Allow `
        -Protocol TCP -LocalPort $taskPort -RemoteAddress LocalSubnet -Profile Private
}
Write-Output "Rule ready: $taskRule (Private profile, local subnet only)."
