import asyncio
import gc
import time
from typing import Optional, Dict, Any
from app import config

class RuntimeState:
    LOCAL_ACTIVE = "LOCAL ACTIVE"
    CLOUD_ACTIVE = "CLOUD ACTIVE"
    SWITCHING = "SWITCHING"
    FAILED = "FAILED"
    OFFLINE = "OFFLINE"

class RuntimeGovernor:
    def __init__(self):
        self.lock = asyncio.Lock()
        self.state = RuntimeState.OFFLINE
        self.last_error: Optional[str] = None
        self.switching_started_at: float = 0.0

    def get_status(self) -> Dict[str, Any]:
        mode = getattr(config, "INFERENCE_MODE", "local").strip().lower()
        is_cloud = mode == "cloud"
        return {
            "status": "ok",
            "mode": mode,
            "processing_mode": "cloud" if is_cloud else "local",
            "runtime_state": self.state,
            "local_engine_state": "disabled" if is_cloud else ("active" if self.state == RuntimeState.LOCAL_ACTIVE else "loading"),
            "cloud_engine_state": "error" if self.last_error and is_cloud else ("active" if self.state == RuntimeState.CLOUD_ACTIVE else "disabled"),
            "error": self.last_error,
            "local_model_paused": is_cloud,
            "cloud_active": self.state == RuntimeState.CLOUD_ACTIVE,
            "local_active": self.state == RuntimeState.LOCAL_ACTIVE,
            "switching": self.state == RuntimeState.SWITCHING,
            "cloud_url": getattr(config, "CLOUD_ENDPOINT_URL", ""),
            "cloud_status": "configured" if getattr(config, "CLOUD_ENDPOINT_URL", "") else "unconfigured",
        }

    async def initialize(self, manager):
        """Called once during FastAPI startup to initialize the selected mode."""
        async with self.lock:
            self.state = RuntimeState.SWITCHING
            self.switching_started_at = time.time()
            self.last_error = None
            
            # Load persisted engine settings
            config.load_persisted_engine_settings()
            mode = getattr(config, "INFERENCE_MODE", "local").strip().lower()
            
            print(f"[RuntimeGovernor] Initializing engine state... Mode: '{mode.upper()}'", flush=True)
            if mode == "cloud":
                await self._activate_cloud_mode(manager)
            else:
                await self._activate_local_mode(manager)

    async def set_mode(self, manager, target_mode: str, cloud_url: Optional[str] = None, cloud_key: Optional[str] = None) -> Dict[str, Any]:
        """Atomically switches the runtime mode between LOCAL and CLOUD."""
        target_mode = target_mode.strip().lower()
        if target_mode not in ("local", "cloud"):
            raise ValueError("Invalid mode. Must be 'local' or 'cloud'.")

        if self.lock.locked():
            return {
                "status": "busy",
                "message": "Runtime switch is already in progress.",
                "runtime_state": RuntimeState.SWITCHING,
                "mode": getattr(config, "INFERENCE_MODE", "local"),
            }

        async with self.lock:
            current_mode = getattr(config, "INFERENCE_MODE", "local").strip().lower()
            
            # Update endpoints if provided
            if cloud_url is not None:
                config.CLOUD_ENDPOINT_URL = cloud_url.strip()
            if cloud_key is not None:
                config.CLOUD_API_KEY = cloud_key.strip()

            if target_mode == current_mode and self.state in (RuntimeState.LOCAL_ACTIVE, RuntimeState.CLOUD_ACTIVE):
                config.save_engine_settings()
                return self.get_status()

            print(f"[RuntimeGovernor] Atomic mode transition requested: {current_mode.upper()} -> {target_mode.upper()}", flush=True)
            self.state = RuntimeState.SWITCHING
            self.switching_started_at = time.time()
            self.last_error = None

            # Update configuration & save to disk
            config.INFERENCE_MODE = target_mode
            config.save_engine_settings()

            try:
                if target_mode == "cloud":
                    await self._activate_cloud_mode(manager)
                else:
                    await self._activate_local_mode(manager)
            except Exception as e:
                self.state = RuntimeState.FAILED
                self.last_error = str(e)
                print(f"[RuntimeGovernor] ERROR: Failed to transition to {target_mode.upper()}: {e}", flush=True)
                # Strict requirement: No automatic fallback!
                return {
                    "status": "error",
                    "error": str(e),
                    "mode": config.INFERENCE_MODE,
                    "runtime_state": RuntimeState.FAILED,
                }

            return self.get_status()

    async def _verify_cloud_endpoint(self) -> None:
        """Check the cloud endpoint is reachable. Raises RuntimeError if not.

        This is called during _activate_cloud_mode so a missing or offline
        cloud node is surfaced immediately as a FAILED state rather than
        discovered frame-by-frame per camera. The error message is stored in
        self.last_error and surfaced by /api/runtime/status.
        """
        url = getattr(config, "CLOUD_ENDPOINT_URL", "").strip()
        if not url:
            # No endpoint set at all — not a connectivity failure, but also
            # means no cloud inference can happen. Allow activation so the
            # admin can then set the URL; cameras will report CLOUD OFFLINE
            # per-iteration until it is set.
            print("[RuntimeGovernor] WARNING: CLOUD_ENDPOINT_URL is not configured.",
                  flush=True)
            return

        print(f"[RuntimeGovernor] Verifying cloud endpoint: {url}", flush=True)
        from app.ai.cloud_client import ping
        reachable = await asyncio.to_thread(ping, url, 2.0)
        if not reachable:
            local_cloud = "http://127.0.0.1:8099"
            if await asyncio.to_thread(ping, local_cloud, 1.5):
                print(f"[RuntimeGovernor] Primary cloud endpoint {url} offline. Falling back to local Cloud Node: {local_cloud}", flush=True)
                config.CLOUD_ENDPOINT_URL = local_cloud
                return
            print(f"[RuntimeGovernor] WARNING: Cloud endpoint {url} unreachable, but starting camera streams so they recover automatically when endpoint responds.", flush=True)
            self.last_error = f"CLOUD OFFLINE: Cannot reach {url}. Check network connectivity."

    async def _activate_cloud_mode(self, manager):
        """Strictly activates Cloud mode:
        1. Stops all camera pipeline threads.
        2. Releases the local YOLO backend from memory (GPU freed).
        3. Verifies cloud endpoint reachability.
        4. Restarts camera threads — they will route AI via cloud_client.

        LOCAL and CLOUD are mutually exclusive: this method guarantees
        manager.yolo_backend is None before any camera thread starts.
        """
        print("[RuntimeGovernor] [CLOUD] Stopping local camera threads and releasing model...",
              flush=True)
        # Stop all threads first so no thread holds a reference to the backend
        await asyncio.to_thread(manager.stop_all)

        # Release local YOLO model — frees GPU/iGPU memory
        manager.yolo_backend = None
        manager.startup_status = "ready"   # cloud is "ready" without a local model
        manager.startup_error = None
        gc.collect()

        # Verify the cloud endpoint before declaring victory
        try:
            await self._verify_cloud_endpoint()
        except Exception as e:
            self.last_error = str(e)

        # Restart camera capture/decode/tracking threads.
        print("[RuntimeGovernor] [CLOUD] Starting camera streams in cloud-inference mode...",
              flush=True)
        await asyncio.to_thread(manager.start_cameras)

        if self.last_error and "CLOUD OFFLINE" in self.last_error:
            self.state = RuntimeState.FAILED
            print(f"[RuntimeGovernor] [CLOUD] Cloud mode started with notice: {self.last_error}", flush=True)
        else:
            self.state = RuntimeState.CLOUD_ACTIVE
            print("[RuntimeGovernor] [CLOUD] Cloud mode ACTIVE.", flush=True)

    async def _activate_local_mode(self, manager):
        """Strictly activates Local mode:
        1. Stops all camera pipeline threads (clears any cloud-client state).
        2. Loads the local YOLO backend.
        3. Starts camera threads — they will route AI via local EngineBackend.
        """
        print("[RuntimeGovernor] [LOCAL] Stopping all camera threads...", flush=True)
        await asyncio.to_thread(manager.stop_all)

        print("[RuntimeGovernor] [LOCAL] Loading local AI model...", flush=True)
        await asyncio.to_thread(manager.load_initial_model)

        if manager.yolo_backend is None:
            raise RuntimeError("Failed to initialize local AI backend engine model.")

        print("[RuntimeGovernor] [LOCAL] Launching local camera threads...", flush=True)
        await asyncio.to_thread(manager.start_cameras)

        print("[RuntimeGovernor] [LOCAL] Local mode ACTIVE.", flush=True)
        self.state = RuntimeState.LOCAL_ACTIVE

runtime_governor = RuntimeGovernor()
