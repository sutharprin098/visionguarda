import os
import cv2
import time
import json
import traceback
import threading
from collections import deque
import numpy as np
from uuid import uuid4

from app.ai.backend import EngineBackend
from app.storage import insert_alert, insert_history_record
from app.recorder import CCTVRecorder
from app.analytics import CameraAnalytics
from app.config import RECORDINGS_DIR
from app.gpu_monitor import get_gpu_usage

# Minimum buffering for all FFMPEG-based capture sources
os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = (
    "rtsp_transport;tcp|threads;4|fflags;nobuffer|flags;low_delay"
)


# ---------------------------------------------------------------------------
# Kalman Filter + ByteTrack (unchanged)
# ---------------------------------------------------------------------------

class LightweightKalmanFilter:
    def __init__(self, bbox):
        x1, y1, x2, y2 = bbox
        cx = (x1 + x2) / 2.0
        cy = (y1 + y2) / 2.0
        w  = max(1.0, x2 - x1)
        h  = max(1.0, y2 - y1)
        a  = w / h

        self.state = np.array([cx, cy, a, h, 0, 0, 0, 0], dtype=np.float32)
        self.covariance  = np.eye(8, dtype=np.float32) * 10.0
        self.transition  = np.eye(8, dtype=np.float32)
        self.transition[0, 4] = self.transition[1, 5] = 1.0
        self.transition[2, 6] = self.transition[3, 7] = 1.0
        self.measurement = np.zeros((4, 8), dtype=np.float32)
        self.measurement[0,0] = self.measurement[1,1] = 1.0
        self.measurement[2,2] = self.measurement[3,3] = 1.0
        self.process_noise     = np.eye(8, dtype=np.float32) * 0.05
        self.measurement_noise = np.eye(4, dtype=np.float32) * 1.0

    def predict(self):
        self.state      = np.dot(self.transition, self.state)
        self.covariance = (np.dot(np.dot(self.transition, self.covariance), self.transition.T)
                           + self.process_noise)
        return self.get_bbox()

    def update(self, bbox):
        x1, y1, x2, y2 = bbox
        cx = (x1 + x2) / 2.0; cy = (y1 + y2) / 2.0
        w  = max(1.0, x2 - x1); h = max(1.0, y2 - y1)
        z  = np.array([cx, cy, w / h, h], dtype=np.float32)
        y  = z - np.dot(self.measurement, self.state)
        S  = np.dot(np.dot(self.measurement, self.covariance), self.measurement.T) + self.measurement_noise
        K  = np.dot(np.dot(self.covariance, self.measurement.T), np.linalg.inv(S))
        self.state      = self.state + np.dot(K, y)
        self.covariance = np.dot(np.eye(8, dtype=np.float32) - np.dot(K, self.measurement), self.covariance)

    def get_bbox(self):
        cx, cy, a, h = self.state[0:4]
        h = max(1.0, float(h)); a = max(0.1, float(a)); w = a * h
        return [cx - w/2, cy - h/2, cx + w/2, cy + h/2]


class Track:
    def __init__(self, track_id, bbox, class_name, confidence):
        self.track_id   = track_id
        self.class_name = class_name
        self.confidence = confidence
        self.kf = LightweightKalmanFilter(bbox)
        self.time_since_update = 0
        self.hits = 1
        self.age  = 1

    def predict(self):
        self.age += 1
        if self.time_since_update > 0:
            self.hits = 0
        self.time_since_update += 1
        return self.kf.predict()

    def update(self, bbox, confidence):
        self.time_since_update = 0
        self.hits += 1
        self.confidence = confidence
        self.kf.update(bbox)

    def get_bbox(self):
        return self.kf.get_bbox()


