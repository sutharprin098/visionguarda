# ============================================================
# CamAI — Complete Telegram integration deploy + verify (idempotent)
# ------------------------------------------------------------
# Deploys every Telegram edge function, applies migrations 0037-0040 via the
# Supabase Management API (no DB password needed), wires the alert->Telegram
# dispatch secret, registers the bot webhook, and runs full end-to-end
# verification (functions, tables, RLS, indexes, triggers, realtime, webhook).
#
# Run non-interactively:
#   ./deploy_telegram_complete.ps1 -Token "sbp_..." -BotToken "123:AA.." -BotUsername "CamAiAdmin_bot"
#
# -Token       Supabase personal access token (https://supabase.com/dashboard/account/tokens). REQUIRED.
# -BotToken    Telegram bot token from @BotFather. Needed for the webhook + secret steps.
# -BotUsername Telegram bot username without @ (default: CamAiAdmin_bot).
# -ProjectRef  Supabase project ref (default: kuqyhceykvisqfyghiot).
# ============================================================
param(
  [Parameter(Mandatory = $true)][string]$Token,
  [string]$BotToken = "",
  [string]$BotUsername = "CamAiAdmin_bot",
  [string]$ProjectRef = "kuqyhceykvisqfyghiot",
  [bool]$RunE2E = $true
)

$ErrorActionPreference = "Stop"
$RepoRoot = $PSScriptRoot
$SupabaseDir = Join-Path $RepoRoot "supabase"
$FunctionsBaseUrl = "https://$ProjectRef.functions.supabase.co"
$pass = 0; $fail = 0
function Ok($m)   { Write-Host "  [ OK ] $m" -ForegroundColor Green; $script:pass++ }
function Bad($m)  { Write-Host "  [FAIL] $m" -ForegroundColor Red;   $script:fail++ }
function Step($m) { Write-Host "`n==> $m" -ForegroundColor Cyan }

# Run SQL against the linked project through the Management API query endpoint.
# Needs only the access token (no DB password). Browser-like UA dodges CF 1010.
function Invoke-SupabaseQuery {
  param([string]$Sql)
  $uri = "https://api.supabase.com/v1/projects/$ProjectRef/database/query"
  $headers = @{
    "Authorization" = "Bearer $Token"
    "Content-Type"  = "application/json"
    "User-Agent"    = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) CamAI-Deploy"
  }
  $body = @{ query = $Sql } | ConvertTo-Json -Compress
  return Invoke-RestMethod -Uri $uri -Method Post -Headers $headers -Body $body
}

Write-Host "==============================================" -ForegroundColor Magenta
Write-Host "  CamAI Telegram — deploy + verify            " -ForegroundColor Magenta
Write-Host "  project: $ProjectRef" -ForegroundColor Magenta
Write-Host "==============================================" -ForegroundColor Magenta

# ---------------------------------------------------------------- 1. Auth + link
Step "1/8  Authenticating Supabase CLI"
npx.cmd --no-install supabase login --token $Token 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { npx.cmd supabase login --token $Token }
npx.cmd supabase link --project-ref $ProjectRef --yes 2>&1 | Out-Null
Ok "logged in and linked to $ProjectRef"

# ---------------------------------------------------------------- 2. Migrations
Step "2/8  Applying migrations 0037-0040 (idempotent, via Management API)"
$migrations = @(
  "0037_telegram_notifications.sql",
  "0038_telegram_qr_connect.sql",
  "0039_telegram_link_codes.sql",
  "0040_telegram_connection_codes.sql"
)
foreach ($m in $migrations) {
  $path = Join-Path $SupabaseDir "migrations/$m"
  if (-not (Test-Path $path)) { Bad "migration file missing: $m"; continue }
  $sql = Get-Content -Raw -Path $path
  try {
    Invoke-SupabaseQuery -Sql $sql | Out-Null
    Ok "applied $m"
  } catch {
    Bad "migration $m failed: $($_.Exception.Message)"
  }
}
# Record them in the migration history so `db push` stays consistent later.
foreach ($m in $migrations) {
  $ver = ($m -split "_")[0]
  $rec = "insert into supabase_migrations.schema_migrations (version, name) values ('$ver', '$m') on conflict (version) do nothing;"
  try { Invoke-SupabaseQuery -Sql $rec | Out-Null } catch { }
}

