# ============================================================
# CamAI - Website deploy (portal -> Vercel, edge functions -> Supabase)
#
# One command for the two things that have to ship together after a change
# to the camera form: the built portal, and the edge functions that validate
# what the form submits. Deploying only one of them leaves the UI promising
# something the backend still rejects.
#
#   .\deploy_website.ps1                  # build + deploy both
#   .\deploy_website.ps1 -SkipFunctions   # portal only
#   .\deploy_website.ps1 -SkipPortal      # edge functions only
#   .\deploy_website.ps1 -CheckOnly       # just the reachability preflight
# ============================================================
param(
    [string]$ProjectRef = "kuqyhceykvisqfyghiot",
    [string]$SupabaseToken = "",
    [switch]$SkipPortal,
    [switch]$SkipFunctions,
    [switch]$CheckOnly
)

$ErrorActionPreference = "Stop"
$RepoRoot = $PSScriptRoot

# Edge functions that embed _shared/util.ts's verifyCameraConnection. A change
# to camera validation is only live once these three are redeployed - the
# portal calls test-camera to validate, and add/update-camera re-validate
# server-side before writing, so a stale copy silently rejects a URL the UI
# has already told the operator is fine.
$Functions = @("test-camera", "add-camera", "update-camera")

function Test-Host443 {
    param([string]$HostName)
    try {
        return (Test-NetConnection -ComputerName $HostName -Port 443 `
                -InformationLevel Quiet -WarningAction SilentlyContinue)
    } catch { return $false }
}

Write-Host "==============================================" -ForegroundColor Cyan
Write-Host "   CamAI Website Deploy                       " -ForegroundColor Cyan
Write-Host "==============================================" -ForegroundColor Cyan

# --- Preflight ------------------------------------------------------------
# Both CLIs fail on a blocked network with a bare ETIMEDOUT after ~20s and no
# hint that the network, not the credentials, is the problem. Ask directly.
Write-Host "`n==> Preflight: can this machine reach the deploy endpoints?" -ForegroundColor Cyan
$vercelUp   = Test-Host443 "api.vercel.com"
$supabaseUp = Test-Host443 "api.supabase.com"
Write-Host ("    api.vercel.com:443    {0}" -f $(if ($vercelUp) { "reachable" } else { "BLOCKED" })) `
    -ForegroundColor $(if ($vercelUp) { "Green" } else { "Red" })
Write-Host ("    api.supabase.com:443  {0}" -f $(if ($supabaseUp) { "reachable" } else { "BLOCKED" })) `
    -ForegroundColor $(if ($supabaseUp) { "Green" } else { "Red" })

if (-not ($vercelUp -and $supabaseUp)) {
    Write-Host "`n    A blocked endpoint here is a network problem, not a login problem." -ForegroundColor Yellow
    Write-Host "    Some campus/office networks and a few ISPs block vercel.com and" -ForegroundColor Yellow
    Write-Host "    github.com outright. Try a mobile hotspot or a VPN and re-run." -ForegroundColor Yellow
}
if ($CheckOnly) { exit 0 }
if (-not $SkipPortal -and -not $vercelUp) {
    Write-Host "`nAborting: cannot reach Vercel. Re-run with -SkipPortal to deploy functions only." -ForegroundColor Red
    exit 1
}
if (-not $SkipFunctions -and -not $supabaseUp) {
    Write-Host "`nAborting: cannot reach Supabase. Re-run with -SkipFunctions to deploy the portal only." -ForegroundColor Red
    exit 1
}

# --- Portal ---------------------------------------------------------------
if (-not $SkipPortal) {
    Write-Host "`n==> 1/2 Building and deploying the portal..." -ForegroundColor Cyan
    Push-Location (Join-Path $RepoRoot "portal")
    try {
        # Built here rather than on Vercel so a type error surfaces now, on a
        # machine with the full toolchain, instead of as a failed remote build.
        npm run build
        if ($LASTEXITCODE -ne 0) { Write-Host "Portal build failed." -ForegroundColor Red; exit 1 }

        # --prebuilt is deliberately NOT used: vercel.json's headers/rewrites
        # are applied by the platform build, and the local dist alone does not
        # carry them.
        npx.cmd vercel deploy --prod --yes
        if ($LASTEXITCODE -ne 0) { Write-Host "Vercel deploy failed." -ForegroundColor Red; exit 1 }
        Write-Host "Portal deployed." -ForegroundColor Green
    } finally { Pop-Location }
}

# --- Edge functions -------------------------------------------------------
if (-not $SkipFunctions) {
    Write-Host "`n==> 2/2 Deploying edge functions..." -ForegroundColor Cyan
    if (-not [string]::IsNullOrWhiteSpace($SupabaseToken)) {
        npx.cmd supabase login --token $SupabaseToken
        if ($LASTEXITCODE -ne 0) { Write-Host "Supabase login failed." -ForegroundColor Red; exit 1 }
    }
    foreach ($func in $Functions) {
        Write-Host "    deploying $func..." -ForegroundColor Yellow
        npx.cmd supabase functions deploy $func --project-ref $ProjectRef
        if ($LASTEXITCODE -ne 0) {
            Write-Host "Failed to deploy $func." -ForegroundColor Red
            Write-Host "If this says 'not logged in', pass -SupabaseToken <token> from" -ForegroundColor Yellow
            Write-Host "https://supabase.com/dashboard/account/tokens" -ForegroundColor Yellow
            exit 1
        }
    }
    Write-Host "Edge functions deployed." -ForegroundColor Green
}

Write-Host "`nDone. Portal: https://portal-gilt-iota.vercel.app" -ForegroundColor Cyan
