"""Invisible AI Zoom Engine — adaptive tile inference.

Small/distant objects are lost at a single 640x640 letterbox of a 1920x1080
frame: a 24px-tall person survives as ~8px after downscale, below what the
detector can score. The fix is to also run inference on crops of the frame, so
that person is 3x larger in the tensor. Nothing about the *displayed* video
changes — this module never touches the MJPEG path (Module 2 of the pipeline
encodes the preview straight off the decoded frame and never sees this code).
Tiles exist only as numpy views handed to the model; every detection is mapped
back to full-frame pixel coordinates before it leaves `AdaptiveTileEngine.infer`,
so downstream (tracking, analytics, overlay emission) cannot tell the difference.

WHY THIS IS SHAPED THE WAY IT IS
--------------------------------
An earlier version of the pipeline ran 5 unconditional passes (full frame + 4
quadrants) on every frame >=1280x720. On a backend shared by every camera that
5x per-cycle cost multiplied lock/queue contention and was the direct cause of
multi-second-to-multi-minute stale overlays. It was deleted. The difference here
is that tile passes are *budgeted, scheduled, and additive*:

  1. The full-frame pass ALWAYS runs, exactly as before. Tiles only ever add
     detections on top of it, so recall is never worse than the single-pass
     baseline and a large object spanning several tiles is still seen whole.
  2. The number of extra tile passes per cycle is derived from measured
     per-pass inference latency against a wall-clock budget, and that budget is
     divided by the number of cameras currently using the engine. Under load
     the answer is zero extra passes — i.e. it degrades to precisely the old
     single-pass behaviour rather than to a stall.
  3. Tiles whose pixels have not changed are not re-inferred; their previous
     detections are reused (bounded by a short TTL). A static scene therefore
     costs nothing beyond the baseline pass.

Strict image integrity: this module crops, scales for the detector's own input,
and maps coordinates. It never writes pixels back, never synthesises detail, and
never invents detections — every box it emits came out of the model.
"""

import math
import threading
import time
import weakref
from collections import deque
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field, replace
from typing import Dict, List, Optional, Sequence, Tuple

import cv2
import numpy as np

from app.analytics import VEHICLE_CLASSES
from app.ai.tile_governor import governor
from app.ai.tile_temporal import TemporalFusion
from app.config import (
    TILING_CACHE_TTL_S,
    TILING_DISCOVERY_INTERVAL_S,
    TILING_ENABLED,
    TILING_FUSION_CONTAINMENT,
    TILING_FUSION_IOU,
    TILING_LATENCY_BUDGET_MS,
    TILING_MAX_GRID,
    TILING_MAX_TILES,
    TILING_MOTION_THRESHOLD,
    TILING_OVERLAP,
    TILING_ROI_BOOST,
    TILING_ROI_BOOST_MAX,
    TILING_SECOND_PASS_CONF,
    TILING_SMALL_OBJECT_FRAC,
    TILING_WORKERS,
    TILING_GOVERNOR_MODE,
    TILING_MULTI_RESOLUTION,
)

# Inference input sizes the engine may request.
#
# The v1 ladder was restricted to the pipeline's own (320/640/960/1280) because
# each NEW input shape costs a one-time OpenVINO kernel compile. That cost was
# then measured on this hardware, and it is severe: 6.4s, 7.7s and 8.6s for a
# cold 768, 896 and 1024 respectively — a stall the pipeline watchdog would read
# as a wedged AI thread.
#
# What makes the finer ladder usable anyway is that the engine already
# configures an on-disk OpenVINO compile cache: re-measured on a second process
# start the same shapes cost 330ms, 540ms and 550ms. So the cost is once per
# machine, not once per run — and `prewarm_shapes()` pays it on a background
# thread at startup instead of inside a camera's AI loop.
#
# Steady-state cost per pass still climbs steeply with size (measured, warm:
# 640=89ms, 768=174ms, 896=228ms, 1024=332ms, 1280=478ms), which is why
# resolution is governed rather than simply maximised.
_SHAPE_LADDER_FINE = (320, 640, 768, 896, 1024, 1280)
_SHAPE_LADDER_COARSE = (320, 640, 960, 1280)

#: Measured relative cost of one pass at each size, normalised to 640. Used to
#: predict what a tile will cost BEFORE running it, so the governor's budget is
#: spent deliberately rather than discovered by overshooting it.
_SHAPE_COST = {320: 0.35, 640: 1.0, 768: 1.95, 896: 2.55, 960: 2.8,
               1024: 3.7, 1280: 5.35}


def shape_ladder(settings) -> tuple:
    return _SHAPE_LADDER_FINE if getattr(settings, "multi_resolution", True) else _SHAPE_LADDER_COARSE


_prewarm_lock = threading.Lock()
_prewarmed: set = set()


def prewarm_shapes(backend, sizes=None) -> None:
    """Compile kernels for every ladder size on a background thread.

    Without this the first tile that picks an uncompiled size pays multiple
    seconds INSIDE the AI loop, which the watchdog cannot distinguish from a
    hung stage. Runs once per (backend, size) per process; the OpenVINO disk
    cache makes it near-free on every later start.
    """
    sizes = sizes or _SHAPE_LADDER_FINE

    def _work():
        import numpy as _np
        for sz in sizes:
            key = (id(backend), sz)
            with _prewarm_lock:
                if key in _prewarmed:
                    continue
                _prewarmed.add(key)
            try:
                dummy = _np.zeros((sz, sz, 3), dtype=_np.uint8)
                tensor, _ = backend.preprocess(dummy, sz)
                backend.run_inference(tensor)
            except Exception as e:
                print(f"[Zoom] Prewarm imgsz={sz} failed (will compile on demand): {e}",
                      flush=True)
        try:
            backend.release_thread_request()
        except Exception:
            pass

    threading.Thread(target=_work, name="ZoomPrewarm", daemon=True).start()

# Width of the greyscale change map used for per-tile motion. Higher than the
# pipeline's own 160x120 whole-frame motion check on purpose: the objects tiling
# exists to find are a handful of pixels tall, and at 160x120 their movement is
# sub-pixel — they would be classified "unchanged" forever and served from cache.
_CHANGE_MAP_W = 480

# A detection whose box comes this close (px) to a tile edge that is not also a
# frame edge is assumed to be cut off by the crop rather than genuinely ending
# there. See _fuse for how truncated boxes are recombined.
_EDGE_SLACK_PX = 2

# What the rest of the AI/tracking/telemetry path costs per cycle, outside the
# inference passes this module schedules. Subtracted from the caller's frame
# period before any tile budget is derived (see AdaptiveTileEngine.infer), so
# the tile stage cannot spend slack that the stages after it still need.
# Measured on the reference machine (i7-8665U/UHD 620): preprocess 3.1ms +
# postprocess 2.1ms + tracking 1.9ms, rounded up to leave room for analytics
# and telemetry build on a busy frame.
_NON_INFER_STAGE_MS = 12.0

# Grid is chosen so a full sweep of every tile completes within this many
# cycles at the current budget. Prevents e.g. a 5x5 grid being selected when
# the budget only affords one tile per cycle (25 cycles ≈ 2s to cover a frame,
# during which most tiles would be serving stale cache).
_COVERAGE_CYCLES = 4


# ---------------------------------------------------------------------------
# Admin settings
# ---------------------------------------------------------------------------
# Process-wide rather than per-camera, matching how `ai.confidence` and the
# model selection already work: the desktop syncs one org-level value and there
# is no per-camera concept of any of this in the schema. Every knob is clamped
# on the way in so an admin cannot type a value that wedges the pipeline.


