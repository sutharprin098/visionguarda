"""
Invisible AI Zoom Engine tests (server/app/ai/tiling.py).

Four things must hold, and each is a real failure this pipeline has hit before
in some form:

  1. COORDINATE INTEGRITY — a detection found in a tile must land on the object
     in FULL-FRAME pixels. An off-by-a-tile box is worse than no box: it feeds
     the tracker, analytics, zone containment and alerts a lie.
  2. ONE OBJECT, ONE BOX — the same car seen by the full-frame pass, two
     overlapping tiles and a boost pass must leave exactly one payload entry.
     Duplicate overlays have regressed here twice (see the emission invariant),
     and tiling is by construction the largest new source of duplicates.
  3. THE FRAME IS NEVER MODIFIED — the engine may only read pixels. If it ever
     wrote to the frame buffer it would corrupt the operator's live view, which
     is the one thing this feature promises not to do.
  4. IT DEGRADES, IT DOES NOT STALL — with the budget spent (many cameras, slow
     device, or the feature switched off) the engine must issue exactly ONE
     inference pass, i.e. the single-pass behaviour that was already proven
     stable, rather than queueing tiles it cannot afford.

The backend is faked: these are tests of scheduling, geometry and fusion, none
of which need a real model, and a fake lets a test place an object at an exact
pixel and assert the exact pixel comes back.
"""
import itertools
import threading
import time

import numpy as np
import pytest

from app.ai import tiling
from app.ai.tile_governor import governor
from app.ai.tiling import (
    AdaptiveTileEngine,
    TilingSettings,
    fuse_detections,
    get_tiling_settings,
    plan_tiles,
    set_tiling_settings,
)


# ---------------------------------------------------------------------------
# Fakes
# ---------------------------------------------------------------------------


class FakeBackend:
    """A detector that "sees" a fixed set of full-frame axis-aligned objects.

    Given a crop, it reports every object whose box intersects that crop,
    clipped to it and expressed in CROP coordinates — exactly what a real
    detector does with a tile, and the reason the engine has to translate. It
    also honours `geometry_shape` the way EngineBackend does, so a test can
    prove the engine passes the frame rather than the tile.
    """

    #: Objects the fake can see, as (x1, y1, x2, y2, class, confidence).
    def __init__(self, objects, min_visible_px=0, infer_ms=25.0):
        self.objects = objects
        # Emulates "too small to detect at this scale": an object is only
        # reported if it occupies at least this many pixels of the crop.
        self.min_visible_px = min_visible_px
        # Reported cost of one pass. The engine turns this into a tile count, so
        # a fake claiming ~0ms would make every budget infinite and the
        # degradation tests vacuous.
        self.infer_ms = infer_ms
        self.calls = []
        self.lock = threading.Lock()

    def preprocess(self, frame, target_size=320):
        h, w = frame.shape[:2]
        return {"shape": (h, w), "imgsz": target_size}, 0.1

    def run_inference(self, tensor):
        with self.lock:
            self.calls.append(tensor)
        return tensor, self.infer_ms

    def postprocess(self, outputs, orig_shape, conf=0.25, iou=0.45, target_imgsz=320,
                    geometry_shape=None):
        th, tw = orig_shape
        # The engine hands crops to preprocess and the same imgsz to
        # postprocess; the fake carries the crop's offset via the frame content
        # it was given, so tests instead resolve offsets from `_crop_origin`.
        ox, oy = self._crop_origin
        dets = []
        for (x1, y1, x2, y2, cls, cf) in self.objects:
            cx1, cy1 = max(x1, ox), max(y1, oy)
            cx2, cy2 = min(x2, ox + tw), min(y2, oy + th)
            if cx2 <= cx1 or cy2 <= cy1:
                continue
            # Scale-dependent visibility: the bigger the object is *within the
            # crop*, the more likely a real detector resolves it.
            scale = target_imgsz / float(max(th, tw))
            if (cx2 - cx1) * scale < self.min_visible_px:
                continue
            if cf < conf:
                continue
            dets.append({
                "class": cls, "confidence": cf, "track_id": None,
                "bbox": {"x1": cx1 - ox, "y1": cy1 - oy, "x2": cx2 - ox, "y2": cy2 - oy},
            })
        return dets, [[] for _ in dets], 0.1

    @property
    def _crop_origin(self):
        if not hasattr(self, "_tl"):
            self._tl = threading.local()
        return getattr(self._tl, "crop_origin", (0, 0))

    @_crop_origin.setter
    def _crop_origin(self, val):
        if not hasattr(self, "_tl"):
            self._tl = threading.local()
        self._tl.crop_origin = val


class OriginTrackingBackend(FakeBackend):
    """FakeBackend that infers each crop's origin by matching its pixel content.

    The engine passes a numpy VIEW of the frame, so the crop's position is
    recoverable from the marker values the test paints into the frame — which
    also means these tests fail loudly if the engine ever hands over a copy or
    a modified buffer.
    """

    def __init__(self, objects, frame, min_visible_px=0):
        super().__init__(objects, min_visible_px)
        self.frame = frame

    def preprocess(self, frame, target_size=320):
        # Locate this crop inside the parent frame by identity of the memory it
        # views (numpy exposes the offset through the base buffer's pointer).
        base = frame.base if frame.base is not None else frame
        if base is self.frame or (getattr(base, "base", None) is self.frame):
            offset = frame.__array_interface__["data"][0] - self.frame.__array_interface__["data"][0]
            row_bytes = self.frame.strides[0]
            px_bytes = self.frame.strides[1]
            oy = offset // row_bytes
            ox = (offset % row_bytes) // px_bytes
        else:
            ox = oy = 0
        self._crop_origin = (int(ox), int(oy))
        return super().preprocess(frame, target_size)


@pytest.fixture(autouse=True)
def _isolated_settings():
    """Settings, the engine registry AND the resource governor are all
    process-wide by design; snapshot and restore every one of them so tests
    cannot leak into each other. A leaked engine or a stale governor entry eats
    another test's inference budget and makes it fail for the wrong reason.

    Prewarm is off here: it compiles the whole resolution ladder on a background
    thread, which is right in production and pure noise in a test that counts
    inference calls.
    """
    before = get_tiling_settings()
    tiling._active_engines.clear()
    governor._cameras.clear()
    # Headroom is deliberately STICKY in production (slew-limited, so a stale
    # 5s-old GPU sample cannot make it oscillate). That same stickiness leaks
    # between tests: one test that reads a momentarily busy machine leaves the
    # global governor throttled, and the next test fails for a reason that has
    # nothing to do with what it asserts. Reset the whole closed loop.
    governor._headroom = 1.0
    governor._last_probe = 0.0
    governor._cpu_prev = None
    governor._probe_cache = {"percent": 0.0, "mem_percent": None, "temp_c": None,
                             "cpu": None}
    set_tiling_settings(prewarm=False)
    yield
    tiling._active_engines.clear()
    governor._cameras.clear()
    governor._headroom = 1.0
    governor._cpu_prev = None
    governor._last_probe = 0.0
    governor._probe_cache = {"percent": 0.0, "mem_percent": None, "temp_c": None,
                             "cpu": None}
    set_tiling_settings(**{k: getattr(before, k) for k in TilingSettings.__dataclass_fields__})


