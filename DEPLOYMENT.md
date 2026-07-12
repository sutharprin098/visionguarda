# CamAI — End-to-End Deployment & Operations Guide

This is the practical, "how is this actually live and how do I run it" companion to
`PLATFORM.md` (architecture) and `HANDOVER.md` (buyer due-diligence). It documents the
real, current deployment of the web portal and every module's backend wiring.

## 1. What's deployed right now

| Piece | Where | Notes |
|---|---|---|
| Source | `github.com/sutharprin098/visionguarda` (private) | Full history, `main` branch |
| Web portal | Vercel project `portal` → `https://portal-gilt-iota.vercel.app` | Vite/React SPA, static build |
| Database + Auth + Realtime + Storage + Edge Functions | Supabase project `mxymrxzhsogfkvkhtwjl` | `supabase/migrations/0001`–`0009` |
| Desktop app | Built locally with `electron-builder` (NSIS) | Not auto-deployed — published as a GitHub Release asset (see §5) |

## 2. Repo layout

```
client/    Standalone local CCTV viewer (MJPEG + WS telemetry) — not part of the SaaS portal
server/    Local AI engine (FastAPI, YOLO11, ByteTrack) — runs on the customer's machine/LAN
portal/    SaaS admin portal (this is what's deployed to Vercel)
desktop/   Windows Electron app — license activation + realtime workspace
supabase/  Multi-tenant backend: Postgres+RLS, Auth, Realtime, Storage, Edge Functions
```

## 3. Redeploying the portal (Vercel)

```bash
cd portal
npm install
vercel link          # first time only — creates/attaches the Vercel project
vercel --prod --yes  # ships a new production deployment
```

Required Vercel environment variables (Project Settings → Environment Variables, or
`vercel env add <NAME> production|preview|development`):