@dataclass(frozen=True)
class TilingSettings:
    enabled: bool = TILING_ENABLED
    max_grid: int = TILING_MAX_GRID
    overlap: float = TILING_OVERLAP
    max_tiles: int = TILING_MAX_TILES
    latency_budget_ms: float = TILING_LATENCY_BUDGET_MS
    workers: int = TILING_WORKERS
    motion_threshold: float = TILING_MOTION_THRESHOLD
    cache_ttl_s: float = TILING_CACHE_TTL_S
    small_object_frac: float = TILING_SMALL_OBJECT_FRAC
    fusion_iou: float = TILING_FUSION_IOU
    fusion_containment: float = TILING_FUSION_CONTAINMENT
    roi_boost: bool = TILING_ROI_BOOST
    roi_boost_max: int = TILING_ROI_BOOST_MAX
    second_pass_conf: float = TILING_SECOND_PASS_CONF
    discovery_interval_s: float = TILING_DISCOVERY_INTERVAL_S

    # ---- v2 -------------------------------------------------------------
    # Every v2 capability has its own independent on/off, per Feature 15: an
    # operator debugging a site must be able to isolate one stage without
    # losing the rest, and each of these can be the thing that misbehaves on
    # unfamiliar hardware. Defaults keep v1 behaviour recognisable.

    # Feature 1 — adaptive tile generator
    adaptive_layout: bool = True     # dynamic grid AND overlap AND resolution
    min_grid: int = 1
    # Feature 11/12 — governor. "auto" = closed loop on device pressure and
    # per-camera activity; "latency" = v1's equal division; "off" = no tiles.
    governor_mode: str = TILING_GOVERNOR_MODE
    gpu_utilization_limit: float = 85.0
    max_latency_ms: float = 250.0    # per-cycle ceiling the governor defends
    # Feature 2 — recursive AI zoom
    zoom_enabled: bool = True
    zoom_max_depth: int = 2          # original -> 2x -> 4x
    zoom_min_object_px: int = 12     # below this a crop has nothing left to resolve
    zoom_conf_stable_delta: float = 0.05
    # Feature 8 — multi-resolution inference
    multi_resolution: bool = TILING_MULTI_RESOLUTION
    max_imgsz_cap: int = 1024
    # Compile every ladder shape on a background thread at camera start. On a
    # machine whose OpenVINO cache directory is not writable the compile cost is
    # paid EVERY run rather than once, and an operator there may prefer to eat a
    # one-off stall on the first tile that needs a shape instead of ~23s of GPU
    # work at every startup.
    prewarm: bool = True
    # Feature 6 — smart tile priority
    priority_enabled: bool = True
    priority_zone_weight: float = 2.0
    priority_alert_weight: float = 1.5
    priority_motion_weight: float = 3.0
    priority_object_weight: float = 1.0
    # Feature 7 — auto ROI expansion.
    #
    # OFF by default because it was measured to make accuracy slightly WORSE:
    # 5.00 -> 4.92 detections/frame on real video, and combining it with
    # recursive zoom dropped 5.48 -> 4.96. The reason is that it competes for
    # the same budget as the tile stage (tiles/frame fell 2.00 -> 1.64) while
    # duplicating work fusion already does — `fuse_detections` reassembles a
    # seam-cut object from its fragments geometrically, so paying an extra
    # inference pass to look at it again buys redundancy at the cost of
    # coverage. Kept, switchable, and worth revisiting on hardware where a pass
    # is cheap enough that it is not competing with tile coverage.
    edge_expansion: bool = False
    edge_expansion_max: int = 2
    # Feature 3 — cache
    lighting_guard: bool = True
    lighting_delta: float = 6.0      # mean-luma shift that invalidates a tile
    # Feature 4 — temporal fusion
    temporal_enabled: bool = True
    temporal_history_s: float = 0.5
    temporal_max_carry: int = 2
    temporal_smoothing: float = 0.5
    temporal_iou: float = 0.3
    # Feature 9 — confidence verification
    verify_enabled: bool = True
    verify_accept_conf: float = 0.95
    verify_second_pass_conf: float = 0.80
    verify_history_conf: float = 0.60
    verify_min_hits: int = 2
    # Feature 10 — false-positive filter
    fp_motion_validation: bool = True
    fp_neighbour_agreement: bool = True


def _clamp(v, lo, hi):
    return max(lo, min(hi, v))


def _sanitize(s: TilingSettings) -> TilingSettings:
    """Clamp every field to a range the pipeline can actually survive.

    Bounds, not validation errors: an operator who drags a slider to an extreme
    gets the extreme's edge, never a camera that stops producing overlays.
    """
    return TilingSettings(
        enabled=bool(s.enabled),
        max_grid=int(_clamp(int(s.max_grid), 1, 5)),
        # Below 0.15 an object straddling a tile seam is cut in both tiles with
        # no tile seeing it whole; above 0.25 the redundant area costs more
        # inference than the extra recall is worth.
        overlap=float(_clamp(float(s.overlap), 0.15, 0.25)),
        max_tiles=int(_clamp(int(s.max_tiles), 0, 24)),
        latency_budget_ms=float(_clamp(float(s.latency_budget_ms), 0.0, 400.0)),
        # Shared across all cameras (see _executor), so this is a total thread
        # count, not a per-camera one.
        workers=int(_clamp(int(s.workers), 1, 8)),
        motion_threshold=float(_clamp(float(s.motion_threshold), 0.0, 0.20)),
        cache_ttl_s=float(_clamp(float(s.cache_ttl_s), 0.0, 5.0)),
        small_object_frac=float(_clamp(float(s.small_object_frac), 0.0005, 0.25)),
        fusion_iou=float(_clamp(float(s.fusion_iou), 0.10, 0.95)),
        fusion_containment=float(_clamp(float(s.fusion_containment), 0.30, 0.99)),
        roi_boost=bool(s.roi_boost),
        roi_boost_max=int(_clamp(int(s.roi_boost_max), 0, 8)),
        second_pass_conf=float(_clamp(float(s.second_pass_conf), 0.0, 0.95)),
        discovery_interval_s=float(_clamp(float(s.discovery_interval_s), 0.0, 60.0)),

        adaptive_layout=bool(s.adaptive_layout),
        min_grid=int(_clamp(int(s.min_grid), 1, 5)),
        # Unknown mode names fall back to the SAFE one (v1 equal division)
        # rather than to the clever one — a typo in an admin payload must not
        # silently hand the fleet to an untested code path.
        governor_mode=(s.governor_mode if s.governor_mode in ("auto", "latency", "off")
                       else "latency"),
        gpu_utilization_limit=float(_clamp(float(s.gpu_utilization_limit), 10.0, 100.0)),
        max_latency_ms=float(_clamp(float(s.max_latency_ms), 50.0, 2000.0)),
        zoom_enabled=bool(s.zoom_enabled),
        zoom_max_depth=int(_clamp(int(s.zoom_max_depth), 0, 3)),
        zoom_min_object_px=int(_clamp(int(s.zoom_min_object_px), 4, 200)),
        zoom_conf_stable_delta=float(_clamp(float(s.zoom_conf_stable_delta), 0.0, 0.5)),
        multi_resolution=bool(s.multi_resolution),
        max_imgsz_cap=int(_clamp(int(s.max_imgsz_cap), 320, 1280)),
        prewarm=bool(s.prewarm),
        priority_enabled=bool(s.priority_enabled),
        priority_zone_weight=float(_clamp(float(s.priority_zone_weight), 0.0, 10.0)),
        priority_alert_weight=float(_clamp(float(s.priority_alert_weight), 0.0, 10.0)),
        priority_motion_weight=float(_clamp(float(s.priority_motion_weight), 0.0, 10.0)),
        priority_object_weight=float(_clamp(float(s.priority_object_weight), 0.0, 10.0)),
        edge_expansion=bool(s.edge_expansion),
        edge_expansion_max=int(_clamp(int(s.edge_expansion_max), 0, 8)),
        lighting_guard=bool(s.lighting_guard),
        lighting_delta=float(_clamp(float(s.lighting_delta), 0.5, 60.0)),
        temporal_enabled=bool(s.temporal_enabled),
        temporal_history_s=float(_clamp(float(s.temporal_history_s), 0.0, 5.0)),
        temporal_max_carry=int(_clamp(int(s.temporal_max_carry), 0, 10)),
        temporal_smoothing=float(_clamp(float(s.temporal_smoothing), 0.0, 0.9)),
        temporal_iou=float(_clamp(float(s.temporal_iou), 0.05, 0.9)),
        verify_enabled=bool(s.verify_enabled),
        verify_accept_conf=float(_clamp(float(s.verify_accept_conf), 0.5, 1.0)),
        verify_second_pass_conf=float(_clamp(float(s.verify_second_pass_conf), 0.3, 0.99)),
        verify_history_conf=float(_clamp(float(s.verify_history_conf), 0.05, 0.95)),
        verify_min_hits=int(_clamp(int(s.verify_min_hits), 1, 10)),
        fp_motion_validation=bool(s.fp_motion_validation),
        fp_neighbour_agreement=bool(s.fp_neighbour_agreement),
    )


_settings_lock = threading.Lock()
_settings = _sanitize(TilingSettings())


def get_tiling_settings() -> TilingSettings:
    with _settings_lock:
        return _settings


def set_tiling_settings(**kwargs) -> TilingSettings:
    """Patch settings live. Returns the APPLIED (clamped) settings so a caller
    reporting back to an admin shows the values the engine is really using
    rather than the ones that were asked for. Every camera picks the new values
    up on its next AI cycle — no restart, no re-registration."""
    global _settings
    known = TilingSettings.__dataclass_fields__.keys()
    patch = {k: v for k, v in kwargs.items() if k in known and v is not None}
    with _settings_lock:
        _settings = _sanitize(replace(_settings, **patch))
        applied = _settings
    _executor_resize(applied.workers)
    return applied


# ---------------------------------------------------------------------------
# Shared worker pool
# ---------------------------------------------------------------------------
# ONE pool for the whole process, not one per camera. The OpenVINO backend
# caches an InferRequest (and its device buffers) per calling thread, so a
# per-camera pool would multiply device memory by the camera count. A shared,
# long-lived pool bounds total extra InferRequests to `workers` no matter how
# many cameras run, and never churns threads so nothing is ever leaked.

_executor_lock = threading.Lock()
_executor: Optional[ThreadPoolExecutor] = None
_executor_size = 0


def _get_executor(workers: int) -> ThreadPoolExecutor:
    global _executor, _executor_size
    with _executor_lock:
        if _executor is None or _executor_size != workers:
            old = _executor
            _executor = ThreadPoolExecutor(
                max_workers=workers, thread_name_prefix="TileWorker"
            )
            _executor_size = workers
            if old is not None:
                # Non-blocking: in-flight tile passes finish on the old pool and
                # its threads exit. Their cached InferRequests are dropped by
                # EngineBackend when the thread dies.
                old.shutdown(wait=False)
        return _executor


def _executor_resize(workers: int) -> None:
    with _executor_lock:
        needs = _executor is not None and _executor_size != workers
    if needs:
        _get_executor(workers)


def shutdown_workers() -> None:
    """Tear the shared pool down (engine shutdown / tests)."""
    global _executor, _executor_size
    with _executor_lock:
        pool, _executor, _executor_size = _executor, None, 0
    if pool is not None:
        pool.shutdown(wait=False)


