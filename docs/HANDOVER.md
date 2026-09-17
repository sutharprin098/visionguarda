# Handover

For an engineer or buyer taking over this codebase — what's here, what's proven, and what's still open.

---

## 1. What's Included

- Full source for all four workspaces (`server/`, `desktop/`, `portal/`, `supabase/`) — see [`ARCHITECTURE.md`](ARCHITECTURE.md) for the map. There is no separate `client/` workspace; the live CCTV viewer is part of `desktop/`.
- A git repository with tracked files. `node_modules`, build outputs, model weights, recordings, and logs are gitignored, not tracked.
- This documentation set (`docs/`), including the formal AI accuracy specification [`ACCURACY.md`](ACCURACY.md), `README.md`, and `LICENSE`.
- Formal AI accuracy & performance benchmarking framework (`benchmark/run_benchmark.py`), generating `results.json`, `results.csv`, `benchmark_report.html`, and `benchmark_report.pdf`.
- A deterministic test suite (`server/tests/`, 283 tests across 19 files; `desktop/src/**/*.test.ts` via Vitest) plus `server/production_readiness_report.py`, which re-validates against whatever hardware it's run on and emits a JSON report. See [`TESTING.md`](TESTING.md).
- The "CamAI" name and branding.

**Not included**: Any live customer data, the seller's own Supabase project instance, or third-party accounts. A new operator deploys their own Supabase project — see [`DATABASE.md`](DATABASE.md#deploying-a-fresh-supabase-project).

---

## 2. Technical Highlights

- **Decoupled Video/AI Pipeline**: MJPEG at camera FPS + WebSocket telemetry, canvas overlay on the client. No raw frame is ever sent over the WebSocket.
- **Seven-Module Camera Pipeline**: Slot-based per-camera pipeline (capture → MJPEG encode → detect → track/rules → telemetry build → dispatch → recording), each stage handing off through a "latest wins" slot so a slow stage drops stale work instead of backing up. See [`ARCHITECTURE.md`](ARCHITECTURE.md).
- **Multi-Backend Inference**: Runtime auto-selection (TensorRT → CUDA → DirectML → OpenVINO GPU → CPU) and first-party pre/post-processing — no AGPL code in the runtime path (see [`LICENSING.md`](LICENSING.md)).
- **ByteTrack Multi-Object Tracker**: Hungarian assignment, appearance ReID, lost-track gallery, wall-clock-aware motion prediction (IDF1: 91.40%, HOTA: 91.74%).
- **Formal AI Accuracy Suite**: Fully automated evaluation pipeline computing precision, recall, mAP@0.50, ANPR OCR exact-match accuracy, RT-DETR helmet detection, speed MAE, tripwire event F1, and Zero-DCE night vision contrast gains (see [`ACCURACY.md`](ACCURACY.md)).
- **Enterprise Security**: Host header DNS-rebinding guard, HMAC token rate-limiting, SSRF URL filter, hash-only license keys, device fingerprint binding, org-scoped Postgres RLS multi-tenancy, DPAPI-encrypted desktop vault, append-only audit log — see [`DATABASE.md`](DATABASE.md) and [`SECURITY.md`](SECURITY.md).

---

## 3. Known Open Items & Operational Boundaries

1. **Local Engine Scope**: Binds loopback (`127.0.0.1`) by default and is fronted by `desktop/`. Exposing it on a network directly requires placing a reverse proxy (e.g. NGINX / Caddy) with TLS and authentication in front of it.
2. **Supabase Migration Deployment**: A critical RLS privilege-escalation bug was fixed in `supabase/migrations/0042_security_hardening.sql` (2026-07-25 audit) — confirm this migration is applied to any live Supabase project. See [`SECURITY.md`](SECURITY.md).
3. **Audit Documentation Items**: Lower-severity security findings from audits are documented with mitigation guides in [`SECURITY.md`](SECURITY.md).
4. **Adverse Condition & Scale Validation**: Detection accuracy in adverse conditions (Day/Night/Low Light with Zero-DCE) and multi-camera scaling (up to 16 streams) have been formally validated via [`benchmark/run_benchmark.py`](../benchmark/run_benchmark.py). See [`ACCURACY.md`](ACCURACY.md).
5. **Portal Analytics/Billing**: Schema is live; UI components continue to expand in portal releases.

---

## 4. Validation a New Operator Can Re-Run

```bash
# 1. Run formal AI accuracy & performance benchmark suite
python benchmark/run_benchmark.py --samples 120 --output benchmark

# 2. Run server unit tests and readiness check
cd server
pip install -r dev-requirements.txt
pytest tests                                  # 283 tests
python production_readiness_report.py         # hardware + validation JSON

# 3. Build & test clients
cd ../desktop && npm install && npm run test && npm run build
cd ../portal && npm install && npm run build
```

---

## 5. Repository Hygiene

- All `node_modules`, build outputs, model weights, recordings, and logs are gitignored.
- Model weights are not tracked in git and are regenerated via `server/export_models.py` from upstream releases (see [`LICENSING.md`](LICENSING.md)).
