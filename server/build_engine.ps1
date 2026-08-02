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
# Timestamped BEFORE the freeze so we can prove the exe below is the one this
# run produced, not a leftover from a previous build.
$buildStart = Get-Date

& $py -m PyInstaller camai-engine.spec --noconfirm --clean

# NOTE: keep this file pure ASCII. npm runs it via Windows PowerShell 5.1,
# which reads .ps1 as ANSI when there is no BOM, so a stray non-ASCII character
# (an em-dash, a curly quote) mangles into garbage and throws a ParserError.
#
# $ErrorActionPreference="Stop" does NOT apply to native commands: `&` returns a
# non-zero exit code without throwing. Without this check a failed (or killed)
# PyInstaller run fell straight through to the Test-Path below, found the STALE
# exe from the last successful build, and printed "SUCCESS" - shipping an
# installer whose engine predates the source changes it was built for. That has
# already bitten this project once: the AGPL swap was fixed in source on 07-16
# but the shipped EXE still carried the old engine until 07-17.
if ($LASTEXITCODE -ne 0) {
    Write-Error "PyInstaller failed with exit code $LASTEXITCODE. The engine was NOT rebuilt."
    exit 1
}

$exe = Join-Path $PSScriptRoot "dist\camai-engine\camai-engine.exe"

# Existence is not freshness. Assert the exe was actually written by THIS run.
if ((Test-Path $exe) -and ((Get-Item $exe).LastWriteTime -lt $buildStart)) {
    $written = (Get-Item $exe).LastWriteTime
    Write-Error "STALE ENGINE: $exe was last written $written, before this build started ($buildStart). PyInstaller produced no new binary - refusing to let a stale engine be packaged."
    exit 1
}

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

    # Helmet (RT-DETR/YOLOv8) + ANPR (plate detector + CRNN OCR) models. Whole
    # folders so the model, its classes.txt/charset.txt sidecars, and any
    # OpenVINO IR travel together. app/ai/helmet.py + plate.py resolve them from
    # a 'helmet'/'plate' folder next to the exe (see their _candidate_dirs). Not
    # fatal if absent: those features log why they can't run and the rest of the
    # engine ships fine. Install them first with prepare_helmet_model.py /
    # prepare_plate_model.py so this build carries them.
    foreach ($feat in @("helmet", "plate")) {
        $src = Join-Path $PSScriptRoot "models\$feat"
        if (Test-Path $src) {
            Copy-Item -Recurse -Force $src (Join-Path $PSScriptRoot "dist\camai-engine\")
            Write-Host "==> Bundled $feat models"
        } else {
            Write-Warning "models\$feat missing - $feat detection will be unavailable in this build. Install it with prepare_${feat}_model.py"
        }
    }

    # desktop/package.json's extraResources ships engine/camai-engine.zip, NOT
    # the dist\camai-engine\ folder above - electron-builder never reads that
    # folder directly. Zipping it here, every run, is what makes "rebuild the
    # engine" and "the installer ships the new engine" the same statement.
    #
    # Before this, the zip was a separate manual step nobody scripted, so a
    # source fix (rebuilt exe, fresh LastWriteTime, passes the staleness check
    # above) could still ship inside an installer carrying whatever zip was
    # last made by hand - silently. That is the exact AGPL-swap incident from
    # 07-16/07-17 (fixed in source one day, shipped in the exe the next)
    # repeating in a new spot; zipping unconditionally here closes it for good
    # instead of relying on whoever packages a release to remember.
    Write-Host "==> Zipping engine to dist\camai-engine.zip..."
    $zipPath = Join-Path $PSScriptRoot "dist\camai-engine.zip"
    if (Test-Path $zipPath) { Remove-Item -Force $zipPath }
    Compress-Archive -Path (Join-Path $PSScriptRoot "dist\camai-engine\*") -DestinationPath $zipPath -CompressionLevel Optimal
    Write-Host "==> SUCCESS: $exe" -ForegroundColor Green
    Write-Host "==> SUCCESS: $zipPath" -ForegroundColor Green
} else {
    Write-Error "Build finished but $exe was not produced."
    exit 1
}
