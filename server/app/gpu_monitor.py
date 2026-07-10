"""Background GPU usage sampler.

There is no fast, cross-vendor way to read GPU utilization from Python (the
OpenVINO/onnxruntime/torch APIs used elsewhere in this app don't expose it).
On Windows, the "GPU Engine" performance counters Task Manager itself reads
are exposed via PowerShell's Get-Counter, but a single query costs ~2-3s of
subprocess/PowerShell startup overhead — far too slow to call from the hot
per-frame telemetry path. Instead this samples on its own daemon thread on a
slow cadence and caches the last reading; telemetry reads just do a cheap
dict lookup.
"""
import re
import subprocess
import sys
import threading
import time

_lock = threading.Lock()
_latest_gpu_percent = 0.0
_available = sys.platform == "win32"

_PS_ARGS = [
    "powershell", "-NoProfile", "-NonInteractive", "-Command",
    "(Get-Counter '\\GPU Engine(*)\\Utilization Percentage' -ErrorAction SilentlyContinue)."
    "CounterSamples | ForEach-Object { \"$($_.Path)|$($_.CookedValue)\" }",
]

_ENGTYPE_RE = re.compile(r"engtype_([a-zA-Z0-9]+)\)")


def _sample_once():
    try:
        out = subprocess.run(
            _PS_ARGS, capture_output=True, text=True, timeout=5.0,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
    except Exception:
        return None

    # Sum utilization per engine type (3D, Compute, Copy, VideoDecode, ...);
    # Task Manager's headline "GPU" percentage is the busiest engine-type
    # category, not a sum across all of them, so mirror that here.
    totals: dict = {}
    for line in out.stdout.splitlines():
        line = line.strip()
        if not line or "|" not in line:
            continue
        path, _, val = line.rpartition("|")
        m = _ENGTYPE_RE.search(path)
        if not m:
            continue
        try:
            v = float(val)
        except ValueError:
            continue
        engtype = m.group(1)
        totals[engtype] = totals.get(engtype, 0.0) + v

    if not totals:
        return 0.0
    return min(100.0, max(totals.values()))


def _sampler_loop():
    global _latest_gpu_percent
    while True:
        if _available:
            v = _sample_once()
            if v is not None:
                with _lock:
                    _latest_gpu_percent = v
        time.sleep(5.0)


_thread = threading.Thread(target=_sampler_loop, name="GPUMonitor", daemon=True)
_thread.start()


def get_gpu_usage() -> float:
    with _lock:
        return round(_latest_gpu_percent, 1)