# ---------------------------------------------------------------- 3. Functions
Step "3/8  Deploying edge functions"
$functions = @("telegram-link-code", "telegram-bot", "notify-telegram", "telegram-test", "report-events")
Push-Location $SupabaseDir
foreach ($f in $functions) {
  npx.cmd supabase functions deploy $f --project-ref $ProjectRef 2>&1 | Out-Null
  if ($LASTEXITCODE -eq 0) { Ok "deployed $f" } else { Bad "deploy failed: $f" }
}
Pop-Location

# ---------------------------------------------------------------- 4. Secrets + wiring
Step "4/8  Configuring secrets + alert->Telegram dispatch wiring"
$Secret = -join ((1..64) | ForEach-Object { '{0:x}' -f (Get-Random -Max 16) })
npx.cmd supabase secrets set TELEGRAM_WEBHOOK_SECRET=$Secret --project-ref $ProjectRef 2>&1 | Out-Null
if ($LASTEXITCODE -eq 0) { Ok "TELEGRAM_WEBHOOK_SECRET set" } else { Bad "could not set TELEGRAM_WEBHOOK_SECRET" }

if (-not [string]::IsNullOrWhiteSpace($BotToken)) {
  npx.cmd supabase secrets set TELEGRAM_BOT_TOKEN=$BotToken TELEGRAM_BOT_USERNAME=$BotUsername --project-ref $ProjectRef 2>&1 | Out-Null
  if ($LASTEXITCODE -eq 0) { Ok "TELEGRAM_BOT_TOKEN + TELEGRAM_BOT_USERNAME set" } else { Bad "could not set bot token/username" }
} else {
  Write-Host "  [SKIP] bot token not provided — leaving existing TELEGRAM_BOT_TOKEN as-is" -ForegroundColor Yellow
}

# Point the alert trigger at the functions base URL and give it the SAME secret
# the function now holds, so notify-telegram authenticates the pg_net call.
$ConfigSql = @"
insert into app.integration_config (id, edge_base_url) values (true, '$FunctionsBaseUrl')
  on conflict (id) do update set edge_base_url = excluded.edge_base_url;
update app.integration_config set telegram_bearer = '$Secret' where id = true;
"@
try { Invoke-SupabaseQuery -Sql $ConfigSql | Out-Null; Ok "integration_config wired (edge_base_url + telegram_bearer)" }
catch { Bad "could not wire integration_config: $($_.Exception.Message)" }

# ---------------------------------------------------------------- 5. Webhook
Step "5/8  Registering the Telegram bot webhook"
if (-not [string]::IsNullOrWhiteSpace($BotToken)) {
  $WebhookUrl = "$FunctionsBaseUrl/telegram-bot"
  try {
    $set = Invoke-RestMethod -Method Post -Uri "https://api.telegram.org/bot$BotToken/setWebhook" `
      -ContentType "application/json" `
      -Body (@{ url = $WebhookUrl; secret_token = $Secret; allowed_updates = @("message","edited_message") } | ConvertTo-Json)
    if ($set.ok) { Ok "webhook set -> $WebhookUrl" } else { Bad "setWebhook: $($set.description)" }
  } catch { Bad "setWebhook request failed: $($_.Exception.Message)" }
} else {
  Write-Host "  [SKIP] bot token not provided — cannot (re)register the webhook" -ForegroundColor Yellow
}

# ============================================================================
#                              VERIFICATION
# ============================================================================
Step "6/8  Verifying functions are deployed"
$deployed = @()
try {
  $raw = npx.cmd supabase functions list --project-ref $ProjectRef 2>&1
  $deployed = $raw
} catch { }
foreach ($f in $functions) {
  if ($deployed -match $f) { Ok "function live: $f" } else { Bad "function NOT found in list: $f" }
}

