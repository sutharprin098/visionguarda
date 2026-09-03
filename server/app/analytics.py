import time
import cv2
import numpy as np

from app import config

# Classes treated as "items" for abandoned-object detection — anything that
# isn't a person or vehicle and can plausibly be left behind. Must stay in
# sync with the classes enabled in app/ai/backend.py's COCO_CLASS_MAP.
ITEM_CLASSES = {"backpack", "handbag", "suitcase", "umbrella"}
VEHICLE_CLASSES = {
    "car", "bus", "truck", "motorcycle", "bicycle", "van",
    "auto_rickshaw", "auto", "rickshaw", "tractor", "emergency_vehicle",
    "ambulance", "police_car", "fire_truck"
}
INFRASTRUCTURE_CLASSES = {"traffic_light", "stop_sign", "traffic_cone", "traffic_barrier"}
PARKING_OCCUPANCY_SCORE_THRESHOLD = 24.0


def _object_category(class_name: str) -> str:
    """person | vehicle | item | infrastructure | other — used everywhere a detection needs to be
    bucketed for counting/alerting so item-class detections (added for
    abandoned-object detection) don't silently get miscounted as vehicles."""
    if class_name in ITEM_CLASSES or class_name == "micro_motion":
        return "item"
    if class_name in VEHICLE_CLASSES:
        return "vehicle"
    if class_name in INFRASTRUCTURE_CLASSES:
        return "infrastructure"
    if class_name == "person":
        return "person"
    return "other"


# --- Zone Profiles ---------------------------------------------------------
#
# What a profile actually IS, mechanically: the set of classes the camera
# reports. This is what makes "Traffic mode" more than a UI switch — a traffic
# camera stops reporting handbags, a security camera stops reporting buses, and
# the operator's overlay, counts and alerts all narrow accordingly.
#
# What it is NOT: an inference saving. yolox_tiny emits every class in
# COCO_CLASS_MAP in a single forward pass, so excluding "bus" costs the same as
# including it. The one module with its own model — and therefore a real
# on/off cost — is face detection (app/ai/face.py, ~35ms when on, 0 when off).
#
# Every class named here must be producible by something, or the profile
# advertises a capability that silently never appears:
#   - "fire"/"smoke" are NOT listed: the colour-threshold code that invented
#     them was removed (it read concrete as smoke on 100% of frames). No
#     producer exists until a real model ships.
#   - "vest"/"no_vest" are NOT listed: the HSV heuristic that invented them
#     (22% false-positive) was removed and no real vest model ships yet.
#   - "helmet"/"no_helmet" ARE listed for traffic now: unlike the removed HSV
#     guess, a real trained producer exists — app/ai/helmet.py runs a YOLOv8
#     helmet model on rider crops and appends genuine detections before this
#     method sees them, exactly as face.py does for "face". If that model file
#     is absent the module emits nothing (and logs why), so the class simply
#     doesn't appear rather than being faked — the profile still only ever
#     advertises a capability something can actually produce.
#   - "number_plate" IS listed for traffic: app/ai/plate.py runs a real plate
#     detector on vehicle crops (with OCR in plate_ocr.py). Same rule — absent
#     the model it emits nothing and logs why, never a faked plate.
#   - "dog"/"cat"/"bear"/"gloves"/"shoes" are NOT listed: never in
#     COCO_CLASS_MAP, so the detector cannot emit them.
#   - "face" IS listed for security and factory: YuNet genuinely produces it.
PRODUCIBLE_VEHICLE_CLASSES = {"car", "bus", "truck", "motorcycle", "bicycle"}
PRODUCIBLE_ANIMAL_CLASSES = {"dog", "cat", "cow", "horse", "sheep"}

PROFILE_CLASSES = {
    "traffic": set(PRODUCIBLE_VEHICLE_CLASSES) | {"person", "traffic_light", "stop_sign", "helmet", "no_helmet", "number_plate"},
    "security": set(PRODUCIBLE_VEHICLE_CLASSES) | set(PRODUCIBLE_ANIMAL_CLASSES) | {"person", "backpack", "handbag", "suitcase", "umbrella", "face"},
    "factory": set(PRODUCIBLE_VEHICLE_CLASSES) | set(PRODUCIBLE_ANIMAL_CLASSES) | {"person", "face"},
    "micro_motion": set(PRODUCIBLE_VEHICLE_CLASSES) | set(PRODUCIBLE_ANIMAL_CLASSES) | {"person", "backpack", "handbag", "suitcase", "umbrella", "face", "micro_motion"},
    "custom": set(PRODUCIBLE_VEHICLE_CLASSES) | set(PRODUCIBLE_ANIMAL_CLASSES) | {"person", "backpack", "handbag", "suitcase", "umbrella", "face", "custom_object"},
}


FEATURE_CLASSES = {
    "person_detection": {"person"},
    "worker_detection": {"person"},
    "person_counting": {"person"},
    "crowd_detection": {"person"},
    "vehicle_detection": set(PRODUCIBLE_VEHICLE_CLASSES),
    "vehicle_classification": set(PRODUCIBLE_VEHICLE_CLASSES),
    "vehicle_counting": set(PRODUCIBLE_VEHICLE_CLASSES),
    "animal_detection": set(PRODUCIBLE_ANIMAL_CLASSES),
    "face_detection": {"face"},
    "helmet_detection": {"helmet", "no_helmet"},
    "anpr": {"number_plate"},
    "object_left_behind": set(ITEM_CLASSES),
    "object_removed": set(ITEM_CLASSES),
    "traffic_light_violation": {"traffic_light"},
    "stop_line_violation": {"stop_sign"},
    "micro_motion_hud": {"micro_motion"},
}


def filter_by_features(detections, features):
    """Drop classes whose owning feature is switched off, or whose detection confidence
    is below the selected feature confidence threshold, or whose class is not included in
    the feature's allowed object classes list.

    Complements filter_by_profile(): the profile says what this KIND of camera
    reports, the features say what this operator asked for. Both must hold.
    """
    if not features or not detections:
        return detections

    enabled_classes = set()
    disabled_classes = set()
    class_min_conf = {}
    class_allowed_subclasses = {}

    for key, cfg in features.items():
        owned = FEATURE_CLASSES.get(key)
        if not owned:
            continue

        is_enabled = False
        conf_thresh = None
        allowed_classes = None

        if isinstance(cfg, dict):
            is_enabled = cfg.get("enabled", True)
            for c_key in ("confidence", "conf_threshold", "threshold", "min_confidence"):
                if c_key in cfg and cfg[c_key] is not None:
                    try:
                        v = float(cfg[c_key])
                        if v > 1.0:
                            v = v / 100.0
                        conf_thresh = v
                        break
                    except (ValueError, TypeError):
                        pass

            if "classes" in cfg and isinstance(cfg["classes"], (list, set, tuple)) and len(cfg["classes"]) > 0:
                allowed_classes = set(cfg["classes"])
        elif isinstance(cfg, bool):
            is_enabled = cfg

        if is_enabled:
            enabled_classes |= owned
            if conf_thresh is not None:
                for cls_name in owned:
                    if cls_name not in class_min_conf or conf_thresh > class_min_conf[cls_name]:
                        class_min_conf[cls_name] = conf_thresh
            if allowed_classes:
                for cls_name in owned:
                    if cls_name not in class_allowed_subclasses:
                        class_allowed_subclasses[cls_name] = set(allowed_classes)
                    else:
                        class_allowed_subclasses[cls_name] |= set(allowed_classes)
        else:
            disabled_classes |= owned

    drop_classes = disabled_classes - enabled_classes
    drop_classes.discard("micro_motion")

    filtered = []
    for d in detections:
        cls_name = d.get("class")
        if cls_name == "micro_motion" or d.get("custom_match"):
            filtered.append(d)
            continue

        # 1. Drop if class belongs to a disabled feature
        if cls_name in drop_classes:
            continue

        # 2. Check confidence threshold set by operator (e.g. 0.6)
        det_conf = float(d.get("confidence", 0.0))
        required_conf = class_min_conf.get(cls_name)
        if required_conf is not None and det_conf < required_conf:
            continue

        # 3. Check allowed sub-classes filter if specified
        allowed_subs = class_allowed_subclasses.get(cls_name)
        if allowed_subs is not None and len(allowed_subs) > 0 and cls_name not in allowed_subs:
            continue

        filtered.append(d)

    return filtered


def filter_by_profile(detections, zone_profile):
    """Narrow detections to the classes a profile reports."""
    allowed = PROFILE_CLASSES.get(zone_profile)
    if not allowed:
        return detections
    return [d for d in detections if d.get("class") in allowed or d.get("custom_match") or d.get("class") == "micro_motion"]


# --- Geometry Utilities ---

def ccw(A, B, C):
    """Check if points A, B, C are in counter-clockwise order."""
    return (C[1] - A[1]) * (B[0] - A[0]) > (B[1] - A[1]) * (C[0] - A[0])

def check_line_intersection(A, B, C, D):
    """Check if line segment AB intersects segment CD."""
    return ccw(A, C, D) != ccw(B, C, D) and ccw(A, B, C) != ccw(A, B, D)

def get_point_line_side(P, A, B):
    """
    Determine which side of the line AB the point P lies on.
    Returns > 0 for one side, < 0 for the other, 0 on the line.
    """
    return (P[0] - A[0]) * (B[1] - A[1]) - (P[1] - A[1]) * (B[0] - A[0])


def segment_crossing_fraction(p1, p2, a, b):
    """Fraction t in [0,1] along segment p1->p2 where it crosses infinite
    line a-b, or None if the segment doesn't cross it.

    Used to interpolate the real-world instant a track crossed a speed-gate
    line, rather than crediting the crossing to whatever timestamp the
    tracking cycle happened to land on. At highway speeds a vehicle can move
    a large fraction of the frame between two tracking cycles, so the frame
    boundary can be a poor stand-in for "when it actually crossed" — this
    interpolation keeps two-line speed-gate measurements accurate at both
    low and high tracking frame rates instead of degrading as tracking FPS
    drops relative to vehicle speed.
    """
    if not check_line_intersection(p1, p2, a, b):
        return None
    x1, y1 = p1; x2, y2 = p2
    x3, y3 = a;  x4, y4 = b
    denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4)
    if abs(denom) < 1e-9:
        return None
    t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom
    return float(min(1.0, max(0.0, t)))


_DIRECTION_SECTORS = ["E", "NE", "N", "NW", "W", "SW", "S", "SE"]
_DIRECTION_MIN_DIST = 0.003  # normalized units; below this, motion is just detector/bbox jitter