def _frame(w=1280, h=720):
    return np.zeros((h, w, 3), dtype=np.uint8)


_engine_seq = itertools.count()


def _engine(camera_id=None):
    """A fresh engine with a UNIQUE camera id.

    The resource governor keys per-camera state by camera_id (one engine per
    camera in production). Reusing one id across several test engines makes the
    governor see a single camera and silently defeats every allocation test.
    """
    return AdaptiveTileEngine(camera_id or f"test-cam-{next(_engine_seq)}")


def _infer(engine, backend, frame, **kw):
    kw.setdefault("base_imgsz", 640)
    kw.setdefault("conf_thresh", 0.25)
    kw.setdefault("iou_thresh", 0.45)
    kw.setdefault("min_imgsz", 320)
    kw.setdefault("max_imgsz", 1280)
    return engine.infer(backend, frame, **kw)


def _warm(engine, backend, frame, **kw):
    """Run the one cycle a real camera spends measuring its own inference cost.

    A fresh engine spends no budget until it knows what a pass costs on this
    hardware, and it discards its first sample because that one carries the
    shape-compile cost rather than the steady-state cost. Tests that assert on
    tile behaviour have to get past that first cycle, exactly as a running
    camera does within its first ~100ms.
    """
    _infer(engine, backend, frame, **kw)
    return engine


# ---------------------------------------------------------------------------
# Tile geometry
# ---------------------------------------------------------------------------


def test_tiles_cover_the_whole_frame_with_no_gap():
    """Every pixel must belong to at least one tile. A gap is a blind stripe
    down the middle of the frame that nothing would ever report."""
    w, h = 1920, 1080
    for grid in (2, 3, 4, 5):
        rects = plan_tiles(w, h, grid, 0.2)
        covered = np.zeros((h, w), dtype=bool)
        for x1, y1, x2, y2 in rects:
            covered[y1:y2, x1:x2] = True
        assert covered.all(), f"grid {grid} leaves uncovered pixels"


def test_neighbouring_tiles_overlap_by_the_configured_fraction():
    """The overlap is what stops an object on a seam being cut in half in every
    tile that sees it. Without it, fusion has nothing whole to fuse to."""
    rects = plan_tiles(1000, 1000, 3, 0.20)
    xs = sorted({(r[0], r[2]) for r in rects})
    (a1, a2), (b1, b2) = xs[0], xs[1]
    overlap_px = a2 - b1
    assert overlap_px > 0, "neighbouring tiles do not overlap at all"
    assert 0.15 <= overlap_px / (a2 - a1) <= 0.26


def test_grid_one_plans_no_tiles():
    """Grid 1 is the plain full-frame pass the caller already ran; planning a
    tile for it would double the work to learn nothing."""
    assert plan_tiles(1920, 1080, 1, 0.2) == []


# ---------------------------------------------------------------------------
# Coordinate integrity
# ---------------------------------------------------------------------------


def test_detection_found_only_in_a_tile_maps_to_correct_full_frame_pixels():
    """The core promise. An object the full-frame pass is too coarse to see is
    found in a tile and must come back at its TRUE full-frame position."""
    frame = _frame(1280, 720)
    # A small object at a known place, deliberately away from every tile seam
    # so exactly one tile sees it whole.
    obj = (940, 560, 980, 610, "person", 0.8)
    # min_visible_px is set so the object is invisible at full-frame scale
    # (40px * 640/1280 = 20px) but visible inside a tile (40px * 640/~530 = 48px).
    backend = OriginTrackingBackend([obj], frame, min_visible_px=30)
    # Verification off: this test is about GEOMETRY. With it on, a 0.80
    # detection is deliberately held for a frame of corroboration (Feature 9),
    # which would make a coordinate test fail for a reason that has nothing to
    # do with coordinates. The bands get their own tests below.
    set_tiling_settings(enabled=True, max_grid=3, max_tiles=9,
                        latency_budget_ms=400.0, roi_boost=False, workers=1,
                        verify_enabled=False, temporal_enabled=False)

    res = _infer(_warm(_engine(), backend, frame), backend, frame)

    assert res.stats["tiles_inferred"] > 0, "no tile pass ran"
    matches = [d for d in res.detections if d["class"] == "person"]
    assert len(matches) == 1, f"expected exactly one person, got {len(matches)}"
    b = matches[0]["bbox"]
    assert (b["x1"], b["y1"], b["x2"], b["y2"]) == (940, 560, 980, 610)


def test_tile_detections_are_not_reported_relative_to_the_tile():
    """The failure this guards: forgetting the +x0/+y0 translation. The box
    would still look plausible — it just sits on the wrong object."""
    frame = _frame(1280, 720)
    obj = (1100, 620, 1160, 690, "car", 0.9)
    backend = OriginTrackingBackend([obj], frame, min_visible_px=40)
    set_tiling_settings(enabled=True, max_grid=3, max_tiles=9,
                        latency_budget_ms=400.0, roi_boost=False, workers=1,
                        verify_enabled=False, temporal_enabled=False)

    res = _infer(_warm(_engine(), backend, frame), backend, frame)

    assert res.detections, "object in the bottom-right tile was lost entirely"
    b = res.detections[0]["bbox"]
    assert b["x1"] > 900 and b["y1"] > 500, (
        f"box at {b} looks tile-relative, not frame-relative"
    )


# ---------------------------------------------------------------------------
# Frame integrity
# ---------------------------------------------------------------------------


def test_engine_never_modifies_the_frame():
    """The displayed video and the AI input are the same buffer at this point
    in the pipeline. A single in-place write here would show up on the
    operator's live view — the one outcome this feature must never have."""
    rng = np.random.default_rng(7)
    frame = rng.integers(0, 255, (720, 1280, 3), dtype=np.uint8)
    original = frame.copy()
    backend = FakeBackend([(100, 100, 400, 500, "person", 0.9)])
    set_tiling_settings(enabled=True, max_grid=3, max_tiles=9,
                        latency_budget_ms=400.0, workers=1)

    _infer(_engine(), backend, frame)

    assert np.array_equal(frame, original), "engine wrote into the video frame"


# ---------------------------------------------------------------------------
# Fusion / duplicate suppression
# ---------------------------------------------------------------------------


def _item(box, cls="car", conf=0.9, truncated=False):
    x1, y1, x2, y2 = box
    return {
        "det": {"class": cls, "confidence": conf, "track_id": None,
                "bbox": {"x1": x1, "y1": y1, "x2": x2, "y2": y2}},
        "mask": [],
        "truncated": truncated,
    }


