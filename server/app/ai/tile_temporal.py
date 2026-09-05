"""Temporal detection fusion, confidence verification, and false-positive
filtering for the tile engine.

Everything here operates on a SHORT history of recent frames for one camera and
runs before the detections reach the tracker.

WHY THIS SITS BEFORE THE TRACKER, NOT INSIDE IT
-----------------------------------------------
The pipeline already has a strong tracker (ByteTracker: Kalman prediction,
Hungarian association, appearance re-identification, and a lost gallery that
revives a track's ORIGINAL id after a long occlusion). This module deliberately
does NOT re-implement any of that — a second predictive tracker fighting the
first over the same objects would produce exactly the duplicate-box class of bug
this codebase has already hit twice.

What it does instead is fix things the tracker cannot, because by the time the
tracker sees a frame the damage is done:

  * A detection the model missed for ONE frame is a gap the tracker has to coast
    through; carrying it forward from history closes the gap at the source.
  * A box that jitters a few pixels per frame makes an overlay visibly shake.
    Smoothing it here fixes the overlay without touching track dynamics.
  * A one-frame false positive mints a track id, which drags a real alert with
    it. Refusing to emit it is much cheaper than deleting its consequences.

Tiling raises the stakes on all three: more passes over the same scene means
more chances for a marginal detection to flicker in and out.

Nothing here invents an object. A carried-forward detection is one the model
genuinely produced within the history window, re-emitted at its last measured
position and explicitly marked `stale` so downstream can tell.
"""

import time
from collections import deque
from dataclasses import dataclass
from typing import Dict, List, Optional

from app.analytics import VEHICLE_CLASSES


def _xyxy(det):
    b = det["bbox"]
    return float(b["x1"]), float(b["y1"]), float(b["x2"]), float(b["y2"])


def _iou(a, b) -> float:
    ix1, iy1 = max(a[0], b[0]), max(a[1], b[1])
    ix2, iy2 = min(a[2], b[2]), min(a[3], b[3])
    iw, ih = max(0.0, ix2 - ix1), max(0.0, iy2 - iy1)
    inter = iw * ih
    if inter <= 0:
        return 0.0
    aa = max(1.0, (a[2] - a[0]) * (a[3] - a[1]))
    bb = max(1.0, (b[2] - b[0]) * (b[3] - b[1]))
    return inter / (aa + bb - inter)


def _compatible(a: str, b: str) -> bool:
    return a == b or (a in VEHICLE_CLASSES and b in VEHICLE_CLASSES)


@dataclass(eq=False)
class _Obs:
    """One object's running record across the history window.

    eq=False so these hash and compare by IDENTITY. Two different objects can
    legitimately hold identical field values (same class, same confidence, boxes
    that momentarily coincide), and value-equality would let the matcher treat
    them as one record — besides making the dataclass unhashable and unusable in
    the "already matched this frame" set.
    """
    box: tuple
    cls: str
    conf: float
    first_seen: float
    last_seen: float
    hits: int = 1               # frames this object was actually detected in
    misses: int = 0             # consecutive frames since it was last detected
    emitted: bool = False       # has it ever passed verification
    mask: list = None
    # Most independent inference passes that ever agreed on this object in one
    # frame (fuse_detections' cluster size). Overlapping tiles mean a real
    # object in an overlap band is found more than once, so >1 is corroboration
    # from a different view — not the same evidence counted twice.
    passes: int = 1