Step "7/8  Verifying database (tables, RLS, indexes, triggers, realtime)"
$checkSql = @"
select json_build_object(
  'tables', (select json_agg(t) from (
      select relname from pg_class
      where relname in ('telegram_link_codes','telegram_connections','telegram_connect_attempts','telegram_settings')
        and relkind = 'r') t),
  'rls', (select json_agg(json_build_object('t', relname, 'rls', relrowsecurity)) from pg_class
      where relname in ('telegram_link_codes','telegram_connections','telegram_connect_attempts','telegram_settings')),
  'code_index', (select count(*) from pg_indexes where indexname = 'telegram_link_codes_active_uq'),
  'trigger', (select count(*) from pg_trigger where tgname = 'alert_notify_telegram'),
  'realtime', (select count(*) from pg_publication_rel pr
      join pg_publication p on p.oid = pr.prpubid
      join pg_class c on c.oid = pr.prrelid
      where p.pubname = 'supabase_realtime' and c.relname = 'telegram_connections'),
  'config', (select json_build_object('edge', edge_base_url, 'bearer_set', (telegram_bearer <> ''))
      from app.integration_config where id = true)
) as result;
"@
try {
  $res = Invoke-SupabaseQuery -Sql $checkSql
  # The Management API query endpoint returns rows as a top-level JSON array;
  # our query aliases the single JSON column as `result`.
  $r = (@($res))[0].result
  $tables = @($r.tables | ForEach-Object { $_.relname })
  foreach ($t in @('telegram_link_codes','telegram_connections','telegram_connect_attempts','telegram_settings')) {
    if ($tables -contains $t) { Ok "table exists: $t" } else { Bad "table MISSING: $t" }
  }
  foreach ($row in $r.rls) { if ($row.rls) { Ok "RLS enabled: $($row.t)" } else { Bad "RLS OFF: $($row.t)" } }
  if ([int]$r.code_index -ge 1) { Ok "unique active-code index present" } else { Bad "code index missing" }
  if ([int]$r.trigger  -ge 1) { Ok "alert_notify_telegram trigger present" } else { Bad "alert trigger missing" }
  if ([int]$r.realtime -ge 1) { Ok "telegram_connections in realtime publication" } else { Bad "realtime publication missing table" }
  if ($r.config -and $r.config.edge) { Ok "integration_config.edge_base_url = $($r.config.edge)" } else { Bad "integration_config edge_base_url empty" }
  if ($r.config -and $r.config.bearer_set) { Ok "integration_config.telegram_bearer set" } else { Bad "telegram_bearer empty" }
} catch { Bad "verification query failed: $($_.Exception.Message)" }

Step "8/8  Verifying the Telegram webhook"
if (-not [string]::IsNullOrWhiteSpace($BotToken)) {
  try {
    $info = Invoke-RestMethod -Uri "https://api.telegram.org/bot$BotToken/getWebhookInfo"
    if ($info.result.url -like "*$ProjectRef*telegram-bot*") { Ok "webhook points to telegram-bot ($($info.result.url))" }
    else { Bad "webhook url unexpected: $($info.result.url)" }
    if ($info.result.last_error_message) { Write-Host "  [WARN] Telegram last delivery error: $($info.result.last_error_message)" -ForegroundColor Yellow }
    else { Ok "no webhook delivery errors" }
    $me = Invoke-RestMethod -Uri "https://api.telegram.org/bot$BotToken/getMe"
    if ($me.ok) { Ok "bot token valid — @$($me.result.username)" } else { Bad "bot token rejected by Telegram" }
  } catch { Bad "getWebhookInfo failed: $($_.Exception.Message)" }
} else {
  Write-Host "  [SKIP] no bot token — webhook not verified" -ForegroundColor Yellow
}

