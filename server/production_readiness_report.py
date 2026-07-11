"""
Generate an evidence-based CamAI production readiness report.

This script intentionally separates measured results from untested claims.
It can run the deterministic pytest suite and, optionally, the hardware-
dependent multi-camera benchmark:

    python production_readiness_report.py --run-tests
    python production_readiness_report.py --run-tests --benchmark-cameras 5 --benchmark-seconds 30
"""
import argparse
import json
import os
import platform
import shutil
import subprocess
import sys
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parent


def run_command(cmd, timeout):
    start = time.time()
    proc = subprocess.run(
        cmd,
        cwd=ROOT,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        timeout=timeout,
    )
    return {
        "command": " ".join(cmd),
        "exit_code": proc.returncode,
        "duration_s": round(time.time() - start, 2),
        "output_tail": proc.stdout[-4000:],
    }


def hardware_snapshot():
    snap = {
        "platform": platform.platform(),
        "python": sys.version.split()[0],
        "cpu_count": os.cpu_count(),
    }
    try:
        import psutil
        snap["memory_gb"] = round(psutil.virtual_memory().total / (1024 ** 3), 2)
    except Exception as exc:
        snap["memory_gb"] = f"unavailable: {exc}"

    nvidia_smi = shutil.which("nvidia-smi")
    if nvidia_smi:
        try:
            gpu = subprocess.run(
                [nvidia_smi, "--query-gpu=name,memory.total,driver_version", "--format=csv,noheader"],
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                timeout=10,
            )
            snap["nvidia_gpu"] = gpu.stdout.strip() or "not reported"
        except Exception as exc:
            snap["nvidia_gpu"] = f"unavailable: {exc}"
    else:
        snap["nvidia_gpu"] = "nvidia-smi not found"
    return snap


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-tests", action="store_true", help="Run pytest validation suite.")
    parser.add_argument("--benchmark-cameras", type=int, default=0, help="Run pipeline benchmark with N cameras.")
    parser.add_argument("--benchmark-seconds", type=float, default=15.0, help="Benchmark measurement window.")
    parser.add_argument("--output", default=str(ROOT / "production_readiness_report.json"))
    args = parser.parse_args()

    report = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "hardware": hardware_snapshot(),
        "validated": {
            "deterministic_tracking": "not run",
            "analytics_counting_speed_zones": "not run",
            "detector_class_configuration": "not run",
            "parking_slot_occupancy": "not run",
            "multi_camera_stability": "not run",
        },
        "results": {},
        "limitations": [
            "Detection accuracy, night/rain/fog/glare performance, cross-camera ReID, license plate OCR, and 100+ camera scale require representative camera footage and target production hardware.",
            "Bundled COCO YOLO models can emit person, bicycle, car, motorcycle, bus, truck, traffic_light, stop_sign, and selected item classes; auto, van, trailer, emergency vehicle, license plate, cone, barrier, and animal require a domain-trained detector or an additional model.",
            "Parking-slot occupancy is validated with deterministic polygon/vehicle-overlap and visual-score tests; production thresholds should be calibrated per fixed camera angle and lighting.",
            "Supabase licensing/RLS/portal/desktop flows are not validated by this script unless separate end-to-end credentials and deployment targets are provided.",
        ],
    }

    if args.run_tests:
        report["results"]["pytest"] = run_command([sys.executable, "-m", "pytest", "tests"], timeout=180)
        status = "passed" if report["results"]["pytest"]["exit_code"] == 0 else "failed"
        report["validated"]["deterministic_tracking"] = status
        report["validated"]["analytics_counting_speed_zones"] = status
        report["validated"]["detector_class_configuration"] = status
        report["validated"]["parking_slot_occupancy"] = status

    if args.benchmark_cameras > 0:
        cmd = [
            sys.executable,
            "benchmarks/pipeline_benchmark.py",
            "--cameras",
            str(args.benchmark_cameras),
            "--seconds",
            str(args.benchmark_seconds),
        ]
        report["results"]["pipeline_benchmark"] = run_command(cmd, timeout=max(240, int(args.benchmark_seconds) + 180))
        report["validated"]["multi_camera_stability"] = (
            "completed" if report["results"]["pipeline_benchmark"]["exit_code"] == 0 else "failed"
        )

    output = Path(args.output)
    output.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"Wrote {output}")
    print(json.dumps(report["validated"], indent=2))


if __name__ == "__main__":
    main()
