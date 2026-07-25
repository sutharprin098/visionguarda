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
import shutil
import subprocess
import sys
import threading
import time

_lock = threading.Lock()
_latest_gpu_percent = 0.0
# Extra signals for the tile engine's GPU governor (app.ai.tile_governor).
# Every one of these is BEST EFFORT and stays None when this machine cannot
# report it — the governor must treat "unknown" as "no constraint" rather than
# as zero, or an Intel/AMD box (where VRAM and temperature are not readable
# without a vendor SDK) would throttle itself to nothing on missing data.
_latest_gpu_mem_percent = None   # float 0-100, or None
_latest_gpu_temp_c = None        # float degrees C, or None
_available = sys.platform == "win32"

_PS_ARGS = [
    "powershell", "-NoProfile", "-NonInteractive", "-Command",
    "(Get-Counter '\\GPU Engine(*)\\Utilization Percentage' -ErrorAction SilentlyContinue)."
    "CounterSamples | ForEach-Object { \"$($_.Path)|$($_.CookedValue)\" }",
]

# Dedicated VRAM in use vs. the adapter's limit. Same counter family as above,
# so it costs one extra PowerShell round trip on the same slow cadence and never
# touches the per-frame path.
_PS_MEM_ARGS = [
    "powershell", "-NoProfile", "-NonInteractive", "-Command",
    "$u=(Get-Counter '\\GPU Adapter Memory(*)\\Dedicated Usage' -ErrorAction SilentlyContinue)."
    "CounterSamples | Measure-Object -Property CookedValue -Sum; "
    "$l=(Get-CimInstance Win32_VideoController -ErrorAction SilentlyContinue | "
    "Measure-Object -Property AdapterRAM -Maximum); "
    "\"$($u.Sum)|$($l.Maximum)\"",
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


def _sample_nvidia():
    """(utilization %, memory %, temperature C) from nvidia-smi, or None.

    Preferred when present because it is the only source here that reports
    temperature at all, and its memory figure is the process-relevant one.
    Absent on the Intel/AMD machines this product also ships to, which is why
    every caller must tolerate None.
    """
    exe = shutil.which("nvidia-smi")
    if not exe:
        return None
    try:
        out = subprocess.run(
            [exe, "--query-gpu=utilization.gpu,memory.used,memory.total,temperature.gpu",
             "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=5.0,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        line = out.stdout.strip().splitlines()[0]
        util, used, total, temp = [float(p.strip()) for p in line.split(",")]
        mem_pct = (used / total * 100.0) if total > 0 else None
        return util, mem_pct, temp
    except Exception:
        return None


def _sample_mem_windows():
    """Dedicated VRAM usage as a percentage, via Windows perf counters."""
    try:
        out = subprocess.run(
            _PS_MEM_ARGS, capture_output=True, text=True, timeout=6.0,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        used_s, _, limit_s = out.stdout.strip().partition("|")
        used, limit = float(used_s), float(limit_s)
        if limit <= 0:
            return None
        return min(100.0, used / limit * 100.0)
    except Exception:
        return None


def _sampler_loop():
    global _latest_gpu_percent, _latest_gpu_mem_percent, _latest_gpu_temp_c
    while True:
        nv = _sample_nvidia()
        if nv is not None:
            util, mem_pct, temp = nv
            with _lock:
                _latest_gpu_percent = util
                _latest_gpu_mem_percent = mem_pct
                _latest_gpu_temp_c = temp
        elif _available:
            v = _sample_once()
            if v is not None:
                with _lock:
                    _latest_gpu_percent = v
            m = _sample_mem_windows()
            with _lock:
                _latest_gpu_mem_percent = m
        time.sleep(5.0)


_thread = threading.Thread(target=_sampler_loop, name="GPUMonitor", daemon=True)
_thread.start()


def get_gpu_usage() -> float:
    with _lock:
        return round(_latest_gpu_percent, 1)


def get_gpu_stats() -> dict:
    """All sampled GPU signals. `mem_percent` / `temp_c` are None when this
    machine cannot report them (no NVIDIA driver, no readable adapter limit);
    callers must treat None as "unknown", never as 0."""
    with _lock:
        return {
            "percent": round(_latest_gpu_percent, 1),
            "mem_percent": (round(_latest_gpu_mem_percent, 1)
                            if _latest_gpu_mem_percent is not None else None),
            "temp_c": (round(_latest_gpu_temp_c, 1)
                       if _latest_gpu_temp_c is not None else None),
        }
