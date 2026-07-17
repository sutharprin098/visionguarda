import os
import cv2
import time
import json
import traceback
import threading
from collections import deque
import numpy as np
from uuid import uuid4
from scipy.optimize import linear_sum_assignment

from app.ai.backend import EngineBackend
from app.ai import face as face_detect
from app.storage import insert_alert, insert_history_record
from app.recorder import CCTVRecorder
from app.analytics import CameraAnalytics, VEHICLE_CLASSES, _object_category, _point_in_zone_shape, PROFILE_CLASSES
from app.config import RECORDINGS_DIR
from app.gpu_monitor import get_gpu_usage

# Minimum buffering for all FFMPEG-based capture sources
os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = (
    "rtsp_transport;tcp|threads;4|fflags;nobuffer|flags;low_delay"
)


def _vehicle_classes_compatible(a: str, b: str) -> bool:
    """True if a and b are both vehicle-family classes (car/bus/truck/
    motorcycle/bicycle) -- used to let track-continuation matching survive
    a detector's frame-to-frame class flip between visually similar vehicle
    subtypes, without ever conflating a vehicle with a person or item."""
    return a in VEHICLE_CLASSES and b in VEHICLE_CLASSES


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
        if frame is None:
            return None
        h, w = frame.shape[:2]
        x1 = max(0, min(w - 1, int(bbox[0]))); x2 = max(x1 + 1, min(w, int(bbox[2])))
        y1 = max(0, min(h - 1, int(bbox[1]))); y2 = max(y1 + 1, min(h, int(bbox[3])))
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
    def __init__(self, track_id, bbox, class_name, confidence, embedding=None, n_init=2):
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
        # accumulate n_init hits — this is what stops a single spurious
        # detection from ever being handed out as a "new" ID.
        self.state = "tentative" if n_init > 1 else "confirmed"
        self.embedding = embedding
        now = time.time()
        self.first_seen = now
        self.last_seen  = now

    def predict(self):
        self.age += 1
        self.time_since_update += 1
        return self.kf.predict()

    def _vote_class(self, class_name):
        if class_name:
            self._class_votes.append(class_name)
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

    def update(self, bbox, confidence, embedding=None, class_name=None):
        self.time_since_update = 0
        self.hits += 1
        self.confidence = confidence
        self.last_seen = time.time()
        self.kf.update(bbox)
        self._vote_class(class_name)
        self._blend_embedding(embedding, new_weight=0.15)
        if self.state == "tentative" and self.hits >= self.n_init:
            self.state = "confirmed"

    def revive(self, bbox, confidence, embedding, class_name):
        """Re-activate a track pulled from the lost gallery under its ORIGINAL id.

        This is the re-identification path: the object was gone long enough
        to leave the short-term occlusion window, but a new detection's
        appearance matched it closely enough (see ByteTracker._reid_gate) to
        be confident it's the same object, not a new one.
        """
        self.kf = LightweightKalmanFilter(bbox)
        self.time_since_update = 0
        self.hits += 1
        self.confidence = confidence
        self.last_seen = time.time()
        self.state = "confirmed"
        self._vote_class(class_name)
        self._blend_embedding(embedding, new_weight=0.35)

    def get_bbox(self):
        return self.kf.get_bbox()