| Variable | Value |
|---|---|
| `VITE_SUPABASE_URL` | `https://mxymrxzhsogfkvkhtwjl.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | anon key from the Supabase project's API settings |
| `VITE_SUPABASE_PROJECT_ID` | `mxymrxzhsogfkvkhtwjl` |

`portal/vercel.json` sets the build command (`npm run build`), output directory
(`dist`), and an SPA rewrite (`/* → /index.html`) so client-side routing works.

## 4. Deploying/updating the Supabase backend

```bash
cd supabase
npx supabase login                              # one-time, opens a browser
npx supabase link --project-ref mxymrxzhsogfkvkhtwjl
npx supabase db push                            # applies migrations 0001–0009
npx supabase functions deploy activate-license my-keys desktop-sync invite-user \
  add-camera test-camera github-releases download-release

npx supabase secrets set CAMAI_AES_KEY=$(openssl rand -hex 32)          # camera credential encryption
npx supabase secrets set GITHUB_RELEASES_REPO=<owner>/<repo>            # powers Downloads
npx supabase secrets set GITHUB_TOKEN=<pat-with-repo-read>              # required if that repo is private (it is, by default)
```

Post-migration manual step: migration `0008` schedules a daily `pg_cron` job
(`check_expiring_licenses`). If the project doesn't have the `pg_cron` extension
enabled yet, the migration logs a notice instead of failing — enable it once via
**Dashboard → Database → Extensions → pg_cron**, then re-run:
```sql
select cron.schedule('check-expiring-licenses', '0 8 * * *', $$select app.check_expiring_licenses()$$);
```

## 5. Desktop app: build, activate, and publish a release

```bash
cd desktop
npm install
npm run build     # tsc + vite build + electron-builder --win
                  # -> desktop/dist/CamAI-Desktop-Setup-<version>.exe
```

The Supabase URL/anon key are compiled-in defaults in `electron/main.ts` (same
public-safe anon key the portal ships in its own browser bundle), overridable via
`CAMAI_SUPABASE_URL` / `CAMAI_SUPABASE_ANON_KEY` env vars at build time if you ever
point the desktop app at a different Supabase project.

**Windows-only build note:** `electron-builder` downloads a code-signing/resource
toolkit (`winCodeSign`) that contains a few macOS symlink entries. Extracting them
needs the "Create symbolic links" privilege. If the build fails with
`Cannot create symbolic link : A required privilege is not held by the client`,
either enable **Developer Mode** (Settings → Privacy & Security → For Developers)
or run the build once from an elevated terminal.

**Publishing a release** (this is what the Downloads page reads from):
1. Tag and create a GitHub Release on the repo set in `GITHUB_RELEASES_REPO`.
2. Attach the built `.exe` as a release asset.
3. Nothing else — the `github-releases` edge function polls the GitHub Releases
   API live (with a 60s cache) and the Downloads page refetches every 5 minutes.
   The first time it sees a new tag, it also fires an `app_update` notification
   to every organization (migration `0008`).

**Activation flow** (first launch → ready, no login screen ever shown):
1. `Activation.tsx` collects a license key → `window.camai.activate(key)`.
2. Electron's main process (`electron/main.ts`) computes a hardware fingerprint
   (`fingerprint.ts`) and POSTs it with the key to the `activate-license` edge
   function, which verifies the license, binds the device, and mints a session.
3. The refresh token is saved DPAPI-encrypted (`secureStore.ts`) — the license key
   is never asked for again unless the user logs out, the license is revoked, or
   the device is deactivated/removed (checked on every `desktop-sync` call via the
   `x-device-id` header — fails closed with `403 {code:"deactivated"}`).
4. `Workspace.tsx` + `lib/sync.ts` fetch the full state bundle (profile, org, roles,
   assigned cameras, settings, notifications) and subscribe to Realtime changes —
   admin edits (new camera assignment, role change, license revoke) apply live.

## 6. Portal modules — what each one actually does

All modules below are wired to live Supabase tables/RPCs/Realtime — none use
placeholder or mock data.

- **Dashboard** — `org_stats()` RPC: users, cameras (+ online), devices (+ online),
  active licenses, 24h alerts with a 7-day trend chart, open incidents, storage
  usage, live AI-engine telemetry (CPU/GPU/MEM from `usage_logs`), recent
  alerts/users/activations, and a permission-gated quick-actions row.
- **Organizations** *(super admin)* — platform-wide tenant list, suspend/reactivate/
  delete, platform-wide KPIs via `platform_stats()`.
- **Users** — invite (`invite-user` function creates the auth user + profile +
  license in the caller's org), suspend/activate/delete/reset-password
  (`admin-users` function), role assignment, reset license, camera/project/device
  assignment view, activity log.
- **Roles & Permissions** — system + unlimited custom roles, full permission
  matrix editor (`role_permissions`), realtime propagation to desktops.
- **Licenses** — generate (`generate_license` RPC, crypto-random key via pgcrypto,
  only the SHA-256 hash is stored), transfer, suspend, revoke, activate, reset
  (`reset_license` RPC — revokes the old key, issues a new one). Types: personal,
  enterprise, trial, lifetime, subscription.
- **Devices** — hardware inventory (CPU/RAM/GPU, OS, last IP), fingerprint (shown
  truncated), rename, transfer, deactivate/reactivate, remove, and reset (revokes
  the current activation without touching the device record).
- **Desktop Activations** — every license↔device binding with version (from
  `desktop_sessions`), fingerprint, last-online; revoke, reset (undo an accidental
  revoke), deactivate/reactivate the device, transfer to a new owner.
- **Cameras** — RTSP/ONVIF/USB/IP/NVR/DVR. Add Camera takes structured fields
  (IP, port, username, password, RTSP path) and the `add-camera` function
  verifies the connection is reachable (`test-camera`/`verifyCameraConnection`,
  a TCP+RTSP-handshake check) **before** the row is ever written. Assignment to a
  user is a plain `camera_assignments` insert, which the desktop app picks up
  instantly via its Realtime subscription — no restart needed.
- **Camera Groups / Sites** — plain grouping/location entities for organizing
  cameras (the former GIS/mapping module was removed — see `PLATFORM.md`).
- **AI Analytics / Alerts / Incidents / Reports** — live aggregation over
  `alerts`/`usage_logs`, realtime ack, incident workflow with a notes thread,
  CSV/PDF report generation archived to storage.
- **Downloads** — live GitHub Releases API proxy (`github-releases` function,
  never a hardcoded link); shows version, notes, date, size, and a download
  button for the newest non-draft release with a Windows asset (.exe/.msi/.zip).
  Since the releases repo is private, the actual click resolves a short-lived
  presigned URL through the authenticated `download-release` function rather
  than GitHub's public `browser_download_url` (which 404s unauthenticated on
  a private repo) — `GITHUB_TOKEN` is required for this to work.
- **Billing / Audit** — subscription + invoices + metered usage; append-only
  audit log with actor/IP/device/old-new diffs.
- **Notifications** — full center: all/unread/archived tabs, per-kind filter,
  read/archive/delete, Realtime. Automatically raised (migration `0008`) for new
  users, offline cameras, device status changes, license status changes,
  licenses expiring within 7 days (`pg_cron`), security-sensitive audit actions,
  and new desktop releases.
- **Settings** — org profile/branding/theme, AI model defaults, SMTP, retention,
  webhooks, API keys — synced to desktops in realtime.
- **Support** — Help Center (FAQ + articles + docs link), Tickets (general / bug
  report / feature request categories, realtime thread), and a System Status tab
  computed live from `org_stats()` (cameras/devices/incidents health).

## 7. Environment variable reference

| Var | Used by | Sensitivity |
|---|---|---|
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | portal (Vercel), desktop (compiled-in) | Public-safe (RLS-protected) |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | edge functions (`adminClient()`) | Secret — Supabase-managed |
| `CAMAI_AES_KEY` | edge functions — camera credential encryption | Secret |
| `GITHUB_RELEASES_REPO`, `GITHUB_TOKEN` | `github-releases` function | Repo name public; token optional/secret |
| `CAMAI_SUPABASE_URL`, `CAMAI_SUPABASE_ANON_KEY` | desktop build override | Public-safe |

## 8. Known operational notes

- The seller's Replicate API token found early in git history was purged from
  history and must still be revoked at replicate.com if that hasn't happened —
  see `HANDOVER.md` §3.
- YOLO11 weights are AGPL-licensed (Ultralytics) — see `LICENSING.md` §2 for the
  buyer's options.
