# Testing

## 1. Formal AI Accuracy & Performance Benchmark Suite (`benchmark/`)

Automated, end-to-end evaluation harness measuring actual precision, recall, mAP@0.50, mAP@0.50:0.95, ByteTrack tracking (HOTA, IDF1, MOTA), ANPR plate detection & OCR exact-match accuracy/CER, RT-DETR helmet detection, vehicle speed MAE, tripwire event analytics, Zero-DCE night vision ablation, data leakage guards, and hardware scalability.

```bash
# Run formal accuracy & performance benchmark suite
python benchmark/run_benchmark.py --samples 120 --output benchmark
```

Outputs generated:
- JSON Data: [`benchmark/results/results.json`](../benchmark/results/results.json)
- Summary CSV: [`benchmark/results/results.csv`](../benchmark/results/results.csv)
- HTML Report: [`benchmark/reports/benchmark_report.html`](../benchmark/reports/benchmark_report.html)
- PDF Report: [`benchmark/reports/benchmark_report.pdf`](../benchmark/reports/benchmark_report.pdf)

See [`ACCURACY.md`](ACCURACY.md) for detailed evaluation metrics and methodology.

---

## 2. Server Unit & Integration Tests (`server/tests/`)

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

### Production Readiness Report

```bash
cd server
python production_readiness_report.py
```

Re-runs a validation suite against the machine it's executed on and emits a JSON report (`production_readiness_report.json`) confirming target deployment box requirements.

---

## 3. Desktop (`desktop/src/`)

Vitest-based unit tests colocated with the modules they cover (`*.test.ts`), including `localEngine`, `smartCrop`, `telemetry`, `trackLedger`, and `zoneEditor`.

```bash
cd desktop
npm run test         # single run
npm run test:watch   # watch mode
```

---

## 4. Manual Verification & UI Smoke Tests

Manual verification against the running app session is required for Electron desktop and portal UI component changes.
