# Database (Supabase)

`supabase/migrations/` currently has 44 migration files; `supabase/functions/` has 21 Edge Functions. This document covers the shape of the schema and how the pieces connect — for exact column definitions, read the migrations directly, they're the source of truth.

## Multi-tenancy

Every application table carries `org_id`. RLS policies are built on two functions:

- `app.current_org_id()` — resolves the caller's organization from their JWT
- `app.has_perm(<permission>)` — checks the caller's role against a permission

A client with only the anon/authenticated key can never read or write another organization's rows — isolation is enforced in Postgres, not in application code. As of the 2026-07-25 security audit, 52 of 54 tables carry RLS.

## Identity and licensing

- **Signup** (`app.handle_new_user` trigger): personal signup creates a personal org, a profile, six system roles, an owner role assignment, and a license — all in one transaction. Organization signup does the same with org kind `organization` and an admin license.
- **License keys** are generated server-side (`app.generate_key`, cryptographically random, never sequential) and stored **only as a SHA-256 hash** plus a masked display hint (e.g. `LIC-••••-••••-QM71`). The plaintext key is returned exactly once, via `app.provision_results`, which is deleted on first read — there is no way to retrieve a lost key; it must be rotated.
- **Device binding**: the desktop app hashes CPU + motherboard + disk serial + TPM presence + Windows `MachineGuid` + OS into a SHA-256 fingerprint. `activate-license` binds that fingerprint to a license (enforcing `max_devices`), mints a Supabase session, and the app stores the refresh token DPAPI-encrypted via Electron `safeStorage`.
- **Device lifecycle**: `activate-license` records hardware inventory + IP and never resurrects an admin-deactivated fingerprint. `desktop-sync` requires an `x-device-id` header; a deactivated device or revoked activation gets `403 {code:"deactivated"}` and the desktop wipes its local vault. `org_stats().devices_online` only counts devices with a heartbeat in the last 3 minutes.

## Realtime sync

Desktops subscribe to org-scoped `postgres_changes` on cameras, camera assignments, roles, settings, and licenses. Any admin edit reaches the desktop within roughly one second without a restart.

## Audit logging

`audit_logs` is append-only — no RLS policy grants `UPDATE` or `DELETE` on it. Writes go through `public.audit()` (a `SECURITY DEFINER` function) or the service role.

## Camera credentials

Camera connection strings are encrypted with AES-256-GCM; the key is held only in Edge Function secrets (`CAMAI_AES_KEY`), never in the database or a client bundle. The only place a plaintext connection string is ever produced is the `decrypt-camera` Edge Function, and only for a camera the calling user is actually assigned to.

## Edge Functions (`supabase/functions/`)

| Function | Purpose |
|---|---|
| `activate-license` | Binds a device fingerprint to a license, mints a session. `verify_jwt = false` (runs pre-session), rate-limited per IP. |
| `add-camera` / `update-camera` | Register/update a camera; encrypts the connection string. |
| `admin-users` | Super-admin user management (status changes, role changes). |
| `decrypt-camera` | Returns a plaintext connection string for a camera the caller is assigned to. |
| `delete-account` | Account deletion flow. |
| `desktop-sync` | Bundles assigned cameras + org AI settings for a device; enforces device/activation status. |
| `download-release` / `github-releases` | Power the portal's Downloads page by reading the GitHub Releases API live — no binaries or links are stored in Supabase. |
| `invite-user` | Admin invites a user into their org; creates the auth user, assigns a role, generates a license, emails a password-recovery link. |
| `my-keys` | Returns the caller's own license key info. |
| `notify-telegram` | Fans an inserted `alerts` row out to Telegram via `sendPhoto`/`sendMessage`. Model-agnostic — never inspects the alert `kind`. |
| `publish-config` / `rollback-config` | Push/revert camera analytics configuration. |
| `report-camera-health` | Desktop reports camera online/offline + error state. |
| `report-events` | Desktop syncs structured detection events + evidence snapshots. |
| `send-email` | Outbound notification email via each org's own SMTP settings. |
| `telegram-bot` | Webhook target for interactive bot commands (`/status`, `/alerts`, `/critical`, `/cameras`, `/health`, `/snapshot`, `/help`). |
| `telegram-link-code` / `telegram-test` | Link a chat to an org; test the Telegram connection. |
| `test-camera` | Server-side reachability/ONVIF/NVR-channel probe before a camera is added. |

## Notifications

`app.dispatch_pending_emails()` runs every minute via `pg_cron`, finds unsent license-expiry/status/security/camera-offline notifications, and calls `send-email` using each org's own SMTP settings plus a single deployment-wide `CAMAI_SMTP_PASSWORD` secret. Orgs that haven't configured SMTP simply don't get email — everything still lands in the in-app notification center. Telegram alerts are opt-in per org (Settings → Telegram: enable, bot token, chat ID) and ride the same `public.alerts` row the portal renders, so what's on screen is exactly what arrives in Telegram.

## Deploying a fresh Supabase project

```bash
cd supabase
npx supabase link --project-ref <your-ref>
npx supabase db push
npx supabase functions deploy activate-license my-keys desktop-sync invite-user add-camera update-camera admin-users github-releases download-release test-camera send-email decrypt-camera notify-telegram telegram-test telegram-bot telegram-link-code report-camera-health report-events delete-account publish-config rollback-config
npx supabase secrets set CAMAI_AES_KEY=$(openssl rand -hex 32)
npx supabase secrets set GITHUB_RELEASES_REPO=<owner>/<repo>
npx supabase secrets set CAMAI_SMTP_PASSWORD=<smtp-relay-password>
```

Then, once per deployment (needs the project's own function URL and service-role key, so it can't be a migration):

```sql
select app.configure_email_dispatch('https://<project-ref>.functions.supabase.co', '<service-role-key>');
```

For Telegram, generate and set a dedicated webhook secret rather than relying on the service-role key — projects on Supabase's newer API-key system inject an `sb_secret_…` value that won't match a legacy service-role JWT:

```bash
SECRET=$(openssl rand -hex 32)
npx supabase secrets set TELEGRAM_WEBHOOK_SECRET=$SECRET
```

```sql
update app.integration_config set telegram_bearer = '<the-same-secret>' where id = true;
```

`supabase/deploy_telegram.ps1` automates the Telegram half of this setup end to end.