class ByteTracker:
    def __init__(self, max_lost_frames=90):
        self.max_lost_frames = max_lost_frames
        self.tracks = []
        self.next_track_id = 1

    def _compute_iou(self, boxA, boxB):
        xA = max(boxA[0], boxB[0]); yA = max(boxA[1], boxB[1])
        xB = min(boxA[2], boxB[2]); yB = min(boxA[3], boxB[3])
        inter = max(0.0, xB - xA) * max(0.0, yB - yA)
        areaA = (boxA[2]-boxA[0]) * (boxA[3]-boxA[1])
        areaB = (boxB[2]-boxB[0]) * (boxB[3]-boxB[1])
        return inter / max(1.0, areaA + areaB - inter)

    def update(self, detections, frame_shape=None, conf_thresh=0.25):
        for t in self.tracks:
            t.predict()

        high_dets = []; low_dets = []
        for det in detections:
            b = det["bbox"]
            item = {"bbox": [b["x1"], b["y1"], b["x2"], b["y2"]],
                    "class": det["class"], "confidence": det["confidence"]}
            (high_dets if det["confidence"] >= conf_thresh else
             low_dets  if det["confidence"] >= 0.08 else []).append(item)

        def _greedy_match(tracks, dets, iou_min):
            matched_t, matched_d = [], []
            if not tracks or not dets:
                return matched_t, matched_d
            mat = np.zeros((len(tracks), len(dets)))
            for ti, t in enumerate(tracks):
                for di, d in enumerate(dets):
                    mat[ti, di] = (self._compute_iou(t.get_bbox(), d["bbox"])
                                   if t.class_name == d["class"] else -1.0)
            for _ in range(min(len(tracks), len(dets))):
                v = mat.max()
                if v < iou_min:
                    break
                ti, di = np.unravel_index(mat.argmax(), mat.shape)
                tracks[ti].update(dets[di]["bbox"], dets[di]["confidence"])
                matched_t.append(tracks[ti]); matched_d.append(dets[di])
                mat[ti, :] = mat[:, di] = -1.0
            return matched_t, matched_d

        m_tracks, m_high = _greedy_match(list(self.tracks), high_dets, 0.3)
        rem_tracks = [t for t in self.tracks if t not in m_tracks]
        rem_high   = [d for d in high_dets   if d not in m_high]
        _greedy_match(rem_tracks, low_dets, 0.1)

        for det in rem_high:
            self.tracks.append(Track(self.next_track_id, det["bbox"], det["class"], det["confidence"]))
            self.next_track_id += 1

        active = []
        for t in self.tracks:
            if t.time_since_update > self.max_lost_frames:
                continue
            if t.time_since_update > 5 and frame_shape:
                h, w = frame_shape
                bbox = t.get_bbox()
                mx, my = 0.03 * w, 0.03 * h
                if bbox[0] < mx or bbox[2] > w - mx or bbox[1] < my or bbox[3] > h - my:
                    continue
            active.append(t)
        self.tracks = active

        out = []
        for t in self.tracks:
            if t.time_since_update == 0:
                bbox = t.get_bbox()
                out.append({
                    "track_id":  t.track_id,
                    "class":     t.class_name,
                    "confidence": round(float(t.confidence), 2),
                    "bbox": {
                        "x1": round(bbox[0]), "y1": round(bbox[1]),
                        "x2": round(bbox[2]), "y2": round(bbox[3]),
                    }
                })
        return out


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
    __slots__ = ('_lock', '_data', '_ready')

    def __init__(self):
        self._lock  = threading.Lock()
        self._data  = None
        self._ready = threading.Event()

    def put(self, data):
        with self._lock:
            self._data = data
            self._ready.set()

    def take(self, timeout: float = 0.05):
        if not self._ready.wait(timeout):
            return None
        with self._lock:
            d = self._data
            self._data = None
            self._ready.clear()
            return d