def test_same_object_seen_by_several_passes_yields_one_box():
    """One object, one payload entry — the emission invariant, applied to the
    new duplicate source. Overlapping tiles guarantee multiple views."""
    items = [
        _item((100, 100, 200, 300), conf=0.90),
        _item((104, 98, 198, 305), conf=0.85),
        _item((99, 102, 203, 297), conf=0.70),
    ]
    dets, masks = fuse_detections(items, 0.55, 0.75)
    assert len(dets) == 1
    assert len(masks) == len(dets)


def test_two_distinct_nearby_objects_are_not_merged():
    """Fusion must not become a crowd-eraser: two people standing side by side
    are two detections, and collapsing them would silently undercount."""
    items = [_item((100, 100, 150, 300), cls="person"),
             _item((160, 100, 210, 300), cls="person")]
    dets, _ = fuse_detections(items, 0.55, 0.75)
    assert len(dets) == 2


def test_truncated_box_merges_with_the_whole_box_and_keeps_full_extent():
    """A seam cuts a car in half in one tile; the neighbouring tile sees it
    whole. The merged box must be the whole car — averaging the half in would
    crop the overlay, and keeping both would double-count the car."""
    whole = _item((100, 100, 300, 200), conf=0.80)
    half = _item((100, 100, 190, 200), conf=0.88, truncated=True)
    dets, _ = fuse_detections([whole, half], 0.55, 0.75)
    assert len(dets) == 1
    b = dets[0]["bbox"]
    assert b["x2"] >= 295, f"merged box was cropped to the truncated view: {b}"


def test_object_split_across_seams_is_reassembled_from_truncated_views():
    """When NO tile saw the object whole, the union of the truncated views is
    its extent. Two half-boxes surviving as two objects would be the classic
    'one bus counted twice' tiling artefact."""
    left = _item((100, 100, 200, 200), truncated=True, conf=0.7)
    right = _item((180, 100, 300, 200), truncated=True, conf=0.75)
    dets, _ = fuse_detections([left, right], 0.55, 0.75)
    assert len(dets) == 1
    b = dets[0]["bbox"]
    assert (b["x1"], b["x2"]) == (100, 300)


def test_fusion_never_inflates_confidence_beyond_what_the_model_reported():
    """Agreement between passes is evidence, not a new score. Summing would
    fabricate confidence — and confidence drives alerting."""
    items = [_item((100, 100, 200, 200), conf=0.6),
             _item((101, 101, 199, 201), conf=0.55)]
    dets, _ = fuse_detections(items, 0.55, 0.75)
    assert dets[0]["confidence"] == pytest.approx(0.6)


def test_vehicle_class_flip_between_scales_does_not_duplicate():
    """The detector labels the same van 'car' at one scale and 'truck' at
    another. Exact-class-only fusion would leave two boxes on one vehicle."""
    items = [_item((100, 100, 300, 250), cls="car", conf=0.7),
             _item((102, 98, 298, 252), cls="truck", conf=0.65)]
    dets, _ = fuse_detections(items, 0.55, 0.75)
    assert len(dets) == 1


def test_person_and_car_at_the_same_place_are_not_fused():
    """Class compatibility must stay narrow: a rider and their motorcycle
    overlap heavily and are two different things to every rule downstream."""
    items = [_item((100, 100, 200, 300), cls="person", conf=0.9),
             _item((100, 150, 200, 320), cls="car", conf=0.8)]
    dets, _ = fuse_detections(items, 0.30, 0.60)
    assert len(dets) == 2


# ---------------------------------------------------------------------------
# Budget, scheduling and degradation
# ---------------------------------------------------------------------------


def test_disabled_engine_runs_exactly_one_pass():
    """Switched off, this must be the old single-pass code path — not a cheaper
    version of the new one. That is what makes the feature safely reversible in
    production via a single POST."""
    frame = _frame()
    backend = FakeBackend([(100, 100, 400, 500, "person", 0.9)])
    set_tiling_settings(enabled=False)

    res = _infer(_engine(), backend, frame)

    assert len(backend.calls) == 1
    assert res.stats["tiles_inferred"] == 0
    assert res.stats["grid"] == 1


def test_zero_budget_degrades_to_one_pass_rather_than_queueing_tiles():
    """The regression this whole design exists to avoid: extra passes must
    vanish when there is no time for them, instead of piling onto a shared
    backend and stalling every camera's overlay."""
    frame = _frame()
    backend = FakeBackend([(100, 100, 400, 500, "person", 0.9)])
    set_tiling_settings(enabled=True, max_grid=5, latency_budget_ms=0.0)

    res = _infer(_engine(), backend, frame)

    assert len(backend.calls) == 1
    assert res.stats["tiles_inferred"] == 0


def test_max_tiles_caps_extra_passes():
    """The operator's hard ceiling is honoured even when the latency budget
    would allow more — an admin setting a limit must get that limit."""
    frame = _frame()
    backend = FakeBackend([(100, 100, 400, 500, "person", 0.9)])
    set_tiling_settings(enabled=True, max_grid=5, max_tiles=2,
                        latency_budget_ms=400.0, roi_boost=False, workers=1)

    engine = _warm(_engine(), backend, frame)
    backend.calls.clear()
    res = _infer(engine, backend, frame)

    assert res.stats["tiles_inferred"] <= 2
    assert len(backend.calls) <= 3  # 1 full-frame + at most 2 tiles


def test_unchanged_tiles_are_served_from_cache_not_re_inferred():
    """A static scene must cost the baseline pass and nothing more. Without
    this the engine would burn its whole budget re-confirming a parked car."""
    frame = _frame()
    backend = FakeBackend([(600, 300, 700, 420, "car", 0.9)])
    set_tiling_settings(enabled=True, max_grid=2, max_tiles=4,
                        latency_budget_ms=400.0, motion_threshold=0.001,
                        cache_ttl_s=5.0, roi_boost=False, workers=1)
    engine = _warm(_engine(), backend, frame)

    backend.calls.clear()
    _infer(engine, backend, frame)          # first budgeted frame: tiles are dirty
    first = len(backend.calls)
    res = _infer(engine, backend, frame)    # identical frame: nothing changed
    second = len(backend.calls) - first

    assert res.stats["tiles_cached"] > 0, "identical frame re-inferred every tile"
    assert second < first, "cache saved no inference at all"


def test_changed_tile_is_re_inferred():
    """The other half of the contract: a tile whose pixels moved must NOT be
    served from cache, or the overlay freezes on stale boxes."""
    frame = _frame()
    backend = FakeBackend([(600, 300, 700, 420, "car", 0.9)])
    set_tiling_settings(enabled=True, max_grid=2, max_tiles=4,
                        latency_budget_ms=400.0, motion_threshold=0.001,
                        cache_ttl_s=5.0, roi_boost=False, workers=1)
    engine = _warm(_engine(), backend, frame)

    _infer(engine, backend, frame)
    before = len(backend.calls)
    frame[0:400, 0:600] = 255           # a large change in the top-left tile
    res = _infer(engine, backend, frame)

    assert res.stats["tiles_inferred"] > 0
    assert len(backend.calls) > before + 1


