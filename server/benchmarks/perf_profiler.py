"""
CamAI v1.0.0 — Pipeline Performance Profiler & Benchmark Reporter
=================================================================
Queries the running engine at http://127.0.0.1:8000, samples per-stage
FPS and latency over a configurable window, and writes a Markdown + JSON
benchmark report to benchmarks/report_<timestamp>.md / .json.

Usage:
    cd server
    python -m benchmarks.perf_profiler [--cameras N] [--duration S] [--url URL]
"""

from __future__ import annotations

import argparse
import json
import statistics
import sys
import time
import urllib.request
from datetime import datetime
from pathlib import Path

# ---------------------------------------------------------------------------
_DEFAULT_URL = "http://127.0.0.1:8000"
_TARGET_CPU_FPS = 12   # minimum acceptable CPU FPS
_TARGET_GPU_FPS = 25   # minimum acceptable GPU FPS


def _get(url: str, path: str, timeout: float = 5.0):
    with urllib.request.urlopen(f"{url}{path}", timeout=timeout) as r:
        return json.loads(r.read())


def _sample(url: str, camera_ids: list[str]) -> dict:
    """Fetch one snapshot of telemetry for every camera."""
    snap: dict = {}
    for cam_id in camera_ids:
        try:
            tel = _get(url, f"/api/cameras/{cam_id}/telemetry")
            snap[cam_id] = tel
        except Exception as e:
            snap[cam_id] = {"error": str(e)}
    return snap


def _format_ms(v: float) -> str:
    return f"{v:.1f} ms"


def _format_fps(v: float) -> str:
    return f"{v:.1f} FPS"


