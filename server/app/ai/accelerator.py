"""Central accelerator detection, fail-loud CPU-fallback guard, and a runnable
GPU/CUDA validation report.

This is the single source of truth behind the "UI says Hardware Accelerated
(GPU) but GPU utilisation is 0%" incident. Two jobs:

  1. guard_cpu_fallback(component, device) — called right after every model
     loads. It logs loudly whenever a model ends up on CPU, and (only when
     CAMAI_REQUIRE_GPU is set AND the box actually has an accelerator that
     should have been used) raises to abort startup instead of silently
     crawling at CPU speed. It deliberately does NOT abort on an honestly
     accelerator-less machine, so Intel/AMD deployments never brick.

  2. `python -m app.ai.accelerator` — prints a full validation report of every
     CUDA / accelerator component the task asks about (driver, toolkit, cuDNN,
     TensorRT, ORT-GPU, OpenVINO, OpenCV-CUDA, PyTorch-CUDA), with a verdict.

Everything here is best-effort and import-guarded: missing runtimes report
"absent", never crash the caller.
"""
from __future__ import annotations

import os
import shutil
import subprocess

_NOWINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)

# ONNX Runtime execution providers that represent a real hardware accelerator.
GPU_ORT_PROVIDERS = (
    "TensorrtExecutionProvider",
    "CUDAExecutionProvider",
    "DmlExecutionProvider",
    "ROCMExecutionProvider",
    "OpenVINOExecutionProvider",
)


# ---------------------------------------------------------------- ONNX Runtime
def ort_providers() -> list[str]:
    try:
        import onnxruntime as ort
        return list(ort.get_available_providers())
    except Exception:
        return []


def ort_version() -> str | None:
    try:
        import onnxruntime as ort
        return ort.__version__
    except Exception:
        return None


def ort_has_gpu() -> bool:
    avail = set(ort_providers())
    return any(p in avail for p in GPU_ORT_PROVIDERS)


# -------------------------------------------------------------------- OpenVINO
def openvino_devices() -> list[str]:
    # Goes through backend's shared Core rather than building one here: a fresh
    # ov.Core().available_devices re-enumerates every plugin and measured ~3 s
    # on this machine's Intel iGPU, and this helper is called from status/report
    # paths that have no reason to pay it again.
    try:
        from app.ai.backend import ov_available_devices
        return ov_available_devices()
    except Exception:
        try:
            import openvino as ov
            return list(ov.Core().available_devices)
        except Exception:
            return []


def openvino_has_gpu() -> bool:
    return any(d.upper().startswith("GPU") for d in openvino_devices())


# ---------------------------------------------------------------------- OpenCV
def opencv_cuda_count() -> int:
    try:
        import cv2
        return int(cv2.cuda.getCudaEnabledDeviceCount())
    except Exception:
        return 0


# --------------------------------------------------------------------- NVIDIA
def nvidia_smi_path() -> str | None:
    return shutil.which("nvidia-smi")


def nvidia_gpu_names() -> list[str]:
    exe = nvidia_smi_path()
    if not exe:
        return []
    try:
        out = subprocess.run(
            [exe, "--query-gpu=name", "--format=csv,noheader"],
            capture_output=True, text=True, timeout=5.0, creationflags=_NOWINDOW,
        )
        if out.returncode != 0:
            return []
        return [ln.strip() for ln in out.stdout.splitlines() if ln.strip()]
    except Exception:
        return []


def has_nvidia_gpu() -> bool:
    return bool(nvidia_gpu_names())


# ----------------------------------------------------------------------- Torch
def torch_cuda() -> tuple[bool, str | None]:
    try:
        import torch
        return bool(torch.cuda.is_available()), torch.__version__
    except Exception:
        return False, None


# ---------------------------------------------------------------- aggregate API
def any_accelerator() -> bool:
    """True if ANY genuine inference accelerator is usable on this machine:
    an NVIDIA GPU exposed through ORT (CUDA/TensorRT/DML) or an OpenVINO GPU
    (Intel/Arc iGPU or dGPU) or an OpenCV-CUDA device. CPU-only => False."""
    return ort_has_gpu() or openvino_has_gpu() or opencv_cuda_count() > 0


def is_gpu_device(device: str | None) -> bool:
    """Does this backend_device string denote GPU execution rather than CPU?"""
    d = (device or "").upper()
    if "CPU" in d and not any(k in d for k in ("GPU", "CUDA", "TRT", "TENSORRT", "DML", "ROCM")):
        return False
    return any(k in d for k in ("CUDA", "TENSORRT", "TRT", "DIRECTML", "DML", "GPU", "ROCM"))


