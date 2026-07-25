"""GPU auto-governor and multi-camera resource manager for the tile engine.

Replaces the v1 budget rule — one wall-clock latency number divided equally
between cameras — with a closed loop over what the machine is actually doing.

WHY THE v1 RULE WAS NOT ENOUGH
------------------------------
Equal division is fair but blind in both directions. A camera watching an empty
corridor got the same tile allowance as one watching a crowded gate, so the
budget was spent where it bought nothing. And nothing in the loop looked at the
GPU: two engines sharing one device could each stay inside their own latency
budget while the device sat pinned at 100% and every camera's overlay went
stale — which is the exact failure mode the tile engine was designed around.

WHAT THIS DOES INSTEAD
----------------------
Two independent controls, deliberately separated:

  * A HEADROOM factor (0..1) from device pressure — GPU utilization, VRAM,
    CPU, temperature. This is a global multiplier: when the machine is busy,
    every camera gets less, and it recovers automatically when it is not.
  * A SHARE per camera from measured ACTIVITY, so the corridor camera yields
    its allowance to the gate camera instead of holding it idle.

Both feed one `Allocation`, which is the only thing the engine reads.

DESIGN CONSTRAINTS THAT SHAPED THIS
-----------------------------------
1. Unknown is not zero. `gpu_monitor` cannot report VRAM or temperature on
   Intel/AMD machines (no vendor SDK), and it returns None there. Treating None
   as 0 would read as "no pressure"; treating it as 100 would throttle those
   machines to nothing on missing data. Both are wrong, so unknown signals are
   skipped and only the signals that exist constrain the result.
2. The GPU sampler runs on a 5-SECOND cadence (a PowerShell round trip costs
   seconds and cannot go on the per-frame path). So GPU readings are stale by
   construction and must not drive fast oscillation — hence the slew limit
   below, which is what stops the loop hunting between 0 and max tiles.
3. Allocation must degrade to v1 behaviour exactly. mode="latency" reproduces
   the old equal-division rule, and is the setting to reach for if this loop
   ever misbehaves in the field.
"""

import threading
import time
from dataclasses import dataclass, field
from typing import Dict, Optional

from app.gpu_monitor import get_gpu_stats

# Above this device utilization the governor starts withdrawing budget; at
# _HARD_LIMIT it withdraws all of it. Not 100/100 because the sample is up to
# 5s old — by the time a reading says 100% the device has been saturated for
# some time, and the point is to avoid arriving there.
_SOFT_LIMIT = 70.0
_HARD_LIMIT = 95.0

# Thermal band. Only ever applies on hardware that actually reports temperature
# (NVIDIA via nvidia-smi); elsewhere it is skipped entirely, not assumed cool.
_TEMP_SOFT_C = 75.0
_TEMP_HARD_C = 88.0

# Most the headroom factor may move per update. With a 5s-stale GPU sample, an
# unlimited step makes the loop oscillate: it reads a stale "busy", cuts to
# zero, the device idles, it reads a stale "idle", opens fully, and so on. The
# camera sees tiling switch on and off every few seconds and the detection
# count visibly pulses. 0.15 converges in about a second of frames.
_MAX_SLEW = 0.15

# Below this, allocate nothing: a fractional tile is not a thing, and letting a
# starved camera run one tile every few seconds produces stale cached boxes for
# no accuracy gain.
_MIN_USEFUL_FACTOR = 0.15


def _unit(v) -> float:
    """Coerce anything to a 0..1 activity figure. Callers feed this from live
    scene measurements, and a NaN or a stray None must not poison the EMA that
    every camera's share is computed from."""
    try:
        f = float(v)
    except (TypeError, ValueError):
        return 0.0
    if f != f:      # NaN
        return 0.0
    return max(0.0, min(1.0, f))


@dataclass
class Allocation:
    """What one camera may spend this cycle. Read by AdaptiveTileEngine."""
    budget_ms: float = 0.0        # wall-clock inference time for extra passes
    max_tiles: int = 0            # hard cap on extra tile passes
    max_zoom_depth: int = 0       # recursive zoom levels allowed
    max_imgsz: int = 640          # ceiling on per-tile inference resolution
    headroom: float = 1.0         # 0..1 device-pressure factor, for telemetry
    share: float = 1.0            # this camera's slice of the pool, for telemetry
    reason: str = ""              # human-readable "why this number"


@dataclass
class _CameraState:
    """Per-camera activity, used to weight its share of the pool."""
    last_seen: float = 0.0
    activity: float = 0.0         # EMA of 0..1 scene activity
    dropped: int = 0


