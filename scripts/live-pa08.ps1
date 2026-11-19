[CmdletBinding()]
param(
  [string]$BackendUrl = 'http://127.0.0.1:3000',
  [string]$AiServerUrl = 'http://127.0.0.1:8002',
  [string]$Timezone = 'Asia/Bangkok'
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Read-EnvValue([string]$Path, [string]$Name) {
  foreach ($line in [IO.File]::ReadAllLines($Path)) {
    if ($line -match ('^' + [regex]::Escape($Name) + '=(.*)$')) { return $matches[1] }
  }
  throw "Missing required local configuration: $Name"
}

function SecureString-ToPlainText([Security.SecureString]$Value) {
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Value)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

function Invoke-Json([string]$Method, [string]$Uri, [hashtable]$Headers, $Body = $null) {
  $args = @{ Method = $Method; Uri = $Uri; Headers = $Headers; UseBasicParsing = $true; TimeoutSec = 120 }
  if ($null -ne $Body) {
    $args.ContentType = 'application/json; charset=utf-8'
    $args.Body = $Body | ConvertTo-Json -Depth 12 -Compress
  }
  $response = Invoke-WebRequest @args
  return @{ Status = [int]$response.StatusCode; Json = $response.Content | ConvertFrom-Json }
}

$repo = Split-Path -Parent $PSScriptRoot
$backendEnv = Join-Path $repo 'BE\.env'
$aiEnv = Join-Path $repo 'AI_SERVER\.env.local'
$toolServiceToken = Read-EnvValue $backendEnv 'AI_TOOL_SERVICE_TOKEN'
$localChatToken = Read-EnvValue $aiEnv 'LOCAL_LLM_CHAT_TOKEN'

$email = Read-Host 'Email USER test'
$securePassword = Read-Host 'Password' -AsSecureString
$password = SecureString-ToPlainText $securePassword

try {
  $login = Invoke-Json POST "$BackendUrl/auth/login" @{} @{ email = $email; password = $password }
  $password = $null
  $securePassword.Dispose()
  if ($login.Status -ne 200 -or [string]::IsNullOrWhiteSpace($login.Json.access_token)) { throw 'LOGIN_RESPONSE_INVALID' }
  Write-Host 'LOGIN PASS'

  $accessToken = [string]$login.Json.access_token
  $userHeaders = @{ Authorization = "Bearer $accessToken" }
  $me = Invoke-Json GET "$BackendUrl/auth/me" $userHeaders
  if ($me.Status -ne 200 -or [string]::IsNullOrWhiteSpace($me.Json.id) -or $me.Json.role -ne 'USER') {
    throw 'JWT_OR_USER_ROLE_INVALID'
  }
  Write-Host 'JWT PASS'

  $sessionId = 'pa08_' + [guid]::NewGuid().ToString('N')
  $delegation = Invoke-Json POST "$BackendUrl/auth/tool-delegations" $userHeaders @{
    scope = 'schedule.query'; session_id = $sessionId
  }
  if ($delegation.Status -ne 200 -or $delegation.Json.scope -ne 'schedule.query' -or
      [string]::IsNullOrWhiteSpace($delegation.Json.delegation_token)) { throw 'DELEGATION_RESPONSE_INVALID' }
  Write-Host 'DELEGATION PASS'

  $delegationToken = [string]$delegation.Json.delegation_token
  $now = [TimeZoneInfo]::ConvertTimeBySystemTimeZoneId([DateTimeOffset]::UtcNow, 'SE Asia Standard Time')
  $from = [DateTimeOffset]::new($now.Year, $now.Month, $now.Day, 0, 0, 0, $now.Offset).ToUniversalTime().ToString('o')
  $to = [DateTimeOffset]::new($now.Year, $now.Month, $now.Day, 23, 59, 59, $now.Offset).ToUniversalTime().ToString('o')
  $query = '?session_id=' + [uri]::EscapeDataString($sessionId) + '&from=' + [uri]::EscapeDataString($from) + '&to=' + [uri]::EscapeDataString($to)
  $toolHeaders = @{ Authorization = "Bearer $delegationToken"; 'X-AI-Tool-Service' = $toolServiceToken }
  $schedule = Invoke-Json GET "$BackendUrl/internal/tool-execution/schedule$query" $toolHeaders
  if ($schedule.Status -ne 200 -or $null -eq $schedule.Json.items) { throw 'BACKEND_SCHEDULE_RESPONSE_INVALID' }
  $scheduleCount = @($schedule.Json.items).Count
  Write-Host "BACKEND SCHEDULE PASS (items=$scheduleCount)"
  Write-Host 'MYSQL LIVE PASS'

  $chatHeaders = @{ Authorization = "Bearer $localChatToken" }
  $chat = Invoke-Json POST "$AiServerUrl/local/chat" $chatHeaders @{
    user_id = [string]$me.Json.id
    session_id = $sessionId
    content = 'Hôm nay tôi có lịch gì?'
    timezone = $Timezone
    delegation = $delegationToken
    stream = $false
    personalize = $false
  }
  if ($chat.Status -ne 200 -or $chat.Json.tool -ne 'schedule.query' -or $chat.Json.grounded -ne $true) {
    throw 'AI_SERVER_PA08_RESPONSE_INVALID'
  }
  Write-Host 'AI_SERVER PA-08 PASS'
  Write-Host 'LLM/TOOL GROUNDED RESPONSE:'
  Write-Host ([string]$chat.Json.content)
  Write-Host 'PA-08 AI LIVE PASS'
}
catch {
  $password = $null
  Write-Host ('PA-08 LIVE FAIL: ' + $_.Exception.Message)
  exit 1
}
finally {
  $accessToken = $null
  $delegationToken = $null
  $toolServiceToken = $null
  $localChatToken = $null
}
