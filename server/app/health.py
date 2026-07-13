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
    try:
        import torch
        return "cuda" if torch.cuda.is_available() else "cpu"
    except Exception:
        return "cpu"


def _proc_metrics() -> tuple[float, float]:
    if _PROC is None:
        return 0.0, 0.0
    try:
        return round(_PROC.cpu_percent(interval=None), 1), round(_PROC.memory_info().rss / (1024 * 1024), 1)
    except Exception:
        return 0.0, 0.0


@router.get("/health")
def health():
    """Liveness + readiness. `ready` flips true once the AI backend has
    finished its (potentially minutes-long) first-run model compilation."""
    ready = manager.startup_status == "ready" and manager.yolo_model is not None
    return {
        "status": "ok",
        "ready": ready,
        "engine_status": manager.startup_status,
        "engine_error": manager.startup_error,
        "uptime_secs": round(time.time() - _START),
        "model_loaded": manager.yolo_model is not None,
        "active_cameras": sum(1 for t in manager.camera_threads.values() if t.running),
    }


@router.get("/models")
def models():
    """Active model + the built-in selectable set. The desktop Model Manager
    layers downloaded/assigned models on top of this via Supabase."""
    return {
        "active": manager.selected_model_name,
        "loaded": manager.yolo_model is not None,
        "builtin": ["yolo11n-seg.pt", "yolo11s-seg.pt", "yolo11m-seg.pt"],
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
    running = [t for t in manager.camera_threads.values() if t.running]
    avg_fps = round(sum(t.latest_telemetry.get("fps", 0) for t in running) / len(running), 1) if running else 0.0
    avg_latency = round(sum(t.latest_telemetry.get("latency", 0) for t in running) / len(running), 1) if running else 0.0
    cpu, mem = _proc_metrics()
    return {
        "avg_fps": avg_fps,
        "avg_latency_ms": avg_latency,
        "cpu_percent": cpu,
        "memory_mb": mem,
        "gpu_percent": get_gpu_usage(),
        "active_cameras": len(running),
        "device": _device(),
    }
