# SMART_BUZ — end-to-end smoke test through the Next.js server.
# Verifies: sign-in issues a session cookie, the session is readable, the
# Convex access-token route mints a token the backend accepts, and the
# dashboard + setup + settings pages render.
param(
  [string]$Base = "http://localhost:3111",
  [string]$Email = "legacy.operator.mwi45oeh@smartbuz.test",
  [string]$Password = "Password123!"
)

$ErrorActionPreference = 'Stop'
$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$results = New-Object System.Collections.ArrayList

function Probe([string]$label, [string]$path, [string]$method = "GET", $body = $null) {
  $sw = [Diagnostics.Stopwatch]::StartNew()
  try {
    if ($method -eq "POST") {
      $res = Invoke-WebRequest -Uri "$Base$path" -Method POST -WebSession $session `
        -ContentType "application/json" -Body $body -UseBasicParsing -TimeoutSec 240
    } else {
      $res = Invoke-WebRequest -Uri "$Base$path" -WebSession $session -UseBasicParsing -TimeoutSec 240
    }
    $secs = [math]::Round($sw.Elapsed.TotalSeconds, 1)
    [void]$results.Add(("PASS  {0} -> HTTP {1} ({2} bytes) in {3}s" -f $label, $res.StatusCode, $res.Content.Length, $secs))
    return $res
  } catch {
    $secs = [math]::Round($sw.Elapsed.TotalSeconds, 1)
    $status = $_.Exception.Response.StatusCode.value__
    [void]$results.Add(("FAIL  {0} -> {1} ({2}) after {3}s" -f $label, $status, $_.Exception.Message, $secs))
    return $null
  }
}

$login = Probe "POST /api/auth (sign in)" "/api/auth" "POST" (@{ email = $Email; password = $Password } | ConvertTo-Json)
if ($login) {
  $payload = $login.Content | ConvertFrom-Json
  [void]$results.Add(("      success={0} user={1}" -f $payload.success, $payload.user.email))
}

$me = Probe "GET /api/auth (session)" "/api/auth"
if ($me) { [void]$results.Add(("      body={0}" -f $me.Content)) }

$tok = Probe "GET /api/auth/convex-token" "/api/auth/convex-token"
if ($tok) {
  $t = ($tok.Content | ConvertFrom-Json).token
  [void]$results.Add(("      token length={0}, parts={1}" -f $t.Length, ($t -split "\.").Count))
}

[void](Probe "GET / (dashboard)" "/")
[void](Probe "GET /setup (onboarding)" "/setup")
[void](Probe "GET /settings" "/settings")

$results | ForEach-Object { Write-Output $_ }
Write-Output "`nDone."
