"""Frozen-engine entry point.

This is the script PyInstaller freezes into ``camai-engine.exe`` so the
desktop app can ship a self-contained AI engine — no system Python, no venv,
no ``pip install``. It differs from ``python -m app.main`` in two ways that
matter under a frozen build:

1. It passes the FastAPI ``app`` *object* to uvicorn instead of the import
   string ``"app.main:app"``. Uvicorn's string form re-imports the module in
   a way that is fragile inside a PyInstaller bundle; the object form is not.
2. It calls ``multiprocessing.freeze_support()`` first. Several dependencies
   (torch DataLoader workers, uvicorn's own tooling) may spawn child
   processes; without this a frozen Windows exe would re-launch the whole app
   recursively instead of starting a worker.

Startup is deliberately defensive: the desktop supervisor (engineSupervisor.ts)
restarts this process on exit and pauses after repeated fast crashes. So the
single worst failure mode is a *silent* early exit — the operator sees only
"Engine crashed 3 times in the last minute" with no cause. Everything below
exists to make that impossible: every startup step is checked, logged with a
[OK]/[FAIL] marker, and any exception is written in full (with traceback) to
both stdout AND a persistent file under %APPDATA%/CamAI, before a distinct,
documented exit code.

Run directly during development with ``python run_engine.py``.
"""
from __future__ import annotations

import multiprocessing
import os
import sys
import socket
import traceback
from datetime import datetime


# Distinct exit codes so the supervisor log makes the failure class obvious.
EXIT_OK_ANOTHER_ENGINE = 0   # a healthy engine already owns the port; nothing to do
EXIT_PORT_CONFLICT = 3       # port held by a foreign process — cannot serve
EXIT_STARTUP_FAILURE = 4     # an exception before/while serving (traceback logged)


def _startup_log_path() -> str:
    """A persistent, always-writable log file for startup diagnostics. Unlike
    stdout (which the frozen console may drop, or which scrolls away), this
    survives a crash so the operator/support can read exactly why the engine
    died."""
    base = os.getenv("APPDATA") or os.getenv("USERPROFILE") or os.path.expanduser("~")
    d = os.path.join(base, "CamAI")
    try:
        os.makedirs(d, exist_ok=True)
    except Exception:
        d = os.path.dirname(os.path.abspath(sys.argv[0])) or "."
    return os.path.join(d, "engine-startup.log")


_LOG_FILE = None


def log(msg: str) -> None:
    """Write to stdout (for the supervisor's live log pipe) AND the persistent
    startup log. Never raises — logging must not be able to crash startup."""
    line = f"[engine] {datetime.now().isoformat(timespec='seconds')} {msg}"
    try:
        print(line, flush=True)
    except Exception:
        pass
    global _LOG_FILE
    try:
        if _LOG_FILE is None:
            _LOG_FILE = open(_startup_log_path(), "a", encoding="utf-8", errors="replace")
        _LOG_FILE.write(line + "\n")
        _LOG_FILE.flush()
    except Exception:
        pass


def check(name: str, ok: bool, detail: str = "") -> bool:
    """Log one startup-validation line with an [OK]/[FAIL] marker."""
    log(f"  [{'OK' if ok else 'FAIL'}] {name}" + (f" — {detail}" if detail else ""))
    return ok


def _port_free(host: str, port: int) -> bool:
    """True if we can bind host:port right now (i.e. it's free for uvicorn)."""
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 0)
        s.bind((host, port))
        return True
    except OSError:
        return False
    finally:
        s.close()


def _existing_engine_healthy(host: str, port: int) -> bool:
    """True if something on host:port answers our /health endpoint 200 — i.e.
    a CamAI engine is already running there and we should not fight it."""
    try:
        import urllib.request
        with urllib.request.urlopen(f"http://{host}:{port}/health", timeout=2.0) as r:
            return r.status == 200
    except Exception:
        return False


