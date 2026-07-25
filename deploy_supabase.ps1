# ============================================================
# CamAI — End-to-End Supabase Deploy & Setup Script
# Applies all database migrations, deploys edge functions,
# and sets up Telegram Alerts configuration secrets.
# ============================================================

$ErrorActionPreference = "Stop"

# Run arbitrary SQL against the linked project via the Supabase Management API
# query endpoint. This needs only the personal access token (no DB password),
# and a browser-like User-Agent so Cloudflare doesn't 1010-block the request.
function Invoke-SupabaseQuery {
    param([string]$ProjectRef, [string]$Token, [string]$Sql)
    $uri = "https://api.supabase.com/v1/projects/$ProjectRef/database/query"
    $headers = @{
        "Authorization" = "Bearer $Token"
        "Content-Type"  = "application/json"
        "User-Agent"    = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) CamAI-Deploy"
    }
    $body = @{ query = $Sql } | ConvertTo-Json -Compress
    return Invoke-RestMethod -Uri $uri -Method Post -Headers $headers -Body $body
}

Write-Host "==============================================" -ForegroundColor Cyan
Write-Host "   CamAI Supabase Setup & Deploy Assistant    " -ForegroundColor Cyan
Write-Host "==============================================" -ForegroundColor Cyan
Write-Host ""

# 1. Ask for Project ID
$ProjectRef = Read-Host "Enter your Supabase Project ID [default: kuqyhceykvisqfyghiot]"
if ([string]::IsNullOrWhiteSpace($ProjectRef)) {
    $ProjectRef = "kuqyhceykvisqfyghiot"
}

# 2. Authenticate
Write-Host "`n==> 1/5 Checking Supabase CLI login..." -ForegroundColor Cyan
$Token = Read-Host "Enter your Supabase Access Token (Leave empty to use existing session)"

if (-not [string]::IsNullOrWhiteSpace($Token)) {
    Write-Host "Logging in using provided token..." -ForegroundColor Yellow
    npx.cmd supabase login --token $Token
} else {
    # Check if already logged in safely
    $loggedIn = $true
    try {
        $oldPref = $ErrorActionPreference
        $ErrorActionPreference = "SilentlyContinue"
        # Run command and swallow output/error to check status
        $null = npx.cmd supabase projects list 2>&1
        if ($LASTEXITCODE -ne 0) {
            $loggedIn = $false
        }
    } catch {
        $loggedIn = $false
    } finally {
        $ErrorActionPreference = $oldPref
    }

    if (-not $loggedIn) {
        Write-Host "Not logged in (or session expired). Please obtain an access token from: https://supabase.com/dashboard/account/tokens" -ForegroundColor Yellow
        $Token = Read-Host "Paste your token here"
        if ([string]::IsNullOrWhiteSpace($Token)) {
            Write-Host "Error: Access token is required to deploy." -ForegroundColor Red
            exit 1
        }
        npx.cmd supabase login --token $Token
    } else {
        Write-Host "Using existing active Supabase session." -ForegroundColor Green
    }
}

# 3. Link Project
Write-Host "`n==> 2/5 Linking project $ProjectRef..." -ForegroundColor Cyan
npx.cmd supabase link --project-ref $ProjectRef --yes
if ($LASTEXITCODE -ne 0) {
    Write-Host "Failed to link project." -ForegroundColor Red
    exit 1
}

# 4. Push Database Migrations
Write-Host "`n==> 3/5 Pushing database migrations..." -ForegroundColor Cyan
npx.cmd supabase db push
if ($LASTEXITCODE -ne 0) {
    Write-Host "Failed to push database migrations." -ForegroundColor Red
    exit 1
}
Write-Host "Database migrations applied successfully!" -ForegroundColor Green

# 5. Deploy Edge Functions
Write-Host "`n==> 4/5 Deploying edge functions..." -ForegroundColor Cyan
$functions = @(
    "activate-license",
    "my-keys",
    "desktop-sync",
    "invite-user",
    "add-camera",
    "test-camera",
    "github-releases",
    "download-release",
    "telegram-link-code",
    "telegram-bot",
    "notify-telegram",
    "telegram-test"
)

foreach ($func in $functions) {
    Write-Host "Deploying function: $func..." -ForegroundColor Yellow
    npx.cmd supabase functions deploy $func --project-ref $ProjectRef
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Failed to deploy function $func." -ForegroundColor Red
        exit 1
    }
}
Write-Host "All edge functions deployed successfully!" -ForegroundColor Green

# 6. Configure Secrets
Write-Host "`n==> 5/5 Setting up Telegram integration secrets..." -ForegroundColor Cyan
$BotToken = Read-Host "Enter your Shared Telegram Bot Token (e.g. 123456:ABC...)"
$BotUsername = Read-Host "Enter your Telegram Bot Username (without @, e.g. CamAI_Alert_Bot)"

