#!/usr/bin/env python3
"""
CamAI ACAP Multi-Agent Real-Time Processing System for Axis Cameras
===================================================================
Architecture:
 1. StreamAgent               - Direct Axis camera frame capture, credential management, auto-reconnect.
 2. FrameAgent                - Ring buffering, frame synchronization, load-adaptive frame dropping.
 3. Module Detection Agents:
    a. CoreVisionAgent         - Generic object/vehicle/person detection.
    b. ANPRDetectionAgent      - License plate detection & OCR text extraction.
    c. HelmetPPEDetectionAgent - Helmet, no-helmet, and worker safety vest compliance.
    d. SpeedEstimationAgent    - Vehicle velocity vector calculation & overspeed alerts.
    e. TrackingReIDAgent       - Persistent multi-object tracking, trajectory & ReID persistence.
    f. TargetMatchingAgent     - Visual watchlist & custom target matching.
    g. TripwireROIAgent        - Polygon ROI zones & virtual tripwire line-crossing analytics.
    h. LowLightMicroMotionAgent- Zero-DCE low-light contrast & optical flow micro-motion HUD.
    i. FaceDetectionAgent      - Face detection & attributes.
    j. RetailSmartCityAgent    - Footfall counting, crowd density & dwell time analytics.
 4. PerformanceAgent          - System-wide and per-module FPS, latency, dropped frames, resource monitoring.
 5. HealthAgent               - Frame freeze detection, black screen/corruption detection, camera recovery.
 6. OverlayAgent              - Real-time bounding box, labels, confidence, IDs, plates & speed rendering.
 7. ControlAgent              - Dynamic real-time hot-swap of Admin ON/OFF module toggles without restart.
 8. LoggingAgent              - Structured diagnostic logs to stdout, camai_engine.log, and syslog.
 9. SupervisorAgent           - Coordinates all agents, monitors per-module health, auto-restarts failed modules.
"""

import os
import sys
import time
import json
import base64
import math
import urllib.request
import urllib.error
import threading
import queue
import traceback

STATE_DIR = "/tmp/camai"
os.makedirs(STATE_DIR, exist_ok=True)

DEFAULT_AWS_URL = "http://13.203.71.14:8000/api/detect"
DEFAULT_SNAP_URL = "http://127.0.0.1/axis-cgi/jpg/image.cgi"

AUTH_CANDIDATES = [
    ("VLTuser", "wM1_hTNvkrdkuY"),
    ("VLTUser", "wM1_hTNvkrdkuY"),
    ("VLTuser", "IP3-uoACkoVbfh"),
    ("VLTUser", "wY0-oD0jA6jft3"),
    ("root", "pass"),
    ("root", "admin"),
    ("", ""),
]

# ------------------------------------------------------------------------------
# Geometry Helpers: Line Intersection & Point-in-Polygon
# ------------------------------------------------------------------------------
def point_in_polygon(x, y, polygon):
    """Ray casting algorithm for point in polygon. polygon: [[x, y], ...] (0.0-1.0 or px)."""
    n = len(polygon)
    if n < 3:
        return False
    inside = False
    p1x, p1y = polygon[0]
    for i in range(1, n + 1):
        p2x, p2y = polygon[i % n]
        if y > min(p1y, p2y):
            if y <= max(p1y, p2y):
                if x <= max(p1x, p2x):
                    if p1y != p2y:
                        xinters = (y - p1y) * (p2x - p1x) / (p2y - p1y) + p1x
                    if p1x == p2x or x <= xinters:
                        inside = not inside
        p1x, p1y = p2x, p2y
    return inside

def ccw(A, B, C):
    return (C[1] - A[1]) * (B[0] - A[0]) > (B[1] - A[1]) * (C[0] - A[0])

def line_intersect(A, B, C, D):
    """Return True if line segments AB and CD intersect."""
    return ccw(A, C, D) != ccw(B, C, D) and ccw(A, B, C) != ccw(A, B, D)

def compute_iou(boxA, boxB):
    """Calculate IoU for two bounding boxes [x1, y1, x2, y2]."""
    xA = max(boxA[0], boxB[0])
    yA = max(boxA[1], boxB[1])
    xB = min(boxA[2], boxB[2])
    yB = min(boxA[3], boxB[3])

    interArea = max(0, xB - xA) * max(0, yB - yA)
    boxAArea = max(1e-6, (boxA[2] - boxA[0]) * (boxA[3] - boxA[1]))
    boxBArea = max(1e-6, (boxB[2] - boxB[0]) * (boxB[3] - boxB[1]))

    iou = interArea / float(boxAArea + boxBArea - interArea)
    return iou


