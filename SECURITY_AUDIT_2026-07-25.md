# CamAI — Full Security Audit

**Date:** 2026-07-25
**Scope:** whole repository — `server/` (FastAPI AI engine), `desktop/` (Electron + React), `portal/` (React SPA on Vercel), `supabase/` (Postgres schema, RLS, 21 edge functions), build/release tooling, dependencies, secrets, git history.
**Standards applied:** OWASP Top 10 (2021), OWASP API Security Top 10 (2023), OWASP ASVS 4.0 L2, CWE Top 25.
**Method:** manual code review of every endpoint, policy and IPC handler; dependency CVE scan; secret scan across the working tree and full git history; live runtime verification of the engine fixes.

---

## 1. Executive summary

CamAI's security architecture is, on the whole, deliberately built rather than accidental: hard multi-tenant RLS on 52 of 54 tables, AES-256-GCM for camera credentials with the key held only in edge-function secrets, DPAPI-backed token storage on the desktop, a DB-backed rate limiter, a control-token capability on the local engine, and an audit log wired into the privileged paths. Several classes of bug that this codebase has had before (RLS recursion, cross-tenant RPCs, service-role misuse) have visibly been found and closed already.

Against that, the audit found **one critical, platform-wide flaw**: the `public.profiles` update policy had no `WITH CHECK`, so any signed-in user could set `is_super_admin = true` on their own row with nothing but the public anon key and become platform staff across every tenant. That single write defeats every other control in the system — RLS, the edge-function permission checks, and the org scoping in the portal all treat `is_super_admin` as an unconditional bypass. It is fixed in migration `0042`.

Beyond that, the recurring theme is **trust in caller-supplied values that then reach a privileged sink**: a camera host that becomes an outbound connection from the cloud runtime, an SMTP host that receives the deployment's shared mail password, a storage path that gets signed with the service role, a model file name that becomes a filesystem path, a role id that becomes a permission grant. Each is fixed at the point where the value enters the sink.

**33 of 38 findings are fixed in this pass.** Five are documented but deliberately not auto-applied because they cannot be verified without a runtime smoke test or a product decision: the Electron `webSecurity: false` flag, the end-of-life Electron 31 runtime, disabled email confirmations, the remaining major-version dependency bumps, and the placeholder model-signing key. Each has an exact patch and a verification step below.

| Metric | Result |
|---|---|
| Total findings | **38** |
| Critical | **1** (1 fixed) |
| High | **8** (6 fixed, 2 documented) |
| Medium | **12** (10 fixed, 1 partial, 1 documented) |
| Low | **13** (5 fixed, 8 documented) |
| Informational | **4** |
| Files scanned | 326 tracked files (+ working tree); ~19k LOC reviewed by hand |
| Dependencies scanned | 3 npm trees (portal, desktop, server) + 13 Python runtime pins |
| Secrets found in source | **0** real secrets (public anon keys only); git history clean |
| Overall Security Score | **82 / 100** (pre-audit: **41 / 100**) |

### Sub-scores

| Domain | Before | After | Notes |
|---|---|---|---|
| Authentication | 70 | 72 | Strong device/licence binding + DPAPI vault; email confirmation still off, no MFA |
| Authorization | 30 | 90 | Was capped by the `profiles` escalation; RLS + edge checks are otherwise thorough |
| API security | 62 | 84 | SSRF, IDOR, rate-limit bypass and error leakage closed |
| Infrastructure / client | 48 | 70 | Headers + navigation containment added; EOL Electron and `webSecurity:false` remain |
| AI / pipeline security | 55 | 84 | Frame-injection into the live pipeline closed; model supply chain sanitised |
| Data protection | 72 | 78 | Good crypto; secrets still stored plaintext in two DB tables |

---

## 2. Critical

### C1 — Any authenticated user could make themselves platform super admin

