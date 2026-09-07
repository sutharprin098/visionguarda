import os
import cv2
import time
import queue
import subprocess
import threading
from collections import deque
from datetime import datetime
from uuid import uuid4
import imageio_ffmpeg
from app.config import RECORDINGS_DIR, RECORDING_FPS, RECORDING_WIDTH, RECORDING_HEIGHT
from app.storage import start_recording_entry, end_recording_entry

_FFMPEG_EXE = imageio_ffmpeg.get_ffmpeg_exe()


class _H264Writer:
    """
    cv2.VideoWriter-compatible wrapper (isOpened/write/release) that pipes
    raw BGR24 frames into ffmpeg for H.264 encoding.

    cv2.VideoWriter's own H.264 path depends on the OpenH264 DLL being
    present on the machine; when it's missing, cv2 silently falls back to
    mp4v (MPEG-4 Part 2) instead of raising — which produces valid,
    ffprobe-readable video files that no web browser can actually play
    (Chrome/Firefox/Edge only support H.264/VP8/VP9/AV1 in <video>). This
    reuses the ffmpeg binary already bundled via imageio_ffmpeg (same one
    used by _mini_rtsp_server.py) with libx264, sidestepping the OpenH264
    dependency entirely.
    """
    def __init__(self, file_path: str, fps: float, frame_size: tuple):
        self._proc = None
        self._opened = False
        w, h = frame_size
        cmd = [
            _FFMPEG_EXE, "-y", "-loglevel", "error",
            "-f", "rawvideo", "-pixel_format", "bgr24",
            "-video_size", f"{w}x{h}", "-framerate", str(fps),
            "-i", "-",
            "-c:v", "libx264", "-preset", "ultrafast", "-tune", "zerolatency",
            "-pix_fmt", "yuv420p", "-movflags", "+faststart",
            file_path,
        ]
        try:
            self._proc = subprocess.Popen(
                cmd, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
            self._opened = True
        except Exception as e:
            print(f"[Recorder] Failed to launch ffmpeg for H.264 encode: {e}", flush=True)

    def isOpened(self) -> bool:
        return self._opened and self._proc is not None and self._proc.poll() is None

    def write(self, frame):
        if not self.isOpened():
            return
        try:
            self._proc.stdin.write(frame.tobytes())
        except (BrokenPipeError, OSError) as e:
            print(f"[Recorder] ffmpeg write failed (encoder process died): {e}", flush=True)
            self._opened = False
            # Reap it. Clearing _opened alone left the dead ffmpeg unwaited —
            # a zombie process still holding its half-written .mp4 open — for
            # the entire lifetime of the engine, because nothing else ever
            # calls release() on a writer the caller believes is still live.
            self.release()

    def release(self):
        if self._proc is None:
            return
        try:
            if self._proc.stdin:
                self._proc.stdin.close()
            self._proc.wait(timeout=10)
        except Exception:
            try:
                self._proc.kill()
            except Exception:
                pass
        self._proc = None
        self._opened = False


_BOX_COLORS = {
    "person": (240, 160, 0),
    "car": (244, 220, 66),
    "motorcycle": (244, 194, 66),
    "truck": (200, 66, 200),
    "bus": (66, 244, 244),
    "no_helmet": (0, 0, 255),
    "helmet": (66, 244, 66),
    "number_plate": (66, 140, 244)
}


def _draw_recording_boxes(frame, detections):
    """Draw bounding boxes and class labels onto the recorded frame."""
    if not detections:
        return frame
    annotated = frame.copy()
    h, w = annotated.shape[:2]
    for det in detections:
        b = det.get("bbox")
        if not b:
            continue
        x1 = max(0, min(w - 1, int(b.get("x1", 0))))
        y1 = max(0, min(h - 1, int(b.get("y1", 0))))
        x2 = max(0, min(w - 1, int(b.get("x2", 0))))
        y2 = max(0, min(h - 1, int(b.get("y2", 0))))
        if x2 - x1 < 2 or y2 - y1 < 2:
            continue
        cls = det.get("class", "object")
        color = _BOX_COLORS.get(cls, (0, 220, 220))
        cv2.rectangle(annotated, (x1, y1), (x2, y2), color, 2)
        label = cls.replace("_", " ")
        tid = det.get("track_id")
        if tid is not None:
            label += f" #{tid}"
        speed = det.get("speed_kmh")
        if speed is not None and speed > 0.5:
            label += f" {int(round(speed))}km/h"
        (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.42, 1)
        ty1 = max(0, y1 - th - 6)
        cv2.rectangle(annotated, (x1, ty1), (x1 + tw + 6, ty1 + th + 6), color, -1)
        cv2.putText(annotated, label, (x1 + 3, ty1 + th + 2), cv2.FONT_HERSHEY_SIMPLEX, 0.42, (0, 0, 0), 1, cv2.LINE_AA)
    return annotated


class CCTVRecorder:
    def __init__(self, camera_id: str, fps: int = RECORDING_FPS):
        self.camera_id = camera_id
        self.fps = fps
        self.frame_size = (RECORDING_WIDTH, RECORDING_HEIGHT)
        
        # Circular buffer for pre-event recording (5 seconds)
        self.buffer_maxlen = fps * 5
        self.pre_event_buffer = deque(maxlen=self.buffer_maxlen)
        
        # Continuous recording states (only accessed inside recorder thread)
        self.continuous_writer = None
        self.continuous_rec_id = None
        self.continuous_start_time = 0

        # Load dynamic recording configuration (segment minutes & AI overlay flag)
        try:
            from app.storage import get_recording_settings
            cfg = get_recording_settings()
            self.continuous_segment_limit = max(60, int(cfg.get("segment_minutes", 10) * 60))
            self.record_with_detections = bool(cfg.get("record_with_detections", True))
        except Exception:
            self.continuous_segment_limit = 600
            self.record_with_detections = True

        self.continuous_armed = False
        self._continuous_retry_after = 0.0
        
        # Event recording states (only accessed inside recorder thread)
        self.event_writer = None
        self.event_rec_id = None
        self.event_active = False
        self.post_event_counter = 0
        self.post_event_limit = fps * 5  # 5 seconds post-event recording

        self._frame_interval = (1.0 / float(fps)) if fps and fps > 0 else 0.0
        self._next_frame_due = 0.0

        self.queue = queue.Queue(maxsize=max(8, int(fps * 2)))
        self.running = True
        self.thread = threading.Thread(target=self._write_loop, name=f"RecLoop-{camera_id}")
        self.thread.daemon = True
        self.thread.start()

    def update_recording_config(self, segment_limit_seconds: int, record_with_detections: bool):
        """Dynamically update recording segment duration limit and AI detection burn-in flag."""
        self.continuous_segment_limit = max(60, int(segment_limit_seconds))
        self.record_with_detections = bool(record_with_detections)

    def push_frame(self, frame, detections=None):
        """Downscale and enqueue frame respecting target recording cadence, optionally burning in detections."""
        if frame is None or not self.running:
            return

        if self._frame_interval:
            now = time.monotonic()
            if now < self._next_frame_due:
                return
            # Re-base deadline to avoid burst encoding after stalls
            self._next_frame_due = now + self._frame_interval

        try:
            if self.record_with_detections and detections:
                frame_to_record = _draw_recording_boxes(frame, detections)
            else:
                frame_to_record = frame
            rec_frame = cv2.resize(frame_to_record, self.frame_size)
        except Exception as e:
            print(f"[Recorder] Failed to prepare frame for recording: {e}", flush=True)
            return

        try:
            self.queue.put_nowait(("FRAME", rec_frame))
        except queue.Full:
            pass

    def start_continuous(self):
        """Queue task to start continuous recording."""
        if self.running:
            self.queue.put(("START_CONTINUOUS",))

    def stop_continuous(self):
        """Queue task to stop continuous recording."""
        if self.running:
            self.queue.put(("STOP_CONTINUOUS",))

    def trigger_event_start(self, alert_message: str):
        """Queue task to start event-based recording."""
        if self.running:
            self.queue.put(("TRIGGER_EVENT_START", alert_message))

    def trigger_event_stop(self):
        """Queue task to signal event stop."""
        if self.running:
            self.queue.put(("TRIGGER_EVENT_STOP",))

    def force_stop_all(self):
        """Shut down the recorder thread and release writers."""
        if self.running:
            self.running = False
            self.queue.put(("SHUTDOWN",))

    def is_recording(self) -> bool:
        """Returns True if continuous recording is switched on for this camera,
        or an event recording is in progress.

        Reports the ARMED state, not whether an encoder happens to be running:
        the encoder is opened lazily on the first frame, so a camera that is
        switched on but has no video yet would otherwise flip the operator's
        own toggle back off. Why a camera has no video is already reported
        honestly and separately, through health_status / source_error."""
        return self.continuous_armed or (self.continuous_writer is not None) or self.event_active

    def _write_loop(self):
        """Background thread loop to consume recording tasks sequentially."""
        while True:
            try:
                task = self.queue.get(timeout=1.0)
            except queue.Empty:
                if not self.running:
                    # Release here too, not just on the SHUTDOWN sentinel.
                    # force_stop_all() clears self.running BEFORE it queues
                    # SHUTDOWN, so a get() that happens to time out in that
                    # window exits the loop having never seen the sentinel —
                    # leaving both writers open, their ffmpeg processes
                    # unreaped and their .mp4 files truncated (no moov atom,
                    # so nothing can play them back). _force_stop_all is
                    # idempotent, so running it on both paths is safe.
                    self._force_stop_all()
                    break
                continue

            cmd = task[0]
            if cmd == "FRAME":
                # Already at self.frame_size — push_frame resized it before it
                # ever entered the queue.
                rec_frame = task[1]
                self.pre_event_buffer.append(rec_frame)
                self._handle_continuous_write(rec_frame)
                self._handle_event_write(rec_frame)
            elif cmd == "START_CONTINUOUS":
                self._start_continuous()
            elif cmd == "STOP_CONTINUOUS":
                self._stop_continuous()
            elif cmd == "TRIGGER_EVENT_START":
                alert_message = task[1]
                self._trigger_event_start(alert_message)
            elif cmd == "TRIGGER_EVENT_STOP":
                self._trigger_event_stop()
            elif cmd == "SHUTDOWN":
                self._force_stop_all()
                break

            self.queue.task_done()

    def _start_continuous(self):
        """Arm continuous recording. Does NOT launch an encoder — see
        _open_continuous_writer, which runs on the first frame to arrive."""
        self._stop_continuous()
        self.continuous_armed = True
        self._continuous_retry_after = 0.0

    def _open_continuous_writer(self) -> bool:
        rec_id = f"cont_{uuid4().hex[:8]}"
        timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
        filename = f"cam_{self.camera_id}_{timestamp}_continuous.mp4"
        file_path = str(RECORDINGS_DIR / filename)
        
        self.continuous_writer = _H264Writer(file_path, self.fps, self.frame_size)
        
        if self.continuous_writer.isOpened():
            self.continuous_rec_id = rec_id
            self.continuous_start_time = time.time()
            start_iso = datetime.utcnow().isoformat() + "Z"
            start_recording_entry(rec_id, self.camera_id, start_iso, "continuous", f"/history/recordings/{filename}")
            print(f"[Recorder] Started continuous recording: {filename}", flush=True)
            return True

        self.continuous_writer = None
        # Back off before trying again, so a machine where ffmpeg cannot launch
        # at all doesn't attempt a fresh spawn on every frame.
        self._continuous_retry_after = time.time() + 30.0
        print(f"[Recorder] Error opening continuous video writer for cam: {self.camera_id}", flush=True)
        return False

    def _stop_continuous(self):
        self.continuous_armed = False
        if self.continuous_writer:
            self.continuous_writer.release()
            self.continuous_writer = None

            end_iso = datetime.utcnow().isoformat() + "Z"
            if self.continuous_rec_id:
                end_recording_entry(self.continuous_rec_id, end_iso)

            print(f"[Recorder] Stopped continuous recording for cam: {self.camera_id}", flush=True)
            self.continuous_rec_id = None

    def _trigger_event_start(self, alert_message: str):
        if self.event_active:
            self.post_event_counter = 0
            return
        
        self.event_active = True
        self.post_event_counter = 0
        
        rec_id = f"event_{uuid4().hex[:8]}"
        timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
        filename = f"cam_{self.camera_id}_{timestamp}_event.mp4"
        file_path = str(RECORDINGS_DIR / filename)
        
        self.event_writer = _H264Writer(file_path, self.fps, self.frame_size)
        
        if self.event_writer.isOpened():
            self.event_rec_id = rec_id
            start_iso = datetime.utcnow().isoformat() + "Z"
            start_recording_entry(rec_id, self.camera_id, start_iso, "event", f"/history/recordings/{filename}")
            
            # Flush pre-event circular buffer into the new event video
            buffered_frames = list(self.pre_event_buffer)
            for f in buffered_frames:
                self.event_writer.write(f)
                
            print(f"[Recorder] Started event recording (flushed {len(buffered_frames)} frames): {filename}", flush=True)
        else:
            self.event_writer = None
            self.event_active = False
            print(f"[Recorder] Error opening event video writer for cam: {self.camera_id}", flush=True)

    def _trigger_event_stop(self):
        if self.event_active and self.post_event_counter == 0:
            self.post_event_counter = 1

    def _force_stop_all(self):
        self._stop_continuous()
        if self.event_writer:
            self.event_writer.release()
            self.event_writer = None
            if self.event_rec_id:
                end_recording_entry(self.event_rec_id, datetime.utcnow().isoformat() + "Z")
            self.event_active = False

    def _handle_continuous_write(self, frame):
        if not self.continuous_armed:
            return

        now = time.time()

        # Encoder died mid-segment. write() reaps the process and clears
        # _opened, but the writer object stays bound here, and every
        # subsequent write() on it is a silent no-op — which is how a camera
        # could report "recording" for an entire shift while producing
        # nothing. Close the database entry out and fall through to the lazy
        # open below, which starts a fresh segment.
        if self.continuous_writer and not self.continuous_writer.isOpened():
            print(f"[Recorder] Continuous encoder died for cam {self.camera_id}; starting a new segment", flush=True)
            self.continuous_writer = None
            if self.continuous_rec_id:
                end_recording_entry(self.continuous_rec_id, datetime.utcnow().isoformat() + "Z")
                self.continuous_rec_id = None
            self._continuous_retry_after = now + 2.0

        # Segment rotation.
        if self.continuous_writer and now - self.continuous_start_time > self.continuous_segment_limit:
            self._stop_continuous()
            self.continuous_armed = True

        # Lazy open. The first frame to arrive after arming — or after a
        # rotation or an encoder failure — is what actually launches ffmpeg.
        if self.continuous_writer is None:
            if now < self._continuous_retry_after:
                return
            if not self._open_continuous_writer():
                return

        self.continuous_writer.write(frame)

    def _handle_event_write(self, frame):
        if not self.event_writer:
            return
        
        if self.post_event_counter > 0:
            self.event_writer.write(frame)
            self.post_event_counter += 1
            if self.post_event_counter > self.post_event_limit:
                self.event_writer.release()
                self.event_writer = None
                
                end_iso = datetime.utcnow().isoformat() + "Z"
                if self.event_rec_id:
                    end_recording_entry(self.event_rec_id, end_iso)
                    
                print(f"[Recorder] Stopped event recording for cam: {self.camera_id}", flush=True)
                self.event_rec_id = None
                self.event_active = False
                self.post_event_counter = 0
        else:
            self.event_writer.write(frame)