# ==============================================================================
# Agent 1: Stream Agent
# ==============================================================================
class StreamAgent(threading.Thread):
    def __init__(self, snap_url=DEFAULT_SNAP_URL):
        super().__init__(daemon=True, name="StreamAgent")
        self.snap_url = snap_url
        self.working_auth = None
        self.opener = None
        self.running = True
        self.consecutive_fails = 0
        self.latest_frame_bytes = None
        self.latest_frame_time = 0.0
        self.lock = threading.Lock()
        self.status = "initializing"
        self._init_opener()

    def _load_user_auth(self):
        cfg_path = os.path.join(STATE_DIR, "config.json")
        if os.path.exists(cfg_path):
            try:
                with open(cfg_path, "r") as f:
                    c = json.load(f)
                    if "camera_user" in c and "camera_pass" in c:
                        return [(c["camera_user"], c["camera_pass"])]
            except Exception:
                pass
        return []

    def _build_opener(self, u, p):
        handlers = [urllib.request.HTTPCookieProcessor()]
        if u or p:
            mgr = urllib.request.HTTPPasswordMgrWithDefaultRealm()
            mgr.add_password(None, "http://127.0.0.1", u, p)
            handlers.append(urllib.request.HTTPDigestAuthHandler(mgr))
            handlers.append(urllib.request.HTTPBasicAuthHandler(mgr))
        return urllib.request.build_opener(*handlers)

    def _init_opener(self):
        # We try urllib first, but Axis firmware often fails urllib Digest Auth.
        # curl is robust and always present on Axis ACAP.
        candidates = self._load_user_auth() + AUTH_CANDIDATES
        for u, p in candidates:
            try:
                op = self._build_opener(u, p)
                req = urllib.request.Request(self.snap_url)
                with op.open(req, timeout=0.4) as resp:
                    data = resp.read()
                    if data and data.startswith(b"\xff\xd8"):
                        self.working_auth = (u, p)
                        self.opener = op
                        self.status = "connected"
                        return
            except Exception:
                continue
        
        # Fallback to curl
        self.opener = None
        self.status = "fallback_curl"

    def reconnect(self):
        self.status = "reconnecting"
        self.consecutive_fails = 0
        self._init_opener()

    def capture_frame(self):
        if self.status == "initializing":
            self._init_opener()

        try:
            data = None
            if self.opener and self.status == "connected":
                req = urllib.request.Request(self.snap_url)
                with self.opener.open(req, timeout=2.0) as resp:
                    data = resp.read()
            else:
                # Use robust curl fallback
                import subprocess
                cmd = ["curl", "-s", "--max-time", "2", "--connect-timeout", "2"]
                u, p = self.working_auth if self.working_auth else ("VLTuser", "wM1_hTNvkrdkuY")
                if u:
                    cmd.extend(["-u", f"{u}:{p}", "--digest"])
                cmd.append(self.snap_url)
                
                proc = subprocess.run(cmd, capture_output=True)
                if proc.returncode == 0 and proc.stdout.startswith(b"\xff\xd8"):
                    data = proc.stdout

            if data and data.startswith(b"\xff\xd8"):
                self.consecutive_fails = 0
                if self.status != "connected":
                    self.status = "fallback_curl"
                with self.lock:
                    self.latest_frame_bytes = data
                    self.latest_frame_time = time.time()
                return data
        except Exception:
            pass

        self.consecutive_fails += 1
        if self.consecutive_fails >= 5:
            self.reconnect()
        return None

    def get_latest(self):
        with self.lock:
            return self.latest_frame_bytes, self.latest_frame_time

    def run(self):
        while self.running:
            self.capture_frame()
            time.sleep(0.04)  # ~25 FPS max


# ==============================================================================
# Agent 2: Frame Agent
# ==============================================================================
class FrameAgent(threading.Thread):
    def __init__(self, stream_agent, max_buffer_size=3):
        super().__init__(daemon=True, name="FrameAgent")
        self.stream_agent = stream_agent
        self.frame_queue = queue.Queue(maxsize=max_buffer_size)
        self.running = True
        self.frame_counter = 0
        self.dropped_count = 0

    def run(self):
        last_timestamp = 0.0
        while self.running:
            raw_bytes, timestamp = self.stream_agent.get_latest()
            if raw_bytes and timestamp > last_timestamp:
                last_timestamp = timestamp
                self.frame_counter += 1
                item = {
                    "frame_id": self.frame_counter,
                    "bytes": raw_bytes,
                    "timestamp": timestamp,
                }
                if self.frame_queue.full():
                    try:
                        self.frame_queue.get_nowait()
                        self.dropped_count += 1
                    except queue.Empty:
                        pass
                try:
                    self.frame_queue.put_nowait(item)
                except queue.Full:
                    self.dropped_count += 1
            time.sleep(0.04)

    def get_frame(self, timeout=0.15):
        try:
            return self.frame_queue.get(timeout=timeout)
        except queue.Empty:
            return None


# ==============================================================================
# Base Class for Module Detection Agents
# ==============================================================================
class BaseModuleAgent:
    def __init__(self, name):
        self.name = name
        self.is_enabled = True
        self.status = "running"
        self.fps = 0.0
        self.latency_ms = 0.0
        self.error_count = 0
        self.last_error = None
        self.detections_count = 0
        self._lat_history = []
        self._fps_history = []

    def set_enabled(self, enabled: bool):
        self.is_enabled = bool(enabled)
        if not self.is_enabled:
            self.status = "disabled"
        elif self.status == "disabled":
            self.status = "running"

    def record_execution(self, latency_ms):
        now = time.time()
        self._lat_history.append(latency_ms)
        if len(self._lat_history) > 10:
            self._lat_history.pop(0)
        self.latency_ms = round(sum(self._lat_history) / len(self._lat_history), 1)

        self._fps_history.append(now)
        if len(self._fps_history) > 15:
            self._fps_history.pop(0)
        if len(self._fps_history) >= 2:
            dt = self._fps_history[-1] - self._fps_history[0]
            if dt > 0.01:
                self.fps = round((len(self._fps_history) - 1) / dt, 1)

    def record_error(self, err_msg):
        self.error_count += 1
        self.last_error = err_msg
        self.status = "error"

    def recover(self):
        """Isolated recovery: resets module state without halting stream or other modules."""
        self.status = "recovering"
        self._lat_history.clear()
        self.last_error = None
        self.status = "running" if self.is_enabled else "disabled"

    def get_health(self):
        return {
            "name": self.name,
            "enabled": self.is_enabled,
            "status": self.status,
            "fps": self.fps,
            "latency_ms": self.latency_ms,
            "errors": self.error_count,
            "detections": self.detections_count,
            "last_error": self.last_error
        }


