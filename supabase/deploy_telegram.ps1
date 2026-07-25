# ============================================================
# CamAI — one-shot Telegram notifications deploy
# Applies migration 0037, deploys the edge functions, and (if a
# service-role key is supplied) wires the pg_net dispatch config.
#
# Run from the repo's supabase/ folder AFTER `supabase login`:
#   ./deploy_telegram.ps1
# or with the dispatch config in one go:
#   ./deploy_telegram.ps1 -ServiceRoleKey "eyJ...service_role..."
# ============================================================
param(
  [string]$ServiceRoleKey = "",
  [string]$ProjectRef = "kuqyhceykvisqfyghiot"
)

$ErrorActionPreference = "Stop"
$FunctionsBaseUrl = "https://$ProjectRef.functions.supabase.co"

Write-Host "==> 1/4  Verifying Supabase CLI login..." -ForegroundColor Cyan
npx --no-install supabase projects list *> $null
if ($LASTEXITCODE -ne 0) {
  Write-Host "   Not logged in. Run:  npx supabase login   then re-run this script." -ForegroundColor Yellow
  exit 1
}

Write-Host "==> 2/4  Applying database migrations (0037 telegram)..." -ForegroundColor Cyan
npx supabase db push
if ($LASTEXITCODE -ne 0) { Write-Host "   db push failed." -ForegroundColor Red; exit 1 }

Write-Host "==> 3/4  Deploying edge functions..." -ForegroundColor Cyan
# report-events changed (detection_name); notify-telegram + telegram-test are new.
npx supabase functions deploy report-events notify-telegram telegram-test
if ($LASTEXITCODE -ne 0) { Write-Host "   functions deploy failed." -ForegroundColor Red; exit 1 }

Write-Host "==> 4/4  Wiring the alert->function webhook secret..." -ForegroundColor Cyan
# The trigger authenticates to notify-telegram with a dedicated shared secret
# (TELEGRAM_WEBHOOK_SECRET on the function == integration_config.telegram_bearer),
# so it works regardless of legacy vs new (sb_secret_...) service keys.
$Secret = -join ((1..64) | ForEach-Object { '{0:x}' -f (Get-Random -Max 16) })
npx supabase secrets set TELEGRAM_WEBHOOK_SECRET=$Secret --project-ref $ProjectRef
if ($LASTEXITCODE -ne 0) { Write-Host "   secrets set failed." -ForegroundColor Red; exit 1 }

Write-Host "   Function secret set. Now run these two lines once in the SQL editor" -ForegroundColor Yellow
Write-Host "   (Dashboard > SQL) to point the trigger at the function with the SAME secret:" -ForegroundColor Yellow
Write-Host "     insert into app.integration_config (id, edge_base_url) values (true, '$FunctionsBaseUrl')" -ForegroundColor Gray
Write-Host "       on conflict (id) do update set edge_base_url = excluded.edge_base_url;" -ForegroundColor Gray
Write-Host "     update app.integration_config set telegram_bearer = '$Secret' where id = true;" -ForegroundColor Gray
if (-not [string]::IsNullOrWhiteSpace($ServiceRoleKey)) {
  Write-Host "   (Optional, also enables email) select app.configure_email_dispatch('$FunctionsBaseUrl', '<service-role-key>');" -ForegroundColor Gray
}

Write-Host ""
Write-Host "Done. Next: open the portal > Settings > Telegram, paste the Bot Token + Chat ID," -ForegroundColor Green
Write-Host "toggle Enable, and click Test Connection." -ForegroundColor Green
