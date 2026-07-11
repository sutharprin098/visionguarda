# CamAI — Buyer Handover & Due-Diligence Guide

Prepared 2026-07-11 for an outright source-code + IP sale.

## 1. What the buyer receives

- Full source for all five workspaces (`server/`, `client/`, `portal/`,
  `desktop/`, `supabase/`) — see `README.md` for the map.
- Git repository with clean history (build artifacts, dependencies, model
  weights and runtime data are not tracked; see §5).
- Documentation: `README.md` (setup/run), `PLATFORM.md` (enterprise
  platform design), `LICENSING.md` (third-party inventory), this file.
- Deterministic test suite (`server/tests`, 23 tests) plus
  `server/production_readiness_report.py`, which re-runs the validation
  suite on the buyer's hardware and emits a JSON report.
- "CamAI" name and branding.

Not included: any customer data, Supabase project instances, or third-party
accounts. The buyer deploys their own Supabase project via
`supabase/migrations` + `PLATFORM.md` §Setup.

## 2. Technical highlights (what the money buys)

- **Decoupled video/AI pipeline** — MJPEG at camera FPS + WebSocket
  telemetry, canvas overlay client. No frames on the WebSocket.
- **5-module slot pipeline** per camera (capture → detect → track →
  analyze → publish), measured 30 fps / ~10 ms avg AI-cycle latency on
  Intel iGPU.
- **Multi-backend inference** with runtime auto-selection: TensorRT/CUDA →
  OpenVINO → ONNX CPU, with first-party pre/post-processing (letterbox,
  NMS, mask decode) — no AGPL code in the runtime path.
- **Original ByteTrack-style tracker** with Hungarian assignment,
  appearance ReID and a lost-track gallery for persistent IDs.
- **Analytics suite**: zones, line crossing (sub-frame interpolation),
  dwell, Kalman-smoothed speed, crowd density, abandoned objects,
  parking occupancy, heatmaps.
- **Enterprise licensing platform**: hash-only license keys with one-time
  reveal, device fingerprint binding (CPU/board/disk/TPM/MachineGuid),
  org-scoped Postgres RLS multi-tenancy, realtime config sync (~1 s),
  DPAPI-encrypted desktop vault, append-only audit log.

## 3. Known open items (disclosed)

1. **YOLO11 weights are AGPL-licensed by Ultralytics** — the single
   material licensing issue. Resolution paths (enterprise license, model
   swap, or AGPL compliance) are costed in `LICENSING.md` §2. The
   `ultralytics` package itself is already out of the runtime.
2. **Local engine has no auth** — by design it binds loopback and is
   fronted by the desktop app. Exposing it on a network requires a proxy
   or adding auth.
3. Portal Analytics/Billing surfaces are early; schema is live
   (`PLATFORM.md` §Current gaps lists the remaining milestones).
4. Detection accuracy in adverse conditions (night/rain/fog), cross-camera
   ReID, and 100+ camera scale need validation on representative footage
   and target hardware (`production_readiness_report.json` §limitations).
5. A third-party API token was committed early in the repo's life and has
   been purged from history; the token was revoked. No other secrets have
   ever been tracked (audited 2026-07-11).

## 4. Validation the buyer can re-run

```bash
cd server
python -m pip install -r dev-requirements.txt
python -m pytest tests                       # 23 deterministic tests
python production_readiness_report.py        # hardware + validation JSON
cd ../client && npm install && npm run build
cd ../portal && npm install && npm run build
cd ../desktop && npm install && npm run build # NSIS installer
```

## 5. Repository hygiene

- Tracked file count is ~160 source/docs files; `node_modules`, build
  outputs, model weights, recordings and logs are gitignored.
- Model weights are distributed alongside the repo (or regenerated via
  `server/export_models.py` from upstream YOLO11 releases).
- Git history was rewritten before sale to purge large artifacts and the
  leaked token; a pre-rewrite bundle is retained by the seller.