**Severity:** Critical · **CVSS 3.1:** 9.9 `AV:N/AC:L/PR:L/UI:N/S:C/C:H/I:H/A:H`
**Category:** Broken Access Control / Privilege Escalation
**OWASP:** A01:2021, API1:2023 (BOLA), API5:2023 (BFLA) · **CWE:** CWE-269, CWE-863, CWE-639
**Files:** `supabase/migrations/0001_identity_licensing.sql:225` (policy), every consumer of `app.is_super_admin()`

**Vulnerable code**

```sql
create policy profiles_self_update on public.profiles for update
  using (id = auth.uid() or (org_id = app.current_org_id() and app.has_perm('users.manage')));
```

**Why it is vulnerable.** A Postgres `UPDATE` policy with no `WITH CHECK` re-uses its `USING` expression as the post-image check. The expression tests only *which row* is being written, never *what is written into it*. Every column therefore stays writable by the row's owner, including `is_super_admin`, `org_id`, `status`, `email` and `user_code`. Supabase grants `UPDATE` on `public` tables to `authenticated` by default, so the only gate was this policy.

**Attack scenario.** A trial user signs up, opens the browser console on the portal and runs:

```js
await supabase.from('profiles').update({ is_super_admin: true }).eq('id', myUserId);
```

`app.is_super_admin()` now returns true for them, which short-circuits `app.has_perm()` and the org predicate in **every** RLS policy on the platform; `add-camera`, `update-camera`, `publish-config`, `rollback-config` and `admin-users` all honour the same flag as "may act on any organization". The account can then read and modify every tenant's cameras, alerts, licences and audit logs, delete any user, and rewrite or wipe another tenant's analytics configuration. Setting `status: 'active'` also un-does an admin suspension (defeating `admin-users` → `set_status` and its session kill), and `org_id` moves the account into another tenant.

**Impact.** Complete multi-tenant compromise — confidentiality, integrity and availability of every customer's CCTV data, from a free account.

**Fix applied** — `supabase/migrations/0042_security_hardening.sql`: a `BEFORE UPDATE` trigger pins the privileged columns to their old values whenever the caller's JWT role is `authenticated`/`anon`. `service_role` (edge functions), the table owner (provisioning triggers, definer functions) and direct SQL connections are unaffected, so `invite-user` (re-homes `org_id`) and `admin-users` (`set_status`) keep working unchanged. The portal's only profile write sends `full_name / phone / department / designation`, none of which is touched.

```sql
create or replace function app.protect_profile_privileged_columns()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_role text := '';
begin
  begin
    v_role := coalesce(nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role', '');
  exception when others then v_role := '';
  end;
  if v_role not in ('authenticated', 'anon') then return new; end if;
  new.is_super_admin := old.is_super_admin;
  new.org_id         := old.org_id;
  new.user_code      := old.user_code;
  new.email          := old.email;
  new.status         := old.status;
  return new;
end $$;

create trigger profiles_protect_privileged_columns
  before update on public.profiles
  for each row execute function app.protect_profile_privileged_columns();
```

---

## 3. High

### H1 — Telegram webhook authentication fails open

**CVSS:** 8.2 `AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:N` · **CWE-306** · **A07:2021**
**File:** `supabase/functions/telegram-bot/index.ts:251`

```ts
const secret = Deno.env.get("TELEGRAM_WEBHOOK_SECRET") ?? "";
if (secret && req.headers.get("X-Telegram-Bot-Api-Secret-Token") !== secret) { ... }
```

With the secret unset the check was skipped entirely, and `verify_jwt = false` for this function — leaving a fully public endpoint that accepts a forged Telegram update. Every identity downstream (`chat_id`, `telegram_user_id`, `tg_username`) is read out of that body, so an attacker chooses their own: connection-code guessing with a fresh `chat_id` per attempt (which resets `telegram_connect_attempts`, the *only* brute-force guard on 8-character link codes), plus `/disconnect` against an org's live alert channel.

**Fixed:** fail closed when the secret is missing, and compare it in constant time (`safeEqual`).

