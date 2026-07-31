# Handover

For an engineer or buyer taking over this codebase — what's here, what's proven, and what's still open.

## What's included

- Full source for all four workspaces (`server/`, `desktop/`, `portal/`, `supabase/`) — see [`ARCHITECTURE.md`](ARCHITECTURE.md) for the map. There is no separate `client/` workspace; the live CCTV viewer is part of `desktop/`.
- A git repository with 384 tracked files. `node_modules`, build outputs, model weights, recordings, and logs are gitignored, not tracked.
- This documentation set (`docs/`), `README.md`, and `LICENSE.md`.
- A deterministic test suite (`server/tests/`, 283 tests across 19 files; `desktop/src/**/*.test.ts` via Vitest) plus `server/production_readiness_report.py`, which re-validates against whatever hardware it's run on and emits a JSON report. See [`TESTING.md`](TESTING.md).
- The "CamAI" name and branding.

**Not included**: any live customer data, the seller's own Supabase project instance, or third-party accounts. A new operator deploys their own Supabase project — see [`DATABASE.md`](DATABASE.md#deploying-a-fresh-supabase-project).

## Technical highlights

- Decoupled video/AI pipeline: MJPEG at camera FPS + WebSocket telemetry, canvas overlay on the client. No frame is ever sent over the WebSocket.
- A seven-module slot-based per-camera pipeline (capture → MJPEG encode → detect → track/rules → telemetry build → dispatch → recording), each stage handing off through a "latest wins" slot so a slow stage drops stale work instead of backing up. See [`ARCHITECTURE.md`](ARCHITECTURE.md).
- Multi-backend inference with runtime auto-selection (TensorRT → CUDA → DirectML → OpenVINO GPU → CPU) and first-party pre/post-processing — no AGPL code in the runtime path (see [`LICENSING.md`](LICENSING.md)).
- An original ByteTrack-style tracker: Hungarian assignment, appearance ReID, lost-track gallery, wall-clock-aware motion prediction.
- An analytics suite covering zones, line crossing, dwell, Kalman-smoothed speed, crowd density, abandoned objects, and parking occupancy.
- An enterprise licensing platform: hash-only license keys with one-time reveal, device fingerprint binding, org-scoped Postgres RLS multi-tenancy, realtime config sync (~1s), DPAPI-encrypted desktop vault, append-only audit log — see [`DATABASE.md`](DATABASE.md) and [`SECURITY.md`](SECURITY.md).

## Known open items

1. **Local engine has no network auth by design** — it binds loopback and is fronted by `desktop/`. Exposing it on a network requires adding a proxy or auth layer in front of it.
2. **A critical RLS privilege-escalation bug was found and fixed** in `supabase/migrations/0042_security_hardening.sql` (2026-07-25 audit) — confirm this migration is actually applied to any live Supabase project before treating the fix as active. See [`SECURITY.md`](SECURITY.md) for the full finding.
3. Five lower-severity security findings from that same audit are documented but not auto-fixed (Electron `webSecurity: false`, EOL Electron 31, disabled email confirmations, pending dependency major-version bumps, a placeholder model-signing key) — see [`SECURITY.md`](SECURITY.md).
4. Portal Analytics/Billing surfaces are early-stage; schema is live but some UI is still filling in.
5. Detection accuracy in adverse conditions (night/rain/fog), cross-camera re-identification, and scale beyond ~100 cameras have not been validated on representative footage/hardware.
6. There is no automated end-to-end test suite for the desktop UI against a live engine, and no automated test suite for `portal/` — see [`TESTING.md`](TESTING.md).

## Validation a new operator can re-run

```bash
cd server
pip install -r dev-requirements.txt
pytest tests                                  # 283 tests
python production_readiness_report.py         # hardware + validation JSON

cd ../desktop && npm install && npm run test && npm run build
cd ../portal && npm install && npm run build
```

## Repository hygiene

- 384 tracked files as of this writing; `node_modules`, build outputs, model weights, recordings and logs are gitignored.
- Model weights are not tracked in git and are regenerated via `server/export_models.py` from upstream releases (see [`LICENSING.md`](LICENSING.md)).
- The git history on this repository was rewritten prior to an earlier sale-preparation pass to remove large build artifacts and a leaked credential — if you're inheriting a clone made before that point, re-clone rather than pulling to avoid history divergence.