if (-not [string]::IsNullOrWhiteSpace($BotToken) -and -not [string]::IsNullOrWhiteSpace($BotUsername)) {
    Write-Host "Setting secrets in remote Supabase project..." -ForegroundColor Yellow
    npx.cmd supabase secrets set TELEGRAM_BOT_TOKEN=$BotToken TELEGRAM_BOT_USERNAME=$BotUsername --project-ref $ProjectRef
    
    # Generate secure random secret for pg_net webhook authentication
    $Secret = -join ((1..64) | ForEach-Object { '{0:x}' -f (Get-Random -Max 16) })
    npx.cmd supabase secrets set TELEGRAM_WEBHOOK_SECRET=$Secret --project-ref $ProjectRef
    
    # Setup Telegram Webhook URL. On the functions subdomain, functions are
    # served at /{name} (NO /functions/v1 prefix) — this MUST match the same
    # base the trigger uses for notify-telegram (edge_base_url below), or the
    # bot silently never receives messages.
    $WebhookUrl = "https://$ProjectRef.functions.supabase.co/telegram-bot"
    Write-Host "Registering bot webhook with Telegram..." -ForegroundColor Yellow
    
    # Send setWebhook request to Telegram
    try {
        $tgUrl = "https://api.telegram.org/bot$BotToken/setWebhook?url=$WebhookUrl&secret_token=$Secret"
        $response = Invoke-RestMethod -Uri $tgUrl -Method Get
        if ($response.ok) {
            Write-Host "Telegram bot webhook set successfully!" -ForegroundColor Green
        } else {
            Write-Host "Failed to set Telegram webhook: $($response.description)" -ForegroundColor Red
        }
    } catch {
        Write-Host "Error setting Telegram webhook: $_" -ForegroundColor Red
    }

    # Verify the webhook registered and is healthy (this is what "/start silent"
    # bugs show up in — a wrong url or a last_error_message here).
    try {
        $info = Invoke-RestMethod -Uri "https://api.telegram.org/bot$BotToken/getWebhookInfo" -Method Get
        Write-Host "Webhook now points to: $($info.result.url)" -ForegroundColor Cyan
        if ($info.result.last_error_message) {
            Write-Host "  Telegram's last delivery error: $($info.result.last_error_message)" -ForegroundColor Red
        } else {
            Write-Host "  No delivery errors reported by Telegram." -ForegroundColor Green
        }
        Write-Host "  Pending updates queued: $($info.result.pending_update_count)" -ForegroundColor Gray
    } catch {
        Write-Host "Could not fetch webhook info: $_" -ForegroundColor Red
    }

    # Wire the alert->Telegram trigger: point it at the functions base URL and
    # give it the SAME webhook secret we just set on the function, so the
    # notify-telegram call authenticates. Because TELEGRAM_WEBHOOK_SECRET is
    # regenerated every run, this MUST run every run or the notify path 403s.
    $FunctionsBaseUrl = "https://$ProjectRef.functions.supabase.co"
    $ConfigSql = @"
insert into app.integration_config (id, edge_base_url) values (true, '$FunctionsBaseUrl')
  on conflict (id) do update set edge_base_url = excluded.edge_base_url;
update app.integration_config set telegram_bearer = '$Secret' where id = true;
"@

    if (-not [string]::IsNullOrWhiteSpace($Token)) {
        Write-Host "Wiring the alert trigger (integration_config) via Management API..." -ForegroundColor Yellow
        try {
            Invoke-SupabaseQuery -ProjectRef $ProjectRef -Token $Token -Sql $ConfigSql | Out-Null
            Write-Host "Alert trigger wired: edge_base_url + telegram_bearer set." -ForegroundColor Green
        } catch {
            Write-Host "Could not auto-wire integration_config: $_" -ForegroundColor Red
            Write-Host "Run these two statements in the Supabase SQL Editor manually:" -ForegroundColor Yellow
            Write-Host $ConfigSql -ForegroundColor Gray
        }
    } else {
        Write-Host "`nNo access token captured — run these queries in your Supabase SQL Editor to wire the trigger:" -ForegroundColor Yellow
        Write-Host $ConfigSql -ForegroundColor Gray
    }

    Write-Host "`nSecret Configuration Complete!" -ForegroundColor Green
} else {
    Write-Host "Skipped Telegram secrets configuration. You can run them manually later using:" -ForegroundColor Yellow
    Write-Host "  npx supabase secrets set TELEGRAM_BOT_TOKEN=... TELEGRAM_BOT_USERNAME=..." -ForegroundColor Gray
}

Write-Host "`n==============================================" -ForegroundColor Green
Write-Host "   Supabase deployment finished successfully! " -ForegroundColor Green
Write-Host "==============================================" -ForegroundColor Green