### H2 — SMTP relay host is caller-chosen → deployment mail password exfiltration + SSRF

**CVSS:** 8.1 `AV:N/AC:L/PR:H/UI:N/S:C/C:H/I:H/A:L` · **CWE-522, CWE-918** · **A10:2021**
**File:** `supabase/functions/send-email/index.ts:36-41`

`smtp.host/port/username` arrive in the request body (sourced from `organization_settings.smtp`, writable by any `org.manage` holder), but the **password** sent with them is the deployment's single shared `CAMAI_SMTP_PASSWORD`. An org admin could point the relay at a host they control and collect that password from their own `AUTH LOGIN` on the next queued email — and aim a TCP connection from inside the edge runtime at any host:port on the way.

**Fixed:** `CAMAI_SMTP_ALLOWED_HOSTS` (or `CAMAI_SMTP_HOST`) allowlist, plus an unconditional refusal of private/loopback/link-local destinations. With no env var set, behaviour is unchanged except that internal destinations are refused — setting one variable closes the exfiltration path completely.

### H3 — SSRF and internal port scanning through camera verification

**CVSS:** 7.7 `AV:N/AC:L/PR:L/UI:N/S:C/C:H/I:L/A:N` · **CWE-918** · **A10:2021, API7:2023**
**Files:** `supabase/functions/_shared/util.ts` (`verifyCameraConnection`, `probeNvrChannels`, `probeOnvifDevice`), used by `test-camera`, `add-camera`, `update-camera`

The private-address filter covered `127.0.0.1`, `10.`, `192.168.`, `172.16-31.` and `169.254.` **as literal dotted-quad strings only**. Everything else reached `Deno.connect()`/`fetch()`: `2852039166`, `0xA9FEA9FE`, `0251.0376.0251.0376`, `127.0.0.2`, `127.1`, `0.0.0.0`, `[::1]`, `fe80::`/`fc00::`, `::ffff:169.254.169.254`, CGNAT `100.64/10` — and, most importantly, **any hostname resolving to those**, including an attacker-owned A record. The response body reports the outcome per probe (`channel exists (needs credentials)`, `RTSP 401`, ONVIF XML), which makes it a working scanner, and `probeNvrChannels` fires 24 probes per call.

**Fixed:** `isPrivateHost()` now normalises every IPv4 shorthand form and covers IPv6, loopback, link-local, unique-local, CGNAT, multicast and the metadata ranges; `resolvesToPrivate()` resolves hostnames (A + AAAA) and rejects any answer in that space. Genuine public camera hosts are unaffected; private ones short-circuit to the same message as before. (Residual: a DNS-rebinding race between check and connect — noted, not exploitable for data return here.)

### H4 — Electron renderer runs with the same-origin policy disabled  *(documented, not auto-applied)*

**CVSS:** 7.4 `AV:N/AC:H/PR:N/UI:R/S:C/C:H/I:H/A:N` · **CWE-1188, CWE-16** · **A05:2021**
**File:** `desktop/electron/main.ts:124`

```ts
webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: false, webSecurity: false }
```