def test_cached_results_expire():
    """Cache TTL bounds how long a detection can outlive its evidence. Without
    an expiry, a missed departure leaves a ghost box on screen indefinitely."""
    frame = _frame()
    backend = FakeBackend([(600, 300, 700, 420, "car", 0.9)])
    set_tiling_settings(enabled=True, max_grid=2, max_tiles=4,
                        latency_budget_ms=400.0, motion_threshold=0.5,
                        cache_ttl_s=0.0, roi_boost=False, workers=1)
    engine = _warm(_engine(), backend, frame)

    _infer(engine, backend, frame)
    res = _infer(engine, backend, frame)

    assert res.stats["tiles_cached"] == 0, "expired entries were still reused"


def test_more_cameras_shrink_each_camera_s_tile_allowance():
    """The budget is shared because the BACKEND is shared. Eight cameras each
    'staying under budget' individually is eight times the work on one device —
    precisely how the old quadrant code stalled the engine."""
    frame = _frame()
    backend = FakeBackend([(100, 100, 400, 500, "person", 0.9)])
    set_tiling_settings(enabled=True, max_grid=3, max_tiles=8,
                        latency_budget_ms=200.0, roi_boost=False, workers=1)

    solo = _warm(_engine(), backend, frame)
    alone = _infer(solo, backend, frame).stats["budget_tiles"]

    crowd = [_warm(_engine(), backend, frame) for _ in range(8)]
    shared = _infer(solo, backend, frame).stats["budget_tiles"]

    for e in crowd:
        e.close()
    solo.close()
    assert shared < alone, f"budget did not shrink with camera count ({alone} -> {shared})"


def test_stopping_a_camera_returns_its_share_to_the_others():
    """A stopped camera must not keep reserving inference time it will never
    use — otherwise the last camera left running stays throttled forever."""
    frame = _frame()
    backend = FakeBackend([(100, 100, 400, 500, "person", 0.9)])
    set_tiling_settings(enabled=True, max_grid=3, max_tiles=8,
                        latency_budget_ms=200.0, roi_boost=False, workers=1)

    solo = _warm(_engine(), backend, frame)
    others = [_warm(_engine(), backend, frame) for _ in range(6)]
    throttled = _infer(solo, backend, frame).stats["budget_tiles"]
    for e in others:
        e.close()
    restored = _infer(solo, backend, frame).stats["budget_tiles"]
    solo.close()

    assert restored > throttled


def test_a_slow_first_inference_does_not_lock_tiling_off_forever():
    """The cost estimator must not be able to deadlock itself.

    The first inference of a session pays a one-time kernel compile (measured at
    123ms against a warm 82ms on the dev GPU). If that number becomes the
    permanent per-tile estimate, the budget is zero, no tile ever runs, and
    nothing ever measures a tile again — so the estimate never improves. Tiling
    then reports itself enabled and silently does nothing forever, on every
    camera. Found in a live engine run, not in a unit test; this pins it.
    """
    frame = _frame()
    backend = FakeBackend([(100, 100, 400, 500, "person", 0.9)], infer_ms=400.0)
    set_tiling_settings(enabled=True, max_grid=2, max_tiles=4,
                        latency_budget_ms=120.0, roi_boost=False, workers=1,
                        motion_threshold=0.0)
    engine = _engine()

    _infer(engine, backend, frame)              # cold: 400ms "compile" pass
    backend.infer_ms = 30.0                     # warm from here on
    budgets = [_infer(engine, backend, frame).stats["budget_tiles"] for _ in range(6)]

    assert max(budgets) > 0, (
        f"budget never recovered after a slow first pass: {budgets}"
    )


def test_adaptive_resolution_sees_only_the_base_pass_cost():
    """The pipeline steps imgsz down when inference gets slow. Fed the whole
    cycle's cost it would read every added tile as 'the model got slower' and
    ratchet resolution down until the detector is blind — tiling would defeat
    itself. t_inf_base exists to keep that signal clean."""
    frame = _frame()
    backend = FakeBackend([(100, 100, 400, 500, "person", 0.9)])
    set_tiling_settings(enabled=True, max_grid=3, max_tiles=6,
                        latency_budget_ms=400.0, roi_boost=False, workers=1)

    res = _infer(_warm(_engine(), backend, frame), backend, frame)

    assert res.stats["tiles_inferred"] > 0
    assert res.t_inf_base < res.t_inf, "base cost was not separated from the cycle total"


def test_grid_stays_coarse_when_objects_are_already_large():
    """Tiling buys nothing on a camera whose subjects fill a third of the
    frame, and every tile it plans there is inference stolen from a camera that
    needs it."""
    frame = _frame(1280, 720)
    big = (200, 100, 900, 650, "person", 0.95)      # ~40% of the frame
    # Origin-tracking, because this test turns on the engine's feedback loop:
    # the grid is chosen from observed object SIZE, so the tile passes have to
    # report geometrically truthful boxes for that measurement to mean anything.
    backend = OriginTrackingBackend([big], frame)
    set_tiling_settings(enabled=True, max_grid=5, max_tiles=12,
                        latency_budget_ms=400.0, roi_boost=False, workers=1,
                        discovery_interval_s=999.0)
    engine = _engine()

    # Cycle 1 measures inference cost (no budget yet), cycle 2 is the one
    # discovery sweep at full density that every camera runs to find out what
    # is actually in its scene. The steady state is what this test is about.
    _warm(engine, backend, frame)
    _infer(engine, backend, frame, n_tracks=1)
    res = _infer(engine, backend, frame, n_tracks=1)

    assert res.stats["grid"] <= 2, f"planned a {res.stats['grid']}x grid for a huge object"


def test_settings_are_clamped_not_rejected():
    """An admin dragging a slider to an extreme gets the extreme's edge, never
    a camera that stops producing overlays."""
    applied = set_tiling_settings(overlap=0.9, max_grid=99, max_tiles=-5, workers=999)
    assert 0.15 <= applied.overlap <= 0.25
    assert applied.max_grid == 5
    assert applied.max_tiles == 0
    assert applied.workers == 8


def test_parallel_tiles_produce_the_same_result_as_sequential():
    """Concurrency must be an optimisation, not a behaviour change. If worker
    count altered detections, the same scene would be reported differently on
    two machines."""
    frame = _frame(1280, 720)
    objs = [(940, 560, 990, 620, "person", 0.8), (200, 180, 260, 250, "car", 0.85)]
    common = dict(enabled=True, max_grid=3, max_tiles=9, latency_budget_ms=400.0,
                  roi_boost=False, motion_threshold=0.0)

    set_tiling_settings(workers=1, **common)
    b1 = OriginTrackingBackend(objs, frame, min_visible_px=30)
    e1 = _engine()
    seq = _infer(_warm(e1, b1, frame), b1, frame)
    governor.release(e1.camera_id)

    set_tiling_settings(workers=4, **common)
    b2 = OriginTrackingBackend(objs, frame, min_visible_px=30)
    e2 = _engine()
    par = _infer(_warm(e2, b2, frame), b2, frame)
    governor.release(e2.camera_id)

    def key(r):
        return sorted((d["class"], tuple(sorted(d["bbox"].items()))) for d in r.detections)

    assert key(seq) == key(par)