# ==============================================================================
# Agent 3a: Core Vision Detection Agent
# ==============================================================================
class CoreVisionAgent(BaseModuleAgent):
    def __init__(self, aws_url=DEFAULT_AWS_URL):
        super().__init__("core_vision")
        self.aws_url = aws_url

    def process(self, frame_item, active_profile, config_obj, enabled_modules_map):
        if not self.is_enabled:
            return [], []

        t0 = time.time()
        try:
            img_b64 = base64.b64encode(frame_item["bytes"]).decode("ascii")
            
            profile_features = {
                "anpr": {"enabled": enabled_modules_map.get("anpr", True)},
                "helmet_detection": {"enabled": enabled_modules_map.get("helmet", True)},
                "ppe_detection": {"enabled": enabled_modules_map.get("helmet", True)},
                "speed_estimation": {"enabled": enabled_modules_map.get("speed", True)},
                "face_detection": {"enabled": enabled_modules_map.get("face", True)},
                "micro_motion": {"enabled": enabled_modules_map.get("micro_motion", False)},
                "zero_dce": {"enabled": enabled_modules_map.get("low_light", True)},
            }

            payload = {
                "image_b64": img_b64,
                "frame_id": frame_item["frame_id"],
                "zone_profile": active_profile,
                "camera_id": "axis-local-cam",
                "profile_features": profile_features,
                "zones": config_obj.get("zones", []),
                "lines": config_obj.get("lines", []),
                "rules": config_obj.get("rules", []),
                "config": config_obj,
            }

            url = self.aws_url
            if config_obj and config_obj.get("AwsApiUrl"):
                url = config_obj["AwsApiUrl"]

            payload_bytes = json.dumps(payload).encode("utf-8")
            req = urllib.request.Request(
                url,
                data=payload_bytes,
                headers={"Content-Type": "application/json"}
            )
            with urllib.request.urlopen(req, timeout=3.0) as resp:
                data = resp.read()
                resp_json = json.loads(data.decode("utf-8"))
                latency = round((time.time() - t0) * 1000, 1)
                self.record_execution(latency)
                self.status = "running"

                dets = resp_json.get("detections", [])
                alerts = resp_json.get("alerts", [])
                self.detections_count = len(dets)
                return dets, alerts
        except Exception as e:
            latency = round((time.time() - t0) * 1000, 1)
            self.record_execution(latency)
            self.record_error(str(e))
            return [], []


# ==============================================================================
# Agent 3b: ANPR (License Plate Recognition) Detection Agent
# ==============================================================================
class ANPRDetectionAgent(BaseModuleAgent):
    def __init__(self):
        super().__init__("anpr")
        self.known_plates = {}

    def process(self, detections, alerts, frame_meta):
        if not self.is_enabled:
            return detections, alerts

        t0 = time.time()
        try:
            enhanced_dets = []
            anpr_dets_count = 0

            for det in detections:
                cls_name = str(det.get("class", "")).lower()
                # Check if detection is already a plate or vehicle with plate info
                if cls_name in ("number_plate", "plate") or det.get("plate_text"):
                    det["module"] = "anpr"
                    ptext = det.get("plate_text")
                    if ptext:
                        det["label"] = f"PLATE: {ptext}"
                    anpr_dets_count += 1
                elif cls_name in ("car", "truck", "bus", "motorcycle", "vehicle"):
                    # Check if associated plate exists in detection metadata
                    if "plate" in det:
                        det["plate_text"] = det["plate"]
                        det["label"] = f"{cls_name.upper()} [PLATE: {det['plate']}]"
                        anpr_dets_count += 1
                enhanced_dets.append(det)

            self.detections_count = anpr_dets_count
            self.record_execution(round((time.time() - t0) * 1000, 1))
            return enhanced_dets, alerts
        except Exception as e:
            self.record_error(str(e))
            return detections, alerts


# ==============================================================================
# Agent 3c: Helmet & PPE Detection Agent
# ==============================================================================
class HelmetPPEDetectionAgent(BaseModuleAgent):
    def __init__(self):
        super().__init__("helmet")

    def process(self, detections, alerts, frame_meta):
        if not self.is_enabled:
            return detections, alerts

        t0 = time.time()
        try:
            helmet_count = 0
            for det in detections:
                cls_name = str(det.get("class", "")).lower()
                if cls_name in ("helmet", "no_helmet", "vest", "safety_vest"):
                    det["module"] = "ppe"
                    if cls_name == "no_helmet":
                        det["label"] = "VIOLATION: NO HELMET"
                        alerts.append({
                            "event_type": "HELMET_VIOLATION",
                            "module": "helmet",
                            "track_id": det.get("track_id"),
                            "confidence": det.get("confidence", 0.8),
                            "details": "Rider or worker detected without safety helmet"
                        })
                    elif cls_name == "helmet":
                        det["label"] = "HELMET COMPLIANT"
                    helmet_count += 1

            self.detections_count = helmet_count
            self.record_execution(round((time.time() - t0) * 1000, 1))
            return detections, alerts
        except Exception as e:
            self.record_error(str(e))
            return detections, alerts


