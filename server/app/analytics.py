import time
import cv2
import numpy as np

# Classes treated as "items" for abandoned-object detection — anything that
# isn't a person or vehicle and can plausibly be left behind. Must stay in
# sync with the classes enabled in app/ai/backend.py's COCO_CLASS_MAP.
ITEM_CLASSES = {"backpack", "handbag", "suitcase", "umbrella"}
VEHICLE_CLASSES = {"car", "bus", "truck", "motorcycle", "bicycle"}
INFRASTRUCTURE_CLASSES = {"traffic_light", "stop_sign", "traffic_cone", "traffic_barrier"}
PARKING_OCCUPANCY_SCORE_THRESHOLD = 24.0


def _object_category(class_name: str) -> str:
    """person | vehicle | item | infrastructure | other — used everywhere a detection needs to be
    bucketed for counting/alerting so item-class detections (added for
    abandoned-object detection) don't silently get miscounted as vehicles."""
    if class_name in ITEM_CLASSES:
        return "item"
    if class_name in VEHICLE_CLASSES:
        return "vehicle"
    if class_name in INFRASTRUCTURE_CLASSES:
        return "infrastructure"
    if class_name == "person":
        return "person"
    return "other"

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
    exactly the same geometry test."""
    if shape_type == "circle" and len(pts) >= 2:
        cx_c, cy_c = pts[0][0], pts[0][1]
        ex_c, ey_c = pts[1][0], pts[1][1]
        radius = np.sqrt((ex_c - cx_c) ** 2 + (ey_c - cy_c) ** 2)
        return np.sqrt((px - cx_c) ** 2 + (py - cy_c) ** 2) <= radius
    if shape_type in ("rect", "rectangle") and len(pts) >= 2:
        x1 = min(pts[0][0], pts[1][0]); x2 = max(pts[0][0], pts[1][0])
        y1 = min(pts[0][1], pts[1][1]); y2 = max(pts[0][1], pts[1][1])
        return (x1 <= px <= x2) and (y1 <= py <= y2)
    poly_points = np.array(pts, dtype=np.float32)
    return cv2.pointPolygonTest(poly_points, (px, py), False) >= 0


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


def _detect_ppe_hsv(frame, bbox, frame_w, frame_h):
    """
    HSV color segmentation on person crops to check for hard-hats and high-vis vests.
    - Head area: top 18% of person bounding box.
    - Torso area: 18% to 55% of person bounding box.
    """
    x1 = max(0, int(bbox["x1"]))
    y1 = max(0, int(bbox["y1"]))
    x2 = min(frame_w - 1, int(bbox["x2"]))
    y2 = min(frame_h - 1, int(bbox["y2"]))
    
    h = y2 - y1
    w = x2 - x1
    if h <= 10 or w <= 10:
        return False, False
        
    person_crop = frame[y1:y2, x1:x2]
    if person_crop.size == 0:
        return False, False
        
    hsv = cv2.cvtColor(person_crop, cv2.COLOR_BGR2HSV)
    
    # 1. Helmet check (top 18% of crop)
    head_h = int(h * 0.18)
    has_helmet = False
    if head_h > 0:
        head_crop = hsv[0:head_h, :]
        if head_crop.size > 0:
            total_head = head_crop.shape[0] * head_crop.shape[1]
            
            # Common helmet colors
            mask_yellow = cv2.inRange(head_crop, np.array([15, 80, 100]), np.array([35, 255, 255]))
            mask_blue = cv2.inRange(head_crop, np.array([90, 70, 80]), np.array([130, 255, 255]))
            mask_red1 = cv2.inRange(head_crop, np.array([0, 80, 80]), np.array([10, 255, 255]))
            mask_red2 = cv2.inRange(head_crop, np.array([170, 80, 80]), np.array([180, 255, 255]))
            mask_white = cv2.inRange(head_crop, np.array([0, 0, 190]), np.array([180, 50, 255]))
            
            helmet_pixels = (
                cv2.countNonZero(mask_yellow) +
                cv2.countNonZero(mask_blue) +
                cv2.countNonZero(mask_red1) +
                cv2.countNonZero(mask_red2) +
                cv2.countNonZero(mask_white)
            )
            has_helmet = (helmet_pixels / total_head) > 0.12
            
    # 2. Vest check (18% to 55% of crop)
    torso_start = head_h
    torso_end = int(h * 0.55)
    has_vest = False
    if torso_end > torso_start:
        torso_crop = hsv[torso_start:torso_end, :]
        if torso_crop.size > 0:
            total_torso = torso_crop.shape[0] * torso_crop.shape[1]
            
            # Neon green / high-vis orange
            mask_neon = cv2.inRange(torso_crop, np.array([30, 60, 80]), np.array([85, 255, 255]))
            mask_orange1 = cv2.inRange(torso_crop, np.array([0, 80, 100]), np.array([25, 255, 255]))
            mask_orange2 = cv2.inRange(torso_crop, np.array([155, 80, 100]), np.array([180, 255, 255]))
            
            vest_pixels = (
                cv2.countNonZero(mask_neon) +
                cv2.countNonZero(mask_orange1) +
                cv2.countNonZero(mask_orange2)
            )
            has_vest = (vest_pixels / total_torso) > 0.15
            
    return has_helmet, has_vest


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
        self.track_last_pts = {}  # track_id -> (timestamp, (cx, cy))
        self.speed_filters = {}   # track_id -> _SpeedKalman1D
        # Approximate pixel-to-world scale factor for the uncalibrated speed
        # estimate below (heuristic — see _update_speed_gate for the actually
        # calibrated two-line/real-distance measurement, which always takes
        # priority over this one whenever a camera has a gate configured).
        self.SPEED_SCALE = 100.0
        self.SPEED_HARD_CAP = 200.0  # sanity bound only, not a per-class heuristic

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

        # 2. Dynamic Class Filtering per Profile (applied to incoming YOLO detections)
        if zone_profile == "traffic":
            detections = [d for d in detections if d["class"] in VEHICLE_CLASSES]
        elif zone_profile == "security":
            sec_classes = {"person", "backpack", "handbag", "suitcase", "fire", "smoke", "face", "dog", "cat", "bear"}
            detections = [d for d in detections if d["class"] in sec_classes]
        elif zone_profile == "factory":
            fac_classes = {"person", "helmet", "vest", "gloves", "shoes", "no_helmet", "no_vest"}
            detections = [d for d in detections if d["class"] in fac_classes]

        # 3. Enhance detections with Face and PPE heuristics
        enhanced_detections = []
        for det in detections:
            enhanced_detections.append(det)
            
            # Face Detection Heuristic (Security Profile)
            if zone_profile == "security" and features.get("face_detection", {}).get("enabled"):
                if det["class"] == "person":
                    bbox = det["bbox"]
                    x1, y1, x2, y2 = bbox["x1"], bbox["y1"], bbox["x2"], bbox["y2"]
                    h = y2 - y1
                    face_y2 = y1 + int(h * 0.18)
                    enhanced_detections.append({
                        "class": "face",
                        "confidence": det.get("confidence", 0.9),
                        "bbox": {"x1": x1, "y1": y1, "x2": x2, "y2": face_y2}
                    })
                    
            # PPE Detection Heuristic (Factory Profile)
            if zone_profile == "factory" and features.get("ppe_detection", {}).get("enabled") and frame is not None:
                if det["class"] == "person":
                    bbox = det["bbox"]
                    has_helmet, has_vest = _detect_ppe_hsv(frame, bbox, frame_w, frame_h)
                    
                    x1, y1, x2, y2 = bbox["x1"], bbox["y1"], bbox["x2"], bbox["y2"]
                    h = y2 - y1
                    
                    # Helmet region
                    helmet_y2 = y1 + int(h * 0.18)
                    if has_helmet:
                        enhanced_detections.append({
                            "class": "helmet",
                            "confidence": 0.95,
                            "bbox": {"x1": x1, "y1": y1, "x2": x2, "y2": helmet_y2}
                        })
                    else:
                        enhanced_detections.append({
                            "class": "no_helmet",
                            "confidence": 0.95,
                            "bbox": {"x1": x1, "y1": y1, "x2": x2, "y2": helmet_y2}
                        })
                        
                    # Vest region
                    vest_y1 = y1 + int(h * 0.18)
                    vest_y2 = y1 + int(h * 0.55)
                    if has_vest:
                        enhanced_detections.append({
                            "class": "vest",
                            "confidence": 0.95,
                            "bbox": {"x1": x1, "y1": vest_y1, "x2": x2, "y2": vest_y2}
                        })
                    else:
                        enhanced_detections.append({
                            "class": "no_vest",
                            "confidence": 0.95,
                            "bbox": {"x1": x1, "y1": vest_y1, "x2": x2, "y2": vest_y2}
                        })
                        
        detections = enhanced_detections

        # 4. Fire & Smoke detection (Security / Factory)
        if frame is not None and zone_profile in ("security", "factory"):
            hsv_fire = False
            hsv_smoke = False
            
            small_frame = cv2.resize(frame, (160, 120))
            hsv_img = cv2.cvtColor(small_frame, cv2.COLOR_BGR2HSV)
            
            if features.get("fire_detection", {}).get("enabled"):
                mask1 = cv2.inRange(hsv_img, np.array([0, 100, 180]), np.array([20, 255, 255]))
                mask2 = cv2.inRange(hsv_img, np.array([160, 100, 180]), np.array([180, 255, 255]))
                fire_pixels = cv2.countNonZero(mask1) + cv2.countNonZero(mask2)
                if fire_pixels > int(0.005 * 160 * 120):
                    hsv_fire = True
                    
            if features.get("smoke_detection", {}).get("enabled"):
                mask_smoke = cv2.inRange(hsv_img, np.array([0, 0, 120]), np.array([180, 50, 220]))
                smoke_pixels = cv2.countNonZero(mask_smoke)
                if smoke_pixels > int(0.02 * 160 * 120):
                    hsv_smoke = True
                    
            if hsv_fire:
                detections.append({
                    "class": "fire",
                    "confidence": 0.9,
                    "bbox": {"x1": 10, "y1": 10, "x2": frame_w - 10, "y2": frame_h - 10}
                })
            if hsv_smoke:
                detections.append({
                    "class": "smoke",
                    "confidence": 0.85,
                    "bbox": {"x1": 10, "y1": 10, "x2": frame_w - 10, "y2": frame_h - 10}
                })

        # Save schedule state for later gating of standard alerts
        self._schedule_active = schedule_active

        active_track_ids = set()
        alerts = []
        now = time.time()
        
        # Filter detections inside privacy masks or exclusion zones
        filtered_detections = []
        for det in detections:
            bbox = det["bbox"]
            cx = (bbox["x1"] + bbox["x2"]) / 2.0 / frame_w
            cy = (bbox["y1"] + bbox["y2"]) / 2.0 / frame_h
            
            is_masked = False
            for zone in zones:
                z_type = zone.get("zoneType")
                if z_type in ("privacy_mask", "exclusion_zone"):
                    pts = zone.get("points", [])
                    shape_type = zone.get("shapeType", "polygon")
                    if len(pts) >= 2 and _point_in_zone_shape(cx, cy, pts, shape_type):
                        is_masked = True
                        break
            if not is_masked:
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
            
            # Speed Estimation — raw per-frame pixel displacement fed through
            # a Kalman filter (_SpeedKalman1D) instead of a fixed-weight EMA,
            # so the displayed value tracks real speed changes continuously
            # without spiking on single-frame detector noise or visibly
            # freezing while the true speed is changing. This heuristic
            # estimate (SPEED_SCALE is an approximate, uncalibrated pixel-
            # to-world factor) is overridden below whenever a calibrated
            # two-line real-distance gate reading exists for this track —
            # see _update_speed_gate / "Apply calibrated speed" further down.
            speed = self.track_speeds.get(track_id, 0.0)
            if track_id in self.track_last_pts:
                last_time, (last_cx, last_cy) = self.track_last_pts[track_id]
                dt = now - last_time
                MIN_DT = 0.02  # guards only against near-zero dt, not a throttle on update rate
                if dt >= MIN_DT:
                    dx = cx - last_cx
                    dy = cy - last_cy
                    dist = np.sqrt(dx*dx + dy*dy)
                    raw_speed = min((dist / dt) * self.SPEED_SCALE / (cy + 0.2), self.SPEED_HARD_CAP)
                    filt = self.speed_filters.setdefault(track_id, _SpeedKalman1D())
                    speed = max(0.0, filt.update(raw_speed))
                    self.track_speeds[track_id] = speed
                    self.track_last_pts[track_id] = (now, (cx, cy))
            else:
                self.track_last_pts[track_id] = (now, (cx, cy))
                self.speed_filters[track_id] = _SpeedKalman1D()
                self.track_speeds[track_id] = 0.0

            det["speed"] = round(float(speed), 1)

            # Direction: 8-way compass label from recent screen-space motion.
            last_pt = self.track_history[track_id][-1] if self.track_history.get(track_id) else None
            det["direction"] = _direction_label(cx - last_pt[0], cy - last_pt[1]) if last_pt else "stationary"

            # Lane: name/id of the zoneType=="lane" zone (if any) this
            # detection's centroid currently falls inside.
            det["lane"] = _lane_for_point(cx, cy, zones)

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

        # --- Apply calibrated (real-world) speed over the heuristic estimate ---
        # A gate crossing is a one-shot event, so the reading stays visible
        # for CALIBRATED_SPEED_TTL seconds after being measured instead of
        # only flashing for the single frame it was computed on.
        for det in detections:
            track_id = det.get("track_id")
            if track_id is None:
                continue
            calibrated = self.track_calibrated_speed.get(track_id)
            if calibrated and now - calibrated["ts"] <= self.CALIBRATED_SPEED_TTL:
                det["speed"] = round(calibrated["speed_kmh"], 1)
                det["speed_calibrated"] = True
            else:
                det["speed_calibrated"] = False

        # Custom speed limit rules check
        if rules and (zone_profile is None or zone_profile == "custom"):
            for det in detections:
                track_id = det.get("track_id")
                if track_id is None:
                    continue
                class_name = self.track_classes.get(track_id, "person")
                category = _object_category(class_name)
                speed = det.get("speed", 0.0)
                
                for rule in rules:
                    if not rule.get("is_enabled", True):
                        continue
                    if rule.get("trigger_type") == "speed_limit":
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
                                speed = det.get("speed", 0.0)
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
                                if now - self.alert_cooldowns.get(alert_key, 0) > 15.0:
                                    alerts.append({
                                        "type": "human_entry",
                                        "message": f"Hazard Zone Entry: Worker (ID: {tid}) entered restricted hazard area '{z_name}'",
                                        "zone_id": z_id
                                    })
                                    self.alert_cooldowns[alert_key] = now

                ppe_cfg = features.get("ppe_detection", {})
                if ppe_cfg.get("enabled"):
                    for det in detections:
                        if det["class"] in ("no_helmet", "no_vest"):
                            track_id = det.get("track_id")
                            violation_type = "No Helmet" if det["class"] == "no_helmet" else "No Vest"
                            alert_key = f"factory_ppe_{violation_type}_{track_id or now}"
                            if now - self.alert_cooldowns.get(alert_key, 0) > 25.0:
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