# ---------------------------------------------------------------------------
# v2 - confidence verification (Feature 9) and false-positive filter (10)
# ---------------------------------------------------------------------------


def _temporal(**over):
    from app.ai.tile_temporal import TemporalFusion
    base = dict(temporal_enabled=True, verify_enabled=True, temporal_history_s=5.0,
                temporal_max_carry=2, temporal_smoothing=0.0, temporal_iou=0.3,
                verify_accept_conf=0.95, verify_second_pass_conf=0.80,
                verify_history_conf=0.60, verify_min_hits=2,
                fp_motion_validation=False, fp_neighbour_agreement=True)
    base.update(over)
    return TemporalFusion(), set_tiling_settings(**base)


def _d(box, cls="person", conf=0.9):
    x1, y1, x2, y2 = box
    return {"class": cls, "confidence": conf, "track_id": None,
            "bbox": {"x1": x1, "y1": y1, "x2": x2, "y2": y2}}


def test_high_confidence_detection_is_accepted_immediately():
    """Above the accept band there is nothing a second opinion can add, and
    delaying an obvious detection by a frame is latency for its own sake."""
    tf, s = _temporal()
    out, _, _ = tf.update([_d((100, 100, 200, 300), conf=0.97)], [[]],
                          settings=s, now=1000.0)
    assert len(out) == 1


def test_mid_confidence_detection_waits_one_frame_for_corroboration():
    """0.80-0.95 is exactly the band where a second look decides between a
    person and a shadow, so it costs one frame of delay by design."""
    tf, s = _temporal()
    first, _, _ = tf.update([_d((100, 100, 200, 300), conf=0.85)], [[]],
                            settings=s, now=1000.0)
    assert first == [], "mid-confidence detection was emitted with no corroboration"
    second, _, _ = tf.update([_d((100, 100, 200, 300), conf=0.85)], [[]],
                             settings=s, now=1000.05)
    assert len(second) == 1, "corroborated detection never appeared"


def test_single_frame_low_confidence_blob_is_never_emitted():
    """A one-frame low-confidence box is the signature of a compression
    artefact or a moving shadow. Emitting it mints a track id and can raise a
    real alert, so it has to be refused at the source."""
    tf, s = _temporal()
    out, _, stats = tf.update([_d((10, 10, 30, 40), conf=0.35)], [[]],
                              settings=s, now=1000.0)
    assert out == []
    assert stats["suppressed"] == 1


def test_persistent_low_confidence_detection_is_eventually_accepted():
    """Persistence is evidence. Something the model keeps finding in the same
    place across frames is not noise, even at a low score."""
    tf, s = _temporal()
    out = []
    for i in range(6):
        out, _, _ = tf.update([_d((10, 10, 30, 40), conf=0.45)], [[]],
                              settings=s, now=1000.0 + i * 0.05)
    assert len(out) == 1, "a detection present in six consecutive frames was still refused"


def test_single_frame_miss_is_carried_forward_not_dropped():
    """Feature 4. One missed frame must not blink an object off the overlay -
    that flicker is what makes operators distrust the box."""
    tf, s = _temporal()
    for i in range(3):
        tf.update([_d((100, 100, 200, 300), conf=0.9)], [[]], settings=s, now=1000.0 + i * 0.05)
    out, _, stats = tf.update([], [], settings=s, now=1000.20)   # detector missed it
    assert len(out) == 1, "object vanished on a single missed frame"
    assert out[0]["stale"] is True, "carried-forward detection was not flagged stale"
    assert stats["carried"] == 1


def test_carry_forward_is_bounded():
    """A carried detection is an assumption, and it must expire. Without a
    bound, an object that genuinely left would be drawn forever."""
    tf, s = _temporal(temporal_max_carry=2)
    for i in range(3):
        tf.update([_d((100, 100, 200, 300), conf=0.9)], [[]], settings=s, now=1000.0 + i * 0.05)
    out = None
    for i in range(4):
        out, _, _ = tf.update([], [], settings=s, now=1000.2 + i * 0.05)
    assert out == [], "carried-forward detection outlived its bound"


def test_moving_object_does_not_spawn_trailing_ghost_boxes():
    """When an object moves fast across frames, it must not spawn trailing ghost boxes."""
    tf, s = _temporal(temporal_max_carry=3)
    frames = [
        (700, 330, 745, 375),
        (705, 360, 750, 405),
        (705, 390, 750, 435),
        (705, 420, 750, 465),
        (705, 450, 750, 495),
    ]
    for i, box in enumerate(frames):
        out, _, _ = tf.update([_d(box, conf=0.98)], [[]], settings=s, now=1000.0 + i * 0.05)
        assert len(out) == 1, f"Frame {i} spawned {len(out)} boxes instead of 1 on moving object"



def test_box_smoothing_reduces_jitter():
    """A box that snaps to every measurement visibly buzzes on a stationary
    object. Smoothing is what makes the overlay look stable."""
    tf, s = _temporal(temporal_smoothing=0.6, verify_enabled=False)
    tf.update([_d((100, 100, 200, 300), conf=0.9)], [[]], settings=s, now=1000.0)
    out, _, _ = tf.update([_d((140, 100, 240, 300), conf=0.9)], [[]], settings=s, now=1000.05)
    x1 = out[0]["bbox"]["x1"]
    assert 100 < x1 < 140, "box snapped to the raw measurement instead of easing (%s)" % x1


def test_temporal_disabled_is_a_passthrough():
    """Every optimization must be independently switchable (Feature 15), and
    'off' has to mean genuinely untouched output."""
    tf, s = _temporal(temporal_enabled=False)
    dets = [_d((100, 100, 200, 300), conf=0.4)]
    out, masks, _ = tf.update(dets, [[]], settings=s, now=1000.0)
    assert out is dets


# ---------------------------------------------------------------------------
# v2 - resource governor (Features 11 + 12)
# ---------------------------------------------------------------------------


def test_governor_gives_a_busy_camera_more_than_an_idle_one():
    """Feature 12. Equal division spends budget where nothing is happening;
    the point of weighting is that the gate camera outbids the empty corridor."""
    s = set_tiling_settings(governor_mode="auto", latency_budget_ms=400.0, max_tiles=8)
    governor._cameras.clear()
    for _ in range(4):
        governor.allocate("busy", activity=1.0, settings=s)
        governor.allocate("idle", activity=0.0, settings=s)
    busy = governor.allocate("busy", activity=1.0, settings=s)
    idle = governor.allocate("idle", activity=0.0, settings=s)
    governor._cameras.clear()
    assert busy.budget_ms > idle.budget_ms