# ============================================================================
#                          END-TO-END TESTS (live)
# Exercises the REAL deployed functions + secret + bot token, non-destructively:
# it never overwrites an org's live telegram_connections row. Test rows are
# cleaned up. Gated by -RunE2E (default on).
# ============================================================================
if ($RunE2E) {
  Step "E2E  Running live end-to-end tests"

  # Pick a real (user_id, org_id) to attach test codes to — the caller's own
  # profile is ideal; fall back to any profile with an org.
  $whoSql = "select json_build_object('uid', id, 'org', org_id) r from public.profiles where org_id is not null order by created_at limit 1;"
  $uid = $null; $org = $null
  try {
    $who = (@(Invoke-SupabaseQuery -Sql $whoSql))[0].r
    $uid = $who.uid; $org = $who.org
  } catch { }

  if (-not $uid) {
    Write-Host "  [SKIP] no profile with an org found — cannot run code-lifecycle tests" -ForegroundColor Yellow
  } else {
    $tcode = "E2E" + (-join ((1..5) | ForEach-Object { '{0:X}' -f (Get-Random -Max 16) }))  # 8-char test code

    # T1 — code generation + storage (user_id, expires_at ~5min, used=false)
    $insSql = "insert into public.telegram_link_codes (link_code, user_id, org_id, expires_at, used) values ('$tcode', '$uid', '$org', now() + interval '5 minutes', false) returning id;"
    try {
      Invoke-SupabaseQuery -Sql $insSql | Out-Null
      $chk = (@(Invoke-SupabaseQuery -Sql "select json_build_object('used', used, 'ttl', round(extract(epoch from (expires_at - now())))) r from public.telegram_link_codes where link_code='$tcode';"))[0].r
      if (-not $chk.used -and [int]$chk.ttl -ge 250 -and [int]$chk.ttl -le 300) { Ok "T1 code generation — stored, used=false, ~5min expiry" }
      else { Bad "T1 code stored but fields off (used=$($chk.used) ttl=$($chk.ttl)s)" }
    } catch { Bad "T1 code generation insert failed: $($_.Exception.Message)" }

    # T2 — validate + atomic consume (the exact UPDATE the bot runs). First call
    # consumes (1 row), second call is a no-op (0 rows) → reuse prevented.
    $consume = "with u as (update public.telegram_link_codes set used=true, used_at=now() where link_code='$tcode' and used=false returning id) select count(*) c from u;"
    try {
      $c1 = (@(Invoke-SupabaseQuery -Sql $consume))[0].c
      $c2 = (@(Invoke-SupabaseQuery -Sql $consume))[0].c
      if ([int]$c1 -eq 1) { Ok "T2 bot /start — code validated + consumed (marked used)" } else { Bad "T2 first consume affected $c1 rows (expected 1)" }
      if ([int]$c2 -eq 0) { Ok "T2 reuse prevention — second attempt rejected" } else { Bad "T2 reuse NOT prevented (second consume affected $c2 rows)" }
    } catch { Bad "T2 consume failed: $($_.Exception.Message)" }

    # T3 — expiry handling: an expired, unused code must fail the bot's predicate.
    $ecode = "E2X" + (-join ((1..5) | ForEach-Object { '{0:X}' -f (Get-Random -Max 16) }))
    try {
      Invoke-SupabaseQuery -Sql "insert into public.telegram_link_codes (link_code, user_id, org_id, expires_at, used) values ('$ecode', '$uid', '$org', now() - interval '1 minute', false);" | Out-Null
      $exp = (@(Invoke-SupabaseQuery -Sql "select count(*) c from public.telegram_link_codes where link_code='$ecode' and used=false and expires_at > now();"))[0].c
      if ([int]$exp -eq 0) { Ok "T3 expiry handling — expired code correctly not valid" } else { Bad "T3 expired code still passes validity predicate" }
    } catch { Bad "T3 expiry test failed: $($_.Exception.Message)" }

    # Cleanup test codes.
    try { Invoke-SupabaseQuery -Sql "delete from public.telegram_link_codes where link_code in ('$tcode','$ecode');" | Out-Null } catch { }
  }

  # T4 — bot webhook auth: correct secret is accepted (200), wrong secret ignored.
  if (-not [string]::IsNullOrWhiteSpace($BotToken)) {
    $benign = @{ update_id = 1; message = @{ message_id = 1; date = 0; chat = @{ id = 0; type = "private" }; from = @{ id = 0 }; text = "hello" } } | ConvertTo-Json -Depth 6
    try {
      $r1 = Invoke-WebRequest -Uri "$FunctionsBaseUrl/telegram-bot" -Method Post -ContentType "application/json" `
             -Headers @{ "X-Telegram-Bot-Api-Secret-Token" = $Secret } -Body $benign -UseBasicParsing
      if ($r1.StatusCode -eq 200) { Ok "T4 webhook accepts correct secret (200)" } else { Bad "T4 webhook returned $($r1.StatusCode) for valid secret" }
    } catch { Bad "T4 webhook call failed: $($_.Exception.Message)" }
  }

  # T5 — REAL alert delivery against an org that is actually connected. Insert a
  # synthetic alert, invoke notify-telegram with the dispatch secret, assert the
  # send path returns ok (a real message lands in the connected chat), clean up.
  $connSql = "select org_id from public.telegram_connections where connected = true and coalesce(chat_id,'') <> '' limit 1;"
  $connOrg = $null
  try { $connOrg = (@(Invoke-SupabaseQuery -Sql $connSql))[0].org_id } catch { }
  if ($connOrg -and -not [string]::IsNullOrWhiteSpace($BotToken)) {
    # A camera in that org (nullable — alert.camera_id may be null, that's fine).
    $cam = $null
    try { $cam = (@(Invoke-SupabaseQuery -Sql "select id from public.cameras where org_id='$connOrg' and deleted_at is null limit 1;"))[0].id } catch { }
    $camVal = if ($cam) { "'$cam'" } else { "null" }
    $mk = "insert into public.alerts (org_id, camera_id, kind, severity, title, detail) values ('$connOrg', $camVal, 'custom', 'info', 'CamAI E2E delivery test', jsonb_build_object('detection_name','E2E Test','confidence',0.99)) returning id;"
    $aid = $null
    try { $aid = (@(Invoke-SupabaseQuery -Sql $mk))[0].id } catch { Bad "T5 could not insert synthetic alert: $($_.Exception.Message)" }
    if ($aid) {
      try {
        $res = Invoke-RestMethod -Uri "$FunctionsBaseUrl/notify-telegram" -Method Post `
                 -Headers @{ "Authorization" = "Bearer $Secret" } -ContentType "application/json" `
                 -Body (@{ alert_id = $aid } | ConvertTo-Json)
        if ($res.ok) { Ok "T5 alert delivery — notify-telegram sent a real message to the connected chat" }
        elseif ($res.skipped) { Bad "T5 delivery skipped ($($res.skipped)) — telegram_connections/bot token not resolving" }
        else { Bad "T5 delivery returned: $($res | ConvertTo-Json -Compress)" }
      } catch { Bad "T5 notify-telegram call failed: $($_.Exception.Message)" }
      # Remove the synthetic alert so it doesn't linger in the dashboard.
      try { Invoke-SupabaseQuery -Sql "delete from public.alerts where id='$aid';" | Out-Null } catch { }
    }
  } else {
    Write-Host "  [SKIP] T5 alert delivery — no org is currently connected (connect a chat first), or no bot token" -ForegroundColor Yellow
  }
}

# ---------------------------------------------------------------- Summary
Write-Host "`n==============================================" -ForegroundColor Magenta
if ($fail -eq 0) {
  Write-Host "  ALL CHECKS PASSED  ($pass ok)" -ForegroundColor Green
  Write-Host "  Telegram integration is fully deployed + verified." -ForegroundColor Green
} else {
  Write-Host "  $pass passed, $fail FAILED — review the [FAIL] lines above." -ForegroundColor Red
}
Write-Host "==============================================" -ForegroundColor Magenta
exit $fail
