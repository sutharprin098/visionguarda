"""Structured health / introspection endpoints for the desktop supervisor.

The desktop app (desktop/electron/engineSupervisor.ts + the Engine Health
panel) continuously polls these to drive the "Engine Starting → Ready", model,
camera, hardware and performance indicators. They are deliberately cheap,
never raise, and are safe to hit many times per second.

Mounted at the application root (not under /api) per the deployment spec:
  GET /health       liveness + readiness summary
  GET /models       loaded + selectable models
  GET /cameras      registered cameras and their live status
  GET /system       detected hardware (CPU / GPU / CUDA / RAM / OS)
  GET /performance   aggregate FPS / latency / CPU / GPU / memory
"""
from __future__ import annotations

import platform
import time

from fastapi import APIRouter

from app.camera_manager import manager
from app.gpu_monitor import get_gpu_usage

router = APIRouter(tags=["health"])

# Process start time for uptime. Imported lazily so this module has no import
# cycle with app.main (which includes this router).
_START = time.time()

try:
    import psutil  # noqa
    _PROC = psutil.Process()
    _PROC.cpu_percent(interval=None)  # prime (first call always returns 0.0)
except Exception:  # pragma: no cover - psutil always present in the bundle
    psutil = None
    _PROC = None


def _device() -> str:
    """Device the AI backend actually loaded on.

    Read from the live backend rather than probed via torch: torch is not a
    runtime dependency, so the old torch probe always fell through to "cpu"
    and reported CPU even when OpenVINO had the model on an Intel GPU.
    """
    backend = getattr(manager, "yolo_backend", None)
    device = getattr(backend, "backend_device", None) if backend else None
    return device.lower() if device else "cpu"


def _proc_metrics() -> tuple[float, float]:
    if _PROC is None:
        return 0.0, 0.0
    try:
        return round(_PROC.cpu_percent(interval=None), 1), round(_PROC.memory_info().rss / (1024 * 1024), 1)
    except Exception:
        return 0.0, 0.0


@router.get("/health")
def health():
    """Liveness + readiness. `ready` is true whenever the service is operational.
    In cloud mode, local model status does NOT affect readiness or camera health.
    """
    from app import config
    from app.runtime_governor import runtime_governor, RuntimeState

    is_cloud = getattr(config, "INFERENCE_MODE", "local").strip().lower() == "cloud"
    local_loaded = manager.yolo_model is not None
    
    local_state = "disabled" if is_cloud else ("active" if manager.startup_status == "ready" and local_loaded else manager.startup_status)
    cloud_state = "active" if is_cloud and runtime_governor.state == RuntimeState.CLOUD_ACTIVE else ("disabled" if not is_cloud else "error")

    ready = True if is_cloud else (manager.startup_status == "ready" and local_loaded)

    return {
        "status": "ok",
        "ready": ready,
        "mode": "cloud" if is_cloud else "local",
        "processing_mode": "cloud" if is_cloud else "local",
        "runtime_state": runtime_governor.state,
        "engine_status": "disabled" if is_cloud else manager.startup_status,
        "engine_error": runtime_governor.last_error if is_cloud else (runtime_governor.last_error or manager.startup_error),
        "local_engine_state": local_state,
        "cloud_engine_state": cloud_state,
        "uptime_secs": round(time.time() - _START),
        "model_loaded": local_loaded,
        "active_cameras": sum(1 for t in manager.camera_threads.values() if t.running and getattr(t, "_health_status", "") == "online"),
    }


@router.get("/models")
def models():
    """Active model + the built-in selectable set. The desktop Model Manager
    layers downloaded/assigned models on top of this via Supabase."""
    return {
        "active": manager.selected_model_name,
        "loaded": manager.yolo_model is not None,
        "builtin": ["yolox_tiny", "yolox_s", "yolox_m"],
        "device": _device(),
    }


@router.get("/cameras")
def cameras():
    """Every camera thread the engine currently supervises + live state."""
    out = []
    for cam_id, thread in manager.camera_threads.items():
        out.append({
            "id": cam_id,
            "name": thread.name,
            "running": thread.running,
            "health_status": getattr(thread, "_health_status", "unknown"),
            "resolution": getattr(thread, "_last_resolution", ""),
            "fps": thread.latest_telemetry.get("fps", 0),
            "recording": getattr(thread, "recorder", None) is not None
            and thread.recorder.continuous_writer is not None,
        })
    return {"count": len(out), "cameras": out}


@router.get("/system")
def system():
    """Detected hardware for the auto model-selection / dashboard."""
    gpu_name = None
    cuda = None
    vram_mb = None
    try:
        import torch
        if torch.cuda.is_available():
            gpu_name = torch.cuda.get_device_name(0)
            cuda = torch.version.cuda
            props = torch.cuda.get_device_properties(0)
            vram_mb = round(props.total_memory / (1024 * 1024))
    except Exception:
        pass

    ram_mb = None
    cores = None
    if psutil is not None:
        try:
            ram_mb = round(psutil.virtual_memory().total / (1024 * 1024))
            cores = psutil.cpu_count(logical=True)
        except Exception:
            pass

    return {
        "os": f"{platform.system()} {platform.release()}",
        "os_version": platform.version(),
        "cpu": platform.processor() or platform.machine(),
        "cpu_cores": cores,
        "ram_mb": ram_mb,
        "gpu": gpu_name,
        "cuda": cuda,
        "vram_mb": vram_mb,
        "device": _device(),
    }


@router.get("/performance")
def performance():
    """Aggregate live performance for the dashboard gauges."""
    from app import config
    is_cloud = getattr(config, "INFERENCE_MODE", "local").strip().lower() == "cloud"
    running = [t for t in manager.camera_threads.values() if t.running]
    online_cams = [t for t in running if getattr(t, "_health_status", "") == "online"]
    target_cams = online_cams if online_cams else running

    if is_cloud:
        avg_fps = 0.0
        avg_latency = 0.0
        cpu, mem = 0.0, 0.0
        gpu = 0
        device = "AWS Cloud GPU Node"
    else:
        avg_fps = round(sum(t.latest_telemetry.get("fps", 0) for t in target_cams) / len(target_cams), 1) if target_cams else 0.0
        avg_latency = round(sum(t.latest_telemetry.get("latency", 0) for t in target_cams) / len(target_cams), 1) if target_cams else 0.0
        cpu, mem = _proc_metrics()
        gpu = get_gpu_usage()
        device = _device()

    return {
        "avg_fps": avg_fps,
        "avg_latency_ms": avg_latency,
        "cpu_percent": cpu,
        "memory_mb": mem,
        "gpu_percent": gpu,
        "active_cameras": len(online_cams),
        "device": device,
        "processing_mode": "cloud" if is_cloud else "local",
    }
