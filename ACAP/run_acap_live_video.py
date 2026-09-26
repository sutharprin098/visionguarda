#!/usr/bin/env python3
"""
CamAI ACAP Live Video Stream Runner - DECOUPLED ARCHITECTURE
=============================================================

PIPELINE A (VIDEO - 30 FPS):
  Source -> cap.read() @ 30FPS -> JPEG -> _acap_latest_frame_jpeg -> MJPEG -> browser <img>

PIPELINE B (AI - ~6 FPS independent):
  Subsampled frames -> /api/detect -> AWS inference -> detections -> overlay

The two pipelines NEVER block each other.
Browser receives smooth 30 FPS MJPEG.
AI results update the overlay at its own rate.

Dashboard: http://127.0.0.1:8000/local/camai_acap/index.html
"""
import sys
import os
os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "timeout;3000000|stimeout;3000000|rtsp_transport;tcp|fflags;nobuffer|flags;low_delay|max_delay;500000"
import time
import base64
import threading
import subprocess
import cv2
import requests
import numpy as np

# Add server directory to path
ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SERVER_DIR = os.path.join(ROOT_DIR, "server")
if SERVER_DIR not in sys.path:
    sys.path.insert(0, SERVER_DIR)
if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)

try:
    from app.ai.stream_resolver import resolve, needs_resolution
except ImportError:
    from server.app.ai.stream_resolver import resolve, needs_resolution  # type: ignore

AXIS_SNAPSHOT = os.path.join(ROOT_DIR, "ACAP", "axis_snapshot.jpg")
DEFAULT_VIDEO_URL = AXIS_SNAPSHOT
LOCAL_VIDEO_FALLBACK = os.path.join(ROOT_DIR, "videos", "CamAI_Enterprise_Demo_50s.mp4")
LOCAL_IMAGE_FALLBACK = AXIS_SNAPSHOT


class ImageStreamCapture:
    """Provides a smooth 30 FPS VideoCapture-compatible interface for static camera snapshots."""
    def __init__(self, image_path):
        self.image_path = image_path
        self.frame = cv2.imread(image_path)
        if self.frame is None:
            self.frame = np.zeros((720, 1280, 3), dtype=np.uint8)
        self.h, self.w = self.frame.shape[:2]
        self._opened = True

    def isOpened(self):
        return self._opened

    def read(self):
        if not self._opened:
            return False, None
        return True, self.frame.copy()

    def get(self, prop):
        if prop == cv2.CAP_PROP_FPS:
            return 30.0
        elif prop == cv2.CAP_PROP_FRAME_WIDTH:
            return self.w
        elif prop == cv2.CAP_PROP_FRAME_HEIGHT:
            return self.h
        return 0

    def set(self, prop, val):
        return True

    def release(self):
        self._opened = False