def _preflight() -> tuple[str, int]:
    """Run all synchronous startup checks and return (HOST, PORT).

    Raises SystemExit (with a logged reason + distinct code) on a condition
    that genuinely prevents serving — never lets the process die without a
    written explanation. Model *loading* and inference readiness happen
    asynchronously after this and are reported via /health; here we validate
    only what must be true before we even start the server.
    """
    log("==== CamAI AI Engine startup validation ====")
    log(f"frozen={getattr(sys, 'frozen', False)} exe={sys.executable} cwd={os.getcwd()}")

    # 1. Runtime available — at least one inference backend must import.
    backends = []
    try:
        import openvino  # noqa: F401
        backends.append("openvino")
    except Exception as e:
        log(f"  (openvino import failed: {e})")
    try:
        import onnxruntime  # noqa: F401
        backends.append("onnxruntime")
    except Exception as e:
        log(f"  (onnxruntime import failed: {e})")
    check("Runtime available", bool(backends), f"backends={backends or 'NONE'}")
    if not backends:
        log("[FAIL] No inference runtime (openvino/onnxruntime) could be imported — "
            "the bundle is missing native DLLs. Reinstall the application.")
        raise SystemExit(EXIT_STARTUP_FAILURE)

    # 2. Core imports (camera module, config, app). A missing DLL / bad bundle
    #    surfaces here as an import error with a full traceback, not a silent die.
    from app.config import HOST, PORT, MODELS_DIR, YOLO_MODEL, BASE_DIR
    check("Camera module initialized", True, "app.* imported")

    # 3. Model found — locate the default model in any of the search dirs the
    #    backend will use. (Absence is NOT fatal here: the engine still starts
    #    and reports the precise reason via /health rather than crash-looping.)
    base_name = os.path.splitext(os.path.basename(YOLO_MODEL))[0]
    search_dirs = [os.getcwd(), str(MODELS_DIR), str(BASE_DIR)]
    if getattr(sys, "frozen", False):
        search_dirs.append(os.path.dirname(sys.executable))
        if hasattr(sys, "_MEIPASS"):
            search_dirs.append(sys._MEIPASS)
    found = None
    for d in search_dirs:
        for cand in (os.path.join(d, YOLO_MODEL),
                     os.path.join(d, f"{base_name}.onnx"),
                     os.path.join(d, f"{base_name}_openvino_model", f"{base_name}.xml")):
            if os.path.exists(cand):
                found = cand
                break
        if found:
            break
    check("Model found", found is not None, found or f"none of {YOLO_MODEL}/.onnx/openvino in {search_dirs}")

    # 4. Port / IPC — the loopback HTTP server IS the IPC channel to the desktop
    #    app. A port conflict is THE classic crash-loop cause, so handle it
    #    explicitly instead of letting uvicorn die with a bind error.
    if not _port_free(HOST, PORT):
        if _existing_engine_healthy(HOST, PORT):
            check("IPC port", True, f"{HOST}:{PORT} already served by a healthy CamAI engine")
            log("Another CamAI engine is already running and healthy — exiting cleanly "
                "so the supervisor adopts it (this is not a crash).")
            raise SystemExit(EXIT_OK_ANOTHER_ENGINE)
        check("IPC port", False, f"{HOST}:{PORT} is held by another (non-CamAI) process")
        log(f"[FAIL] Cannot bind {HOST}:{PORT} — another application is using it. "
            f"Close it (or set CAMAI_PORT) and restart. Not retrying into a bind loop.")
        raise SystemExit(EXIT_PORT_CONFLICT)
    check("IPC port", True, f"{HOST}:{PORT} is free")

    log(f"Preflight OK — starting server on {HOST}:{PORT}. "
        f"Model load + inference readiness will be reported by /health.")
    return HOST, PORT


def main() -> None:
    multiprocessing.freeze_support()

    # Force UTF-8 (never-failing) stdout/stderr. In the frozen Windows EXE the
    # console defaults to a legacy code page (cp1252), so a single print()
    # containing any non-ASCII byte — a unicode camera name, an RTSP URL with
    # accented chars, a status glyph in a log line — raises UnicodeEncodeError.
    # Because model/camera startup runs inside a background task, that error
    # would silently abort model loading and leave the engine with no cameras.
    # errors="replace" guarantees a log line can never crash the engine.
    for _stream in (sys.stdout, sys.stderr):
        try:
            _stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass

    # Mark the process as the frozen engine so app code can branch on it
    # (e.g. skip dev-only file watching, resolve bundled model paths).
    os.environ.setdefault("CAMAI_FROZEN", "1")

    # When frozen, PyInstaller sets sys.frozen and sys._MEIPASS. Make the
    # bundle root importable so ``import app...`` resolves to the packaged
    # package rather than anything on a stray PYTHONPATH.
    if getattr(sys, "frozen", False):
        base = getattr(sys, "_MEIPASS", os.path.dirname(sys.executable))
        if base not in sys.path:
            sys.path.insert(0, base)

    try:
        host, port = _preflight()
    except SystemExit:
        # Already logged with a distinct code — re-raise so the process exits
        # with it (the supervisor reads the code) rather than swallowing it.
        raise
    except BaseException:
        log("[FAIL] Unhandled exception during preflight:\n" + traceback.format_exc())
        raise SystemExit(EXIT_STARTUP_FAILURE)

    try:
        import uvicorn
        from app.main import app
        log(f"Serving. force_cpu={os.getenv('CAMAI_FORCE_CPU', '')!r}")
        uvicorn.run(app, host=host, port=port, log_level="info", workers=1)
    except SystemExit:
        raise
    except BaseException:
        # uvicorn.run() raises on a late bind failure or any fatal server error.
        # Log the full traceback so the cause is never a mystery, then exit with
        # the startup-failure code.
        log("[FAIL] Engine terminated with an exception:\n" + traceback.format_exc())
        raise SystemExit(EXIT_STARTUP_FAILURE)


if __name__ == "__main__":
    main()