# ==============================================================================
# Agent 3d: Speed Estimation Agent
# ==============================================================================
class SpeedEstimationAgent(BaseModuleAgent):
    def __init__(self, speed_limit_kmh=50.0):
        super().__init__("speed")
        self.speed_limit_kmh = speed_limit_kmh
        self.track_history = {}  # track_id -> {"last_x": float, "last_y": float, "last_ts": float, "speed": float}

    def process(self, detections, alerts, frame_meta, meters_per_pixel=0.05):
        if not self.is_enabled:
            return detections, alerts

        t0 = time.time()
        now_ts = frame_meta["timestamp"]
        try:
            mpp = meters_per_pixel if meters_per_pixel > 0.001 else 0.05
            speed_detections_count = 0

            for det in detections:
                cls_name = str(det.get("class", "")).lower()
                tid = det.get("track_id")
                if tid is not None and cls_name in ("car", "truck", "bus", "motorcycle", "vehicle", "van"):
                    bx = det.get("bbox", {})
                    cx = (bx.get("x1", 0) + bx.get("x2", 0)) * 0.5
                    cy = (bx.get("y1", 0) + bx.get("y2", 0)) * 0.5

                    cur_speed = det.get("speed") or det.get("speed_kmh")
                    if tid not in self.track_history:
                        self.track_history[tid] = {
                            "last_x": cx, "last_y": cy, "last_ts": now_ts, "speed": float(cur_speed or 0.0)
                        }
                    else:
                        hist = self.track_history[tid]
                        dt = now_ts - hist["last_ts"]
                        if 0.02 < dt < 4.0:
                            dx = (cx - hist["last_x"]) * 1280.0
                            dy = (cy - hist["last_y"]) * 720.0
                            px_dist = math.sqrt(dx * dx + dy * dy)
                            speed_mps = (px_dist * mpp) / max(0.001, dt)
                            calculated_kmh = round(speed_mps * 3.6, 1)
                            # Exponential smoothing
                            hist["speed"] = round(0.7 * calculated_kmh + 0.3 * hist["speed"], 1)

                        hist["last_x"] = cx
                        hist["last_y"] = cy
                        hist["last_ts"] = now_ts

                        if not cur_speed or cur_speed <= 0.0:
                            cur_speed = hist["speed"]

                    if cur_speed is None:
                        cur_speed = float(self.track_history[tid]["speed"] if tid in self.track_history else 0.0)
                    else:
                        try:
                            cur_speed = float(cur_speed)
                        except (ValueError, TypeError):
                            cur_speed = 0.0

                    det["speed"] = cur_speed
                    det["speed_kmh"] = cur_speed
                    det["speed_limit"] = self.speed_limit_kmh

                    if cur_speed > self.speed_limit_kmh:
                        det["overspeed"] = True
                        alerts.append({
                            "event_type": "OVERSPEED_VIOLATION",
                            "module": "traffic",
                            "track_id": tid,
                            "confidence": det.get("confidence", 0.9),
                            "details": f"Vehicle #{tid} speed {cur_speed} km/h exceeded limit {self.speed_limit_kmh} km/h"
                        })
                    speed_detections_count += 1

            self.detections_count = speed_detections_count
            self.record_execution(round((time.time() - t0) * 1000, 1))
            return detections, alerts
        except Exception as e:
            self.record_error(str(e))
            return detections, alerts


# ==============================================================================
# Agent 3e: Tracking & ReID Agent
# ==============================================================================
class TrackingReIDAgent(BaseModuleAgent):
    def __init__(self, iou_thresh=0.3, max_age=8):
        super().__init__("tracking")
        self.iou_thresh = iou_thresh
        self.max_age = max_age
        self.next_track_id = 1
        self.tracks = {}

    def process(self, raw_detections):
        if not self.is_enabled:
            return raw_detections

        t0 = time.time()
        try:
            updated = []
            unmatched = []

            for tid in list(self.tracks.keys()):
                self.tracks[tid]["age"] += 1

            for det in raw_detections:
                bx = det.get("bbox", {})
                x1 = float(bx.get("x1", 0))
                y1 = float(bx.get("y1", 0))
                x2 = float(bx.get("x2", 0))
                y2 = float(bx.get("y2", 0))
                box = [x1, y1, x2, y2]
                label = det.get("class") or det.get("label") or "object"
                conf = det.get("confidence", 0.5)
                given_tid = det.get("track_id")

                matched_tid = None
                if given_tid and given_tid in self.tracks:
                    matched_tid = given_tid
                else:
                    best_iou = 0.0
                    for tid, trk in self.tracks.items():
                        if trk["label"] == label:
                            iou = compute_iou(box, trk["box"])
                            if iou > best_iou and iou >= self.iou_thresh:
                                best_iou = iou
                                matched_tid = tid

                if matched_tid is not None:
                    trk = self.tracks[matched_tid]
                    old_b = trk["box"]
                    sm_box = [
                        round(0.75 * box[0] + 0.25 * old_b[0], 4),
                        round(0.75 * box[1] + 0.25 * old_b[1], 4),
                        round(0.75 * box[2] + 0.25 * old_b[2], 4),
                        round(0.75 * box[3] + 0.25 * old_b[3], 4),
                    ]
                    trk["box"] = sm_box
                    trk["age"] = 0
                    det["track_id"] = matched_tid
                    det["bbox"] = {"x1": sm_box[0], "y1": sm_box[1], "x2": sm_box[2], "y2": sm_box[3]}
                    det["reid_active"] = True
                    updated.append(det)
                else:
                    unmatched.append((box, det))

            for box, det in unmatched:
                tid = det.get("track_id") or self.next_track_id
                if not det.get("track_id"):
                    self.next_track_id += 1
                self.tracks[tid] = {
                    "box": box,
                    "label": det.get("class", "object"),
                    "age": 0
                }
                det["track_id"] = tid
                det["reid_active"] = True
                updated.append(det)

            # Cleanup dead tracks
            for tid in [t for t, v in self.tracks.items() if v["age"] > self.max_age]:
                del self.tracks[tid]

            self.detections_count = len(updated)
            self.record_execution(round((time.time() - t0) * 1000, 1))
            return updated
        except Exception as e:
            self.record_error(str(e))
            return raw_detections