def test_governor_latency_mode_reproduces_equal_division():
    """v1 behaviour must stay reachable: it is the fallback if the closed loop
    ever misbehaves on unfamiliar hardware."""
    s = set_tiling_settings(governor_mode="latency", latency_budget_ms=400.0, max_tiles=8)
    governor._cameras.clear()
    governor.allocate("a", activity=1.0, settings=s)
    governor.allocate("b", activity=0.0, settings=s)
    a = governor.allocate("a", activity=1.0, settings=s)
    b = governor.allocate("b", activity=0.0, settings=s)
    governor._cameras.clear()
    assert a.budget_ms == pytest.approx(b.budget_ms), "latency mode is not equal division"
    assert a.budget_ms == pytest.approx(200.0)


def test_governor_off_allocates_nothing():
    s = set_tiling_settings(governor_mode="off")
    governor._cameras.clear()
    alloc = governor.allocate("x", activity=1.0, settings=s)
    governor._cameras.clear()
    assert alloc.max_tiles == 0 and alloc.budget_ms == 0.0


def test_unreadable_device_signals_do_not_throttle():
    """gpu_monitor returns None for VRAM and temperature on Intel/AMD (no
    vendor SDK). Treating unknown as 'saturated' would throttle every non-NVIDIA
    deployment to single-pass on missing data, which is most of the fleet."""
    from app.ai.tile_governor import ResourceGovernor
    g = ResourceGovernor()
    assert g._pressure_factor(None, 70.0, 95.0) is None
    g._probe_cache = {"percent": 10.0, "mem_percent": None, "temp_c": None, "cpu": None}
    g._last_probe = time.time()
    assert g._update_headroom() > 0.9


def test_governor_withdraws_budget_as_device_pressure_rises():
    from app.ai.tile_governor import ResourceGovernor
    g = ResourceGovernor()
    g._probe_cache = {"percent": 99.0, "mem_percent": None, "temp_c": None, "cpu": 99.0}
    g._last_probe = time.time()
    h = 1.0
    for _ in range(20):          # let the slew limit converge
        h = g._update_headroom()
    assert h < 0.2, "headroom stayed at %s with the device pinned" % h


def test_headroom_changes_are_slew_limited():
    """The GPU sample is up to 5s stale by construction. Without a slew limit
    the loop reads stale 'busy', cuts to zero, reads stale 'idle', opens fully -
    and the operator watches detections visibly pulse."""
    from app.ai.tile_governor import ResourceGovernor
    g = ResourceGovernor()
    g._probe_cache = {"percent": 100.0, "mem_percent": None, "temp_c": None, "cpu": None}
    g._last_probe = time.time()
    first = g._update_headroom()
    assert first >= 1.0 - 0.16, "headroom jumped straight to %s in one step" % first


# ---------------------------------------------------------------------------
# v2 - layout, resolution, priority
# ---------------------------------------------------------------------------


def test_overlap_widens_as_the_grid_gets_finer():
    """A fixed FRACTION is a narrower band in pixels at a finer grid, so an
    object that fitted the 2x2 overlap gets cut at 5x5 unless it scales."""
    eng = _engine()
    s = set_tiling_settings(adaptive_layout=True, overlap=0.2)
    assert eng._choose_overlap(s, 5) > eng._choose_overlap(s, 2)


def test_adaptive_layout_off_uses_the_configured_overlap_exactly():
    eng = _engine()
    s = set_tiling_settings(adaptive_layout=False, overlap=0.18)
    assert eng._choose_overlap(s, 5) == pytest.approx(0.18)


def test_multi_resolution_picks_from_the_fine_ladder():
    """Feature 8. Without the fine ladder a 700px tile jumps to a 960 tensor
    and pays 2.8x the 640 cost; 768 is the size that fits it."""
    from app.ai.tiling import _pick_imgsz, shape_ladder
    fine = shape_ladder(set_tiling_settings(multi_resolution=True))
    coarse = shape_ladder(set_tiling_settings(multi_resolution=False))
    assert _pick_imgsz(700, 1280, 320, ladder=fine) == 768
    assert _pick_imgsz(700, 1280, 320, ladder=coarse) == 960


def test_priority_prefers_an_operator_zone_over_equal_motion():
    """Feature 6. When the budget affords 2 of 9 tiles, they must be the
    restricted zone and the gate, not whichever two have the most leaf motion."""
    eng = _engine()
    s = set_tiling_settings(priority_enabled=True, priority_zone_weight=2.0,
                            priority_motion_weight=1.0)
    eng.set_priority_regions([{"points": [[0.0, 0.0], [0.3, 0.3]], "weight": 2.0}])
    now = time.time()
    inside = eng._tile_priority((0, 0, 300, 300), 0.01, s, 1280, 720, now)
    outside = eng._tile_priority((900, 400, 1280, 720), 0.01, s, 1280, 720, now)
    assert inside > outside


def test_recent_alert_raises_a_tile_s_priority():
    """Somewhere that just produced an alert is where losing the object next
    costs the most."""
    eng = _engine()
    s = set_tiling_settings(priority_enabled=True, priority_alert_weight=3.0,
                            priority_motion_weight=1.0)
    before = eng._tile_priority((0, 0, 300, 300), 0.01, s, 1280, 720, time.time())
    eng.note_alert(0.1, 0.2)
    after = eng._tile_priority((0, 0, 300, 300), 0.01, s, 1280, 720, time.time())
    assert after > before


def test_priority_disabled_falls_back_to_pure_motion():
    eng = _engine()
    s = set_tiling_settings(priority_enabled=False, priority_motion_weight=2.0)
    eng.set_priority_regions([{"points": [[0.0, 0.0], [0.3, 0.3]], "weight": 5.0}])
    got = eng._tile_priority((0, 0, 300, 300), 0.5, s, 1280, 720, time.time())
    assert got == pytest.approx(1.0)


def test_lighting_change_invalidates_the_whole_cache():
    """Feature 3. Every cached crop describes pixels at the OLD exposure;
    reusing them across an IR cut-over is how a cache turns into ghosts."""
    frame = _frame()
    backend = FakeBackend([(600, 300, 700, 420, "car", 0.9)])
    set_tiling_settings(enabled=True, max_grid=2, max_tiles=4, latency_budget_ms=400.0,
                        cache_ttl_s=5.0, roi_boost=False, workers=1,
                        lighting_guard=True, lighting_delta=5.0,
                        verify_enabled=False, temporal_enabled=False)
    engine = _warm(_engine(), backend, frame)
    _infer(engine, backend, frame)
    assert engine._cache, "nothing was cached to begin with"

    frame[:, :] = 200                       # scene-wide illumination step
    res = _infer(engine, backend, frame)
    assert res.stats.get("lighting_reset") is True
    assert res.stats["tiles_cached"] == 0, "stale-exposure crops were reused"


def test_settings_v2_are_clamped():
    applied = set_tiling_settings(zoom_max_depth=99, max_imgsz_cap=99999,
                                  governor_mode="nonsense", temporal_smoothing=5.0)
    assert applied.zoom_max_depth == 3
    assert applied.max_imgsz_cap == 1280
    # An unrecognised mode must fall back to the SAFE path, not the clever one.
    assert applied.governor_mode == "latency"
    assert applied.temporal_smoothing == pytest.approx(0.9)


