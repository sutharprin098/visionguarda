#!/usr/bin/env python3
"""
CamAI ACAP Live Video Stream Runner - SYNCHRONIZED REAL-TIME PIPELINE
====================================================================

Architecture:
  Source -> cap.read() -> display -> in-process AI detection -> 
  simultaneous atomic update of:
    1) _acap_latest_frame_jpeg (MJPEG stream: /local/camai_acap/video.mjpg)
    2) _acap_latest_telemetry (Telemetry: /local/camai_acap/telemetry.json)

Both video and telemetry share the exact same frame_id and timestamp,
guaranteeing ZERO lag between video stream and detection bounding boxes.

Dashboard: http://127.0.0.1:8000/local/camai_acap/index.html
"""
import sys
import os
os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "timeout;3000000|stimeout;3000000|rtsp_transport;tcp|fflags;nobuffer|flags;low_delay|max_delay;500000"
os.environ["CAMAI_INFERENCE_MODE"] = os.getenv("CAMAI_INFERENCE_MODE", "local")
import time
import subprocess
import cv2
import requests
import numpy as np

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
AXIS_CAMERA_STREAM_URL = "http://127.0.0.1/axis-cgi/mjpg/video.cgi"
DEFAULT_VIDEO_URL = AXIS_CAMERA_STREAM_URL
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
    subprocess.Popen(cmd, cwd=SERVER_DIR, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=os.environ.copy())

    for _ in range(25):
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

    if not video_url or video_url == "default":
        video_url = DEFAULT_VIDEO_URL

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

    # Fallback to local video or snapshot
    if os.path.exists(LOCAL_VIDEO_FALLBACK):
        print(f"[+] Fallback to Local Video Demo: {LOCAL_VIDEO_FALLBACK}", flush=True)
        cap = cv2.VideoCapture(LOCAL_VIDEO_FALLBACK)
        if cap.isOpened():
            return cap, LOCAL_VIDEO_FALLBACK

    if os.path.exists(AXIS_SNAPSHOT):
        print(f"[+] Fallback to Axis Camera Snapshot: {AXIS_SNAPSHOT}", flush=True)
        return ImageStreamCapture(AXIS_SNAPSHOT), AXIS_SNAPSHOT

    return None, "None"


def run_acap_live_pipeline(video_url=DEFAULT_VIDEO_URL, server_url="http://127.0.0.1:8000"):
    print("==================================================")
    print(" CamAI ACAP - ZERO-LAG SYNCHRONIZED PIPELINE")
    print("==================================================")
    print(f"[*] Video Source: {video_url}")
    print(f"[*] Mode: Real-time In-Process Inference")
    print(f"[*] Dashboard: {server_url}/local/camai_acap/index.html")
    print("==================================================")

    ensure_server_running()

    # Import server detection engine in-process
    try:
        import app.main as server_main
    except ImportError:
        import server.app.main as server_main

    # Warm up YOLO model
    print("[*] Loading and warming up YOLO inference backend...", flush=True)
    server_main.manager.ensure_backend_loaded()
    print("[+] YOLO backend ready!", flush=True)

    cap, active_src = get_playable_stream(video_url)
    if not cap or not cap.isOpened():
        print("[!] ERROR: Could not open video stream source.", flush=True)
        return

    src_fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    src_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    src_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    print(f"[+] Source: {src_w}x{src_h} @ {src_fps:.1f} FPS", flush=True)

    TARGET_FPS = min(src_fps, 30.0)
    FRAME_INTERVAL = 1.0 / TARGET_FPS

    frame_counter = 0
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

            # Standard display scaling: 1280x720
            h, w = frame.shape[:2]
            tw = 1280
            th = max(480, int(h * tw / float(w)))
            display = cv2.resize(frame, (tw, th), interpolation=cv2.INTER_LINEAR)

            # In-process synchronized frame inference and MJPEG update
            # This updates BOTH _acap_latest_frame_jpeg and _acap_latest_telemetry atomically
            tel = server_main.process_acap_frame_direct(
                img=display,
                req_frame_id=frame_counter,
                camera_id="axis-cam-01",
                publish_mjpeg=True
            )

            # Track rolling FPS
            now = time.perf_counter()
            fps_window.append(now)
            if len(fps_window) > 90:
                fps_window.pop(0)

            if now - last_fps_log >= 3.0:
                if len(fps_window) > 1:
                    rfps = round((len(fps_window) - 1) / (fps_window[-1] - fps_window[0]), 1)
                    lat = tel.get("inference_latency_ms", 0)
                    dets_len = len(tel.get("detections", []))
                    print(f"[LIVE PIPELINE] FPS: {rfps} | Latency: {lat}ms | Detections: {dets_len} | Frame #{frame_counter}", flush=True)
                last_fps_log = now

            # Rate-limit to TARGET_FPS
            elapsed = time.perf_counter() - t_start
            sleep_t = FRAME_INTERVAL - elapsed
            if sleep_t > 0.001:
                time.sleep(sleep_t)

    except KeyboardInterrupt:
        print("\n[*] ACAP Engine stopped cleanly.", flush=True)
    finally:
        cap.release()


if __name__ == "__main__":
    url = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_VIDEO_URL
    run_acap_live_pipeline(url)
