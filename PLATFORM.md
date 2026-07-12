# CamAI Enterprise Platform

Two products, one backend:

| Product | Directory | Stack |
|---|---|---|
| Web Portal (SaaS) | `portal/` | React + Vite + Tailwind, Supabase JS |
| Windows Desktop (EXE) | `desktop/` | Electron + React, DPAPI-encrypted vault |
| Cloud Backend | `supabase/` | Postgres + RLS, Auth, Realtime, Storage, Edge Functions |
| Local AI Engine | `server/` (existing) | FastAPI, YOLO11 + ByteTrack pipeline |
| Local Viewer | `client/` (existing) | React CCTV viewer (MJPEG + WS telemetry) |

## How the pieces fit

```
                       ┌──────────────────────────────┐
                       │           SUPABASE           │
                       │  Auth · Postgres+RLS · Realtime  │
                       │  Storage · Edge Functions    │
                       └───────┬──────────────┬───────┘
        signup / admin UI      │              │  activate-license / desktop-sync
                               │              │  realtime org-sync
                    ┌──────────┴───┐      ┌───┴──────────────┐
                    │  Web Portal  │      │  Desktop (EXE)   │
                    │  portal/     │      │  desktop/        │
                    └──────────────┘      └───┬──────────────┘
                                              │ localhost (MJPEG/WS)
                                          ┌───┴──────────────┐
                                          │  AI Engine       │
                                          │  server/ (FastAPI)│
                                          └──────────────────┘
```

- **Multi-tenancy** is enforced in the database: every table carries `org_id` and RLS
  policies built on `app.current_org_id()` / `app.has_perm()`. A compromised client
  cannot read another organization's rows.
- **Licensing**: keys are generated server-side (`app.generate_key`, crypto-random,
  never sequential), stored **only as SHA-256 hashes** plus a masked hint
  (`LIC-••••-••••-QM71`). The plaintext key is delivered exactly once (signup reveal /
  invite response) via `app.provision_results`, which is deleted on first read.
- **Device binding**: the desktop hashes CPU + motherboard + disk serial + TPM presence
  + Windows MachineGuid + OS into a SHA-256 fingerprint. `activate-license` binds it to
  the license (`max_devices` enforced) and mints a Supabase session; the refresh token
  is stored DPAPI-encrypted (`safeStorage`). The license key is never asked again.
- **Realtime sync**: desktops subscribe to org-scoped `postgres_changes` on cameras,
  assignments, roles, settings, licenses… any admin edit re-syncs the bundle within
  ~1s, no restart. Deactivating a device revokes its activation and the next sync fails
  closed back to the activation screen.
- **Audit**: `audit_logs` is append-only (no update/delete RLS policies exist). Writes
  go through `public.audit()` (security definer) or the service role.

## Setup

### 1. Supabase project

```bash
cd supabase
npx supabase init            # if linking fresh
npx supabase link --project-ref <your-ref>
npx supabase db push         # applies migrations 0001–0007
npx supabase functions deploy activate-license my-keys desktop-sync invite-user add-camera github-releases
npx supabase secrets set CAMAI_AES_KEY=$(openssl rand -hex 32)
npx supabase secrets set GITHUB_RELEASES_REPO=<owner>/<repo>   # powers the Downloads page
npx supabase secrets set GITHUB_TOKEN=<pat-with-public-repo-read>  # optional, raises the GitHub API rate limit
```

Notes:
- `activate-license` has `verify_jwt = false` (it runs before a session exists) and is
  rate-limited per IP.
- Expose the `app` schema is **not** required — edge functions reach it with the
  service role via `Accept-Profile` headers.
- Enable **Email** auth provider; confirmations optional.

### 2. Web portal

```bash
cd portal
cp .env.example .env         # fill VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
npm install
npm run dev                  # http://localhost:5174
```

### 3. Desktop app