class ByteTracker:
    """
    Multi-object tracker built for ID persistence under occlusion, overlap,
    stopping, and lighting change:

      1. Kalman constant-velocity motion prediction per track (unchanged).
      2. Optimal (Hungarian / scipy linear_sum_assignment) data association
         instead of greedy nearest-match — greedy matching is a well-known
         source of avoidable ID switches whenever two tracks' candidate
         detections overlap in ambiguous ways (crowds, crossing paths).
      3. Appearance re-identification: every detection gets an HSV-histogram
         embedding; association cost fuses IoU with appearance distance, and
         weighting shifts toward appearance the longer a track has gone
         unmatched (motion prediction alone drifts increasingly wrong the
         longer an object is occluded).
      4. A "lost gallery": tracks that exceed the short active-occlusion
         window move into long-term memory (id, last embedding, class,
         first_seen) instead of being deleted. New detections that don't
         match any active track are checked against the gallery — on an
         appearance + spatial match, the ORIGINAL id is revived rather than
         minting a new one. This is what lets an object that fully leaves
         Kalman's prediction window (walked behind a truck for 4 seconds,
         say) keep its ID when it reappears.
    """

    # Bhattacharyya distance threshold for gallery re-identification. Same
    # object under consistent lighting typically lands well under this;
    # different objects (even same clothing color family) typically clear it.
    _REID_APPEARANCE_GATE = 0.40
    # Cap how far (as a fraction of the frame diagonal) a revived track's new
    # position may be from its last known position — appearance alone is not
    # discriminative enough to safely re-identify across the whole frame.
    _REID_SPATIAL_GATE = 0.5

    def __init__(self, max_lost_frames=45, reid_ttl=60.0, n_init=2):
        self.max_lost_frames = max_lost_frames  # frames a track stays actively coasted before moving to the gallery
        self.reid_ttl        = reid_ttl         # seconds a track stays re-identifiable in the gallery
        self.n_init          = n_init
        self.tracks = []          # active + short-term-occluded (predicted every frame)
        self.lost_gallery = {}    # track_id -> Track, long-term re-id memory
        self.next_track_id = 1

    @staticmethod
    def _compute_iou(boxA, boxB):
        xA = max(boxA[0], boxB[0]); yA = max(boxA[1], boxB[1])
        xB = min(boxA[2], boxB[2]); yB = min(boxA[3], boxB[3])
        inter = max(0.0, xB - xA) * max(0.0, yB - yA)
        areaA = (boxA[2]-boxA[0]) * (boxA[3]-boxA[1])
        areaB = (boxB[2]-boxB[0]) * (boxB[3]-boxB[1])
        return inter / max(1.0, areaA + areaB - inter)

    @staticmethod
    def _hungarian_match(tracks, dets, iou_gate, w_iou, w_app, app_gate=None, spatial_gate=None, frame_diag=None):
        """Optimal assignment on a fused IoU + appearance cost, with hard gates.

        Invalid pairs (class mismatch, or failing a gate) get a sentinel cost
        strictly above any achievable real cost (max 1.0), so Hungarian only
        ever falls back to them when no valid pairing exists to complete the
        assignment — then the post-hoc validity check discards those.
        """
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
                elif _vehicle_classes_compatible(t.class_name, d["class"]):
                    # Detectors routinely flip a single real vehicle between
                    # visually-similar vehicle subtypes frame to frame (car
                    # vs truck vs van is a classic confusion). A hard class
                    # gate here means every flip fragments one real vehicle
                    # into two tracks that then fight over the same
                    # detection stream every subsequent frame (confirmed via
                    # a real MOT-metrics run: one physical vehicle produced
                    # 7 ID switches alternating between a "car" track and a
                    # "truck" track for the same box). Track.class_name is
                    # majority-voted (see Track._vote_class) so allowing a
                    # same-vehicle-family continuation here doesn't make the
                    # DISPLAYED class flicker — it just stops the class
                    # noise from splitting one object into two ids. A small
                    # cost penalty still makes Hungarian prefer a genuine
                    # same-class match when one is available.
                    class_penalty = 0.15
                else:
                    continue
                iou = ByteTracker._compute_iou(tb, d["bbox"])
                if iou < iou_gate:
                    continue
                app_d = AppearanceEmbedder.distance(t.embedding, d["embedding"])
                if app_gate is not None and app_d > app_gate:
                    continue
                if spatial_gate is not None and frame_diag:
                    tcx, tcy = (tb[0] + tb[2]) / 2.0, (tb[1] + tb[3]) / 2.0
                    dcx, dcy = (d["bbox"][0] + d["bbox"][2]) / 2.0, (d["bbox"][1] + d["bbox"][3]) / 2.0
                    dist = np.hypot(tcx - dcx, tcy - dcy) / frame_diag
                    if dist > spatial_gate:
                        continue
                cost[ti, di] = min(INVALID - 1e-3, w_iou * (1.0 - iou) + w_app * app_d + class_penalty)
        row_ind, col_ind = linear_sum_assignment(cost)
        m_t, m_d = [], []
        unmatched_t, unmatched_d = set(range(n_t)), set(range(n_d))
        for r, c in zip(row_ind, col_ind):
            if cost[r, c] >= INVALID:
                continue
            m_t.append(r); m_d.append(c)
            unmatched_t.discard(r); unmatched_d.discard(c)
        return m_t, m_d, sorted(unmatched_t), sorted(unmatched_d)

    def update(self, detections, frame=None, frame_shape=None, conf_thresh=0.25):
        for t in self.tracks:
            t.predict()

        high_dets, low_dets = [], []
        for det in detections:
            b = det["bbox"]
            bbox = [b["x1"], b["y1"], b["x2"], b["y2"]]
            embedding = AppearanceEmbedder.extract(frame, bbox)
            item = {"bbox": bbox, "class": det["class"], "confidence": det["confidence"], "embedding": embedding}
            if det["confidence"] >= conf_thresh:
                high_dets.append(item)
            elif det["confidence"] >= 0.08:
                low_dets.append(item)

        frame_diag = np.hypot(*frame_shape) if frame_shape else None

        # ── Stage 1: freshly-updated tracks — motion is trustworthy, weight IoU ──
        active_tracks   = [t for t in self.tracks if t.time_since_update <= 1]
        occluded_tracks = [t for t in self.tracks if t.time_since_update > 1]

        m_t, m_d, _, un_d = self._hungarian_match(active_tracks, high_dets, iou_gate=0.2, w_iou=0.75, w_app=0.25)
        matched_track_objs = set()
        for ti, di in zip(m_t, m_d):
            trk, det = active_tracks[ti], high_dets[di]
            trk.update(det["bbox"], det["confidence"], det["embedding"], det["class"])
            matched_track_objs.add(id(trk))
        rem_high   = [high_dets[i] for i in un_d]
        rem_active = [t for t in active_tracks if id(t) not in matched_track_objs]

        # ── Stage 2: coasting/occluded tracks — motion prediction is drifting,
        # weight appearance more heavily and loosen the IoU gate ──────────────
        m_t2, m_d2, un_t2, un_d2 = self._hungarian_match(
            occluded_tracks, rem_high, iou_gate=0.05, w_iou=0.4, w_app=0.6, app_gate=0.5
        )
        for ti, di in zip(m_t2, m_d2):
            trk, det = occluded_tracks[ti], rem_high[di]
            trk.update(det["bbox"], det["confidence"], det["embedding"], det["class"])
            matched_track_objs.add(id(trk))
        rem_high2 = [rem_high[i] for i in un_d2]
        rem_unmatched_tracks = rem_active + [occluded_tracks[i] for i in un_t2]

        # ── Stage 3 (ByteTrack second pass): low-confidence detections rescue
        # remaining unmatched tracks by IoU only ───────────────────────────────
        m_t3, m_d3, _, _ = self._hungarian_match(rem_unmatched_tracks, low_dets, iou_gate=0.1, w_iou=1.0, w_app=0.0)
        for ti, di in zip(m_t3, m_d3):
            trk, det = rem_unmatched_tracks[ti], low_dets[di]
            trk.update(det["bbox"], det["confidence"], det.get("embedding"), det["class"])

        # ── Stage 4: re-identify remaining detections against the lost gallery
        # BEFORE minting new ids — the whole point of the gallery ─────────────
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
                trk.revive(det["bbox"], det["confidence"], det["embedding"], det["class"])
                self.tracks.append(trk)
                del self.lost_gallery[trk.track_id]
                revived_det_idx.add(di)
            still_unmatched_high = [d for i, d in enumerate(still_unmatched_high) if i not in revived_det_idx]

        # ── New tracks for anything left over ──────────────────────────────────
        for det in still_unmatched_high:
            self.tracks.append(Track(self.next_track_id, det["bbox"], det["class"], det["confidence"],
                                      embedding=det["embedding"], n_init=self.n_init))
            self.next_track_id += 1

        # ── Duplicate-track suppression: two simultaneously confirmed tracks
        # of the same class with heavy mutual bbox overlap are almost
        # certainly one physical object that ended up spawning two IDs (a
        # new track created a frame before the original's next real match
        # arrived, or a brief mismatch during a crossing). Left alone,
        # Hungarian's one-to-one assignment has only one real detection to
        # give to the two of them each frame, so it would alternate which
        # one "wins" — a ping-pong of ID switches on a SINGLE vehicle rather
        # than any genuine tracking loss. General safety net for genuine
        # same-class duplicates; the specific class-flicker fragmentation
        # case (one vehicle alternating "car"/"truck" tracks, confirmed via
        # a real MOT-metrics run) is fixed separately above, in
        # _hungarian_match's class gate — this same-class-only check never
        # even evaluated that pair (different class_name skipped it before
        # any IoU comparison), which is exactly why it needed a separate
        # fix rather than a wider IoU threshold here. Still required by the
        # goal ("Prevent duplicate IDs") for the genuinely-co-located case.
        DUP_IOU_THRESH = 0.6
        merged_ids = set()
        for i in range(len(self.tracks)):
            ti = self.tracks[i]
            if ti.track_id in merged_ids or ti.state != "confirmed":
                continue
            for j in range(i + 1, len(self.tracks)):
                tj = self.tracks[j]
                if (tj.track_id in merged_ids or tj.state != "confirmed"
                        or tj.class_name != ti.class_name):
                    continue
                if min(ti.time_since_update, tj.time_since_update) > 1:
                    continue  # neither matched recently -- not a live duplicate conflict
                if self._compute_iou(ti.get_bbox(), tj.get_bbox()) >= DUP_IOU_THRESH:
                    dup = tj if ti.hits >= tj.hits else ti
                    merged_ids.add(dup.track_id)
        if merged_ids:
            self.tracks = [t for t in self.tracks if t.track_id not in merged_ids]

        # ── Age out: long-lost active tracks move to the gallery instead of
        # vanishing; edge-exits (object left frame, not occluded) are dropped
        # outright since they are genuinely gone, not re-identifiable ─────────
        still_active = []
        for t in self.tracks:
            if t.time_since_update > self.max_lost_frames:
                if t.state == "confirmed" and t.embedding is not None:
                    self.lost_gallery[t.track_id] = t
                continue
            if t.time_since_update > 5 and frame_shape:
                h, w = frame_shape
                bbox = t.get_bbox()
                mx, my = 0.03 * w, 0.03 * h
                if bbox[0] < mx or bbox[2] > w - mx or bbox[1] < my or bbox[3] > h - my:
                    continue
            still_active.append(t)
        self.tracks = still_active

        now = time.time()
        expired = [tid for tid, t in self.lost_gallery.items() if now - t.last_seen > self.reid_ttl]
        for tid in expired:
            del self.lost_gallery[tid]
        # Hard cap so a very busy scene over a long shift can't grow this
        # dict unbounded — evict the oldest entries first.
        if len(self.lost_gallery) > 300:
            oldest = sorted(self.lost_gallery.items(), key=lambda kv: kv[1].last_seen)[:len(self.lost_gallery) - 300]
            for tid, _ in oldest:
                del self.lost_gallery[tid]

        out = []
        for t in self.tracks:
            if t.time_since_update == 0 and t.state == "confirmed":
                bbox = t.get_bbox()
                out.append({
                    "track_id":  t.track_id,
                    "class":     t.class_name,
                    "confidence": round(float(t.confidence), 2),
                    "first_seen": t.first_seen,
                    "dwell_time": round(now - t.first_seen, 1),
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
                 zones_json: str, lines_json: str, backend_getter, rules_json: str = "[]",
                 zone_profile: str = None, profile_features: str = "{}"):

        self.camera_id   = camera_id
        self.name        = name
        self.source_type = source_type
        self.source      = source
        self._backend_getter = backend_getter
        self._backend_override = None

        # A local video FILE (as opposed to a live device/RTSP stream) is a
        # finite source: cap.read() returns ret=False at EOF, which is normal
        # end-of-media, NOT a device disconnect. Treated as the latter it would
        # flap into "network_error" and stall 3s per loop (see _capture_loop).
        # Detected purely by "is this an existing file on disk" so it works
        # regardless of which coarse source_type the desktop tagged it with
        # (it maps every non-webcam/usb source to 'rtsp'). URLs and device
        # indices are never files, so they correctly fall through to the live
        # reconnect path.
        self._is_video_file = False
        try:
            if source_type not in ("webcam", "usb", "screenshare") and os.path.isfile(str(source)):
                self._is_video_file = True
        except Exception:
            self._is_video_file = False

        self.zones = json.loads(zones_json)
        self.lines = json.loads(lines_json)
        self.rules = json.loads(rules_json)
        self.zone_profile = zone_profile
        self.profile_features = json.loads(profile_features) if isinstance(profile_features, str) else (profile_features or {})

        self.running        = False
        self.incoming_frame = None       # screenshare push target
        self._last_push_ts  = 0.0        # last time push_frame() delivered a frame (screenshare staleness)
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

        # Display-only encode knobs, mutable at runtime via update_display_config().
        # Plain int/float attributes are fine to read/write without a lock here —
        # this only affects how Module 2 encodes the MJPEG preview, never the AI path.
        self.display_max_width = 960
        self.jpeg_quality = 65

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
        # GPU used to start at 960 on the theory that "GPU" implies headroom
        # to spare — measured wrong on real hardware: a clean (uncontended),
        # real-video benchmark on this machine's GPU backend showed imgsz=960
        # costs 179ms for pre+inference+postprocess ALONE (already over the
        # goal's 150ms end-to-end budget before capture/tracking/render are
        # even added), while imgsz=640 costs 87.8ms with comparable detection
        # recall (5 vs 6 vehicles on the same test frame) — i.e. the 960
        # starting point was violating the latency target by default and
        # relying on the rolling-window step-down (10 samples, ~4s at typical
        # fps) to claw it back. Starting at the already-proven-safe value
        # closes that gap immediately instead of eating it as startup lag on
        # every camera start/restart; the adaptive logic above/below this
        # value still applies (can step down to min_imgsz if this hardware is
        # still slow, or up toward max_imgsz if it's faster than expected).
        backend_model = self.backend
        device = getattr(backend_model, "backend_device", "CPU").upper()
        if "GPU" in device or "CUDA" in device:
            self.current_imgsz = 640
            self.max_imgsz     = 1280
            self.min_imgsz     = 320
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
        # Wall-clock time of the last frame actually sent through inference.
        # should_infer normally gates on frame-diff motion, but a slow-moving
        # or newly-appeared-but-still object can sit below that threshold
        # indefinitely — the object simply never gets its first detection.
        # Forcing a real inference pass at least once a second bounds that
        # worst case instead of leaving it unbounded (previously observed as
        # boxes taking up to ~10s to appear).
        self._last_infer_ts = 0.0
        self._FORCE_INFER_INTERVAL = 1.0

        # Shared counter: _tracking_loop writes, _ai_loop reads.
        # Safe under CPython GIL — int assignment is atomic.
        self._n_active_tracks = 0

        self.cap = None
        # Consecutive failed capture-reconnect cycles for this camera; drives
        # exponential backoff in _capture_loop (see there for why) and is
        # surfaced in telemetry so a persistently-broken source is visible
        # to operators instead of silently retrying forever.
        self._cap_consecutive_failures = 0

        # ── Reported connection health (see app.health_probe) ───────────────
        # 'connecting' until the first successful frame or a classified
        # failure; surfaced via /api/status and pushed to Supabase by the
        # desktop app's health-report loop (report-camera-health function).
        self._health_status = "connecting"
        self._last_probe_ts = 0.0
        self._last_resolution = ""

    @property
    def backend(self):
        if self._backend_override is not None:
            return self._backend_override
        return self._backend_getter()

    @backend.setter
    def backend(self, val):
        self._backend_override = val

    def _update_health_on_failure(self):
        """Classifies a capture failure as connecting/offline/auth_failed/
        network_error. Probing (a real socket round-trip) is rate-limited —
        only re-run every few seconds, not on every fast retry tick."""
        if self.source_type in ("usb", "webcam"):
            self._health_status = "offline" if self._cap_consecutive_failures >= 3 else "connecting"
            return
        if self._cap_consecutive_failures == 0:
            self._health_status = "connecting"
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
            self._health_status = "offline" if self._cap_consecutive_failures >= 6 else "connecting"

    # -----------------------------------------------------------------------
    # Lifecycle
    # -----------------------------------------------------------------------

    def push_frame(self, frame):
        """Receive a frame from the screenshare WebSocket handler."""
        self.incoming_frame = frame
        self._last_push_ts = time.time()

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

    def update_config(self, zones_json: str, lines_json: str, rules_json: str = "[]", zone_profile: str = None, profile_features: str = "{}"):
        self.zones = json.loads(zones_json)
        self.lines = json.loads(lines_json)
        self.rules = json.loads(rules_json)
        self.zone_profile = zone_profile
        self.profile_features = json.loads(profile_features) if isinstance(profile_features, str) else (profile_features or {})
        self.analytics.reset_counters()

    def update_display_config(self, max_width: int = None, quality: int = None):
        """Adjust the MJPEG preview encode target at runtime (display only —
        never touches capture, inference, or recording resolution)."""
        if max_width is not None:
            self.display_max_width = max(320, min(1920, int(max_width)))
        if quality is not None:
            self.jpeg_quality = max(30, min(95, int(quality)))

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

        # Hardware-accelerated decode (CAP_PROP_HW_ACCELERATION=ANY) can
        # silently produce zero frames — isOpened() stays True, read() just
        # never succeeds — when it lands on the same GPU that's concurrently
        # doing AI compute (observed on an Intel iGPU: OpenVINO GPU inference
        # running while HW-accel video decode is requested on the same
        # device). _cap_hw_accel starts True and _capture_loop flips it to
        # False (falls back to software decode) after repeated total-failure
        # reconnects, so a real, otherwise-healthy source doesn't just spin
        # forever on a decode path this process's GPU usage has broken.
        self._cap_hw_accel = True

        if self.source_type != "screenshare":
            src = (int(self.source)
                   if self.source_type in ("webcam", "usb") and str(self.source).isdigit()
                   else self.source)
            self.cap = self._open_capture(src, hw_accel=self._cap_hw_accel)
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
                        self.cap = self._open_capture(src, hw_accel=self._cap_hw_accel)
                        if self.cap.isOpened():
                            self.cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
                            self.cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*"MJPG"))
                        else:
                            # Previously never counted, so backoff never escalated past
                            # its 2s floor for a source that fails to open at all (wrong
                            # IP, camera powered off) — now it climbs like every other
                            # failure mode, and health classification (below) kicks in.
                            self._cap_consecutive_failures += 1
                            self._update_health_on_failure()
                        last_good_frame_ts = time.time()
                        continue

                    ret, frame = self.cap.read()
                    if (not ret or frame is None) and self._is_video_file:
                        # End of a finite video FILE — loop it seamlessly by
                        # seeking back to the first frame rather than treating
                        # EOF as a device disconnect. Keeps "Local Video" a
                        # continuous source (stays "online", no 3s stall,
                        # no false network_error). If the seek itself can't
                        # produce a frame (truly unreadable/corrupt file), fall
                        # through to the live-source recovery path below.
                        self.cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
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
                            # A total-failure reconnect on a source that DID
                            # successfully open (isOpened True) but never
                            # yielded a single frame in a full 3s window
                            # points at the HW-accel decode path itself, not
                            # a transient network/device hiccup — drop to
                            # software decode instead of retrying the same
                            # broken path. One strike, not two: when this
                            # path is broken, cap.read() itself blocks for
                            # several seconds per attempt (GPU driver
                            # contention) rather than failing fast, so
                            # waiting for a second failed cycle before
                            # recovering roughly doubles an already-slow
                            # recovery time for no added confidence.
                            if self._cap_hw_accel and self._cap_consecutive_failures >= 1:
                                self._cap_hw_accel = False
                                print(f"[Cap-{self.camera_id}] Falling back to software decode "
                                      f"after repeated frameless reconnects.", flush=True)
                            self._update_health_on_failure()
                        retry_sleep = min(2.0, 0.05 * (1.5 ** min(self._cap_consecutive_failures, 12)))
                        time.sleep(retry_sleep)
                        continue
                    last_good_frame_ts = time.time()
                    self._cap_consecutive_failures = 0
                    self._health_status = "online"
                    if frame is not None:
                        self._last_resolution = f"{frame.shape[1]}x{frame.shape[0]}"
                else:
                    frame = self.incoming_frame
                    self.incoming_frame = None
                    if frame is None:
                        # The desktop's WebSocket pusher (see localEngine/mediaShare on the
                        # client) can drop silently — sleep, network blip, permission
                        # revoke — with nothing here to notice unless we actively track
                        # staleness. Without this, _health_status just freezes at whatever
                        # it last was (typically "online") forever, so the portal/desktop
                        # UI would never show a dead screenshare as disconnected.
                        if self._last_push_ts and (time.time() - self._last_push_ts) > 6.0:
                            self._health_status = "offline"
                        time.sleep(0.005)
                        continue
                    last_good_frame_ts = time.time()
                    self._health_status = "online"
                    self._last_resolution = f"{frame.shape[1]}x{frame.shape[0]}"

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

                # Apply privacy masks (solid black blackout) to raw frame before MJPEG encode or AI
                h, w = frame.shape[:2]
                for zone in self.zones:
                    if zone.get("zoneType") == "privacy_mask":
                        pts = zone.get("points", [])
                        if len(pts) >= 2:
                            pts_px = np.array([[p[0] * w, p[1] * h] for p in pts], dtype=np.int32)
                            cv2.fillPoly(frame, [pts_px], (0, 0, 0))

                # ── MJPEG stream: encode at full camera FPS, never blocked by AI ─
                # Resize to display_max_width before encoding to reduce JPEG cost.
                max_w = self.display_max_width
                h, w = frame.shape[:2]
                if w > max_w:
                    scale   = max_w / w
                    mjpeg_f = cv2.resize(frame, (max_w, int(h * scale)), interpolation=cv2.INTER_LINEAR)
                else:
                    mjpeg_f = frame
                ok, jpg = cv2.imencode('.jpg', mjpeg_f, [cv2.IMWRITE_JPEG_QUALITY, self.jpeg_quality])
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
        backend = self.backend
        if backend is not None:
            backend.release_thread_request()

    def _ai_loop_iteration(self, data):
            backend = self.backend
            if backend is None:
                time.sleep(0.1)
                return

            frame   = data["frame"]
            orig_h, orig_w = frame.shape[:2]
            motion  = self._detect_motion(frame)

            # Keep inferring when active tracks exist (person standing still has no motion
            # between consecutive frames but must stay tracked). force_infer bounds the
            # worst-case gap between real inference passes even when neither is true, so
            # a slow-entering or already-present-but-still object still gets its first
            # detection within ~1s instead of waiting indefinitely for a motion spike.
            # _n_active_tracks is written by _tracking_loop — safe under CPython GIL.
            force_infer  = (time.time() - self._last_infer_ts) > self._FORCE_INFER_INTERVAL
            should_infer = motion or self._n_active_tracks > 0 or force_infer

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
                tensor, t_pre   = backend.preprocess(inf_frame, self.current_imgsz)
                outputs, t_inf  = backend.run_inference(tensor)
                detections, masks_polygons, t_post = backend.postprocess(
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

                # ── Strict polygon ROI gate: cameras with one or more zones
                # flagged roi=true only detect/track/analyze objects whose
                # centroid falls inside the union of those polygons. This is
                # separate from the `_get_roi` bbox pre-crop above (which is
                # a rectangular performance optimization over ALL zones+lines
                # and never excludes anything precisely) — this is the actual
                # per-object containment gate, applied to real detections in
                # full-frame coords. Detections dropped here never reach the
                # tracker, so no track ID is ever minted for them and no
                # analytics (counting/line-crossing/speed/intrusion/
                # loitering/alerts) ever sees them either, since every
                # downstream stage only operates on this `detections` list.
                # No-op (full-frame detection, unchanged behavior) for any
                # camera that hasn't defined a detection ROI.
                roi_zones = [z for z in self.zones if z.get("roi") and z.get("points")]
                if roi_zones and detections:
                    kept = [
                        i for i, det in enumerate(detections)
                        if any(
                            _point_in_zone_shape(
                                (det["bbox"]["x1"] + det["bbox"]["x2"]) / 2.0 / orig_w,
                                (det["bbox"]["y1"] + det["bbox"]["y2"]) / 2.0 / orig_h,
                                z["points"], z.get("shapeType", "polygon"),
                            )
                            for z in roi_zones
                        )
                    ]
                    if len(kept) != len(detections):
                        detections = [detections[i] for i in kept]
                        masks_polygons = [masks_polygons[i] for i in kept] if masks_polygons else masks_polygons

                self._last_infer_ts = time.time()

                # Throttled inference/detection heartbeat (~every 5s per camera).
                # Confirms in the (frozen) engine log that inference is running
                # continuously and how many objects each pass yields — the
                # "Inference Completed / Objects Detected / Detection Count /
                # Runtime" debug signals, without a line per frame.
                _now = time.time()
                if _now - getattr(self, "_last_det_log_ts", 0.0) >= 5.0:
                    self._last_det_log_ts = _now
                    _bt = getattr(backend, "backend_type", "?")
                    _dev = getattr(backend, "backend_device", "?")
                    print(f"[AI-{self.camera_id}] Inference OK: dets={len(detections)} "
                          f"infer={t_inf:.1f}ms backend={_bt}/{_dev} imgsz={self.current_imgsz}", flush=True)

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

            # ── Track: input and output in absolute pixel coords ─────────────
            tracks_raw = self.tracker.update(
                detections, frame=frame, frame_shape=(orig_h, orig_w), conf_thresh=data["conf_thresh"]
            )
            # Update shared counter so _ai_loop can decide whether to keep inferring
            self._n_active_tracks = len(self.tracker.tracks)

            # ── Assign track IDs (+ dwell time) back to YOLO detections via IoU,
            # and hand rendering over to the tracker's own Kalman-filtered
            # position instead of the raw per-frame detector box. The raw box
            # jitters frame to frame (detector noise) and was previously run
            # through a *second*, independent EMA smoothing pass in
            # analytics.py — two uncoordinated smoothers stacked in series is
            # exactly what produces a box that visibly trails a fast-moving
            # vehicle instead of staying locked to it. The tracker already
            # solved this (constant-velocity Kalman model, updated every real
            # detection) — Module 4 should just use that state directly. ──
            tracks_by_id = {trk["track_id"]: trk for trk in tracks_raw}
            matched_track_ids = set()
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
                    det["dwell_time"] = tracks_by_id[best_id]["dwell_time"]
                    det["bbox"] = dict(tracks_by_id[best_id]["bbox"])
                    det["confidence"] = tracks_by_id[best_id]["confidence"]
                    det["tracking_status"] = "tracked"
                    matched_track_ids.add(best_id)

            # ── Coasting tracks: a confirmed track the tracker is still
            # predicting through a brief missed detection (occlusion, motion
            # blur, one bad frame) but that didn't match a raw detection this
            # frame. Emit its Kalman-predicted box anyway so the vehicle never
            # simply loses its box mid-occlusion — this is what "automatic
            # recovery after missed detections" requires: the box has to keep
            # existing (and moving) through the gap, not disappear and
            # reappear. Bounded to a short window; beyond that the tracker
            # itself ages the track out (see ByteTracker.update).
            COAST_RENDER_FRAMES = 5
            for t in self.tracker.tracks:
                if t.track_id in matched_track_ids or t.state != "confirmed":
                    continue
                if not (0 < t.time_since_update <= COAST_RENDER_FRAMES):
                    continue
                cbbox = t.get_bbox()
                detections.append({
                    "class": t.class_name,
                    "confidence": round(float(t.confidence), 2),
                    "track_id": t.track_id,
                    "dwell_time": round(time.time() - t.first_seen, 1),
                    "bbox": {"x1": cbbox[0], "y1": cbbox[1], "x2": cbbox[2], "y2": cbbox[3]},
                    "tracking_status": "coasting",
                })
                masks.append([])

            # ── Face pass: a SECOND model, and the only module here whose
            # toggle actually saves inference time when off ────────────────
            # yolox emits every COCO class in one forward pass, so switching
            # "vehicles" off saves nothing. YuNet is a separate network, so this
            # block is the real thing: enabled -> ~35ms, disabled -> 0ms, never
            # loaded. Runs on person crops (measured ~2x faster and +25% recall
            # vs the whole frame — see app/ai/face.py). Must land in
            # `detections` before analytics.update(), because analytics.py's
            # face_detection loop matches on det["class"] == "face"; that loop
            # has existed since the feature shipped and has never once fired.
            face_cfg = (self.profile_features or {}).get("face_detection", {})
            # Gate on the profile too, not just the toggle. Measured: a traffic
            # camera with face_detection left on burned 21.6ms/frame running
            # YuNet and then had every face thrown away by the profile filter
            # below (traffic reports vehicles only) — pure waste, invisible in
            # the output. A profile that cannot report faces must not pay for
            # detecting them.
            _profile_wants_faces = "face" in (PROFILE_CLASSES.get(self.zone_profile) or {"face"})
            t_face0 = time.perf_counter()
            if face_cfg.get("enabled") and _profile_wants_faces:
                fd = face_detect.get_detector(float(face_cfg.get("confidence", 0.6)))
                if fd is not None:
                    person_boxes = [d["bbox"] for d in detections if d.get("class") == "person"]
                    faces = fd.detect_in_persons(frame, person_boxes)
                    for fdet in faces:
                        detections.append(fdet)
                        # masks stays index-parallel with detections (see the
                        # coasting block above); a face has no mask.
                        masks.append([])
                    if fd.last_error:
                        self._stage_errors["face"] = fd.last_error
                        fd.last_error = None
            t_face = (time.perf_counter() - t_face0) * 1000

            # ── Apply the zone profile to what this camera reports ──────────
            # Must happen here, not only inside analytics.update(): that method
            # rebinds its own local `detections`, which never affected the list
            # the client_dets below are built from. The result was that a
            # traffic-profile camera still shipped person/handbag boxes to the
            # overlay while analytics quietly ignored them — the profile looked
            # like a UI switch because, downstream of analytics, it was one.
            # masks is index-parallel with detections and must be narrowed with it.
            _allowed = PROFILE_CLASSES.get(self.zone_profile)
            if _allowed and detections:
                _keep = [i for i, d in enumerate(detections) if d.get("class") in _allowed]
                if len(_keep) != len(detections):
                    if len(masks) == len(detections):
                        masks = [masks[i] for i in _keep]
                    detections = [detections[i] for i in _keep]

            # ── Rule engine + analytics: MUST receive absolute pixel coords ──
            # bbox is already the tracker's smoothed position; analytics.update()
            # only adds det["speed"] and drives zone/line/dwell logic from it.
            # track_overlays: [{track_id, class, points: [[cx,cy]...]}] — normalized
            alerts, track_overlays, heatmap, zone_stats, line_stats, crowd_stats, parking_stats = self.analytics.update(
                detections, self.zones, self.lines, orig_w, orig_h, frame=frame, rules=self.rules,
                zone_profile=self.zone_profile, profile_features=self.profile_features
            )

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
                client_dets.append({
                    "class":      det["class"],
                    "confidence": round(float(conf), 2),
                    "track_id":   det.get("track_id"),
                    "speed":      round(float(det.get("speed", 0.0)), 1),
                    "speed_calibrated": bool(det.get("speed_calibrated", False)),
                    "dwell_time": det.get("dwell_time", 0.0),
                    "tracking_status": det.get("tracking_status", "tracked"),
                    "direction":  det.get("direction", "stationary"),
                    "lane":       det.get("lane"),
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
                "items_count":    items_count,
                "other_count":    other_count,
                "heatmap":        heatmap,
                "zone_stats":     zone_stats,
                "line_stats":     line_stats,
                "crowd_stats":    crowd_stats,
                "parking_stats":  parking_stats,
                "trk_lat":        trk_lat,
                # Carried separately from trk_lat so the face module's cost is
                # attributable rather than buried in "tracking".
                "t_face":         t_face,
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
                "items":     data.get("items_count", 0),
                "other_objects": data.get("other_count", 0),
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
                # 0.0 whenever face_detection is off — makes the module's real
                # cost visible instead of it hiding inside total_latency.
                "face_latency":       round(data.get("t_face", 0.0), 1),
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
                "crowd_stats": data["crowd_stats"],
                "parking_stats": data.get("parking_stats", {"total": 0, "occupied": 0, "free": 0, "occupancy_percent": 0.0, "slots": []}),
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
        # Bumped from 90s after benchmarking on this hardware showed a cold
        # GPU InferRequest's first shape-specific kernel compile can take
        # several minutes, not just "tens of seconds" — 90s was still short
        # enough to risk exactly the restart loop this comment warns about.
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

    def _open_capture(self, src, hw_accel: bool = True):
        # CAP_PROP_BUFFERSIZE is not a valid *open-time* parameter for the
        # FFMPEG backend on this OpenCV build (4.11.0) — passing it in the
        # params array makes VideoCapture.open() reject the whole params
        # list ("unsupported parameters ... Bailout") and isOpened() come
        # back False, silently pushing every source onto the DSHOW/MSMF
        # fallback backends instead (worse RTSP/container support, and on at
        # least MSMF, setting CAP_PROP_FOURCC afterward on some sources
        # leaves the reader producing isOpened()==True but zero frames — a
        # capture stall that looks identical to a genuinely dead source).
        # Buffer size is still applied correctly via cap.set() right after
        # this returns (see _capture_loop) — only the open-time list changes.
        #
        # hw_accel=False forces software decode — see _capture_loop's
        # fallback logic: HW-accel decode can silently yield zero frames
        # when it shares a GPU with concurrent AI compute on that device.
        accel_mode = cv2.VIDEO_ACCELERATION_ANY if hw_accel else cv2.VIDEO_ACCELERATION_NONE
        params = [cv2.CAP_PROP_HW_ACCELERATION, accel_mode]
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
        # Prefer the tight bbox of explicit detection-ROI zones (roi=true)
        # when any are configured — inference only ever needs to cover the
        # region objects can actually be kept from, so this crops harder
        # (faster inference) than unioning every zone/line on the camera.
        roi_zones = [z for z in self.zones if z.get("roi") and z.get("points")]
        source_objs = roi_zones if roi_zones else (*self.zones, *self.lines)
        pts = []
        for obj in source_objs:
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
