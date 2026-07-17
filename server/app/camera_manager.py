import os
import gc
import time
import threading
import numpy as np
from collections import deque
from app.config import YOLO_MODEL
from app.storage import get_all_cameras, get_camera
from app.ai.backend import EngineBackend
from app.ai.pipeline import PipelineCoordinator

class CameraManager:
    def __init__(self):
        self.yolo_backend = None
        self.camera_threads = {}
        self.selected_model_name = YOLO_MODEL  # Defaults to YOLO_MODEL (yolox_tiny)

        # ── Engine startup state (surfaced via /api/status "engine" block for
        # the desktop's Engine Health panel — model compilation can take
        # tens of seconds to minutes on first run, see load_initial_model) ──
        self.startup_status = "loading"   # "loading" | "ready" | "failed"
        self.startup_error = None
        self.startup_started_at = time.time()
        self.benchmark_results = {
            "status": "running",
            "yolox_tiny": None,
            "yolox_s": None,
            "yolox_m": None,
            "selected": YOLO_MODEL,
            "device": "cpu"
        }
        self.benchmark_thread = None
        self.memory_watchdog_thread = None
        self.telemetry_callback = None

    @property
    def yolo_model(self):
        return self.yolo_backend


    def load_initial_model(self):
        """Load initial model backend synchronously so server starts up instantly."""
        if self.yolo_backend is None:
            self.startup_status = "loading"
            self.startup_error = None
            self.startup_started_at = time.time()
            try:
                print(f"[CameraManager] Loading initial AI backend: {self.selected_model_name}...", flush=True)
                self.yolo_backend = EngineBackend(self.selected_model_name)
                # Warm up
                dummy_img = np.zeros((320, 320, 3), dtype=np.uint8)
                tensor, _ = self.yolo_backend.preprocess(dummy_img, 320)
                self.yolo_backend.run_inference(tensor)
                print(f"[CameraManager] Initial AI backend {self.selected_model_name} loaded successfully.", flush=True)
                self.startup_status = "ready"
            except Exception as e:
                self.startup_status = "failed"
                self.startup_error = str(e)
                raise

    def start_cameras(self):
        # 1. Load default model backend synchronously
        self.load_initial_model()
        
        # 2. Start camera pipeline coordinators
        cameras = get_all_cameras()
        for cam in cameras:
            if cam["is_active"]:
                self.start_camera_thread(cam)
                
        # 3. Launch background benchmarking to test other models
        self.benchmark_thread = threading.Thread(target=self.run_background_benchmark)
        self.benchmark_thread.daemon = True
        self.benchmark_thread.start()

        # 4. Launch continuous memory-growth watchdog
        if self.memory_watchdog_thread is None:
            self.memory_watchdog_thread = threading.Thread(
                target=self.run_memory_watchdog, name="MemWatchdog", daemon=True
            )
            self.memory_watchdog_thread.start()

    def run_memory_watchdog(self):
        """Sample process RSS on a short cadence and keep cyclic garbage bounded.

        Direct measurement on this pipeline showed RSS bursts of 150-250+
        MB/min that a *manual* gc.collect() reliably reclaims in full (freed
        440-877 objects per pass in testing) — proof this is real reference-
        cycle garbage (refcounting alone frees non-cyclic objects instantly;
        only the cycle collector's gc.collect() reaches unreachable cycles),
        not a native/OS-level leak. Likely source: high per-frame allocation
        churn (numpy arrays + dicts threaded through the pipeline slots at
        camera FPS) outruns CPython's generation-2 threshold, so a full
        collection doesn't happen on its own often enough to keep pace.
        Rather than wait to *detect* a trend (which lets RSS balloon by
        hundreds of MB before the first corrective pass), we now run
        gc.collect() unconditionally on a short interval — a full collect
        over this process's object graph (~250-300k objects) costs low tens
        of milliseconds, negligible next to camera-FPS frame processing —
        and only keep the trend log for visibility into how much it's doing.
        """
        try:
            import psutil
        except ImportError:
            return

        proc = psutil.Process(os.getpid())
        samples: deque = deque(maxlen=60)  # ~10 minutes at 10s cadence
        while True:
            time.sleep(10.0)
            rss_before = proc.memory_info().rss / (1024 * 1024)
            samples.append(rss_before)

            collected = gc.collect()

            if collected > 50 or (len(samples) >= 6 and rss_before - samples[-6] > 20.0):
                rss_after = proc.memory_info().rss / (1024 * 1024)
                print(
                    f"[MemWatchdog] gc.collect() freed {collected} objects "
                    f"(RSS {rss_before:.0f} MB -> {rss_after:.0f} MB). "
                    f"Threads: {threading.active_count()}. "
                    f"Stage errors by camera: "
                    f"{ {cid: t._stage_errors for cid, t in self.camera_threads.items()} }",
                    flush=True,
                )

    def run_background_benchmark(self):
        # Wait before benchmarking to avoid GPU contention during pipeline warm-up.
        # OpenVINO model compilation takes ~76s per model — without this delay, all 3
        # benchmark models compile simultaneously with the live pipeline, causing
        # 600-1700ms inference latency on the main stream.
        time.sleep(180)
        print("[CameraManager] Starting background model benchmarking...", flush=True)
        dummy_img = np.zeros((320, 320, 3), dtype=np.uint8)
        models_to_test = {
            "yolox_tiny": "yolox_tiny",
            "yolox_s": "yolox_s",
            "yolox_m": "yolox_m"
        }

        stats = {}

        for name, path in models_to_test.items():
            try:
                print(f"[CameraManager] Benchmarking {name}...", flush=True)
                t0 = time.time()
                backend = EngineBackend(path)
                load_time = time.time() - t0

                avg_latency, std_latency, t_preprocess = backend.benchmark(dummy_img, target_size=320, runs=5)
                stats[name] = {
                    "avg_latency_ms": round(avg_latency, 1),
                    "std_latency_ms": round(std_latency, 1),
                    "load_time_s": round(load_time, 2),
                    "preprocess_ms": round(t_preprocess, 1),
                    "backend": backend.backend_type,
                    "device": backend.backend_device,
                    "status": "success"
                }
                self.benchmark_results[name] = stats[name]
                print(f"[CameraManager] {name} ({backend.backend_type}/{backend.backend_device}) avg latency: {avg_latency:.1f}ms", flush=True)
            except Exception as e:
                print(f"[CameraManager] Failed to benchmark {name}: {e}", flush=True)
                self.benchmark_results[name] = {
                    "status": "failed",
                    "error": str(e)
                }

        selected = "yolox_tiny"
        candidates = [(name, stats[name]["avg_latency_ms"]) for name in stats if stats[name].get("status") == "success"]
        candidates.sort(key=lambda x: x[1])

        for name, latency in candidates:
            if latency <= 120.0:
                selected = name
                break

        if not candidates:
            selected = self.selected_model_name

        print(f"[CameraManager] Benchmark complete. Recommended model based on speed: {selected}", flush=True)
        self.benchmark_results["selected"] = selected
        self.benchmark_results["status"] = "complete"

        try:
            temp_backend = EngineBackend(selected)
            self.benchmark_results["device"] = temp_backend.backend_device
        except Exception:
            self.benchmark_results["device"] = "cpu"

    def hot_swap_model(self, model_name: str) -> bool:
        """Manually trigger model swapping from client/API control."""
        print(f"[CameraManager] Swapping active model backend to: {model_name}", flush=True)
        try:
            if model_name == self.selected_model_name and self.yolo_backend is not None:
                return True
            
            # Load new model backend
            new_backend = EngineBackend(model_name)
            # Warm up
            dummy_img = np.zeros((320, 320, 3), dtype=np.uint8)
            tensor, _ = new_backend.preprocess(dummy_img, 320)
            new_backend.run_inference(tensor)
            
            # Swap active reference under thread-safe lock
            self.yolo_backend = new_backend
            self.selected_model_name = model_name
            
            # Propagate reference to all active pipeline coordinators
            for thread in self.camera_threads.values():
                if hasattr(thread, "backend"):
                    thread.backend = new_backend
            
            print(f"[CameraManager] Active model successfully swapped to {model_name}.", flush=True)
            return True
        except Exception as e:
            print(f"[CameraManager] Failed to swap active model backend to {model_name}: {e}", flush=True)
            return False

    def start_camera_thread(self, cam):
        cam_id = cam["id"]
        if cam_id in self.camera_threads:
            self.stop_camera_thread(cam_id)

        print(f"[CameraManager] Launching camera pipeline thread: {cam['name']}")
        
        # Instantiate PipelineCoordinator instead of old CameraThread
        thread = PipelineCoordinator(
            camera_id=cam_id,
            name=cam["name"],
            source_type=cam["type"],
            source=cam["source"],
            zones_json=cam["zones"],
            lines_json=cam["lines"],
            rules_json=cam.get("rules", "[]"),
            zone_profile=cam.get("zone_profile"),
            profile_features=cam.get("profile_features", "{}"),
            backend_getter=lambda: self.yolo_backend
        )
        
        # Set telemetry callback to push live metrics immediately
        if self.telemetry_callback is not None:
            thread.telemetry_callback = self.telemetry_callback

        # Wire the pipeline's watchdog to this manager so a truly wedged
        # camera (all internal try/except recovery exhausted — see
        # PipelineCoordinator._watchdog_loop) gets torn down and rebuilt
        # from scratch instead of staying frozen for the rest of the process.
        thread.restart_callback = self.restart_camera_thread

        thread.start()
        self.camera_threads[cam_id] = thread

    def stop_camera_thread(self, cam_id):
        if cam_id in self.camera_threads:
            print(f"[CameraManager] Stopping camera pipeline: {cam_id}")
            thread = self.camera_threads[cam_id]
            thread.stop()
            del self.camera_threads[cam_id]

    def restart_camera_thread(self, cam_id: str):
        """Tear down and rebuild a single camera's pipeline from its saved config.

        Called by PipelineCoordinator's watchdog when a stage has stopped
        making progress despite its own internal error recovery.
        """
        print(f"[CameraManager] Restarting stalled camera pipeline: {cam_id}", flush=True)
        cam = get_camera(cam_id)
        if cam and cam.get("is_active"):
            self.start_camera_thread(cam)
        else:
            self.stop_camera_thread(cam_id)

    def restart_cameras(self):
        self.stop_all()
        self.start_cameras()

    def update_camera_analytics_config(self, cam_id: str, zones_json: str, lines_json: str, rules_json: str = "[]", zone_profile: str = None, profile_features: str = "{}"):
        """Update analytics configuration on the fly."""
        if cam_id in self.camera_threads:
            self.camera_threads[cam_id].update_config(zones_json, lines_json, rules_json, zone_profile, profile_features)

    def update_camera_display_config(self, cam_id: str, max_width: int = None, quality: int = None):
        """Update MJPEG preview resolution/quality on the fly (display only)."""
        if cam_id in self.camera_threads:
            self.camera_threads[cam_id].update_display_config(max_width, quality)

    def set_camera_recording(self, cam_id: str, enabled: bool) -> bool:
        """Manually pause/resume continuous recording for a running camera thread."""
        thread = self.camera_threads.get(cam_id)
        if not thread:
            return False
        if enabled:
            thread.recorder.start_continuous()
        else:
            thread.recorder.stop_continuous()
        return True

    def stop_all(self):
        for cam_id in list(self.camera_threads.keys()):
            self.stop_camera_thread(cam_id)
        print("[CameraManager] All camera threads stopped.")


# Global instance
manager = CameraManager()