def test_recursive_zoom_descends_and_is_depth_bounded():
    """Feature 2. Each level re-runs a tighter crop so the object gets more of
    the model's fixed input budget - real detail from the source frame, never
    generated pixels. Depth must be bounded or one uncertain object could
    consume the entire cycle."""
    frame = _frame(1280, 720)
    obj = (600, 300, 640, 350, "person", 0.5)      # small and uncertain
    backend = OriginTrackingBackend([obj], frame)
    set_tiling_settings(enabled=True, max_grid=2, max_tiles=8, latency_budget_ms=600.0,
                        roi_boost=True, roi_boost_max=1, workers=1,
                        zoom_enabled=True, zoom_max_depth=2, second_pass_conf=0.9,
                        verify_enabled=False, temporal_enabled=False,
                        edge_expansion=False)
    engine = _warm(_engine(), backend, frame)
    res = _infer(engine, backend, frame)
    assert res.stats["boost_passes"] >= 1, "recursive zoom never ran"
    assert res.stats["boost_passes"] <= 3, "zoom exceeded its depth bound"


def test_zoom_disabled_runs_a_single_boost_level():
    frame = _frame(1280, 720)
    obj = (600, 300, 640, 350, "person", 0.5)
    backend = OriginTrackingBackend([obj], frame)
    set_tiling_settings(enabled=True, max_grid=2, max_tiles=8, latency_budget_ms=600.0,
                        roi_boost=True, roi_boost_max=1, workers=1,
                        zoom_enabled=False, second_pass_conf=0.9,
                        verify_enabled=False, temporal_enabled=False,
                        edge_expansion=False)
    engine = _warm(_engine(), backend, frame)
    res = _infer(engine, backend, frame)
    assert res.stats["boost_passes"] <= 1


def test_engine_still_never_modifies_the_frame_with_every_v2_stage_on():
    """Feature 14, re-asserted against the full v2 path. Recursive zoom, edge
    expansion and the priority scheduler all take crops; not one of them may
    write a pixel back into the operator's video."""
    rng = np.random.default_rng(11)
    frame = rng.integers(0, 255, (720, 1280, 3), dtype=np.uint8)
    original = frame.copy()
    backend = FakeBackend([(100, 100, 400, 500, "person", 0.55),
                           (900, 200, 940, 260, "car", 0.45)])
    set_tiling_settings(enabled=True, max_grid=3, max_tiles=9, latency_budget_ms=800.0,
                        workers=2, zoom_enabled=True, zoom_max_depth=2,
                        edge_expansion=True, roi_boost=True, temporal_enabled=True,
                        verify_enabled=True, priority_enabled=True)
    eng = _engine()
    for _ in range(3):
        _infer(eng, backend, frame)
    eng.close()
    assert np.array_equal(frame, original), "a v2 stage wrote into the video frame"


# ---------------------------------------------------------------------------
# v2 - feedback-loop regressions (both found in live runs, not in unit tests)
# ---------------------------------------------------------------------------


def test_layout_feedback_uses_raw_detections_not_filtered_output():
    """The starvation spiral this pins:

    verification suppresses exactly the small, low-confidence detections that
    tiling exists to find. Feed the FILTERED set back into the layout decision
    and the surviving objects are the big confident ones, so measured median
    object size grows, the grid collapses to 1x1, tiles stop running, and the
    small objects are never found again. Measured on real video: detections
    fell to 4.29/frame against a 4.43 no-tiling baseline - the feature made
    accuracy WORSE while reporting itself enabled and healthy.

    The layout must be told what the model can SEE, not what policy emitted.
    """
    frame = _frame(1280, 720)
    # Small objects, scored in the band verification refuses on sight.
    objs = [(300 + i * 90, 400, 320 + i * 90, 430, "person", 0.45) for i in range(4)]
    backend = OriginTrackingBackend(objs, frame)
    set_tiling_settings(enabled=True, max_grid=3, max_tiles=9, latency_budget_ms=800.0,
                        workers=1, roi_boost=False, edge_expansion=False,
                        governor_mode="latency",
                        temporal_enabled=True, verify_enabled=True)
    eng = _warm(_engine(), backend, frame)

    grids = []
    for _ in range(6):
        grids.append(_infer(eng, backend, frame).stats["grid"])

    assert max(grids) > 1, (
        f"grid collapsed to 1x1 and never recovered ({grids}) - the layout is "
        f"being driven by the filtered output again"
    )


def test_expensive_zoom_is_skipped_when_the_budget_cannot_afford_it():
    """A pass count is not a budget once passes run at different resolutions.

    Measured on this hardware a 1024 pass costs 332ms against 89ms at 640, so
    'one spare pass' is anywhere between 89ms and 478ms. A live run produced
    587ms p95 frames because recursive zoom picked a large input size and
    nothing checked the cost first - the overlay went late for every object in
    order to be slightly more certain about one.
    """
    eng = _engine()
    # Pretend 1024 is known to be very expensive and 640 cheap.
    eng._cost_by_imgsz = {640: 90.0}
    cheap = eng._predict_ms(640, 90.0)
    dear = eng._predict_ms(1024, 90.0)
    assert dear > cheap * 3, "cost model does not reflect the measured ladder"

    frame = _frame(1280, 720)
    backend = FakeBackend([(600, 300, 640, 350, "person", 0.5)], infer_ms=300.0)
    set_tiling_settings(enabled=True, max_grid=2, max_tiles=8, latency_budget_ms=120.0,
                        workers=1, roi_boost=True, roi_boost_max=2,
                        zoom_enabled=True, zoom_max_depth=2, second_pass_conf=0.9,
                        verify_enabled=False, temporal_enabled=False,
                        edge_expansion=False, governor_mode="latency")
    e2 = _warm(_engine(), backend, frame)
    res = _infer(e2, backend, frame)
    # 120ms of budget against a 300ms pass: nothing extra may run.
    assert res.stats["boost_passes"] == 0, "an unaffordable zoom pass ran anyway"


def test_engine_own_cpu_load_does_not_throttle_it_to_a_standstill():
    """Self-starvation loop, found live.

    psutil reports SYSTEM-WIDE cpu, and the engine's own preprocessing is
    CPU-bound - so the tile engine is most of the load it would be reading.
    With an 80/97 band a live run went: tiling runs -> cpu 95% -> headroom
    1.0 -> 0.16 -> tiling stops -> cpu falls -> tiling restarts. High CPU
    caused BY doing the work is success, not pressure.
    """
    from app.ai.tile_governor import ResourceGovernor
    g = ResourceGovernor()
    # The governor must measure EXTERNAL cpu: system total minus our own share.
    # Here the box reads ~99% but nearly all of it is this process working.
    import psutil
    cores = psutil.cpu_count() or 1
    ext = g._external_cpu()
    assert ext is None or ext <= 100.0

    # GPU comfortable; external CPU low because the load is ours.
    g._probe_cache = {"percent": 45.0, "mem_percent": None, "temp_c": None, "cpu": 20.0}
    g._last_probe = time.time()
    h = 1.0
    for _ in range(20):
        h = g._update_headroom()
    assert h > 0.8, f"engine throttled itself to {h} on CPU load it created"


