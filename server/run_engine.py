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

Run directly during development with ``python run_engine.py`` — behaves the
same as the module entry, just without uvicorn reload.
"""
from __future__ import annotations

import multiprocessing
import os
import sys


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

    import uvicorn
    from app.main import app
    from app.config import HOST, PORT

    print(f"[engine] Starting CamAI AI Engine on {HOST}:{PORT} "
          f"(frozen={getattr(sys, 'frozen', False)})", flush=True)
    uvicorn.run(app, host=HOST, port=PORT, log_level="info", workers=1)


if __name__ == "__main__":
    main()
