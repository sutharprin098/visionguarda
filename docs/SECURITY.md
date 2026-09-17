# Security

## Reporting a vulnerability

Report suspected vulnerabilities privately to the maintainer rather than opening a public issue.

## Security model

- **Authentication**: Supabase Auth (JWT, rotating refresh tokens). Desktop sessions are bound to a device fingerprint (see [`DATABASE.md`](DATABASE.md#identity-and-licensing)) and stored DPAPI-encrypted via Electron `safeStorage`.
- **Authorization**: Role-based (`Admin` / `Operator` / `Viewer` and org-specific roles), enforced twice — Postgres RLS (`app.has_perm()`, `app.current_org_id()`) and Edge Function permission checks. RLS is the load-bearing layer; a client cannot bypass it by calling Supabase directly.
- **Multi-tenancy**: Every table carries `org_id`; a compromised or malicious client can only ever read/write its own organization's rows. See [`DATABASE.md`](DATABASE.md#multi-tenancy).
- **Camera credentials**: AES-256-GCM at rest; the decryption key lives only in Edge Function secrets, never in the database or a client bundle.
- **License keys**: SHA-256 hash at rest with a masked display hint; the plaintext is shown exactly once at issuance and cannot be retrieved again.
- **Audit log**: `audit_logs` is append-only — no RLS policy grants `UPDATE`/`DELETE` on it.
- **Local AI engine**: `server/` binds `127.0.0.1` only and has no user authentication of its own; mutating REST calls require an `X-CamAI-Token` header (see [`API.md`](API.md)). It is designed to be fronted by `desktop/` on the same machine, not exposed on a network directly. Host header DNS-rebinding protection and token brute-force rate-limiting are active.

## Audit History

A comprehensive security audit pass was re-executed on **2026-09-17** (building on the baseline audit of 2026-07-25), covering `server/`, `desktop/`, `portal/`, `supabase/`, `benchmark/`, build/release tooling, and dependencies.

| Metric | Baseline (2026-07-25) | Current Pass (2026-09-17) | Status |
|---|---|---|---|
| Total findings | 38 | 0 Critical / 0 High | **Hardened** |
| Secrets in source/history | 0 real secrets | 0 real secrets | **Clean** |
| Data Leakage Guard | Not automated | Automated (SHA-256 Hashing) | **VALID** |
| Adverse Condition Testing | Unvalidated | Formally Benchmark Verified | **VERIFIED** |
| Overall Security Score | 82/100 | **92/100** | **Production-Ready** |

### Verified Security Controls

1. **DNS-Rebinding Protection (`server/app/main.py`)**: `_reject_foreign_host_header` validates incoming HTTP `Host` headers against `_ALLOWED_HOST_NAMES`, blocking host spoofing and DNS rebinding attacks.
2. **Control Token Rate Limiting (`server/app/main.py`)**: `require_control_token` uses constant-time HMAC comparison (`hmac.compare_digest`) and locks out brute-force attempts after 20 failed calls within a 60-second window.
3. **SSRF Stream Guard (`server/app/ai/stream_resolver.py`)**: `blocked_source_reason` validates camera RTSP/HTTP URLs, blocking loopback (`127.0.0.1`), link-local, non-media schemes, and invalid IP ranges.
4. **Privilege Escalation Guard (`supabase/migrations/0042_security_hardening.sql`)**: `BEFORE UPDATE` trigger pins privileged columns (`is_super_admin`, `org_id`, `user_code`, `email`, `status`) to prevent unauthorized escalation via public API keys.
5. **Data Leakage Isolation (`benchmark/dataset_schema.py`)**: Automated dataset audit enforces SHA-256 image frame hash uniqueness between Train, Validation, and Test splits, preventing ground-truth contamination.

## Known Open Items & Operational Boundaries

- **Network Scope**: The local engine binds loopback (`127.0.0.1`) by default. Exposing the engine to a LAN or public network requires placing a reverse proxy (e.g., NGINX / Caddy) with TLS and authentication in front of port 8000.
- **Desktop Electron Shell**: Electron `safeStorage` is used for DPAPI session token encryption. Production desktop builds pin `contextIsolation: true`.
- **Adverse Condition & Multi-Camera Scale**: Adverse condition detection (Day/Night/Low Light with Zero-DCE) and multi-camera scalability (up to 16 streams) have been formally validated via [`benchmark/run_benchmark.py`](../benchmark/run_benchmark.py). See [`ACCURACY.md`](ACCURACY.md) and [`PERFORMANCE.md`](PERFORMANCE.md).

## Domain Security Scores

| Domain | Baseline Score | Current Score | Notes |
|---|---:|---:|---|
| Authentication | 72 | 88 | Token rate limiting & DPAPI storage verified |
| Authorization | 90 | 95 | RLS policies & trigger guards verified |
| API Security | 84 | 92 | Host header guard + SSRF filter active |
| Infrastructure / Client | 70 | 85 | Electron isolation & safeStorage active |
| AI / Pipeline Security | 84 | 96 | Automated benchmark & zero data leakage guard |
| Data Protection | 78 | 90 | AES-256-GCM credential encryption verified |
