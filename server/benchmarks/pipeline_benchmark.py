"""
Performance benchmark harness for the CamAI pipeline (server/app/ai/pipeline.py).

Not a pytest test — hardware-dependent (GPU vs CPU backend availability
varies by machine), so it's a runnable, reportable script rather than a
pass/fail gate in the main `pytest tests/` suite. Run it directly:

    python benchmarks/pipeline_benchmark.py [--cameras N] [--seconds S]

Measures steady-state tracking FPS and end-to-end latency for both a
single camera and N concurrent cameras (sharing one backend, matching the
real app/camera_manager.py pattern), and reports against the goal's
25-30 FPS minimum real-time target.
"""
import argparse
import os
import sys
import time
import threading

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
os.chdir(os.path.join(os.path.dirname(__file__), ".."))

import numpy as np
import cv2

from app.ai.backend import EngineBackend
from app.ai.pipeline import PipelineCoordinator

W, H = 640, 480
TARGET_FPS_MIN = 25.0


def make_frame(cam_idx, t):
    frame = np.full((H, W, 3), 30 + (cam_idx * 10) % 100, dtype=np.uint8)
    x = int(50 + (t * 60) % (W - 130))
    color = ((cam_idx * 60) % 255, 40, 220 - (cam_idx * 30) % 200)
    cv2.rectangle(frame, (x, 150), (x + 80, 400), color, -1)
    return frame


def run_benchmark(n_cameras: int, seconds: float, backend: EngineBackend):
    coords = []
    for i in range(n_cameras):
        c = PipelineCoordinator(
            camera_id=f"bench_cam_{i}", name=f"Bench Cam {i}",
            source_type="screenshare", source="",
            zones_json="[]", lines_json="[]",
            backend_model=backend,
        )
        coords.append(c)
    for c in coords:
        c.start()

    stop_evt = threading.Event()

    def feed(idx, coord):
        t0 = time.time()
        while not stop_evt.is_set():
            coord.push_frame(make_frame(idx, time.time() - t0))
            time.sleep(1 / 60)  # feed faster than any realistic camera FPS ceiling

    feeders = [threading.Thread(target=feed, args=(i, coords[i]), daemon=True) for i in range(n_cameras)]
    for f in feeders:
        f.start()

    try:
        # GPU backends do shape-specific kernel compilation on first
        # inference, which can legitimately take well past a minute (see
        # app/ai/pipeline.py's _ai_loop warm-up comment) — measuring
        # immediately would report the cold-start cost, not steady-state
        # throughput. Wait for every camera's telemetry to actually start
        # advancing before starting the timed measurement window.
        warmup_deadline = time.time() + 120.0
        print(f"  (waiting for all {n_cameras} camera(s) to finish warm-up...)")
        while time.time() < warmup_deadline:
            if all("stage_errors" in c.latest_telemetry for c in coords):
                break
            time.sleep(1.0)
        else:
            print("  WARNING: not all cameras finished warm-up within 120s — measuring anyway")
        time.sleep(seconds)
    finally:
        stop_evt.set()
        for f in feeders:
            f.join(timeout=2)

        results = []
        for i, c in enumerate(coords):
            tel = c.latest_telemetry
            results.append({
                "camera": f"bench_cam_{i}",
                "tracking_fps": tel.get("tracking_fps", 0.0),
                "camera_fps": tel.get("camera_fps", 0.0),
                "total_latency_ms": tel.get("total_latency", 0.0),
                "stage_errors": sum(tel.get("stage_errors", {}).values()) if "stage_errors" in tel else None,
            })
        for c in coords:
            c.stop()
        time.sleep(0.5)
        return results


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cameras", type=int, default=1, help="cameras to run concurrently in the multi-cam pass")
    ap.add_argument("--seconds", type=float, default=15.0, help="measurement window per pass")
    args = ap.parse_args()

    backend = EngineBackend("yolox_tiny")
    print(f"Backend: {backend.backend_type} on {backend.backend_device}\n")

    print(f"=== Pass 1: single camera, {args.seconds:.0f}s ===")
    single = run_benchmark(1, args.seconds, backend)[0]
    print(f"  tracking_fps={single['tracking_fps']:.1f}  camera_fps={single['camera_fps']:.1f}  "
          f"latency={single['total_latency_ms']:.1f}ms  stage_errors={single['stage_errors']}")
    verdict = "PASS" if single["tracking_fps"] >= TARGET_FPS_MIN else "BELOW TARGET"
    print(f"  -> {verdict} (target >= {TARGET_FPS_MIN} FPS)\n")

    if args.cameras > 1:
        print(f"=== Pass 2: {args.cameras} concurrent cameras, {args.seconds:.0f}s ===")
        multi = run_benchmark(args.cameras, args.seconds, backend)
        for r in multi:
            print(f"  {r['camera']}: tracking_fps={r['tracking_fps']:.1f}  "
                  f"latency={r['total_latency_ms']:.1f}ms  stage_errors={r['stage_errors']}")
        any_errors = any((r["stage_errors"] or 0) > 0 for r in multi)
        print(f"  -> {'FAIL: stage errors under concurrent load' if any_errors else 'PASS: zero stage errors under concurrent load'}\n")

    print("Note: FPS depends heavily on available hardware (GPU vs CPU-only backend,\n"
          "and CPU core contention when running many cameras concurrently on CPU).\n"
          "The 25-30 FPS target assumes GPU/hardware-accelerated inference per camera.")


if __name__ == "__main__":
    main()