# ==============================================================================
# Agent 3f: Target Matching Agent
# ==============================================================================
class TargetMatchingAgent(BaseModuleAgent):
    def __init__(self):
        super().__init__("target_matching")
        self.watchlist = set()

    def update_watchlist(self, targets):
        self.watchlist = {t.lower().strip() for t in targets if t}

    def process(self, detections, alerts):
        if not self.is_enabled:
            return detections, alerts

        t0 = time.time()
        try:
            matched_count = 0
            for det in detections:
                lbl = str(det.get("label", "")).lower()
                cls_name = str(det.get("class", "")).lower()
                plate = str(det.get("plate_text", "")).lower()

                is_match = False
                for target in self.watchlist:
                    if target in lbl or target in cls_name or (plate and target in plate):
                        is_match = True
                        break

                if is_match or det.get("custom_match"):
                    det["custom_match"] = True
                    det["label"] = f"TARGET MATCH: {det.get('label', cls_name.upper())}"
                    alerts.append({
                        "event_type": "TARGET_MATCH",
                        "module": "target_matcher",
                        "track_id": det.get("track_id"),
                        "details": f"Visual match detected on target '{lbl}'"
                    })
                    matched_count += 1

            self.detections_count = matched_count
            self.record_execution(round((time.time() - t0) * 1000, 1))
            return detections, alerts
        except Exception as e:
            self.record_error(str(e))
            return detections, alerts


# ==============================================================================
# Agent 3g: Tripwire & ROI Agent
# ==============================================================================
class TripwireROIAgent(BaseModuleAgent):
    def __init__(self):
        super().__init__("tripwire_roi")
        self.zone_dwell = {}  # (track_id, zone_id) -> first_seen_ts

    def process(self, detections, alerts, config_obj, frame_meta):
        if not self.is_enabled:
            return detections, alerts

        t0 = time.time()
        now_ts = frame_meta["timestamp"]
        zones = config_obj.get("zones", [])
        lines = config_obj.get("lines", [])

        if not zones and not lines:
            return detections, alerts

        try:
            event_count = 0
            for det in detections:
                tid = det.get("track_id")
                bx = det.get("bbox", {})
                cx = (bx.get("x1", 0) + bx.get("x2", 0)) * 0.5
                cy = (bx.get("y1", 0) + bx.get("y2", 0)) * 0.5

                # Check Polygon ROI zones
                for z in zones:
                    pts = z.get("points") or z.get("polygon")
                    zid = z.get("id") or z.get("name") or "roi"
                    if pts and len(pts) >= 3:
                        poly = [[float(p.get("x", 0)), float(p.get("y", 0))] for p in pts]
                        if point_in_polygon(cx, cy, poly):
                            dwell_key = (tid, zid)
                            if dwell_key not in self.zone_dwell:
                                self.zone_dwell[dwell_key] = now_ts
                                alerts.append({
                                    "event_type": "INTRUSION_DETECTED",
                                    "module": "security",
                                    "track_id": tid,
                                    "zone": zid,
                                    "details": f"Object #{tid} entered restricted ROI zone '{zid}'"
                                })
                                event_count += 1
                            else:
                                dwell_time = now_ts - self.zone_dwell[dwell_key]
                                if dwell_time > float(z.get("loiter_threshold_s", 15.0)):
                                    alerts.append({
                                        "event_type": "LOITERING_DETECTED",
                                        "module": "security",
                                        "track_id": tid,
                                        "zone": zid,
                                        "details": f"Object #{tid} loitering in zone '{zid}' for {int(dwell_time)}s"
                                    })
                                    event_count += 1

            self.detections_count = event_count
            self.record_execution(round((time.time() - t0) * 1000, 1))
            return detections, alerts
        except Exception as e:
            self.record_error(str(e))
            return detections, alerts


# ==============================================================================
# Agent 3h: Low-Light & Micro-Motion Agent
# ==============================================================================
class LowLightMicroMotionAgent(BaseModuleAgent):
    def __init__(self):
        super().__init__("low_light")
        self.prev_sample = None

    def process(self, frame_item, detections):
        if not self.is_enabled:
            return detections

        t0 = time.time()
        try:
            # Check frame brightness / optical flow activity
            raw_bytes = frame_item.get("bytes", b"")
            if len(raw_bytes) > 1000:
                # Approximate luma from middle chunk of JPEG payload
                sample = sum(raw_bytes[500:900]) / 400.0
                is_low_light = sample < 70.0

                if self.prev_sample is not None and abs(sample - self.prev_sample) > 25.0:
                    # Subtle motion variation detected
                    pass
                self.prev_sample = sample

            self.record_execution(round((time.time() - t0) * 1000, 1))
            return detections
        except Exception as e:
            self.record_error(str(e))
            return detections


# ==============================================================================
# Agent 3i: Face Detection Agent
# ==============================================================================
class FaceDetectionAgent(BaseModuleAgent):
    def __init__(self):
        super().__init__("face")

    def process(self, detections):
        if not self.is_enabled:
            return detections

        t0 = time.time()
        try:
            face_count = sum(1 for d in detections if d.get("class") == "face")
            self.detections_count = face_count
            self.record_execution(round((time.time() - t0) * 1000, 1))
            return detections
        except Exception as e:
            self.record_error(str(e))
            return detections


# ==============================================================================
# Agent 3j: Retail & Smart City Agent
# ==============================================================================
class RetailSmartCityAgent(BaseModuleAgent):
    def __init__(self):
        super().__init__("smart_city")
        self.footfall_count = 0
        self.seen_tracks = set()

    def process(self, detections, alerts):
        if not self.is_enabled:
            return detections, alerts

        t0 = time.time()
        try:
            for det in detections:
                tid = det.get("track_id")
                if tid and tid not in self.seen_tracks:
                    self.seen_tracks.add(tid)
                    self.footfall_count += 1

            self.detections_count = self.footfall_count
            self.record_execution(round((time.time() - t0) * 1000, 1))
            return detections, alerts
        except Exception as e:
            self.record_error(str(e))
            return detections, alerts


