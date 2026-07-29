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

# --- Cost control ------------------------------------------------------------
#
# The docstring above is right that a PowerShell counter query costs ~2-3s of
# startup. What it did NOT account for is that the loop then ran TWO of them
# (utilization + VRAM) plus a shutil.which() PATH scan, every 5 seconds, for the
# life of the process. Measured on the shipped build: a sustained 86% of one
# core, held with the GIL, on a machine with no NVIDIA GPU and no cameras
# producing frames. FastAPI's handlers were starved by it — /health went from
# ~5ms to 1.5s and kept climbing with uptime, which is what made the desktop
# declare a perfectly healthy engine unreachable.
#
# GPU telemetry is a dashboard reading and a coarse governor input. It does not
# need 5-second resolution, and it must never cost more than the work it is
# measuring. Three changes: one subprocess per cycle instead of two, a 30s
# cadence instead of 5s, and a cached nvidia-smi lookup. Net: ~12x less work.
_SAMPLE_INTERVAL_S = 30.0

# Hard ceiling on what this thread may cost, as a fraction of one core.
#
# A fixed interval is not safe here, because the price of a sample is a property
# of the MACHINE, not of this code. Measured on the shipped build: PowerShell
# startup 0.25s, `Get-Counter '\GPU Engine(*)'` 2.35s (it enumerates 366 counter
# instances — one per process per engine), `Get-Counter '\GPU Adapter Memory(*)'`
# 1.94s. Six seconds of work for one dashboard number. A box with more processes
# has more instances and pays more; the old fixed 5s interval asked for ~12.4s of
# work every 5s, i.e. 248% of a core — unsatisfiable, so it simply ran flat out
# forever, holding the GIL and starving FastAPI's handlers.
#
# So the loop now measures its own cost and sleeps proportionally: whatever a
# sample costs on this hardware, it gets at most this share of a core. Fast box
# -> the 30s floor applies. Slow box -> it backs off on its own, without anyone
# having to guess a constant that is wrong on half the fleet.
_MAX_DUTY_CYCLE = 0.02          # 2% of one core
_MAX_SLEEP_S = 600.0            # ...but still sample at least every 10 minutes

# After this many consecutive useless cycles the sampler stops for good. A box
# that cannot report GPU counters will never start being able to mid-run, and
# spawning PowerShell forever to re-learn that is pure waste.
_MAX_CONSECUTIVE_FAILURES = 5

# One PowerShell round trip for BOTH readings. The utilization lines come first,
# then a "@MEM@" marker, then the "used|limit" pair — so the expensive part
# (starting PowerShell) is paid once per cycle rather than twice.
_PS_COMBINED_ARGS = [
    "powershell", "-NoProfile", "-NonInteractive", "-Command",
    "(Get-Counter '\\GPU Engine(*)\\Utilization Percentage' -ErrorAction SilentlyContinue)."
    "CounterSamples | ForEach-Object { \"$($_.Path)|$($_.CookedValue)\" }; "
    "Write-Output '@MEM@'; "
    "$u=(Get-Counter '\\GPU Adapter Memory(*)\\Dedicated Usage' -ErrorAction SilentlyContinue)."
    "CounterSamples | Measure-Object -Property CookedValue -Sum; "
    "$l=(Get-CimInstance Win32_VideoController -ErrorAction SilentlyContinue | "
    "Measure-Object -Property AdapterRAM -Maximum); "
    "\"$($u.Sum)|$($l.Maximum)\"",
]

# shutil.which() walks every PATH entry against every PATHEXT suffix. On a
# developer/edge box that is dozens of stat() calls, and it was being paid on
# EVERY sample to re-discover that nvidia-smi still isn't installed. Resolved
# once; the negative result is cached just as firmly as a positive one.
_nvidia_exe: "str | None" = None
_nvidia_resolved = False


def _nvidia_smi_path():
    global _nvidia_exe, _nvidia_resolved
    if not _nvidia_resolved:
        _nvidia_exe = shutil.which("nvidia-smi")
        _nvidia_resolved = True
    return _nvidia_exe

_ENGTYPE_RE = re.compile(r"engtype_([a-zA-Z0-9]+)\)")


def _sample_windows_counters():
    """(utilization %, vram %) in ONE PowerShell round trip, or (None, None)."""
    try:
        out = subprocess.run(
            _PS_COMBINED_ARGS, capture_output=True, text=True, timeout=20.0,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
    except Exception:
        return None, None

    util_text, _, mem_text = out.stdout.partition("@MEM@")
    return _parse_util(util_text), _parse_mem(mem_text)


def _parse_mem(mem_text: str):
    try:
        used_s, _, limit_s = mem_text.strip().partition("|")
        used, limit = float(used_s), float(limit_s)
        if limit <= 0:
            return None
        return min(100.0, used / limit * 100.0)
    except Exception:
        return None


def _parse_util(util_text: str):
    # Sum utilization per engine type (3D, Compute, Copy, VideoDecode, ...);
    # Task Manager's headline "GPU" percentage is the busiest engine-type
    # category, not a sum across all of them, so mirror that here.
    totals: dict = {}
    for line in util_text.splitlines():
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
    exe = _nvidia_smi_path()
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


def _sampler_loop():
    """Slow, self-limiting sampler.

    Two properties this loop must hold, both learned the hard way:

    1. It costs less than it measures. One subprocess per cycle, 30s apart.
    2. It gives up. A machine that cannot report GPU counters will not start
       being able to later, so after _MAX_CONSECUTIVE_FAILURES useless cycles
       the thread exits and the readings stay None forever. Callers already
       treat None as "unknown, no constraint" (see the note at the top), so
       stopping is safe — and infinitely retrying an impossible query is
       exactly the sort of quiet, permanent CPU tax that made this file a bug.
    """
    global _latest_gpu_percent, _latest_gpu_mem_percent, _latest_gpu_temp_c
    failures = 0
    while True:
        got_anything = False
        started = time.monotonic()

        nv = _sample_nvidia()
        if nv is not None:
            util, mem_pct, temp = nv
            with _lock:
                _latest_gpu_percent = util
                _latest_gpu_mem_percent = mem_pct
                _latest_gpu_temp_c = temp
            got_anything = True
        elif _available:
            util, mem_pct = _sample_windows_counters()
            if util is not None or mem_pct is not None:
                with _lock:
                    if util is not None:
                        _latest_gpu_percent = util
                    _latest_gpu_mem_percent = mem_pct
                got_anything = True

        failures = 0 if got_anything else failures + 1
        if failures >= _MAX_CONSECUTIVE_FAILURES:
            print(
                f"[gpu_monitor] no GPU counters available after {failures} attempts — "
                "sampler stopping; GPU telemetry will read as unknown.",
                flush=True,
            )
            return

        # Sleep proportionally to what the sample actually cost on THIS machine.
        elapsed = time.monotonic() - started
        time.sleep(min(_MAX_SLEEP_S, max(_SAMPLE_INTERVAL_S, elapsed / _MAX_DUTY_CYCLE)))


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
