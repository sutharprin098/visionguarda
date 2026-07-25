# ============================================================
# CamAI — Telegram bot helper
# Given a bot token, prints the chat IDs of anyone who has messaged
# the bot (send it any message first), and optionally sends a test.
#
#   ./telegram_helper.ps1 -BotToken "123456:AA..."               # list chat ids
#   ./telegram_helper.ps1 -BotToken "123456:AA..." -ChatId "-100..."  # send test
# ============================================================
param(
  [Parameter(Mandatory=$true)][string]$BotToken,
  [string]$ChatId = ""
)

$ErrorActionPreference = "Stop"
$base = "https://api.telegram.org/bot$BotToken"

if ([string]::IsNullOrWhiteSpace($ChatId)) {
  Write-Host "Fetching recent chats (make sure you've sent the bot a message first)..." -ForegroundColor Cyan
  $r = Invoke-RestMethod -Uri "$base/getUpdates"
  if (-not $r.ok) { Write-Host "Telegram error: $($r.description)" -ForegroundColor Red; exit 1 }
  if ($r.result.Count -eq 0) {
    Write-Host "No messages yet. Open Telegram, find your bot, send it 'hi', then re-run." -ForegroundColor Yellow
    exit 0
  }
  $r.result | ForEach-Object {
    $chat = $_.message.chat
    if ($chat) { Write-Host ("Chat ID: {0,-16}  type={1}  name={2}" -f $chat.id, $chat.type, ($chat.title ?? $chat.first_name)) -ForegroundColor Green }
  }
  Write-Host "`nPick the Chat ID above and re-run with -ChatId to send a test." -ForegroundColor Cyan
} else {
  $body = @{
    chat_id = $ChatId
    text = "✅ CamAI connected. Live alerts from your active detection models will arrive here automatically."
    parse_mode = "HTML"
  } | ConvertTo-Json
  $r = Invoke-RestMethod -Uri "$base/sendMessage" -Method Post -ContentType "application/json" -Body $body
  if ($r.ok) { Write-Host "Test message sent to $ChatId — check Telegram." -ForegroundColor Green }
  else { Write-Host "Telegram error: $($r.description)" -ForegroundColor Red; exit 1 }
}