def guard_cpu_fallback(component: str, device: str | None, *, log=print) -> None:
    """Fail-loud when `component` ended up on CPU.

    - GPU device -> one confirmation line, done.
    - CPU device -> always WARN. Raise ONLY when CAMAI_REQUIRE_GPU is set,
      so an intentional CPU deployment is never aborted, while an NVIDIA box
      that silently lost its CUDA EP fails at startup instead of at 7 FPS.
    """
    if is_gpu_device(device):
        log(f"[Accelerator] [OK] {component}: executing on '{device}'.")
        return

    accel = any_accelerator()
    if accel:
        log(f"[Accelerator] [WARN] {component} FELL BACK TO CPU (device='{device}') "
            f"while a GPU accelerator IS present - this is a silent CPU fallback. "
            f"ORT providers={ort_providers()} OpenVINO={openvino_devices()}.")
    else:
        log(f"[Accelerator] [WARN] {component} is on CPU (device='{device}') - "
            f"no GPU accelerator exists on this machine.")

    try:
        from app import config
        require = getattr(config, "REQUIRE_GPU", False)
    except Exception:
        require = os.getenv("CAMAI_REQUIRE_GPU", "").strip().lower() in ("1", "true", "yes", "on")

    if require:
        raise RuntimeError(
            f"CAMAI_REQUIRE_GPU is set but '{component}' fell back to CPU "
            f"(device='{device}'). Refusing to start a CPU-only pipeline. "
            f"ORT providers={ort_providers()}, OpenVINO devices={openvino_devices()}, "
            f"NVIDIA={nvidia_gpu_names() or 'none'}."
        )


# ----------------------------------------------------------- validation report
def _row(label: str, status: str, detail: str = "") -> str:
    return f"  {label:<26} {status:<14} {detail}"


def validation_report() -> str:
    lines: list[str] = []
    L = lines.append
    L("=" * 78)
    L("  CamAI - GPU / CUDA VALIDATION REPORT")
    L("=" * 78)

    nv = nvidia_gpu_names()
    ov_dev = openvino_devices()
    ov_gpu = openvino_has_gpu()
    providers = ort_providers()
    ort_gpu = ort_has_gpu()
    cv_cuda = opencv_cuda_count()
    torch_ok, torch_ver = torch_cuda()

    L("")
    L("  [ NVIDIA / CUDA STACK ]")
    L(_row("NVIDIA GPU", "PRESENT" if nv else "ABSENT", ", ".join(nv) or "no nvidia-smi"))
    L(_row("NVIDIA driver", "OK" if nvidia_smi_path() else "N/A", nvidia_smi_path() or "nvidia-smi not found"))
    L(_row("CUDA (ORT EP)", "OK" if "CUDAExecutionProvider" in providers else "ABSENT",
           "CUDAExecutionProvider" if "CUDAExecutionProvider" in providers else "not in ORT providers"))
    L(_row("TensorRT (ORT EP)", "OK" if "TensorrtExecutionProvider" in providers else "ABSENT",
           "TensorrtExecutionProvider" if "TensorrtExecutionProvider" in providers else "not in ORT providers"))
    L(_row("PyTorch CUDA", "OK" if torch_ok else "ABSENT",
           f"torch {torch_ver}" if torch_ver else "torch not installed"))
    L(_row("OpenCV CUDA", "OK" if cv_cuda else "ABSENT", f"{cv_cuda} device(s)"))

    L("")
    L("  [ CROSS-VENDOR ACCELERATION ]")
    L(_row("ONNX Runtime", "OK" if ort_version() else "ABSENT", f"v{ort_version()}" if ort_version() else ""))
    L(_row("ORT providers", "-", ", ".join(providers) or "none"))
    L(_row("ORT has GPU EP", "YES" if ort_gpu else "NO",
           ", ".join(p for p in GPU_ORT_PROVIDERS if p in providers) or "CPU-only build"))
    L(_row("DirectML (ORT EP)", "OK" if "DmlExecutionProvider" in providers else "ABSENT",
           "runs ONNX on any DX12 GPU incl. Intel iGPU" if "DmlExecutionProvider" not in providers else "available"))
    L(_row("OpenVINO", "OK" if ov_dev else "ABSENT", ", ".join(ov_dev) or "not installed"))
    L(_row("OpenVINO GPU", "YES" if ov_gpu else "NO",
           next((d for d in ov_dev if d.upper().startswith("GPU")), "no GPU device")))

    L("")
    L("  [ VERDICT ]")
    if has_nvidia_gpu() and ort_gpu:
        L("  [PASS] NVIDIA + GPU execution providers available - CUDA/TensorRT path usable.")
    elif ov_gpu or ("DmlExecutionProvider" in providers):
        L("  [INFO] No NVIDIA GPU. Acceleration available via " +
          ("OpenVINO-GPU (Intel/Arc iGPU) " if ov_gpu else "") +
          ("+ DirectML" if "DmlExecutionProvider" in providers else "") + ".")
        L("    CUDA / cuDNN / TensorRT / onnxruntime-gpu / torch-cuda are NOT applicable")
        L("    on this hardware - they require an NVIDIA GPU that is not present.")
        if ov_gpu and "DmlExecutionProvider" not in providers:
            L("    TIP: `pip install onnxruntime-directml` to move the secondary ONNX")
            L("    models (helmet/ANPR/OCR) off the CPU and onto the Intel iGPU.")
    else:
        L("  [FAIL] No usable GPU accelerator detected - inference will run on CPU.")
    L("")
    L(f"  any_accelerator() = {any_accelerator()}   CAMAI_REQUIRE_GPU would "
      f"{'ABORT' if not any_accelerator() else 'permit'} a CPU-only start.")
    L("=" * 78)
    return "\n".join(lines)


if __name__ == "__main__":
    print(validation_report())
