# Changelog

## 2026-08-27 — Engine Optimization & Decoupled High-FPS Architecture

### Added / Improved — Engine Performance & Streaming

- **Decoupled MJPEG Streaming (`_decode_loop`)**: Re-architected the live video pipeline in `PipelineCoordinator` to decouple frame decoding/encoding from AI inference. Live video streams smoothly at **30–40 FPS**, fetching bounding box overlays asynchronously from a thread-safe overlay cache (`_overlay_lock`).
- **Indentation & Scope Fix**: Resolved a critical `UnboundLocalError` inside `_decode_loop` where MJPEG encoding logic was executed outside the due-timer block, eliminating recovered exceptions and restoring high frame rate playback.
- **Telemetry & Introspection Filtering**: Updated `/api/status` in `app/main.py` and introspection in `app/health.py` to filter metrics strictly by `health_status == "online"`, ensuring dead or reconnecting cameras do not dilute live stream FPS or active camera counts.
- **Zero-DCE Night Vision Integration**: Auto-gated low-light enhancement with dynamic luminance thresholding, preventing frame drops during low-light AI processing.

## 2026-08-04 — Security audit follow-up (delta since 2026-07-25 audit)

Scope: a full manual security/architecture audit was already performed on
this codebase on 2026-07-25 (see `docs/SECURITY.md`, score 82/100, 33/38
findings fixed). This pass audits and fixes the **delta since that date** —
roughly a dozen feature/fix commits that had not yet been security-reviewed
(new `stream_url`/YouTube-Twitch camera source, three new DB migrations,
changed edge functions, desktop signing/secure-storage code) — plus verifies
the status of the five findings that audit deliberately left open, and fixes
two functional regressions found while establishing a test baseline.

### Fixed — Security

- **SSRF (new, critical): camera "source" accepted any URL, including
  loopback and cloud-metadata addresses, with no validation before the
  engine dialled it.** A camera's source is set at portal/add-camera trust
  level (any org member with `cameras.manage`), not at the trust level of
  whoever holds the local engine's own control token — so this was a real
  privilege boundary, not a redundant check. Real LAN camera addresses
  (`192.168.x.x`, `10.x.x.x`, `172.16-31.x.x`) are unaffected; only loopback,
  link-local (`169.254.169.254` — the near-universal cloud instance-metadata
  address), and non-media URL schemes (`file:`, etc.) are now refused.
  - Added `app.ai.stream_resolver.blocked_source_reason()` — the single
    source of truth for this check.
  - Wired into `PipelineCoordinator._preflight_network_source()` (every
    connection attempt, initial and reconnect, before any socket is opened),
    `POST /api/cameras` (save-time rejection with a clear 400), and
    `camera_test.py::run_test` (the "Test Connection" feature, reachable by
    any org member — previously the only network-boundary check in the
    entire path).
  - `server/app/ai/stream_resolver.py`, `server/app/ai/pipeline.py`,
    `server/app/camera_test.py`, `server/app/main.py`.

- **RLS gap: `roles.is_system` was writable via INSERT/UPDATE with no
  `WITH CHECK`.** Any org member holding `roles.manage` (assignable to a
  custom, non-admin role) could INSERT a new role with `is_system = true`
  (bypassing 0044's admin-permission auto-grant scoping) or flip an existing
  system role's `is_system` to `false` and then delete it through the 0015
  delete policy — fully reopening the "Organization Owner" lockout scenario
  migration 0015 was written to close. Fixed with a `BEFORE INSERT OR
  UPDATE` trigger pinning `is_system`, mirroring 0042's approach for
  `profiles`. `supabase/migrations/0046_protect_role_is_system.sql` (new).

- **No brute-force lockout on the engine's `X-CamAI-Token` check.** The
  comparison was already constant-time (`hmac.compare_digest`), but nothing
  bounded the number of guesses a local process could make. Added a
  20-failures-per-60s → 30s lockout. `server/app/main.py`.

### Fixed — Correctness (found via the pre-fix test baseline)

- **Speed-limit alerts could fire on an uncalibrated estimate.**
  `det["speed_calibrated"]` was hardcoded to `True` whenever any speed value
  existed, regardless of whether it came from real two-line-gate calibration
  or the ±20-30% object-height estimate — silently defeating the safeguard
  the speed-limit alert rules were written to depend on (`if not
  det.get("speed_calibrated"): continue`). Also: a class with no
  `CLASS_HEIGHT_M` size prior (e.g. `traffic_light`) fell back to a generic
  `0.025` metres-per-pixel guess instead of reporting no speed at all. Both
  now match the documented intent. `server/app/analytics.py`.

### Test suite

- Fixed 12 pre-existing failures in `test_plate.py` / `test_plate_ocr.py` /
  `test_speed_contract.py` — all test-fixture drift against intentional API
  changes from the recent ANPR rework (`PlateDetector._layout`,
  `PlateOCR.stats`/`.fmt`/`._cidx`/`._alpha_idx`/`._digit_idx`, `_finalise()`
  now returning `(detections, reason)`, `ANPR_MIN_PLATE_W` default change),
  not production bugs. `server/tests/test_plate.py`,
  `server/tests/test_plate_ocr.py`.
- Added regression coverage for every fix above: 8 new tests in
  `test_stream_resolver.py`, 2 new + 2 fixed in `test_camera_test.py`, 12 new
  in `test_speed_contract.py` (pre-existing, now passing), 6 new in
  `test_control_token.py` (new file).
- Server suite: 289 → 305 tests, all passing (was 277 passing / 12 failing).
  Desktop suite unaffected (74/74). Portal build unaffected.

### Verified, not changed (flagged for follow-up — see audit report)

- 3 of the 5 previously-deferred findings from the 2026-07-25 audit are
  still open: Electron `webSecurity: false` (+ `sandbox: false`, not
  previously flagged), Electron 31 (EOL), and the model-signing public key
  (confirmed to be an actively invalid PEM, not just a weak placeholder —
  verification fails closed today, so no downloaded model can currently pass
  it). Not mechanically fixed in this pass — see the audit report for why.
- Wildcard CORS (`Access-Control-Allow-Origin: "*"`) in
  `supabase/functions/_shared/util.ts` — confirmed not currently exploitable
  (bearer-JWT-only auth, no cookie/credentialed requests anywhere), and the
  file's own comment documents a prior live regression from tightening this
  incautiously. Left as-is pending a verified origin allowlist.
- Migration 0042 (the 2026-07-25 audit's critical RLS fix) is present in the
  repo and the local Supabase CLI is linked to a live project
  (`kuqyhceykvisqfyghiot`), but repo inspection alone cannot confirm
  `db push` was actually run against it — verify with `supabase migration
  list --linked` before treating it as deployed.