class TemporalFusion:
    """Per-camera. Fuses detections across frames, verifies confidence against
    history, and suppresses unstable ones."""

    def __init__(self):
        self._obs: List[_Obs] = []
        self._frames = deque(maxlen=64)   # timestamps, for rate estimation

    def reset(self) -> None:
        self._obs.clear()

    def update(self, detections, masks, *, settings, motion_map=None,
               frame_wh=None, now=None):
        """Fold this frame's detections into history and return what to emit.

        Returns (detections, masks, stats). Detections carried forward from a
        previous frame carry `"stale": True` so nothing downstream mistakes
        them for a fresh measurement.
        """
        now = now or time.time()
        self._frames.append(now)

        if not getattr(settings, "temporal_enabled", True):
            return detections, masks, {"temporal": "off"}

        history_s = float(getattr(settings, "temporal_history_s", 0.5))
        max_carry = int(getattr(settings, "temporal_max_carry", 4))
        smooth = float(getattr(settings, "temporal_smoothing", 0.15))

        matched_obs = set()
        stats = {"carried": 0, "suppressed": 0, "new": 0, "smoothed": 0}

        # --- 1. Associate this frame's detections with existing observations
        for i, det in enumerate(detections):
            box = _xyxy(det)
            bw = max(1.0, box[2] - box[0])
            bh = max(1.0, box[3] - box[1])
            bcx = (box[0] + box[2]) / 2.0
            bcy = (box[1] + box[3]) / 2.0
            bdiag = (bw * bw + bh * bh) ** 0.5

            best, best_score = None, 0.0
            for ob in self._obs:
                if ob in matched_obs or not _compatible(ob.cls, det["class"]):
                    continue
                v = _iou(ob.box, box)
                ow = max(1.0, ob.box[2] - ob.box[0])
                oh = max(1.0, ob.box[3] - ob.box[1])
                ocx = (ob.box[0] + ob.box[2]) / 2.0
                ocy = (ob.box[1] + ob.box[3]) / 2.0
                odiag = (ow * ow + oh * oh) ** 0.5
                cdist = ((bcx - ocx) ** 2 + (bcy - ocy) ** 2) ** 0.5
                max_reach = max(bdiag, odiag) * 1.6

                score = 0.0
                if v >= float(getattr(settings, "temporal_iou", 0.3)):
                    score = 2.0 + v
                elif v > 0.05 and cdist <= max_reach:
                    score = 1.0 + v
                elif cdist <= max_reach and (0.35 <= bw / ow <= 2.8) and (0.35 <= bh / oh <= 2.8):
                    # Proximity match for moving object whose box shifted across frame interval
                    score = 0.5 * (1.0 - cdist / max_reach)

                if score > best_score:
                    best, best_score = ob, score

            if best is not None and best_score > 0.0:
                matched_obs.add(best)
                # Dynamic velocity-adaptive smoothing:
                # Stationary/slow objects (disp < 12px) get smoothing to prevent overlay buzzing.
                # Fast-moving objects (disp >= 12px) reduce smoothing to 0.0 so the box never lags behind!
                if smooth > 0:
                    cx_n, cy_n = (box[0] + box[2]) / 2.0, (box[1] + box[3]) / 2.0
                    cx_o, cy_o = (best.box[0] + best.box[2]) / 2.0, (best.box[1] + best.box[3]) / 2.0
                    disp = ((cx_n - cx_o) ** 2 + (cy_n - cy_o) ** 2) ** 0.5
                    eff_smooth = smooth if disp < 12.0 else max(0.0, smooth * (1.0 - min(1.0, (disp - 12.0) / 40.0)))
                    a = 1.0 - eff_smooth
                    best.box = tuple(a * n + eff_smooth * o for n, o in zip(box, best.box))
                    stats["smoothed"] += 1
                else:
                    best.box = box
                best.conf = max(det["confidence"], 0.7 * best.conf + 0.3 * det["confidence"])
                best.cls = det["class"]
                best.last_seen = now
                best.hits += 1
                best.misses = 0
                best.passes = max(best.passes, int(det.get("_passes", 1)))
                best.mask = masks[i] if i < len(masks) else []
            else:
                self._obs.append(_Obs(
                    box=box, cls=det["class"], conf=float(det["confidence"]),
                    first_seen=now, last_seen=now,
                    passes=int(det.get("_passes", 1)),
                    mask=masks[i] if i < len(masks) else [],
                ))
                stats["new"] += 1

        # --- 2. Age everything that was not seen this frame
        fresh_boxes = [(_xyxy(d), d["class"]) for d in detections]
        surviving_obs = []
        for ob in self._obs:
            if ob.last_seen != now:
                ob.misses += 1
                # If a fresh detection of compatible class is nearby in its motion corridor,
                # the object has moved! The old position is superseded and must not linger as a ghost.
                ocx = (ob.box[0] + ob.box[2]) / 2.0
                ocy = (ob.box[1] + ob.box[3]) / 2.0
                ow = max(1.0, ob.box[2] - ob.box[0])
                oh = max(1.0, ob.box[3] - ob.box[1])
                max_move = max(ow, oh) * 2.5
                superseded = any(
                    _compatible(ob.cls, fcls) and (((ocx - (fb[0] + fb[2]) / 2.0) ** 2 + (ocy - (fb[1] + fb[3]) / 2.0) ** 2) ** 0.5 <= max_move)
                    for fb, fcls in fresh_boxes
                )
                if superseded:
                    continue

            if (now - ob.last_seen) <= history_s and ob.misses <= max_carry:
                surviving_obs.append(ob)
        self._obs = surviving_obs

        # --- 3. Verify and emit
        out_dets, out_masks = [], []
        for ob in self._obs:
            verdict = self._verify(ob, settings, now, motion_map, frame_wh)
            if verdict == "reject":
                stats["suppressed"] += 1
                continue
            fresh = ob.last_seen == now
            if not fresh:
                # Never emit carried forward ghost if any fresh detection of compatible class exists nearby
                ocx = (ob.box[0] + ob.box[2]) / 2.0
                ocy = (ob.box[1] + ob.box[3]) / 2.0
                ow = max(1.0, ob.box[2] - ob.box[0])
                oh = max(1.0, ob.box[3] - ob.box[1])
                max_move = max(ow, oh) * 2.5
                has_nearby_fresh = any(
                    _compatible(ob.cls, fcls) and (((ocx - (fb[0] + fb[2]) / 2.0) ** 2 + (ocy - (fb[1] + fb[3]) / 2.0) ** 2) ** 0.5 <= max_move)
                    for fb, fcls in fresh_boxes
                )
                if has_nearby_fresh:
                    continue

                stats["carried"] += 1
            ob.emitted = True
            x1, y1, x2, y2 = ob.box
            out_dets.append({
                "class": ob.cls,
                "confidence": round(float(ob.conf), 4),
                "bbox": {"x1": int(round(x1)), "y1": int(round(y1)),
                         "x2": int(round(x2)), "y2": int(round(y2))},
                "track_id": None,
                "stale": not fresh,
            })
            out_masks.append(ob.mask or [])

        stats["tracked_objects"] = len(self._obs)
        return out_dets, out_masks, stats

    # ------------------------------------------------------------------
    # Confidence verification (Feature 9) + false-positive filter (Feature 10)
    # ------------------------------------------------------------------

    def _verify(self, ob: _Obs, settings, now: float, motion_map, frame_wh) -> str:
        """"accept" or "reject" for one observation.

        The bands come straight from the spec, and the reason they are BANDS
        rather than one threshold is that confidence means different things at
        different levels: a 0.97 detection is not usefully improved by more
        evidence, while a 0.5 one is exactly the case where a second opinion
        decides whether it is a person or a shadow.
        """
        if not getattr(settings, "verify_enabled", True):
            return "accept"

        if ob.cls.startswith("TARGET:") or getattr(ob, "custom_match", False):
            return "accept"

        hi = float(getattr(settings, "verify_accept_conf", 0.50))
        mid = float(getattr(settings, "verify_second_pass_conf", 0.35))
        lo = float(getattr(settings, "verify_history_conf", 0.20))
        min_hits = int(getattr(settings, "verify_min_hits", 1))

        conf = ob.conf

        # Above the accept band: take it. Demanding corroboration here would
        # delay every obvious detection by a frame for no benefit.
        if conf >= hi:
            return "accept"

        max_carry = int(getattr(settings, "temporal_max_carry", 4))

        # An object already emitted keeps being emitted while carried in history —
        # re-litigating a confirmed object on missed frames is what makes a box flicker/blink.
        if ob.emitted and ob.misses <= max_carry:
            return "accept"

        # Neighbour-tile agreement counts toward corroboration. Two overlapping
        # tiles finding the same object are two genuinely independent looks at
        # it, so they answer the same question a second FRAME would — without
        # costing a frame of delay.
        corroborated = ob.hits
        if getattr(settings, "fp_neighbour_agreement", True) and ob.passes > 1:
            corroborated += ob.passes - 1

        if conf >= mid:
            # Verified band: one look is enough.
            return "accept" if corroborated >= min_hits else "reject"

        if conf >= lo:
            return "accept" if corroborated >= min_hits else "reject"

        # Below the floor: requires at least min_hits.
        if corroborated < min_hits:
            return "reject"

        # Motion validation: something this uncertain must at least coincide
        # with a pixel change. A persistent low-confidence box over completely
        # static pixels is a texture the model keeps misreading the same way —
        # persistence alone would otherwise "confirm" it forever.
        if getattr(settings, "fp_motion_validation", True) and motion_map is not None and frame_wh:
            if not _touches_motion(ob.box, motion_map, frame_wh):
                return "reject"
        return "accept"


def _touches_motion(box, motion_map, frame_wh) -> bool:
    """True if any changed pixel falls inside this box.

    `motion_map` is the engine's downscaled binary change map, so this is a
    handful of array reads, not a per-pixel scan of the frame.
    """
    fw, fh = frame_wh
    mh, mw = motion_map.shape[:2]
    x1 = max(0, min(mw - 1, int(box[0] * mw / max(1, fw))))
    x2 = max(x1 + 1, min(mw, int(box[2] * mw / max(1, fw)) + 1))
    y1 = max(0, min(mh - 1, int(box[1] * mh / max(1, fh))))
    y2 = max(y1 + 1, min(mh, int(box[3] * mh / max(1, fh)) + 1))
    return bool(motion_map[y1:y2, x1:x2].any())


# Neighbour-tile agreement (Feature 10) is NOT computed here.
#
# It arrives on each detection as `_passes`, set by fuse_detections from its
# cluster size — how many independent passes were merged into that object. A
# standalone O(n^2) pairwise scan afterwards would recompute, less accurately,
# what the clustering already established.
