# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec — freezes the CamAI AI engine into a standalone,
self-contained ``camai-engine.exe`` (onedir) that the Electron desktop app
bundles and launches. No system Python / venv / pip required on the target PC.

Build with:  pyinstaller camai-engine.spec --noconfirm
(or use build_engine.ps1, which installs deps + PyInstaller first.)

onedir (not onefile) is deliberate: opencv / onnxruntime / openvino load
native DLLs that a onefile bundle must unpack to a temp dir on every launch —
slow (tens of seconds) and a frequent source of AV false-positives. onedir
starts fast and is what electron-builder ships as extraResources/engine/.

Note what is NOT bundled: torch, torchvision and ultralytics. Inference runs
entirely on OpenVINO / ONNX Runtime and nothing under app/ imports them, so
collecting them only bloated the installer by gigabytes — and, in
ultralytics' case, shipped an AGPL-3.0 package inside a proprietary binary.
torch remains a dev-only dependency of export_models.py (see LICENSING.md).
"""
from PyInstaller.utils.hooks import collect_all, collect_submodules

datas, binaries, hiddenimports = [], [], []

# Heavy ML / server packages: pull code, data files and dynamic libs.
# Guarded so a missing optional backend (e.g. openvino, tensorrt) doesn't
# abort the whole build — the engine degrades to whatever is installed.
_PACKAGES = [
    "cv2",             # opencv-python
    "onnxruntime",
    "openvino",
    "psutil",
    "fastapi",
    "uvicorn",
    "pydantic",
    "pydantic_core",
    "starlette",
]
for _pkg in _PACKAGES:
    try:
        d, b, h = collect_all(_pkg)
        datas += d
        binaries += b
        hiddenimports += h
    except Exception as _e:  # package not installed — skip it
        print(f"[spec] skipping optional package {_pkg}: {_e}")

# Bundle yt_dlp modules into PYZ bytecode instead of 2000+ loose .py files
hiddenimports += collect_submodules("yt_dlp")

# uvicorn loads its loop/protocol/lifespan implementations by string at
# runtime, so they must be forced in as hidden imports.
hiddenimports += collect_submodules("uvicorn")
hiddenimports += [
    "uvicorn.loops.auto", "uvicorn.loops.asyncio",
    "uvicorn.protocols.http.auto", "uvicorn.protocols.http.h11_impl",
    "uvicorn.protocols.websockets.auto", "uvicorn.protocols.websockets.websockets_impl",
    "uvicorn.lifespan.on", "uvicorn.lifespan.off",
    "anyio._backends._asyncio",
]

# Our own package.
hiddenimports += collect_submodules("app")

block_cipher = None

a = Analysis(
    ["run_engine.py"],
    pathex=["."],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=["tkinter", "matplotlib", "PyQt5", "PySide2", "notebook", "IPython"],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)
pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="camai-engine",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,          # keep a console for engine logs the supervisor pipes
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="camai-engine",   # -> dist/camai-engine/camai-engine.exe
)
