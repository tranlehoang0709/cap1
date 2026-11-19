param([ValidateSet('start','status','stop')][string]$Action = 'start')
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$script:failed = $false
function Get-Listener([int]$Port) {
    # Never interpret inspection failure as a free port.
    @(Get-NetTCPConnection -State Listen -ErrorAction Stop | Where-Object { $_.LocalPort -eq $Port } | Select-Object -ExpandProperty OwningProcess -Unique)
}
function Test-Process($Service, [int]$OwnerId) {
    $process = Get-CimInstance Win32_Process -Filter "ProcessId=$OwnerId" -ErrorAction Stop
    $command = ([string]$process.CommandLine).Replace('/', '\')
    $expected = [IO.Path]::GetFullPath($Service.Directory).TrimEnd('\') + '\'
    $verified = $command.IndexOf($expected, [StringComparison]::OrdinalIgnoreCase) -ge 0
    if ($Service.Kind -eq 'backend') { $verified = $verified -and $process.Name -eq 'node.exe' -and $command -match '\\dist\\main(?:\.js)?(?:\s|$|\x22)' }
    elseif ($Service.Kind -eq 'frontend') { $verified = $verified -and $process.Name -eq 'node.exe' -and $command -match '\\next\\dist\\' }
    else { $verified = $verified -and $process.Name -match '^python(w)?\.exe$' -and $command -match $Service.Pattern }
    # Do not dump arbitrary command lines: unrelated processes may have secrets in arguments.
    Write-Host ("{0}: port={1}, PID={2}, process={3}, project-command-verified={4}" -f $Service.Name,$Service.Port,$OwnerId,$process.Name,$verified)
    return $verified
}
function Test-Health($Service) {
    if (-not $Service.Health) { return $true } # AI/Gateway: process verification only.
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri $Service.Health -TimeoutSec 4 -MaximumRedirection 0
        if ($response.StatusCode -ne 200) { return $false }
        if ($Service.Kind -eq 'frontend') { return $response.Content -match 'AIVA' -and $response.Content -match '/_next/' }
        return ($response.Content | ConvertFrom-Json).status -eq 'ok'
    } catch { return $false }
}
function Get-ServiceState($Service) {
    $owners = @(Get-Listener $Service.Port)
    if ($owners.Count -eq 0) { return 'free' }
    foreach ($ownerId in $owners) { if (-not (Test-Process $Service $ownerId)) { return 'conflict' } }
    if (Test-Health $Service) { return 'ready' }
    return 'unhealthy'
}
function Start-AivaService($Service) {
    $state = Get-ServiceState $Service
    if ($state -eq 'ready') { Write-Host "REUSE: $($Service.Name); no new process."; return }
    if ($state -ne 'free') {
        Write-Host "BLOCKED: $($Service.Name) port occupied or health invalid. Inspect PID locally; no process stopped."
        $script:failed = $true; return
    }
    if ($Action -ne 'start') { Write-Host "STOPPED: $($Service.Name) port $($Service.Port)."; return }
    if (-not $Service.Ready) {
        Write-Host "SKIPPED: $($Service.Name): $($Service.Reason)"
        if ($Service.Kind -in @('backend','frontend')) { $script:failed = $true }
        return
    }
    $window = Start-Process -FilePath $env:ComSpec -WorkingDirectory $Service.Directory -WindowStyle Normal -ArgumentList @('/d','/k',$Service.Command) -PassThru
    Write-Host "STARTED: $($Service.Name), launcher PID=$($window.Id). Ctrl+C in its [run_all] window stops it."
    $timer = [Diagnostics.Stopwatch]::StartNew()
    do {
        Start-Sleep -Milliseconds 600
        $state = Get-ServiceState $Service
        if ($state -eq 'ready') { Write-Host "READY: $($Service.Name)"; return }
        if ($state -eq 'conflict' -or $window.HasExited) { break }
    } while ($timer.Elapsed.TotalSeconds -lt 45)
    Write-Host "BLOCKED: $($Service.Name) did not become ready. Inspect its terminal; no automatic kill/restart."
    $script:failed = $true
}
$mutex = $null
$acquired = $false
try {
    if ($Action -eq 'stop') {
        Write-Host 'Safe stop: press Ctrl+C in each [run_all] AIVA service window, then close that window.'
        Write-Host 'Reused services belong to their original terminal; stop there only if intended.'
        Write-Host 'This command never kills a PID, process tree, Node.js, MySQL or another service.'
        exit 0
    }
    # Serialize starts in this checkout until listeners and health are ready.
    $hash = [BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($root))).Replace('-','')
    $mutex = New-Object Threading.Mutex($false, "Local\AIVA_start_$hash")
    try { $acquired = $mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $acquired = $true }
    if (-not $acquired) { throw 'Another run_all invocation is still working.' }
    $null = Get-Command node.exe -ErrorAction Stop
    $null = Get-Command npm.cmd -ErrorAction Stop
    $null = Get-NetTCPConnection -State Listen -ErrorAction Stop
    $null = Get-CimInstance Win32_Process -Filter "ProcessId=$PID" -ErrorAction Stop
    $raw = & node.exe (Join-Path $PSScriptRoot 'startup-preflight.cjs')
    if ($LASTEXITCODE -ne 0) { throw 'Read-only preflight failed.' }
    $config = ($raw -join "`n") | ConvertFrom-Json
    if (-not $config.ok) { throw 'Read-only preflight failed.' }
    Write-Host 'PASS: MySQL aiva_iot verified read-only; no migrate/seed.'
    foreach ($account in $config.accounts) { Write-Host "Account ID=$($account.id), role=$($account.roles)" }
    $be = Join-Path $root 'BE'; $fe = Join-Path $root 'frontend\next-app'; $ai = Join-Path $root 'AI_SERVER'
    $bePackage = Get-Content -LiteralPath (Join-Path $be 'package.json') -Raw | ConvertFrom-Json
    $fePackage = Get-Content -LiteralPath (Join-Path $fe 'package.json') -Raw | ConvertFrom-Json
    if ($bePackage.scripts.start -ne 'nest start' -or $fePackage.scripts.dev -notmatch '^next dev ') { throw 'Package startup script changed.' }
    $pythonReady = Test-Path -LiteralPath (Join-Path $ai '.venv\Scripts\python.exe')
    $backendReady = (Test-Path -LiteralPath (Join-Path $be 'node_modules\@nestjs\cli\bin\nest.js')) -and $config.bootstrapSafe -and $config.backendConfigValid
    $frontendReady = Test-Path -LiteralPath (Join-Path $fe 'node_modules\next\dist\bin\next')
    $services = @(
        @{Name='Backend'; Kind='backend'; Port=[int]$config.backendPort; Directory=$be; Health="http://127.0.0.1:$($config.backendPort)/health"; Ready=$backendReady; Reason='dependencies/config invalid or bootstrap account not an existing active verified Admin; no seed attempted'; Command='title [run_all] AIVA Backend & npm.cmd run start'},
        @{Name='Next.js'; Kind='frontend'; Port=[int]$config.frontendPort; Directory=$fe; Health="http://127.0.0.1:$($config.frontendPort)/login"; Ready=$frontendReady; Reason='Next.js dependencies missing; install from the existing lockfile separately'; Command='title [run_all] AIVA Next.js & npm.cmd run dev'},
        @{Name='AI LAN'; Kind='ai'; Port=[int]$config.aiPort; Directory=$ai; Health=$null; Pattern='scripts\\run_(lan|dev)\.py'; Ready=($pythonReady -and $config.aiLanReady); Reason='AI dependencies, matching service tokens or existing TLS LAN settings incomplete'; Command='title [run_all] AIVA AI LAN & call run_lan.cmd'},
        @{Name='Robot Gateway'; Kind='gateway'; Port=8081; Directory=$ai; Health=$null; Pattern='scripts\\run_robot_gateway\.py'; Ready=($pythonReady -and $config.aiBackendReady); Reason='AI dependencies or matching integrated Backend credentials incomplete'; Command='title [run_all] AIVA Robot Gateway & .venv\Scripts\python.exe scripts\run_robot_gateway.py'}
    )
    foreach ($service in $services) { Start-AivaService $service }
    Write-Host "Login: http://127.0.0.1:$($config.frontendPort)/login"
    Write-Host 'AI/Gateway checks are process-only, not AI execution readiness. No contracts/provider/quota changed.'
    Write-Host 'Status: run_all.bat status | Stop instructions: run_all.bat stop'
    if ($script:failed) { exit 1 }
} catch {
    Write-Host 'BLOCKED: Windows process inspection or startup preflight failed. No process is killed.'
    Write-Host 'Check process/network read permissions, Node.js, Backend .env/dependencies and MySQL locally.'
    exit 1
} finally {
    if ($acquired -and $mutex) { $mutex.ReleaseMutex() }
    if ($mutex) { $mutex.Dispose() }
}