def _fps(ts_deque: deque, window: float = 2.0) -> float:
    """Sliding-window FPS from a timestamp deque (trims in-place from the left).

    Backed by a maxlen deque (see PipelineCoordinator.__init__) so even if the
    stage that normally calls this dies, the deque itself can never grow past
    its maxlen — memory stays bounded independent of whether trimming happens.
    """
    now = time.time()
    while ts_deque and now - ts_deque[0] > window:
        ts_deque.popleft()
    return len(ts_deque) / window if len(ts_deque) > 1 else 0.0


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
                 zones_json: str, lines_json: str, backend_model: EngineBackend):

        self.camera_id   = camera_id
        self.name        = name
        self.source_type = source_type
        self.source      = source
        self.backend     = backend_model

        self.zones = json.loads(zones_json)
        self.lines = json.loads(lines_json)

        self.running        = False
        self.incoming_frame = None       # screenshare push target
        self.telemetry_callback = None

        # ── Size-1 pipeline slots (one per stage boundary) ──────────────────
        self._grabbed_slot      = _Slot()   # Module 1 → Module 2
        self._decoded_slot      = _Slot()   # Module 2 → Module 3
        self._ai_slot           = _Slot()   # Module 3 → Module 4
        self._tracking_slot     = _Slot()   # Module 4 → Module 5
        self._telemetry_out_slot = _Slot()  # Module 5 → Module 6

        # ── MJPEG stream buffer (updated by Module 2 at camera FPS) ─────────
        self.jpeg_lock         = threading.Lock()
        self.current_jpeg_bytes = None

        # ── Per-stage FPS sliding windows ───────────────────────────────────
        # maxlen bounds memory even if the stage that normally trims a given
        # deque (via _fps(), called only from _telemetry_loop) ever stalls —
        # producers can keep appending forever without unbounded growth.
        self._cap_ts: deque = deque(maxlen=1000)
        self._dec_ts: deque = deque(maxlen=1000)
        self._ai_ts:  deque = deque(maxlen=1000)
        self._trk_ts: deque = deque(maxlen=1000)
        self._tel_ts: deque = deque(maxlen=1000)

        # ── Stage health: heartbeat timestamp + error count per stage ───────
        # The watchdog loop uses this to detect a stage that has stopped
        # making progress (thread died, or is wedged in a blocking call that
        # even the per-iteration try/except below can't catch) and to expose
        # per-stage error counts for diagnostics via telemetry.
        # "cap" heartbeat is touched ONLY when a real frame is captured and
        # forwarded downstream — never on an idle poll (no screenshare frame
        # pushed yet) or a failed/reconnecting read. Touching it on every
        # loop tick regardless of whether a frame was produced made the
        # watchdog think a camera with no hardware/no active screenshare was
        # "alive" while every downstream stage was correctly starved of any
        # data — a false-positive stall that repeatedly restarted cameras
        # that were simply idle, not stuck.
        now0 = time.time()
        self._heartbeat = {"cap": now0, "dec": now0, "ai": now0, "trk": now0, "tel": now0, "ws": now0}
        self._stage_errors = {"cap": 0, "dec": 0, "ai": 0, "trk": 0, "tel": 0, "ws": 0}
        self.restart_callback = None  # set by CameraManager; called if watchdog gives up on this instance

        # ── Adaptive inference resolution ────────────────────────────────────
        device = getattr(backend_model, "backend_device", "CPU").upper()
        if "GPU" in device or "CUDA" in device:
            self.current_imgsz = 960
            self.max_imgsz     = 1280
            self.min_imgsz     = 640
        else:
            self.current_imgsz = 640
            self.max_imgsz     = 960
            self.min_imgsz     = 320
        self._latency_history: list = []

        # ── REST status snapshot (latest telemetry for /api/status) ─────────
        self.latest_telemetry = {
            "success": True, "people": 0, "vehicles": 0,
            "detections": [], "masks": [], "tracks": [],
            "counters": {"in": 0, "out": 0},
            "heatmap": [], "latency": 0, "fps": 0.0,
            "camera_fps": 0.0, "decode_fps": 0.0,
            "inference_fps": 0.0, "tracking_fps": 0.0,
            "cpu": 0.0, "memory": 0.0, "gpu": 0.0, "status": "no_human",
        }

        # ── Sub-systems ──────────────────────────────────────────────────────
        self.recorder  = CCTVRecorder(camera_id)
        self.analytics = CameraAnalytics(camera_id)
        self.tracker   = ByteTracker()

        # ── Motion detection state ───────────────────────────────────────────
        self._prev_motion = None
        self._motion_thr  = 0.004

        # Shared counter: _tracking_loop writes, _ai_loop reads.
        # Safe under CPython GIL — int assignment is atomic.
        self._n_active_tracks = 0

        self.cap = None
        # Consecutive failed capture-reconnect cycles for this camera; drives
        # exponential backoff in _capture_loop (see there for why) and is
        # surfaced in telemetry so a persistently-broken source is visible
        # to operators instead of silently retrying forever.
        self._cap_consecutive_failures = 0

    # -----------------------------------------------------------------------
    # Lifecycle
    # -----------------------------------------------------------------------

    def push_frame(self, frame):
        """Receive a frame from the screenshare WebSocket handler."""
        self.incoming_frame = frame

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

    def update_config(self, zones_json: str, lines_json: str):
        self.zones = json.loads(zones_json)
        self.lines = json.loads(lines_json)
        self.analytics.reset_counters()

    # -----------------------------------------------------------------------
    # Module 1: Video Capture
    # Grabs raw compressed packets at full camera rate.
    # Never blocks on AI — just puts a grab token into the slot.
    # -----------------------------------------------------------------------

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

        if self.source_type != "screenshare":
            src = (int(self.source)
                   if self.source_type in ("webcam", "usb") and str(self.source).isdigit()
                   else self.source)
            self.cap = self._open_capture(src)
            if self.cap.isOpened():
                self.cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
                self.cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*"MJPG"))
                print(f"[Cap-{self.camera_id}] Opened source: {src}", flush=True)
            else:
                print(f"[Cap-{self.camera_id}] Cannot open source: {src}", flush=True)

        last_good_frame_ts = time.time()
        # Counts consecutive failed reconnect cycles; drives exponential
        # backoff below. Confirmed by direct measurement: a source that never
        # produces frames (nonexistent webcam index, dead RTSP host) hammered
        # at the original fixed 2s reconnect / 50ms retry-read cadence leaked
        # ~180+ MB/min of RSS with zero Python-level exceptions ever raised —
        # this is native memory inside OpenCV's capture backend (MSMF on
        # Windows), entirely outside anything Python's own GC can reach.
        # Confirmed the fix by disabling the failing camera mid-run: RSS
        # immediately stopped climbing and *dropped* below its starting
        # baseline. We can't patch OpenCV's C++ side, so instead we reduce
        # how often we call into it once a source has proven persistently
        # broken — this caps the leak's rate without touching the (also
        # already-fixed) architecture elsewhere.
        self._cap_consecutive_failures = 0

        while self.running:
            try:
                t0 = time.time()

                if self.source_type != "screenshare":
                    if self.cap is None or not self.cap.isOpened():
                        if self.cap is not None:
                            self.cap.release()
                        backoff = min(30.0, 2.0 * (1.5 ** min(self._cap_consecutive_failures, 12)))
                        time.sleep(backoff)
                        self.cap = self._open_capture(src)
                        if self.cap.isOpened():
                            self.cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
                            self.cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*"MJPG"))
                        last_good_frame_ts = time.time()
                        continue

                    ret, frame = self.cap.read()
                    if not ret or frame is None:
                        # isOpened() can keep reporting True even after the device stops
                        # producing frames (unplugged/busy webcam, dead RTSP link) — without
                        # this check the loop spins on a failing read() forever and never
                        # reaches the reconnect branch above, which is what made a stalled
                        # source look like a frozen stream instead of triggering a retry.
                        if time.time() - last_good_frame_ts > 3.0:
                            print(f"[Cap-{self.camera_id}] No frames for 3s, forcing reconnect...", flush=True)
                            self.cap.release()
                            self.cap = None
                            last_good_frame_ts = time.time()
                            self._cap_consecutive_failures += 1
                        retry_sleep = min(2.0, 0.05 * (1.5 ** min(self._cap_consecutive_failures, 12)))
                        time.sleep(retry_sleep)
                        continue
                    last_good_frame_ts = time.time()
                    self._cap_consecutive_failures = 0
                else:
                    frame = self.incoming_frame
                    self.incoming_frame = None
                    if frame is None:
                        time.sleep(0.005)
                        continue

                t_cap = time.time()
                cap_lat = (t_cap - t0) * 1000
                self._cap_ts.append(t_cap)

                # Put frame into slot — overwrites if Module 2 is still busy (latest wins)
                self._grabbed_slot.put({
                    "cap_time": t_cap,
                    "cap_lat":  cap_lat,
                    "frame":    frame,
                })
                self._heartbeat["cap"] = time.time()

            except Exception as e:
                # Never let a single bad frame/driver hiccup kill this thread —
                # a dead capture thread means the video feed and every stage
                # downstream of it freezes permanently while the process
                # otherwise looks healthy. Log, back off briefly, keep going.
                self._stage_errors["cap"] += 1
                print(f"[Cap-{self.camera_id}] ERROR (recovered): {e}", flush=True)
                traceback.print_exc()
                time.sleep(0.2)

        if self.cap:
            self.cap.release()
        self.recorder.force_stop_all()

    # -----------------------------------------------------------------------
    # Module 2: MJPEG Encoder
    # Takes frames from _grabbed_slot, encodes JPEG → MJPEG stream immediately.
    # This path is completely independent of AI inference speed.
    # Also pushes frames to the recorder and to _decoded_slot for AI.
    # -----------------------------------------------------------------------

    def _decode_loop(self):
        while self.running:
            data = self._grabbed_slot.take()
            if data is None:
                time.sleep(0.001)
                continue

            try:
                t0    = time.time()
                frame = data["frame"]

                # ── MJPEG stream: encode at full camera FPS, never blocked by AI ─
                # Resize to 960-wide max before encoding to reduce JPEG cost.
                h, w = frame.shape[:2]
                if w > 960:
                    scale   = 960.0 / w
                    mjpeg_f = cv2.resize(frame, (960, int(h * scale)), interpolation=cv2.INTER_LINEAR)
                else:
                    mjpeg_f = frame
                ok, jpg = cv2.imencode('.jpg', mjpeg_f, [cv2.IMWRITE_JPEG_QUALITY, 65])
                if ok:
                    with self.jpeg_lock:
                        self.current_jpeg_bytes = jpg.tobytes()

                # ── Recording (non-blocking async queue) ─────────────────────────
                self.recorder.push_frame(frame)

                dec_lat = (time.time() - t0) * 1000
                self._dec_ts.append(time.time())

                # Pass to AI — overwrite slot if AI hasn't consumed previous frame
                self._decoded_slot.put({
                    **data,
                    "dec_lat": dec_lat,
                })
                self._heartbeat["dec"] = time.time()

            except Exception as e:
                self._stage_errors["dec"] += 1
                print(f"[Dec-{self.camera_id}] ERROR (recovered): {e}", flush=True)
                traceback.print_exc()
                self._heartbeat["dec"] = time.time()

    # -----------------------------------------------------------------------
    # Module 3: AI Inference
    # Always processes the newest decoded frame. Drops stale frames.
    # Never waits for a previous inference to finish.
    # -----------------------------------------------------------------------

    def _ai_loop(self):
        # Warm up this thread's dedicated InferRequest (see EngineBackend.
        # _get_ov_infer_request) at this camera's actual inference resolution
        # *before* the main loop starts. OpenVINO's GPU plugin does shape-
        # specific kernel selection/compilation on the first inference call
        # for a given InferRequest + input shape — on slow/first-run GPU
        # drivers this one-time cost can run well past a minute. Paying it
        # here means the watchdog's steady-state stall timer (see
        # _watchdog_loop) only ever starts counting once this thread is
        # actually warm, instead of racing a compile it can't see.
        try:
            dummy = np.zeros((self.current_imgsz, self.current_imgsz, 3), dtype=np.uint8)
            tensor, _ = self.backend.preprocess(dummy, self.current_imgsz)
            self.backend.run_inference(tensor)
            print(f"[AI-{self.camera_id}] Warm-up inference complete (imgsz={self.current_imgsz}).", flush=True)
        except Exception as e:
            print(f"[AI-{self.camera_id}] Warm-up inference failed (will retry on first real frame): {e}", flush=True)
        self._heartbeat["ai"] = time.time()

        while self.running:
            data = self._decoded_slot.take()
            if data is None:
                time.sleep(0.001)
                continue

            try:
                self._ai_loop_iteration(data)
                self._heartbeat["ai"] = time.time()
            except Exception as e:
                self._stage_errors["ai"] += 1
                print(f"[AI-{self.camera_id}] ERROR (recovered): {e}", flush=True)
                traceback.print_exc()
                self._heartbeat["ai"] = time.time()

        # Camera threads are recreated (new thread, new thread-id) whenever a
        # camera is restarted — e.g. editing its zones/lines re-triggers
        # start_camera_thread(). Without this, the backend's per-thread
        # InferRequest cache would keep one abandoned entry (and its device
        # buffers) alive per restart for as long as the shared model stays
        # loaded.
        self.backend.release_thread_request()

    def _ai_loop_iteration(self, data):
            frame   = data["frame"]
            orig_h, orig_w = frame.shape[:2]
            motion  = self._detect_motion(frame)

            # Keep inferring when active tracks exist (person standing still has no motion
            # between consecutive frames but must stay tracked).
            # _n_active_tracks is written by _tracking_loop — safe under CPython GIL.
            should_infer = motion or self._n_active_tracks > 0

            detections:     list = []
            masks_polygons: list = []
            t_pre = t_inf = t_post = 0.0
            conf_thresh = 0.25
            iou_thresh  = 0.45

            if should_infer:
                n_tracks    = len(self.tracker.tracks)
                conf_thresh = 0.15 if n_tracks > 5 else 0.25
                iou_thresh  = 0.65 if n_tracks > 5 else 0.45

                roi = self._get_roi(orig_h, orig_w)
                if roi:
                    rx1, ry1, rx2, ry2 = roi
                    inf_frame = frame[ry1:ry2, rx1:rx2]
                    rh, rw    = inf_frame.shape[:2]
                else:
                    inf_frame = frame
                    rh, rw    = orig_h, orig_w

                # Single-pass inference at the adaptive resolution (current_imgsz
                # already shrinks/grows based on rolling latency, see below) —
                # always O(1) model calls per cycle regardless of frame size.
                # A previous version ran 5 sequential full-model passes (full
                # frame + 4 quadrants) for any frame >=1280x720 to improve
                # small-object recall; on a shared inference backend that 5x
                # per-cycle cost multiplied lock/queue contention with every
                # other camera's AI thread and was the direct cause of
                # multi-second-to-multi-minute stale overlays.
                tensor, t_pre   = self.backend.preprocess(inf_frame, self.current_imgsz)
                outputs, t_inf  = self.backend.run_inference(tensor)
                detections, masks_polygons, t_post = self.backend.postprocess(
                    outputs, (rh, rw), conf_thresh, iou_thresh, self.current_imgsz
                )

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

            # Adaptive resolution tuning based on rolling inference latency
            if should_infer and t_inf > 0:
                self._latency_history.append(t_inf)
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
    # ByteTrack, zone/line analytics, alert generation.
    # Processes latest AI results; drops stale results automatically.
    # -----------------------------------------------------------------------

    def _tracking_loop(self):
        self._trk_last_history_log = 0.0
        while self.running:
            data = self._ai_slot.take()
            if data is None:
                time.sleep(0.001)
                continue

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

            # ── ByteTrack: input and output in absolute pixel coords ─────────
            tracks_raw = self.tracker.update(
                detections, frame_shape=(orig_h, orig_w), conf_thresh=data["conf_thresh"]
            )
            # Update shared counter so _ai_loop can decide whether to keep inferring
            self._n_active_tracks = len(self.tracker.tracks)

            # ── Assign ByteTrack IDs back to YOLO detections via IoU ────────
            for det in detections:
                bd = [det["bbox"]["x1"], det["bbox"]["y1"],
                      det["bbox"]["x2"], det["bbox"]["y2"]]
                best_iou, best_id = 0.0, None
                for trk in tracks_raw:
                    bt = [trk["bbox"]["x1"], trk["bbox"]["y1"],
                          trk["bbox"]["x2"], trk["bbox"]["y2"]]
                    iou = self.tracker._compute_iou(bd, bt)
                    if iou > best_iou:
                        best_iou, best_id = iou, trk["track_id"]
                if best_iou > 0.3:
                    det["track_id"] = best_id

            # ── Rule engine + analytics: MUST receive absolute pixel coords ──
            # analytics.update() mutates det["bbox"] in-place (EMA smoothing)
            # and adds det["speed"]. It expects bbox in pixel space and
            # normalizes internally using frame_w/frame_h.
            # track_overlays: [{track_id, class, points: [[cx,cy]...]}] — normalized
            alerts, track_overlays, heatmap, zone_stats, line_stats = self.analytics.update(
                detections, self.zones, self.lines, orig_w, orig_h
            )

            # ── Build normalized client_dets AFTER analytics has smoothed bbox─
            client_dets = []
            people_count = vehicles_count = 0
            max_conf = 0.0
            for det in detections:
                bbox = det["bbox"]
                conf = det["confidence"]
                max_conf = max(max_conf, conf)
                is_person = det["class"] == "person"
                people_count   += int(is_person)
                vehicles_count += int(not is_person)
                client_dets.append({
                    "class":      det["class"],
                    "confidence": round(float(conf), 2),
                    "track_id":   det.get("track_id"),
                    "speed":      round(float(det.get("speed", 0.0)), 1),
                    "bbox": {
                        "x1": round(float(bbox["x1"]) / orig_w, 4),
                        "y1": round(float(bbox["y1"]) / orig_h, 4),
                        "x2": round(float(bbox["x2"]) / orig_w, 4),
                        "y2": round(float(bbox["y2"]) / orig_h, 4),
                    }
                })

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
                for alert in alerts:
                    snap = f"snap_{self.camera_id}_{uuid4().hex[:8]}.jpg"
                    cv2.imwrite(str(RECORDINGS_DIR / snap), frame)
                    insert_alert(
                        f"alert_{uuid4().hex[:8]}", self.camera_id,
                        alert["type"], alert["message"],
                        screenshot_path=f"/history/recordings/{snap}",
                    )
                    self.recorder.trigger_event_start(alert["message"])
            else:
                self.recorder.trigger_event_stop()

            trk_lat = (time.time() - t0) * 1000
            self._trk_ts.append(time.time())

            self._tracking_slot.put({
                **data,
                "client_dets":    client_dets,
                "masks_polygons": masks,
                # track_overlays has normalized centroid points for motion trails
                # and direction arrows — this is what the frontend canvas expects
                "tracks":         track_overlays,
                "people_count":   people_count,
                "vehicles_count": vehicles_count,
                "heatmap":        heatmap,
                "zone_stats":     zone_stats,
                "line_stats":     line_stats,
                "trk_lat":        trk_lat,
            })

    # -----------------------------------------------------------------------
    # Module 5: Telemetry Build
    # Packages AI + tracking results into the JSON telemetry payload.
    # No video frame in payload — video is served via the MJPEG endpoint.
    # Hands the finished payload to Module 6 over its own size-1 slot rather
    # than dispatching the WS send itself, so building the next payload never
    # waits on the previous one being delivered.
    # -----------------------------------------------------------------------

    def _telemetry_loop(self):
        while self.running:
            data = self._tracking_slot.take()
            if data is None:
                time.sleep(0.001)
                continue

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
            total_latency = (time.time() - data["cap_time"]) * 1000

            # Identify pipeline bottleneck (slowest stage)
            latencies = {
                "capture":       data["cap_lat"],
                "decode":        data["dec_lat"],
                "ai_preproc":    data["t_pre"],
                "ai_inference":  data["t_inf"],
                "ai_postproc":   data["t_post"],
                "tracking":      data["trk_lat"],
                "telemetry":     tel_lat,
            }
            bottleneck = max(latencies, key=latencies.get)

            cpu = mem = 0.0
            try:
                import psutil
                cpu = psutil.cpu_percent()
                mem = psutil.virtual_memory().percent
            except Exception:
                pass
            gpu = get_gpu_usage()

            self.latest_telemetry = {
                "success":   True,
                "people":    data["people_count"],
                "vehicles":  data["vehicles_count"],
                "detections": data["client_dets"],
                "masks":     data["masks_polygons"],
                "tracks":    data["tracks"],
                "counters": {
                    "in":           self.analytics.counter_in,
                    "out":          self.analytics.counter_out,
                    "vehicles_in":  getattr(self.analytics, "counter_in_vehicle", 0),
                    "vehicles_out": getattr(self.analytics, "counter_out_vehicle", 0),
                    "people_in":    getattr(self.analytics, "counter_in_person", 0),
                    "people_out":   getattr(self.analytics, "counter_out_person", 0),
                },
                "heatmap":  data["heatmap"],
                "latency":  round(total_latency),
                "fps":      round(tel_fps, 1),       # pipeline FPS

                # Per-stage FPS
                "camera_fps":    round(cap_fps, 1),
                "decode_fps":    round(dec_fps, 1),
                "inference_fps": round(ai_fps,  1) if data["motion"] else 0.0,
                "tracking_fps":  round(trk_fps, 1),

                # Per-stage latency breakdown
                "capture_latency":    round(data["cap_lat"],  1),
                "decode_latency":     round(data["dec_lat"],  1),
                "preprocess_latency": round(data["t_pre"],    1),
                "inference_latency":  round(data["t_inf"],    1),
                "postprocess_latency":round(data["t_post"],   1),
                "tracking_latency":   round(data["trk_lat"],  1),
                "rendering_latency":  round(tel_lat,           1),
                "total_latency":      round(total_latency,     1),

                "bottleneck": f"{bottleneck} ({latencies[bottleneck]:.1f}ms)",
                "status":     "human_found" if data["people_count"] > 0 else "no_human",
                "cpu":        round(cpu, 1),
                "memory":     round(mem, 1),
                "gpu":        gpu,
                "backend":    self.backend.backend_type,
                "device":     self.backend.backend_device,
                "imgsz":      self.current_imgsz,
                "recording":  self.recorder.is_recording(),
                "zone_stats": data["zone_stats"],
                "line_stats": data["line_stats"],
                "stage_errors": dict(self._stage_errors),
                "queue_depth": 1 if self._grabbed_slot._ready.is_set() else 0,
                "debug_tracks": len(self.tracker.tracks),
                "debug_track_history": len(self.analytics.track_history),
                "debug_zone_active": sum(len(v) for v in self.analytics.zone_active_tracks.values()),
                "debug_recorder_qsize": self.recorder.queue.qsize(),
                "cap_consecutive_failures": self._cap_consecutive_failures,
            }

            self._telemetry_out_slot.put(self.latest_telemetry)

    # -----------------------------------------------------------------------
    # Module 6: WebSocket Dispatch
    # Takes the newest built telemetry payload and hands it to the WS
    # connection manager. Always the latest payload — if dispatch falls
    # behind (many subscribed clients, slow network), it drops straight to
    # whatever Module 5 has built most recently instead of queuing a backlog.
    # -----------------------------------------------------------------------

    def _ws_dispatch_loop(self):
        while self.running:
            telemetry = self._telemetry_out_slot.take()
            if telemetry is None:
                time.sleep(0.001)
                continue
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
    # never die from ordinary processing errors. This watchdog exists for the
    # remaining case a per-iteration try/except cannot help with: a call that
    # blocks forever (native library hang) instead of raising. It only acts
    # when there's live upstream data to prove the camera itself isn't just
    # idle (e.g. no motion/tracks — a low activity period is not a stall).

    def _watchdog_loop(self):
        stage_order = ["cap", "dec", "ai", "trk", "tel", "ws"]
        # Two-tier threshold instead of one fixed value:
        #  - startup_grace: no stall checks at all for this long after the
        #    thread starts (or restarts). First-ever inference on a fresh
        #    per-thread OpenVINO InferRequest can trigger shape-specific GPU
        #    kernel compilation that legitimately takes tens of seconds on
        #    slower/first-run drivers — even with the _ai_loop warm-up above,
        #    this is a defense-in-depth margin, not the primary fix.
        #  - steady_stall: once past the grace window, a stage that goes
        #    this long without a heartbeat while capture is alive is
        #    genuinely wedged (not "hasn't gotten to its first frame yet").
        # A single small threshold here previously caused a self-inflicted
        # restart loop: each restart pays the slow first-inference cost
        # again, the watchdog fired again before it finished, forever.
        startup_grace = 90.0
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
                # that's already handled by its own reconnect logic, not a
                # downstream stall. Nothing else to do here.
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

    def _open_capture(self, src):
        params = [cv2.CAP_PROP_HW_ACCELERATION, cv2.VIDEO_ACCELERATION_ANY,
                  cv2.CAP_PROP_BUFFERSIZE, 1]
        for backend in [cv2.CAP_FFMPEG, None, cv2.CAP_DSHOW, cv2.CAP_MSMF]:
            try:
                cap = cv2.VideoCapture(src, backend, params) if backend else cv2.VideoCapture(src)
                if cap.isOpened():
                    return cap
                cap.release()
            except Exception:
                pass
        return cv2.VideoCapture(src)

    def _detect_motion(self, frame):
        gray  = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        small = cv2.resize(gray, (160, 120), interpolation=cv2.INTER_NEAREST)
        if self._prev_motion is None:
            self._prev_motion = small
            return True
        diff = cv2.absdiff(small, self._prev_motion)
        self._prev_motion = small
        _, thresh = cv2.threshold(diff, 20, 255, cv2.THRESH_BINARY)
        return np.count_nonzero(thresh) / thresh.size > self._motion_thr

    def _get_roi(self, orig_h: int, orig_w: int):
        pts = []
        for obj in (*self.zones, *self.lines):
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
        if 0.10 * orig_w * orig_h <= area <= 0.90 * orig_w * orig_h:
            return rx1, ry1, rx2, ry2
        return None

