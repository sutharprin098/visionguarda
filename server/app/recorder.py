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
        self.continuous_segment_limit = 600  # 10 mins
        
        # Event recording states (only accessed inside recorder thread)
        self.event_writer = None
        self.event_rec_id = None
        self.event_active = False
        self.post_event_counter = 0
        self.post_event_limit = fps * 5  # 5 seconds post-event recording

        # Queue and background thread setup
        self.queue = queue.Queue(maxsize=1000)
        self.running = True
        self.thread = threading.Thread(target=self._write_loop, name=f"RecLoop-{camera_id}")
        self.thread.daemon = True
        self.thread.start()

    def push_frame(self, frame):
        """Push the latest frame into the recording queue.

        No copy needed here: the recording thread is the sole consumer of the
        queue and processes the frame synchronously before touching any other
        frame reference. The frame numpy array is not modified by the pipeline
        after this call (Module 2 has already finished encoding the MJPEG JPEG
        and will not reuse the same buffer), so passing by reference is safe.
        """
        if frame is None or not self.running:
            return
        try:
            self.queue.put_nowait(("FRAME", frame))
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
        """Returns True if the recorder is actively recording continuous or event-based footage."""
        return (self.continuous_writer is not None) or self.event_active

    def _write_loop(self):
        """Background thread loop to consume recording tasks sequentially."""
        while True:
            try:
                task = self.queue.get(timeout=1.0)
            except queue.Empty:
                if not self.running:
                    break
                continue

            cmd = task[0]
            if cmd == "FRAME":
                frame = task[1]
                rec_frame = cv2.resize(frame, self.frame_size)
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
        self._stop_continuous()
        
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
        else:
            self.continuous_writer = None
            print(f"[Recorder] Error opening continuous video writer for cam: {self.camera_id}", flush=True)

    def _stop_continuous(self):
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
        if not self.continuous_writer:
            return
        
        # Check segment rotation
        if time.time() - self.continuous_start_time > self.continuous_segment_limit:
            self._start_continuous()
            
        if self.continuous_writer:
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