def _direction_label(dx: float, dy: float) -> str:
    """8-way compass label for a track's recent screen-space motion (N is up).
    "stationary" when the displacement is too small to be a real heading."""
    if np.hypot(dx, dy) < _DIRECTION_MIN_DIST:
        return "stationary"
    angle = np.degrees(np.arctan2(-dy, dx)) % 360  # -dy: screen y grows downward
    idx = int(((angle + 22.5) % 360) // 45)
    return _DIRECTION_SECTORS[idx]


def _point_in_zone_shape(px: float, py: float, pts, shape_type: str) -> bool:
    """True if point (px, py) falls inside a zone's configured shape.
    Shared by zone occupancy analytics and lane assignment so both agree on
    exactly the same geometry test. Auto-normalizes points if in percentage [0..100]
    or pixel coordinates."""
    if not pts:
        return False
    pts_arr = np.array(pts, dtype=np.float32)
    if pts_arr.size == 0 or pts_arr.ndim < 2 or pts_arr.shape[1] < 2:
        return False

    max_val = float(pts_arr.max())
    if max_val > 100.0:
        pts_arr[:, 0] = pts_arr[:, 0] / 1920.0
        pts_arr[:, 1] = pts_arr[:, 1] / 1080.0
    elif max_val > 1.0:
        pts_arr = pts_arr / 100.0

    pts_list = pts_arr.tolist()
    if shape_type == "circle" and len(pts_list) >= 2:
        cx_c, cy_c = pts_list[0][0], pts_list[0][1]
        ex_c, ey_c = pts_list[1][0], pts_list[1][1]
        radius = np.sqrt((ex_c - cx_c) ** 2 + (ey_c - cy_c) ** 2)
        return np.sqrt((px - cx_c) ** 2 + (py - cy_c) ** 2) <= radius
    if shape_type in ("rect", "rectangle") and len(pts_list) >= 2:
        x1 = min(pts_list[0][0], pts_list[1][0]); x2 = max(pts_list[0][0], pts_list[1][0])
        y1 = min(pts_list[0][1], pts_list[1][1]); y2 = max(pts_list[0][1], pts_list[1][1])
        return (x1 <= px <= x2) and (y1 <= py <= y2)
    return cv2.pointPolygonTest(pts_arr, (px, py), False) >= 0


def _lane_for_point(px: float, py: float, zones) -> str:
    """Name (or id) of the first zoneType=="lane" zone containing this point,
    else None. Lanes are just regular zones with zoneType "lane" — no
    separate lane-editor concept is needed since the zone polygon tool
    already lets an operator draw one region per lane."""
    for zone in zones:
        if zone.get("zoneType") != "lane":
            continue
        pts = zone.get("points") or []
        if len(pts) >= 2 and _point_in_zone_shape(px, py, pts, zone.get("shapeType", "polygon")):
            return zone.get("name") or zone.get("id")
    return None


def _polygon_bbox(points):
    arr = np.array(points, dtype=np.float32)
    return float(arr[:, 0].min()), float(arr[:, 1].min()), float(arr[:, 0].max()), float(arr[:, 1].max())


def _bbox_overlap_ratio(bbox, poly_pts, frame_w: int, frame_h: int) -> float:
    """Approximate bbox-vs-polygon overlap as a fraction of the smaller area.

    Parking slots are operator-drawn polygons, while detections arrive as
    boxes. A mask rasterization keeps this robust for angled slots without
    pulling in a heavyweight geometry dependency.
    """
    if len(poly_pts) < 3:
        return 0.0
    x1 = max(0, min(frame_w - 1, int(bbox["x1"])))
    y1 = max(0, min(frame_h - 1, int(bbox["y1"])))
    x2 = max(x1 + 1, min(frame_w, int(bbox["x2"])))
    y2 = max(y1 + 1, min(frame_h, int(bbox["y2"])))
    rx1, ry1, rx2, ry2 = _polygon_bbox(poly_pts)
    ix1 = max(x1, int(rx1))
    iy1 = max(y1, int(ry1))
    ix2 = min(x2, int(rx2))
    iy2 = min(y2, int(ry2))
    if ix2 <= ix1 or iy2 <= iy1:
        return 0.0

    mask_shape = (iy2 - iy1, ix2 - ix1)
    poly_mask = np.zeros(mask_shape, dtype=np.uint8)
    box_mask = np.zeros(mask_shape, dtype=np.uint8)
    local_poly = np.array([[p[0] - ix1, p[1] - iy1] for p in poly_pts], dtype=np.int32)
    cv2.fillPoly(poly_mask, [local_poly], 255)
    cv2.rectangle(box_mask, (x1 - ix1, y1 - iy1), (x2 - ix1, y2 - iy1), 255, thickness=-1)
    inter = cv2.countNonZero(cv2.bitwise_and(poly_mask, box_mask))
    poly_area = max(1, cv2.countNonZero(poly_mask))
    box_area = max(1, cv2.countNonZero(box_mask))
    return float(inter / max(1, min(poly_area, box_area)))


def _parking_visual_score(frame, poly_pts) -> float:
    """Visual evidence (0–100) that an operator-drawn parking slot is occupied.

    An empty slot is a patch of roughly uniform pavement; a vehicle drops a
    large textured, high-contrast object into it. Three slot-interior
    statistics capture that difference without any per-site training:

    - gradient fraction: share of pixels whose Sobel gradient magnitude
      exceeds a fixed threshold (vehicle bodywork, windows, shadows produce
      strong local gradients; asphalt does not)
    - intensity spread: interquartile range of grayscale values, robust to
      the odd bright/dark speck that would inflate a variance measure
    - median deviation: share of pixels far from the slot's median intensity,
      i.e. how much of the slot is covered by something that isn't pavement

    YOLO vehicle-bbox overlap is still the primary occupancy signal; this
    score is a fixed-camera fallback for when the detector misses a parked
    vehicle (partial occlusion, unusual vehicle type). Thresholds are
    calibrated per camera via the zone's parkingScoreThreshold.
    """
    if frame is None or len(poly_pts) < 3:
        return 0.0
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    pts = np.array(poly_pts, dtype=np.int32)
    mask = np.zeros(gray.shape, dtype=np.uint8)
    cv2.fillPoly(mask, [pts], 255)
    inside = mask == 255
    n_pixels = int(np.count_nonzero(inside))
    if n_pixels == 0:
        return 0.0

    gx = cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3)
    grad_mag = cv2.magnitude(gx, gy)
    grad_frac = float(np.count_nonzero(grad_mag[inside] > 60.0)) / n_pixels

    pixels = gray[inside].astype(np.float32)
    q25, median, q75 = np.percentile(pixels, [25.0, 50.0, 75.0])
    spread = min(1.0, float(q75 - q25) / 128.0)
    deviant_frac = float(np.count_nonzero(np.abs(pixels - median) > 45.0)) / n_pixels

    return float(100.0 * (0.45 * grad_frac + 0.35 * spread + 0.20 * deviant_frac))


# ---------------------------------------------------------------------------
# Automatic scale reference
# ---------------------------------------------------------------------------
#
# Typical real-world HEIGHT of each class, in metres. This is the scale
# reference that makes speed work with no lines to draw: if a car is 60px tall
# on screen and cars are ~1.5m tall, then ~0.025 m/px at that car's depth.
#
# HEIGHT, not width, on purpose. A car's bounding box width is ~1.8m seen head
# on but ~4.5m seen side on — the same object, a 2.5x different prior, and the
# detector cannot tell us which way it is facing. Height barely changes with
# viewing angle, so it is the only dimension usable without knowing orientation.
#
# These are approximations of real objects, NOT tuning constants: a car really is
# about this tall, and if the number is wrong the fix is a better measurement of
# cars. That is the whole difference from the invented SPEED_SCALE=100.0 this
# replaces, which corresponded to nothing physical and changed meaning whenever
# the camera moved.
CLASS_HEIGHT_M = {
    "person": 1.70,
    "bicycle": 1.20,   # bike + rider
    "motorcycle": 1.50,
    "car": 1.50,
    "van": 2.00,
    "auto_rickshaw": 1.80,
    "auto": 1.80,
    "rickshaw": 1.80,
    "bus": 3.20,
    "truck": 3.20,
    "tractor": 2.50,
    "emergency_vehicle": 2.20,
    "ambulance": 2.20,
    "police_car": 1.50,
    "fire_truck": 3.20,
    "dog": 0.60,
    "cat": 0.35,
    "cow": 1.40,
    "horse": 1.60,
    "sheep": 0.75,
    "animal": 0.70,
}

# --- Homography Transformation for Enterprise Speed Detection ---

def compute_homography_matrix(src_pts_px, dst_pts_meters):
    """
    src_pts_px: 4x2 array-like of pixel coordinates [[x1, y1], [x2, y2], [x3, y3], [x4, y4]]
    dst_pts_meters: 4x2 array-like of real-world meter coordinates [[0, 0], [w_m, 0], [w_m, l_m], [0, l_m]]
    Returns 3x3 Homography matrix H or None if invalid points.
    """
    if not src_pts_px or not dst_pts_meters or len(src_pts_px) < 4 or len(dst_pts_meters) < 4:
        return None
    src = np.array(src_pts_px[:4], dtype=np.float32)
    dst = np.array(dst_pts_meters[:4], dtype=np.float32)
    try:
        H, _ = cv2.findHomography(src, dst)
        return H
    except Exception as e:
        print(f"[analytics] Homography calculation failed: {e}", flush=True)
        return None


def transform_point_homography(H, px, py):
    """
    Transforms point (px, py) in pixel coordinates to (X_m, Y_m) in real-world ground meters using Homography matrix H.
    """
    if H is None:
        return None
    pt = np.array([float(px), float(py), 1.0], dtype=np.float64)
    dst_pt = np.dot(H, pt)
    if abs(dst_pt[2]) < 1e-7:
        return None
    return float(dst_pt[0] / dst_pt[2]), float(dst_pt[1] / dst_pt[2])


# A box touching the frame edge is CLIPPED: the object continues outside the
# image, so its on-screen height is smaller than the object really is. That
# inflates metres-per-pixel and therefore the speed — the classic way this
# technique produces 200km/h ghosts as a vehicle enters or leaves frame. Such
# boxes are excluded from scale estimation (the track keeps its last good scale).
_EDGE_MARGIN_PX = 3
# Below this the height quantisation error alone is several percent per pixel.
_MIN_SCALE_HEIGHT_PX = 24.0


def _estimate_mpp(bbox, class_name, frame_w, frame_h):
    """Metres-per-pixel at this detection's depth, or None if not estimable."""
    real_h = CLASS_HEIGHT_M.get(class_name)
    if real_h is None:
        return None
    h_px = float(bbox["y2"]) - float(bbox["y1"])
    if h_px < _MIN_SCALE_HEIGHT_PX:
        return None
    if (float(bbox["x1"]) <= _EDGE_MARGIN_PX
            or float(bbox["y1"]) <= _EDGE_MARGIN_PX
            or float(bbox["x2"]) >= frame_w - _EDGE_MARGIN_PX
            or float(bbox["y2"]) >= frame_h - _EDGE_MARGIN_PX):
        return None
    return real_h / h_px


class _SpeedKalman1D:
    """Scalar Kalman filter smoothing a per-frame noisy speed measurement
    into a stable continuous value.

    Replaces a fixed-weight EMA (0.7 old + 0.3 new), which has one fixed
    time constant no matter how confident the filter is: too slow and a
    real speed change reads as "frozen" for several frames, too fast and
    detector jitter reads as a spike. An adaptive Kalman gain widens when
    uncertain (converges quickly to a real value/change) and narrows once
    confident (damps frame-to-frame detector noise) — this is what
    "Kalman smoothing" for speed means, not just another exponential blend.
    """
    __slots__ = ("value", "variance")

    def __init__(self):
        self.value = 0.0
        self.variance = 100.0  # high initial uncertainty: first reading should pass through almost unfiltered

    def update(self, measurement: float, process_var: float = 4.0, measurement_var: float = 10.0) -> float:
        self.variance += process_var
        k = self.variance / (self.variance + measurement_var)
        self.value += k * (measurement - self.value)
        self.variance *= (1.0 - k)
        return self.value



# --- Analytics Engines ---