def ensure_server_running():
    """Ensure the FastAPI server is running on 127.0.0.1:8000"""
    try:
        r = requests.get("http://127.0.0.1:8000/local/camai_acap/telemetry.json", timeout=1)
        if r.status_code == 200:
            print("[+] Local ACAP FastAPI Server is ONLINE on http://127.0.0.1:8000", flush=True)
            return
    except Exception:
        pass

    print("[*] Starting local ACAP FastAPI Server on http://127.0.0.1:8000 ...", flush=True)
    cmd = [sys.executable, "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8000"]
    subprocess.Popen(cmd, cwd=SERVER_DIR, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    for _ in range(20):
        time.sleep(0.3)
        try:
            r = requests.get("http://127.0.0.1:8000/local/camai_acap/telemetry.json", timeout=1)
            if r.status_code == 200:
                print("[+] Local ACAP FastAPI Server started successfully!", flush=True)
                return
        except Exception:
            pass
    print("[!] Server startup proceeding...", flush=True)


def get_playable_stream(video_url):
    """Resolve Axis camera stream, local image/video or direct media stream."""
    print(f"[*] Resolving video stream source: {video_url}", flush=True)

    if not video_url or video_url == "default" or "youtube" in str(video_url).lower():
        video_url = AXIS_SNAPSHOT

    # Check if local image
    if os.path.exists(video_url) and (video_url.lower().endswith(('.jpg', '.jpeg', '.png', '.bmp'))):
        print(f"[+] Loading Axis Camera Snapshot stream: {video_url}", flush=True)
        return ImageStreamCapture(video_url), video_url

    # Check if local video
    if os.path.exists(video_url) and (video_url.lower().endswith(('.mp4', '.avi', '.mkv', '.mov'))):
        print(f"[+] Loading local camera video feed: {video_url}", flush=True)
        cap = cv2.VideoCapture(video_url)
        if cap.isOpened():
            return cap, video_url

    # Check online or RTSP/HTTP stream
    if str(video_url).startswith(("http://", "https://", "rtsp://")):
        try:
            if needs_resolution(video_url):
                direct = resolve(video_url)
                print(f"[+] Resolved direct media stream URL: {direct[:80]}...", flush=True)
                cap = cv2.VideoCapture(direct, cv2.CAP_FFMPEG)
                if cap.isOpened():
                    return cap, video_url
            else:
                print(f"[+] Connecting to camera stream: {video_url}", flush=True)
                cap = cv2.VideoCapture(video_url, cv2.CAP_FFMPEG)
                if cap.isOpened():
                    return cap, video_url
        except Exception as e:
            print(f"[!] Online stream resolution notice: {e}", flush=True)

    # Fallback to Axis snapshot
    if os.path.exists(AXIS_SNAPSHOT):
        print(f"[+] Fallback to Axis Camera Snapshot: {AXIS_SNAPSHOT}", flush=True)
        return ImageStreamCapture(AXIS_SNAPSHOT), AXIS_SNAPSHOT

    return None, "None"


# ==============================================================
# SHARED STATE
# ==============================================================
_state_lock = threading.Lock()
_latest_ai_payload = None
_running = True


# ==============================================================
# PIPELINE B - AI WORKER (~6 FPS, fully independent of video)
# ==============================================================
def _ai_worker_loop(server_url):
    global _latest_ai_payload, _running
    last_processed_id = -1
    ai_session = requests.Session()
    ai_session.headers.update({"Content-Type": "application/json", "Connection": "keep-alive"})

    while _running:
        with _state_lock:
            payload = _latest_ai_payload

        if payload is not None and payload.get("frame_id") != last_processed_id:
            last_processed_id = payload["frame_id"]
            try:
                t0 = time.perf_counter()
                r = ai_session.post(f"{server_url}/api/detect", json=payload, timeout=5)
                t_ms = round((time.perf_counter() - t0) * 1000.0, 1)
                if r.status_code == 200:
                    tel = r.json()
                    dets = tel.get("detections", [])
                    print(
                        f"  [AI {last_processed_id:05d}] FPS:{tel.get('fps', 0)} "
                        f"HTTP:{t_ms}ms Lat:{tel.get('inference_latency_ms', 0)}ms "
                        f"Det:{len(dets)}",
                        flush=True
                    )
                else:
                    print(f"  [AI {last_processed_id:05d}] HTTP {r.status_code}", flush=True)
            except Exception as e:
                print(f"  [AI {last_processed_id:05d}] Error: {e}", flush=True)
        else:
            time.sleep(0.003)


# ==============================================================
# PIPELINE A - VIDEO MJPEG BUFFER WRITER (30 FPS)
# In-process write - zero HTTP overhead
# ==============================================================
def _push_frame_to_mjpeg_buffer(jpeg_bytes):
    """Write JPEG directly to server MJPEG buffer - no HTTP, no latency."""
    try:
        try:
            import app.main as server_main
        except ImportError:
            import server.app.main as server_main  # type: ignore
        with server_main._acap_jpeg_lock:
            server_main._acap_latest_frame_jpeg = jpeg_bytes
    except Exception:
        pass


def run_acap_live_pipeline(video_url=DEFAULT_VIDEO_URL, server_url="http://127.0.0.1:8000"):
    global _latest_ai_payload, _running

    print("==================================================")
    print(" CamAI ACAP - DECOUPLED VIDEO + AI PIPELINE")
    print("==================================================")
    print(f"[*] Video Source: {video_url}")
    print(f"[*] PIPELINE A: Capture -> MJPEG @ 30 FPS  (video)")
    print(f"[*] PIPELINE B: Subsampled -> AWS @ ~6 FPS  (AI)")
    print(f"[*] Dashboard: {server_url}/local/camai_acap/index.html")
    print("==================================================")

    ensure_server_running()

    cap, active_src = get_playable_stream(video_url)
    if not cap or not cap.isOpened():
        print("[!] ERROR: Could not open video stream source.", flush=True)
        return

    src_fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    src_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    src_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    print(f"[+] Source: {src_w}x{src_h} @ {src_fps:.1f} FPS", flush=True)
    print(f"[+] Dashboard: {server_url}/local/camai_acap/index.html\n", flush=True)

    _running = True

    worker_thread = threading.Thread(target=_ai_worker_loop, args=(server_url,), daemon=True)
    worker_thread.start()

    frame_counter = 0
    ai_subsample_counter = 0

    TARGET_FPS = min(src_fps, 30.0)
    FRAME_INTERVAL = 1.0 / TARGET_FPS
    AI_SUBSAMPLE = max(1, round(TARGET_FPS / 6.0))

    fps_window = []
    last_fps_log = time.perf_counter()

    try:
        while True:
            t_start = time.perf_counter()

            ret, frame = cap.read()
            if not ret or frame is None:
                cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                ret, frame = cap.read()
                if not ret or frame is None:
                    cap.release()
                    cap, _ = get_playable_stream(video_url)
                    if cap and cap.isOpened():
                        ret, frame = cap.read()
                if not ret or frame is None:
                    if os.path.exists(LOCAL_IMAGE_FALLBACK):
                        frame = cv2.imread(LOCAL_IMAGE_FALLBACK)
                    else:
                        frame = np.zeros((720, 1280, 3), dtype=np.uint8)

            frame_counter += 1
            ai_subsample_counter += 1

            # PIPELINE A: High-Definition resize + optional Night Vision + encode + push to MJPEG buffer
            h, w = frame.shape[:2]
            tw = 1920 if w >= 1280 else 1280
            th = max(480, int(h * tw / float(w)))
            display = cv2.resize(frame, (tw, th), interpolation=cv2.INTER_CUBIC)

            try:
                try:
                    import app.main as server_main
                except ImportError:
                    import server.app.main as server_main
                if getattr(server_main, "_acap_night_vision_active", False):
                    z_dce = server_main._get_acap_submodels()[0]
                    if z_dce is not None:
                        display, _ = z_dce.enhance(display, force_enable=True)
            except Exception:
                pass

            # High Quality Crystal Clear JPEG Stream (Quality 95)
            _, buf = cv2.imencode('.jpg', display, [cv2.IMWRITE_JPEG_QUALITY, 95])
            _push_frame_to_mjpeg_buffer(buf.tobytes())

            # Log real video FPS every 5 seconds
            now = time.perf_counter()
            fps_window.append(now)
            if len(fps_window) > 90:
                fps_window.pop(0)
            if now - last_fps_log >= 5.0:
                if len(fps_window) > 1:
                    rfps = round((len(fps_window) - 1) / (fps_window[-1] - fps_window[0]), 1)
                    print(f"[VIDEO] Real capture FPS: {rfps} | Frame #{frame_counter}", flush=True)
                last_fps_log = now

            # PIPELINE B: subsampled frames only -> AI worker
            if ai_subsample_counter >= AI_SUBSAMPLE:
                ai_subsample_counter = 0
                _, ai_buf = cv2.imencode('.jpg', display, [cv2.IMWRITE_JPEG_QUALITY, 92])
                with _state_lock:
                    _latest_ai_payload = {
                        "image_b64": base64.b64encode(ai_buf).decode('utf-8'),
                        "frame_id": frame_counter,
                        "camera_id": "axis-cam-01",
                    }

            # Rate-limit to TARGET_FPS
            elapsed = time.perf_counter() - t_start
            sleep_t = FRAME_INTERVAL - elapsed
            if sleep_t > 0.001:
                time.sleep(sleep_t)

    except KeyboardInterrupt:
        print("\n[*] ACAP Engine stopped cleanly.", flush=True)
    finally:
        _running = False
        cap.release()


if __name__ == "__main__":
    url = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_VIDEO_URL
    run_acap_live_pipeline(url)