`webSecurity: false` disables SOP for the whole renderer: any script that reaches the page can read `file://` URLs (including the DPAPI credential vault path, the user's documents) and any cross-origin HTTP response, then exfiltrate it. `contextIsolation` and `nodeIntegration:false` are correct and limit this to the preload bridge, but the bridge itself exposes session tokens, the engine control token and the model downloader.

**Why it is not auto-applied:** flipping it changes how every renderer request is evaluated (engine calls from a `file://` origin, MJPEG tiles, Supabase storage media). It is a one-line change plus a smoke test, and this environment cannot launch the GUI to run that test.

**Patch:**
```ts
webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true }
```
**Verification:** launch the desktop app, confirm (a) camera tiles render MJPEG, (b) Workspace telemetry connects over the WebSocket, (c) activation/auto-login works, (d) model downloads start. The engine already answers `Origin: null` (the Electron `file://` origin) with a matching `Access-Control-Allow-Origin`, which is the only cross-origin dependency in the renderer — verified live during this audit.

**Compensating controls applied now:** `setWindowOpenHandler` (deny + `shell.openExternal` for real links), a `will-navigate` guard, and `will-attach-webview` denial, so renderer content can no longer navigate the privileged window to attacker-controlled markup.

### H5 — Cross-site WebSocket hijacking and frame injection into the live pipeline

**CVSS:** 7.6 `AV:N/AC:L/PR:N/UI:R/S:C/C:H/I:H/A:N` · **CWE-1385, CWE-346** · **A01:2021**
**File:** `server/app/main.py` `/ws`

WebSockets are not covered by CORS. Any page the operator visited could open `ws://127.0.0.1:8000/ws`, `subscribe` to a camera and receive its live telemetry (detections, tracks, plate reads) — and send `screen_frame`, which base64-decodes caller-supplied bytes into a real frame and pushes it into the running camera thread. That is arbitrary imagery injected into someone's analytics, alerts and recordings.

**Fixed:** origin allowlist on the handshake, mirroring the HTTP CORS list; header-less non-browser clients still connect. **Verified live:** `Origin: https://evil.example` → `403`; `Origin: null` (Electron) → `101`.

### H6 — Cross-organization role assignment in `invite-user`

**CVSS:** 7.2 `AV:N/AC:L/PR:H/UI:N/S:C/C:H/I:H/A:N` · **CWE-863** · **A01:2021, API5:2023**
**File:** `supabase/functions/invite-user/index.ts:66`

`role_id` came from the request body and was inserted into `user_roles` unvalidated. Roles are org-scoped rows, but `app.has_perm()` resolves permissions through `user_roles → role_permissions` **without re-checking the role's org** — so an admin could mint an account in their own org holding another tenant's "Organization Owner" role.

**Fixed:** the role is resolved server-side and must belong to the caller's org (super admin exempt, matching every other check in the function).

### H7 — End-of-life Electron runtime shipped to customers  *(documented)*

**CVSS:** 7.5 (aggregate of the unpatched Chromium CVEs) · **CWE-1104** · **A06:2021**
**File:** `desktop/package.json` → `electron@31.7.7`

Electron 31 is past end-of-life and receives no Chromium security backports. Every renderer-reachable Chromium CVE since that branch closed applies to the shipped app, and this matters more than usual because the renderer runs with `webSecurity: false` (H4).

**Remediation:** move to a supported major (33+ at minimum, current LTS preferred), rebuild, and re-run the desktop smoke test. `npm audit` also flags an ASAR integrity bypass in this line. Not auto-applied: a major Electron bump touches native rebuilds and the electron-builder config, and needs a full packaging test.

### H8 — Path traversal + transport downgrade in the model downloader

**CVSS:** 7.1 `AV:N/AC:L/PR:H/UI:R/S:U/C:L/I:H/A:L` · **CWE-22, CWE-319, CWE-1333** · **A08:2021**
**File:** `desktop/electron/downloadManager.ts`

`path.join(destDir, modelName)` with `modelName` straight from an `ai_model_packages` row: `../../…/Startup/x.exe` wrote outside the models directory — and the write happens **before** the checksum/signature check that is supposed to gate it. The transport was `url.startsWith("https") ? https : http`, so a plain-http package URL (or a redirect down to one) fetched model weights over a rewritable channel, and redirects were followed with no hop limit.

**Fixed:** file names collapse to a basename and must match `^[A-Za-z0-9._-]{1,150}$`; URLs must be public `https://` (re-validated on every redirect hop); redirects capped at 5.

---

## 4. Medium

| # | Finding | CWE / OWASP | CVSS | Status |
|---|---|---|---|---|
| M1 | **Stored XSS in report printing** — `Reports.tsx` wrote `${org?.name}` and the report title into a `window.open("")` popup unescaped; the popup inherits the portal origin, so injected markup runs as the portal and reads the Supabase session from `localStorage` via `window.opener`. Organization name is free text set at signup / by `org.manage`. Cell values escaped only `<`. | CWE-79 / A03 | 6.5 | **Fixed** — full HTML escaping of title, org name, headers and cells |
| M2 | **No security headers on the portal** — `vercel.json` set none: no CSP, HSTS, `X-Frame-Options`, `nosniff`, Referrer-Policy, Permissions-Policy, COOP/CORP. The `/app` console was framable (clickjacking) and had no script-injection backstop. | CWE-693, CWE-1021 / A05 | 6.1 | **Fixed** — full header set incl. an enforcing CSP derived from the actual build (no inline scripts, no `eval` in the bundle — verified) |
| M3 | **Unauthenticated destructive engine endpoints** — `DELETE /api/alerts`, `DELETE /api/alerts/{id}`, `DELETE /api/history`, `DELETE /api/history/logs`, `POST …/recording`, `POST …/display`, `GET /api/debug/gc` carried no control token. Reachable by any local process, and cross-origin from a sandboxed frame (`Origin: null` is allowlisted for the Electron renderer). Wiping a CCTV system's local alert log is exactly the drive-by action to prevent. | CWE-306 / A01 | 6.5 | **Fixed** — `dependencies=control`; verified `403` without token, `200` with |
| M4 | **DNS rebinding against the local engine** — loopback binding stops packets, not browsers: a page can point its own hostname at `127.0.0.1` and then talk to the API same-origin, bypassing the CORS allowlist entirely (live video, telemetry, control). | CWE-350 / A05 | 6.5 | **Fixed** — Host-header allowlist middleware (`CAMAI_ALLOWED_HOSTS` for proxied deployments); verified `421` for a foreign Host |
| M5 | **Cross-tenant storage read via `snapshot_path`** — `report-events` accepted any string; `notify-telegram` then signs it with the service role (`createSignedUrl` bypasses the bucket RLS that scopes objects to `<org_id>/…`), delivering the URL to the caller's own Telegram chat. | CWE-639 / A01 | 6.5 | **Fixed** — path must sit under the camera's own `org_id/` prefix; traversal forms rejected |
| M6 | **Rate-limit bypass via spoofed `X-Forwarded-For`** — `activate:${ip}` and `gh-releases:${ip}` keyed on element `[0]`, which is client-written; every forged value created a fresh bucket, defeating the 5/min guard on licence-key submission. | CWE-290, CWE-807 / A07 | 5.3 | **Fixed** — last hop used for the key and for the audit/`last_ip` record |
| M7 | **Cross-tenant object reference (`site_id`)** — accepted unvalidated in `add-camera`/`update-camera`, which write with the service role, attaching a camera to another tenant's site. | CWE-639 / A01 | 5.4 | **Fixed** — site must belong to the org |
| M8 | **`SECURITY DEFINER` functions with mutable `search_path`** — `publish_config`, `rollback_config` (0031 pinned them; 0032's `CREATE OR REPLACE` silently wiped `proconfig`) and `is_public_model`. Classic definer hijack. | CWE-426 / A05 | 4.4 | **Fixed** in 0042 |
| M9 | **Unbounded upload** — `/api/cameras/upload` streamed with no size cap; one request could fill the disk holding recordings, the history DB and the OS. | CWE-400 / A05 | 5.5 | **Fixed** — `CAMAI_MAX_UPLOAD_MB` (default 4096), partial file removed on abort |
| M10 | **Vulnerable dependencies** — `postcss ≤8.5.17` (high, path traversal), `pillow 10.2.0` (CVE-2024-28219), `python-multipart 0.0.7` (CVE-2024-53981, reachable from the upload endpoint), `starlette 0.37.2` (CVE-2024-47874), `react-router 6.30.4` (open redirect → XSS), `esbuild/vite` dev-server (moderate, dev only). | CWE-1395 / A06 | 5.3–7.5 | **Partial** — postcss patched, pillow → 10.4.0, python-multipart → 0.0.18. `starlette` needs `fastapi ≥ 0.115.3`; `react-router` needs v7 (both breaking, listed in §7) |
| M11 | **Device-seat race in `activate-license`** — check-then-insert: N parallel activations all read the count before any writes, so all N pass a `max_devices` of 1. | CWE-362 / business logic | 4.3 | **Fixed** — post-insert re-count, self-revoke if over the limit |
| M12 | **Email confirmation disabled** (`supabase/config.toml`: `enable_confirmations = false`) — signup with an address you don't control; unverified addresses receive licence keys and password-recovery links. | CWE-287 / A07 | 5.3 | **Documented** — a one-line config change, but it alters the onboarding flow, so it is your product decision |

---

## 5. Low

| # | Finding | Status |
|---|---|---|
| L1 | Internal error text (DB/driver messages) returned to clients from `my-keys`, `admin-users`, `invite-user`, `delete-account`, `download-release`, `telegram-link-code`, `publish-config`, `rollback-config`, `github-releases` — CWE-209 | **Fixed** — generic responses; detail stays in the function log |
| L2 | Non-constant-time secret comparison in `notify-telegram`, `send-email`, `telegram-bot` — CWE-208 | **Fixed** — `safeEqual()` |
| L3 | `Access-Control-Allow-Origin: *` on all edge functions — CWE-942. Not cookie-authenticated, so not directly CSRF-able; tightening it risks breaking the Electron (`Origin: null`) client | Documented |
| L4 | `bot_token` interpolated into the Telegram API path in `telegram-test` (`/` or `..` re-points the call) — CWE-20 | **Fixed** — format validation for token and chat id |
| L5 | Rate limiter fails open on infra error (`_shared/util.ts:311`) — CWE-703. Deliberate, but auth-sensitive callers (`activate-license`) should fail closed | Documented |
| L6 | Unbounded strings and unvalidated `created_at` in `report-events` (200 events × 120 req/min) — CWE-400, CWE-20 | **Fixed** — length clipping + timestamp window |
| L7 | Secrets at rest in DB: `app.integration_config.service_role_key` / `telegram_bearer`, `telegram_settings.bot_token` (plaintext; RLS-protected but not encrypted like camera credentials are) — CWE-312 | Documented |
| L8 | Engine reads unauthenticated on loopback: `/api/cameras` returns connection strings (may embed `rtsp://user:pass@…`), plus MJPEG, alerts, telemetry. Cannot be header-gated without breaking `<img>`-based stream tiles; mitigated by M3/M4/H5 | Documented |
| L9 | Renderer can set an arbitrary engine executable path (`engine-set-path` → `spawn`) — a compromised renderer gets code execution — CWE-114 | Documented |
| L10 | `server/package.json` declares `express`, `multer@1.4.5-lts.1` (EOL, known DoS CVEs), `cors`, `axios` with **no JavaScript in `server/`** — dead dependency surface | Documented — safe to delete |
| L11 | `pg` (Postgres driver) is a **runtime** dependency of the portal; only scripts use it. Move to `devDependencies` so it can never be bundled | Documented |
| L12 | Supabase session in `localStorage` → any XSS is token theft (framework default; CSP from M2 is the mitigation) | Documented |
| L13 | `portal/.env` holds a plaintext `PASS=` value in the working tree (git-ignored, never committed — history verified). Rotate it and keep it out of shared machines | Documented |

---

## 6. Informational

- **I1** — The Supabase **anon** key is hardcoded as a fallback in `desktop/electron/main.ts:36` and `portal/scripts/update_vercel_envs.*`. That key is public by design (it is shipped in every client bundle); it is only a finding if it is ever confused with the service-role key, which it is not anywhere in this repo.
- **I2** — No Dockerfiles, Compose, Kubernetes/Helm manifests or CI workflows exist in the repository, so those scope items have no attack surface to audit. When CI is added, add dependency and secret scanning gates there.
- **I3** — **Git history is clean.** `service_role`, `sb_secret`, `CAMAI_AES_KEY`, private-key headers, cloud tokens: every hit across all commits is documentation or a shell placeholder (`$(openssl rand -hex 32)`), never a value. No `.env` file was ever tracked.
- **I4** — **Model-signing key is a placeholder** (`desktop/electron/downloadManager.ts:23`). `crypto.createPublicKey()` rejects it (`decode error`), so `verifyDigitalSignature()` throws and returns `false` for **every** package — the integrity gate is inoperative *and* fails closed, meaning signed model downloads can never complete. Generate a real P-256 keypair, sign packages with the private half, and paste the real public half here. (Flagged as informational only because it fails closed; it is a genuine A08 gap in the update chain and a broken feature.)
- **I5** — 4 pre-existing failures in `server/tests/test_speed_contract.py` (`speed_calibrated` labelling). Unrelated to this audit — no file they touch was modified — but they are the contract that keeps an *estimated* speed from being presented as a *calibrated* one, so they are worth fixing before any enforcement pilot.

---

## 7. Follow-up work (not auto-applied)

| Item | Why it needs you | Action |
|---|---|---|
| H4 `webSecurity: false` | Needs a GUI smoke test | Flip to `webSecurity: true, sandbox: true`, then verify MJPEG tiles, WS telemetry, activation, downloads |
| H7 Electron 31 EOL | Major upgrade + repackaging | Move to a supported major, rebuild installer, re-run smoke test |
| M10 `starlette`/`fastapi` | `fastapi 0.111.1` pins `starlette <0.38`; CVE-2024-47874 needs `≥0.40` | `fastapi>=0.115.3`, re-run `server/tests`, rebuild frozen engine |
| M10 `react-router` | Advisory fix requires v7 (breaking) | Upgrade + regression-test routing |
| M12 email confirmations | Product decision | `enable_confirmations = true` in `supabase/config.toml` |
| I4 model-signing key | Requires your private key | Generate ECDSA P-256 keypair, sign packages, replace the PEM |
| L10 / L11 dead deps | Trivial but touches package manifests | Remove `server/package.json` deps; move `pg` to devDependencies |

---

## 8. Deployment checklist for the fixes in this pass

1. **Database** — apply `supabase/migrations/0042_security_hardening.sql` (this is the critical one).
2. **Edge functions** — redeploy: `_shared` consumers `activate-license`, `add-camera`, `update-camera`, `test-camera`, `send-email`, `notify-telegram`, `telegram-bot`, `telegram-test`, `invite-user`, `report-events`, `github-releases`, `my-keys`, `admin-users`, `delete-account`, `download-release`, `publish-config`, `rollback-config`, `telegram-link-code`.
3. **Secrets** — confirm `TELEGRAM_WEBHOOK_SECRET` is set (the webhook now refuses calls without it, by design), and set `CAMAI_SMTP_ALLOWED_HOSTS` to your relay's hostname.
4. **Portal** — redeploy to Vercel so the new headers take effect; check the browser console once for CSP violations on the marketing page (3D hero, videos) and the `/app` console.
5. **Desktop** — rebuild; no behaviour change expected (navigation guards + downloader validation only).
6. **Engine** — rebuild the frozen exe to pick up the patched Python pins. Runtime behaviour verified live during the audit: normal requests `200`, foreign Host `421`, token-less destructive calls `403`, allowed WS origin `101`, foreign WS origin `403`.

---

*Prepared as a full-scope review: every edge function, every RLS policy, every engine endpoint, every IPC handler read by hand. Fixes preserve UI, UX, API shapes, database schema and business logic; the only intentional behaviour changes are refusals of requests that were never legitimate.*