def run_benchmark(url: str, duration: float, output_dir: Path) -> dict:
    # ------------------------------------------------------------------
    # 1. Connect and discover cameras
    # ------------------------------------------------------------------
    print(f"\n[Profiler] Connecting to engine at {url} ...")
    try:
        status = _get(url, "/api/status")
    except Exception as e:
        print(f"[Profiler] FAILED: Cannot reach engine — {e}")
        sys.exit(1)

    engine_info = status.get("engine", {})
    device = engine_info.get("device", "cpu").upper()
    backend = "OpenVINO" if "openvino" in device.lower() else "ONNX"
    selected_model = status.get("selectedModel", "unknown")
    camera_states = status.get("cameras", {})
    camera_ids = list(camera_states.keys())

    print(f"[Profiler] Engine online — device={device} model={selected_model}")
    print(f"[Profiler] Active cameras: {len(camera_ids)}")
    if not camera_ids:
        print("[Profiler] WARNING: No active cameras found. Add at least one camera.")

    # ------------------------------------------------------------------
    # 2. Sample loop
    # ------------------------------------------------------------------
    samples: list[dict] = []
    deadline = time.time() + duration
    interval = 0.5  # sample every 500ms

    print(f"[Profiler] Sampling for {duration:.0f}s (interval={interval*1000:.0f}ms)...")
    while time.time() < deadline:
        t0 = time.time()
        snap = _sample(url, camera_ids)

        # Also grab global status for CPU/GPU/RAM
        try:
            st = _get(url, "/api/status")
            eng = st.get("engine", {})
        except Exception:
            eng = {}

        samples.append({
            "ts": t0,
            "cameras": snap,
            "engine": eng,
        })
        sleep_remaining = interval - (time.time() - t0)
        if sleep_remaining > 0:
            time.sleep(sleep_remaining)

    print(f"[Profiler] Collected {len(samples)} samples.")

    # ------------------------------------------------------------------
    # 3. Aggregate per camera
    # ------------------------------------------------------------------
    cam_stats: dict[str, dict] = {}
    for cam_id in camera_ids:
        metrics: dict[str, list] = {
            "camera_fps": [], "decode_fps": [], "inference_fps": [], "tracking_fps": [],
            "fps": [],
            "capture_latency": [], "decode_latency": [], "preprocess_latency": [],
            "inference_latency": [], "postprocess_latency": [], "tracking_latency": [],
            "total_latency": [],
        }
        for s in samples:
            tel = s["cameras"].get(cam_id, {})
            if "error" in tel:
                continue
            for k in metrics:
                v = tel.get(k)
                if v is not None and isinstance(v, (int, float)):
                    metrics[k].append(float(v))

        def safe_stats(lst: list[float]) -> dict:
            if not lst:
                return {"min": 0, "max": 0, "avg": 0, "p95": 0}
            lst_sorted = sorted(lst)
            p95_idx = int(len(lst_sorted) * 0.95)
            return {
                "min": round(min(lst), 1),
                "max": round(max(lst), 1),
                "avg": round(statistics.mean(lst), 1),
                "p95": round(lst_sorted[min(p95_idx, len(lst_sorted) - 1)], 1),
            }

        cam_stats[cam_id] = {k: safe_stats(v) for k, v in metrics.items()}
        cam_stats[cam_id]["name"] = camera_states.get(cam_id, {}).get("name", cam_id)

    # ------------------------------------------------------------------
    # 4. Aggregate engine-wide
    # ------------------------------------------------------------------
    cpu_samples = [s["engine"].get("cpu_percent", 0.0) for s in samples if s["engine"]]
    mem_samples = [s["engine"].get("memory_mb", 0.0) for s in samples if s["engine"]]
    gpu_samples = [s["engine"].get("gpu_percent", 0) for s in samples if s["engine"]]

    engine_agg = {
        "device": device,
        "backend": backend,
        "selected_model": selected_model,
        "cpu_avg": round(statistics.mean(cpu_samples) if cpu_samples else 0, 1),
        "cpu_max": round(max(cpu_samples) if cpu_samples else 0, 1),
        "ram_mb_avg": round(statistics.mean(mem_samples) if mem_samples else 0, 1),
        "ram_mb_max": round(max(mem_samples) if mem_samples else 0, 1),
        "gpu_avg": round(statistics.mean(gpu_samples) if gpu_samples else 0, 1),
        "gpu_max": round(max(gpu_samples) if gpu_samples else 0, 1),
    }

    # ------------------------------------------------------------------
    # 5. FPS pass/fail check
    # ------------------------------------------------------------------
    on_gpu = "GPU" in device or "CUDA" in device
    target_fps = _TARGET_GPU_FPS if on_gpu else _TARGET_CPU_FPS

    fps_results: list[dict] = []
    overall_pass = True
    for cam_id, cs in cam_stats.items():
        avg_ai_fps = cs["inference_fps"]["avg"]
        avg_pipe_fps = cs["fps"]["avg"]
        passed = avg_ai_fps >= target_fps
        if not passed:
            overall_pass = False
        fps_results.append({
            "camera": cs["name"],
            "ai_fps_avg": avg_ai_fps,
            "pipeline_fps_avg": avg_pipe_fps,
            "target_fps": target_fps,
            "passed": passed,
        })

    # ------------------------------------------------------------------
    # 6. Write reports
    # ------------------------------------------------------------------
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    output_dir.mkdir(parents=True, exist_ok=True)
    json_path = output_dir / f"benchmark_{timestamp}.json"
    md_path   = output_dir / f"benchmark_{timestamp}.md"

    report_data = {
        "timestamp": datetime.now().isoformat(),
        "duration_s": duration,
        "engine": engine_agg,
        "cameras": cam_stats,
        "fps_results": fps_results,
        "overall_pass": overall_pass,
    }
    json_path.write_text(json.dumps(report_data, indent=2))

    # --- Markdown ---
    status_icon = "✅ PASS" if overall_pass else "❌ FAIL"
    lines = [
        f"# CamAI v1.0.0 — Benchmark Report",
        f"",
        f"**Date:** {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}  ",
        f"**Overall:** {status_icon}  ",
        f"**Target FPS:** {target_fps} ({'GPU' if on_gpu else 'CPU'})  ",
        f"",
        f"## Engine",
        f"",
        f"| Metric | Value |",
        f"|--------|-------|",
        f"| Device | `{device}` |",
        f"| Backend | `{backend}` |",
        f"| Model | `{selected_model}` |",
        f"| CPU Avg | {engine_agg['cpu_avg']}% |",
        f"| CPU Max | {engine_agg['cpu_max']}% |",
        f"| RAM Avg | {engine_agg['ram_mb_avg']} MB |",
        f"| RAM Max | {engine_agg['ram_mb_max']} MB |",
        f"| GPU Avg | {engine_agg['gpu_avg']}% |",
        f"| GPU Max | {engine_agg['gpu_max']}% |",
        f"",
        f"## FPS Summary",
        f"",
        f"| Camera | AI FPS (avg) | Pipeline FPS | Target | Result |",
        f"|--------|-------------|-------------|--------|--------|",
    ]
    for r in fps_results:
        icon = "✅" if r["passed"] else "❌"
        lines.append(
            f"| {r['camera']} | {r['ai_fps_avg']:.1f} | {r['pipeline_fps_avg']:.1f} | {r['target_fps']} | {icon} |"
        )

    lines += ["", "## Per-Camera Stage Latency", ""]
    for cam_id, cs in cam_stats.items():
        lines += [
            f"### {cs['name']}",
            f"",
            f"| Stage | Avg (ms) | P95 (ms) | Min | Max |",
            f"|-------|----------|----------|-----|-----|",
        ]
        stage_map = [
            ("capture_latency",     "Capture"),
            ("decode_latency",      "JPEG Encode"),
            ("preprocess_latency",  "AI Preprocess"),
            ("inference_latency",   "AI Inference"),
            ("postprocess_latency", "AI Postprocess"),
            ("tracking_latency",    "Tracking"),
            ("total_latency",       "TOTAL End-to-End"),
        ]
        for key, label in stage_map:
            st = cs.get(key, {})
            lines.append(
                f"| {label} | {st.get('avg', 0):.1f} | {st.get('p95', 0):.1f} | {st.get('min', 0):.1f} | {st.get('max', 0):.1f} |"
            )
        lines.append("")

    lines += [
        "## Bottleneck Analysis",
        "",
    ]
    if cam_stats:
        for cam_id, cs in cam_stats.items():
            stage_avgs = {
                "capture":      cs.get("capture_latency", {}).get("avg", 0),
                "decode":       cs.get("decode_latency", {}).get("avg", 0),
                "preprocess":   cs.get("preprocess_latency", {}).get("avg", 0),
                "inference":    cs.get("inference_latency", {}).get("avg", 0),
                "postprocess":  cs.get("postprocess_latency", {}).get("avg", 0),
                "tracking":     cs.get("tracking_latency", {}).get("avg", 0),
            }
            bottleneck = max(stage_avgs, key=stage_avgs.get)
            lines.append(f"- **{cs['name']}** — bottleneck: `{bottleneck}` ({stage_avgs[bottleneck]:.1f} ms)")

    lines += ["", "---", f"*Generated by CamAI v1.0.0 perf_profiler at {datetime.now().isoformat()}*", ""]
    md_path.write_text("\n".join(lines))

    print(f"\n[Profiler] Report saved:")
    print(f"  JSON: {json_path}")
    print(f"  MD:   {md_path}")
    print(f"\n[Profiler] Overall FPS result: {status_icon}")
    for r in fps_results:
        icon = "✅" if r["passed"] else "❌"
        print(f"  {icon} {r['camera']}: AI FPS={r['ai_fps_avg']:.1f} (target={r['target_fps']})")

    if not overall_pass:
        print("\n[Profiler] RELEASE BLOCKED: FPS below target on one or more cameras.")
        sys.exit(2)
    else:
        print("\n[Profiler] All cameras meet FPS target. Release unblocked.")

    return report_data


def main():
    p = argparse.ArgumentParser(description="CamAI pipeline benchmark")
    p.add_argument("--url",      default=_DEFAULT_URL, help="Engine base URL")
    p.add_argument("--duration", default=30.0, type=float, help="Sampling window (seconds)")
    p.add_argument("--out",      default="benchmarks", help="Output directory")
    args = p.parse_args()

    run_benchmark(
        url=args.url,
        duration=args.duration,
        output_dir=Path(args.out),
    )


if __name__ == "__main__":
    main()
