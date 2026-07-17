# Builds the standalone CamAI AI engine (camai-engine.exe) with PyInstaller.
#
# Run once on the BUILD machine (needs Python 3.11 + internet the first time):
#   pwsh -ExecutionPolicy Bypass -File server/build_engine.ps1
#
# Output: server/dist/camai-engine/camai-engine.exe  (+ its DLLs/data)
# electron-builder then ships that folder as resources/engine/ (see
# desktop/package.json build.extraResources).
#
# NOTE: torch + opencv + onnxruntime make this bundle large (multiple GB) and
# the build needs plenty of free disk + temp space. Prefer a drive with 30+ GB
# free. This is a one-time packaging step, not something end users ever run.
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host "==> Using Python:" (python --version)

# Isolated build venv so PyInstaller + deps don't pollute the system env.
if (-not (Test-Path ".venv-build")) {
    Write-Host "==> Creating build venv (.venv-build)"
    python -m venv .venv-build
}
$py = Join-Path $PSScriptRoot ".venv-build\Scripts\python.exe"

Write-Host "==> Installing engine requirements + PyInstaller"
& $py -m pip install --upgrade pip
& $py -m pip install -r server-requirements.txt
& $py -m pip install pyinstaller

Write-Host "==> Freezing engine with PyInstaller"
& $py -m PyInstaller camai-engine.spec --noconfirm --clean

$exe = Join-Path $PSScriptRoot "dist\camai-engine\camai-engine.exe"
if (Test-Path $exe) {
    # Ship the default (Fast tier) detector only — the heavier tiers are
    # fetched/exported on demand via export_models.py. No .pt is copied: the
    # engine never loads PyTorch checkpoints, so shipping one would bloat the
    # installer with a file nothing reads.
    Write-Host "==> Copying default model files into dist\camai-engine..."
    $modelBase = "yolox_tiny"
    foreach ($item in @("$modelBase.onnx", "${modelBase}_openvino_model")) {
        $src = Join-Path $PSScriptRoot $item
        if (-not (Test-Path $src)) {
            Write-Error "Missing model artifact '$item'. Run: python export_models.py $modelBase"
            exit 1
        }
        Copy-Item -Recurse -Force $src (Join-Path $PSScriptRoot "dist\camai-engine\")
    }

    # YuNet face detector (MIT — see fetch_face_models.py). Only ~230 KB, and
    # nothing loads it unless a camera enables face_detection, so it costs the
    # installer almost nothing and costs runtime exactly zero when unused.
    # Not fatal if absent: the engine logs why face detection can't run rather
    # than failing the whole build.
    $faceModel = Join-Path $PSScriptRoot "models_face\face_detection_yunet_2023mar.onnx"
    if (Test-Path $faceModel) {
        Copy-Item -Force $faceModel (Join-Path $PSScriptRoot "dist\camai-engine\")
        Write-Host "==> Bundled YuNet face detector (MIT)"
    } else {
        Write-Warning "face_detection_yunet_2023mar.onnx missing - face detection will be unavailable in this build. Run: python fetch_face_models.py"
    }

    Write-Host "==> SUCCESS: $exe" -ForegroundColor Green
} else {
    Write-Error "Build finished but $exe was not produced."
    exit 1
}