class CameraAnalytics:
    def __init__(self, camera_id: str):
        self.camera_id = camera_id
        
        # Track history: {track_id: list of [x, y] centroids}
        self.track_history = {}
        self.track_history_maxlen = 30
        # {track_id: list of timestamps}, one per self.track_history entry —
        # lets line-crossing detection interpolate the real instant a fast
        # track crossed a line instead of crediting it to the tracking
        # cycle's timestamp (see segment_crossing_fraction).
        self.track_history_ts = {}
        
        # New track state mappings
        self.track_classes = {}   # track_id -> class_name
        self.track_speeds = {}    # track_id -> speed (km/h), Kalman-smoothed
        self.track_last_pts = {}  # track_id -> (timestamp, (cx, cy))  [normalised]
        self.speed_filters = {}   # track_id -> _SpeedKalman1D
        # --- Automatic scale estimation ------------------------------------
        # track_id -> metres-per-pixel at that object's depth, EMA-smoothed.
        self.track_mpp = {}
        # track_id -> (timestamp, (cx_px, cy_px)) in ABSOLUTE PIXELS. Speed has
        # to be measured in pixel space: normalised space is anisotropic, so a
        # diagonal displacement there is not proportional to real distance.
        self.track_last_px = {}
        self.SPEED_HARD_CAP = 200.0  # sanity bound only, not a per-class heuristic

        # --- Enterprise Homography Speed Detection Engine ---
        self.homography_H = None
        self.homography_src_pts = None
        self.homography_dst_pts = None
        self.track_last_world_m = {}  # track_id -> (timestamp, (X_m, Y_m))

        # track_id -> ts this id last appeared in detections. The tracker
        # (ByteTracker in app/ai/pipeline.py) keeps a track's ID alive across
        # brief/long occlusion via Kalman coasting + a lost-track re-id
        # gallery, but only EMITS a track_id in detections on frames it's
        # actually matched. Without this grace window, a single occluded
        # frame would wipe this track's history/zone-dwell/EMA state here,
        # so a re-identified same-ID track would restart from scratch —
        # defeating the whole point of the tracker preserving the ID.
        self.track_last_seen = {}
        self.REID_GRACE_SECONDS = 60.0

        # --- Calibrated speed gates (two-line, known real-world distance) ---
        # {track_id: (line_id, t_crossed)} — set when a track crosses one
        # half of a declared speed-gate line pair; cleared once the paired
        # line is crossed (speed computed) or overwritten by a fresh gate.
        self.speed_gate_pending = {}
        # {track_id: {"speed_kmh": float, "ts": float}} — last calibrated
        # reading for a track. A gate crossing is a one-shot event, not a
        # continuous measurement, so it's kept visible for a short TTL.
        self.track_calibrated_speed = {}
        self.CALIBRATED_SPEED_TTL = 8.0

        # Line-crossed tracker to avoid multiple counts: {line_id: set(track_ids)}
        self.crossed_ids = {}
        
        # Heatmap grid: 32x32 resolution
        self.heatmap_grid = np.zeros((32, 32), dtype=np.float32)
        
        # Global Counters
        self.counter_in = 0
        self.counter_out = 0
        self.counter_in_person = 0
        self.counter_out_person = 0
        self.counter_in_vehicle = 0
        self.counter_out_vehicle = 0
        
        # Alert timestamps to prevent spam: {alert_key: last_trigger_time}
        self.alert_cooldowns = {}

        # Features an operator has switched on that this build cannot actually
        # deliver (no model ships for them). Warned once per camera rather than
        # per frame — the point is that the gap is visible in the log, not that
        # it floods it.
        self._warned_unavailable = {}
        self.cooldown_period = 3.0
        
        # --- Advanced Zone & Line Metrics Persistence ---
        # {zone_id: {track_id: enter_time}}
        self.zone_active_tracks = {}
        # {zone_id: list of dwell_time floats}
        self.zone_dwell_history = {}
        # {zone_id: max_occupancy}
        self.zone_max_occupancy = {}
        # {zone_id: entry_count}
        self.zone_entry_counts = {}
        # {zone_id: exit_count}
        self.zone_exit_counts = {}
        # {zone_id: count of frames occupied}
        self.zone_occupied_frames = {}
        # {zone_id: total frames evaluated}
        self.zone_total_frames = {}
        
        # {line_id: {in_count, out_count}}
        self.line_counters = {}

        # --- Abandoned Object Detection ---
        self.item_stationary_since = {}  # track_id -> ts when it first became stationary
        self.abandoned_object_ids = set()  # track_ids currently flagged abandoned
        self.ABANDONED_DWELL_SECONDS = 15.0
        self.ABANDONED_MOVEMENT_EPS = 0.02   # normalized max-spread over recent history to count as "stationary"
        self.PERSON_PROXIMITY = 0.15         # normalized distance under which a person "owns" a nearby item

        # --- Crowd Density Estimation ---
        # Grids the whole frame (independent of any drawn zone) so local
        # crowding is caught anywhere, not only inside a manually-configured
        # zone polygon. Density is measured as peak people-per-cell rather
        # than total frame count, since a scattered crowd of 20 and a
        # packed cluster of 20 in one corner are very different situations.
        self.CROWD_GRID = 4  # 4x4 cells
        self.CROWD_THRESHOLDS = {"moderate": 3, "high": 6, "critical": 10}  # people per cell

    def update(self, detections, zones, lines, frame_w: int = 640, frame_h: int = 480, frame=None, rules=None, zone_profile=None, profile_features=None):
        features = json.loads(profile_features) if isinstance(profile_features, str) else (profile_features or {})

        # Extract Homography Matrix Calibration points if configured
        speed_cfg = features.get("speed_detection", {})
        if isinstance(speed_cfg, dict):
            src_pts = speed_cfg.get("src_points") or speed_cfg.get("calibration_points")
            dst_pts = speed_cfg.get("dst_points") or speed_cfg.get("real_world_rect")
            if src_pts and dst_pts:
                if (self.homography_src_pts != src_pts) or (self.homography_dst_pts != dst_pts):
                    self.homography_src_pts = src_pts
                    self.homography_dst_pts = dst_pts
                    self.homography_H = compute_homography_matrix(src_pts, dst_pts)

        # 1. Schedule Gating
        schedule_active = True
        sched = features.get("schedule", {})
        if sched.get("enabled"):
            params = sched.get("params", {})
            mode = params.get("mode", "always")
            if mode != "always":
                import datetime
                now_dt = datetime.datetime.now()
                weekday = now_dt.weekday() # 0 = Monday, 6 = Sunday
                current_time = now_dt.strftime("%H:%M")
                if mode == "business":
                    schedule_active = (0 <= weekday <= 4) and ("08:00" <= current_time <= "18:00")
                elif mode == "night":
                    schedule_active = (current_time >= "18:00") or (current_time <= "06:00")
                elif mode == "custom":
                    start_t = params.get("start", "08:00")
                    end_t = params.get("end", "18:00")
                    if start_t <= end_t:
                        schedule_active = start_t <= current_time <= end_t
                    else:
                        schedule_active = (current_time >= start_t) or (current_time <= end_t)

        # 2. Dynamic Class Filtering per Profile — see filter_by_profile().
        # Applied defensively here as well as in the pipeline, because this
        # method is the one that drives zone/line/alert logic and must never
        # see a class the profile excludes even if a caller forgets.
        detections = filter_by_profile(detections, zone_profile)

        # 3. Enhance detections with PPE heuristics
        #
        # The "Face Detection Heuristic" that used to live here has been REMOVED.
        # It did not detect faces: for every person box it emitted a "face"
        # covering the top 18% of that box, carrying the *person's* confidence
        # (typically 0.9). It never looked at a single pixel of the face region,
        # so a person facing away, wearing a helmet, or too far to resolve still
        # produced "Face Detected: Human facial features recognized" at 0.90.
        #
        # Real face detection now runs in the pipeline (app/ai/face.py, YuNet /
        # MIT) before analytics.update() is called, and appends genuine
        # class=="face" detections with genuine scores. The alert loop below is
        # unchanged — it just finally has real input. Re-adding a geometric
        # guess here would double every face and undo that.
        # The PPE heuristic that used to live here has been REMOVED too.
        #
        # _detect_ppe_hsv() colour-thresholded the top 18% of a person box for
        # yellow/blue/white ("helmet") and the 18-55% band for hi-vis ("vest"),
        # then emitted helmet/no_helmet/vest/no_vest at a HARDCODED confidence
        # of 0.95 — a number with nothing behind it, since the function returns
        # only a bool.
        #
        # Measured against dtest/bus_pan.mp4, on two pedestrians wearing neither
        # a helmet nor a vest (240 person-checks over 120 frames):
        #
        #     "helmet" : 39/240  (16%)  — every one false
        #     "vest"   : 53/240  (22%)  — every one false
        #
        # It also flickers frame to frame, so a single worker alternates between
        # helmet and no_helmet, spraying PPE-violation alerts at random. Blonde
        # hair, a blue cap, or sky behind the head reads as a hard hat; a bare
        # head in shadow reads as a violation. For a compliance feature — where
        # the output is "this worker is unsafe" — inventing both the finding and
        # its confidence is worse than reporting nothing.
        #
        # Real PPE detection needs a trained helmet/vest model. COCO (and so
        # yolox_tiny) has no such class. The same licence constraint as
        # fire/smoke applies: most public PPE models are YOLOv5/v8 (AGPL-3.0).
        if frame is not None and zone_profile == "factory":
            if features.get("ppe_detection", {}).get("enabled") and not self._warned_unavailable.get("ppe_detection"):
                self._warned_unavailable["ppe_detection"] = True
                print(
                    "[analytics] ppe_detection is enabled for this camera but no PPE model "
                    "ships with this build — it will not produce detections. The previous "
                    "colour-threshold implementation was removed: on people wearing no PPE "
                    "it invented helmets on 16% of checks and vests on 22%, at a hardcoded "
                    "confidence of 0.95.",
                    flush=True,
                )

        # 4. Fire & Smoke detection (Security / Factory) — REMOVED, see below.
        #
        # What was here: an HSV colour threshold over a 160x120 downscale.
        # "Fire" was >0.5% of pixels being bright orange/red; "smoke" was >2% of
        # pixels being low-saturation and mid-bright — i.e. grey. Both then
        # appended a detection with a HARDCODED confidence (0.9 / 0.85) and a
        # bbox covering the entire frame, which fired
        # "CRITICAL FIRE WARNING" / "Smoke Alarm: Smoke plume detected".
        #
        # Measured against dtest/bus_pan.mp4 — ordinary street footage with no
        # fire and no smoke anywhere in it — the shipped thresholds produced:
        #
        #     fire  :   0/200 frames
        #     smoke : 200/200 frames   <- 100% false-positive rate
        #
        # The smoke mask latched onto concrete pavement, a building facade and a
        # beige coat: 2402 px against a 384 px threshold, 6x over. Anything grey
        # is "smoke"; anything red is "fire". A red shirt, a sunset, a traffic
        # cone or a concrete floor all trip it.
        #
        # This is deliberately deleted rather than retuned. No threshold over
        # hue separates smoke from concrete — the information isn't in the
        # colour histogram, which is why real fire/smoke detection uses a
        # trained model. A safety alarm that fires on every frame is worse than
        # no alarm: it trains the operator to ignore it, so the one real fire is
        # missed too.
        #
        # Restoring these features needs a real detector. The licence matters as
        # much as the accuracy: nearly every public fire/smoke model is
        # YOLOv5/YOLOv8 derived and therefore AGPL-3.0, which would
        # re-contaminate a binary this product deliberately cleaned (see
        # LICENSING.md, and app/ai/face.py for the MIT/Apache path taken for
        # faces). Until such a model ships, fire_detection / smoke_detection
        # produce nothing and say so, rather than crying wolf.
        if frame is not None and zone_profile in ("security", "factory"):
            for _feat in ("fire_detection", "smoke_detection"):
                if features.get(_feat, {}).get("enabled") and not self._warned_unavailable.get(_feat):
                    self._warned_unavailable[_feat] = True
                    print(
                        f"[analytics] {_feat} is enabled for this camera but no "
                        f"{_feat.split('_')[0]} model ships with this build — it will not "
                        f"produce detections. The previous colour-threshold implementation "
                        f"was removed: it false-alarmed on 100% of frames of ordinary "
                        f"footage (concrete read as smoke).",
                        flush=True,
                    )

        # Save schedule state for later gating of standard alerts
        self._schedule_active = schedule_active

        active_track_ids = set()
        alerts = []
        now = time.time()
        
        # Filter detections inside privacy masks / exclusion zones, or outside active inclusion ROI zones
        filtered_detections = []
        inclusion_zones = [
            z for z in zones
            if z.get("zoneType") not in ("privacy_mask", "exclusion_zone", "speed_zone", "calibration_line", "heatmap_area")
            and len(z.get("points", [])) >= 2
        ]

        for det in detections:
            bbox = det["bbox"]
            cx = (bbox["x1"] + bbox["x2"]) / 2.0 / frame_w
            cy = (bbox["y1"] + bbox["y2"]) / 2.0 / frame_h
            bottom_y = bbox["y2"] / frame_h

            # 1. Privacy mask & Exclusion zone check
            is_masked = False
            for zone in zones:
                z_type = zone.get("zoneType")
                if z_type in ("privacy_mask", "exclusion_zone"):
                    pts = zone.get("points", [])
                    shape_type = zone.get("shapeType", "polygon")
                    if len(pts) >= 2 and _point_in_zone_shape(cx, cy, pts, shape_type):
                        is_masked = True
                        break
            if is_masked:
                continue

            # 2. Inclusion ROI zone check (if inclusion zones are defined, object must be inside at least one)
            if inclusion_zones:
                in_any_zone = False
                for zone in inclusion_zones:
                    pts = zone.get("points", [])
                    shape_type = zone.get("shapeType", "polygon")
                    if _point_in_zone_shape(cx, cy, pts, shape_type) or _point_in_zone_shape(cx, bottom_y, pts, shape_type):
                        in_any_zone = True
                        break
                if not in_any_zone:
                    continue

            filtered_detections.append(det)
        detections = filtered_detections
        
        # Read or initialize metadata tracking structures
        for zone in zones:
            z_id = zone["id"]
            if z_id not in self.zone_active_tracks:
                self.zone_active_tracks[z_id] = {}
            if z_id not in self.zone_dwell_history:
                self.zone_dwell_history[z_id] = []
            if z_id not in self.zone_max_occupancy:
                self.zone_max_occupancy[z_id] = 0
            if z_id not in self.zone_entry_counts:
                self.zone_entry_counts[z_id] = 0
            if z_id not in self.zone_exit_counts:
                self.zone_exit_counts[z_id] = 0
            if z_id not in self.zone_occupied_frames:
                self.zone_occupied_frames[z_id] = 0
            if z_id not in self.zone_total_frames:
                self.zone_total_frames[z_id] = 0
                
        for line in lines:
            l_id = line["id"]
            if l_id not in self.line_counters:
                self.line_counters[l_id] = {"in_count": 0, "out_count": 0}
        lines_by_id = {line["id"]: line for line in lines}

        # Process active detections
        for det in detections:
            track_id = det.get("track_id")
            class_name = det.get("class", "person")
            
            if track_id is None:
                continue
            
            active_track_ids.add(track_id)
            self.track_classes[track_id] = class_name
            
            # bbox arrives already Kalman-filtered by the tracker (see
            # PipelineCoordinator._tracking_loop_iteration) — no further
            # smoothing here. An EMA pass used to run on this box too; two
            # independent smoothers in series is what produced a box that
            # visibly trailed behind fast-moving objects instead of staying
            # locked to them.
            bbox = det["bbox"]

            # Centroid
            cx = (bbox["x1"] + bbox["x2"]) / 2.0 / frame_w
            cy = (bbox["y1"] + bbox["y2"]) / 2.0 / frame_h
            bottom_x = cx
            bottom_y = bbox["y2"] / frame_h  # bottom edge collision point
            
            # ── Automatic speed estimation — no lines to draw ────────────────
            #
            # Real km/h needs a real scale reference. Rather than asking the
            # operator to draw a calibration gate, the OBJECT ITSELF is the
            # reference: a car is ~1.5m tall, so its pixel height tells us
            # metres-per-pixel at its depth (see CLASS_HEIGHT_M). Displacement in
            # pixels x metres-per-pixel / seconds = m/s. Real units, derived from
            # a real measured quantity, self-calibrating per camera.
            #
            # This REPLACES a fabricated value: speed used to be
            #   (normalised_displacement / dt) * 100.0 / (cy + 0.2)
            # where 100.0 was invented and (cy+0.2) stood in for perspective. It
            # could not be km/h and changed meaning if you re-mounted the camera.
            #
            # Honest about accuracy: this is an ESTIMATE, roughly +/-20-30%. The
            # height prior is a class average (a hatchback and an SUV are both
            # "car"), and it assumes motion roughly parallel to the image plane —
            # a vehicle driving straight at the camera covers little pixel
            # distance for a lot of real distance, so it reads low. Good enough
            # to see that traffic is doing ~50 vs ~90. NOT good enough to fine
            # anyone, which is why speed_calibrated stays False and the
            # speed-limit alerts below still require a real two-line gate.
            # Permanent vehicle track label
            det["track_label"] = f"{class_name.replace('_', ' ').title()} #{track_id:02d}"

            # ── Homography Perspective Transformation & Automatic Speed Estimation ──
            x1p, y1p = float(bbox["x1"]), float(bbox["y1"])
            x2p, y2p = float(bbox["x2"]), float(bbox["y2"])
            cx_px, cy_px = (x1p + x2p) / 2.0, (y1p + y2p) / 2.0

            mpp_raw = _estimate_mpp(bbox, class_name, frame_w, frame_h)
            if mpp_raw is not None:
                prev_mpp = self.track_mpp.get(track_id)
                self.track_mpp[track_id] = (
                    mpp_raw if prev_mpp is None else 0.7 * prev_mpp + 0.3 * mpp_raw
                )
            # The 0.025 default is a smoothing fallback for a class that DOES
            # have a real size prior (CLASS_HEIGHT_M) when this frame's own
            # geometry check failed (bbox at the edge, too small). A class
            # with no prior at all (traffic_light, stop_sign...) must never
            # get a speed number from a generic guess — mpp stays None and
            # the fallback estimate below is skipped for it entirely.
            mpp = self.track_mpp.get(track_id) or (0.025 if class_name in CLASS_HEIGHT_M else None)

            speed_kmh = self.track_speeds.get(track_id)
            speed_calibrated = False
            speed_source = "estimated"

            # 1. Homography (IPM) Perspective Transformation
            if self.homography_H is not None:
                world_pt = transform_point_homography(self.homography_H, cx_px, cy_px)
                if world_pt is not None:
                    last_world = self.track_last_world_m.get(track_id)
                    if last_world is not None:
                        last_time, (wx_prev, wy_prev) = last_world
                        dt = now - last_time
                        if 0.02 <= dt <= 2.0:
                            dist_m = float(np.hypot(world_pt[0] - wx_prev, world_pt[1] - wy_prev))
                            raw_kmh = 0.0 if dist_m < 0.04 else min((dist_m / dt) * 3.6, self.SPEED_HARD_CAP)
                            filt = self.speed_filters.setdefault(track_id, _SpeedKalman1D())
                            speed_kmh = max(0.0, filt.update(raw_kmh))
                            self.track_speeds[track_id] = speed_kmh
                            speed_calibrated = True
                            speed_source = "homography"
                    self.track_last_world_m[track_id] = (now, world_pt)

            # 2. Fallback to Height Scale MPP Estimation if Homography not configured
            #
            # This is an ESTIMATE (see the accuracy note above), never a
            # calibrated measurement, regardless of how many consecutive
            # frames refine it — speed_calibrated must stay False here so the
            # speed-limit alert gates below keep requiring a real two-line
            # gate. Skipped entirely for a class with no size prior (mpp is
            # None), rather than falling back to a generic guess.
            if not speed_calibrated and mpp is not None:
                last_px = self.track_last_px.get(track_id)
                if last_px is not None:
                    last_time, (last_cx_px, last_cy_px) = last_px
                    dt = now - last_time
                    if 0.02 <= dt <= 2.0:
                        dist_px = float(np.hypot(cx_px - last_cx_px, cy_px - last_cy_px))
                        raw_kmh = 0.0 if dist_px < 1.0 else min((dist_px * mpp / dt) * 3.6, self.SPEED_HARD_CAP)
                        filt = self.speed_filters.setdefault(track_id, _SpeedKalman1D())
                        speed_kmh = max(0.0, filt.update(raw_kmh))
                        self.track_speeds[track_id] = speed_kmh
                        speed_source = "estimated"
                self.track_last_px[track_id] = (now, (cx_px, cy_px))
                self.speed_filters.setdefault(track_id, _SpeedKalman1D())

            # Keep the normalised trail updated for direction/history consumers.
            self.track_last_pts[track_id] = (now, (cx, cy))

            # Do NOT fabricate 0.0 for a vehicle whose speed isn't computed yet.
            # speed_kmh is None only until this track has a prior position (its
            # first tracked frame, or every re-acquisition after an ID switch).
            # Forcing 0.0 here stamped a misleading "0 km/h" on a car that is
            # actually moving — worst when the track flickers, so it reads 0 the
            # whole time. Leave it None: the client shows no number (honest
            # "not measured yet") instead of a wrong measurement. Once the track
            # survives 2 frames a real estimate lands in track_speeds and shows.
            if speed_kmh is None:
                det["speed"] = None
                det["speed_source"] = "acquiring" if class_name in PRODUCIBLE_VEHICLE_CLASSES else "unavailable"
                det["speed_calibrated"] = False
            else:
                det["speed"] = round(float(speed_kmh), 1)
                det["speed_source"] = speed_source
                # Must reflect the actual measurement source (True only for
                # the homography branch above) - hardcoding True here was the
                # bug that let a plain height-based estimate raise real
                # speeding alerts (see the speed-limit gates further down).
                det["speed_calibrated"] = speed_calibrated

            # Direction: 8-way compass label from recent screen-space motion.
            last_pt = self.track_history[track_id][-1] if self.track_history.get(track_id) else None
            det["direction"] = _direction_label(cx - last_pt[0], cy - last_pt[1]) if last_pt else "stationary"

            # Lane assignment
            det["lane"] = _lane_for_point(cx, cy, zones)

            # --- Enterprise Overspeed Detection & Logging ---
            speed_limit = float(features.get("speed_detection", {}).get("speed_limit", 50.0))
            det["speed_limit"] = speed_limit
            if speed_kmh is not None and speed_calibrated and speed_kmh > speed_limit and class_name in VEHICLE_CLASSES:
                det["overspeed"] = True
                alert_key = f"overspeed_{track_id}"
                if now - self.alert_cooldowns.get(alert_key, 0) > 10.0:
                    self.alert_cooldowns[alert_key] = now
                    lane_label = det.get("lane") or "Main Lane"
                    msg = f"OVERSPEED: {det['track_label']} at {det['speed']} km/h (Limit: {speed_limit} km/h) on {lane_label}"
                    alerts.append({
                        "type": "speed_limit",
                        "message": msg,
                        "detail": {
                            "track_id": track_id,
                            "vehicle_type": class_name,
                            "speed_kmh": det["speed"],
                            "speed_limit": speed_limit,
                            "lane": lane_label,
                            "severity": "warning",
                        }
                    })
                    from app.storage import insert_vehicle_speed_log
                    insert_vehicle_speed_log(
                        log_id=f"spd_{int(now*1000)}_{track_id}",
                        camera_id=self.camera_id,
                        track_id=track_id,
                        vehicle_type=class_name,
                        speed_kmh=det["speed"],
                        speed_limit_kmh=speed_limit,
                        is_overspeed=True,
                        lane=lane_label
                    )

            # Update Track History
            if track_id not in self.track_history:
                self.track_history[track_id] = []
                self.track_history_ts[track_id] = []
            self.track_history[track_id].append([cx, cy])
            self.track_history_ts[track_id].append(now)
            if len(self.track_history[track_id]) > self.track_history_maxlen:
                self.track_history[track_id].pop(0)
                self.track_history_ts[track_id].pop(0)

            # Accumulate Heatmap
            grid_x = min(max(int(cx * 32), 0), 31)
            grid_y = min(max(int(cy * 32), 0), 31)
            self.heatmap_grid[grid_y, grid_x] += 0.5

            self.track_last_seen[track_id] = now

        # IDs still "in grace" — either detected this frame, or occluded
        # recently enough that the tracker may still re-identify them under
        # the same id. Zone occupancy below uses this (not just this frame's
        # active_track_ids) so a momentarily-occluded track's last known
        # position keeps counting as "inside", instead of registering a
        # spurious zone-exit/re-entry the instant it's out of view.
        tracked_ids_in_grace = {
            tid for tid in self.track_history
            if now - self.track_last_seen.get(tid, 0) <= self.REID_GRACE_SECONDS
        }

        # --- Abandoned Object Detection ---
        # An item-class track (bag/suitcase/backpack/umbrella) that stops
        # moving and has no person within proximity for longer than
        # ABANDONED_DWELL_SECONDS is flagged. Stationarity is measured as the
        # spread of its recent centroid history rather than frame-to-frame
        # delta so normal detector/bbox jitter doesn't reset the timer.
        person_positions = [
            self.track_history[tid][-1]
            for tid in active_track_ids
            if self.track_classes.get(tid) == "person" and self.track_history.get(tid)
        ]

        # --- Crowd Density Estimation ---
        grid_n = self.CROWD_GRID
        density_grid = np.zeros((grid_n, grid_n), dtype=np.int32)
        for px, py in person_positions:
            gx = min(grid_n - 1, max(0, int(px * grid_n)))
            gy = min(grid_n - 1, max(0, int(py * grid_n)))
            density_grid[gy, gx] += 1
        peak_cell_count = int(density_grid.max()) if density_grid.size else 0
        if peak_cell_count >= self.CROWD_THRESHOLDS["critical"]:
            density_level = "critical"
        elif peak_cell_count >= self.CROWD_THRESHOLDS["high"]:
            density_level = "high"
        elif peak_cell_count >= self.CROWD_THRESHOLDS["moderate"]:
            density_level = "moderate"
        else:
            density_level = "low"
        crowd_stats = {
            "total_people": len(person_positions),
            "peak_cell_count": peak_cell_count,
            "density_level": density_level,
            "grid_size": grid_n,
        }
        if density_level in ("high", "critical"):
            alert_key = "crowd_density"
            cooldown = 5.0 if density_level == "critical" else 15.0
            if now - self.alert_cooldowns.get(alert_key, 0) > cooldown:
                alerts.append({
                    "type": "crowd_density",
                    "message": f"Crowd density {density_level}: {peak_cell_count} people clustered in one area "
                               f"({len(person_positions)} total in frame)",
                })
                self.alert_cooldowns[alert_key] = now

        for tid in active_track_ids:
            cls_name = self.track_classes.get(tid)
            if cls_name not in ITEM_CLASSES:
                continue
            hist = self.track_history.get(tid, [])
            if len(hist) < 5:
                continue
            recent = np.array(hist[-10:])
            spread = float(np.max(recent.max(axis=0) - recent.min(axis=0)))
            if spread > self.ABANDONED_MOVEMENT_EPS:
                self.item_stationary_since.pop(tid, None)
                self.abandoned_object_ids.discard(tid)
                continue
            if tid not in self.item_stationary_since:
                self.item_stationary_since[tid] = now
                continue
            stationary_for = now - self.item_stationary_since[tid]
            if stationary_for < self.ABANDONED_DWELL_SECONDS:
                continue
            px, py = hist[-1]
            has_owner_nearby = any(
                np.hypot(px - ppx, py - ppy) < self.PERSON_PROXIMITY for ppx, ppy in person_positions
            )
            if has_owner_nearby:
                self.abandoned_object_ids.discard(tid)
                continue
            self.abandoned_object_ids.add(tid)
            alert_key = f"abandoned_{tid}"
            if now - self.alert_cooldowns.get(alert_key, 0) > 20.0:
                alerts.append({
                    "type": "abandoned_object",
                    "message": f"{cls_name.capitalize()} (ID: {tid}) left unattended for {int(stationary_for)}s",
                })
                self.alert_cooldowns[alert_key] = now

        # --- Helmet / triple-riding violations (traffic) -------------------
        # helmet.py appends genuine class=="no_helmet"/"helmet" boxes (on rider
        # crops) before this method runs — same contract as face.py. Those boxes
        # carry NO track_id, so alerting on them directly would fire once PER
        # FRAME per bare head: a snapshot + 20s clip + DB row every ~33ms. We
        # instead associate each violation to the tracked MOTORCYCLE it sits on
        # and dedup by that stable track id (exactly how the zone/abandoned
        # alerts above dedup via alert_cooldowns), so one rider = one event.
        no_helmet_dets = [d for d in detections if d.get("class") == "no_helmet"]
        if no_helmet_dets:
            # confidence gate: a low-confidence "motorcycle" call (e.g. a car
            # the detector wasn't sure about) must not anchor a real alert —
            # see VEHICLE_ACTION_MIN_CONFIDENCE in config.py.
            motos = [d for d in detections
                     if d.get("class") == "motorcycle" and d.get("track_id") is not None
                     and d.get("confidence", 0.0) >= config.VEHICLE_ACTION_MIN_CONFIDENCE]
            persons = [d for d in detections if d.get("class") == "person"]

            def _cx(b):
                return (b["x1"] + b["x2"]) / 2.0

            def _has_valid_rider(mb):
                """Same rider window as app/ai/helmet.py's _rider_crops(): a
                real PERSON (not just the no_helmet head box itself) must sit
                on this specific motorcycle. Without this, a dense curbside
                row of parked bikes still let _assoc_moto pick whichever
                PARKED bike happened to be geometrically closest to a head
                detected on a genuinely different, real rider nearby — the
                per-head window alone can't tell two adjacent bikes apart in
                a tight cluster, but "does THIS bike have its own rider" can.
                Confirmed live 2026-08-02: 2/15 evidence crops still showed a
                riderless parked bike after the by-head-only fix."""
                pad = (mb["x2"] - mb["x1"]) * 0.25
                moto_h = mb["y2"] - mb["y1"]
                for p in persons:
                    if p.get("confidence", 0.0) < config.HELMET_RIDER_MIN_PERSON_CONFIDENCE:
                        continue
                    pb = p["bbox"]
                    p_cx = _cx(pb)
                    if not (mb["x1"] - pad <= p_cx <= mb["x2"] + pad):
                        continue
                    if not (mb["y1"] - moto_h * 1.2 <= pb["y2"] <= mb["y2"] + moto_h * 0.3):
                        continue
                    return True
                return False

            def _assoc_moto(box):
                """The tracked motorcycle a rider-region box belongs to: its
                horizontal centre falls within the bike's x-span (padded) and it
                sits at/above the bike, within about one bike-height of it, AND
                that specific motorcycle has its own valid rider (_has_valid_rider)
                — not just proximity to the head box. Returns the closest such
                motorcycle det.

                The vertical side used to only reject boxes BELOW the bike
                (box centre > mb["y2"]), with no upper bound — so a head
                anywhere above a motorcycle, no matter how far (a pedestrian
                standing yards away but horizontally within the 25% pad),
                would associate to it. That produced both false-positive
                helmet_violation alerts on people who were never on the bike,
                and evidence crops (rider_bbox = this motorcycle's box) showing
                an unrelated bike instead of the actual rider — confirmed via
                a live spot-check run 2026-08-02. Bounding the vertical window
                fixed the isolated case, but in a dense parked-bike row the
                window of several adjacent bikes overlaps, so the "closest
                bike" was still sometimes a parked one — the _has_valid_rider
                check added 2026-08-02 rejects any candidate bike that doesn't
                itself have a person actually on it."""
                bx = _cx(box["bbox"])
                by2 = box["bbox"]["y2"]
                best, best_dx = None, None
                for m in motos:
                    mb = m["bbox"]
                    pad = (mb["x2"] - mb["x1"]) * 0.25
                    if not (mb["x1"] - pad <= bx <= mb["x2"] + pad):
                        continue
                    moto_h = mb["y2"] - mb["y1"]
                    if not (mb["y1"] - moto_h * 1.2 <= by2 <= mb["y2"]):
                        continue  # not above the bike, or too far above it to be its rider
                    if not _has_valid_rider(mb):
                        continue  # this specific bike has no rider of its own — a nearby parked bike, not a match
                    dx = abs(bx - _cx(mb))
                    if best_dx is None or dx < best_dx:
                        best, best_dx = m, dx
                return best

            for nh in no_helmet_dets:
                moto = _assoc_moto(nh)
                if moto is None:
                    continue  # a bare head with no bike under it is not a rider
                tid = moto["track_id"]
                alert_key = f"helmet_violation_{tid}"
                # Fires once per rider, not once per config.HELMET_COOLDOWN
                # seconds. A rider who sits in frame for two minutes (traffic
                # signal, parked at a stall) used to re-trigger every
                # HELMET_COOLDOWN (15s default) - four-plus Telegram messages
                # for one still-in-frame rider who never left. alert_key is
                # cleared the moment this track_id is actually pruned as gone
                # (see the dead_tracks sweep below, which deletes every
                # "*_{tid}"-suffixed cooldown key), so a genuinely NEW pass by
                # a different rider - or the same rider leaving and coming
                # back - still gets its own fresh alert. Only "the same
                # continuous sighting" is deduplicated to one.
                if alert_key not in self.alert_cooldowns:
                    riders = sum(
                        1 for p in persons
                        if moto["bbox"]["x1"] - (moto["bbox"]["x2"] - moto["bbox"]["x1"]) * 0.25
                        <= _cx(p["bbox"])
                        <= moto["bbox"]["x2"] + (moto["bbox"]["x2"] - moto["bbox"]["x1"]) * 0.25
                        and p["bbox"]["y2"] >= moto["bbox"]["y1"]
                    )
                    triple = riders >= 3
                    msg = (f"No-helmet rider on motorcycle (ID: {tid}) "
                           f"[conf {nh['confidence']:.2f}]")
                    if triple:
                        msg += f" — triple riding ({riders} on one bike)"
                    # rider_bbox / helmet_bbox let the pipeline crop and save the
                    # rider and helmet regions as evidence alongside the full
                    # frame (pipeline.py evidence block). Absolute pixel coords.
                    alerts.append({
                        "type": "triple_riding" if triple else "helmet_violation",
                        "message": msg,
                        "track_id": tid,
                        "rider_bbox": dict(moto["bbox"]),
                        "helmet_bbox": dict(nh["bbox"]),
                    })
                    self.alert_cooldowns[alert_key] = now

        # --- ANPR: log a read plate to the vehicle it sits on --------------
        # plate.py appends class=="number_plate" boxes (on vehicle crops) with a
        # plate_text filled by OCR (or None if unread). Like the helmet block,
        # the boxes carry no track_id, so we associate a READ plate to the
        # tracked vehicle whose box contains it and log once per vehicle within
        # a cooldown — a plate log, not a per-frame spam. Localised-but-unread
        # plates (plate_text is None) still render as boxes but raise no event:
        # a plate log with no number is not worth an event or a clip.
        plate_dets = [d for d in detections
                      if d.get("class") == "number_plate" and d.get("plate_text")]
        if plate_dets:
            veh_tracks = [d for d in detections
                          if d.get("class") in VEHICLE_CLASSES and d.get("track_id") is not None]

            def _pcx(b):
                return (b["x1"] + b["x2"]) / 2.0

            def _pcy(b):
                return (b["y1"] + b["y2"]) / 2.0

            for pl in plate_dets:
                pb = pl["bbox"]
                cx, cy = _pcx(pb), _pcy(pb)
                # the vehicle track whose box contains the plate centre; if
                # several, the smallest (the plate's own vehicle, not a bus
                # behind it).
                best, best_area = None, None
                for v in veh_tracks:
                    vb = v["bbox"]
                    if vb["x1"] <= cx <= vb["x2"] and vb["y1"] <= cy <= vb["y2"]:
                        area = (vb["x2"] - vb["x1"]) * (vb["y2"] - vb["y1"])
                        if best_area is None or area < best_area:
                            best, best_area = v, area
                if best is None:
                    continue
                tid = best["track_id"]
                text = pl["plate_text"]
                alert_key = f"number_plate_{tid}"
                if now - self.alert_cooldowns.get(alert_key, 0) > config.ANPR_EVENT_COOLDOWN:
                    alerts.append({
                        "type": "number_plate",
                        "message": f"Plate {text} — {best.get('class', 'vehicle')} (ID: {tid})",
                        "track_id": tid,
                        "plate_text": text,
                        "plate_bbox": dict(pb),
                    })
                    self.alert_cooldowns[alert_key] = now

        parking_slots = []

        # --- Advanced Zone Analytics ---
        zone_stats = {}
        for zone in zones:
            z_id = zone["id"]
            z_name = zone.get("name", "Zone")
            shape_type = zone.get("shapeType", "polygon")
            zone_type = zone.get("zoneType", "intrusion")
            max_occupancy = zone.get("maxOccupancy", 5)
            dwell_limit = zone.get("dwellLimit", 10)
            pts = zone["points"]
            is_parking_slot = zone_type == "parking"
            
            self.zone_total_frames[z_id] += 1
            
            # 1. Identify which active tracks are inside this zone. Uses
            # tracked_ids_in_grace (not just this frame's active_track_ids)
            # so a track occluded mid-zone keeps its last known position
            # counted as "inside" instead of falsely exiting/re-entering.
            tracks_inside_this_frame = set()

            if len(pts) >= 2:
                for track_id in tracked_ids_in_grace:
                    hist = self.track_history.get(track_id, [])
                    if not hist:
                        continue
                    # Check collision at the bottom edge (bottom-center)
                    px = hist[-1][0]
                    py = hist[-1][1]
                    
                    is_inside = _point_in_zone_shape(px, py, pts, shape_type)

                    if is_inside:
                        tracks_inside_this_frame.add(track_id)
            
            # Parking slots are occupancy regions, not intrusion/loitering
            # zones. They still reuse the polygon editor and output a
            # zone_stats row, but they do not raise generic entry/exit/full
            # alerts; slot state is reported in parking_stats below.
            if is_parking_slot:
                abs_pts = [[p[0] * frame_w, p[1] * frame_h] for p in pts]
                best_vehicle = None
                best_overlap = 0.0
                for det in detections:
                    if _object_category(det.get("class", "")) != "vehicle":
                        continue
                    overlap = _bbox_overlap_ratio(det["bbox"], abs_pts, frame_w, frame_h)
                    if overlap > best_overlap:
                        best_overlap = overlap
                        best_vehicle = det
                visual_score = _parking_visual_score(frame, abs_pts)
                occupied_by_vehicle = best_overlap >= float(zone.get("parkingOverlapThreshold", 0.12))
                occupied_by_visual = visual_score >= float(zone.get("parkingScoreThreshold", PARKING_OCCUPANCY_SCORE_THRESHOLD))
                occupied = occupied_by_vehicle or occupied_by_visual
                reason = "vehicle_overlap" if occupied_by_vehicle else ("visual_score" if occupied_by_visual else "clear")
                parking_slots.append({
                    "id": z_id,
                    "name": z_name,
                    "occupied": bool(occupied),
                    "status": "occupied" if occupied else "free",
                    "score": round(visual_score, 1),
                    "vehicle_overlap": round(best_overlap, 3),
                    "vehicle_track_id": best_vehicle.get("track_id") if best_vehicle else None,
                    "reason": reason,
                    "points": pts,
                })
                if occupied:
                    self.zone_occupied_frames[z_id] += 1
                util = float(self.zone_occupied_frames[z_id]) / max(1.0, float(self.zone_total_frames[z_id]))
                zone_stats[z_id] = {
                    "people_count": 0,
                    "vehicles_count": 1 if occupied else 0,
                    "items_count": 0,
                    "occupancy": 1 if occupied else 0,
                    "max_occupancy": 1,
                    "entry_count": 0,
                    "exit_count": 0,
                    "avg_dwell_time": 0.0,
                    "loitering_count": 0,
                    "utilization": round(util * 100, 1),
                    "status": "danger" if occupied else "normal",
                    "parking_status": "occupied" if occupied else "free",
                    "parking_score": round(visual_score, 1),
                    "parking_reason": reason,
                }
                continue

            # 2. Compute Entry, Exit, and Dwell metrics
            people_count = 0
            vehicles_count = 0
            items_count = 0
            loitering_count = 0
            
            current_active = self.zone_active_tracks[z_id] # track_id -> enter_time
            
            # Entries
            for tid in tracks_inside_this_frame:
                if tid not in current_active:
                    current_active[tid] = now
                    self.zone_entry_counts[z_id] += 1
                    
                    # Entry alerts
                    class_name = self.track_classes.get(tid, "person")
                    category = _object_category(class_name)
                    alert_type = {
                        "person": "human_entry",
                        "vehicle": "vehicle_entry",
                        "item": "item_entry",
                        "infrastructure": "infrastructure_present",
                    }.get(category, "object_entry")
                    
                    # Custom rule check for zone_intrusion
                    custom_triggered = False
                    if rules and (zone_profile is None or zone_profile == "custom"):
                        for rule in rules:
                            if not rule.get("is_enabled", True):
                                continue
                            if rule.get("trigger_type") == "zone_intrusion" and rule.get("trigger_source_id") == z_id:
                                conds = rule.get("conditions", {})
                                target_class = conds.get("class")
                                min_conf = conds.get("min_confidence", 0.0)
                                
                                trk_conf = 1.0
                                for d in detections:
                                    if d.get("track_id") == tid:
                                        trk_conf = d.get("confidence", 1.0)
                                        break
                                        
                                class_match = not target_class or target_class == class_name or target_class == category
                                conf_match = trk_conf >= float(min_conf)
                                
                                if class_match and conf_match:
                                    custom_triggered = True
                                    alert_msg = f"Rule '{rule.get('name')}': Custom intrusion detected in '{z_name}'"
                                    for act in rule.get("actions", []):
                                        if act.get("type") == "alert" and act.get("message"):
                                            alert_msg = act.get("message")
                                            break
                                            
                                    alert_key = f"custom_intrusion_{rule.get('id')}_{tid}"
                                    if now - self.alert_cooldowns.get(alert_key, 0) > self.cooldown_period:
                                        alerts.append({
                                            "type": "custom_rule",
                                            "message": alert_msg,
                                            "zone_id": z_id,
                                            "rule_id": rule.get("id")
                                        })
                                        self.alert_cooldowns[alert_key] = now
                    
                    if not custom_triggered:
                        alert_key = f"{alert_type}_{z_id}_{tid}"
                        if zone_profile is None and now - self.alert_cooldowns.get(alert_key, 0) > self.cooldown_period:
                            alerts.append({
                                "type": alert_type,
                                "message": f"{class_name.capitalize()} (ID: {tid}) entered {zone_type} Zone '{z_name}'",
                                "zone_id": z_id
                            })
                            self.alert_cooldowns[alert_key] = now
                        
            # Exits
            exited_tids = []
            for tid in list(current_active.keys()):
                if tid not in tracks_inside_this_frame:
                    enter_time = current_active.pop(tid)
                    exited_tids.append(tid)
                    self.zone_exit_counts[z_id] += 1
                    
                    # Calculate completed dwell duration
                    dwell_duration = now - enter_time
                    self.zone_dwell_history[z_id].append(dwell_duration)
                    if len(self.zone_dwell_history[z_id]) > 50:
                        self.zone_dwell_history[z_id].pop(0)
            
            # Current class classification inside zone
            for tid in tracks_inside_this_frame:
                cls_name = self.track_classes.get(tid, "person")
                category = _object_category(cls_name)
                if category == "person":
                    people_count += 1
                elif category == "vehicle":
                    vehicles_count += 1
                elif category == "item":
                    items_count += 1
                
                # Check loitering
                enter_t = current_active.get(tid, now)
                time_inside = now - enter_t
                
                custom_loiter_triggered = False
                if rules and (zone_profile is None or zone_profile == "custom"):
                    for rule in rules:
                        if not rule.get("is_enabled", True):
                            continue
                        if rule.get("trigger_type") == "loitering" and rule.get("trigger_source_id") == z_id:
                            conds = rule.get("conditions", {})
                            target_class = conds.get("class")
                            min_conf = conds.get("min_confidence", 0.0)
                            custom_dwell = float(conds.get("dwell_time") or conds.get("dwell_threshold") or dwell_limit)
                            
                            if time_inside > custom_dwell:
                                trk_conf = 1.0
                                for d in detections:
                                    if d.get("track_id") == tid:
                                        trk_conf = d.get("confidence", 1.0)
                                        break
                                class_match = not target_class or target_class == cls_name or target_class == category
                                conf_match = trk_conf >= float(min_conf)
                                
                                if class_match and conf_match:
                                    custom_loiter_triggered = True
                                    loitering_count += 1
                                    alert_msg = f"Rule '{rule.get('name')}': Loitering in '{z_name}' for {int(time_inside)}s"
                                    for act in rule.get("actions", []):
                                        if act.get("type") == "alert" and act.get("message"):
                                            alert_msg = act.get("message")
                                            break
                                            
                                    alert_key = f"custom_loitering_{rule.get('id')}_{tid}"
                                    if now - self.alert_cooldowns.get(alert_key, 0) > 10.0:
                                        alerts.append({
                                            "type": "custom_rule",
                                            "message": alert_msg,
                                            "zone_id": z_id,
                                            "rule_id": rule.get("id")
                                        })
                                        self.alert_cooldowns[alert_key] = now
                                        
                if zone_profile is None and not custom_loiter_triggered and time_inside > float(dwell_limit):
                    loitering_count += 1
                    alert_key = f"loitering_{z_id}_{tid}"
                    if now - self.alert_cooldowns.get(alert_key, 0) > 10.0:
                        alerts.append({
                            "type": "loitering",
                            "message": f"{cls_name.capitalize()} ID:{tid} loitering in '{z_name}' for {int(time_inside)}s",
                            "zone_id": z_id
                        })
                        self.alert_cooldowns[alert_key] = now

            # Overcrowding / Occupancy stats
            occupancy = people_count + vehicles_count + items_count
            if occupancy > 0:
                self.zone_occupied_frames[z_id] += 1
                
            self.zone_max_occupancy[z_id] = max(self.zone_max_occupancy[z_id], occupancy)
            
            # Overcrowding Warning
            if zone_profile is None and occupancy > int(max_occupancy):
                alert_key = f"overcrowding_{z_id}"
                if now - self.alert_cooldowns.get(alert_key, 0) > 10.0:
                    alerts.append({
                        "type": "overcrowding",
                        "message": f"Overcrowding Alert in '{z_name}': {occupancy}/{max_occupancy} objects detected!",
                        "zone_id": z_id
                    })
                    self.alert_cooldowns[alert_key] = now
                    
            # Zone Empty/Full transition alerts
            if zone_profile is None and occupancy == 0 and len(exited_tids) > 0:
                alert_key = f"zone_empty_{z_id}"
                if now - self.alert_cooldowns.get(alert_key, 0) > 5.0:
                    alerts.append({
                        "type": "zone_empty",
                        "message": f"Zone '{z_name}' is now empty",
                        "zone_id": z_id
                    })
                    self.alert_cooldowns[alert_key] = now
            elif zone_profile is None and occupancy >= int(max_occupancy) and occupancy > 0:
                alert_key = f"zone_full_{z_id}"
                if now - self.alert_cooldowns.get(alert_key, 0) > 10.0:
                    alerts.append({
                        "type": "zone_full",
                        "message": f"Zone '{z_name}' has reached capacity ({occupancy}/{max_occupancy})",
                        "zone_id": z_id
                    })
                    self.alert_cooldowns[alert_key] = now

            # Average dwell time calculation
            dwells = self.zone_dwell_history[z_id]
            avg_dwell = float(np.mean(dwells)) if dwells else 0.0
            
            # Utilization (frame occupancy ratio)
            util = float(self.zone_occupied_frames[z_id]) / max(1.0, float(self.zone_total_frames[z_id]))

            zone_stats[z_id] = {
                "people_count": people_count,
                "vehicles_count": vehicles_count,
                "items_count": items_count,
                "occupancy": occupancy,
                "max_occupancy": self.zone_max_occupancy[z_id],
                "entry_count": self.zone_entry_counts[z_id],
                "exit_count": self.zone_exit_counts[z_id],
                "avg_dwell_time": round(avg_dwell, 1),
                "loitering_count": loitering_count,
                "utilization": round(util * 100, 1),
                "status": "danger" if loitering_count > 0 or occupancy > int(max_occupancy) else "normal"
            }

        parking_total = len(parking_slots)
        parking_occupied = sum(1 for slot in parking_slots if slot["occupied"])
        parking_stats = {
            "total": parking_total,
            "occupied": parking_occupied,
            "free": max(0, parking_total - parking_occupied),
            "occupancy_percent": round((parking_occupied / parking_total) * 100.0, 1) if parking_total else 0.0,
            "slots": parking_slots,
        }

        # --- Advanced Line Crossing Analytics ---
        line_stats = {}
        for line in lines:
            l_id = line["id"]
            l_name = line.get("name", "Line")
            line_pts = line["points"]
            line_type = line.get("lineType", "crossing") # entry_counting, exit_counting, wrong_direction, etc
            
            if len(line_pts) < 2:
                continue
                
            A, B = line_pts[0], line_pts[1]
            
            if l_id not in self.crossed_ids:
                self.crossed_ids[l_id] = set()
                
            for track_id in active_track_ids:
                if track_id in self.crossed_ids[l_id]:
                    continue
                    
                hist = self.track_history.get(track_id, [])
                if len(hist) < 2:
                    continue
                    
                p_prev = hist[-2]
                p_curr = hist[-1]

                # Check line intersection
                if check_line_intersection(p_prev, p_curr, A, B):
                    self.crossed_ids[l_id].add(track_id)

                    # Interpolate the real instant of crossing along the
                    # prev->curr motion instead of using this tracking
                    # cycle's timestamp — see segment_crossing_fraction.
                    ts_hist = self.track_history_ts.get(track_id, [])
                    if len(ts_hist) >= 2:
                        frac = segment_crossing_fraction(p_prev, p_curr, A, B)
                        ts_prev, ts_curr = ts_hist[-2], ts_hist[-1]
                        crossing_ts = ts_prev + (frac if frac is not None else 1.0) * (ts_curr - ts_prev)
                    else:
                        crossing_ts = now

                    self._update_speed_gate(track_id, l_id, line, lines_by_id, crossing_ts)

                    side_prev = get_point_line_side(p_prev, A, B)
                    side_curr = get_point_line_side(p_curr, A, B)
                    
                    class_name = self.track_classes.get(track_id, "person")
                    category = _object_category(class_name)
                    is_vehicle = category == "vehicle"

                    # Crossing events
                    is_in = side_prev < 0 <= side_curr
                    is_out = side_prev > 0 >= side_curr

                    custom_crossing_triggered = False
                    if rules and (zone_profile is None or zone_profile == "custom"):
                        for rule in rules:
                            if not rule.get("is_enabled", True):
                                continue
                            if rule.get("trigger_type") == "line_crossing" and rule.get("trigger_source_id") == l_id:
                                conds = rule.get("conditions", {})
                                target_class = conds.get("class")
                                min_conf = conds.get("min_confidence", 0.0)
                                target_direction = conds.get("direction") # "in" or "out"
                                
                                dir_match = True
                                if target_direction == "in" and not is_in:
                                    dir_match = False
                                elif target_direction == "out" and not is_out:
                                    dir_match = False
                                    
                                trk_conf = 1.0
                                for d in detections:
                                    if d.get("track_id") == track_id:
                                        trk_conf = d.get("confidence", 1.0)
                                        break
                                        
                                class_match = not target_class or target_class == class_name or target_class == category
                                conf_match = trk_conf >= float(min_conf)
                                
                                if class_match and conf_match and dir_match:
                                    custom_crossing_triggered = True
                                    alert_msg = f"Rule '{rule.get('name')}': Crossed line '{l_name}'"
                                    for act in rule.get("actions", []):
                                        if act.get("type") == "alert" and act.get("message"):
                                            alert_msg = act.get("message")
                                            break
                                            
                                    alert_key = f"custom_crossing_{rule.get('id')}_{track_id}"
                                    if now - self.alert_cooldowns.get(alert_key, 0) > self.cooldown_period:
                                        alerts.append({
                                            "type": "custom_rule",
                                            "message": alert_msg,
                                            "line_id": l_id,
                                            "rule_id": rule.get("id")
                                        })
                                        self.alert_cooldowns[alert_key] = now

                    # Increment standard counters
                    if is_in:
                        self.line_counters[l_id]["in_count"] += 1
                        if is_vehicle:
                            self.counter_in_vehicle += 1
                            self.counter_in += 1
                        elif category == "person":
                            self.counter_in_person += 1
                            self.counter_in += 1
                    elif is_out:
                        self.line_counters[l_id]["out_count"] += 1
                        if is_vehicle:
                            self.counter_out_vehicle += 1
                            self.counter_out += 1
                        elif category == "person":
                            self.counter_out_person += 1
                            self.counter_out += 1

                    if not custom_crossing_triggered:
                        if zone_profile is None and is_in and category == "person":
                            alert_key = f"crossing_{l_id}_{track_id}"
                            if now - self.alert_cooldowns.get(alert_key, 0) > self.cooldown_period:
                                alerts.append({
                                    "type": "crossing",
                                    "message": f"{class_name.capitalize()} crossed line '{l_name}' (Entry, ID: {track_id})",
                                    "line_id": l_id
                                })
                                self.alert_cooldowns[alert_key] = now
                        elif is_out:
                            if zone_profile is None and line_type in ["one_way", "wrong_direction"]:
                                alert_key = f"wrong_dir_{l_id}_{track_id}"
                                if now - self.alert_cooldowns.get(alert_key, 0) > self.cooldown_period:
                                    alerts.append({
                                        "type": "wrong_direction",
                                        "message": f"Wrong Direction Alarm: {class_name.capitalize()} (ID: {track_id}) crossed '{l_name}' backward!",
                                        "line_id": l_id
                                    })
                                    self.alert_cooldowns[alert_key] = now
                            elif zone_profile is None and category == "person":
                                alert_key = f"crossing_{l_id}_{track_id}"
                                if now - self.alert_cooldowns.get(alert_key, 0) > self.cooldown_period:
                                    alerts.append({
                                        "type": "crossing",
                                        "message": f"{class_name.capitalize()} crossed line '{l_name}' (Exit, ID: {track_id})",
                                        "line_id": l_id
                                    })
                                    self.alert_cooldowns[alert_key] = now

            line_stats[l_id] = {
                "in_count": self.line_counters[l_id]["in_count"],
                "out_count": self.line_counters[l_id]["out_count"],
                "total_count": self.line_counters[l_id]["in_count"] + self.line_counters[l_id]["out_count"]
            }

        # --- Apply calibrated (real-world) speed over the auto estimate --------
        # A two-line gate is a MEASUREMENT, not an estimate: the track crossed
        # two lines a known ground distance apart, so speed = metres / seconds.
        # It beats the object-height estimate whenever one exists, because it
        # needs no assumption about how tall the vehicle is or which way it is
        # travelling. Drawing a gate is now an accuracy upgrade rather than the
        # price of seeing any speed at all.
        #
        # A gate crossing is a one-shot event, so the reading stays visible for
        # CALIBRATED_SPEED_TTL seconds after being measured instead of only
        # flashing for the single frame it was computed on.
        for det in detections:
            track_id = det.get("track_id")
            if track_id is None:
                continue
            calibrated = self.track_calibrated_speed.get(track_id)
            if calibrated and now - calibrated["ts"] <= self.CALIBRATED_SPEED_TTL:
                det["speed"] = round(calibrated["speed_kmh"], 1)
                det["speed_calibrated"] = True
                det["speed_source"] = "calibrated"
            # else: leave the automatic estimate the per-detection loop produced.

        # Custom speed limit rules check
        if rules and (zone_profile is None or zone_profile == "custom"):
            for det in detections:
                track_id = det.get("track_id")
                if track_id is None:
                    continue
                class_name = self.track_classes.get(track_id, "person")
                category = _object_category(class_name)
                speed = det.get("speed")

                for rule in rules:
                    if not rule.get("is_enabled", True):
                        continue
                    if rule.get("trigger_type") == "speed_limit":
                        # MEASURED speed only. det["speed"] is now usually
                        # populated by the automatic object-height estimate,
                        # which is ~+/-20-30% — fine for showing an operator that
                        # traffic is doing ~50, nowhere near good enough to
                        # accuse a specific vehicle of speeding. A violation is
                        # an accusation, so it requires a two-line gate.
                        # Gating on `speed is not None` would silently re-enable
                        # exactly the fabricated-evidence behaviour this replaced.
                        # Scoped to this branch, not the whole det loop: a future
                        # trigger_type must not inherit "skip unless a gate exists".
                        if not det.get("speed_calibrated") or speed is None:
                            continue
                        conds = rule.get("conditions", {})
                        speed_limit = float(conds.get("speed_limit") or conds.get("speed_threshold") or 50.0)
                        
                        if speed > speed_limit:
                            target_class = conds.get("class")
                            class_match = not target_class or target_class == class_name or target_class == category
                            
                            if class_match:
                                alert_msg = f"Rule '{rule.get('name')}': Speed limit exceeded ({speed} km/h)"
                                for act in rule.get("actions", []):
                                    if act.get("type") == "alert" and act.get("message"):
                                        alert_msg = act.get("message")
                                        break
                                        
                                alert_key = f"custom_speed_{rule.get('id')}_{track_id}"
                                if now - self.alert_cooldowns.get(alert_key, 0) > 10.0:
                                    alerts.append({
                                        "type": "custom_rule",
                                        "message": alert_msg,
                                        "rule_id": rule.get("id")
                                    })
                                    self.alert_cooldowns[alert_key] = now

        # 5. Profile-specific alerts (Traffic, Security, Factory, Custom)
        if schedule_active:
            if zone_profile == "traffic":
                wrong_way_cfg = features.get("wrong_way_detection", {})
                if wrong_way_cfg.get("enabled"):
                    allowed_heading = float(wrong_way_cfg.get("allowed_heading", 0.0))
                    for det in detections:
                        track_id = det.get("track_id")
                        if track_id is None:
                            continue
                        cls_name = self.track_classes.get(track_id, "person")
                        if _object_category(cls_name) != "vehicle":
                            continue
                        hist = self.track_history.get(track_id, [])
                        if len(hist) >= 3:
                            p_start = hist[-3]
                            p_end = hist[-1]
                            dx = p_end[0] - p_start[0]
                            dy = p_end[1] - p_start[1]
                            import math
                            angle_rad = math.atan2(dx, -dy)
                            heading = (math.degrees(angle_rad) + 360.0) % 360.0
                            
                            diff = abs(heading - allowed_heading)
                            diff = min(diff, 360.0 - diff)
                            if diff > 120.0:
                                alert_key = f"traffic_wrong_way_{track_id}"
                                if now - self.alert_cooldowns.get(alert_key, 0) > 15.0:
                                    alerts.append({
                                        "type": "wrong_direction",
                                        "message": f"Wrong-Way Alert: Vehicle (ID: {track_id}) moving opposite to permitted direction ({int(heading)}° vs allowed {int(allowed_heading)}°)",
                                        "track_id": track_id
                                    })
                                    self.alert_cooldowns[alert_key] = now

                speed_limit_cfg = features.get("speed_limit", {})
                if speed_limit_cfg.get("enabled"):
                    limit_val = float(speed_limit_cfg.get("limit", 50.0))
                    for det in detections:
                        track_id = det.get("track_id")
                        if track_id is not None:
                            cls_name = self.track_classes.get(track_id, "person")
                            if _object_category(cls_name) == "vehicle":
                                # Calibrated (gate-measured) readings only — see
                                # the custom speed_limit rule above. The automatic
                                # estimate is deliberately not enough to raise a
                                # violation against a named vehicle.
                                speed = det.get("speed")
                                if not det.get("speed_calibrated") or speed is None:
                                    continue
                                if speed > limit_val:
                                    alert_key = f"traffic_speed_violation_{track_id}"
                                    if now - self.alert_cooldowns.get(alert_key, 0) > 15.0:
                                        alerts.append({
                                            "type": "speed_limit",
                                            "message": f"Speed Violation: Vehicle (ID: {track_id}) detected at {int(speed)} km/h (Limit: {int(limit_val)} km/h)",
                                            "track_id": track_id
                                        })
                                        self.alert_cooldowns[alert_key] = now

            elif zone_profile == "security":
                restricted_cfg = features.get("restricted_area", {})
                if restricted_cfg.get("enabled"):
                    for zone in zones:
                        z_type = zone.get("zoneType")
                        if z_type in ("privacy_mask", "exclusion_zone"):
                            continue
                        z_id = zone.get("id")
                        z_name = zone.get("name", "Restricted Area")
                        current_active = self.zone_active_tracks.get(z_id, {})
                        for tid in current_active:
                            cls_name = self.track_classes.get(tid, "person")
                            if cls_name in ("person", "car", "truck", "dog", "cat", "bear"):
                                alert_key = f"security_restricted_{z_id}_{tid}"
                                if now - self.alert_cooldowns.get(alert_key, 0) > 15.0:
                                    alerts.append({
                                        "type": "human_entry" if cls_name == "person" else "object_entry",
                                        "message": f"Restricted Area Intrusion: {cls_name.capitalize()} (ID: {tid}) detected inside '{z_name}'",
                                        "zone_id": z_id
                                    })
                                    self.alert_cooldowns[alert_key] = now

                loitering_cfg = features.get("loitering", {})
                if loitering_cfg.get("enabled"):
                    dwell_thresh = float(loitering_cfg.get("dwell_time", 15.0))
                    for zone in zones:
                        z_type = zone.get("zoneType")
                        if z_type in ("privacy_mask", "exclusion_zone"):
                            continue
                        z_id = zone.get("id")
                        z_name = zone.get("name", "Zone")
                        current_active = self.zone_active_tracks.get(z_id, {})
                        for tid in current_active:
                            enter_t = current_active.get(tid, now)
                            time_inside = now - enter_t
                            if time_inside > dwell_thresh:
                                cls_name = self.track_classes.get(tid, "person")
                                if cls_name == "person":
                                    alert_key = f"security_loitering_{z_id}_{tid}"
                                    if now - self.alert_cooldowns.get(alert_key, 0) > 15.0:
                                        alerts.append({
                                            "type": "loitering",
                                            "message": f"Security Loitering: Person (ID: {tid}) loitering in '{z_name}' for {int(time_inside)}s",
                                            "zone_id": z_id
                                        })
                                        self.alert_cooldowns[alert_key] = now

                face_cfg = features.get("face_detection", {})
                if face_cfg.get("enabled"):
                    for det in detections:
                        if det["class"] == "face":
                            if now - self.alert_cooldowns.get("security_face_detected_time", 0) > 10.0:
                                alerts.append({
                                    "type": "face_detection",
                                    "message": "Face Detected: Human facial features recognized"
                                })
                                self.alert_cooldowns["security_face_detected_time"] = now

                fire_cfg = features.get("fire_detection", {})
                if fire_cfg.get("enabled"):
                    for det in detections:
                        if det["class"] == "fire":
                            alert_key = "security_fire_detected"
                            if now - self.alert_cooldowns.get(alert_key, 0) > 15.0:
                                alerts.append({
                                    "type": "fire_alert",
                                    "message": "CRITICAL FIRE WARNING: Fire/Flame signature detected!"
                                })
                                self.alert_cooldowns[alert_key] = now
                                
                smoke_cfg = features.get("smoke_detection", {})
                if smoke_cfg.get("enabled"):
                    for det in detections:
                        if det["class"] == "smoke":
                            alert_key = "security_smoke_detected"
                            if now - self.alert_cooldowns.get(alert_key, 0) > 20.0:
                                alerts.append({
                                    "type": "smoke_alert",
                                    "message": "Smoke Alarm: Smoke plume detected in the environment"
                                })
                                self.alert_cooldowns[alert_key] = now

                fall_cfg = features.get("fall_detection", {})
                if fall_cfg.get("enabled"):
                    for det in detections:
                        if det["class"] == "person":
                            bbox = det["bbox"]
                            w_px = bbox["x2"] - bbox["x1"]
                            h_px = bbox["y2"] - bbox["y1"]
                            if h_px > 0 and (w_px / h_px) > 1.25:
                                track_id = det.get("track_id")
                                alert_key = f"security_fall_{track_id or now}"
                                if now - self.alert_cooldowns.get(alert_key, 0) > 20.0:
                                    alerts.append({
                                        "type": "fall_alert",
                                        "message": f"FALL DETECTION WARNING: Person fell down! (ID: {track_id or 'unknown'})"
                                    })
                                    self.alert_cooldowns[alert_key] = now

            elif zone_profile == "factory":
                hazard_cfg = features.get("hazard_zone", {})
                if hazard_cfg.get("enabled"):
                    for zone in zones:
                        z_type = zone.get("zoneType")
                        if z_type in ("privacy_mask", "exclusion_zone"):
                            continue
                        z_id = zone.get("id")
                        z_name = zone.get("name", "Hazard Zone")
                        current_active = self.zone_active_tracks.get(z_id, {})
                        for tid in current_active:
                            cls_name = self.track_classes.get(tid, "person")
                            if cls_name == "person":
                                alert_key = f"factory_hazard_{z_id}_{tid}"
                                # This says "entered" - it should fire once per
                                # worker per continuous time inside the zone,
                                # not every 15s they remain there. A worker
                                # standing in a hazard zone for two minutes
                                # used to raise 8 separate "entered" alerts for
                                # an entry that happened once. The key clears
                                # once this track_id is pruned as gone for good
                                # (see the dead_tracks sweep below), so a worker
                                # who genuinely leaves and a different one who
                                # enters later both still alert normally. A
                                # worker who exits this zone but stays tracked
                                # elsewhere in frame and re-enters later will
                                # not re-alert until their track fully expires -
                                # narrower than the general zone alerts below
                                # (which re-arm on exit), accepted here since
                                # the reported problem was the opposite failure
                                # (repeat spam for one continuous visit).
                                if alert_key not in self.alert_cooldowns:
                                    alerts.append({
                                        "type": "human_entry",
                                        "message": f"Hazard Zone Entry: Worker (ID: {tid}) entered restricted hazard area '{z_name}'",
                                        "zone_id": z_id
                                    })
                                    self.alert_cooldowns[alert_key] = now

                ppe_cfg = features.get("ppe_detection", {})
                if ppe_cfg.get("enabled"):
                    # no_helmet/no_vest boxes carry no track_id of their own
                    # (same as the helmet_violation block above) - det.get(
                    # "track_id") was therefore almost always None here, which
                    # made the key fall back to f"..._{now}": a NEW key every
                    # single frame, so the 25.0s cooldown below never actually
                    # applied and this alerted on every frame a violation was
                    # visible. Associate to the nearest tracked person instead,
                    # exactly like the motorcycle association above, so the
                    # dedup key is stable for as long as the same worker is in
                    # frame.
                    ppe_persons = [d for d in detections
                                   if d.get("class") == "person" and d.get("track_id") is not None]

                    def _ppe_cx(b):
                        return (b["x1"] + b["x2"]) / 2.0

                    def _assoc_person(box):
                        bx = _ppe_cx(box)
                        best, best_dx = None, None
                        for p in ppe_persons:
                            pb = p["bbox"]
                            pad = (pb["x2"] - pb["x1"]) * 0.25
                            if not (pb["x1"] - pad <= bx <= pb["x2"] + pad):
                                continue
                            dx = abs(bx - _ppe_cx(pb))
                            if best_dx is None or dx < best_dx:
                                best, best_dx = p, dx
                        return best

                    for det in detections:
                        if det["class"] in ("no_helmet", "no_vest"):
                            worker = _assoc_person(det["bbox"])
                            track_id = worker["track_id"] if worker else None
                            violation_type = "No Helmet" if det["class"] == "no_helmet" else "No Vest"
                            alert_key = f"factory_ppe_{violation_type}_{track_id or now}"
                            # Once per worker per continuous sighting, not once
                            # per 25s - see helmet_violation above for why and
                            # for how the key clears itself once the track is
                            # actually gone. A worker with no associated track
                            # still falls back to the old time-cooldown (there
                            # is no stable identity to dedup by), rather than
                            # silently dropping the violation.
                            fresh = (
                                alert_key not in self.alert_cooldowns if track_id is not None
                                else now - self.alert_cooldowns.get(alert_key, 0) > 25.0
                            )
                            if fresh:
                                alerts.append({
                                    "type": "ppe_violation",
                                    "message": f"PPE Violation: worker (ID: {track_id or 'unknown'}) is missing required {violation_type.split()[-1].lower()}!",
                                    "track_id": track_id
                                })
                                self.alert_cooldowns[alert_key] = now

        # Cleanup tracks that have been gone long enough to be presumed
        # permanently gone (not just occluded — see REID_GRACE_SECONDS /
        # tracked_ids_in_grace above, which must stay in sync with this).
        dead_tracks = [tid for tid in list(self.track_history.keys()) if tid not in tracked_ids_in_grace]
        for tid in dead_tracks:
            if tid in self.track_history: del self.track_history[tid]
            self.track_history_ts.pop(tid, None)
            if tid in self.track_classes: del self.track_classes[tid]
            if tid in self.track_speeds: del self.track_speeds[tid]
            if tid in self.track_last_pts: del self.track_last_pts[tid]
            # Auto-scale state is per-track and must die with it, or a busy road
            # grows these dicts unbounded across a shift.
            self.track_mpp.pop(tid, None)
            self.track_last_px.pop(tid, None)
            # Written once per track per frame by the homography speed path
            # (see track_last_world_m assignment above) but missing from this
            # cleanup, so it was the one per-track dict that outlived its
            # track. Track ids churn constantly, so on a busy scene this grew
            # for the entire lifetime of the camera thread — small per entry,
            # unbounded in aggregate, and invisible because every sibling dict
            # beside it was being pruned correctly.
            self.track_last_world_m.pop(tid, None)
            self.speed_filters.pop(tid, None)
            self.track_last_seen.pop(tid, None)
            self.item_stationary_since.pop(tid, None)
            self.abandoned_object_ids.discard(tid)
            self.speed_gate_pending.pop(tid, None)
            self.track_calibrated_speed.pop(tid, None)

            # Clean active track zone bindings
            for z_id in self.zone_active_tracks:
                if tid in self.zone_active_tracks[z_id]:
                    enter_t = self.zone_active_tracks[z_id].pop(tid)
                    dwell_duration = now - enter_t
                    self.zone_dwell_history[z_id].append(dwell_duration)

            for line_id in self.crossed_ids:
                self.crossed_ids[line_id].discard(tid)

            # alert_cooldowns keys are suffixed with the track_id (e.g.
            # "crossing_{line}_{tid}", "loitering_{zone}_{tid}") and are never
            # touched elsewhere. Track IDs churn constantly under ByteTrack,
            # so leaving these in place made the dict grow without bound for
            # the lifetime of the camera thread.
            suffix = f"_{tid}"
            for key in [k for k in self.alert_cooldowns if k.endswith(suffix)]:
                del self.alert_cooldowns[key]

        # Decay heatmap slightly
        self.heatmap_grid *= 0.995

        # Format track overlays for UI drawing (recent tail path)
        track_overlays = []
        for tid, pts in self.track_history.items():
            track_overlays.append({
                "track_id": tid,
                "class": self.track_classes.get(tid, "person"),
                "points": pts
            })

        # Serialize heatmap grid
        heatmap_list = self.heatmap_grid.tolist()

        return alerts, track_overlays, heatmap_list, zone_stats, line_stats, crowd_stats, parking_stats

    def _update_speed_gate(self, track_id, l_id, line, lines_by_id, crossing_ts):
        """Two-line, known-real-world-distance speed measurement.

        Same method used by line-crossing vehicle speed estimators (e.g.
        YOLO+DeepSORT speed-gate projects): a track's speed is measured once
        it crosses two lines a known distance_m apart on the ground —
        speed_kmh = (distance_m / dt) * 3.6. A line declares its gate
        partner via speedPairId (the other line's id) and carries the real
        distance between the two lines in distanceM (meters).

        crossing_ts is the interpolated instant of this crossing (see
        segment_crossing_fraction), not just the tracking cycle's timestamp —
        this keeps dt (and therefore speed_kmh) accurate even when a fast
        vehicle covers a large fraction of the frame between cycles.
        """
        pending = self.speed_gate_pending.get(track_id)
        if pending is None:
            self.speed_gate_pending[track_id] = (l_id, crossing_ts)
            return

        prev_line_id, t1 = pending
        if prev_line_id == l_id:
            return  # re-crossed the same line without hitting its pair yet

        prev_line = lines_by_id.get(prev_line_id)
        paired = (
            (prev_line is not None and prev_line.get("speedPairId") == l_id)
            or line.get("speedPairId") == prev_line_id
        )
        if not paired:
            # Not a declared gate pair — treat this crossing as a fresh gate start.
            self.speed_gate_pending[track_id] = (l_id, crossing_ts)
            return

        distance_m = line.get("distanceM") or (prev_line.get("distanceM") if prev_line else None)
        dt = crossing_ts - t1
        if distance_m and dt >= 0.02:
            speed_kmh = (float(distance_m) / dt) * 3.6
            self.track_calibrated_speed[track_id] = {"speed_kmh": speed_kmh, "ts": crossing_ts}
        del self.speed_gate_pending[track_id]

    def reset_counters(self):
        self.counter_in = 0
        self.counter_out = 0
        self.counter_in_person = 0
        self.counter_out_person = 0
        self.counter_in_vehicle = 0
        self.counter_out_vehicle = 0
        self.zone_active_tracks.clear()
        self.zone_dwell_history.clear()
        self.zone_max_occupancy.clear()
        self.zone_entry_counts.clear()
        self.zone_exit_counts.clear()
        self.zone_occupied_frames.clear()
        self.zone_total_frames.clear()
        self.line_counters.clear()
        self.crossed_ids.clear()
        self.speed_gate_pending.clear()
        self.track_calibrated_speed.clear()