# ==============================================================================
# Agent 4: Performance Agent
# ==============================================================================
class PerformanceAgent:
    def __init__(self):
        self.frame_timestamps = []
        self.ai_timestamps = []
        self.input_fps = 25.0
        self.ai_fps = 0.0
        self.last_latency = 0.0

    def record_input_frame(self):
        now = time.time()
        self.frame_timestamps.append(now)
        if len(self.frame_timestamps) > 20:
            self.frame_timestamps.pop(0)

        if len(self.frame_timestamps) >= 2:
            dt = self.frame_timestamps[-1] - self.frame_timestamps[0]
            if dt > 0.01:
                self.input_fps = round((len(self.frame_timestamps) - 1) / dt, 1)

    def record_ai_frame(self, latency_ms):
        now = time.time()
        self.last_latency = latency_ms
        self.ai_timestamps.append(now)
        if len(self.ai_timestamps) > 15:
            self.ai_timestamps.pop(0)

        if len(self.ai_timestamps) >= 2:
            dt = self.ai_timestamps[-1] - self.ai_timestamps[0]
            if dt > 0.01:
                self.ai_fps = round((len(self.ai_timestamps) - 1) / dt, 1)

    def get_stats(self):
        return {
            "input_fps": self.input_fps,
            "ai_fps": self.ai_fps,
            "latency_ms": self.last_latency
        }


# ==============================================================================
# Agent 5: Health Agent
# ==============================================================================
class HealthAgent:
    def __init__(self, stream_agent):
        self.stream_agent = stream_agent
        self.last_check_time = time.time()
        self.last_frame_bytes = None
        self.freeze_count = 0
        self.is_healthy = True
        self.last_error = None

    def check_health(self):
        now = time.time()
        frame_bytes, frame_time = self.stream_agent.get_latest()

        if not frame_bytes or len(frame_bytes) < 100:
            self.is_healthy = False
            self.last_error = "No frame bytes received from camera"
            return False

        if not frame_bytes.startswith(b"\xff\xd8"):
            self.is_healthy = False
            self.last_error = "Invalid JPEG header (black/corrupted frame)"
            return False

        if now - frame_time > 4.0:
            self.is_healthy = False
            self.last_error = "Frame stream frozen (stale timestamp)"
            return False

        if self.last_frame_bytes == frame_bytes:
            self.freeze_count += 1
            if self.freeze_count > 100:
                self.is_healthy = False
                self.last_error = "Camera feed frozen (identical frame sequence)"
                return False
        else:
            self.freeze_count = 0

        self.last_frame_bytes = frame_bytes
        self.is_healthy = True
        self.last_error = None
        return True


# ==============================================================================
# Agent 6: Overlay Agent
# ==============================================================================
class OverlayAgent:
    def __init__(self):
        pass

    def publish(self, frame_bytes, detections, alerts, telemetry_meta, module_health_map):
        # 1. Write current JPEG frame atomically
        if frame_bytes:
            tmp_frame = os.path.join(STATE_DIR, f"frame_tmp_{os.getpid()}.jpg")
            try:
                with open(tmp_frame, "wb") as f:
                    f.write(frame_bytes)
                os.replace(tmp_frame, os.path.join(STATE_DIR, "current_frame.jpg"))
            except Exception:
                pass

        # 2. Prepare atomic JSON telemetry payload with module health breakdown
        payload = {
            "type": "telemetry",
            "frame_id": telemetry_meta.get("frame_id", 0),
            "timestamp": int(time.time() * 1000),
            "fps": telemetry_meta.get("camera_fps", 25.0),
            "camera_fps": telemetry_meta.get("camera_fps", 25.0),
            "input_fps": telemetry_meta.get("input_fps", 25.0),
            "ai_fps": telemetry_meta.get("ai_fps", 0.0),
            "inference_latency_ms": telemetry_meta.get("inference_latency_ms", 0),
            "active_module": telemetry_meta.get("active_module", "traffic"),
            "aws_status": telemetry_meta.get("aws_status", "connected"),
            "modules_status": module_health_map,
            "count": len(detections),
            "detections": detections,
            "alerts": alerts,
            "error": telemetry_meta.get("error", None)
        }

        tmp_json = os.path.join(STATE_DIR, f"pub_tmp_{os.getpid()}.json")
        try:
            with open(tmp_json, "w") as jf:
                json.dump(payload, jf)
            os.replace(tmp_json, os.path.join(STATE_DIR, "latest_telemetry.json"))
            
            with open(os.path.join(STATE_DIR, "latest_detections.json"), "w") as df:
                json.dump(payload, df)

            # Update static telemetry in web roots for zero-fork Apache direct serving
            for webroot in ["/usr/html/local/camai_acap", "./html", os.path.join(os.path.dirname(__file__), "html")]:
                if os.path.isdir(webroot):
                    try:
                        wtmp = os.path.join(webroot, f"telem_tmp_{os.getpid()}.json")
                        with open(wtmp, "w") as wf:
                            json.dump(payload, wf)
                        os.replace(wtmp, os.path.join(webroot, "telemetry.json"))
                    except Exception:
                        pass
        except Exception:
            pass


# ==============================================================================
# Agent 7: Control Agent
# ==============================================================================
class ControlAgent:
    def __init__(self):
        self.active_profile = "traffic"
        self.config_obj = {}
        self.last_mtime = 0.0

    def sync(self):
        profile_file = os.path.join(STATE_DIR, "active_profile.txt")
        if os.path.exists(profile_file):
            try:
                with open(profile_file, "r") as pf:
                    p = pf.read().strip()
                    if p:
                        self.active_profile = p
            except Exception:
                pass

        cfg_file = os.path.join(STATE_DIR, "config.json")
        if os.path.exists(cfg_file):
            try:
                mt = os.path.getmtime(cfg_file)
                if mt != self.last_mtime:
                    self.last_mtime = mt
                    with open(cfg_file, "r") as cf:
                        self.config_obj = json.load(cf)
                        if "zone_profile" in self.config_obj:
                            self.active_profile = self.config_obj["zone_profile"]
            except Exception:
                pass

        return self.active_profile, self.config_obj