# ---------------------------------------------------------------------------
# Budget governor
# ---------------------------------------------------------------------------
# The inference backend is shared by every camera. A budget each camera enforces
# only against itself is not a budget: eight cameras each "staying under 60ms"
# queue 8x the work onto one device. Every engine instance registers here and
# the wall-clock budget is divided between them, so adding cameras narrows each
# camera's tile allowance until it reaches zero — i.e. plain single-pass
# inference, the behaviour that was already proven stable.

_governor_lock = threading.Lock()
# WeakSet, not a set of ids: an engine whose camera was torn down without a
# clean stop() (a crashed thread, a coordinator dropped on the floor during a
# restart) must stop counting against the budget when it is collected. Holding
# strong keys would let one such camera permanently reserve a share of the
# inference budget that nothing will ever spend, silently throttling every
# camera that IS running — and the symptom (tiling quietly stops engaging) is
# almost impossible to trace back to its cause.
_active_engines: "weakref.WeakSet" = weakref.WeakSet()


def _register(engine) -> None:
    with _governor_lock:
        _active_engines.add(engine)


def _unregister(engine) -> None:
    with _governor_lock:
        _active_engines.discard(engine)


def _active_count() -> int:
    with _governor_lock:
        return max(1, len(_active_engines))


# ---------------------------------------------------------------------------
# Tile geometry
# ---------------------------------------------------------------------------


def plan_tiles(width: int, height: int, grid: int, overlap: float) -> List[Tuple[int, int, int, int]]:
    """Rects for a `grid` x `grid` cover of the frame with fractional `overlap`
    between neighbours. Returns [] for grid<=1 (the caller's full-frame pass
    already covers that case).

    Sizing: n tiles across a span W overlapping by fraction f satisfies
    tile = W / (n - (n-1)f) with step = tile*(1-f), which lands the last tile
    exactly on the far edge — no gap and no ragged final tile. Rects are
    half-open ([x1,x2)) and clipped to the frame, so they index numpy directly.
    """
    if grid <= 1 or width <= 0 or height <= 0:
        return []
    f = _clamp(float(overlap), 0.0, 0.5)
    denom = grid - (grid - 1) * f

    def spans(total: int) -> List[Tuple[int, int]]:
        size = total / denom
        step = size * (1.0 - f)
        out = []
        for i in range(grid):
            a = int(round(i * step))
            b = int(round(i * step + size))
            a = _clamp(a, 0, total)
            b = _clamp(b, 0, total)
            if i == grid - 1:
                b = total  # absorb rounding drift into the final tile
            if b - a >= 8:
                out.append((a, b))
        return out

    xs = spans(width)
    ys = spans(height)
    return [(x1, y1, x2, y2) for (y1, y2) in ys for (x1, x2) in xs]


def _pick_imgsz(long_side: int, cap: int, floor_: int, ladder=None) -> int:
    """Smallest ladder size that does not downscale the crop, capped.

    A 440px tile gains nothing from a 960 tensor (the model would be upscaling
    real but already-exhausted detail) and a 1400px tile cannot be represented
    above the cap, so it letterboxes as usual.

    `ladder` selects the resolution set — the fine 640/768/896/1024/1280 ladder
    when multi-resolution is on, the coarse legacy one when it is off.
    """
    ladder = ladder or _SHAPE_LADDER_COARSE
    chosen = ladder[-1]
    for v in ladder:
        if v >= long_side:
            chosen = v
            break
    return int(_clamp(chosen, floor_, max(floor_, cap)))


# ---------------------------------------------------------------------------
# Result fusion
# ---------------------------------------------------------------------------


def _xyxy(det) -> Tuple[float, float, float, float]:
    b = det["bbox"]
    return float(b["x1"]), float(b["y1"]), float(b["x2"]), float(b["y2"])


def _overlap_metrics(a, b) -> Tuple[float, float]:
    """(IoU, containment) for two xyxy boxes.

    Containment — intersection over the *smaller* area — is what makes a box
    truncated at a tile seam merge with the whole-object box from the
    neighbouring tile: half a car against the whole car scores IoU ~0.5 (below
    any sane NMS threshold, so it would survive as a phantom second object) but
    containment ~1.0.
    """
    ix1, iy1 = max(a[0], b[0]), max(a[1], b[1])
    ix2, iy2 = min(a[2], b[2]), min(a[3], b[3])
    iw, ih = max(0.0, ix2 - ix1), max(0.0, iy2 - iy1)
    inter = iw * ih
    if inter <= 0:
        return 0.0, 0.0
    area_a = max(1.0, (a[2] - a[0]) * (a[3] - a[1]))
    area_b = max(1.0, (b[2] - b[0]) * (b[3] - b[1]))
    return inter / (area_a + area_b - inter), inter / min(area_a, area_b)


def _seam_compatible(a, b) -> bool:
    """True if two TRUNCATED boxes look like the two halves of one object cut
    by a tile seam.

    Containment alone cannot catch this case. Two adjacent tiles share only the
    overlap band, so an object appreciably wider than that band appears in each
    tile as a fragment whose intersection with the other fragment is thin — a
    fragment pair scores low on both IoU and containment while unmistakably
    belonging to the same object. The signature of a seam cut is: the fragments
    abut along one axis (they meet, thinly) while covering each other almost
    entirely along the perpendicular one (same height, side by side).

    Deliberately narrow, and it only ever applies when BOTH views were cut off:
    two people queueing across a seam can in principle match this shape too, and
    merging them would undercount. That risk is bounded because the full-frame
    pass — which always runs — sees any object big enough to reach this path
    whole, so this is a fallback, not the primary way large objects are handled.
    """
    ix1, iy1 = max(a[0], b[0]), max(a[1], b[1])
    ix2, iy2 = min(a[2], b[2]), min(a[3], b[3])
    iw, ih = ix2 - ix1, iy2 - iy1
    if iw <= 0 or ih <= 0:
        return False
    min_w = max(1.0, min(a[2] - a[0], b[2] - b[0]))
    min_h = max(1.0, min(a[3] - a[1], b[3] - b[1]))
    rx, ry = iw / min_w, ih / min_h
    # One axis nearly fully shared (aligned), the other only grazing (abutting).
    return (ry >= 0.6 and rx <= 0.5) or (rx >= 0.6 and ry <= 0.5)


def _class_compatible(a: str, b: str) -> bool:
    """Same class, or two vehicle-family classes.

    The detector flips a vehicle between car/truck/bus across passes at
    different scales (the same flip the tracker already tolerates frame to
    frame). Without this, one van seen at two scales fuses into two boxes — the
    exact duplicate-overlay failure this pipeline has hit twice before.
    """
    return a == b or (a in VEHICLE_CLASSES and b in VEHICLE_CLASSES)


def fuse_detections(items: Sequence[dict], iou_thr: float, containment_thr: float):
    """Weighted box fusion over detections gathered from every pass.

    Each item is {"det": <pipeline detection dict>, "mask": <polygon>,
    "truncated": bool}. Returns (detections, masks) index-locked, in the exact
    shape the rest of the pipeline expects — this function is the ONLY place
    tile results become the emitted detection list, which keeps the "one object,
    one payload entry" invariant in one auditable spot.
    """
    if not items:
        return [], []

    boxes = [_xyxy(items[i]["det"]) for i in range(len(items))]

    def _area(i):
        b = boxes[i]
        return max(0.0, b[2] - b[0]) * max(0.0, b[3] - b[1])

    # Seed order: complete views first, then confidence, then size. Clusters are
    # grown greedily from their seed, so the seed decides what gets absorbed —
    # and a COMPLETE view of an object contains every fragment of it, whereas a
    # fragment contains only itself. Seeding on confidence alone let a tile
    # fragment win the tie against the whole-object box, after which fragments
    # at the object's far end matched nothing and survived as phantom extra
    # objects (a bus wearing four boxes).
    order = sorted(
        range(len(items)),
        key=lambda i: (items[i]["truncated"], -float(items[i]["det"]["confidence"]), -_area(i)),
    )
    used = [False] * len(items)
    dets_out, masks_out = [], []

    for oi in order:
        if used[oi]:
            continue
        used[oi] = True
        cluster = [oi]
        cls_a = items[oi]["det"]["class"]
        # Grow transitively: a fragment that matches an already-absorbed
        # fragment belongs to the same object even if it never touches the seed
        # (three tiles across one long vehicle).
        frontier = [oi]
        while frontier:
            oc = frontier.pop()
            for oj in order:
                if used[oj]:
                    continue
                if not _class_compatible(cls_a, items[oj]["det"]["class"]):
                    continue
                iou, cont = _overlap_metrics(boxes[oc], boxes[oj])
                seam = (
                    items[oc]["truncated"] and items[oj]["truncated"]
                    and _seam_compatible(boxes[oc], boxes[oj])
                )
                if iou >= iou_thr or cont >= containment_thr or seam:
                    used[oj] = True
                    cluster.append(oj)
                    frontier.append(oj)

        whole = [k for k in cluster if not items[k]["truncated"]]
        if whole:
            # Average only the boxes that saw the object entirely. Averaging a
            # truncated box in would drag the merged box's edge inward, cropping
            # the overlay off a real object.
            ws = np.array([float(items[k]["det"]["confidence"]) ** 2 for k in whole], dtype=np.float64)
            if ws.sum() <= 0:
                ws = np.ones_like(ws)
            arr = np.array([boxes[k] for k in whole], dtype=np.float64)
            x1, y1, x2, y2 = (arr * ws[:, None]).sum(axis=0) / ws.sum()
        else:
            # Every view was cut off: the object straddles seams and no single
            # tile holds it. Their union reconstructs its extent — this is
            # geometry over boxes the model produced, not invented pixels.
            arr = np.array([boxes[k] for k in cluster], dtype=np.float64)
            x1, y1 = arr[:, 0].min(), arr[:, 1].min()
            x2, y2 = arr[:, 2].max(), arr[:, 3].max()

        # Class by confidence-weighted vote across the cluster, so a single
        # low-scoring mislabel cannot rename an object several passes agree on.
        votes: Dict[str, float] = {}
        for k in cluster:
            d = items[k]["det"]
            votes[d["class"]] = votes.get(d["class"], 0.0) + float(d["confidence"])
        best_cls = max(votes, key=votes.get)

        rep = max(cluster, key=lambda k: float(items[k]["det"]["confidence"]))
        det = dict(items[rep]["det"])
        det["class"] = best_cls
        # Max, never a sum: agreement between passes is evidence, but inflating
        # confidence past what the model reported would be fabricating a score.
        det["confidence"] = float(max(items[k]["det"]["confidence"] for k in cluster))
        det["bbox"] = {"x1": int(round(x1)), "y1": int(round(y1)),
                       "x2": int(round(x2)), "y2": int(round(y2))}
        if det["bbox"]["x2"] <= det["bbox"]["x1"] or det["bbox"]["y2"] <= det["bbox"]["y1"]:
            continue

        mask = []
        for k in sorted(cluster, key=lambda k: -float(items[k]["det"]["confidence"])):
            if items[k]["mask"]:
                mask = items[k]["mask"]
                break
        # How many independent passes saw this object. Overlapping tiles mean a
        # real object in an overlap band is found more than once, so this is the
        # neighbour-agreement signal the false-positive filter needs — and it
        # falls straight out of the clustering, where a separate O(n^2) pairwise
        # scan afterwards would recompute what fusion already knew.
        det["_passes"] = len(cluster)
        dets_out.append(det)
        masks_out.append(mask)

    return dets_out, masks_out


