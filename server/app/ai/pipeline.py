import os
os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "rtsp_transport;udp|fflags;nobuffer|flags;low_delay|framedrop;1|max_delay;50000|buffer_size;102400"
import re
import cv2
import time
import json
import traceback
import threading
from collections import deque
import numpy as np
from uuid import uuid4
from app.ai.backend import EngineBackend
from app.ai.tiling import AdaptiveTileEngine
from app.ai.tile_governor import governor
from app.ai import face as face_detect
from app.ai import helmet as helmet_detect
from app.ai import plate as plate_detect
from app.ai import plate_ocr
from app.ai import plate_worker
from app.ai import helmet_worker
from app.ai import stream_resolver
from app import config
from app.storage import insert_alert, insert_history_record
from app.recorder import CCTVRecorder
from app.analytics import (
    CameraAnalytics, VEHICLE_CLASSES, _object_category, _point_in_zone_shape,
    filter_detections_by_user_zones, PROFILE_CLASSES, filter_by_features,
)
from app.config import RECORDINGS_DIR, HELMET_INTERVAL_S, ANPR_INTERVAL_S, TARGET_FPS, MJPEG_MAX_FPS
from app.gpu_monitor import get_gpu_stats

# Lazy scipy import — avoids 200ms startup penalty when tracker isn't needed yet.
_linear_sum_assignment = None


def _get_lsa():
    """Lazy-load scipy's linear_sum_assignment on demand."""
    global _linear_sum_assignment
    if _linear_sum_assignment is None:
        from scipy.optimize import linear_sum_assignment as _f
        _linear_sum_assignment = _f
    return _linear_sum_assignment


def _prewarm_scipy():
    def _load():
        try:
            _get_lsa()
        except Exception:
            pass  # pure prefetch; the real call path surfaces any real failure
    threading.Thread(target=_load, name="scipy-prewarm", daemon=True).start()


_prewarm_scipy()

# FFMPEG capture: low-latency RTSP over TCP, no internal buffering.
os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = (
    "rtsp_transport;tcp|threads;4|fflags;nobuffer|flags;low_delay|framedrop;1|max_delay;500000"
)


def mask_source(src: str) -> str:
    """rtsp://admin:hunter2@10.0.0.5/s1 -> rtsp://admin:***@10.0.0.5/s1

    Capture logs are read by operators, shipped in support bundles and printed
    to the desktop's engine-log panel; a camera's password travels in the
    userinfo of its RTSP URL, so it never goes to stdout in the clear.
    """
    return re.sub(r"://([^:/@]+):([^@]*)@", r"://\1:***@", str(src))






# Process-wide detection confidence floor, synced from org settings via POST /api/detection/confidence.
DEFAULT_CONFIDENCE = 0.25

# Clamp bounds — below 0.10 is noise, above 0.90 is effectively blind.
MIN_CONFIDENCE = 0.10
MAX_CONFIDENCE = 0.90

# Crowded-scene ratio: threshold *= CROWDED_CONF_RATIO when active tracks > CROWDED_TRACK_COUNT.
CROWDED_CONF_RATIO = 0.6
CROWDED_TRACK_COUNT = 5

_confidence_lock = threading.Lock()
_capture_lock = threading.Lock()
_detection_confidence = DEFAULT_CONFIDENCE


def set_detection_confidence(value: float) -> float:
    """Set the process-wide detection floor. Returns the clamped value actually
    applied, so the caller can report what took effect rather than what it asked
    for. Every camera's next AI cycle picks it up — no restart, no re-register."""
    global _detection_confidence
    v = max(MIN_CONFIDENCE, min(MAX_CONFIDENCE, float(value)))
    with _confidence_lock:
        _detection_confidence = v
    return v


def get_detection_confidence() -> float:
    with _confidence_lock:
        return _detection_confidence


def _diagnostic_enabled() -> bool:
    """Read the runtime flag lazily so production hot paths stay silent."""
    return bool(getattr(config, "PIPELINE_DIAGNOSTICS", False))


def _classes_compatible(a: str, b: str) -> bool:
    """Return True if both classes belong to compatible tracking families (vehicles or person/face/target)."""
    if a == b:
        return True
    a_lower, b_lower = str(a).lower(), str(b).lower()
    if a_lower == b_lower:
        return True
    if a in VEHICLE_CLASSES and b in VEHICLE_CLASSES:
        return True
    p_family = ("person", "face", "worker", "customer", "staff")
    a_p = a_lower in p_family or a_lower.startswith("target:") or "target" in a_lower or "vip" in a_lower
    b_p = b_lower in p_family or b_lower.startswith("target:") or "target" in b_lower or "vip" in b_lower
    return a_p and b_p


def _vehicle_classes_compatible(a: str, b: str) -> bool:
    return _classes_compatible(a, b)


# Deterministic, high-contrast BGR colour per class label so every object type
_SNAPSHOT_PALETTE = [
    (66, 66, 244),    # red
    (66, 244, 66),    # green
    (244, 194, 66),   # blue
    (66, 140, 244),   # orange
    (244, 66, 220),   # magenta
    (66, 244, 244),   # yellow
    (200, 120, 66),   # steel blue
    (120, 66, 200),   # purple
]

_CLASS_COLORS = {
    "person":       (66, 66, 244),    # red
    "no_helmet":    (0, 0, 255),      # bright red — the violation
    "helmet":       (66, 244, 66),    # green — compliant
    "number_plate": (66, 140, 244),   # orange
    "motorcycle":   (244, 194, 66),   # blue
    "car":          (244, 220, 66),   # cyan-blue
    "truck":        (200, 66, 200),   # magenta
    "bus":          (66, 244, 244),   # yellow
}


def _class_color(label: str):
    """Stable BGR colour for a class label — fixed for common classes, hashed
    into the palette otherwise."""
    if label in _CLASS_COLORS:
        return _CLASS_COLORS[label]
    return _SNAPSHOT_PALETTE[hash(label) % len(_SNAPSHOT_PALETTE)]


def _draw_snapshot_boxes(frame, detections):
    """Return a COPY of `frame` with a coloured box + label per detection.

    Used for the evidence snapshot sent to Telegram / stored in history so the
    picture actually shows what was detected, one colour per class. Never
    mutates the source frame (that frame is still the live pipeline frame)."""
    annotated = frame.copy()
    h, w = annotated.shape[:2]
    for det in detections:
        b = det.get("bbox")
        if not b:
            continue
        x1 = max(0, min(w - 1, int(b["x1"]))); y1 = max(0, min(h - 1, int(b["y1"])))
        x2 = max(0, min(w - 1, int(b["x2"]))); y2 = max(0, min(h - 1, int(b["y2"])))
        if x2 - x1 < 2 or y2 - y1 < 2:
            continue
        cls = det.get("class", "object")
        color = _class_color(cls)
        cv2.rectangle(annotated, (x1, y1), (x2, y2), color, 2)
        parts = [cls]
        tid = det.get("track_id")
        if tid is not None:
            parts.append(f"#{tid}")
        conf = det.get("confidence")
        if conf is not None:
            parts.append(f"{int(float(conf) * 100)}%")
        if det.get("plate_text"):
            parts.append(str(det["plate_text"]))
        label = " ".join(parts)
        (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1)
        ly = y1 - th - 6 if y1 - th - 6 >= 0 else y1 + 2
        cv2.rectangle(annotated, (x1, ly), (x1 + tw + 6, ly + th + 6), color, -1)
        cv2.putText(annotated, label, (x1 + 3, ly + th + 2),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1, cv2.LINE_AA)
    return annotated