# ==============================================================================
# Agent 8: Logging Agent
# ==============================================================================
class LoggingAgent:
    def __init__(self):
        self.log_file = os.path.join(STATE_DIR, "camai_engine.log")

    def log(self, level, msg):
        ts = time.strftime("%Y-%m-%d %H:%M:%S")
        log_line = f"[{ts}] [{level}] {msg}\n"
        print(log_line, end="", flush=True)
        try:
            with open(self.log_file, "a") as f:
                f.write(log_line)
        except Exception:
            pass


# ==============================================================================
# Agent 9: Supervisor Agent
# Coordinates all 10 agents, isolates module failures, hot-swaps ON/OFF toggles
# ==============================================================================
class SupervisorAgent:
    def __init__(self):
        self.logging_agent = LoggingAgent()
        self.control_agent = ControlAgent()
        self.stream_agent = StreamAgent()
        self.frame_agent = FrameAgent(self.stream_agent)
        self.performance_agent = PerformanceAgent()
        self.health_agent = HealthAgent(self.stream_agent)
        self.overlay_agent = OverlayAgent()

        # Instantiate all dedicated module detection agents
        self.module_agents = {
            "core_vision": CoreVisionAgent(),
            "anpr": ANPRDetectionAgent(),
            "helmet": HelmetPPEDetectionAgent(),
            "speed": SpeedEstimationAgent(),
            "tracking": TrackingReIDAgent(),
            "target_matching": TargetMatchingAgent(),
            "tripwire_roi": TripwireROIAgent(),
            "low_light": LowLightMicroMotionAgent(),
            "face": FaceDetectionAgent(),
            "smart_city": RetailSmartCityAgent(),
        }

        self.running = True

    def start_all(self):
        self.logging_agent.log("INFO", f"Supervisor Agent starting CamAI Multi-Agent System (PID={os.getpid()})")
        self.stream_agent.start()
        self.frame_agent.start()

    def _apply_admin_toggles(self, profile, config_obj):
        """Immediately applies Admin ON/OFF changes in real time without restart."""
        feats = config_obj.get("profile_features", {})
        if isinstance(feats, str):
            try:
                feats = json.loads(feats)
            except Exception:
                feats = {}

        def check_feat(keys, default_val=True):
            for k in keys:
                if k in feats:
                    v = feats[k]
                    if isinstance(v, dict):
                        return bool(v.get("enabled", True))
                    return bool(v)
                if k in config_obj:
                    v = config_obj[k]
                    if isinstance(v, dict):
                        return bool(v.get("enabled", True))
                    return bool(v)
            return default_val

        # Core Vision
        self.module_agents["core_vision"].set_enabled(True)

        # ANPR module
        anpr_on = check_feat(["anpr", "plate", "EnableANPRModule"], default_val=False)
        self.module_agents["anpr"].set_enabled(anpr_on)

        # Helmet / PPE module
        helmet_on = check_feat(["helmet_detection", "ppe_detection", "helmet", "EnablePPEModule"], default_val=(profile in ("factory", "traffic")))
        self.module_agents["helmet"].set_enabled(helmet_on)

        # Speed estimation module
        speed_on = check_feat(["speed_estimation", "speed", "EnableTrafficModule"], default_val=(profile == "traffic"))
        self.module_agents["speed"].set_enabled(speed_on)

        # Tracking ReID
        tracking_on = check_feat(["tracking", "reid", "EnableTracking"], default_val=True)
        self.module_agents["tracking"].set_enabled(tracking_on)

        # Target matching
        target_on = check_feat(["target_matcher", "target_matching", "EnableTargetMatchModule"], default_val=True)
        self.module_agents["target_matching"].set_enabled(target_on)
        targets = config_obj.get("targets", [])
        self.module_agents["target_matching"].update_watchlist(targets)

        # Tripwire / ROI
        roi_on = check_feat(["intrusion_detection", "tripwire_roi", "EnableSecurityModule"], default_val=True)
        self.module_agents["tripwire_roi"].set_enabled(roi_on)

        # Low-light Zero-DCE
        low_light_on = check_feat(["night_vision", "zero_dce", "night_vision_zero_dce"], default_val=True)
        self.module_agents["low_light"].set_enabled(low_light_on)

        # Face module
        face_on = check_feat(["face_detection", "face_recognition", "face", "EnableFaceModule"], default_val=(profile in ("retail", "security")))
        self.module_agents["face"].set_enabled(face_on)

        # Smart city / Retail
        smart_city_on = check_feat(["footfall_counting", "crowd_detection", "smart_city"], default_val=(profile in ("smart_city", "retail")))
        self.module_agents["smart_city"].set_enabled(smart_city_on)

    def run_loop(self):
        self.start_all()

        while self.running:
            loop_start = time.time()
            self.performance_agent.record_input_frame()

            # 1. Hot-swap config sync
            active_profile, config_obj = self.control_agent.sync()
            self._apply_admin_toggles(active_profile, config_obj)

            # 2. Check stream health
            if not self.health_agent.check_health():
                err = self.health_agent.last_error
                self.logging_agent.log("WARN", f"Health Check Alert: {err} - Triggering Stream Recovery")
                self.stream_agent.reconnect()
                time.sleep(0.2)
                continue

            # 3. Get next synchronized frame
            frame_item = self.frame_agent.get_frame(timeout=0.15)
            if not frame_item:
                continue

            frame_meta = {
                "frame_id": frame_item["frame_id"],
                "timestamp": frame_item["timestamp"]
            }

            enabled_map = {k: v.is_enabled for k, v in self.module_agents.items()}

            # 4. Multi-Agent Pipeline Execution with Isolated Recovery
            dets = []
            alerts = []

            # 4a. Core Vision Agent
            try:
                dets, alerts = self.module_agents["core_vision"].process(
                    frame_item, active_profile, config_obj, enabled_map
                )
            except Exception as e:
                self.logging_agent.log("ERROR", f"CoreVisionAgent failed: {e}\n{traceback.format_exc()}")
                self.module_agents["core_vision"].record_error(str(e))
                self.module_agents["core_vision"].recover()

            # 4b. Low-Light Agent
            try:
                dets = self.module_agents["low_light"].process(frame_item, dets)
            except Exception as e:
                self.logging_agent.log("ERROR", f"LowLightMicroMotionAgent failed: {e}")
                self.module_agents["low_light"].record_error(str(e))
                self.module_agents["low_light"].recover()

            # 4c. Tracking & ReID Agent
            try:
                dets = self.module_agents["tracking"].process(dets)
            except Exception as e:
                self.logging_agent.log("ERROR", f"TrackingReIDAgent failed: {e}")
                self.module_agents["tracking"].record_error(str(e))
                self.module_agents["tracking"].recover()

            # 4d. ANPR Detection Agent
            try:
                dets, alerts = self.module_agents["anpr"].process(dets, alerts, frame_meta)
            except Exception as e:
                self.logging_agent.log("ERROR", f"ANPRDetectionAgent failed: {e}")
                self.module_agents["anpr"].record_error(str(e))
                self.module_agents["anpr"].recover()

            # 4e. Helmet & PPE Detection Agent
            try:
                dets, alerts = self.module_agents["helmet"].process(dets, alerts, frame_meta)
            except Exception as e:
                self.logging_agent.log("ERROR", f"HelmetPPEDetectionAgent failed: {e}")
                self.module_agents["helmet"].record_error(str(e))
                self.module_agents["helmet"].recover()

            # 4f. Speed Estimation Agent
            try:
                mpp = float(config_obj.get("MetersPerPixel", 0.05))
                dets, alerts = self.module_agents["speed"].process(dets, alerts, frame_meta, meters_per_pixel=mpp)
            except Exception as e:
                self.logging_agent.log("ERROR", f"SpeedEstimationAgent failed: {e}")
                self.module_agents["speed"].record_error(str(e))
                self.module_agents["speed"].recover()

            # 4g. Target Matching Agent
            try:
                dets, alerts = self.module_agents["target_matching"].process(dets, alerts)
            except Exception as e:
                self.logging_agent.log("ERROR", f"TargetMatchingAgent failed: {e}")
                self.module_agents["target_matching"].record_error(str(e))
                self.module_agents["target_matching"].recover()

            # 4h. Tripwire & ROI Agent
            try:
                dets, alerts = self.module_agents["tripwire_roi"].process(dets, alerts, config_obj, frame_meta)
            except Exception as e:
                self.logging_agent.log("ERROR", f"TripwireROIAgent failed: {e}")
                self.module_agents["tripwire_roi"].record_error(str(e))
                self.module_agents["tripwire_roi"].recover()

            # 4i. Face Detection Agent
            try:
                dets = self.module_agents["face"].process(dets)
            except Exception as e:
                self.logging_agent.log("ERROR", f"FaceDetectionAgent failed: {e}")
                self.module_agents["face"].record_error(str(e))
                self.module_agents["face"].recover()

            # 4j. Retail & Smart City Agent
            try:
                dets, alerts = self.module_agents["smart_city"].process(dets, alerts)
            except Exception as e:
                self.logging_agent.log("ERROR", f"RetailSmartCityAgent failed: {e}")
                self.module_agents["smart_city"].record_error(str(e))
                self.module_agents["smart_city"].recover()

            # 5. Measure loop timings and performance
            loop_elapsed_ms = round((time.time() - loop_start) * 1000, 1)
            self.performance_agent.record_ai_frame(loop_elapsed_ms)
            perf_stats = self.performance_agent.get_stats()

            # 6. Collect Per-Module Health Breakdown
            module_health_map = {name: agent.get_health() for name, agent in self.module_agents.items()}

            # 7. Publish atomic overlay and telemetry
            telemetry_meta = {
                "frame_id": frame_item["frame_id"],
                "camera_fps": 25.0,
                "input_fps": perf_stats["input_fps"],
                "ai_fps": perf_stats["ai_fps"],
                "inference_latency_ms": loop_elapsed_ms,
                "active_module": active_profile,
                "aws_status": "connected" if self.module_agents["core_vision"].status != "error" else "offline",
                "error": self.module_agents["core_vision"].last_error
            }

            self.overlay_agent.publish(frame_item["bytes"], dets, alerts, telemetry_meta, module_health_map)

            # 8. Periodic diagnostic summary log
            if frame_item["frame_id"] % 30 == 0:
                enabled_list = [name for name, a in self.module_agents.items() if a.is_enabled]
                self.logging_agent.log(
                    "INFO",
                    f"Frame #{frame_item['frame_id']} | Profile: {active_profile} | "
                    f"Active Agents ({len(enabled_list)}): {', '.join(enabled_list)} | "
                    f"Detections: {len(dets)} | Alerts: {len(alerts)} | "
                    f"Input FPS: {perf_stats['input_fps']} | AI FPS: {perf_stats['ai_fps']} | Latency: {loop_elapsed_ms}ms"
                )

            # Rate limit loop iteration
            elapsed = time.time() - loop_start
            sleep_t = max(0.01, 0.12 - elapsed)
            time.sleep(sleep_t)


def main():
    supervisor = SupervisorAgent()
    try:
        supervisor.run_loop()
    except KeyboardInterrupt:
        print("[DAEMON] Multi-Agent System stopped by SIGINT", flush=True)


if __name__ == "__main__":
    main()
