# Security

## Reporting a vulnerability

Report suspected vulnerabilities privately to the maintainer rather than opening a public issue.

## Security model

- **Authentication**: Supabase Auth (JWT, rotating refresh tokens). Desktop sessions are bound to a device fingerprint (see [`DATABASE.md`](DATABASE.md#identity-and-licensing)) and stored DPAPI-encrypted via Electron `safeStorage`.
- **Authorization**: role-based (`Admin` / `Operator` / `Viewer` and org-specific roles), enforced twice — Postgres RLS (`app.has_perm()`, `app.current_org_id()`) and Edge Function permission checks. RLS is the load-bearing layer; a client cannot bypass it by calling Supabase directly.
- **Multi-tenancy**: every table carries `org_id`; a compromised or malicious client can only ever read/write its own organization's rows. See [`DATABASE.md`](DATABASE.md#multi-tenancy).
- **Camera credentials**: AES-256-GCM at rest; the decryption key lives only in Edge Function secrets, never in the database or a client bundle.
- **License keys**: SHA-256 hash at rest with a masked display hint; the plaintext is shown exactly once at issuance and cannot be retrieved again.
- **Audit log**: `audit_logs` is append-only — no RLS policy grants `UPDATE`/`DELETE` on it.
- **Local AI engine**: `server/` binds `127.0.0.1` only and has no user authentication of its own; mutating REST calls require an `X-CamAI-Token` header (see [`API.md`](API.md)). It is designed to be fronted by `desktop/` on the same machine, not exposed on a network directly — doing so requires adding a proxy/auth layer in front of it.

## Audit history

A full manual security audit (OWASP Top 10 2021, OWASP API Security Top 10 2023, ASVS 4.0 L2, CWE Top 25) was performed on 2026-07-25, covering `server/`, `desktop/`, `portal/`, `supabase/` (326 tracked files, ~19k LOC reviewed by hand), build/release tooling, dependencies, and full git history.

| Metric | Result |
|---|---|
| Total findings | 38 (1 critical, 8 high, 12 medium, 13 low, 4 informational) |
| Fixed in that pass | 33 of 38 |
| Secrets found in source/history | 0 real secrets (public anon keys only) |
| Overall score | 82/100 (pre-audit baseline: 41/100) |

**The one critical finding**: `public.profiles`'s update policy had no `WITH CHECK`, so any authenticated user could set `is_super_admin = true` on their own row using nothing but the public anon key — `is_super_admin` is treated as an unconditional bypass by every RLS policy and Edge Function permission check on the platform, so this defeated the entire tenant-isolation model. Fixed by `supabase/migrations/0042_security_hardening.sql`, which adds a `BEFORE UPDATE` trigger pinning privileged columns (`is_super_admin`, `org_id`, `user_code`, `email`, `status`) to their old values whenever the caller is `authenticated`/`anon` (the `service_role` and direct SQL connections are unaffected, so provisioning flows keep working).

> **This migration exists in the repository but its deployment status on any live Supabase project should be verified directly** (`supabase db push` / the migrations table in the dashboard) rather than assumed — it was reported not yet deployed as of the audit date. Do not treat this fix as live in production without checking.

**Five findings were deliberately left as documented, not auto-fixed**, because they need a runtime smoke test or a product decision rather than a mechanical patch:

- Electron `webSecurity: false`
- Electron 31 is end-of-life
- Email confirmations disabled in Supabase Auth
- Remaining major-version dependency bumps
- Placeholder model-signing key

## Known open items

- The local engine has no network auth by design (see above) — this is a deliberate trust boundary (loopback + desktop-fronted), not an oversight, but it means the engine must never be exposed directly to an untrusted network.
- Portal Analytics/Billing surfaces are early-stage; the schema is live but some UI is still filling in.
- Detection accuracy in adverse conditions (night/rain/fog), cross-camera re-identification, and 100+ camera scale have not been validated on representative footage/hardware.

## Sub-scores from the 2026-07-25 audit

| Domain | Before | After |
|---|---:|---:|
| Authentication | 70 | 72 |
| Authorization | 30 | 90 |
| API security | 62 | 84 |
| Infrastructure / client | 48 | 70 |
| AI / pipeline security | 55 | 84 |
| Data protection | 72 | 78 |

Authorization's jump reflects that it was capped almost entirely by the single critical finding above — RLS and Edge Function checks were otherwise already thorough. Infrastructure/client stayed lower because of the two open Electron items.