# ---------------------------------------------------------------------------
# Engine
# ---------------------------------------------------------------------------


@dataclass
class TileResult:
    detections: List[dict] = field(default_factory=list)
    masks: List[list] = field(default_factory=list)
    t_pre: float = 0.0
    t_inf: float = 0.0          # total across every pass this cycle
    t_inf_base: float = 0.0     # full-frame pass only — drives adaptive imgsz
    t_post: float = 0.0
    stats: dict = field(default_factory=dict)


class AdaptiveTileEngine:
    """Per-camera adaptive tile inference. One instance per PipelineCoordinator,
    driven from its AI thread; the shared worker pool and the budget governor
    are process-wide."""

    def __init__(self, camera_id: str):
        self.camera_id = camera_id
        self._registered = False

        self._prev_small: Optional[np.ndarray] = None
        # tile rect -> {"ts", "items"} of previously-mapped results, reused while
        # the tile's pixels are unchanged.
        self._cache: Dict[Tuple[int, int, int, int], dict] = {}
        self._last_seen: Dict[Tuple[int, int, int, int], float] = {}

        # Rolling per-pass inference cost, in ms — this is what turns a
        # wall-clock budget into a tile count.
        #
        # TWO estimators, deliberately. `_tile_ms_ema` is the truth (what a tile
        # actually cost) but it can only be measured by running a tile, and
        # `_base_ms_ema` — the full-frame pass, re-measured every single cycle —
        # is the fallback that keeps the budget honest when no tile has run
        # recently. A single estimator seeded once from the first pass deadlocks:
        # the first inference of a session pays OpenVINO's one-time kernel
        # compile (measured at 123ms against a warm 82ms), that number becomes
        # the estimate, the estimate makes the budget zero, zero tiles run, and
        # nothing ever updates the estimate again. Tiling then reports itself
        # enabled while permanently doing nothing.
        self._tile_ms_ema: Optional[float] = None
        self._tile_ms_ts = 0.0
        self._base_ms_ema: Optional[float] = None
        self._grid = 1
        self._median_area_frac: Optional[float] = None
        self._last_discovery = 0.0
        self._cycles = 0

        # ---- v2 state ------------------------------------------------------
        # Temporal fusion / verification / FP filtering across frames.
        self._temporal = TemporalFusion()
        # Mean luma of the previous frame. A global lighting change (cloud, IR
        # cut-over, a light switched on) shifts every pixel at once; without
        # this the per-tile diff reads it as motion everywhere and the engine
        # re-infers every tile for a scene whose CONTENT did not change.
        self._prev_luma: Optional[float] = None
        # Rolling scene activity (0..1) reported to the resource manager — this
        # is what makes a busy camera outbid an idle one.
        self._activity = 0.0
        self._last_alloc = None
        # Operator-defined priority regions in normalised coords, pushed down
        # from the pipeline (zones, lines, ROIs) plus recent alert locations.
        self._priority_regions: List[dict] = []
        self._recent_alerts: deque = deque(maxlen=16)
        self._prewarmed = False
        # Measured cost, in ms, of a pass at each input size. Counting PASSES is
        # not a budget once tiles may run at different resolutions: measured on
        # this hardware a 1024 pass costs 332ms against 89ms at 640, so "two
        # more passes" can mean 180ms or 660ms. A live run produced 587ms p95
        # frames precisely because a recursive-zoom pass picked 1024 and nothing
        # checked what that would cost before running it.
        self._cost_by_imgsz: Dict[int, float] = {}

    def close(self) -> None:
        _unregister(self)
        governor.release(self.camera_id)
        self._registered = False
        self._cache.clear()
        self._last_seen.clear()
        self._prev_small = None
        self._prev_luma = None
        self._temporal.reset()

    # -- operator context (Feature 6) ---------------------------------------

    def set_priority_regions(self, regions) -> None:
        """Regions the operator cares about most, in normalised coordinates.

        Pushed from the pipeline whenever a camera's config changes. A gate, a
        cash counter or a restricted zone is where a missed detection actually
        costs something, so those tiles are inferred before an equally-busy
        tile of empty car park.
        """
        self._priority_regions = list(regions or [])

    def note_alert(self, cx: float, cy: float) -> None:
        """Record where an alert just fired (normalised coords).

        Somewhere that just produced an alert is, for the next few seconds, the
        most interesting part of the frame — an intrusion is usually followed by
        more of the same object, and that is precisely when losing it is worst.
        """
        self._recent_alerts.append((float(cx), float(cy), time.time()))

    # -- scene measurement --------------------------------------------------

    def _change_map(self, frame, s: TilingSettings = None):
        """Downscaled binary map of what changed since the previous frame.

        Returns (map, lighting_changed). `lighting_changed` means the whole
        frame's brightness moved — a cloud, an IR cut-over, a light switched on.
        That shifts every pixel at once, so the raw diff reads as motion
        everywhere and would re-infer every tile for a scene whose CONTENT did
        not change. Reported separately so the caller can invalidate the cache
        (the crops really are different pixels now) without treating it as
        object motion.
        """
        h, w = frame.shape[:2]
        if w <= 0 or h <= 0:
            return None, False
        cw = min(_CHANGE_MAP_W, w)
        ch = max(1, int(round(h * cw / float(w))))
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        small = cv2.resize(gray, (cw, ch), interpolation=cv2.INTER_AREA)

        luma = float(small.mean())
        prev_luma, self._prev_luma = self._prev_luma, luma
        lighting = False
        if s is not None and getattr(s, "lighting_guard", True) and prev_luma is not None:
            lighting = abs(luma - prev_luma) >= float(s.lighting_delta)

        prev, self._prev_small = self._prev_small, small
        if prev is None or prev.shape != small.shape:
            return None, lighting  # first frame (or a resolution change): all dirty
        diff = cv2.absdiff(small, prev)
        if lighting:
            # Subtract the global shift so what remains is genuine local motion
            # rather than the illumination step. Cheap, and it keeps the motion
            # signal meaningful through the transient instead of blinding it.
            diff = cv2.subtract(diff, int(abs(luma - prev_luma)))
        _, mask = cv2.threshold(diff, 18, 1, cv2.THRESH_BINARY)
        return mask, lighting

    @staticmethod
    def _tile_energy(change: Optional[np.ndarray], rect, w: int, h: int) -> float:
        if change is None:
            return 1.0  # unknown => dirty
        ch, cw = change.shape[:2]
        x1 = int(rect[0] * cw / w); x2 = int(math.ceil(rect[2] * cw / w))
        y1 = int(rect[1] * ch / h); y2 = int(math.ceil(rect[3] * ch / h))
        x2 = max(x1 + 1, min(cw, x2)); y2 = max(y1 + 1, min(ch, y2))
        sub = change[y1:y2, x1:x2]
        return float(sub.sum()) / float(max(1, sub.size))

    def _choose_grid(self, s: TilingSettings, budget_tiles: int, n_tracks: int, now: float) -> int:
        """Pick the grid density from what the scene has actually been showing.

        Driven by observed object SIZE, not resolution: tiling buys nothing on a
        camera whose subjects already fill a third of the frame, and everything
        on one watching a road 80m away.
        """
        if not s.enabled or budget_tiles <= 0 or s.max_grid <= 1:
            return 1

        # Nothing measured yet, or nothing found for a while: sweep at full
        # density to DISCOVER small objects. Without this the engine is blind to
        # its own reason for existing — a scene containing only tiny objects
        # yields no detections at 1x, so "objects are large" is never disproved.
        # Discovery must NOT be conditional on the camera being idle. The grid
        # decision is bistable: tiling finds small objects, which lowers the
        # measured median size, which keeps the grid fine, which keeps finding
        # them — and equally, a camera that starts at grid 1 sees only large
        # objects, so the median stays high and it never engages. The periodic
        # sweep is the only thing that breaks the second state, and gating it on
        # `n_tracks == 0` meant a camera with anything in frame could never run
        # one. That is precisely a busy scene, i.e. the case that matters.
        # Measured effect of the bug: identical settings on identical video
        # yielded 5.71, 5.29 and 4.49 detections/frame across runs depending on
        # whether the loop happened to catch.
        due = (now - self._last_discovery) >= s.discovery_interval_s
        if self._median_area_frac is None or due:
            self._last_discovery = now
            n = s.max_grid
        else:
            frac = self._median_area_frac
            if frac <= s.small_object_frac * 0.25:
                n = 5
            elif frac <= s.small_object_frac * 0.5:
                n = 4
            elif frac <= s.small_object_frac:
                n = 3
            elif frac <= s.small_object_frac * 4.0:
                n = 2
            else:
                n = 1
            if n_tracks >= 20:
                n = max(n, 3)
            elif n_tracks >= 8:
                n = max(n, 2)

        n = int(_clamp(n, max(1, s.min_grid), s.max_grid))
        # Never pick a density the budget cannot sweep in _COVERAGE_CYCLES —
        # a 5x5 at one tile per cycle means most tiles serve stale cache.
        while n > max(1, s.min_grid) and n * n > budget_tiles * _COVERAGE_CYCLES:
            n -= 1
        return n

    def _choose_overlap(self, s: TilingSettings, grid: int) -> float:
        """Overlap fraction for this layout (Feature 1).

        Fixed overlap wastes inference at coarse grids and loses objects at fine
        ones. The overlap band has to stay wide enough IN PIXELS to contain a
        typical object, but a tile at 5x5 is a fifth the width of one at 2x2, so
        the same FRACTION is a much narrower band. Scaling the fraction up with
        density keeps the band's real size roughly constant, which is what
        actually determines whether a seam-straddling object is seen whole.
        """
        if not s.adaptive_layout:
            return s.overlap
        # 2x2 -> ~0.16, 3x3 -> ~0.19, 4x4 -> ~0.22, 5x5 -> 0.25
        return float(_clamp(s.overlap * (1.0 + 0.15 * (grid - 2)), 0.15, 0.25))

    def _tile_priority(self, rect, energy: float, s: TilingSettings,
                       frame_w: int, frame_h: int, now: float) -> float:
        """Score for scheduling order (Feature 6).

        Not every tile is worth the same. A tile covering a restricted zone, an
        entry gate or a till is where a missed detection has a consequence; a
        tile of empty sky with the same amount of leaf motion is not. Ordering
        by this rather than by motion alone is what makes a scarce budget land
        where it matters.
        """
        score = energy * s.priority_motion_weight
        if not s.priority_enabled:
            return score

        nx1, ny1 = rect[0] / max(1, frame_w), rect[1] / max(1, frame_h)
        nx2, ny2 = rect[2] / max(1, frame_w), rect[3] / max(1, frame_h)

        for reg in self._priority_regions:
            pts = reg.get("points") or []
            if not pts:
                continue
            # Cheap bbox overlap in normalised space — an exact polygon
            # intersection per tile per frame would cost more than the
            # scheduling decision is worth.
            xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
            if max(xs) < nx1 or min(xs) > nx2 or max(ys) < ny1 or min(ys) > ny2:
                continue
            score += s.priority_zone_weight * float(reg.get("weight", 1.0))

        for (ax, ay, ts) in list(self._recent_alerts):
            # Alert relevance decays over 30s; after that the location is just
            # another part of the scene.
            age = now - ts
            if age > 30.0:
                continue
            if nx1 <= ax <= nx2 and ny1 <= ay <= ny2:
                score += s.priority_alert_weight * (1.0 - age / 30.0)

        cached = self._cache.get(rect)
        if cached:
            score += s.priority_object_weight * min(4, len(cached.get("items", []))) * 0.25
        return score

    # -- inference ----------------------------------------------------------

    @staticmethod
    def _run_pass(backend, frame, rect, imgsz, conf, iou, frame_h, frame_w,
                  geom_h, geom_w, is_tile):
        """One inference pass over `rect` (None = whole frame), with every
        result translated into `frame` coordinates before returning.

        A tile crop is a pure TRANSLATION of frame pixel coordinates — no
        scaling — so `geometry_shape` is the frame, not the tile: the backend's
        degenerate-shape filter then judges "is this box a plausible size for a
        person" against the frame. Judged against the tile a pedestrian filling
        a 1/9 crop reads as a >90%-of-image blowup and is silently discarded,
        which would make tiling *lose* the close objects it was added to
        complement.
        """
        if rect is None:
            sub, x0, y0 = frame, 0, 0
        else:
            x0, y0, x1, y1 = rect
            sub = frame[y0:y1, x0:x1]
        th, tw = sub.shape[:2]
        if th < 8 or tw < 8:
            return [], 0.0, 0.0, 0.0

        tensor, t_pre = backend.preprocess(sub, imgsz)
        outputs, t_inf = backend.run_inference(tensor)
        dets, masks, t_post = backend.postprocess(
            outputs, (th, tw), conf, iou, imgsz, geometry_shape=(geom_h, geom_w)
        )

        items = []
        for i, det in enumerate(dets):
            b = det["bbox"]
            b["x1"] += x0; b["x2"] += x0
            b["y1"] += y0; b["y2"] += y0
            truncated = False
            if is_tile:
                # Only an INTERIOR tile edge truncates. A box against the frame
                # border genuinely ends there, and marking it truncated would
                # exclude it from box averaging for no reason.
                truncated = (
                    (b["x1"] <= x0 + _EDGE_SLACK_PX and x0 > 0)
                    or (b["y1"] <= y0 + _EDGE_SLACK_PX and y0 > 0)
                    or (b["x2"] >= x0 + tw - _EDGE_SLACK_PX and x0 + tw < frame_w)
                    or (b["y2"] >= y0 + th - _EDGE_SLACK_PX and y0 + th < frame_h)
                )
            poly = masks[i] if i < len(masks) else []
            if poly:
                # Polygons arrive normalised to the crop; re-normalise to the
                # frame through absolute pixels so overlays land on the object.
                poly = [
                    [round((p[0] * tw + x0) / frame_w, 3),
                     round((p[1] * th + y0) / frame_h, 3)]
                    for p in poly
                ]
            items.append({"det": det, "mask": poly, "truncated": truncated})
        return items, t_pre, t_inf, t_post

    def infer(self, backend, frame, *, base_imgsz: int, conf_thresh: float,
              iou_thresh: float, min_imgsz: int, max_imgsz: int,
              n_tracks: int = 0, geometry_shape=None,
              cycle_budget_ms: float = None) -> TileResult:
        """Run this cycle's inference and return fused detections in `frame`
        coordinates.

        Always performs the whole-`frame` pass first, so the result is a
        superset of what plain single-pass inference would have produced.

        `geometry_shape` is the shape of the ORIGINAL camera frame when `frame`
        is itself a crop of it (the pipeline's zone-derived ROI pre-crop). It is
        used only to judge whether a box is a plausible size for its class —
        see EngineBackend.postprocess. Defaults to `frame`'s own shape.

        `cycle_budget_ms` is the WHOLE cycle's wall-clock allowance — the AI
        stage's frame period, derived by the caller from its target FPS. Extra
        tile passes may only use what the mandatory full-frame pass leaves
        unspent. Without it the engine spends `latency_budget_ms` (180ms by
        default) of EXTRA inference regardless of how fast the pipeline is
        trying to run, which is a policy divorced from the frame period:
        measured on this hardware a 29ms base pass became a 141.6ms cycle
        (4.08x, 28.8 -> 7.1 fps ceiling) purely because nothing related the
        budget to the deadline it was supposed to protect. Passing it makes
        tiling strictly opportunistic — it consumes real slack and nothing
        else, so recall is bought only where framerate is not being sold.
        None keeps the old unbounded-by-deadline behaviour.
        """
        s = get_tiling_settings()
        now = time.time()
        frame_h, frame_w = frame.shape[:2]
        geom_h, geom_w = geometry_shape if geometry_shape else (frame_h, frame_w)
        if not self._registered:
            _register(self)
            self._registered = True
        if not self._prewarmed and s.prewarm and s.multi_resolution and s.enabled:
            # Compile the finer resolution ladder OFF the AI thread. Measured
            # cold cost of a new shape is 6-9s on this hardware, which inside
            # this loop looks identical to a hung stage to the watchdog.
            self._prewarmed = True
            prewarm_shapes(backend)
        self._cycles += 1

        # 1. Full-frame pass — the baseline, never skipped.
        base_items, t_pre, t_inf, t_post = self._run_pass(
            backend, frame, None, base_imgsz, conf_thresh, iou_thresh,
            frame_h, frame_w, geom_h, geom_w, is_tile=False,
        )
        t_inf_base = t_inf
        # Discard the very first sample: it carries the one-time shape-compile
        # cost and describes the driver warming up, not what inference costs.
        if t_inf_base > 0 and self._cycles > 1:
            self._base_ms_ema = t_inf_base if self._base_ms_ema is None else (
                0.8 * self._base_ms_ema + 0.2 * t_inf_base
            )

        # 2. How many EXTRA passes fit in the budget, after sharing it with
        #    every other camera on this backend.
        #
        # Prefer a recently-measured tile cost; fall back to the (always fresh)
        # full-frame cost, which is a fair proxy because a tile never runs at a
        # larger input size than the base pass. While neither is known — the
        # first two cycles of a camera — spend nothing rather than guess.
        if self._tile_ms_ema is not None and (now - self._tile_ms_ts) < 5.0:
            per_tile = self._tile_ms_ema
        else:
            per_tile = self._base_ms_ema

        # The resource manager decides the pool; this camera's activity decides
        # its share of it. `_activity` is updated at the end of each cycle from
        # motion and object count, so a camera watching nothing yields its
        # allowance to one watching a gate instead of holding it idle.
        alloc = governor.allocate(self.camera_id, activity=self._activity, settings=s)
        self._last_alloc = alloc
        # 15% tolerance on the division, not a bare floor.
        #
        # A floored division makes the budget a knife edge exactly where it is
        # least stable: with a 120ms budget and a pass costing ~120ms, 119 gives
        # zero tiles and 121 gives one, so ambient machine load decides whether
        # the feature exists at all. Measured across five identical runs on
        # identical video, that produced 4.34 to 6.11 detections/frame — the
        # same configuration behaving like two different products. The tolerance
        # costs at most 15% over the nominal budget on the marginal tile and
        # buys a stable, reproducible answer.
        # The governor's pool is an upper bound on what this camera MAY spend.
        # The frame period is an upper bound on what it CAN spend without
        # missing its deadline. Take the smaller: a camera is never allowed to
        # buy recall with framerate the operator asked for.
        #
        # Slack is measured against the full-frame pass that has already run
        # this cycle (t_inf_base) plus a fixed allowance for the rest of the
        # stage — pre/post, tracking, analytics, telemetry — which the base
        # measurement does not include but which still has to fit in the same
        # period. Without that allowance the tile stage would spend the frame's
        # entire remainder and the cycle would land exactly one stage late.
        effective_budget_ms = alloc.budget_ms
        if cycle_budget_ms is not None and cycle_budget_ms > 0:
            spent = t_inf_base if t_inf_base > 0 else (self._base_ms_ema or 0.0)
            slack = cycle_budget_ms - spent - _NON_INFER_STAGE_MS
            effective_budget_ms = max(0.0, min(effective_budget_ms, slack))

        budget_tiles = 0 if per_tile is None else int(
            _clamp(int(effective_budget_ms / max(1.0, per_tile) + 0.15), 0, alloc.max_tiles)
        )
        if not s.enabled:
            budget_tiles = 0

        # Split the allowance between STAGES before the tile stage can eat it.
        #
        # The tile scheduler takes `scored[:budget]`, i.e. everything it is
        # given, so a leftover-based `spare` is always zero whenever any tile is
        # dirty — which on a moving scene is every frame. Recursive zoom and
        # edge expansion were therefore structurally unreachable: verified on
        # real video at a 900ms budget, both reported exactly 0 passes and could
        # never have run at all. Reserving up front is what makes them reachable.
        reserve = 0
        wants_extra = s.enabled and ((s.roi_boost and s.zoom_enabled) or s.edge_expansion)
        if wants_extra and budget_tiles >= 2:
            reserve = max(1, int(budget_tiles * 0.34))
        tile_budget = max(0, budget_tiles - reserve)

        grid = self._choose_grid(s, max(budget_tiles, 1) if wants_extra else budget_tiles,
                                 n_tracks, now)
        self._grid = grid
        overlap = self._choose_overlap(s, grid)
        rects = plan_tiles(frame_w, frame_h, grid, overlap)
        # The governor caps resolution too: under pressure the ceiling drops to
        # 640 so tiles stay cheap instead of the grid alone absorbing the cut.
        eff_max_imgsz = min(max_imgsz, alloc.max_imgsz)

        stats = {
            "enabled": bool(s.enabled),
            "grid": grid,
            "overlap": round(overlap, 3),
            "tiles_total": len(rects),
            "tiles_inferred": 0,
            "tiles_cached": 0,
            "boost_passes": 0,
            "zoom_passes": 0,
            "edge_passes": 0,
            "budget_tiles": budget_tiles,
            "tile_budget": tile_budget,
            "reserve": reserve,
            # Both numbers, so "why did tiling stop?" is answerable from
            # telemetry alone: pool_ms is what the governor offered,
            # budget_ms is what the frame period actually left.
            "pool_ms": round(alloc.budget_ms, 1),
            "budget_ms": round(effective_budget_ms, 1),
            "cycle_budget_ms": round(cycle_budget_ms, 1) if cycle_budget_ms else None,
            "per_tile_ms": round(per_tile, 1) if per_tile is not None else None,
            "cameras_sharing": _active_count(),
            "headroom": round(alloc.headroom, 3),
            "share": round(alloc.share, 3),
            "governor": alloc.reason,
            "max_imgsz": eff_max_imgsz,
            "activity": round(self._activity, 3),
        }

        items = list(base_items)
        change, lighting_changed = self._change_map(frame, s)
        if lighting_changed:
            # Every cached crop describes pixels at the OLD exposure. Reusing
            # them across an illumination step is how a cache turns into ghosts.
            self._cache.clear()
            stats["lighting_reset"] = True

        if rects:
            fresh, reused = self._collect_tiles(
                backend, frame, rects, change, s, now, tile_budget,
                base_imgsz, min_imgsz, conf_thresh, iou_thresh,
                frame_h, frame_w, geom_h, geom_w,
            )
            items.extend(fresh["items"])
            items.extend(reused["items"])
            t_pre += fresh["t_pre"]; t_inf += fresh["t_inf"]; t_post += fresh["t_post"]
            stats["tiles_inferred"] = fresh["count"]
            stats["tiles_cached"] = reused["count"]
            if fresh["count"]:
                # EMA over what tiles actually cost, which is what the budget
                # must be spent against — not the full-frame pass's cost.
                avg = fresh["t_inf"] / fresh["count"]
                self._tile_ms_ema = avg if self._tile_ms_ema is None else (
                    0.8 * self._tile_ms_ema + 0.2 * avg
                )
                self._tile_ms_ts = now

        # 3. Auto ROI expansion — give the model ONE look at any object a tile
        #    seam cut in half, before fusion has to reassemble it from parts.
        #
        # From here on the remaining allowance is tracked in MILLISECONDS, not
        # in passes. Once passes may run at different resolutions a pass count
        # stops being a budget — a 1024 pass costs 3.7x a 640 one on this
        # hardware, so "two spare passes" is anywhere between 180ms and 660ms.
        # Whatever the tile stage did not use, plus the reservation held back
        # for these stages in the first place.
        spare = budget_tiles - stats["tiles_inferred"]
        # Same deadline-derived allowance the tile stage was held to, minus what
        # the tile stage actually spent (t_inf - t_inf_base). Using the raw pool
        # here would let the zoom/edge stages re-spend a budget the frame period
        # already refused the tiles.
        spare_ms = max(0.0, effective_budget_ms - t_inf + t_inf_base)
        if s.enabled and spare > 0 and spare_ms > 0:
            exp_items, ep, ei, epo, n_exp = self._expand_edges(
                backend, frame, items, s, conf_thresh, iou_thresh,
                frame_h, frame_w, geom_h, geom_w, base_imgsz, min_imgsz,
                eff_max_imgsz, spare, spare_ms, per_tile,
            )
            if n_exp:
                t_pre += ep; t_inf += ei; t_post += epo
                stats["edge_passes"] = n_exp
                spare -= n_exp
                spare_ms -= ei
                items.extend(exp_items)

        dets, masks = fuse_detections(items, s.fusion_iou, s.fusion_containment)

        # 4. Recursive zoom — a targeted, progressively tighter re-look at
        #    regions the passes above found something uncertain in. Only these
        #    crops are re-run; the frame is not.
        if (s.enabled and s.roi_boost and s.roi_boost_max > 0 and spare > 0
                and spare_ms > 0 and dets and alloc.max_zoom_depth > 0):
            boost_items, bp, bi, bpo, n_boost = self._roi_boost(
                backend, frame, dets, s, min(spare, s.roi_boost_max),
                base_imgsz, min_imgsz, eff_max_imgsz, conf_thresh, iou_thresh,
                frame_h, frame_w, geom_h, geom_w, spare_ms, per_tile,
                alloc.max_zoom_depth,
            )
            if n_boost:
                t_pre += bp; t_inf += bi; t_post += bpo
                stats["boost_passes"] = n_boost
                stats["zoom_passes"] = max(0, n_boost - 1)
                items.extend(boost_items)
                dets, masks = fuse_detections(items, s.fusion_iou, s.fusion_containment)

        # Layout feedback is taken from the RAW fused result, before temporal
        # verification filters it.
        #
        # Feeding the FILTERED set back here is a self-reinforcing trap, found
        # in a live run: verification suppresses exactly the small, low-
        # confidence detections that tiling exists to find, so the surviving
        # objects are the big confident ones, the measured median object size
        # grows, the grid drops to 1x1, tiles stop running, and the small
        # objects are never found again. Detections fell BELOW the no-tiling
        # baseline (4.29 vs 4.43) while the engine reported itself healthy.
        # What the layout needs to know is what the model can SEE, not what
        # policy chose to emit.
        self._observe(dets, frame_w, frame_h, n_tracks)
        self._update_activity(change, dets, n_tracks)

        # 5. Temporal fusion + confidence verification + false-positive filter.
        #    Runs LAST, on the fused per-frame result, so it reasons about
        #    objects rather than about individual passes' opinions of them.
        if s.temporal_enabled or s.verify_enabled:
            dets, masks, tstats = self._temporal.update(
                dets, masks, settings=s, motion_map=change,
                frame_wh=(frame_w, frame_h), now=now,
            )
            stats["temporal"] = tstats

        self._prune_cache(now, s)
        stats["detections"] = len(dets)
        stats["raw_candidates"] = len(items)

        return TileResult(detections=dets, masks=masks, t_pre=t_pre, t_inf=t_inf,
                          t_inf_base=t_inf_base, t_post=t_post, stats=stats)

    # -- tile scheduling ----------------------------------------------------

    def _collect_tiles(self, backend, frame, rects, change, s: TilingSettings, now: float,
                       budget: int, base_imgsz: int, min_imgsz: int,
                       conf: float, iou: float, frame_h: int, frame_w: int,
                       geom_h: int, geom_w: int):
        """Decide which tiles to actually infer, run them, reuse the rest.

        A tile whose pixels moved must be re-inferred because its cached boxes
        describe an image that no longer exists; among unchanged tiles the
        stalest cache goes first so every tile is refreshed in bounded time even
        in a dead-still scene.

        WHICH dirty tile goes first is the priority score (Feature 6), not raw
        motion: when the budget affords 2 of 9 tiles, the two it spends on
        should be the restricted zone and the gate, not whichever two happen to
        have the most leaf movement.
        """
        scored = []
        for rect in rects:
            self._last_seen[rect] = now
            energy = self._tile_energy(change, rect, frame_w, frame_h)
            cached = self._cache.get(rect)
            age = (now - cached["ts"]) if cached else 1e9
            dirty = energy >= s.motion_threshold or cached is None or age > s.cache_ttl_s
            priority = self._tile_priority(rect, energy, s, frame_w, frame_h, now)
            scored.append((rect, energy, age, dirty, priority))

        # Dirty tiles first (highest priority first), then the stalest clean one.
        scored.sort(key=lambda r: (0 if r[3] else 1, -r[4], -r[2]))
        to_infer = [r for r in scored[:budget] if r[3]]
        infer_set = {r[0] for r in to_infer}

        ladder = shape_ladder(s)
        jobs = []
        for rect, _e, _a, _d, _p in to_infer:
            tw, th = rect[2] - rect[0], rect[3] - rect[1]
            # Multi-resolution (Feature 8): each tile picks its own input size
            # from its own dimensions, so a fine-grid tile is not forced to pay
            # for a tensor far larger than the pixels it actually contains.
            imgsz = _pick_imgsz(max(tw, th), base_imgsz, min_imgsz, ladder=ladder)
            jobs.append((rect, imgsz))

        fresh_items, t_pre, t_inf, t_post = [], 0.0, 0.0, 0.0
        if jobs:
            if len(jobs) == 1 or s.workers <= 1:
                # A single tile on a worker thread would only add a hand-off and
                # a second InferRequest for no overlap to exploit.
                results = [
                    (r, self._run_pass(backend, frame, r, sz, conf, iou,
                                       frame_h, frame_w, geom_h, geom_w, True))
                    for r, sz in jobs
                ]
            else:
                # Tiles are independent, and both backends release the GIL for
                # the duration of a call (OpenVINO hands each thread its own
                # InferRequest; ONNX Runtime sessions are documented thread-safe
                # for concurrent Run()), so these overlap for real.
                pool = _get_executor(s.workers)
                futures = [(r, pool.submit(self._run_pass, backend, frame, r, sz,
                                           conf, iou, frame_h, frame_w,
                                           geom_h, geom_w, True))
                           for r, sz in jobs]
                results = [(r, f.result()) for r, f in futures]

            sizes = {r: sz for r, sz in jobs}
            for rect, (tile_items, tp, ti, tpo) in results:
                t_pre += tp; t_inf += ti; t_post += tpo
                self._record_cost(sizes.get(rect, base_imgsz), ti)
                fresh_items.extend(tile_items)
                self._cache[rect] = {"ts": now, "items": tile_items}

        reused_items, n_reused = [], 0
        for rect, _e, _a, _d, _p in scored:
            if rect in infer_set:
                continue
            cached = self._cache.get(rect)
            if not cached or (now - cached["ts"]) > s.cache_ttl_s:
                continue
            # Safe to re-emit: this tile's pixels have not changed since the
            # pass that produced these boxes, so they still describe what is
            # there. The TTL bounds how long that assumption may stand.
            reused_items.extend(cached["items"])
            n_reused += 1

        return (
            {"items": fresh_items, "count": len(jobs), "t_pre": t_pre,
             "t_inf": t_inf, "t_post": t_post},
            {"items": reused_items, "count": n_reused},
        )

    def _prune_cache(self, now: float, s: TilingSettings) -> None:
        """Drop entries for rects no longer in the current plan (the grid
        changed, or the camera's resolution did) so the cache cannot grow
        without bound across grid switches."""
        horizon = max(2.0, s.cache_ttl_s * 4)
        stale = [r for r, ts in self._last_seen.items() if now - ts > horizon]
        for r in stale:
            self._last_seen.pop(r, None)
            self._cache.pop(r, None)

    # -- ROI boost ----------------------------------------------------------

    def _roi_boost(self, backend, frame, dets, s: TilingSettings, budget: int,
                   base_imgsz: int, min_imgsz: int, max_imgsz: int,
                   conf: float, iou: float, frame_h: int, frame_w: int,
                   geom_h: int, geom_w: int, budget_ms: float = 1e9,
                   per_tile_ms: Optional[float] = None, max_depth: int = 0):
        """Re-inspect the least certain small detections at a higher input size.

        Candidates are ranked by how marginal they are: a box below
        second_pass_conf is one the model nearly discarded, and re-running just
        that neighbourhood at a larger tensor is the cheapest way to either
        confirm it (higher score after fusion) or leave it alone. Boxes that are
        already confident are skipped — there is nothing to gain.
        """
        cands = []
        for d in dets:
            c = float(d["confidence"])
            if c >= s.second_pass_conf:
                continue
            x1, y1, x2, y2 = _xyxy(d)
            area_frac = ((x2 - x1) * (y2 - y1)) / float(max(1, frame_w * frame_h))
            if area_frac > s.small_object_frac * 8:
                continue
            cands.append((c, (x1, y1, x2, y2)))
        if not cands:
            return [], 0.0, 0.0, 0.0, 0

        cands.sort(key=lambda t: t[0])
        rects, taken = [], []
        for _c, box in cands:
            x1, y1, x2, y2 = box
            bw, bh = x2 - x1, y2 - y1
            # Context matters to the detector: a crop tight on the object gives
            # it no scene to place the object in. 1.5x padding each way.
            px, py = bw * 1.5, bh * 1.5
            r = (int(_clamp(x1 - px, 0, frame_w - 1)), int(_clamp(y1 - py, 0, frame_h - 1)),
                 int(_clamp(x2 + px, 1, frame_w)), int(_clamp(y2 + py, 1, frame_h)))
            if r[2] - r[0] < 16 or r[3] - r[1] < 16:
                continue
            # Skip a region already covered by one we're about to run — two
            # near-identical crops cost two passes and add one object's worth
            # of evidence.
            if any(_overlap_metrics(r, prev)[1] > 0.7 for prev in taken):
                continue
            taken.append(r)
            rects.append(r)
            if len(rects) >= budget:
                break
        if not rects:
            return [], 0.0, 0.0, 0.0, 0

        items, t_pre, t_inf, t_post = [], 0.0, 0.0, 0.0
        passes = 0
        remaining_ms = budget_ms
        for r in rects:
            got, tp, ti, tpo, n = self._zoom_recursive(
                backend, frame, r, s, conf, iou, frame_h, frame_w, geom_h, geom_w,
                base_imgsz, min_imgsz, max_imgsz, depth=0, budget_passes=budget - passes,
                budget_ms=remaining_ms, per_tile_ms=per_tile_ms, max_depth=max_depth,
            )
            t_pre += tp; t_inf += ti; t_post += tpo
            passes += n
            remaining_ms -= ti
            items.extend(got)
            if passes >= budget or remaining_ms <= 0:
                break
        return items, t_pre, t_inf, t_post, passes

    def _zoom_recursive(self, backend, frame, rect, s: TilingSettings, conf, iou,
                        frame_h, frame_w, geom_h, geom_w,
                        base_imgsz, min_imgsz, max_imgsz, depth, budget_passes,
                        budget_ms=1e9, per_tile_ms=None, max_depth=0,
                        parent_conf=None):
        """Recursive AI zoom (Feature 2): original -> 2x crop -> 4x crop.

        Each level re-runs inference on a TIGHTER crop of the same region, so
        the object occupies proportionally more of the input tensor each time.
        This is real optical detail from the source frame being given more of
        the model's fixed input budget — no pixels are generated, invented or
        upscaled into existence.

        Descent stops at the first of:
          * confidence stabilised — the extra detail stopped changing the
            answer, so another level costs a pass and buys nothing;
          * maximum depth reached;
          * the object is already too small in absolute pixels to survive
            another crop (there is no detail left to expose, only noise);
          * the pass budget for this cycle is spent.
        """
        if budget_passes <= 0 or budget_ms <= 0:
            return [], 0.0, 0.0, 0.0, 0

        long_side = max(rect[2] - rect[0], rect[3] - rect[1])
        ladder = shape_ladder(s)
        # Ask for enough input resolution to render this crop at roughly 2x its
        # own size, capped by what the governor currently permits.
        imgsz = _pick_imgsz(int(long_side * 2), max_imgsz, max(min_imgsz, base_imgsz),
                            ladder=ladder)
        # Step DOWN the ladder until the predicted cost fits what is left. A
        # zoom that blows the frame's latency budget makes the overlay late for
        # every object in order to be slightly more certain about one.
        while self._predict_ms(imgsz, per_tile_ms) > budget_ms:
            lower = [v for v in ladder if v < imgsz]
            if not lower or lower[-1] < min_imgsz:
                return [], 0.0, 0.0, 0.0, 0
            imgsz = lower[-1]

        got, tp, ti, tpo = self._run_pass(backend, frame, rect, imgsz, conf, iou,
                                          frame_h, frame_w, geom_h, geom_w, is_tile=True)
        self._record_cost(imgsz, ti)
        t_pre, t_inf, t_post = tp, ti, tpo
        passes = 1
        items = list(got)

        # Depth is bounded by BOTH the operator's setting and what the governor
        # currently allows — recursive zoom is the most expensive thing here, so
        # it is the first capability withdrawn under device pressure.
        depth_cap = min(s.zoom_max_depth, max_depth) if max_depth else s.zoom_max_depth
        if not s.zoom_enabled or depth >= depth_cap or passes >= budget_passes:
            return items, t_pre, t_inf, t_post, passes

        # Descend on the least certain object this level found — that is the one
        # more detail can still change the answer for.
        cands = [it for it in got if not it["truncated"]]
        if not cands:
            return items, t_pre, t_inf, t_post, passes
        worst = min(cands, key=lambda it: float(it["det"]["confidence"]))
        wc = float(worst["det"]["confidence"])
        bx1, by1, bx2, by2 = _xyxy(worst["det"])
        bw, bh = bx2 - bx1, by2 - by1

        if min(bw, bh) < s.zoom_min_object_px:
            return items, t_pre, t_inf, t_post, passes
        if wc >= s.second_pass_conf:
            return items, t_pre, t_inf, t_post, passes

        # Confidence stability: if this level's best view of the object agrees
        # with what the PARENT level believed, more zoom is redundant.
        #
        # Carried down the recursion rather than stashed on self: an instance
        # attribute persists across rects and across frames, so the comparison
        # would be against whatever some unrelated object scored last — the
        # descent would then stop or continue for reasons nothing to do with
        # this object.
        if parent_conf is not None and abs(wc - parent_conf) < s.zoom_conf_stable_delta:
            return items, t_pre, t_inf, t_post, passes

        pad_x, pad_y = bw * 0.6, bh * 0.6
        child = (int(_clamp(bx1 - pad_x, 0, frame_w - 1)),
                 int(_clamp(by1 - pad_y, 0, frame_h - 1)),
                 int(_clamp(bx2 + pad_x, 1, frame_w)),
                 int(_clamp(by2 + pad_y, 1, frame_h)))
        if child[2] - child[0] < 16 or child[3] - child[1] < 16:
            return items, t_pre, t_inf, t_post, passes
        # A child crop that is not meaningfully tighter than its parent would
        # re-run the same pixels at the same scale.
        if (child[2] - child[0]) > 0.75 * (rect[2] - rect[0]):
            return items, t_pre, t_inf, t_post, passes

        sub, sp, si, spo, sn = self._zoom_recursive(
            backend, frame, child, s, conf, iou, frame_h, frame_w, geom_h, geom_w,
            base_imgsz, min_imgsz, max_imgsz, depth + 1, budget_passes - passes,
            budget_ms=budget_ms - t_inf, per_tile_ms=per_tile_ms, max_depth=max_depth,
            parent_conf=wc,
        )
        items.extend(sub)
        return items, t_pre + sp, t_inf + si, t_post + spo, passes + sn

    def _expand_edges(self, backend, frame, items, s: TilingSettings, conf, iou,
                      frame_h, frame_w, geom_h, geom_w, base_imgsz, min_imgsz,
                      max_imgsz, budget, budget_ms=1e9, per_tile_ms=None):
        """Auto ROI expansion (Feature 7).

        Fusion can already recombine a seam-cut object from its fragments, but
        only geometrically — it never gets to SEE the whole object, so the
        merged box is the union of two partial views and its class and
        confidence come from partial evidence. When a detection is truncated at
        a tile edge, re-running one crop centred on the union of its fragments
        gives the model the entire object in one look, which is the only way to
        get a box and a class that were measured rather than reassembled.
        """
        if not s.edge_expansion or budget <= 0:
            return [], 0.0, 0.0, 0.0, 0

        truncated = [it for it in items if it["truncated"]]
        if not truncated:
            return [], 0.0, 0.0, 0.0, 0

        regions, taken = [], []
        for it in sorted(truncated, key=lambda i: -float(i["det"]["confidence"])):
            x1, y1, x2, y2 = _xyxy(it["det"])
            bw, bh = x2 - x1, y2 - y1
            # Expand generously along every axis: the missing part of the object
            # is by definition outside the box we have.
            r = (int(_clamp(x1 - bw * 0.8, 0, frame_w - 1)),
                 int(_clamp(y1 - bh * 0.8, 0, frame_h - 1)),
                 int(_clamp(x2 + bw * 0.8, 1, frame_w)),
                 int(_clamp(y2 + bh * 0.8, 1, frame_h)))
            if r[2] - r[0] < 16 or r[3] - r[1] < 16:
                continue
            if any(_overlap_metrics(r, p)[1] > 0.7 for p in taken):
                continue
            taken.append(r)
            regions.append(r)
            if len(regions) >= min(budget, s.edge_expansion_max):
                break

        out, t_pre, t_inf, t_post = [], 0.0, 0.0, 0.0
        ladder = shape_ladder(s)
        remaining_ms = budget_ms
        ran = 0
        for r in regions:
            long_side = max(r[2] - r[0], r[3] - r[1])
            imgsz = _pick_imgsz(long_side, max_imgsz, max(min_imgsz, base_imgsz),
                                ladder=ladder)
            if self._predict_ms(imgsz, per_tile_ms) > remaining_ms:
                break
            got, tp, ti, tpo = self._run_pass(backend, frame, r, imgsz, conf, iou,
                                              frame_h, frame_w, geom_h, geom_w,
                                              is_tile=True)
            self._record_cost(imgsz, ti)
            t_pre += tp; t_inf += ti; t_post += tpo
            remaining_ms -= ti
            ran += 1
            out.extend(got)
        return out, t_pre, t_inf, t_post, ran

    # -- scene feedback -----------------------------------------------------

    def _predict_ms(self, imgsz: int, per_tile_ms: Optional[float]) -> float:
        """What a pass at `imgsz` will cost on this machine, in ms.

        Prefers a measured figure for that exact size; otherwise scales a known
        cost by the relative-cost table. This is what lets the engine decide
        NOT to run an expensive pass, rather than discovering the cost after
        blowing the frame's latency budget.
        """
        known = self._cost_by_imgsz.get(imgsz)
        if known is not None:
            return known
        ref_ms, ref_sz = None, None
        for sz, ms in self._cost_by_imgsz.items():
            ref_ms, ref_sz = ms, sz
            break
        if ref_ms is None:
            ref_ms, ref_sz = (per_tile_ms or 80.0), 640
        ratio = _SHAPE_COST.get(imgsz, 1.0) / max(0.01, _SHAPE_COST.get(ref_sz, 1.0))
        return ref_ms * ratio

    def _record_cost(self, imgsz: int, ms: float) -> None:
        if ms <= 0:
            return
        prev = self._cost_by_imgsz.get(imgsz)
        self._cost_by_imgsz[imgsz] = ms if prev is None else (0.8 * prev + 0.2 * ms)

    def _update_activity(self, change, dets, n_tracks: int) -> None:
        """This camera's 0..1 claim on the shared inference pool (Feature 12).

        Deliberately built from motion AND object count together. Motion alone
        would hand the pool to a camera pointed at a tree; object count alone
        would starve a camera at the moment something first walks into an empty
        scene, which is exactly when it needs the budget most.
        """
        motion = 0.0
        if change is not None and change.size:
            motion = float(change.sum()) / float(change.size)
        motion_term = min(1.0, motion / 0.02)
        object_term = min(1.0, max(len(dets), n_tracks) / 8.0)
        raw = max(motion_term, object_term)
        self._activity = 0.7 * self._activity + 0.3 * raw

    def _observe(self, dets, frame_w: int, frame_h: int, n_tracks: int) -> None:
        """Feed the emitted detections back into the grid decision.

        Median (not mean) object area: one bus in the near lane must not
        convince the engine that the pedestrians at the far end are large.
        """
        if not dets:
            return
        area = float(max(1, frame_w * frame_h))
        fracs = sorted(
            ((d["bbox"]["x2"] - d["bbox"]["x1"]) * (d["bbox"]["y2"] - d["bbox"]["y1"])) / area
            for d in dets
        )
        median = fracs[len(fracs) // 2]
        self._median_area_frac = median if self._median_area_frac is None else (
            0.7 * self._median_area_frac + 0.3 * median
        )