def _draw_normalized_overlay_boxes(frame, client_dets):
    """Draw bounding boxes from client_dets (normalized 0..1 coords) directly onto stream frame."""
    h, w = frame.shape[:2]
    for det in client_dets:
        if float(det.get("confidence", 0.0)) < 0.40:
            continue
        if det.get("tracking_status") == "coasting":
            continue
        b = det.get("bbox")
        if not b:
            continue
        try:
            x1 = max(0, min(w - 1, int(float(b.get("x1", 0)) * w)))
            y1 = max(0, min(h - 1, int(float(b.get("y1", 0)) * h)))
            x2 = max(0, min(w - 1, int(float(b.get("x2", 0)) * w)))
            y2 = max(0, min(h - 1, int(float(b.get("y2", 0)) * h)))
        except (ValueError, TypeError, KeyError):
            continue

        if x2 - x1 < 2 or y2 - y1 < 2:
            continue

        cls = det.get("class", "object")
        color = _class_color(cls)
        cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)

        # Draw corner tick accents
        bw, bh = x2 - x1, y2 - y1
        cs = min(14, max(3, bw // 4), max(3, bh // 4))
        if cs > 2:
            cv2.line(frame, (x1, y1 + cs), (x1, y1), color, 3)
            cv2.line(frame, (x1, y1), (x1 + cs, y1), color, 3)
            cv2.line(frame, (x2 - cs, y1), (x2, y1), color, 3)
            cv2.line(frame, (x2, y1), (x2, y1 + cs), color, 3)
            cv2.line(frame, (x1, y1 + bh - cs), (x1, y1 + bh), color, 3)
            cv2.line(frame, (x1, y1 + bh), (x1 + cs, y1 + bh), color, 3)
            cv2.line(frame, (x2 - cs, y1 + bh), (x2, y1 + bh), color, 3)
            cv2.line(frame, (x2, y1 + bh), (x2, y1 + bh - cs), color, 3)

        parts = [cls]
        tid = det.get("track_id")
        if tid is not None:
            parts.append(f"#{tid:02d}" if isinstance(tid, int) else f"#{tid}")
        conf = det.get("confidence")
        if conf is not None:
            parts.append(f"{int(float(conf) * 100)}%")
        speed = det.get("speed")
        if speed is not None:
            parts.append(f"{int(float(speed))}km/h")
        if det.get("plate_text"):
            parts.append(str(det["plate_text"]))
        label = " ".join(parts)
        (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1)
        ly = y1 - th - 6 if y1 - th - 6 >= 0 else y1 + 2
        cv2.rectangle(frame, (x1, ly), (x1 + tw + 6, ly + th + 6), color, -1)
        cv2.putText(frame, label, (x1 + 3, ly + th + 2),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1, cv2.LINE_AA)
    return frame



# ---------------------------------------------------------------------------
# Kalman Filter + ByteTrack (unchanged)
# ---------------------------------------------------------------------------

# Cadence the motion model's noise terms are tuned for. Velocity state is
REF_DT = 1.0 / 25.0
# Bounds on a single predict step. Below the floor the step is numerically
MIN_DT, MAX_DT = 1e-3, 2.0


class LightweightKalmanFilter:
    def __init__(self, bbox):
        x1, y1, x2, y2 = bbox
        cx = (x1 + x2) / 2.0
        cy = (y1 + y2) / 2.0
        w  = max(1e-4, x2 - x1)
        h  = max(1e-4, y2 - y1)
        a  = w / max(1e-4, h)

        self.state = np.array([cx, cy, a, h, 0, 0, 0, 0], dtype=np.float32)
        self.covariance  = np.eye(8, dtype=np.float32) * 10.0
        # Velocity is px/second, so its prior uncertainty has to be expressed in
        self.covariance[4:, 4:] *= (1.0 / REF_DT) ** 2
        self.transition  = np.eye(8, dtype=np.float32)   # velocity terms set per predict()
        self.measurement = np.zeros((4, 8), dtype=np.float32)
        self.measurement[0,0] = self.measurement[1,1] = 1.0
        self.measurement[2,2] = self.measurement[3,3] = 1.0
        # Process noise as a RATE (per second); predict() scales it by the real
        self._q_pos = 0.05
        self._q_vel = 0.05 / (REF_DT ** 2)
        self.measurement_noise = np.eye(4, dtype=np.float32) * 1.0
        # Memoised get_bbox() result, invalidated whenever `state` changes.
        self._bbox_cache = None

    def predict(self, dt=None):
        dt = REF_DT if dt is None else float(min(MAX_DT, max(MIN_DT, dt)))
        self.transition[0, 4] = self.transition[1, 5] = dt
        self.transition[2, 6] = self.transition[3, 7] = dt
        q = np.empty(8, dtype=np.float32)
        q[:4] = self._q_pos * (dt / REF_DT)
        q[4:] = self._q_vel * (dt / REF_DT)
        self.state      = np.dot(self.transition, self.state)
        self.covariance = (np.dot(np.dot(self.transition, self.covariance), self.transition.T)
                           + np.diag(q))
        self._bbox_cache = None
        return self.get_bbox()

    def update(self, bbox):
        x1, y1, x2, y2 = bbox
        cx = (x1 + x2) / 2.0; cy = (y1 + y2) / 2.0
        w  = max(1e-4, x2 - x1); h = max(1e-4, y2 - y1)
        z  = np.array([cx, cy, w / max(1e-4, h), h], dtype=np.float32)
        y  = z - np.dot(self.measurement, self.state)
        S  = np.dot(np.dot(self.measurement, self.covariance), self.measurement.T) + self.measurement_noise
        K  = np.dot(np.dot(self.covariance, self.measurement.T), np.linalg.inv(S))
        self.state      = self.state + np.dot(K, y)
        self.covariance = np.dot(np.eye(8, dtype=np.float32) - np.dot(K, self.measurement), self.covariance)
        self._bbox_cache = None

    def get_bbox(self):
        # A fresh list is returned every call even on a cache hit: callers treat
        c = self._bbox_cache
        if c is None:
            cx, cy, a, h = self.state[0:4]
            h = max(1e-4, float(h)); a = max(1e-4, float(a)); w = a * h
            c = self._bbox_cache = (cx - w/2, cy - h/2, cx + w/2, cy + h/2)
        return [c[0], c[1], c[2], c[3]]


class AppearanceEmbedder:
    """
    Fast HSV color-histogram appearance descriptor used for re-identification.

    A full deep ReID network would be more discriminative but costs a second
    model forward pass per detection on every frame, which does not fit the
    sub-10ms/frame latency budget this pipeline is held to (see
    project_pipeline_rebuild_complete memory: 9.6ms avg). A coarse HSV
    histogram is ~cheap (small crop, single cv2.calcHist call) and is more
    than sufficient to disambiguate "is this the same person/vehicle that
    was just occluded" from "is this a different object entirely" — it only
    has to survive short gaps, not lifetime cross-camera re-identification.
    """
    _H_BINS, _S_BINS, _V_BINS = 8, 8, 4

    @staticmethod
    def extract(frame, bbox):
        if frame is None or bbox is None:
            return None
        h, w = frame.shape[:2]
        is_norm = max(abs(float(b)) for b in bbox) <= 1.05
        if is_norm:
            bx1, by1 = bbox[0] * w, bbox[1] * h
            bx2, by2 = bbox[2] * w, bbox[3] * h
        else:
            bx1, by1, bx2, by2 = bbox[0], bbox[1], bbox[2], bbox[3]
        x1 = max(0, min(w - 1, int(bx1))); x2 = max(x1 + 1, min(w, int(bx2)))
        y1 = max(0, min(h - 1, int(by1))); y2 = max(y1 + 1, min(h, int(by2)))
        crop = frame[y1:y2, x1:x2]
        if crop.size == 0:
            return None
        crop = cv2.resize(crop, (32, 64), interpolation=cv2.INTER_LINEAR)
        hsv = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV)
        hist = cv2.calcHist(
            [hsv], [0, 1, 2], None,
            [AppearanceEmbedder._H_BINS, AppearanceEmbedder._S_BINS, AppearanceEmbedder._V_BINS],
            [0, 180, 0, 256, 0, 256],
        )
        cv2.normalize(hist, hist, alpha=1.0, norm_type=cv2.NORM_L1)
        return hist.flatten().astype(np.float32)

    @staticmethod
    def distance(a, b):
        """0.0 = identical appearance, 1.0 = maximally different. 1.0 (worst) if either is missing."""
        if a is None or b is None:
            return 1.0
        d = cv2.compareHist(a, b, cv2.HISTCMP_BHATTACHARYYA)
        if not np.isfinite(d):
            return 1.0
        return float(np.clip(d, 0.0, 1.0))


class Track:
    """
    A single tracked object. Combines Kalman motion prediction with an
    EMA-smoothed appearance embedding and a majority-vote class label so
    that transient detector noise (a one-frame misclassification, a jittery
    box) never forces an ID change — the goal is one stable ID for the
    object's entire time in view, not one ID per detection streak.
    """
    def __init__(self, track_id, bbox, class_name, confidence, embedding=None, n_init=2,
                 custom_match=False, target_name=None, target_id=None, track_label=None, face_matched=False):
        self.track_id   = track_id
        self.class_name = class_name
        self._class_votes = deque([class_name], maxlen=7)
        self.confidence = confidence
        self.kf = LightweightKalmanFilter(bbox)
        self.time_since_update = 0
        self.hits = 1
        self.age  = 1
        self.n_init = n_init
        # Tentative tracks are held back from telemetry output until they
        self.state = "tentative" if n_init > 1 else "confirmed"
        self.embedding = embedding
        now = time.time()
        self.first_seen = now
        self.last_seen  = now
        self.custom_match = custom_match or str(class_name).lower().startswith("target:")
        self.target_name = target_name
        self.target_id = target_id
        self.track_label = track_label
        self.face_matched = face_matched

        # Tracker-clock reading of the last match. `time_since_update` counts
        self.last_clock = 0.0

    @property
    def lost_frames(self):
        return self.time_since_update

    @lost_frames.setter
    def lost_frames(self, val):
        self.time_since_update = val

    def predict(self, dt=None):
        self.age += 1
        self.time_since_update += 1
        return self.kf.predict(dt)

    def _vote_class(self, class_name):
        if not class_name:
            return
        c_str = str(class_name).lower()
        if c_str.startswith("target:") or "target" in c_str or "vip" in c_str:
            self.class_name = class_name
            self.custom_match = True
            self._class_votes.append(class_name)
        else:
            self._class_votes.append(class_name)
            # CRITICAL: If this track is already recognized as a custom/target identity,
            # do not allow generic "person" votes to overwrite the target identity.
            if not self.custom_match and not str(self.class_name).lower().startswith("target:"):
                self.class_name = max(set(self._class_votes), key=self._class_votes.count)

    def _blend_embedding(self, embedding, new_weight):
        if embedding is None:
            return
        if self.embedding is None:
            self.embedding = embedding
            return
        blended = (1.0 - new_weight) * self.embedding + new_weight * embedding
        norm = np.linalg.norm(blended)
        self.embedding = blended / norm if norm > 1e-6 else blended

    def update(self, bbox, confidence, embedding=None, class_name=None,
               custom_match=False, target_name=None, target_id=None, track_label=None, face_matched=False):
        self.time_since_update = 0
        self.hits += 1
        self.confidence = confidence
        self.last_seen = time.time()
        self.kf.update(bbox)
        if custom_match or (class_name and str(class_name).lower().startswith("target:")):
            self.custom_match = True
            if target_name: self.target_name = target_name
            if target_id: self.target_id = target_id
            if track_label: self.track_label = track_label
            self.face_matched = face_matched
            if class_name: self.class_name = class_name
        elif self.custom_match:
            # Persistent identity tracking: Face might not be visible in this frame,
            # but body tracking continues under the SAME track ID and identity!
            self.face_matched = False
            if self.target_name and not str(self.class_name).lower().startswith("target:"):
                self.class_name = f"TARGET: {self.target_name}"
            if self.target_name and not self.track_label:
                self.track_label = f"TARGET: {self.target_name} (ReID)"
        self._vote_class(class_name)
        self._blend_embedding(embedding, new_weight=0.15)
        if self.state == "tentative" and self.hits >= self.n_init:
            self.state = "confirmed"

    def revive(self, bbox, confidence, embedding, class_name,
               custom_match=False, target_name=None, target_id=None, track_label=None, face_matched=False):
        """Re-activate a track pulled from the lost gallery under its ORIGINAL id."""
        self.kf = LightweightKalmanFilter(bbox)
        self.time_since_update = 0
        self.hits += 1
        self.confidence = confidence
        self.last_seen = time.time()
        self.state = "confirmed"
        if custom_match or (class_name and str(class_name).lower().startswith("target:")):
            self.custom_match = True
            if target_name: self.target_name = target_name
            if target_id: self.target_id = target_id
            if track_label: self.track_label = track_label
            self.face_matched = face_matched
            if class_name: self.class_name = class_name
        elif self.custom_match:
            self.face_matched = False
            if self.target_name and not str(self.class_name).lower().startswith("target:"):
                self.class_name = f"TARGET: {self.target_name}"
        self._vote_class(class_name)
        self._blend_embedding(embedding, new_weight=0.35)

    def get_bbox(self):
        return self.kf.get_bbox()


class ByteTracker:
    """
    Multi-object tracker built for ID persistence under occlusion, overlap,
    stopping, and lighting change:

      1. Kalman constant-velocity motion prediction per track.
      2. Optimal (Hungarian / scipy linear_sum_assignment) data association.
      3. Appearance re-identification with HSV-histogram embedding.
      4. A "lost gallery" with persistent identity retention across occlusion.
    """

    # Bhattacharyya distance threshold for gallery re-identification.
    _REID_APPEARANCE_GATE = 0.40
    # Cap how far (as a fraction of the frame diagonal) a revived track's new
    _REID_SPATIAL_GATE = 0.5

    def __init__(self, max_lost_seconds=2.5, reid_ttl=15.0, n_init=1):
        # Seconds — NOT iterations — a track stays actively coasted before it
        self.max_lost_seconds = max_lost_seconds
        self.reid_ttl        = reid_ttl         # seconds a track stays re-identifiable in the gallery
        self.n_init          = n_init
        self.tracks = []          # active + short-term-occluded (predicted every frame)
        self.lost_gallery = {}    # track_id -> Track, long-term re-id memory
        self.next_track_id = 1
        self._last_update_ts = None   # wall clock of the previous update(), for dt
        # Monotonic seconds-since-start, advanced by each update()'s real dt.
        self._clock = 0.0

    def secs_since_update(self, track):
        """Seconds of tracker time since `track` was last matched."""
        return max(0.0, self._clock - track.last_clock)

    @staticmethod
    def _compute_iou(boxA, boxB):
        xA = max(boxA[0], boxB[0]); yA = max(boxA[1], boxB[1])
        xB = min(boxA[2], boxB[2]); yB = min(boxA[3], boxB[3])
        inter = max(0.0, xB - xA) * max(0.0, yB - yA)
        areaA = max(0.0, boxA[2] - boxA[0]) * max(0.0, boxA[3] - boxA[1])
        areaB = max(0.0, boxB[2] - boxB[0]) * max(0.0, boxB[3] - boxB[1])
        return inter / max(1e-6, areaA + areaB - inter)

    @staticmethod
    def _hungarian_match(tracks, dets, iou_gate, w_iou, w_app, app_gate=None, spatial_gate=None, frame_diag=None):
        """Optimal assignment on a fused IoU + appearance cost, with hard gates."""
        n_t, n_d = len(tracks), len(dets)
        if n_t == 0 or n_d == 0:
            return [], [], list(range(n_t)), list(range(n_d))
        INVALID = 10.0
        cost  = np.full((n_t, n_d), INVALID, dtype=np.float32)
        for ti, t in enumerate(tracks):
            tb = t.get_bbox()
            for di, d in enumerate(dets):
                if t.class_name == d["class"]:
                    class_penalty = 0.0
                elif _classes_compatible(t.class_name, d["class"]):
                    # Small penalty for compatible transitions (e.g. TARGET: Prince <-> person or car <-> truck)
                    class_penalty = 0.05
                else:
                    continue
                # Gates are ordered cheapest-first, and each is skipped when it
                if spatial_gate is not None and frame_diag:
                    tcx, tcy = (tb[0] + tb[2]) / 2.0, (tb[1] + tb[3]) / 2.0
                    dcx, dcy = (d["bbox"][0] + d["bbox"][2]) / 2.0, (d["bbox"][1] + d["bbox"][3]) / 2.0
                    if np.hypot(tcx - dcx, tcy - dcy) / frame_diag > spatial_gate:
                        continue
                # The gallery pass weights IoU at zero and gates at zero, so the
                if w_iou or iou_gate > 0.0:
                    iou = ByteTracker._compute_iou(tb, d["bbox"])
                    if iou < iou_gate:
                        continue
                else:
                    iou = 0.0
                app_d = (AppearanceEmbedder.distance(t.embedding, d["embedding"])
                         if (w_app or app_gate is not None) else 0.0)
                if app_gate is not None and app_d > app_gate:
                    continue
                cost[ti, di] = min(INVALID - 1e-3, w_iou * (1.0 - iou) + w_app * app_d + class_penalty)
        row_ind, col_ind = _get_lsa()(cost)
        m_t, m_d = [], []
        unmatched_t, unmatched_d = set(range(n_t)), set(range(n_d))
        for r, c in zip(row_ind, col_ind):
            if cost[r, c] >= INVALID:
                continue
            m_t.append(r); m_d.append(c)
            unmatched_t.discard(r); unmatched_d.discard(c)
        return m_t, m_d, sorted(unmatched_t), sorted(unmatched_d)

    def update(self, detections, frame=None, frame_shape=None, conf_thresh=0.25, dt=None):
        # Real elapsed time since the last association, so motion prediction and
        now_ts = time.time()
        if dt is None:
            dt = REF_DT if self._last_update_ts is None else (now_ts - self._last_update_ts)
        dt = float(min(MAX_DT, max(MIN_DT, dt)))
        self._last_update_ts = now_ts
        self._clock += dt
        # How many reference-cadence frames this one step covered. 1.0 on a
        gap = max(1.0, dt / REF_DT)

        for t in self.tracks:
            t.predict(dt)

        high_dets, low_dets = [], []
        for det in detections:
            b = det["bbox"]
            bbox = [b["x1"], b["y1"], b["x2"], b["y2"]]
            embedding = AppearanceEmbedder.extract(frame, bbox)
            item = {
                "bbox": bbox,
                "class": det["class"],
                "confidence": det["confidence"],
                "embedding": embedding,
                "custom_match": det.get("custom_match", False),
                "target_name": det.get("target_name"),
                "target_id": det.get("target_id"),
                "track_label": det.get("track_label") or det.get("label"),
                "face_matched": det.get("face_matched", False),
            }
            if det["confidence"] >= conf_thresh:
                high_dets.append(item)
            elif det["confidence"] >= 0.08:
                low_dets.append(item)

        frame_diag = np.hypot(*frame_shape) if frame_shape else None

        # Stage 1: active tracks, IoU-weighted assignment.
        active_tracks   = [t for t in self.tracks if t.time_since_update <= 1]
        occluded_tracks = [t for t in self.tracks if t.time_since_update > 1]

        # IoU gate widens with dt — long gaps produce less overlap even on correct matches.
        gate_active = max(0.05, 0.2 / (gap ** 0.5))

        m_t, m_d, _, un_d = self._hungarian_match(active_tracks, high_dets,
                                                  iou_gate=gate_active, w_iou=0.55, w_app=0.45)
        matched_track_objs = set()
        for ti, di in zip(m_t, m_d):
            trk, det = active_tracks[ti], high_dets[di]
            trk.update(
                det["bbox"], det["confidence"], det["embedding"], det["class"],
                custom_match=det.get("custom_match", False),
                target_name=det.get("target_name"),
                target_id=det.get("target_id"),
                track_label=det.get("track_label"),
                face_matched=det.get("face_matched", False),
            )
            matched_track_objs.add(id(trk))
        rem_high   = [high_dets[i] for i in un_d]
        rem_active = [t for t in active_tracks if id(t) not in matched_track_objs]

        # Stage 2: coasting tracks + stage-1 misses. Appearance-weighted, loose IoU gate.
        stage2_pool = occluded_tracks + rem_active
        # A long detector gap can move a real object entirely beyond its old
        stage2_iou_gate = 0.0 if gap > 3.0 else max(0.01, 0.10 / (gap ** 0.5))
        stage2_spatial_gate = min(0.25, 0.05 * (gap ** 0.5))
        m_t2, m_d2, un_t2, un_d2 = self._hungarian_match(
            stage2_pool, rem_high, iou_gate=stage2_iou_gate, w_iou=0.3, w_app=0.7,
            app_gate=0.5, spatial_gate=stage2_spatial_gate, frame_diag=frame_diag,
        )
        for ti, di in zip(m_t2, m_d2):
            trk, det = stage2_pool[ti], rem_high[di]
            trk.update(
                det["bbox"], det["confidence"], det["embedding"], det["class"],
                custom_match=det.get("custom_match", False),
                target_name=det.get("target_name"),
                target_id=det.get("target_id"),
                track_label=det.get("track_label"),
                face_matched=det.get("face_matched", False),
            )
            matched_track_objs.add(id(trk))
        rem_high2 = [rem_high[i] for i in un_d2]
        rem_unmatched_tracks = [stage2_pool[i] for i in un_t2]

        # Stage 3 (ByteTrack low-conf pass): IoU-only rescue for remaining unmatched tracks.
        m_t3, m_d3, _, _ = self._hungarian_match(rem_unmatched_tracks, low_dets, iou_gate=0.1, w_iou=1.0, w_app=0.0)
        for ti, di in zip(m_t3, m_d3):
            trk, det = rem_unmatched_tracks[ti], low_dets[di]
            trk.update(
                det["bbox"], det["confidence"], det.get("embedding"), det["class"],
                custom_match=det.get("custom_match", False),
                target_name=det.get("target_name"),
                target_id=det.get("target_id"),
                track_label=det.get("track_label"),
                face_matched=det.get("face_matched", False),
            )

        # Stage 4: gallery re-identification before minting new IDs.
        still_unmatched_high = rem_high2
        if still_unmatched_high and self.lost_gallery:
            gallery_ids     = list(self.lost_gallery.keys())
            gallery_tracks  = [self.lost_gallery[tid] for tid in gallery_ids]
            g_t, g_d, _, _  = self._hungarian_match(
                gallery_tracks, still_unmatched_high, iou_gate=0.0, w_iou=0.0, w_app=1.0,
                app_gate=self._REID_APPEARANCE_GATE,
                spatial_gate=self._REID_SPATIAL_GATE, frame_diag=frame_diag,
            )
            revived_det_idx = set()
            for ti, di in zip(g_t, g_d):
                trk, det = gallery_tracks[ti], still_unmatched_high[di]
                trk.revive(
                    det["bbox"], det["confidence"], det["embedding"], det["class"],
                    custom_match=det.get("custom_match", False),
                    target_name=det.get("target_name"),
                    target_id=det.get("target_id"),
                    track_label=det.get("track_label"),
                    face_matched=det.get("face_matched", False),
                )
                self.tracks.append(trk)
                del self.lost_gallery[trk.track_id]
                revived_det_idx.add(di)
            still_unmatched_high = [d for i, d in enumerate(still_unmatched_high) if i not in revived_det_idx]

        # Mint new tracks for unmatched high-confidence detections.
        for det in still_unmatched_high:
            self.tracks.append(Track(
                self.next_track_id, det["bbox"], det["class"], det["confidence"],
                embedding=det["embedding"], n_init=self.n_init,
                custom_match=det.get("custom_match", False),
                target_name=det.get("target_name"),
                target_id=det.get("target_id"),
                track_label=det.get("track_label"),
                face_matched=det.get("face_matched", False),
            ))
            self.next_track_id += 1

        # Stamp the tracker clock on everything matched, revived or created
        for t in self.tracks:
            if t.time_since_update == 0:
                t.last_clock = self._clock

        # Duplicate-track suppression: merge confirmed same-class tracks with high IoU overlap.
        DUP_IOU_THRESH = 0.30
        merged_ids = set()
        for i in range(len(self.tracks)):
            ti = self.tracks[i]
            if ti.track_id in merged_ids or ti.state != "confirmed":
                continue
            for j in range(i + 1, len(self.tracks)):
                tj = self.tracks[j]
                if tj.track_id in merged_ids or tj.state != "confirmed":
                    continue
                if not (tj.class_name == ti.class_name or _vehicle_classes_compatible(ti.class_name, tj.class_name)):
                    continue
                if ti.time_since_update == 0 and tj.time_since_update == 0:
                    continue  # two separate current detections are not duplicates
                if min(ti.time_since_update, tj.time_since_update) > 1:
                    continue  # neither matched recently -- not a live duplicate conflict
                bi = ti.get_bbox()
                bj = tj.get_bbox()
                iou = self._compute_iou(bi, bj)
                ci_x, ci_y = (bi[0] + bi[2]) / 2.0, (bi[1] + bi[3]) / 2.0
                cj_x, cj_y = (bj[0] + bj[2]) / 2.0, (bj[1] + bj[3]) / 2.0
                wi, hi = max(1e-6, bi[2] - bi[0]), max(1e-6, bi[3] - bi[1])
                wj, hj = max(1e-6, bj[2] - bj[0]), max(1e-6, bj[3] - bj[1])
                cdist = ((ci_x - cj_x) ** 2 + (ci_y - cj_y) ** 2) ** 0.5
                max_reach = min(max(wi, hi, wj, hj) * 0.75, 0.40)
                if iou >= DUP_IOU_THRESH or (cdist <= max_reach and iou > 0.10):
                    dup = tj if ti.hits >= tj.hits else ti
                    merged_ids.add(dup.track_id)
        if merged_ids:
            self.tracks = [t for t in self.tracks if t.track_id not in merged_ids]

        # Age out: lost tracks move to gallery for re-id. Uniform TTL regardless of screen position.
        still_active = []
        for t in self.tracks:
            if self.secs_since_update(t) > self.max_lost_seconds:
                if t.state == "confirmed" and t.embedding is not None:
                    self.lost_gallery[t.track_id] = t
                continue
            still_active.append(t)
        self.tracks = still_active

        now = time.time()
        # Gallery TTL is measured on the tracker clock too, so re-id memory
        expired = [tid for tid, t in self.lost_gallery.items()
                   if self.secs_since_update(t) > self.reid_ttl]
        for tid in expired:
            del self.lost_gallery[tid]
        # Hard cap so a very busy scene over a long shift can't grow this
        if len(self.lost_gallery) > 300:
            oldest = sorted(self.lost_gallery.items(), key=lambda kv: kv[1].last_clock)[:len(self.lost_gallery) - 300]
            for tid, _ in oldest:
                del self.lost_gallery[tid]

        out = []
        for t in self.tracks:
            if t.time_since_update == 0 and t.state == "confirmed":
                bbox = t.get_bbox()
                is_norm = max(abs(float(bbox[0])), abs(float(bbox[1])), abs(float(bbox[2])), abs(float(bbox[3]))) <= 1.0
                item = {
                    "track_id":  t.track_id,
                    "class":     t.class_name,
                    "confidence": round(float(t.confidence), 2),
                    "first_seen": t.first_seen,
                    "dwell_time": round(now - t.first_seen, 1),
                    "bbox": {
                        "x1": round(float(bbox[0]), 4) if is_norm else round(float(bbox[0]), 1),
                        "y1": round(float(bbox[1]), 4) if is_norm else round(float(bbox[1]), 1),
                        "x2": round(float(bbox[2]), 4) if is_norm else round(float(bbox[2]), 1),
                        "y2": round(float(bbox[3]), 4) if is_norm else round(float(bbox[3]), 1),
                    }
                }
                if getattr(t, "custom_match", False):
                    item["custom_match"] = True
                    if getattr(t, "target_name", None): item["target_name"] = t.target_name
                    if getattr(t, "target_id", None): item["target_id"] = t.target_id
                    if getattr(t, "track_label", None): item["label"] = t.track_label
                    item["face_matched"] = getattr(t, "face_matched", False)
                    item["reid_active"] = True
                out.append(item)
        return out

    def predict_only(self, dt=None):
        """Advance Kalman state for confirmed tracks without detector updates on skipped frames."""
        now_ts = time.time()
        if dt is None:
            dt = REF_DT if self._last_update_ts is None else (now_ts - self._last_update_ts)
        dt = float(min(MAX_DT, max(MIN_DT, dt)))
        # Do not advance _last_update_ts; tracks age against real detector evidence
        self._clock += dt

        for t in self.tracks:
            t.predict(dt)

        now = time.time()
        out = []
        for t in self.tracks:
            # Same confirmed-only rule as update(), but keyed on the coast
            if t.state != "confirmed":
                continue
            if self.secs_since_update(t) > COAST_RENDER_SECONDS:
                continue
            bbox = t.get_bbox()
            is_norm = max(abs(float(bbox[0])), abs(float(bbox[1])), abs(float(bbox[2])), abs(float(bbox[3]))) <= 1.0
            item = {
                "track_id":  t.track_id,
                "class":     t.class_name,
                "confidence": round(float(t.confidence), 2),
                "first_seen": t.first_seen,
                "dwell_time": round(now - t.first_seen, 1),
                "bbox": {
                    "x1": round(float(bbox[0]), 4) if is_norm else round(float(bbox[0]), 1),
                    "y1": round(float(bbox[1]), 4) if is_norm else round(float(bbox[1]), 1),
                    "x2": round(float(bbox[2]), 4) if is_norm else round(float(bbox[2]), 1),
                    "y2": round(float(bbox[3]), 4) if is_norm else round(float(bbox[3]), 1),
                }
            }
            if getattr(t, "custom_match", False):
                item["custom_match"] = True
                if getattr(t, "target_name", None): item["target_name"] = t.target_name
                if getattr(t, "target_id", None): item["target_id"] = t.target_id
                if getattr(t, "track_label", None): item["label"] = t.track_label
                item["face_matched"] = getattr(t, "face_matched", False)
                item["reid_active"] = True
            out.append(item)
        return out

COAST_RENDER_SECONDS = 1.2


def resolve_emitted_detections(tracker, tracks_raw, detections, masks,
                                coast_render_seconds=COAST_RENDER_SECONDS):
    """Decide the FINAL set of boxes for one frame: exactly one per object."""
    tracks_by_id = {trk["track_id"]: trk for trk in tracks_raw}

    # A track may be claimed by AT MOST ONE detection, resolved greedily by
    pairs = []  # (iou, det_idx, track_id)
    for di, det in enumerate(detections):
        bd = [det["bbox"]["x1"], det["bbox"]["y1"],
              det["bbox"]["x2"], det["bbox"]["y2"]]
        for trk in tracks_raw:
            bt = [trk["bbox"]["x1"], trk["bbox"]["y1"],
                  trk["bbox"]["x2"], trk["bbox"]["y2"]]
            iou = tracker._compute_iou(bd, bt)
            if iou > 0.05:
                pairs.append((iou, di, trk["track_id"]))
    pairs.sort(key=lambda p: p[0], reverse=True)

    det_to_track = {}
    matched_track_ids = set()
    for iou, di, tid in pairs:
        if di in det_to_track or tid in matched_track_ids:
            continue
        det_to_track[di] = tid
        matched_track_ids.add(tid)

    out_dets, out_masks = [], []
    masks_parallel = len(masks) == len(detections)
    track_to_det = {tid: di for di, tid in det_to_track.items()}

    # One box per live track. A detection that claimed a track contributes its
    for trk in tracks_raw:
        tid = trk["track_id"]
        di = track_to_det.get(tid)
        trk_obj = next((t for t in tracker.tracks if t.track_id == tid), None)
        if di is not None:
            det = detections[di]
            det["track_id"] = tid
            det["dwell_time"] = trk["dwell_time"]
            det["bbox"] = dict(trk["bbox"])
            det["confidence"] = trk["confidence"]
            det["tracking_status"] = "tracked"
            if trk_obj and getattr(trk_obj, "custom_match", False):
                det["custom_match"] = True
                if getattr(trk_obj, "target_name", None):
                    det["target_name"] = trk_obj.target_name
                    det["class"] = f"TARGET: {trk_obj.target_name}"
                if getattr(trk_obj, "target_id", None):
                    det["target_id"] = trk_obj.target_id
                if getattr(trk_obj, "track_label", None):
                    det["label"] = trk_obj.track_label
                det["face_matched"] = getattr(trk_obj, "face_matched", False)
                det["reid_active"] = True
            out_dets.append(det)
            out_masks.append(masks[di] if masks_parallel else [])
        else:
            secs = tracker.secs_since_update(trk_obj) if trk_obj is not None else 0.0
            if secs > coast_render_seconds:
                continue
            
            b = trk.get("bbox", {})
            x1, y1, x2, y2 = b.get("x1", 50), b.get("y1", 50), b.get("x2", 50), b.get("y2", 50)
            if x1 <= 15 or y1 <= 15 or x2 >= 1905 or y2 >= 1065:
                continue

            coasted = {
                "class": trk["class"],
                "confidence": trk["confidence"],
                "track_id": tid,
                "dwell_time": trk["dwell_time"],
                "bbox": dict(trk["bbox"]),
                "tracking_status": "tracked",
            }
            if trk_obj and getattr(trk_obj, "custom_match", False):
                coasted["custom_match"] = True
                if getattr(trk_obj, "target_name", None):
                    coasted["target_name"] = trk_obj.target_name
                    coasted["class"] = f"TARGET: {trk_obj.target_name}"
                if getattr(trk_obj, "target_id", None):
                    coasted["target_id"] = trk_obj.target_id
                if getattr(trk_obj, "track_label", None):
                    coasted["label"] = trk_obj.track_label
                coasted["face_matched"] = getattr(trk_obj, "face_matched", False)
                coasted["reid_active"] = True
            out_dets.append(coasted)
            out_masks.append([])

    # Coasting tracks from tracker.tracks not in tracks_raw
    for t in getattr(tracker, "tracks", []):
        if t.track_id in matched_track_ids or t.track_id in [trk["track_id"] for trk in tracks_raw]:
            continue
        if t.state != "confirmed":
            continue
        secs = tracker.secs_since_update(t)
        if secs > coast_render_seconds:
            continue
        cbbox = t.get_bbox()
        is_norm = max(abs(float(cbbox[0])), abs(float(cbbox[1])), abs(float(cbbox[2])), abs(float(cbbox[3]))) <= 1.0
        x1 = round(float(cbbox[0]), 4) if is_norm else round(float(cbbox[0]), 1)
        y1 = round(float(cbbox[1]), 4) if is_norm else round(float(cbbox[1]), 1)
        x2 = round(float(cbbox[2]), 4) if is_norm else round(float(cbbox[2]), 1)
        y2 = round(float(cbbox[3]), 4) if is_norm else round(float(cbbox[3]), 1)
        if not is_norm and (x1 <= 15 or y1 <= 15 or x2 >= 1905 or y2 >= 1065):
            continue

        c_det = {
            "class": t.class_name,
            "confidence": round(float(t.confidence), 2),
            "track_id": t.track_id,
            "dwell_time": round(time.time() - t.first_seen, 1),
            "bbox": {"x1": x1, "y1": y1, "x2": x2, "y2": y2},
            "tracking_status": "coasting",
        }
        if getattr(t, "custom_match", False):
            c_det["custom_match"] = True
            if getattr(t, "target_name", None):
                c_det["target_name"] = t.target_name
                c_det["class"] = f"TARGET: {t.target_name}"
            if getattr(t, "target_id", None):
                c_det["target_id"] = t.target_id
            if getattr(t, "track_label", None):
                c_det["label"] = t.track_label
            c_det["face_matched"] = getattr(t, "face_matched", False)
            c_det["reid_active"] = True
        out_dets.append(c_det)
        out_masks.append([])

    # Emit fresh raw detections that were not claimed by existing confirmed tracks
    for di, det in enumerate(detections):
        if di not in det_to_track:
            fresh_det = dict(det)
            if "tracking_status" not in fresh_det:
                fresh_det["tracking_status"] = "detected"
            if "dwell_time" not in fresh_det:
                fresh_det["dwell_time"] = 0.0
            if "track_id" not in fresh_det or fresh_det["track_id"] is None:
                for t in getattr(tracker, "tracks", []):
                    if t.time_since_update == 0 and (t.class_name == det.get("class") or _classes_compatible(t.class_name, det.get("class"))):
                        fresh_det["track_id"] = t.track_id
                        break
            out_dets.append(fresh_det)
            out_masks.append(masks[di] if masks_parallel else [])

    # Final safety net against "N boxes on one object". A single person can end
    if len(out_dets) > 1:
        order = sorted(
            range(len(out_dets)),
            key=lambda i: (out_dets[i].get("tracking_status") == "tracked",
                           out_dets[i].get("confidence", 0.0)),
            reverse=True,
        )
        keep: list[int] = []
        for i in order:
            bi = out_dets[i]["bbox"]
            box_i = [bi["x1"], bi["y1"], bi["x2"], bi["y2"]]
            dup = False
            for j in keep:
                if not (out_dets[j]["class"] == out_dets[i]["class"] or _vehicle_classes_compatible(out_dets[j]["class"], out_dets[i]["class"])):
                    continue
                bj = out_dets[j]["bbox"]
                box_j = [bj["x1"], bj["y1"], bj["x2"], bj["y2"]]
                iou = tracker._compute_iou(box_i, box_j)
                ci_x, ci_y = (box_i[0] + box_i[2]) / 2.0, (box_i[1] + box_i[3]) / 2.0
                cj_x, cj_y = (box_j[0] + box_j[2]) / 2.0, (box_j[1] + box_j[3]) / 2.0
                wi, hi = max(1e-6, box_i[2] - box_i[0]), max(1e-6, box_i[3] - box_i[1])
                wj, hj = max(1e-6, box_j[2] - box_j[0]), max(1e-6, box_j[3] - box_j[1])
                cdist = ((ci_x - cj_x) ** 2 + (ci_y - cj_y) ** 2) ** 0.5
                max_reach = min(max(wi, hi, wj, hj) * 0.75, 0.40)
                if iou > 0.45 or (cdist <= max_reach and iou > 0.20):
                    dup = True
                    break
            if not dup:
                keep.append(i)
        keep_set = set(keep)
        out_dets = [d for k, d in enumerate(out_dets) if k in keep_set]
        out_masks = [m for k, m in enumerate(out_masks) if k in keep_set]

    return out_dets, out_masks


# ---------------------------------------------------------------------------
# Size-1 frame slot — "latest wins, old frames dropped immediately"
# ---------------------------------------------------------------------------

class _Slot:
    """
    Thread-safe single-item buffer.

    put()  : writer always overwrites (old data dropped, latest wins).
    take() : reader blocks (with timeout) until data is available, then
             consumes the slot (returns None on timeout).

    This guarantees every downstream stage always sees the freshest data
    and never processes a stale frame that has already been superseded.
    The Event-based wait means idle consumers sleep instead of spin-polling,
    which is what kept every pipeline thread burning a CPU core doing
    nothing while waiting for the next frame.
    """
    __slots__ = ('_lock', '_data', '_ready', 'dropped', 'passed')

    def __init__(self):
        self._lock  = threading.Lock()
        self._data  = None
        self._ready = threading.Event()
        # A put() that lands on a slot the consumer has not drained yet has
        self.dropped = 0
        self.passed  = 0

    def put(self, data):
        with self._lock:
            if self._data is not None:
                self.dropped += 1
            else:
                self.passed += 1
            self._data = data
            self._ready.set()

    def take(self, timeout: float = 0.05):
        """Block until data is available (up to timeout seconds), then consume.

        0.05s (50ms) gives sleeping consumers up to 20Hz wake budget even in a
        scene with no motion at all — low enough to never starve the watchdog,
        high enough to avoid spin-burning a CPU core at idle.
        """
        if not self._ready.wait(timeout):
            return None
        with self._lock:
            d = self._data
            self._data = None
            self._ready.clear()
            return d

    def take_latest(self, timeout: float = 0.05):
        """Block until data is available, then consume and return ONLY the latest data.
        Ensures downstream AI and tracking never process stale buffered frames.
        """
        if not self._ready.wait(timeout):
            return None
        with self._lock:
            d = self._data
            self._data = None
            self._ready.clear()
            return d

    def has_item(self) -> bool:
        return self._ready.is_set()


def _fps(ts_deque: deque, window: float = 5.0) -> float:
    """Sliding-window FPS from a timestamp deque (trims in-place from the left)."""
    now = time.time()
    while ts_deque and now - ts_deque[0] > window:
        ts_deque.popleft()
    if len(ts_deque) < 2:
        return 0.0
    if now - ts_deque[-1] > window:
        return 0.0
    span = ts_deque[-1] - ts_deque[0]
    if span <= 0.001:
        return 0.0
    calc_fps = (len(ts_deque) - 1) / span
    return min(60.0, calc_fps)


class _LatencyWindow:
    """Bounded, thread-safe latency samples for an operator-facing percentile."""

    def __init__(self, size: int = 120):
        self._samples = deque(maxlen=size)
        self._lock = threading.Lock()

    def add(self, value: float) -> None:
        try:
            sample = float(value)
        except (TypeError, ValueError):
            return
        if sample < 0:
            return
        with self._lock:
            self._samples.append(sample)

    def summary(self) -> dict:
        with self._lock:
            samples = sorted(self._samples)
        if not samples:
            return {"samples": 0, "average_ms": 0.0, "p50_ms": 0.0, "p95_ms": 0.0}

        def percentile(percent: float) -> float:
            index = min(len(samples) - 1, max(0, int(np.ceil(len(samples) * percent)) - 1))
            return samples[index]

        return {
            "samples": len(samples),
            "average_ms": round(sum(samples) / len(samples), 1),
            "p50_ms": round(percentile(0.50), 1),
            "p95_ms": round(percentile(0.95), 1),
        }


# ---------------------------------------------------------------------------
# Real-time Enterprise Pipeline
# ---------------------------------------------------------------------------

class PipelineCoordinator:
    """
    Ultra-low-latency real-time AI pipeline with 6 fully independent threads
    per camera (plus recording, which runs on CCTVRecorder's own thread).

    Architecture
    ============
    Module 1  Capture Thread    → _grabbed_slot    (size-1, latest-wins)
    Module 2  Decode Thread     → _decoded_slot     (size-1) + MJPEG stream update
    Module 3  AI Inference      → _ai_slot          (size-1)
    Module 4  ByteTrack + Rules → _tracking_slot    (size-1)
    Module 5  Telemetry Build   → _telemetry_out_slot (size-1)
    Module 6  WebSocket Dispatch→ WebSocket push
    (Module 7  Recording        → CCTVRecorder, its own thread + async queue)

    Telemetry build and WebSocket dispatch are split into separate threads
    (Module 5 / Module 6) so a slow or backed-up WS fan-out to many clients
    can never delay the next telemetry computation — each has its own size-1
    slot and the same drop-stale-frames guarantee as every other stage. In
    practice the WS send itself is also non-blocking (asyncio.
    run_coroutine_threadsafe hands it to uvicorn's own event-loop thread),
    but keeping the split explicit means it stays true even if that changes.

    Every module polls its input slot. A faster upstream stage simply
    overwrites the slot; the downstream stage always picks up the newest
    data. No module ever waits for another to finish.

    Video path (camera FPS):
        Decode → JPEG encode → current_jpeg_bytes → MJPEG /stream endpoint
        This path is completely independent of AI inference.

    AI path (AI FPS):
        AI → Tracking → Telemetry (JSON only, no video frame)
        Frontend canvas draws overlays on top of the live MJPEG feed.
    """

    def __init__(self, camera_id: str, name: str, source_type: str, source: str,
                 zones_json: str, lines_json: str, backend_getter, rules_json: str = "[]",
                 zone_profile: str = None, profile_features: str = "{}"):

        self.camera_id   = camera_id
        self.name        = name
        if source_type in ("screen_share", "screenshare", "virtual"):
            source_type = "screenshare"
        self.source_type = source_type
        self.source      = source
        self._backend_getter = backend_getter
        self._backend_override = None

        # A local video FILE (as opposed to a live device/RTSP stream) is a
        self._is_video_file = False
        try:
            src_str = str(source).lower()
            if source_type not in ("webcam", "usb", "screenshare", "screen_share", "virtual"):
                if os.path.isfile(str(source)):
                    self._is_video_file = True
                elif any(src_str.split("?")[0].endswith(ext) for ext in (".mp4", ".mov", ".avi", ".mkv", ".webm")):
                    self._is_video_file = True
        except Exception:
            self._is_video_file = False

        # A YouTube/Twitch link is a web PAGE, not a media address — cv2 opens
        self._is_page_url = False
        try:
            if not self._is_video_file and source_type not in ("webcam", "usb", "screenshare", "screen_share", "virtual"):
                self._is_page_url = stream_resolver.needs_resolution(source)
        except Exception:
            self._is_page_url = False
        # Last resolution failure, surfaced in telemetry so "offline" comes
        self._resolve_error = None

        self.zones = json.loads(zones_json)
        self.lines = json.loads(lines_json)
        self.rules = json.loads(rules_json)
        self.zone_profile = zone_profile
        self.profile_features = json.loads(profile_features) if isinstance(profile_features, str) else (profile_features or {})

        # {alert_type: count} since this camera started — surfaced in telemetry
        self._alert_counts = {}
        self._last_target_alerts = {}

        self.running        = False
        self.incoming_frame = None       # screenshare push target
        # Signalled by push_frame(); waited on by the capture loop's screenshare
        self._push_event    = threading.Event()
        self._last_push_ts  = 0.0        # last time push_frame() delivered a frame (screenshare staleness)
        self.telemetry_callback = None

        # Size-1 pipeline slots (one per stage boundary)
        self._grabbed_slot      = _Slot()   # Module 1 → Module 2
        self._decoded_slot      = _Slot()   # Module 2 → Module 3
        self._ai_slot           = _Slot()   # Module 3 → Module 4
        self._tracking_slot     = _Slot()   # Module 4 → Module 5
        self._telemetry_out_slot = _Slot()  # Module 5 → Module 6

        # MJPEG stream buffer (updated by Module 2 at camera FPS)
        self.jpeg_lock          = threading.Lock()
        self.current_jpeg_bytes = None
        self.jpeg_sequence_id   = 0
        # Signalled by Module 2 whenever a new JPEG is written to
        self.jpeg_ready_event   = threading.Event()
        # Number of MJPEG HTTP generators currently streaming this camera.
        self._mjpeg_viewers      = 0
        self._mjpeg_viewer_lock  = threading.Lock()
        # Monotonic deadline for the next preview encode (MJPEG_MAX_FPS cap).
        self._next_mjpeg_due     = 0.0

        # Synchronized MJPEG burn-in overlay state
        self._overlay_lock        = threading.Lock()
        self._latest_overlay_dets = []
        self._latest_raw_dets     = []
        self._latest_overlay_ts   = 0.0

        # Display-only encode knobs, mutable at runtime via update_display_config().
        self.display_max_width = 1280
        self.jpeg_quality = 70

        # Per-stage FPS sliding windows
        self._cap_ts: deque = deque(maxlen=1000)
        self._dec_ts: deque = deque(maxlen=1000)
        self._ai_ts:  deque = deque(maxlen=1000)
        self._trk_ts: deque = deque(maxlen=1000)
        self._tel_ts: deque = deque(maxlen=1000)
        self._latency_windows = {
            stage: _LatencyWindow()
            for stage in (
                "capture", "decode", "ai_preproc", "ai_inference",
                "ai_postproc", "tracking", "telemetry", "end_to_end",
            )
        }

        # Stage health: heartbeat timestamp + error count per stage
        now0 = time.time()
        self._heartbeat = {"cap": now0, "dec": now0, "ai": now0, "trk": now0, "tel": now0, "ws": now0}
        self._stage_errors = {"cap": 0, "dec": 0, "ai": 0, "trk": 0, "tel": 0, "ws": 0}
        self._diagnostic_last: dict[str, float] = {}
        self.restart_callback = None  # set by CameraManager; called if watchdog gives up on this instance

        # Adaptive inference resolution configuration
        backend_model = self.backend
        device = getattr(backend_model, "backend_device", "CPU").upper()
        static_imgsz = getattr(backend_model, "static_imgsz", None)
        if static_imgsz is not None:
            # Pinned static shape for fixed hardware backends (OpenVINO iGPU)
            self.current_imgsz = static_imgsz
            self.max_imgsz     = static_imgsz
            self.min_imgsz     = static_imgsz
            self._pin_imgsz    = True
        elif "GPU" in device or "CUDA" in device:
            self.current_imgsz = 640
            self.max_imgsz     = 1280
            self.min_imgsz     = 320
            self._pin_imgsz    = False
        else:
            self.current_imgsz = 640
            self.max_imgsz     = 960
            self.min_imgsz     = 320
            self._pin_imgsz    = False
        self._latency_history: list = []
        # See config.TARGET_FPS: the tile engine's deadline, and the one knob
        self.target_fps = float(TARGET_FPS)


        # Per-camera adaptive tile inference scheduler.
        self._tile_engine = AdaptiveTileEngine(camera_id)
        self._tile_stats: dict = {}
        self._push_tile_priority()

        self._overlay_lock = threading.Lock()
        self._latest_overlay_dets = []
        self._latest_overlay_ts = 0.0

        # REST telemetry snapshot. Starts as "connecting" (not "no_human")
        self.latest_telemetry = {
            "success": True, "people": 0, "vehicles": 0,
            "detections": [], "masks": [], "tracks": [],
            "counters": {"in": 0, "out": 0},
            "heatmap": [], "latency": 0, "fps": 0.0,
            "camera_fps": 0.0, "decode_fps": 0.0,
            "inference_fps": 0.0, "tracking_fps": 0.0,
            "cpu": 0.0, "memory": 0.0, "gpu": 0.0, "status": "connecting",
            "health_status": "connecting", "source_error": None,
            "cap_consecutive_failures": 0,
        }

        # Sub-systems
        self.recorder  = CCTVRecorder(camera_id)
        self.analytics = CameraAnalytics(camera_id)
        self.tracker   = ByteTracker()

        # Motion detection state
        self._prev_motion = None
        self._prev_motion_full = None
        self._motion_noise_ema = None
        self._motion_thr  = 0.004
        self._motion_stats = {
            "motion": True,
            "changed_ratio": 0.0,
            "threshold": 12,
            "noise_sigma": 0.0,
            "mean_luminance": 128.0,
            "low_light": False,
            "latency_ms": 0.0,
        }
        # Floor for motion-gated inference: at least one pass every 150ms
        self._last_infer_ts = 0.0
        self._FORCE_INFER_INTERVAL = 0.15

        # Shared counter: _tracking_loop writes, _ai_loop reads.
        self._n_active_tracks = 0

        self.cap = None
        # Consecutive failed reconnect cycles; drives exponential backoff.
        self._cap_consecutive_failures = 0

        # Connection health (surfaced via /api/status and Supabase sync).
        self._health_status = "connecting"
        self._last_probe_ts = 0.0
        self._last_resolution = ""
        # Rate limiter for publish_source_status().
        self._last_status_push_ts = 0.0

    @property
    def backend(self):
        if self._backend_override is not None:
            return self._backend_override
        return self._backend_getter()

    @backend.setter
    def backend(self, val):
        self._backend_override = val

    def mjpeg_viewer_attached(self):
        with self._mjpeg_viewer_lock:
            self._mjpeg_viewers += 1

    def mjpeg_viewer_detached(self):
        with self._mjpeg_viewer_lock:
            self._mjpeg_viewers = max(0, self._mjpeg_viewers - 1)

    def _preflight_network_source(self) -> bool:
        """TCP probe before cv2.VideoCapture — fails in ~3s vs. 60s for unreachable hosts.

        Returns True to proceed with the open, False to skip this cycle.
        """
        # Device indices, files and pushed screenshare frames have no host to
        if self.source_type in ("usb", "webcam", "screenshare", "screen_share", "virtual") or self._is_video_file:
            return True
        # A page URL's own host is never the host that serves the video — a
        if self._is_page_url:
            return True
        src = str(self.source)
        if "://" not in src:
            return True

        # SSRF guard: a camera's source is chosen at portal/add-camera trust
        blocked = stream_resolver.blocked_source_reason(src)
        if blocked:
            if self._health_status != "blocked":
                print(f"[Cap-{self.camera_id}] Refusing to connect: {blocked}", flush=True)
            self._health_status = "blocked"
            return False

        from app.health_probe import probe_connection
        try:
            result = probe_connection(src, timeout=3.0)
        except Exception:
            # A broken probe must never be the reason a good camera is refused.
            return True

        if result == "network_error":
            # TCP probe check failed (e.g. RTSP UDP or custom streaming port),
            return True

        # auth_failed is reported for visibility but NOT used to skip the open.
        if result == "auth_failed":
            self._health_status = "auth_failed"
        return True

    def _source_label(self, src) -> str:
        """What to print for this source. A resolved manifest URL is ~1 KB of
        signature and would bury every other line in the desktop's log panel,
        so page URLs are logged by origin instead."""
        if self._is_page_url:
            return f"{mask_source(self.source)} -> {stream_resolver.describe(self.source)}"
        return mask_source(src)

    def _capture_source(self, refresh: bool = False):
        """The address to hand cv2.VideoCapture for this camera, right now.

        For every source that already is a media address (RTSP, HLS, MJPEG,
        file, device index) this is just the configured source and costs
        nothing. For a page URL it is the direct manifest behind it, which is
        signed and expires, so `refresh` forces a fresh extraction — the
        reconnect path always passes it, because the most likely reason a
        working YouTube stream stopped is that its URL aged out.

        Returns None if a page URL cannot be resolved; the caller treats that
        the same as a failed open (backoff + health), but with a real reason.
        """
        src = (int(self.source)
               if self.source_type in ("webcam", "usb") and str(self.source).isdigit()
               else self.source)
        if not self._is_page_url:
            return src
        try:
            resolved = stream_resolver.resolve(str(self.source), force=refresh)
            if self._resolve_error:
                print(f"[Cap-{self.camera_id}] Stream URL resolved again after error.", flush=True)
            self._resolve_error = None
            return resolved
        except Exception as e:
            self._resolve_error = str(e)
            self._health_status = "network_error"
            print(f"[Cap-{self.camera_id}] Cannot resolve {mask_source(self.source)}: "
                  f"{self._resolve_error}", flush=True)
            return None

    def refresh_status_fields(self):
        """Bring latest_telemetry's capture-state fields up to date, in place.

        Split out from publish_source_status so a caller that needs the CURRENT
        state without emitting anything — /ws answering a fresh subscription —
        cannot accidentally serve a snapshot that has been sitting unchanged
        since the last retry cycle, up to 30s ago at full backoff.
        """
        cur_cap_fps = _fps(self._cap_ts)
        cur_tel_fps = _fps(self._tel_ts)
        reported_fps = round(max(cur_cap_fps, cur_tel_fps), 1)
        self.latest_telemetry.update({
            "health_status": self._health_status,
            "source_error": self.source_error_text(),
            "cap_consecutive_failures": self._cap_consecutive_failures,
            # No frame was processed, so every analytic result must read as
            "status": self._health_status,
            "detections": [], "masks": [], "tracks": [],
            "people": 0, "vehicles": 0,
            "fps": reported_fps, "camera_fps": round(cur_cap_fps, 1),
        })

    def publish_source_status(self, min_interval: float = 2.0):
        """Emit a status-only telemetry payload for a camera producing no frames.

        Modules 5 and 6 only ever run off a decoded frame, so a camera whose
        source never opens emits NOTHING on the WebSocket — not an error, not an
        empty payload, nothing at all. The desktop's live view subscribes and
        then waits forever, which renders as a tile with no boxes and no
        explanation, i.e. indistinguishable from "the AI is running and finding
        nothing". Every failure path in _capture_loop calls this, so the client
        is told "no video, and here is why" at a steady low rate instead.

        Rate-limited because the capture loop's retry cadence is far faster than
        anything a human needs to see, and this shares the WS with live cameras.
        """
        now = time.time()
        if now - self._last_status_push_ts < min_interval:
            return
        self._last_status_push_ts = now

        self.refresh_status_fields()
        try:
            if self.telemetry_callback:
                self.telemetry_callback({self.camera_id: self.latest_telemetry})
        except Exception as e:
            print(f"[Cap-{self.camera_id}] status push failed (recovered): {e}", flush=True)

    def source_error_text(self):
        """Why this camera has no video, in words an operator can act on.

        Returns None while the source is healthy. The extractor's own message is
        used when there is one (it is the most specific thing anyone knows —
        "This video is not available" beats any wording invented here); the rest
        are classified from _health_status, which the capture loop already
        maintains. Deliberately a method rather than stored state so it cannot
        go stale relative to the health status it describes.
        """
        if self._health_status == "online":
            return None
        if self._health_status == "blocked":
            return "This camera's address is not allowed (loopback/link-local address or unsupported protocol)."
        if self._resolve_error:
            return f"Stream link could not be resolved: {self._resolve_error}"
        if self.source_type == "screenshare":
            return ("No frames are being pushed to this virtual camera. "
                    "Choose a source to start sharing.")
        if self._health_status == "auth_failed":
            return "The camera rejected the credentials in its address."
        if self._health_status == "network_error":
            return "The camera's address is unreachable from this machine."
        if self._health_status == "offline":
            if self.source_type in ("usb", "webcam"):
                return ("The USB/webcam device did not open. It may be unplugged, "
                        "disabled, or in use by another application.")
            return "The source stopped sending frames."
        return None

    def _update_health_on_failure(self):
        """Classifies a capture failure as connecting/offline/auth_failed/
        network_error. Probing (a real socket round-trip) is rate-limited —
        only re-run every few seconds, not on every fast retry tick."""
        if self._health_status == "blocked":
            # Set only by the SSRF guard in _preflight_network_source, which
            return
        if self.source_type in ("usb", "webcam"):
            self._health_status = "offline" if self._cap_consecutive_failures >= 4 else "connecting"
            return
        if self._cap_consecutive_failures == 0:
            self._health_status = "connecting"
            return
        # A page URL that failed to resolve has already been classified with a
        if self._is_page_url and self._resolve_error:
            self._health_status = "network_error"
            return
        now = time.time()
        if now - self._last_probe_ts < 8.0:
            return
        self._last_probe_ts = now
        from app.health_probe import probe_connection
        result = probe_connection(self.source)
        if result in ("auth_failed", "network_error"):
            self._health_status = result
        else:
            self._health_status = "offline" if self._cap_consecutive_failures >= 4 else "connecting"

    # -----------------------------------------------------------------------
    # Lifecycle
    # -----------------------------------------------------------------------

    def push_frame(self, frame):
        """Receive a frame from the screenshare WebSocket handler."""
        self.incoming_frame = frame
        self._last_push_ts = time.time()
        # Wake the capture loop instead of leaving it to notice on its next
        self._push_event.set()

    def start(self):
        self.running = True
        now0 = time.time()
        for k in self._heartbeat:
            self._heartbeat[k] = now0
        for fn, tag in [
            (self._capture_loop,   "Cap"),
            (self._decode_loop,    "Dec"),
            (self._ai_loop,        "AI"),
            (self._tracking_loop,  "Trk"),
            (self._telemetry_loop, "Tel"),
            (self._ws_dispatch_loop, "WS"),
            (self._watchdog_loop,    "Watchdog"),
        ]:
            t = threading.Thread(target=fn, name=f"{tag}-{self.camera_id}", daemon=True)
            t.start()

    def stop(self):
        self.running = False
        # Join the async model workers. They are daemon threads, so this is not
        for attr in ("_anpr_worker", "_helmet_worker"):
            w = getattr(self, attr, None)
            if w is not None:
                w.stop()
                setattr(self, attr, None)
        # Deregister from the shared tile budget immediately, so the cameras
        self._tile_engine.close()

    def _diagnostic(self, channel: str, message) -> None:
        """Emit costly object-level logs only when an operator asks for them."""
        if not _diagnostic_enabled():
            return
        now = time.monotonic()
        interval = max(0.25, float(getattr(config, "PIPELINE_DIAGNOSTIC_INTERVAL_S", 5.0)))
        if now - self._diagnostic_last.get(channel, 0.0) < interval:
            return
        self._diagnostic_last[channel] = now
        print(message(), flush=True)

    def performance_snapshot(self) -> dict:
        """Return measured stage percentiles without adding work to the video path."""
        telemetry = self.latest_telemetry or {}
        return {
            "backend": self.backend.backend_type if self.backend else "cloud",
            "device": self.backend.backend_device if self.backend else "aws_cloud",
            "fps": {
                "camera": round(_fps(self._cap_ts), 1),
                "decode": round(_fps(self._dec_ts), 1),
                "inference": round(_fps(self._ai_ts), 1),
                "tracking": round(_fps(self._trk_ts), 1),
            },
            "latency_ms": {stage: window.summary() for stage, window in self._latency_windows.items()},
            "bottleneck": telemetry.get("bottleneck"),
            "dropped_frames": telemetry.get("dropped_frames", {}),
            "dropped_total": telemetry.get("dropped_total", 0),
            "frame_age_ms": telemetry.get("frame_age_ms", 0.0),
        }

    def update_config(self, zones_json: str, lines_json: str, rules_json: str = "[]", zone_profile: str = None, profile_features: str = "{}"):
        """Hot-swap this camera's profile. No restart: the next AI cycle reads
        the new zone_profile/profile_features and narrows classes, runs (or
        skips) the face pass, and drives the new zone/line rules accordingly."""
        self.zones = json.loads(zones_json)
        self.lines = json.loads(lines_json)
        self.rules = json.loads(rules_json)
        self.zone_profile = zone_profile
        self.profile_features = json.loads(profile_features) if isinstance(profile_features, str) else (profile_features or {})
        self.analytics.reset_counters()
        self._alert_counts = {}
        # Zones/lines just changed, so the zoom engine's priority map is stale.
        self._push_tile_priority()
        # Counters are per-profile; a security camera's people_in and its
        _releases_face = not self._wants_faces()
        if _releases_face and face_detect.is_loaded():
            face_detect.unload()
        # Same treatment for the helmet model — a second network, so its toggle
        if not self._wants_helmet():
            # Stop the async worker before unloading the model it calls into, or
            hw = getattr(self, "_helmet_worker", None)
            if hw is not None:
                hw.stop()
                self._helmet_worker = None
            if helmet_detect.is_loaded():
                helmet_detect.unload()
        # Same for the ANPR plate detector + its OCR — both separate networks.
        if not self._wants_anpr():
            # Stop the async worker before unloading the models it calls into,
            w = getattr(self, "_anpr_worker", None)
            if w is not None:
                w.stop()
                self._anpr_worker = None
            if plate_detect.is_loaded():
                plate_detect.unload()
            if plate_ocr.is_loaded():
                plate_ocr.unload()
        if not self._wants_micro_motion():
            if hasattr(self, "_micro_motion_detector"):
                self._micro_motion_detector = None

    def _helmet_stats(self):
        """Worker-side helmet timing for telemetry. Mirrors AnprWorker.stats():
        now that the pass is off this thread, its cost no longer shows up in the
        stage latency, so it has to be reported explicitly or a degraded helmet
        model would be invisible."""
        w = self._helmet_worker
        return {
            "passes":       w.passes,
            "dropped":      w.dropped,
            "last_pass_ms": round(w.last_pass_ms, 1),
            "running":      w.is_running(),
            "last_error":   w.last_error,
        }

    def _push_tile_priority(self):
        """Tell the zoom engine which parts of the frame the operator cares
        about, so a scarce tile budget is spent there first (Feature 6).

        A zone the operator drew is, by definition, where a missed detection has
        a consequence — an intrusion zone, an entry gate, a till, a parking bay.
        Weights follow that: an explicitly restricted or ROI-flagged zone
        outranks an ordinary counting zone, and a line (a crossing the operator
        chose to measure) outranks plain background.
        """
        regions = []
        try:
            for z in self.zones:
                pts = z.get("points")
                if not pts:
                    continue
                weight = 1.0
                if z.get("roi"):
                    weight = 2.0
                if str(z.get("type", "")).lower() in ("restricted", "intrusion", "no_entry"):
                    weight = 2.5
                regions.append({"points": pts, "weight": weight})
            for ln in self.lines:
                pts = ln.get("points")
                if pts:
                    regions.append({"points": pts, "weight": 1.5})
        except Exception:
            regions = []
        self._tile_engine.set_priority_regions(regions)

    @staticmethod
    def _feature_enabled(profile_features, key) -> bool:
        """Same isinstance guard as analytics.filter_by_features()/_speed_cfg
        below: a feature's config may be a dict ({"enabled": true, ...}) from
        the normal path, but a caller can also hand a bare bool. `.get()` on
        a bool raises AttributeError, which — thrown every tracking iteration
        — silently zeroed detections behind a wall of recovered exceptions
        rather than failing loudly or degrading gracefully. Treat a bare bool
        as itself; anything else missing/malformed reads as disabled."""
        cfg = (profile_features or {}).get(key)
        if isinstance(cfg, dict):
            return bool(cfg.get("enabled"))
        return bool(cfg)

    def _feature_enabled(self, profile_features: dict, key: str, default: bool = False) -> bool:
        if not profile_features or key not in profile_features:
            return default
        cfg = profile_features.get(key)
        if isinstance(cfg, dict):
            return bool(cfg.get("enabled", default))
        if isinstance(cfg, bool):
            return cfg
        return default

    def _wants_face_detection(self) -> bool:
        if self.profile_features and "face_detection" in self.profile_features:
            return self._feature_enabled(self.profile_features, "face_detection", default=False)
        return self.zone_profile in ("security", "retail", "smart_city", "custom", "factory")

    def _wants_face_recognition(self) -> bool:
        if self.profile_features and any(k in self.profile_features for k in ("face_recognition", "vip_face", "customer_demographics")):
            return (
                self._feature_enabled(self.profile_features, "face_recognition", default=False)
                or self._feature_enabled(self.profile_features, "vip_face", default=False)
                or self._feature_enabled(self.profile_features, "customer_demographics", default=False)
            )
        return self.zone_profile in ("security", "retail", "custom")

    def _wants_faces(self) -> bool:
        return self._wants_face_detection() or self._wants_face_recognition()

    def _wants_helmet(self) -> bool:
        if self.profile_features and any(k in self.profile_features for k in ("helmet_detection", "twowheeler_safety_helmet", "ppe_detection")):
            return (
                self._feature_enabled(self.profile_features, "helmet_detection", default=False)
                or self._feature_enabled(self.profile_features, "twowheeler_safety_helmet", default=False)
                or self._feature_enabled(self.profile_features, "ppe_detection", default=False)
            )
        return self.zone_profile in ("traffic", "factory", "smart_city", "security", "custom")

    def _wants_ppe(self) -> bool:
        if self.profile_features and "ppe_detection" in self.profile_features:
            return self._feature_enabled(self.profile_features, "ppe_detection", default=False)
        return self.zone_profile in ("factory", "custom")

    def _wants_vest(self) -> bool:
        if self.profile_features and ("safety_vest" in self.profile_features or "ppe_detection" in self.profile_features):
            return self._feature_enabled(self.profile_features, "safety_vest", default=False) or self._feature_enabled(self.profile_features, "ppe_detection", default=False)
        return self.zone_profile in ("factory", "custom")

    def _wants_gloves(self) -> bool:
        if self.profile_features and ("gloves" in self.profile_features or "ppe_detection" in self.profile_features):
            return self._feature_enabled(self.profile_features, "gloves", default=False) or self._feature_enabled(self.profile_features, "ppe_detection", default=False)
        return self.zone_profile in ("factory", "custom")

    def _wants_shoes(self) -> bool:
        if self.profile_features and any(k in self.profile_features for k in ("safety_shoes", "shoes", "ppe_detection")):
            return (
                self._feature_enabled(self.profile_features, "safety_shoes", default=False)
                or self._feature_enabled(self.profile_features, "shoes", default=False)
                or self._feature_enabled(self.profile_features, "ppe_detection", default=False)
            )
        return self.zone_profile in ("factory", "custom")

    def _wants_zero_dce(self) -> bool:
        if self.profile_features and any(k in self.profile_features for k in ("zero_dce", "night_vision_zero_dce", "night_vision")):
            return (
                self._feature_enabled(self.profile_features, "zero_dce", default=True)
                or self._feature_enabled(self.profile_features, "night_vision_zero_dce", default=True)
                or self._feature_enabled(self.profile_features, "night_vision", default=True)
            )
        return True  # Auto-gated based on luminance across all standard profiles

    def _wants_fire(self) -> bool:
        if self.profile_features and any(k in self.profile_features for k in ("fire_detection", "smoke_detection")):
            return (
                self._feature_enabled(self.profile_features, "fire_detection", default=False)
                or self._feature_enabled(self.profile_features, "smoke_detection", default=False)
            )
        return self.zone_profile in ("security", "factory", "custom")

    def _wants_forklift(self) -> bool:
        if self.profile_features and "forklift_detection" in self.profile_features:
            return self._feature_enabled(self.profile_features, "forklift_detection", default=False)
        return self.zone_profile in ("factory", "custom")

    def _wants_machine_monitoring(self) -> bool:
        if self.profile_features and "machine_monitoring" in self.profile_features:
            return self._feature_enabled(self.profile_features, "machine_monitoring", default=False)
        return self.zone_profile in ("factory", "custom")

    def _wants_conveyor_monitoring(self) -> bool:
        if self.profile_features and "conveyor_monitoring" in self.profile_features:
            return self._feature_enabled(self.profile_features, "conveyor_monitoring", default=False)
        return self.zone_profile in ("factory", "custom")

    def _wants_anpr(self) -> bool:
        if self.profile_features and any(k in self.profile_features for k in ("anpr", "plate", "municipal_anpr")):
            return self._feature_enabled(self.profile_features, "anpr", default=False) or self._feature_enabled(self.profile_features, "plate", default=False) or self._feature_enabled(self.profile_features, "municipal_anpr", default=False)
        return self.zone_profile in ("traffic", "smart_city", "security", "custom")

    def _wants_micro_motion(self) -> bool:
        if self.profile_features and any(k in self.profile_features for k in ("micro_motion", "micro_motion_hud", "screen_motion")):
            return (
                self._feature_enabled(self.profile_features, "micro_motion", default=True)
                or self._feature_enabled(self.profile_features, "micro_motion_hud", default=True)
                or self._feature_enabled(self.profile_features, "screen_motion", default=True)
            )
        return self.zone_profile in ("micro_motion", "security", "custom", "night", "smart_city", "traffic") or not self.profile_features

    def _wants_custom(self) -> bool:
        if self.profile_features and any(k in self.profile_features for k in ("custom_detector", "custom_detection_zone", "detection_zone")):
            return (
                self._feature_enabled(self.profile_features, "custom_detector", default=False)
                or self._feature_enabled(self.profile_features, "custom_detection_zone", default=False)
                or self._feature_enabled(self.profile_features, "detection_zone", default=False)
            )
        return self.zone_profile in ("custom", "security", "retail", "factory")

    def _wants_tracking(self) -> bool:
        """Returns True ONLY if multi-object tracking is enabled in profile_features."""
        if self.profile_features:
            return self._feature_enabled(self.profile_features, "multi_object_tracking", default=False)
        return True

    def _wants_speed(self) -> bool:
        """Returns True ONLY if speed estimation is enabled in profile_features."""
        if self.profile_features:
            return self._feature_enabled(self.profile_features, "speed_estimation", default=False)
        return False

    def update_display_config(self, max_width: int = None, quality: int = None):
        """Adjust the MJPEG preview encode target at runtime (display only —
        never touches capture, inference, or recording resolution)."""
        if max_width is not None:
            self.display_max_width = max(320, min(1920, int(max_width)))
        if quality is not None:
            self.jpeg_quality = max(30, min(95, int(quality)))

    # MJPEG viewer accounting

    def mjpeg_viewer_attached(self):
        with self._mjpeg_viewer_lock:
            self._mjpeg_viewers += 1
            # Encode the very next frame rather than waiting out a cap
            self._next_mjpeg_due = 0.0

    def mjpeg_viewer_detached(self):
        with self._mjpeg_viewer_lock:
            # max() rather than a bare decrement: a double-release would
            self._mjpeg_viewers = max(0, self._mjpeg_viewers - 1)

    def has_mjpeg_viewers(self) -> bool:
        return self._mjpeg_viewers > 0

    # -----------------------------------------------------------------------
    # Module 1: Video Capture
    # -----------------------------------------------------------------------

    def _generate_synthetic_demo_frame(self, reason: str = "Virtual Demo Stream"):
        """Generates a dynamic 30fps CCTV demo frame with realistic micro-motion or streams test_cctv_motion.mp4."""
        from datetime import datetime

        # 1. Stream test_cctv_motion.mp4 ONLY for virtual/demo camera sources
        test_video_path = os.path.abspath("test_cctv_motion.mp4")
        is_virtual = (self.source_type == "virtual" or "test_cctv" in str(self.source).lower())
        if is_virtual and os.path.exists(test_video_path):
            try:
                if not hasattr(self, "_demo_video_cap") or self._demo_video_cap is None or not self._demo_video_cap.isOpened():
                    self._demo_video_cap = cv2.VideoCapture(test_video_path)
                ret_demo, demo_frame = self._demo_video_cap.read()
                if not ret_demo or demo_frame is None:
                    self._demo_video_cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                    ret_demo, demo_frame = self._demo_video_cap.read()
                if ret_demo and demo_frame is not None:
                    return cv2.resize(demo_frame, (960, 540))
            except Exception as e:
                print(f"[DemoFrame Err] {e}", flush=True)

        w, h = 960, 540
        if not hasattr(self, "_synthetic_frame_buf") or self._synthetic_frame_buf is None:
            self._synthetic_frame_buf = np.zeros((h, w, 3), dtype=np.uint8)
        frame = self._synthetic_frame_buf

        if is_virtual and self.zone_profile == "micro_motion":
            # Low-light CCTV warehouse IR environment for virtual micro-motion demo
            frame[:, :] = (25, 28, 25)
            cv2.rectangle(frame, (100, 100), (300, 400), (35, 40, 35), -1)
            cv2.rectangle(frame, (650, 80), (880, 480), (30, 35, 30), -1)

            t = time.time()
            # Rodent moving across floor
            rx = int(150 + ((t * 80) % 650))
            ry = int(450 + np.sin(t * 3) * 10)
            cv2.ellipse(frame, (rx, ry), (10, 6), 15, 0, 360, (220, 220, 220), -1)
            cv2.putText(frame, "RODENT", (rx - 20, ry - 12), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 255, 64), 1)

            # Fluttering insect near top
            ix = int(700 + np.sin(t * 4) * 40)
            iy = int(150 + np.cos(t * 5) * 30)
            cv2.circle(frame, (ix, iy), 4, (255, 255, 255), -1)
            cv2.putText(frame, "INSECT", (ix - 18, iy - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 255, 64), 1)

            time_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]
            cv2.putText(frame, f"CAM_04 NIGHT_IR  {time_str}", (20, 40), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (200, 200, 200), 1)
            return frame

        # Clean dark slate canvas for live stream reconnects / standby HUD
        frame[:, :] = (20, 22, 26)
        for y in range(0, h, 60):
            cv2.line(frame, (0, y), (w, y), (30, 33, 40), 1)
        for x in range(0, w, 60):
            cv2.line(frame, (x, 0), (x, h), (30, 33, 40), 1)

        time_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]
        cam_name = getattr(self, "camera_id", "CamAI")[:12]
        cv2.putText(frame, f"CamAI Node | {cam_name}", (20, 35), cv2.FONT_HERSHEY_SIMPLEX, 0.65, (0, 255, 200), 2)
        cv2.putText(frame, f"TIMESTAMP: {time_str}", (20, 65), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (200, 200, 200), 1)
        cv2.putText(frame, f"STATUS: {reason}", (20, 90), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 200, 255), 1)
        cv2.circle(frame, (w - 30, 35), 8, (0, 165, 255), -1)
        cv2.putText(frame, "RECONNECTING", (w - 140, 40), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 165, 255), 1)
        return frame

    def _capture_loop(self):
        """
        Module 1: Capture + Decode in one thread.

        cv2.VideoCapture is NOT thread-safe — grab() and retrieve() must be
        called from the same thread. We therefore do a full cap.read() here
        and push the decoded frame directly into _grabbed_slot (renamed
        semantically: it now holds frames, not just grab tokens).
        Module 2 handles only JPEG encoding and the MJPEG stream update.
        """
        self.recorder.start_continuous()

        self._cap_hw_accel = True
        self._file_frame_interval = 0.0

        def _refresh_file_pacing():
            if not self._is_video_file or self.cap is None:
                self._file_frame_interval = 0.0
                return
            try:
                declared = float(self.cap.get(cv2.CAP_PROP_FPS))
            except Exception:
                declared = 0.0
            target_pacing_fps = declared if 1.0 <= declared <= 120.0 else 25.0
            self._file_frame_interval = 1.0 / target_pacing_fps

        next_frame_due = time.time()

        src = None
        if self.source_type not in ("screenshare", "screen_share", "virtual"):
            src = self._capture_source()
            if src is None:
                self._cap_consecutive_failures += 1
                self._update_health_on_failure()
                self.publish_source_status()
            elif self._preflight_network_source():
                self.cap = self._open_capture(src, hw_accel=self._cap_hw_accel)
                if self.cap.isOpened():
                    self.cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
                    if self.source_type in ("usb", "webcam") or isinstance(self.source, int):
                        self.cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*"MJPG"))
                    _refresh_file_pacing()
                    print(f"[Cap-{self.camera_id}] Opened source: {self._source_label(src)}", flush=True)
                else:
                    self._cap_consecutive_failures += 1
                    self._update_health_on_failure()
                    self.publish_source_status()
                    print(f"[Cap-{self.camera_id}] Cannot open source: {self._source_label(src)}", flush=True)
            else:
                self._cap_consecutive_failures += 1
                self._update_health_on_failure()
                self.publish_source_status()

        last_good_frame_ts = time.time()

        while self.running:
            try:
                t0 = time.time()

                if self.source_type not in ("screenshare", "screen_share", "virtual"):
                    if self.cap is None or not self.cap.isOpened():
                        if self.cap is not None:
                            self.cap.release()
                            self.cap = None
                        
                        # Non-blocking reconnect throttling: attempt physical capture open every 5s for network streams
                        now_ts = time.time()
                        reconnect_delay = 5.0 if self.source_type == "rtsp" or "://" in str(self.source) else 2.0
                        if not hasattr(self, "_last_reconnect_attempt") or (now_ts - getattr(self, "_last_reconnect_attempt", 0) > reconnect_delay):
                            self._last_reconnect_attempt = now_ts
                            if self._preflight_network_source():
                                src = self._capture_source(refresh=self._is_page_url)
                                if src:
                                    self.cap = self._open_capture(src, hw_accel=self._cap_hw_accel)
                                    if self.cap and self.cap.isOpened():
                                        self.cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
                                        if self.source_type in ("usb", "webcam") or isinstance(self.source, int):
                                            self.cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*"MJPG"))
                                        _refresh_file_pacing()
                                        next_frame_due = time.time()
                                        self._cap_consecutive_failures = 0
                                        self._health_status = "online"
                                        ret, frame = self.cap.read()

                        if self.cap is None or not self.cap.isOpened():
                            self._cap_consecutive_failures += 1
                            self._update_health_on_failure()
                            frame = self._generate_synthetic_demo_frame(f"Camera {self.camera_id[:4]} Standby")
                            self._health_status = "connecting"
                            self._last_resolution = "960x540"
                            self.publish_source_status()
                            self._is_standby_frame = True
                            time.sleep(0.033)  # Maintain smooth 30fps playback during standby/recovery
                    else:
                        ret, frame = self.cap.read()

                        if (not ret or frame is None) and self._is_video_file:
                            self.cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                            ret, frame = self.cap.read()
                            if not ret or frame is None:
                                self.cap.set(cv2.CAP_PROP_POS_MSEC, 0)
                                ret, frame = self.cap.read()

                        if not ret or frame is None:
                            if not self._is_video_file and time.time() - last_good_frame_ts > 3.0:
                                print(f"[Cap-{self.camera_id}] No frames for 3s, forcing reconnect...", flush=True)
                                self.cap.release()
                                self.cap = None
                                last_good_frame_ts = time.time()
                                self._cap_consecutive_failures += 1
                                if self._cap_hw_accel and self._cap_consecutive_failures >= 1:
                                    self._cap_hw_accel = False
                                self._update_health_on_failure()
                            # Hold the last good frame for brief drops (<3s) to
                            if hasattr(self, "_last_good_frame") and self._last_good_frame is not None and time.time() - last_good_frame_ts < 3.0:
                                frame = self._last_good_frame
                            else:
                                frame = self._generate_synthetic_demo_frame("Stream Recovery")
                                self._is_standby_frame = True
                                if self._health_status != "connecting":
                                    self._health_status = "connecting"
                                    self.publish_source_status()
                                self._last_resolution = "960x540"
                            time.sleep(0.033)
                        else:
                            last_good_frame_ts = time.time()
                            self._last_good_frame = frame
                            self._cap_consecutive_failures = 0
                            self._is_standby_frame = False
                            if self._health_status != "online":
                                self._health_status = "online"
                                self.publish_source_status()
                            if frame is not None:
                                self._last_resolution = f"{frame.shape[1]}x{frame.shape[0]}"

                else:
                    if self.incoming_frame is None:
                        self._push_event.wait(0.033)
                    self._push_event.clear()
                    frame = self.incoming_frame
                    self.incoming_frame = None
                    if frame is not None:
                        # Real push arrived — hold it for reuse between pushes
                        self._last_virtual_frame = frame
                        self._is_standby_frame = False
                        last_good_frame_ts = time.time()
                    elif hasattr(self, "_last_virtual_frame") and self._last_virtual_frame is not None:
                        # Between pushes: reuse the last real frame instead of
                        frame = self._last_virtual_frame
                        self._is_standby_frame = False
                    else:
                        # No frame has ever been pushed — show standby demo.
                        frame = self._generate_synthetic_demo_frame("Virtual Live Stream")
                        self._is_standby_frame = True
                    self._health_status = "online"
                    self._last_resolution = f"{frame.shape[1]}x{frame.shape[0]}"

                t_cap = time.time()
                cap_lat = (t_cap - t0) * 1000
                self._cap_ts.append(t_cap)
                self._frame_seq_id = getattr(self, "_frame_seq_id", 0) + 1

                # Put frame into slot — overwrites if Module 2 is still busy (latest wins)
                self._grabbed_slot.put({
                    "frame_id":   self._frame_seq_id,
                    "cap_time":   t_cap,
                    "cap_lat":    cap_lat,
                    "frame":      frame,
                    "is_standby": getattr(self, "_is_standby_frame", False),
                })
                self._heartbeat["cap"] = time.time()

                # Hold a FILE source to its own frame rate per frame
                if self._file_frame_interval > 0.0:
                    t_elapsed = time.time() - t0
                    slack = self._file_frame_interval - t_elapsed
                    if slack > 0:
                        time.sleep(slack)

            except (Exception, MemoryError) as e:
                # Never let a single bad frame/driver hiccup kill this thread —
                self._stage_errors["cap"] += 1
                print(f"[Cap-{self.camera_id}] ERROR (recovered): {e}", flush=True)
                traceback.print_exc()
                time.sleep(0.2)

        if self.cap:
            self.cap.release()
        self.recorder.force_stop_all()

    # -----------------------------------------------------------------------
    # Module 2: MJPEG Encoder
    # -----------------------------------------------------------------------

    def _decode_loop(self):
        while self.running:
            data = self._grabbed_slot.take()
            if data is None:
                continue  # _Slot.take() already sleeps up to timeout internally

            try:
                t0    = time.time()
                frame = data["frame"]

                # Apply privacy masks (solid black blackout) to raw frame before MJPEG encode or AI
                h, w = frame.shape[:2]
                for zone in self.zones:
                    if zone.get("zoneType") == "privacy_mask":
                        pts = zone.get("points", [])
                        if len(pts) >= 2:
                            pts_px = np.array([[p[0] * w, p[1] * h] for p in pts], dtype=np.int32)
                            cv2.fillPoly(frame, [pts_px], (0, 0, 0))

                # Zero-DCE Night-Vision AI Enhancement (Per-Camera Controlled)
                try:
                    from app.ai.enhancer import zero_dce
                    is_enabled = self._wants_zero_dce()
                    nv_cfg = self.profile_features.get("zero_dce") or self.profile_features.get("night_vision_zero_dce") or self.profile_features.get("night_vision")
                    params = nv_cfg.get("params", {}) if isinstance(nv_cfg, dict) and isinstance(nv_cfg.get("params"), dict) else {}

                    mode = str(params.get("mode", getattr(self, "zero_dce_mode", "auto"))).lower()
                    raw_thresh = params.get("threshold", getattr(self, "zero_dce_threshold", 140.0))
                    try:
                        thresh = float(raw_thresh)
                    except (ValueError, TypeError):
                        thresh = 140.0

                    force_on = (mode in ("on", "always_on", "forced", "always", "manual", "true", "1")) or (self.zone_profile in ("micro_motion", "night_vision"))
                    if is_enabled and mode != "off":
                        _now_zd = time.time()
                        if not hasattr(self, "_last_lum_val") or (_now_zd - getattr(self, "_last_lum_check_ts", 0.0) >= 0.4):
                            self._last_lum_check_ts = _now_zd
                            self._last_lum_val = round(zero_dce.calculate_luminance(frame), 1)
                        lum_fast = getattr(self, "_last_lum_val", 128.0)
                    else:
                        lum_fast = 128.0

                    scene_is_dark = lum_fast < max(70.0, min(120.0, thresh))
                    if is_enabled and mode != "off" and (scene_is_dark or (force_on and lum_fast < 130.0)):
                        # Enhance low-light frames
                        frame, dce_stats = zero_dce.enhance(
                            frame,
                            override_threshold=thresh,
                            force_enable=force_on and scene_is_dark,
                        )
                        data["frame"] = frame          # AI slot reads data["frame"]
                        data["zero_dce_stats"] = dce_stats
                    else:
                        # Daylight/normal light bypass — record luminance for HUD telemetry with 0ms latency
                        data["zero_dce_stats"] = {
                            "zero_dce_applied": False,
                            "mean_luminance": lum_fast,
                            "method": "daylight_bypass" if is_enabled else "off",
                            "latency_ms": 0.0,
                        }
                except Exception as e:
                    print(f"[Zero-DCE Err] {e}", flush=True)
                    data["zero_dce_stats"] = {
                        "zero_dce_applied": False,
                        "mean_luminance": 128.0,
                        "method": "error",
                        "latency_ms": 0.0,
                    }


                # Hand the frame to the AI stage FIRST
                dec_lat = (time.time() - t0) * 1000
                self._dec_ts.append(time.time())
                self._decoded_slot.put({
                    **data,
                    "dec_lat": dec_lat,
                })

                # MJPEG stream: demand-driven, capped, never blocked by AI
                if self._mjpeg_viewers > 0:
                    now_enc = time.monotonic()
                    if now_enc >= self._next_mjpeg_due:
                        mjpeg_fps_cap = MJPEG_MAX_FPS if MJPEG_MAX_FPS > 0 else 30.0
                        self._next_mjpeg_due = now_enc + (1.0 / mjpeg_fps_cap)

                        target_w = min(1280, self.display_max_width)
                        h, w = frame.shape[:2]
                        if w != target_w:
                            target_h = max(180, int(h * (target_w / w)))
                            mjpeg_f = cv2.resize(frame, (target_w, target_h), interpolation=cv2.INTER_LINEAR)
                        else:
                            mjpeg_f = frame.copy()

                        with self._overlay_lock:
                            latest_dets = list(getattr(self, "_latest_overlay_dets", []))
                            latest_ts   = getattr(self, "_latest_overlay_ts", 0.0)

                        # Enable frame-synchronized MJPEG overlay burn-in: ensures bounding boxes and video pixels
                        burnin_overlay = os.getenv("CAMAI_BURNIN_OVERLAY", "0").strip() == "1"
                        if burnin_overlay and latest_dets and (time.time() - latest_ts < 0.6):
                            _draw_normalized_overlay_boxes(mjpeg_f, latest_dets)

                        q = max(50, min(85, self.jpeg_quality))
                        ok, jpg = cv2.imencode('.jpg', mjpeg_f, [cv2.IMWRITE_JPEG_QUALITY, q])
                        if ok:
                            with self.jpeg_lock:
                                self.current_jpeg_bytes = jpg.tobytes()
                                self.jpeg_sequence_id = (self.jpeg_sequence_id + 1) & 0x7FFFFFFF
                            self.jpeg_ready_event.set()

                # Recording (non-blocking async queue, with latest AI detections)
                with self._overlay_lock:
                    rec_dets = list(getattr(self, "_latest_overlay_dets", [])) if (time.time() - getattr(self, "_latest_overlay_ts", 0.0) < 0.8) else None
                self.recorder.push_frame(frame, rec_dets)

                self._heartbeat["dec"] = time.time()

            except Exception as e:
                self._stage_errors["dec"] += 1
                print(f"[Dec-{self.camera_id}] ERROR (recovered): {e}", flush=True)
                traceback.print_exc()
                self._heartbeat["dec"] = time.time()

    # -----------------------------------------------------------------------
    # Module 3: AI Inference
    # -----------------------------------------------------------------------

    def _ai_loop(self):
        # Warm up this thread's dedicated InferRequest (see EngineBackend.
        try:
            backend = self.backend
            if backend is not None:
                dummy = np.zeros((self.current_imgsz, self.current_imgsz, 3), dtype=np.uint8)
                tensor, _ = backend.preprocess(dummy, self.current_imgsz)
                backend.run_inference(tensor)
                print(f"[AI-{self.camera_id}] Warm-up inference complete (imgsz={self.current_imgsz}).", flush=True)
            else:
                print(f"[AI-{self.camera_id}] Warm-up inference skipped (backend model not loaded yet).", flush=True)
        except Exception as e:
            print(f"[AI-{self.camera_id}] Warm-up inference failed (will retry on first real frame): {e}", flush=True)
        self._heartbeat["ai"] = time.time()

        while self.running:
            data = self._decoded_slot.take_latest()
            if data is None:
                continue  # _Slot.take_latest() already sleeps internally

            # Calculate frame queue age (time spent waiting before AI processing starts)
            cap_ts = data.get("cap_time", time.time())
            ai_queue_age = (time.time() - cap_ts) * 1000.0
            if ai_queue_age > 40.0:
                fresh = self._decoded_slot.take_latest()
                if fresh is not None:
                    data = fresh
                    cap_ts = data.get("cap_time", time.time())
                    ai_queue_age = (time.time() - cap_ts) * 1000.0
            data["ai_queue_age"] = round(ai_queue_age, 1)

            try:
                self._ai_loop_iteration(data)
                self._heartbeat["ai"] = time.time()
            except Exception as e:
                self._stage_errors["ai"] += 1
                print(f"[AI-{self.camera_id}] ERROR (recovered): {e}", flush=True)
                traceback.print_exc()
                self._heartbeat["ai"] = time.time()

        # Release thread-local infer request and hardware buffers on thread exit
        backend = self.backend
        if backend is not None:
            backend.release_thread_request()

    def _ai_loop_iteration(self, data):
        """Mode-routing dispatcher — reads config.INFERENCE_MODE each iteration.

        CLOUD mode: encode frame → cloud HTTP → parse → _ai_slot
        LOCAL mode: YOLO local inference → _ai_slot  (unchanged path)
        """
        from app import config
        mode = getattr(config, "INFERENCE_MODE", "local").strip().lower()
        if mode == "cloud":
            now = time.time()
            if getattr(self, "_cloud_offline", False):
                # Auto-recovery probe: try cloud inference every 2.0s instead of permanent lockout
                if now - getattr(self, "_last_cloud_retry_ts", 0.0) >= 2.0:
                    self._last_cloud_retry_ts = now
                    self._ai_loop_iteration_cloud(data)
                else:
                    self._ai_loop_iteration_local(data)
            else:
                self._ai_loop_iteration_cloud(data)
        else:
            self._ai_loop_iteration_local(data)


    # ------------------------------------------------------------------
    # Module 3-CLOUD: Send frame to cloud endpoint, inject detections
    # ------------------------------------------------------------------

    def _ai_loop_iteration_cloud(self, data):
        """Cloud inference path. Encodes the decoded frame as JPEG, POSTs it
        to the configured cloud endpoint, and feeds the parsed detections
        directly into _ai_slot so the tracking/telemetry pipeline is unchanged.
        """
        from app import config
        from app.ai.cloud_client import detect as cloud_detect, CloudOfflineError

        frame    = data["frame"]
        orig_h, orig_w = frame.shape[:2]
        t0_cloud = time.perf_counter()

        now_ts = time.time()
        cloud_url = getattr(config, "CLOUD_ENDPOINT_URL", "").strip()
        cloud_key = getattr(config, "CLOUD_API_KEY", "").strip()

        if not cloud_url:
            self._cloud_offline = True
            if self.backend is None:
                try:
                    from app.camera_manager import manager
                    self.backend = manager.ensure_backend_loaded()
                except Exception:
                    pass
            if self.backend is not None:
                self._ai_loop_iteration_local(data)
                return

        # If previously marked offline, periodically retry cloud every 4.0s
        if getattr(self, "_cloud_offline", False):
            last_retry = getattr(self, "_cloud_last_retry_attempt", 0.0)
            if now_ts - last_retry < 4.0:
                if self.backend is None:
                    try:
                        from app.camera_manager import manager
                        self.backend = manager.ensure_backend_loaded()
                    except Exception:
                        pass
                if self.backend is not None:
                    self._ai_loop_iteration_local(data)
                    return
            self._cloud_last_retry_attempt = now_ts

        if getattr(self, "_is_standby_frame", False):
            with self._overlay_lock:
                self._latest_overlay_dets = []
                self._latest_raw_dets     = []
            self._ai_slot.put({
                **data,
                "detections":     [],
                "masks_polygons": [],
                "motion":         False,
                "micro_motion_stats": self._motion_stats,
                "orig_h":         orig_h,
                "orig_w":         orig_w,
                "conf_thresh":    0.3,
                "t_pre": 0.0, "t_inf": 0.0, "t_post": 0.0, "ai_lat": 0.0,
            })
            return

        _now_cloud = time.time()
        if _now_cloud - getattr(self, "_last_cloud_req_ts", 0.0) < 0.04:
            # High-throughput streaming: forward previous raw pixel detections to coast tracker
            with self._overlay_lock:
                prev_dets = list(getattr(self, "_latest_raw_dets", []))
            self._ai_ts.append(time.time())
            self._ai_slot.put({
                **data,
                "detections":     prev_dets,
                "masks_polygons": [],
                "motion":         False,
                "micro_motion_stats": self._motion_stats,
                "orig_h":         orig_h,
                "orig_w":         orig_w,
                "conf_thresh":    0.3,
                "t_pre": 0.0, "t_inf": 0.0, "t_post": 0.0, "ai_lat": 0.0,
            })
            return
        self._last_cloud_req_ts = _now_cloud

        try:
            detections = cloud_detect(
                frame,
                endpoint_url=cloud_url,
                api_key=cloud_key,
                jpeg_quality=65,
                timeout_s=2.5,
                camera_id=self.camera_id,
                target_size=480,
            )
            t_inf = (time.perf_counter() - t0_cloud) * 1000

            # Successful cloud inference - clear offline flag
            if getattr(self, "_cloud_offline", False):
                print(f"[AI-{self.camera_id}] Cloud endpoint recovered — cloud detections resuming seamlessly.", flush=True)
            self._cloud_offline = False
            self._cloud_consecutive_fails = 0
            self._cloud_offline_logged = False
            self._last_infer_ts = time.time()

            # Match custom target reference images on cloud detections
            if self._wants_faces():
                try:
                    from app.ai.target_matcher import target_matcher
                    detections = target_matcher.match_detections(frame, detections)
                except Exception as e:
                    print(f"[Cloud TargetMatcher Err] {e}", flush=True)

            # If cloud mode returns 0 detections, check if local backend is available for extra coverage
            if not detections and self.backend is not None:
                self._ai_loop_iteration_local(data)
                return

            # Cache latest raw detections for tracker coasting
            with self._overlay_lock:
                self._latest_raw_dets = list(detections) if detections else []

            # Throttled heartbeat log
            _now = time.time()
            if _now - getattr(self, "_last_det_log_ts", 0.0) >= 5.0:
                self._last_det_log_ts = _now
                print(f"[AI-{self.camera_id}] [CLOUD] Inference OK: dets={len(detections)} "
                      f"latency={t_inf:.0f}ms endpoint={cloud_url}", flush=True)

            self._ai_ts.append(time.time())
            self._ai_slot.put({
                **data,
                "detections":     detections,
                "masks_polygons": [],
                "motion":         True if detections else False,
                "micro_motion_stats": self._motion_stats,
                "orig_h":         orig_h,
                "orig_w":         orig_w,
                "conf_thresh":    0.3,
                "t_pre": 0.0, "t_inf": round(t_inf, 1), "t_post": 0.0,
                "ai_lat": round(t_inf, 1),
            })

        except (CloudOfflineError, Exception) as exc:
            now_ts = time.time()
            fails = getattr(self, "_cloud_consecutive_fails", 0) + 1
            self._cloud_consecutive_fails = fails
            if not getattr(self, "_cloud_offline", False) or now_ts - getattr(self, "_cloud_last_err_log", 0.0) >= 15.0:
                print(f"[AI-{self.camera_id}] CLOUD OFFLINE/ERROR: {exc}. Falling back to local engine...", flush=True)
                self._cloud_last_err_log = now_ts
            self._cloud_offline = True

            if self.backend is None:
                try:
                    from app.camera_manager import manager
                    self.backend = manager.ensure_backend_loaded()
                except Exception:
                    pass

            if self.backend is not None:
                self._ai_loop_iteration_local(data)
            else:
                with self._overlay_lock:
                    cached_dets = list(getattr(self, "_latest_raw_dets", []))
                age = time.time() - getattr(self, "_last_infer_ts", 0.0)
                coasted_dets = cached_dets if (cached_dets and age < 2.0) else []
                self._ai_slot.put({
                    **data,
                    "detections":     coasted_dets,
                    "masks_polygons": [],
                    "motion":         False,
                    "micro_motion_stats": self._motion_stats,
                    "orig_h":         orig_h,
                    "orig_w":         orig_w,
                    "conf_thresh":    0.3,
                    "t_pre": 0.0, "t_inf": 0.0, "t_post": 0.0, "ai_lat": 0.0,
                })

    # ------------------------------------------------------------------
    # Module 3-LOCAL: Original YOLO local inference path (unchanged)
    # ------------------------------------------------------------------

    def _ai_loop_iteration_local(self, data):
            frame   = data["frame"]
            orig_h, orig_w = frame.shape[:2]

            backend = self.backend
            if backend is None:
                try:
                    from app.camera_manager import manager
                    backend = manager.ensure_backend_loaded()
                    self.backend = backend
                except Exception as e:
                    print(f"[AI-{self.camera_id}] Backend auto-load retry error: {e}", flush=True)
                    backend = None

            if backend is None:
                self._ai_ts.append(time.time())
                self._ai_slot.put({
                    **data,
                    "detections":     [],
                    "masks_polygons": [],
                    "motion":         False,
                    "micro_motion_stats": self._motion_stats,
                    "orig_h":         orig_h,
                    "orig_w":         orig_w,
                    "conf_thresh":    0.3,
                    "t_pre": 0.0, "t_inf": 0.0, "t_post": 0.0, "ai_lat": 0.0,
                })
                time.sleep(0.033)
                return

            # ROI Pre-Crop: If camera has ROI or drawn polygon zones, compute crop first
            roi = self._get_roi(orig_h, orig_w)
            if roi:
                rx1, ry1, rx2, ry2 = roi
                inf_frame = frame[ry1:ry2, rx1:rx2]
                rh, rw    = inf_frame.shape[:2]
            else:
                inf_frame = frame
                rh, rw    = orig_h, orig_w

            # Zero-DCE low-light enhancement is already performed in Module 2 (_decode_loop)

            # Detect motion inside the effective ROI crop to avoid motion outside ROI
            motion_stats = self._analyze_motion(inf_frame)
            motion = bool(motion_stats.get("motion", False))
            self._motion_stats = motion_stats


            # Keyframe Subsampling (Phase 1 Optimization):
            self._ai_frame_count = getattr(self, "_ai_frame_count", 0) + 1
            keyframe_interval = max(1, int(os.getenv("CAMAI_AI_KEYFRAME_INTERVAL", "1")))

            low_light = bool(motion_stats.get("low_light", False))
            force_interval = self._FORCE_INFER_INTERVAL
            force_infer = (time.time() - self._last_infer_ts) > force_interval

            if data.get("is_standby", False):
                should_infer = False
            elif motion or force_infer or keyframe_interval == 1 or (self._ai_frame_count % keyframe_interval == 0):
                should_infer = True
            else:
                should_infer = False

            detections:     list = []
            masks_polygons: list = []
            t_pre = t_inf = t_post = t_inf_base = 0.0
            # Read once per cycle, not once per process: set_detection_confidence
            base_conf   = get_detection_confidence()
            conf_thresh = base_conf
            iou_thresh  = 0.45

            if should_infer:
                n_tracks    = len(self.tracker.tracks)
                crowded     = n_tracks > CROWDED_TRACK_COUNT
                conf_thresh = round(base_conf * CROWDED_CONF_RATIO, 3) if crowded else base_conf
                if low_light or self.zone_profile in ("micro_motion", "night_vision"):
                    # Low light reduces detector confidence before it reduces
                    conf_thresh = max(MIN_CONFIDENCE, round(conf_thresh * 0.78, 3))
                iou_thresh  = 0.65 if crowded else 0.45

                # Invisible AI Zoom Engine (app.ai.tiling). Runs the same single
                tile_res = self._tile_engine.infer(
                    backend, inf_frame,
                    base_imgsz=self.current_imgsz,
                    conf_thresh=conf_thresh,
                    iou_thresh=iou_thresh,
                    min_imgsz=self.min_imgsz,
                    max_imgsz=self.max_imgsz,
                    n_tracks=self._n_active_tracks,
                    # `inf_frame` may be a zone-derived ROI crop of the camera
                    geometry_shape=(orig_h, orig_w),
                    # Cycle time budget constraint for adaptive tiling passes
                    cycle_budget_ms=min(getattr(config, "TILING_LATENCY_BUDGET_MS", 20.0), 1000.0 / max(1.0, self.target_fps)),
                )
                detections     = tile_res.detections
                masks_polygons = tile_res.masks
                t_pre, t_post  = tile_res.t_pre, tile_res.t_post
                t_inf          = tile_res.t_inf



                # Adaptive-resolution tuning below must see the cost of ONE
                t_inf_base     = tile_res.t_inf_base
                self._tile_stats = tile_res.stats

                # Translate ROI-relative coords back to full-frame coords
                if roi:
                    rx1, ry1 = roi[0], roi[1]
                    for det in detections:
                        det["bbox"]["x1"] += rx1; det["bbox"]["y1"] += ry1
                        det["bbox"]["x2"] += rx1; det["bbox"]["y2"] += ry1
                    scaled = []
                    for poly in masks_polygons:
                        if not poly:
                            scaled.append([]); continue
                        scaled.append([
                            [round((p[0]*rw + rx1) / orig_w, 3),
                             round((p[1]*rh + ry1) / orig_h, 3)]
                            for p in poly
                        ])
                    masks_polygons = scaled

                # Custom Visual Embedding Matcher & Target Image Matcher
                if self._wants_face_recognition():
                    try:
                        from app.ai.target_matcher import target_matcher
                        detections = target_matcher.match_detections(frame, detections)
                    except Exception as e:
                        print(f"[TargetMatcher Err] {e}", flush=True)

                if self._wants_custom():
                    try:
                        from app.ai.custom_detector import match_crop, has_active_custom_models
                        if has_active_custom_models():
                            # Evaluate only top 3 detections with confidence >= 0.45 to prevent PyTorch inference lag
                            candidates = [d for d in detections if float(d.get("confidence", 0.0)) >= 0.45]
                            candidates = sorted(candidates, key=lambda d: float(d.get("confidence", 0.0)), reverse=True)[:3]
                            for det in candidates:
                                b = det["bbox"]
                                x1 = max(0, min(orig_w - 1, int(b["x1"])))
                                y1 = max(0, min(orig_h - 1, int(b["y1"])))
                                x2 = max(0, min(orig_w - 1, int(b["x2"])))
                                y2 = max(0, min(orig_h - 1, int(b["y2"])))
                                crop = frame[y1:y2, x1:x2]
                                if crop.size > 0:
                                    is_match, similarity, matched_name = match_crop(crop, threshold=0.65)
                                    current_cls = str(det.get("class", "")).lower()
                                    yolo_conf = float(det.get("confidence", 0.0))
                                    is_primary = current_cls in ("car", "person", "truck", "bus", "motorcycle", "bicycle", "vehicle")
                                    # Overwrite label ONLY if strict threshold (0.65) is passed AND primary class is not overwritten falsely
                                    if is_match and matched_name:
                                        if not is_primary or similarity > (yolo_conf + 0.15) or self.zone_profile == "custom":
                                            det["class"] = matched_name
                                            det["confidence"] = round(float(similarity), 2)
                                            det["custom_match"] = True
                                            det["label"] = f"{matched_name} ({int(similarity * 100)}%)"
                    except Exception as e:
                        print(f"[CustomDetector Err] {e}", flush=True)

                # User Polygon Zone Gate
                if self.zones and detections:
                    num_before = len(detections)
                    detections = filter_detections_by_user_zones(detections, self.zones, orig_w, orig_h)
                    if len(detections) != num_before and masks_polygons:
                        masks_polygons = masks_polygons[:len(detections)]

                self._last_infer_ts = time.time()

                # Throttled inference/detection heartbeat (~every 5s per camera).
                _now = time.time()
                if _now - getattr(self, "_last_det_log_ts", 0.0) >= 5.0:
                    self._last_det_log_ts = _now
                    _bt = getattr(backend, "backend_type", "?")
                    _dev = getattr(backend, "backend_device", "?")
                    _ts = self._tile_stats
                    print(f"[AI-{self.camera_id}] Inference OK: dets={len(detections)} "
                          f"infer={t_inf:.1f}ms (base {t_inf_base:.1f}ms) backend={_bt}/{_dev} "
                          f"imgsz={self.current_imgsz} zoom={_ts.get('grid', 1)}x"
                          f"{_ts.get('grid', 1)} tiles={_ts.get('tiles_inferred', 0)}"
                          f"+{_ts.get('tiles_cached', 0)}cached/{_ts.get('budget_tiles', 0)}budget "
                          f"boost={_ts.get('boost_passes', 0)}", flush=True)

            # Adaptive resolution tuning based on rolling inference latency.
            static = getattr(self.backend, "static_imgsz", None)
            if static is not None and self.current_imgsz != static:
                self.current_imgsz = static
                self.min_imgsz = self.max_imgsz = static
                self._pin_imgsz = True
            if should_infer and t_inf_base > 0 and static is None and not getattr(self, "_pin_imgsz", False):
                self._latency_history.append(t_inf_base)
                if len(self._latency_history) > 10:
                    self._latency_history.pop(0)
                    avg = sum(self._latency_history) / len(self._latency_history)
                    step_down = {1280: 960, 960: 640, 640: 320}
                    step_up   = {320: 640, 640: 960, 960: 1280}
                    if avg > 100 and self.current_imgsz > self.min_imgsz:
                        self.current_imgsz = step_down.get(self.current_imgsz, self.current_imgsz)
                    elif avg < 40 and self.current_imgsz < self.max_imgsz:
                        self.current_imgsz = step_up.get(self.current_imgsz, self.current_imgsz)

            self._ai_ts.append(time.time())

            self._ai_slot.put({
                **data,
                "detections":    detections,
                "masks_polygons": masks_polygons,
                "motion":         should_infer,
                "micro_motion_stats": motion_stats,
                "orig_h":         orig_h,
                "orig_w":         orig_w,
                "conf_thresh":    conf_thresh,
                "t_pre":          t_pre,
                "t_inf":          t_inf,
                "t_post":         t_post,
                "ai_lat":         t_pre + t_inf + t_post,
            })

    # -----------------------------------------------------------------------
    # Module 4: Multi-Object Tracking + Rule Engine
    # -----------------------------------------------------------------------

    def _tracking_loop(self):
        self._trk_last_history_log = 0.0
        while self.running:
            data = self._ai_slot.take_latest()
            if data is None:
                continue  # _Slot.take_latest() already sleeps internally

            try:
                self._tracking_loop_iteration(data)
                self._heartbeat["trk"] = time.time()
            except Exception as e:
                self._stage_errors["trk"] += 1
                print(f"[Trk-{self.camera_id}] ERROR (recovered): {e}", flush=True)
                traceback.print_exc()
                self._heartbeat["trk"] = time.time()

    def _tracking_loop_iteration(self, data):
            last_history_log = self._trk_last_history_log
            t0         = time.time()
            frame      = data["frame"]
            detections = data["detections"]   # absolute pixel coords from YOLO
            masks      = data["masks_polygons"]
            orig_w     = data["orig_w"]
            orig_h     = data["orig_h"]

            # Out-of-order & Stale frame guard: if frame_id is older than last tracked frame or frame_age > 350ms, treat as predict_only
            cur_fid = data.get("frame_id", 0)
            last_fid = getattr(self, "_last_tracked_fid", 0)

            if cur_fid > 0 and cur_fid < last_fid:
                data["motion"] = False
            elif cur_fid > 0:
                self._last_tracked_fid = cur_fid

            # Track: input and output in absolute pixel coords
            if self._wants_tracking():
                if data["motion"]:
                    tracks_raw = self.tracker.update(
                        detections, frame=frame, frame_shape=(orig_h, orig_w), conf_thresh=data["conf_thresh"]
                    )
                else:
                    tracks_raw = self.tracker.predict_only()
                self._n_active_tracks = len(self.tracker.tracks)
                detections, masks = resolve_emitted_detections(
                    self.tracker, tracks_raw, detections, masks
                )
            else:
                tracks_raw = []
                if hasattr(self.tracker, "reset"):
                    self.tracker.reset()
                self._n_active_tracks = 0

            self._diagnostic("tracked", lambda: (
                "[CLOUD_DIAG] [TRACKED_OBJECTS] Camera={} Count={} Tracks={}".format(
                    self.camera_id,
                    len(tracks_raw),
                    [f"{t['track_id']}:{t['class']}:{t['confidence']}:({int(t['bbox']['x1'])},{int(t['bbox']['y1'])},{int(t['bbox']['x2'])},{int(t['bbox']['y2'])})" for t in tracks_raw],
                )
            ))

            # ── Face pass: a SECOND model, and the only module here whose
            # toggle actually saves inference time when off ────────────────
            face_cfg = (self.profile_features or {}).get("face_detection")
            if not isinstance(face_cfg, dict):
                face_cfg = {}
            t_face0 = time.perf_counter()
            if self._wants_faces():
                fd = face_detect.get_detector(float(face_cfg.get("confidence", 0.6)))
                if fd is not None:
                    person_boxes = [d["bbox"] for d in detections if d.get("class") == "person"]
                    if not person_boxes:
                        h_f, w_f = frame.shape[:2]
                        person_boxes = [{"x1": 0, "y1": 0, "x2": w_f, "y2": h_f}]
                    faces = fd.detect_in_persons(frame, person_boxes)
                    for fdet in faces:
                        detections.append(fdet)
                        # masks stays index-parallel with detections (see the
                        masks.append([])
                    if fd.last_error:
                        self._stage_errors["face"] = fd.last_error
                        fd.last_error = None
            t_face = (time.perf_counter() - t_face0) * 1000

            # Helmet pass: a THIRD model (YOLOv8), gated exactly like faces
            t_helmet0 = time.perf_counter()
            _now_sec = time.time()
            if self._wants_helmet():
                hworker = getattr(self, "_helmet_worker", None)
                if hworker is None:
                    hworker = helmet_worker.HelmetWorker(self.camera_id)
                    hworker.start()
                    self._helmet_worker = hworker

                if (_now_sec - getattr(self, "_helmet_last", 0.0)) >= HELMET_INTERVAL_S:
                    self._helmet_last = _now_sec
                    helmet_cfg = (self.profile_features or {}).get("helmet_detection")
                    if not isinstance(helmet_cfg, dict):
                        helmet_cfg = {}
                    # bbox + confidence: helmet.py's rider-association gate
                    hworker.submit(
                        frame,
                        [{**d["bbox"], "confidence": d.get("confidence", 0.0)}
                         for d in detections if d.get("class") == "motorcycle"],
                        [{**d["bbox"], "confidence": d.get("confidence", 0.0)}
                         for d in detections if d.get("class") == "person"],
                        float(helmet_cfg.get("confidence", 0.35)),
                    )
                for hdet in hworker.latest():
                    detections.append(hdet)
                    masks.append([])   # stays index-parallel with detections
                if hworker.last_error:
                    self._stage_errors["helmet"] = hworker.last_error
                    hworker.last_error = None
            else:
                hworker = getattr(self, "_helmet_worker", None)
                if hworker is not None:
                    hworker.stop()
                    self._helmet_worker = None
            t_helmet = (time.perf_counter() - t_helmet0) * 1000

            # ANPR pass: plate detector (+ CRNN OCR) on vehicle crops
            t_anpr0 = time.perf_counter()
            if self._wants_anpr():
                worker = getattr(self, "_anpr_worker", None)
                if worker is None:
                    worker = plate_worker.AnprWorker(self.camera_id)
                    worker.start()
                    self._anpr_worker = worker

                if (_now_sec - getattr(self, "_anpr_last", 0.0)) >= ANPR_INTERVAL_S:
                    self._anpr_last = _now_sec
                    anpr_cfg = (self.profile_features or {}).get("anpr")
                    if not isinstance(anpr_cfg, dict):
                        anpr_cfg = {}
                    # Same confidence gate as the helmet/motorcycle association
                    vehicles = [d for d in detections
                                if d.get("class") in plate_detect.PLATE_VEHICLES
                                and d.get("confidence", 0.0) >= config.VEHICLE_ACTION_MIN_CONFIDENCE]
                    if vehicles:
                        if config.ANPR_ASYNC:
                            worker.submit(
                                frame,
                                [d["bbox"] for d in vehicles],
                                [d.get("track_id") for d in vehicles],
                                float(anpr_cfg.get("confidence", config.ANPR_THRESHOLD)),
                            )
                        else:
                            # Synchronous fallback (CAMAI_ANPR_ASYNC=0) — same
                            worker._process({
                                "frame": frame,
                                "boxes": [d["bbox"] for d in vehicles],
                                "track_ids": [d.get("track_id") for d in vehicles],
                                "conf": float(anpr_cfg.get("confidence",
                                                           config.ANPR_THRESHOLD)),
                            })

                for pdet in worker.latest():
                    detections.append(pdet)
                    masks.append([])   # stays index-parallel with detections
                if worker.last_error:
                    self._stage_errors["anpr"] = worker.last_error
                    worker.last_error = None
            else:
                worker = getattr(self, "_anpr_worker", None)
                if worker is not None:
                    worker.stop()
                    self._anpr_worker = None
            t_anpr = (time.perf_counter() - t_anpr0) * 1000

            # Micro Motion pass: Runs ONLY when micro_motion profile or feature is enabled
            if self._wants_micro_motion():
                try:
                    if not hasattr(self, "_micro_motion_detector") or self._micro_motion_detector is None:
                        from app.ai.screen_motion_detector import ScreenMicroMotionDetector
                        self._micro_motion_detector = ScreenMicroMotionDetector(
                            min_area=15, max_area=35000, threshold_value=4, blur_kernel=(5, 5), history_frames=5, max_targets=1
                        )
                    target_frame = frame
                    mm_dets = self._micro_motion_detector.detect(target_frame)
                    rx1, ry1 = 0, 0
                    for idx, md in enumerate(mm_dets):
                        b = md["bbox"]
                        mm_x1, mm_y1 = b[0] + rx1, b[1] + ry1
                        mm_x2, mm_y2 = b[0] + b[2] + rx1, b[1] + b[3] + ry1

                        # Overlap suppression: don't create duplicate micro_motion box over an already-tracked primary object (car/person)
                        is_overlapping = False
                        for existing_det in detections:
                            eb = existing_det.get("bbox", {})
                            if not isinstance(eb, dict):
                                continue
                            ex1, ey1, ex2, ey2 = eb.get("x1", 0), eb.get("y1", 0), eb.get("x2", 0), eb.get("y2", 0)
                            inter_w = max(0, min(mm_x2, ex2) - max(mm_x1, ex1))
                            inter_h = max(0, min(mm_y2, ey2) - max(mm_y1, ey1))
                            inter_area = inter_w * inter_h
                            mm_area = max(1, (mm_x2 - mm_x1) * (mm_y2 - mm_y1))
                            if inter_area / mm_area > 0.25:
                                is_overlapping = True
                                break

                        if not is_overlapping:
                            detections.append({
                                "class": "micro_motion",
                                "confidence": round(float(md["confidence"]), 2),
                                "track_id": 901 + idx,
                                "bbox": {
                                    "x1": mm_x1,
                                    "y1": mm_y1,
                                    "x2": mm_x2,
                                    "y2": mm_y2,
                                },
                                "label": md.get("tag", "SUBTLE MOTION"),
                            })
                            masks.append([])
                except Exception as e:
                    print(f"[MicroMotion Err] {e}", flush=True)
            else:
                if hasattr(self, "_micro_motion_detector") and self._micro_motion_detector is not None:
                    self._micro_motion_detector = None

            # Apply the zone profile to what this camera reports
            if detections and self._wants_face_recognition():
                try:
                    from app.ai.target_matcher import target_matcher
                    detections = target_matcher.match_detections(frame, detections)
                except Exception as _tme:
                    pass

            _allowed = PROFILE_CLASSES.get(self.zone_profile)
            wants_faces = self._wants_faces()
            wants_micro = (self.zone_profile in ("micro_motion", "rodent")) or self._feature_enabled(self.profile_features, "micro_motion")

            if detections:
                _feat_keep = filter_by_features(detections, self.profile_features)
                _feat_ids = {id(d) for d in _feat_keep}
                _keep = []
                for i, d in enumerate(detections):
                    if id(d) not in _feat_ids:
                        continue
                    cls_name = d.get("class", "")
                    if cls_name == "micro_motion":
                        if wants_micro:
                            _keep.append(i)
                        continue
                    if cls_name == "face" or str(cls_name).startswith("TARGET:") or d.get("custom_match"):
                        if wants_faces:
                            _keep.append(i)
                        continue
                    if not _allowed or cls_name in _allowed:
                        _keep.append(i)

                if len(_keep) != len(detections):
                    if len(masks) == len(detections):
                        masks = [masks[i] for i in _keep]
                    detections = [detections[i] for i in _keep]

            self._diagnostic("filtered", lambda: (
                "[CLOUD_DIAG] [FILTERED_DETECTIONS] Camera={} Profile={} Count={} Dets={}".format(
                    self.camera_id,
                    self.zone_profile,
                    len(detections),
                    [f"{d.get('class')}:{d.get('confidence')}:({int(d.get('bbox', {}).get('x1', 0))},{int(d.get('bbox', {}).get('y1', 0))},{int(d.get('bbox', {}).get('x2', 0))},{int(d.get('bbox', {}).get('y2', 0))})" for d in detections],
                )
            ))

            # Restrict detections ONLY to user polygon zones (if defined) or apply privacy masks/exclusion zones
            if self.zones and detections:
                num_before = len(detections)
                detections = filter_detections_by_user_zones(detections, self.zones, orig_w, orig_h)
                if len(detections) != num_before and len(masks) == num_before:
                    _keep_ids = {id(d) for d in detections}
                    masks = [m for d, m in zip(detections, masks) if id(d) in _keep_ids]

            # Rule engine + analytics: MUST receive absolute pixel coords
            alerts, track_overlays, heatmap, zone_stats, line_stats, crowd_stats, parking_stats = self.analytics.update(
                detections, self.zones, self.lines, orig_w, orig_h, frame=frame, rules=self.rules,
                zone_profile=self.zone_profile, profile_features=self.profile_features
            )

            if detections:
                for det in detections:
                    if det.get("custom_match") and det.get("target_name"):
                        t_name = det.get("target_name")
                        t_id = det.get("target_id") or t_name
                        t_score = int(float(det.get("match_score", 0.9)) * 100)
                        last_ts = self._last_target_alerts.get(t_id, 0.0)
                        now_ts = time.time()
                        if now_ts - last_ts >= 5.0:
                            self._last_target_alerts[t_id] = now_ts
                            alerts.append({
                                "type": "target_match",
                                "message": f"Target Match Alert: '{t_name}' detected ({t_score}% match score)",
                                "bbox": det.get("bbox"),
                                "detail": {
                                    "target_name": t_name,
                                    "target_id": t_id,
                                    "match_score": det.get("match_score"),
                                    "confidence": det.get("confidence"),
                                }
                            })

            # Why speed is/isn't a number, decided once per frame
            _speed_enabled = self._wants_speed()

            def _speed_for(det):
                """(speed_kmh|None, status) for one detection.

                Speed is now automatic: analytics derives metres-per-pixel from
                the detected object's own height (CLASS_HEIGHT_M) and reports an
                estimate with no operator setup at all. A two-line gate, when one
                exists, overrides it with a true measurement.

                  calibrated  — measured by a gate; trustworthy enough to act on
                  estimated   — auto-derived from object size; ~+/-20-30%
                  unavailable — class has no size prior, or the box is clipped by
                                the frame edge so its height (and therefore the
                                scale) would be wrong
                  disabled    — the camera's Speed Estimation toggle is off
                """
                if not _speed_enabled:
                    return None, "disabled"
                if det.get("speed") is not None:
                    return det["speed"], "calibrated" if det.get("speed_calibrated") else "estimated"
                # No number yet (track just (re)acquired, or box clipped): report
                if det.get("class") in VEHICLE_CLASSES:
                    return None, "acquiring"
                return None, "unavailable"

            # ── Build normalized client_dets AFTER analytics has smoothed bbox─
            client_dets = []
            people_count = vehicles_count = items_count = other_count = 0
            max_conf = 0.0
            for det in detections:
                bbox = det["bbox"]
                conf = det["confidence"]
                max_conf = max(max_conf, conf)
                category = _object_category(det["class"])
                people_count += int(category == "person")
                vehicles_count += int(category == "vehicle")
                items_count += int(category == "item")
                other_count += int(category in ("infrastructure", "other"))
                _speed, _speed_status = _speed_for(det)
                trk_obj = next((t for t in self.tracker.tracks if t.track_id == det.get("track_id")), None)
                lost_f = trk_obj.lost_frames if trk_obj is not None else 0
                trk_state = trk_obj.state if trk_obj is not None else "confirmed"
                bx1 = float(bbox.get("x1", 0))
                by1 = float(bbox.get("y1", 0))
                bx2 = float(bbox.get("x2", 0))
                by2 = float(bbox.get("y2", 0))
                nx1 = round(bx1 / orig_w if (bx1 > 1.0 or bx2 > 1.0) else bx1, 4)
                ny1 = round(by1 / orig_h if (by1 > 1.0 or by2 > 1.0) else by1, 4)
                nx2 = round(bx2 / orig_w if (bx1 > 1.0 or bx2 > 1.0) else bx2, 4)
                ny2 = round(by2 / orig_h if (by1 > 1.0 or by2 > 1.0) else by2, 4)

                client_dets.append({
                    "class":      det["class"],
                    "confidence": round(float(conf), 2),
                    "track_id":   det.get("track_id"),
                    "lost_frames": lost_f,
                    "track_state": trk_state,
                    "speed":      round(float(_speed), 1) if _speed is not None else None,
                    "speed_calibrated": _speed_status in ("calibrated", "estimated"),
                    "speed_status": _speed_status,
                    "dwell_time": det.get("dwell_time", 0.0),
                    "tracking_status": det.get("tracking_status", "tracked"),
                    "direction":  det.get("direction", "stationary"),
                    "lane":       det.get("lane"),
                    "plate_text": det.get("plate_text"),
                    "plate_text_confidence": det.get("plate_text_confidence"),
                    "plate_reads": det.get("plate_reads"),
                    "plate_failure": det.get("plate_failure"),
                    "label": det.get("label"),
                    "custom_match": det.get("custom_match", False),
                    "bbox": {
                        "x1": nx1,
                        "y1": ny1,
                        "x2": nx2,
                        "y2": ny2,
                    }
                })



            # Recalculate object category counts from smoothed client_dets
            people_count = sum(1 for cd in client_dets if _object_category(cd.get("class", "")) == "person")
            vehicles_count = sum(1 for cd in client_dets if _object_category(cd.get("class", "")) == "vehicle")
            items_count = sum(1 for cd in client_dets if _object_category(cd.get("class", "")) == "item")
            other_count = sum(1 for cd in client_dets if _object_category(cd.get("class", "")) in ("infrastructure", "other"))

            data["client_dets"] = client_dets
            data["detections"] = client_dets
            data["people_count"] = people_count
            data["people"] = people_count
            data["vehicles_count"] = vehicles_count
            data["vehicles"] = vehicles_count
            data["items_count"] = items_count
            data["items"] = items_count
            data["other_count"] = other_count

            self._diagnostic("rendered", lambda: (
                "[CLOUD_DIAG] [RENDERED_OBJECTS] Camera={} Count={} Emitted={}".format(
                    self.camera_id,
                    len(client_dets),
                    [f"{d.get('class')}:{d.get('confidence')}:{d.get('track_id')}:({d['bbox']['x1']},{d['bbox']['y1']},{d['bbox']['x2']},{d['bbox']['y2']})" for d in client_dets],
                )
            ))

            # Persist history (rate-limited to 1 record per 10 s)
            now = time.time()
            if now - last_history_log > 10.0:
                insert_history_record(
                    f"hist_{uuid4().hex[:8]}", self.camera_id, people_count,
                    round(max_conf, 2) if people_count > 0 else None,
                    round(data["t_inf"] + data["t_post"]),
                    "human_found" if people_count > 0 else "no_human",
                )
                last_history_log = now
                self._trk_last_history_log = last_history_log

            # Alert handling + snapshots
            if alerts:
                now_sec = time.time()
                if not hasattr(self, "_alert_dedup_cache"):
                    self._alert_dedup_cache = {}
                
                # Prune cache entries older than 120s
                self._alert_dedup_cache = {k: v for k, v in self._alert_dedup_cache.items() if now_sec - v < 120.0}

                deduped_alerts = []
                for alert in alerts:
                    a_type = alert.get("type", "generic")
                    a_key = alert.get("track_id") or alert.get("target_id") or alert.get("plate_text") or alert.get("message") or "gen"
                    dedup_id = f"{self.camera_id}_{a_type}_{a_key}"
                    last_ts = self._alert_dedup_cache.get(dedup_id, 0.0)
                    if now_sec - last_ts >= 45.0:
                        self._alert_dedup_cache[dedup_id] = now_sec
                        deduped_alerts.append(alert)
                
                alerts = deduped_alerts

            if alerts:
                # ONE annotated full-frame snapshot for this moment, shared by
                snap = f"snap_{self.camera_id}_{uuid4().hex[:8]}.jpg"
                cv2.imwrite(str(RECORDINGS_DIR / snap), _draw_snapshot_boxes(frame, detections))
                for alert in alerts:
                    # Helmet/triple-riding alerts carry rider_bbox + helmet_bbox
                    for tag, key in (("rider", "rider_bbox"), ("helmet", "helmet_bbox"),
                                     ("plate", "plate_bbox")):
                        box = alert.get(key)
                        if not box:
                            continue
                        try:
                            x1 = max(0, int(box["x1"])); y1 = max(0, int(box["y1"]))
                            x2 = min(frame.shape[1], int(box["x2"]))
                            y2 = min(frame.shape[0], int(box["y2"]))
                            if x2 - x1 >= 2 and y2 - y1 >= 2:
                                cv2.imwrite(str(RECORDINGS_DIR / snap.replace(".jpg", f"_{tag}.jpg")),
                                            frame[y1:y2, x1:x2])
                        except Exception as _e:
                            print(f"[Trk-{self.camera_id}] {tag} crop save failed: {_e}", flush=True)
                    # Structured event fields (plate number, track id, speed,
                    detail = {k: alert[k] for k in
                              ("track_id", "plate_text", "plate_text_confidence",
                               "speed_kmh", "direction", "confidence")
                              if k in alert and alert[k] is not None}
                    insert_alert(
                        f"alert_{uuid4().hex[:8]}", self.camera_id,
                        alert["type"], alert["message"],
                        screenshot_path=f"/history/recordings/{snap}",
                        detail=detail,
                    )
                    self.recorder.trigger_event_start(alert["message"])
                    # Alerts only ever went to storage, so a live dashboard had
                    self._alert_counts[alert["type"]] = self._alert_counts.get(alert["type"], 0) + 1
                    # Tell the zoom engine where this fired. Somewhere that just
                    try:
                        _b = (alert.get("bbox") or alert.get("rider_bbox")
                              or alert.get("plate_bbox"))
                        if _b:
                            _fh, _fw = frame.shape[:2]
                            self._tile_engine.note_alert(
                                ((_b["x1"] + _b["x2"]) / 2.0) / max(1, _fw),
                                ((_b["y1"] + _b["y2"]) / 2.0) / max(1, _fh),
                            )
                    except Exception:
                        pass
            else:
                self.recorder.trigger_event_stop()

            trk_lat = (time.time() - t0) * 1000
            self._trk_ts.append(time.time())

            # Synchronized MJPEG Stream Output (Post-Tracking)
            with self._overlay_lock:
                self._latest_overlay_dets = list(client_dets) if client_dets else []
                self._latest_raw_dets     = list(detections) if detections else []
                self._latest_overlay_ts   = time.time()

            self._tracking_slot.put({
                **data,
                "client_dets":    client_dets,
                "masks_polygons": masks,
                # track_overlays has normalized centroid points for motion trails
                "tracks":         track_overlays,
                "people_count":   people_count,
                "vehicles_count": vehicles_count,
                "items_count":    items_count,
                "other_count":    other_count,
                "heatmap":        heatmap,
                "zone_stats":     zone_stats,
                "line_stats":     line_stats,
                "crowd_stats":    crowd_stats,
                "parking_stats":  parking_stats,
                "trk_lat":        trk_lat,
                # Carried separately from trk_lat so the face module's cost is
                "t_face":         t_face,
                "t_helmet":       t_helmet,
                "t_anpr":         t_anpr,
                # {alert_type: count} since this camera started. Lets the client
                "alert_counts":   dict(self._alert_counts),
            })

    # -----------------------------------------------------------------------
    # Module 5: Telemetry Build
    # -----------------------------------------------------------------------

    def _telemetry_loop(self):
        while self.running:
            data = self._tracking_slot.take_latest()
            if data is None:
                continue  # _Slot.take_latest() already sleeps internally

            try:
                self._telemetry_loop_iteration(data)
                self._heartbeat["tel"] = time.time()
            except Exception as e:
                self._stage_errors["tel"] += 1
                print(f"[Tel-{self.camera_id}] ERROR (recovered): {e}", flush=True)
                traceback.print_exc()
                self._heartbeat["tel"] = time.time()

    def _telemetry_loop_iteration(self, data):
            t0 = time.time()

            # Per-stage FPS (computed from sliding timestamp windows)
            cap_fps = _fps(self._cap_ts)
            dec_fps = _fps(self._dec_ts)
            ai_fps  = _fps(self._ai_ts)
            trk_fps = _fps(self._trk_ts)
            self._tel_ts.append(time.time())
            tel_fps = _fps(self._tel_ts)

            tel_lat       = (time.time() - t0) * 1000
            cap_time      = data.get("cap_time", time.time())
            total_latency = (time.time() - cap_time) * 1000

            # Identify pipeline bottleneck (slowest stage)
            latencies = {
                "capture":       data.get("cap_lat", 0.0),
                "decode":        data.get("dec_lat", 0.0),
                "ai_preproc":    data.get("t_pre", 0.0),
                "ai_inference":  data.get("t_inf", 0.0),
                "ai_postproc":   data.get("t_post", 0.0),
                "tracking":      data.get("trk_lat", 0.0),
                "telemetry":     tel_lat,
            }
            for stage, latency in latencies.items():
                self._latency_windows[stage].add(latency)
            self._latency_windows["end_to_end"].add(total_latency)
            bottleneck = max(latencies, key=latencies.get)

            cpu = mem = 0.0
            try:
                import psutil
                # cpu_percent with interval=None returns the delta since last call
                _now_tel = time.time()
                if (_now_tel - getattr(self, "_last_cpu_sample_ts", 0.0)) >= 1.0:
                    self._last_cpu_sample_ts = _now_tel
                    try:
                        _proc_tel = getattr(self, "_psutil_proc", None)
                        if _proc_tel is None:
                            import os as _os
                            self._psutil_proc = psutil.Process(_os.getpid())
                            self._psutil_proc.cpu_percent(interval=None)  # prime
                            _proc_tel = self._psutil_proc
                        self._cached_cpu = _proc_tel.cpu_percent(interval=None)
                        self._cached_mem = _proc_tel.memory_percent()
                    except Exception:
                        pass
                cpu = getattr(self, "_cached_cpu", 0.0)
                mem = getattr(self, "_cached_mem", 0.0)
            except Exception:
                pass
            gpu_stats = get_gpu_stats()
            gpu = gpu_stats.get("percent", 0.0)
            gpu_mem = gpu_stats.get("mem_percent") if gpu_stats.get("mem_percent") is not None else 0.0
            gpu_temp = gpu_stats.get("temp_c")
            active_cams = len(governor._active(time.time()))

            self.latest_telemetry = {
                "success":   True,
                "people":    data.get("people_count", 0),
                "vehicles":  data.get("vehicles_count", 0),
                "items":     data.get("items_count", 0),
                "other_objects": data.get("other_count", 0),
                "detections": data.get("client_dets", []) or data.get("detections", []),
                "masks":     data.get("masks_polygons", []),
                "tracks":    data.get("tracks", []),
                "counters": {
                    "in":           self.analytics.counter_in,
                    "out":          self.analytics.counter_out,
                    "vehicles_in":  getattr(self.analytics, "counter_in_vehicle", 0),
                    "vehicles_out": getattr(self.analytics, "counter_out_vehicle", 0),
                    "people_in":    getattr(self.analytics, "counter_in_person", 0),
                    "people_out":   getattr(self.analytics, "counter_out_person", 0),
                },
                "heatmap":  data.get("heatmap"),
                "night_vision": data.get("zero_dce_stats", {
                    "zero_dce_applied": False,
                    "mean_luminance": 128.0,
                    "method": "none",
                    "latency_ms": 0.0,
                }),
                "micro_motion": data.get("micro_motion_stats", dict(self._motion_stats)),
                "latency":  round(total_latency),
                "frame_age_ms": round(total_latency, 1),
                "ai_queue_age_ms": round(data.get("ai_queue_age", 0.0), 1),
                "frame_id": data.get("frame_id", 0),
                "fps":      round(dec_fps if dec_fps > 0 else (cap_fps if cap_fps > 0 else (ai_fps if ai_fps > 0 else trk_fps)), 1),
                "target_fps": round(getattr(self, "target_fps", 15.0), 1),


                # Per-stage FPS
                "camera_fps":    round(cap_fps, 1),
                "decode_fps":    round(dec_fps, 1),
                "inference_fps": round(ai_fps,  1),
                "tracking_fps":  round(trk_fps, 1),

                # Per-stage latency & timing breakdown
                "capture_latency":    round(data.get("cap_lat", 0.0),  1),
                "decode_latency":     round(data.get("dec_lat", 0.0),  1),
                "preprocess_latency": round(data.get("t_pre", 0.0),    1),
                "inference_latency":  round(data.get("t_inf", 0.0),    1),
                "face_latency":       round(data.get("t_face", 0.0), 1),
                "helmet_latency":     round(data.get("t_helmet", 0.0), 1),
                "helmet":             (self._helmet_stats()
                                       if getattr(self, "_helmet_worker", None) else None),
                "anpr_latency":       round(data.get("t_anpr", 0.0), 1),
                "anpr":               (self._anpr_worker.stats()
                                       if getattr(self, "_anpr_worker", None) else None),
                "postprocess_latency":round(data.get("t_post", 0.0),   1),
                "tracking_latency":   round(data.get("trk_lat", 0.0),  1),
                "rendering_latency":  round(tel_lat,           1),
                "total_latency":      round(total_latency,     1),

                # Summary timings for monitoring
                "processing_time":    round(data.get("t_pre", 0.0) + data.get("t_inf", 0.0) + data.get("t_post", 0.0) + data.get("trk_lat", 0.0), 1),
                "decode_time":        round(data.get("dec_lat", 0.0), 1),
                "encode_time":        round(tel_lat, 1),
                "queue_length":       1 if self._decoded_slot.has_item() else 0,
                "active_cameras":     active_cams,

                "bottleneck": f"{bottleneck} ({latencies[bottleneck]:.1f}ms)",
                "status":     "human_found" if data.get("people_count", 0) > 0 else "no_human",
                "cpu":        round(cpu, 1),
                "memory":     round(mem, 1),
                "gpu":        gpu,
                "gpu_memory": round(gpu_mem, 1),
                "gpu_temp":   round(gpu_temp, 1) if gpu_temp is not None else None,
                "backend":    self.backend.backend_type if self.backend else "cloud",
                "device":     self.backend.backend_device if self.backend else "aws_cloud",
                "imgsz":      self.current_imgsz,
                # Diagnostics for the Invisible AI Zoom Engine. Admin/telemetry
                "zoom_engine": dict(self._tile_stats),
                "recording":  self.recorder.is_recording(),
                "zone_stats": data.get("zone_stats", {}),
                "line_stats": data.get("line_stats", {}),
                "crowd_stats": data.get("crowd_stats", {}),
                "parking_stats": data.get("parking_stats", {"total": 0, "occupied": 0, "free": 0, "occupancy_percent": 0.0, "slots": []}),
                "alert_counts": data.get("alert_counts", {}),
                "stage_errors": dict(self._stage_errors),
                "queue_depth": 1 if self._grabbed_slot._ready.is_set() else 0,
                # Per-boundary frame drops. Latest-wins slots discard by design,
                "dropped_frames": {
                    "grab": self._grabbed_slot.dropped,
                    "dec":  self._decoded_slot.dropped,
                    "ai":   self._ai_slot.dropped,
                    "trk":  self._tracking_slot.dropped,
                    "tel":  self._telemetry_out_slot.dropped,
                },
                "dropped_total": (self._grabbed_slot.dropped + self._decoded_slot.dropped
                                  + self._ai_slot.dropped + self._tracking_slot.dropped
                                  + self._telemetry_out_slot.dropped),
                # Named for the operator overlay rather than "debug_*", which
                "tracker_count": len(self.tracker.tracks),
                "detection_count": len(data.get("client_dets", [])),
                "debug_tracks": len(self.tracker.tracks),
                "debug_track_history": len(self.analytics.track_history),
                "debug_zone_active": sum(len(v) for v in self.analytics.zone_active_tracks.values()),
                "debug_recorder_qsize": self.recorder.queue.qsize(),
                "cap_consecutive_failures": self._cap_consecutive_failures,
                # Carried on every payload, not just the pre-first-frame stub, so
                "health_status": self._health_status,
                "source_error": self.source_error_text(),
            }

            self._telemetry_out_slot.put(self.latest_telemetry)

    # -----------------------------------------------------------------------
    # Module 6: WebSocket Dispatch
    # -----------------------------------------------------------------------

    def _ws_dispatch_loop(self):
        while self.running:
            telemetry = self._telemetry_out_slot.take_latest()
            if telemetry is None:
                continue  # _Slot.take_latest() already sleeps internally
            try:
                if self.telemetry_callback:
                    self.telemetry_callback({self.camera_id: telemetry})
                self._heartbeat["ws"] = time.time()
            except Exception as e:
                self._stage_errors["ws"] += 1
                print(f"[WS-{self.camera_id}] ERROR (recovered): {e}", flush=True)
                traceback.print_exc()
                self._heartbeat["ws"] = time.time()

    # -----------------------------------------------------------------------
    # Watchdog: last line of defense against a truly wedged stage
    # -----------------------------------------------------------------------
    # Every stage above already catches Exception internally, so it should

    def _watchdog_loop(self):
        stage_order = ["cap", "dec", "ai", "trk", "tel", "ws"]
        # Two-tier threshold instead of one fixed value:
        startup_grace = 240.0
        steady_stall  = 20.0
        pipeline_start = time.time()
        while self.running:
            time.sleep(2.0)
            now = time.time()
            if now - pipeline_start < startup_grace:
                continue
            cap_alive = (now - self._heartbeat["cap"]) < steady_stall
            if not cap_alive:
                # Capture itself is stuck (dead source, no reconnect yet) —
                continue
            for stage in stage_order[1:]:
                if now - self._heartbeat[stage] > steady_stall:
                    print(f"[Watchdog-{self.camera_id}] Stage '{stage}' has not made "
                          f"progress in {steady_stall}s while capture is alive — "
                          f"requesting full pipeline restart.", flush=True)
                    if self.restart_callback:
                        try:
                            self.restart_callback(self.camera_id)
                        except Exception as e:
                            print(f"[Watchdog-{self.camera_id}] restart_callback failed: {e}", flush=True)
                    return  # this instance is being replaced; stop watching

    # -----------------------------------------------------------------------
    # Internal helpers
    # -----------------------------------------------------------------------

    def _open_capture(self, src, hw_accel: bool = True):
        # CAP_PROP_BUFFERSIZE is not a valid *open-time* parameter for the
        if isinstance(src, str) and src.startswith("rtsp://"):
            try:
                from urllib.parse import urlparse
                parsed = urlparse(src)
                if not parsed.path:
                    src = src + "/"
            except Exception:
                pass

        accel_mode = cv2.VIDEO_ACCELERATION_ANY if hw_accel else cv2.VIDEO_ACCELERATION_NONE
        params = [
            cv2.CAP_PROP_HW_ACCELERATION, accel_mode,
        ]

        # Try only the backends that can actually serve this kind of source.
        if isinstance(src, int):
            backends = [None, cv2.CAP_DSHOW, cv2.CAP_MSMF]
        else:
            backends = [cv2.CAP_FFMPEG, None]

        is_http_stream = isinstance(src, str) and ("m3u8" in src or "googlevideo.com" in src or src.startswith("http"))
        
        with _capture_lock:
            old_options = os.environ.get("OPENCV_FFMPEG_CAPTURE_OPTIONS")
            if is_http_stream:
                os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "reconnect;1|reconnect_streamed;1|reconnect_delay_max;5"
            else:
                os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "rtsp_transport;tcp|threads;4|fflags;nobuffer|flags;low_delay|framedrop;1|max_delay;500000"
                
            try:
                for backend in backends:
                    try:
                        cap = cv2.VideoCapture(src, backend, params) if backend else cv2.VideoCapture(src)
                        if cap.isOpened():
                            return cap
                        cap.release()
                    except Exception:
                        pass
                return cv2.VideoCapture(src)
            finally:
                if old_options is not None:
                    os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = old_options
                else:
                    os.environ.pop("OPENCV_FFMPEG_CAPTURE_OPTIONS", None)

    def _analyze_motion(self, frame):
        """Cheap, noise-aware motion gate for inference scheduling.

        The old gate downscaled every frame to 160x120 and used a fixed
        20-level threshold. That made a true 1-2 px displacement disappear in
        the resize, while dark sensor/compression noise could still dominate a
        frame. This keeps a larger working image, compares both frame-to-frame
        and short temporal history, and derives the threshold from the current
        noise floor.
        """
        t0 = time.perf_counter()
        stats = {
            "motion": True,
            "changed_ratio": 0.0,
            "threshold": 12,
            "noise_sigma": 0.0,
            "mean_luminance": 128.0,
            "low_light": False,
            "latency_ms": 0.0,
        }
        if frame is None or frame.size == 0:
            return stats

        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        h, w = gray.shape[:2]
        work_w = min(640, max(320, w))
        work_h = max(180, int(round(h * (work_w / float(max(1, w))))))
        small = cv2.resize(gray, (work_w, work_h), interpolation=cv2.INTER_LINEAR) if (w, h) != (work_w, work_h) else gray
        mean_lum = float(np.mean(small))
        low_light = mean_lum < 85.0
        # Mild denoise: enough to suppress salt-and-pepper sensor shimmer, not
        proc = cv2.GaussianBlur(small, (3, 3), 0)

        if self._prev_motion_full is None:
            self._prev_motion_full = proc
            self._prev_motion = proc
            stats.update({
                "mean_luminance": round(mean_lum, 1),
                "low_light": low_light,
                "latency_ms": round((time.perf_counter() - t0) * 1000.0, 2),
            })
            return stats

        if self._prev_motion_full.shape != proc.shape:
            self._prev_motion_full = proc
            self._prev_motion = proc
            stats.update({
                "mean_luminance": round(mean_lum, 1),
                "low_light": low_light,
                "latency_ms": round((time.perf_counter() - t0) * 1000.0, 2),
            })
            return stats

        diff_prev = cv2.absdiff(proc, self._prev_motion_full)
        diff_hist = cv2.absdiff(proc, self._prev_motion if self._prev_motion is not None else self._prev_motion_full)
        diff = cv2.max(diff_prev, diff_hist)
        self._prev_motion_full = proc
        self._prev_motion = (
            cv2.addWeighted(self._prev_motion, 0.80, proc, 0.20, 0)
            if self._prev_motion is not None and self._prev_motion.shape == proc.shape else proc
        )

        try:
            med = float(np.median(diff))
            mad = float(np.median(np.abs(diff.astype(np.int16) - int(med))))
            sigma = 1.4826 * mad
            self._motion_noise_ema = sigma if self._motion_noise_ema is None else (0.9 * self._motion_noise_ema + 0.1 * sigma)
            sigma_ref = max(float(self._motion_noise_ema or 0.0), sigma)
            floor = 2.0 if low_light else 4.0
            k = 3.9 if low_light else 3.0
            thr = int(np.clip(max(floor, med + k * sigma_ref), floor, 18.0 if low_light else 24.0))
            _, mask = cv2.threshold(diff, thr, 255, cv2.THRESH_BINARY)

            # Remove isolated single-pixel noise, then validate very small blobs by
            mask = cv2.medianBlur(mask, 3)
            num, labels, cc_stats, _ = cv2.connectedComponentsWithStats(mask, 8)
        except Exception as e:
            stats.update({
                "motion": True,
                "mean_luminance": round(mean_lum, 1),
                "low_light": low_light,
                "latency_ms": round((time.perf_counter() - t0) * 1000.0, 2),
            })
            return stats
        valid_area = 0
        valid_blobs = 0
        min_area = 3 if low_light else 5
        max_area = int(mask.size * (0.35 if low_light else 0.50))
        for i in range(1, num):
            area = int(cc_stats[i, cv2.CC_STAT_AREA])
            if area < min_area or area > max_area:
                continue
            bw = int(cc_stats[i, cv2.CC_STAT_WIDTH])
            bh = int(cc_stats[i, cv2.CC_STAT_HEIGHT])
            aspect = max(bw / max(1, bh), bh / max(1, bw))
            if aspect > 12.0 and area < 20:
                continue
            valid_area += area
            valid_blobs += 1

        changed_ratio = valid_area / float(max(1, mask.size))
        ratio_gate = 0.000035 if low_light else 0.00006
        blob_gate = 1 if low_light else 2
        motion = (valid_blobs >= blob_gate and changed_ratio >= ratio_gate)
        # A broad coherent change can be a fast object; scene-wide exposure
        if not motion and changed_ratio >= max(ratio_gate * 6.0, self._motion_thr * 0.2):
            motion = True

        stats.update({
            "motion": bool(motion),
            "changed_ratio": round(changed_ratio, 6),
            "threshold": int(thr),
            "noise_sigma": round(sigma_ref, 2),
            "mean_luminance": round(mean_lum, 1),
            "low_light": low_light,
            "valid_blobs": int(valid_blobs),
            "latency_ms": round((time.perf_counter() - t0) * 1000.0, 2),
        })
        return stats

    def _detect_motion(self, frame):
        return bool(self._analyze_motion(frame).get("motion", False))

    def _get_roi(self, orig_h: int, orig_w: int):
        # ONLY crop if an explicit detection-ROI zone (roi=True or is_roi=True) was explicitly configured
        explicit_roi = [z for z in self.zones if (z.get("roi") is True or z.get("is_roi") is True) and z.get("points")]
        if not explicit_roi:
            return None
        pts = []
        for obj in explicit_roi:
            if "points" in obj:
                pts.extend([[p[0]*orig_w, p[1]*orig_h] for p in obj["points"]])
        if not pts:
            return None
        arr  = np.array(pts)
        rx1  = max(0,      int(arr[:, 0].min() - 20))
        ry1  = max(0,      int(arr[:, 1].min() - 20))
        rx2  = min(orig_w, int(arr[:, 0].max() + 20))
        ry2  = min(orig_h, int(arr[:, 1].max() + 20))
        area = (rx2 - rx1) * (ry2 - ry1)
        if 0 < area <= 0.95 * orig_w * orig_h:
            return rx1, ry1, rx2, ry2
        return None