```bash
cd desktop
npm install
set CAMAI_SUPABASE_URL=...   # or bake into electron/main.ts for release builds
set CAMAI_SUPABASE_ANON_KEY=...
npm run start                # dev
npm run build                # produces CamAI-Desktop-Setup-<version>.exe (NSIS)
```

Publish a release: create a GitHub Release on `GITHUB_RELEASES_REPO` (tag = version,
body = release notes) and attach the built `.exe` as a release asset. The Downloads
page polls the GitHub Releases API live via the `github-releases` edge function —
nothing to upload or register in Supabase, and there is never a hardcoded link.

### 4. Wire the local AI engine

The desktop's `sync.ts` bundle contains assigned cameras and org AI settings
(`ai.model`, `ai.confidence`, …). Feed those into the existing `server/app/ai`
pipeline (decrypted camera URLs come from the backend via `add-camera`'s AES-256-GCM
ciphertext + `CAMAI_AES_KEY`) and mount the MJPEG stream into
`Workspace.tsx → CamerasView`.

## Account flows

**Personal signup** → collects name/email/password → trigger `app.handle_new_user`
creates: personal org (`ORG-…`), profile (`USR-…`), 6 system roles, owner role
assignment, and a `LIC-…` license. Keys shown once on the reveal screen.

**Organization signup** → same, but org kind `organization` and an `ADM-…` admin
license.

**Admin adds a user** → portal → `invite-user` edge function → creates the auth user
inside the admin's org, assigns role, generates that user's license, emails a
password-recovery link. The license key is returned once to the admin.

**Desktop first run** → license key → fingerprint → bind → encrypted vault →
auto-login forever after (refresh-token rotation kept in sync with the vault).

## Security model summary

- TLS everywhere (Supabase endpoints); WSS for realtime.
- RLS org isolation + permission checks in SQL (`app.has_perm`).
- License/API keys: SHA-256 hash at rest, masked hints for display.
- Camera credentials: AES-256-GCM (key held only in edge-function secrets).
- Desktop tokens: DPAPI via Electron `safeStorage`; corrupt/foreign vault ⇒ re-activation.
- JWT + rotating refresh tokens (`enable_refresh_token_rotation = true`).
- Activation endpoint rate-limited; strict input validation on key/fingerprint format.
- Append-only audit log with actor, IP, device, timestamp.

## Portal modules (all implemented against live schema — no mock data)

Dashboard · Organizations (super-admin) · Users · Roles & Permissions · Licenses
(generate/transfer/suspend/revoke, one-time reveal) · Devices (hardware inventory,
transfer, deactivate) · Desktop Activations (revoke = fail-closed) · Cameras
(health telemetry, assignment, AES-encrypted connection) · Camera Groups · Sites ·
AI Analytics (live aggregation over alerts/usage) · Alerts (realtime, ack,
snapshots) · Incidents (workflow + notes thread) · Reports (CSV archived to
storage + PDF, history) · Downloads · Billing (subscription, invoices, metered
usage) · Audit (old/new diffs, client context) · Notifications (realtime, mark
read) · Settings (org, branding upload, AI defaults, SMTP, retention, webhook,
API keys) · Support (ticket threads, realtime).

## Device lifecycle guarantees

- `activate-license` records the hardware inventory (CPU/RAM/GPU/disk) and IP,
  and never resurrects an admin-deactivated fingerprint (status is preserved on
  re-activation upserts and then checked).
- `desktop-sync` requires the `x-device-id` header: deactivated devices and
  revoked activations get `403 {code:"deactivated"}` and the app wipes its vault
  and returns to the activation screen. Syncs also heartbeat
  `last_seen_at`/`is_online`/`last_ip` (stale-guarded to once per minute).
- `org_stats().devices_online` only counts devices seen in the last 3 minutes,
  so crashed desktops don't show as online forever.

## Current gaps (next milestones)

- Email + browser push notification delivery (tables + SMTP settings exist;
  needs a provider hook in an edge function).
- Auto-update feed for the desktop (electron-builder `publish` + `app_releases`).
- ONVIF discovery and NVR channel enumeration in `add-camera`.
