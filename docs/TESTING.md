# Testing

## Server (`server/tests/`)

19 test files, 283 tests collected (`pytest --collect-only`), covering analytics, camera reachability testing, confidence thresholds, detection class filtering, emission/overlay correctness, helmet detection, the Kalman bbox cache, MJPEG connection budgeting and viewer gating, plate detection/OCR, the recorder, source-status contracts, speed contracts, stream resolution (YouTube/Twitch), tiling, the tracker, and zone profiles.

```bash
cd server
pip install -r dev-requirements.txt
pytest tests
```

Run a single file or test:

```bash
pytest tests/test_tracker.py
pytest tests/test_tracker.py::test_track_survives_occlusion -v
```

### Production readiness report

```bash
cd server
python production_readiness_report.py
```

Re-runs a validation suite against the machine it's executed on and emits a JSON report (`production_readiness_report.json`) — useful for confirming a target deployment box meets requirements before go-live, separately from the deterministic pytest suite.

### Benchmarks

```bash
python server/benchmarks/pipeline_benchmark.py --cameras 4 --seconds 10
```

See [`PERFORMANCE.md`](PERFORMANCE.md) for how to read the output.

## Desktop (`desktop/src/`)

Vitest-based unit tests colocated with the modules they cover (`*.test.ts`), including `localEngine`, `smartCrop`, `telemetry`, `trackLedger`, and `zoneEditor`.

```bash
cd desktop
npm run test         # single run
npm run test:watch   # watch mode
```

## What isn't covered

There is no end-to-end/integration test suite exercising the desktop UI against a live engine, and no automated test suite for `portal/`. Manual verification against the running app is the current practice for both — see the note in the root project instructions about testing UI changes in a real browser/app session before calling them complete.