class ResourceGovernor:
    """Process-wide. One instance (`governor`) shared by every camera."""

    def __init__(self):
        self._lock = threading.Lock()
        self._cameras: Dict[str, _CameraState] = {}
        self._headroom = 1.0
        self._last_probe = 0.0
        self._probe_cache: dict = {"percent": 0.0, "mem_percent": None, "temp_c": None,
                                   "cpu": None}
        self._last_reason = "init"
        self._proc = None
        # (wall_time, system_busy_seconds, own_process_cpu_seconds) — see
        # _external_cpu. Differencing these is what keeps the CPU reading
        # independent of the other psutil callers in this process.
        self._cpu_prev = None

    # -- device pressure ----------------------------------------------------

    def _probe(self) -> dict:
        """Sampled device state, refreshed no faster than the sampler updates.

        Deliberately cheap: `get_gpu_stats` is a dict read off a background
        thread's cache, and psutil's cpu_percent(None) is non-blocking. Neither
        may block the AI loop.
        """
        now = time.time()
        if now - self._last_probe < 1.0:
            return self._probe_cache
        self._last_probe = now
        stats = dict(get_gpu_stats())
        stats["cpu"] = self._external_cpu()
        self._probe_cache = stats
        return stats

    def _external_cpu(self):
        """System CPU MINUS this process's own share, or None.

        The distinction matters more than it looks. The tile engine's
        preprocessing (resize + transpose + float32, once per pass) is CPU-bound
        and scales with the number of passes, so raw system CPU is largely a
        measure of the engine's own work. Feeding that back as "pressure" is a
        loop at ANY threshold: more tiles -> more CPU -> less budget -> fewer
        tiles -> less CPU -> more budget. Two live runs showed exactly that,
        first collapsing headroom 1.0 -> 0.16 at an 80% band and then to 0.0 at
        a 92% band once the box was busy.

        What genuinely threatens the pipeline is OTHER processes taking the
        machine — that starves the capture and decode threads and drops frames,
        which no latency measurement of our own inference would reveal. Our own
        load, by contrast, already shows up honestly in per-pass latency and is
        already governed by the millisecond budget.

        Computed from RAW CPU-time counters over this governor's own sampling
        window, NOT from psutil's `cpu_percent(interval=None)`. That helper
        keeps one module-global "time of last call" and reports the average
        since whenever anybody last called it — and this application already
        calls it from two other places (every camera's telemetry loop, and
        /api/status). Interleaved callers each end up measuring a different,
        arbitrarily short window, and none of them gets the number they think
        they asked for. Differencing the counters here makes this measurement
        independent of every other caller.

        Returns None until it has two samples at least 0.2s apart; the caller
        treats None as "unknown", i.e. no constraint.
        """
        try:
            import psutil
        except Exception:
            return None
        try:
            proc = self._proc
            if proc is None:
                proc = self._proc = psutil.Process()
            cores = psutil.cpu_count() or 1
            now = time.time()
            cpu_t = psutil.cpu_times()
            busy = sum(v for k, v in cpu_t._asdict().items()
                       if k not in ("idle", "iowait"))
            p_t = proc.cpu_times()
            mine_t = p_t.user + p_t.system

            prev = self._cpu_prev
            self._cpu_prev = (now, busy, mine_t)
            if prev is None:
                return None                     # first sample establishes a baseline
            dt_wall = now - prev[0]
            if dt_wall < 0.2:                   # too short to be meaningful
                return None
            capacity = dt_wall * cores
            if capacity <= 0:
                return None
            total_pct = (busy - prev[1]) / capacity * 100.0
            mine_pct = (mine_t - prev[2]) / capacity * 100.0
            return float(max(0.0, min(100.0, total_pct - mine_pct)))
        except Exception:
            return None

    @staticmethod
    def _pressure_factor(value: Optional[float], soft: float, hard: float):
        """1.0 below `soft`, falling linearly to 0.0 at `hard`.

        Returns None for an unreadable signal so the caller can ignore it
        rather than fold a guess into the result.
        """
        if value is None:
            return None
        if value <= soft:
            return 1.0
        if value >= hard:
            return 0.0
        return 1.0 - (value - soft) / (hard - soft)

    def _update_headroom(self) -> float:
        s = self._probe()
        factors = []
        reasons = []
        for label, val, soft, hard in (
            ("gpu", s.get("percent"), _SOFT_LIMIT, _HARD_LIMIT),
            ("vram", s.get("mem_percent"), 80.0, 97.0),
            # EXTERNAL cpu only (see _external_cpu) — this process's own share
            # is subtracted, because the engine is most of the CPU load it would
            # otherwise be reading and feeding that back is a starvation loop.
            # The band stays high even so: this is a guard against another
            # process taking the machine out from under the capture threads,
            # not a throughput control.
            ("cpu", s.get("cpu"), 85.0, 98.0),
            ("temp", s.get("temp_c"), _TEMP_SOFT_C, _TEMP_HARD_C),
        ):
            f = self._pressure_factor(val, soft, hard)
            if f is None:
                continue          # unreadable on this hardware — not a constraint
            factors.append(f)
            if f < 1.0:
                reasons.append(f"{label}={val:.0f}")

        # The tightest constraint wins: headroom is limited by whichever
        # resource runs out first, never by their average (an average lets a
        # cool, idle CPU mask a saturated GPU).
        target = min(factors) if factors else 1.0
        delta = target - self._headroom
        if delta > _MAX_SLEW:
            target = self._headroom + _MAX_SLEW
        elif delta < -_MAX_SLEW:
            target = self._headroom - _MAX_SLEW
        self._headroom = max(0.0, min(1.0, target))
        self._last_reason = ", ".join(reasons) if reasons else "idle"
        return self._headroom

    # -- camera bookkeeping -------------------------------------------------

    def touch(self, camera_id: str, activity: float) -> None:
        """Report this camera's current scene activity (0..1).

        Activity is what decides how the pool is split, so it must reflect
        "does this camera have anything worth spending inference on" — motion
        and object count — not merely "is it running".
        """
        now = time.time()
        with self._lock:
            st = self._cameras.get(camera_id)
            if st is None:
                st = _CameraState(last_seen=now, activity=_unit(activity))
                self._cameras[camera_id] = st
            else:
                st.last_seen = now
                st.activity = 0.7 * st.activity + 0.3 * _unit(activity)

    def release(self, camera_id: str) -> None:
        with self._lock:
            self._cameras.pop(camera_id, None)

    def _active(self, now: float) -> Dict[str, _CameraState]:
        # A camera that has not reported in 5s is stopped or wedged; its share
        # must go back to the cameras that are running rather than stay
        # reserved for one that will never spend it.
        return {cid: st for cid, st in self._cameras.items() if now - st.last_seen <= 5.0}

    # -- allocation ---------------------------------------------------------

    def allocate(self, camera_id: str, *, activity: float, settings) -> Allocation:
        """This camera's slice for the current cycle."""
        self.touch(camera_id, activity)
        now = time.time()

        mode = getattr(settings, "governor_mode", "auto")
        if mode == "off":
            return Allocation(budget_ms=0.0, max_tiles=0, max_zoom_depth=0,
                              max_imgsz=640, headroom=0.0, share=0.0, reason="governor off")

        with self._lock:
            active = self._active(now)
            n = max(1, len(active))
            me = active.get(camera_id)
            total_activity = sum(st.activity for st in active.values())
            my_activity = me.activity if me else activity

        if mode == "latency":
            # v1 behaviour, kept intact and reachable: equal division, no device
            # feedback. The fallback if the closed loop ever misbehaves live.
            share = 1.0 / n
            headroom = 1.0
            reason = f"latency mode, {n} camera(s)"
        else:
            headroom = self._update_headroom()
            if total_activity <= 1e-6:
                share = 1.0 / n
            else:
                # Blend equal-split with activity-weighting rather than going
                # purely proportional: a fully idle camera still needs enough
                # allowance to NOTICE that something appeared, otherwise it can
                # never raise its own activity and would stay starved forever.
                fair = 1.0 / n
                weighted = my_activity / total_activity
                share = 0.35 * fair + 0.65 * weighted
            reason = f"{self._last_reason}, {n} camera(s), share {share:.2f}"

        # `latency_budget_ms` is the POOL, not a per-camera figure: shares sum
        # to 1 across active cameras, so one camera on an idle machine gets the
        # whole configured budget and eight cameras get an eighth each — which
        # is v1's equal division exactly, now weighted by activity and scaled by
        # device headroom.
        factor = max(0.0, min(1.0, headroom * share))
        if factor < _MIN_USEFUL_FACTOR:
            return Allocation(budget_ms=0.0, max_tiles=0, max_zoom_depth=0,
                              max_imgsz=int(getattr(settings, "max_imgsz_cap", 640)),
                              headroom=headroom, share=share,
                              reason=f"throttled ({reason})")

        budget_ms = float(settings.latency_budget_ms) * factor
        max_tiles = max(0, int(round(settings.max_tiles * factor)))
        depth = int(getattr(settings, "zoom_max_depth", 0))
        # Recursive zoom is the most expensive thing the engine can do, so it is
        # the first capability withdrawn under pressure and the last restored.
        max_zoom_depth = depth if factor >= 0.6 else (1 if factor >= 0.35 else 0)

        cap = int(getattr(settings, "max_imgsz_cap", 640))
        if factor < 0.5:
            cap = min(cap, 640)
        return Allocation(budget_ms=budget_ms, max_tiles=max_tiles,
                          max_zoom_depth=max_zoom_depth, max_imgsz=cap,
                          headroom=headroom, share=share, reason=reason)

    def snapshot(self) -> dict:
        """Diagnostics for the admin endpoint."""
        now = time.time()
        with self._lock:
            active = self._active(now)
            cams = {cid: round(st.activity, 3) for cid, st in active.items()}
        return {
            "headroom": round(self._headroom, 3),
            "reason": self._last_reason,
            "active_cameras": len(cams),
            "activity": cams,
            "device": self._probe_cache,
        }


governor = ResourceGovernor()