def test_saturated_gpu_still_throttles():
    """The other side of the same coin: relaxing the CPU band must not make the
    governor toothless. A pinned GPU is real contention and must still bite."""
    from app.ai.tile_governor import ResourceGovernor
    g = ResourceGovernor()
    g._probe_cache = {"percent": 99.0, "mem_percent": None, "temp_c": None, "cpu": 30.0}
    g._last_probe = time.time()
    h = 1.0
    for _ in range(20):
        h = g._update_headroom()
    assert h < 0.2, f"a pinned GPU left headroom at {h}"


def test_extra_stages_get_a_reserved_share_of_the_budget():
    """Recursive zoom and edge expansion were structurally unreachable.

    The tile scheduler takes `scored[:budget]` - everything it is handed - so a
    leftover-based spare is always zero whenever any tile is dirty, which on a
    moving scene is every frame. Verified on real video at a 900ms budget: both
    stages reported exactly 0 passes and could never have run. Reserving part of
    the allowance up front is what makes them reachable at all.
    """
    frame = _frame(1280, 720)
    obj = (600, 300, 640, 350, "person", 0.5)
    backend = OriginTrackingBackend([obj], frame)
    set_tiling_settings(enabled=True, max_grid=3, max_tiles=9, latency_budget_ms=900.0,
                        workers=1, governor_mode="latency",
                        roi_boost=True, roi_boost_max=2, zoom_enabled=True,
                        zoom_max_depth=2, second_pass_conf=0.9,
                        edge_expansion=False, verify_enabled=False,
                        temporal_enabled=False)
    eng = _warm(_engine(), backend, frame)
    res = _infer(eng, backend, frame)

    assert res.stats["reserve"] > 0, "no budget was reserved for the extra stages"
    assert res.stats["tile_budget"] < res.stats["budget_tiles"], (
        "the tile stage was still handed the entire budget"
    )
    assert res.stats["boost_passes"] > 0, "recursive zoom is still unreachable"


def test_edge_expansion_defaults_off():
    """Measured to cost more coverage than it returns: 5.00 -> 4.92
    detections/frame on real video, and 5.48 -> 4.96 when combined with
    recursive zoom, because it competes with the tile stage for the same budget
    while duplicating what fusion already reassembles geometrically.

    Kept available and switchable - this pins the DEFAULT, so re-enabling it is
    a deliberate act rather than something that drifts back on.
    """
    from app.ai.tiling import TilingSettings
    assert TilingSettings.__dataclass_fields__["edge_expansion"].default is False



def test_external_cpu_excludes_this_process():
    """The governor must not read its own work as external pressure.

    _external_cpu differences RAW cpu-time counters over its own window and
    subtracts this process's share. Without the subtraction the engine reads its
    own preprocessing as "the machine is busy" and throttles itself - observed
    twice live, collapsing headroom to 0.16 and then to 0.0.

    Driven with synthetic counters rather than by burning real CPU: the quantity
    under test is the arithmetic, and a test that races a live machine against
    itself is a coin flip (the first version of this test failed ~1 run in 3).
    """
    from app.ai.tile_governor import ResourceGovernor

    class _FakeTimes:
        def __init__(self, user, system):
            self.user, self.system = user, system

        def _asdict(self):
            return {"user": self.user, "system": self.system, "idle": 0.0}

    class _FakeProc:
        def __init__(self, secs):
            self.secs = secs

        def cpu_times(self):
            return _FakeTimes(self.secs, 0.0)

    g = ResourceGovernor()
    cores = 4
    # 1s of wall time on 4 cores = 4 core-seconds of capacity.
    # System burned 3.2 core-seconds (80%); 3.0 of them were ours (75%).
    g._proc = _FakeProc(0.0)
    g._cpu_prev = (time.time() - 1.0, 0.0, 0.0)

    import app.ai.tile_governor as tg
    real_psutil = __import__("psutil")
    orig_times, orig_count = real_psutil.cpu_times, real_psutil.cpu_count
    try:
        real_psutil.cpu_times = lambda: _FakeTimes(3.2, 0.0)
        real_psutil.cpu_count = lambda: cores
        g._proc = _FakeProc(3.0)
        external = g._external_cpu()
    finally:
        real_psutil.cpu_times, real_psutil.cpu_count = orig_times, orig_count

    assert external is not None
    # (3.2 - 3.0) / 4.0 core-seconds = 5% left for everyone else.
    assert external == pytest.approx(5.0, abs=0.6), (
        f"expected ~5% external cpu, got {external} - own-process share is not "
        f"being subtracted"
    )


def test_external_cpu_needs_two_samples():
    """A single counter reading says nothing; the first call only establishes a
    baseline. Returning a number there would report a whole-uptime average as
    if it were current load."""
    from app.ai.tile_governor import ResourceGovernor
    g = ResourceGovernor()
    assert g._external_cpu() is None


def test_discovery_sweep_still_runs_when_objects_are_being_tracked():
    """The grid decision is bistable, and this is the only escape hatch.

    Tiling finds small objects -> measured median size drops -> grid stays fine
    -> it keeps finding them. Equally, a camera that starts at grid 1 sees only
    large objects -> median stays high -> it never engages. The periodic
    discovery sweep is what breaks the second state, and gating it on
    `n_tracks == 0` meant a camera with anything in frame could never run one -
    exactly the busy scene that matters. Identical settings on identical video
    gave 5.71, 5.29 and 4.49 detections/frame across runs depending on whether
    the loop happened to catch.
    """
    eng = _engine()
    s = set_tiling_settings(enabled=True, max_grid=3, min_grid=1,
                            discovery_interval_s=0.0, small_object_frac=0.01)
    # Convince the engine every object is huge, so the size branch says grid 1.
    eng._median_area_frac = 0.5
    # ... and give it plenty of tracks, i.e. a busy scene.
    grid = eng._choose_grid(s, budget_tiles=8, n_tracks=5, now=time.time())
    assert grid > 1, "a busy camera can never run a discovery sweep"


def test_discovery_sweep_is_periodic_not_every_frame():
    """It is a probe, not the steady state - sweeping at max density every
    frame would spend the whole budget rediscovering a scene it already knows."""
    eng = _engine()
    s = set_tiling_settings(enabled=True, max_grid=3, min_grid=1,
                            discovery_interval_s=30.0, small_object_frac=0.01)
    eng._median_area_frac = 0.5
    now = time.time()
    first = eng._choose_grid(s, budget_tiles=8, n_tracks=5, now=now)
    second = eng._choose_grid(s, budget_tiles=8, n_tracks=5, now=now + 0.05)
    assert first > 1, "the first sweep did not happen"
    assert second == 1, "every frame is running a discovery sweep"
