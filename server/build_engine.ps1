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
    Write-Host "==> Copying default model files into dist\camai-engine..."
    Copy-Item (Join-Path $PSScriptRoot "yolo11n-seg.pt") (Join-Path $PSScriptRoot "dist\camai-engine\") -Force
    Copy-Item (Join-Path $PSScriptRoot "yolo11n-seg.onnx") (Join-Path $PSScriptRoot "dist\camai-engine\") -Force
    Copy-Item -Recurse (Join-Path $PSScriptRoot "yolo11n-seg_openvino_model") (Join-Path $PSScriptRoot "dist\camai-engine\") -Force

    Write-Host "==> SUCCESS: $exe" -ForegroundColor Green
} else {
    Write-Error "Build finished but $exe was not produced."
    exit 1
}
