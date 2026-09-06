Set-Location $PSScriptRoot
Write-Host "==> Copying all AI models into dist\camai-engine..."

$models = @("yolox_tiny", "yolox_s", "yolox_m")
foreach ($m in $models) {
    $onnx = "$m.onnx"
    $ir = "${m}_openvino_model"
    if (Test-Path $onnx) {
        Copy-Item -Force $onnx "dist\camai-engine\"
        Write-Host "Bundled $onnx"
    }
    if (Test-Path $ir) {
        Copy-Item -Recurse -Force $ir "dist\camai-engine\"
        Write-Host "Bundled $ir"
    }
}

# models_face
$faceDir = "models_face"
if (Test-Path $faceDir) {
    $destFace = "dist\camai-engine\models_face"
    if (-not (Test-Path $destFace)) { New-Item -ItemType Directory -Path $destFace -Force | Out-Null }
    Copy-Item -Recurse -Force "$faceDir\*" $destFace
    Copy-Item -Recurse -Force "$faceDir\*.onnx" "dist\camai-engine\"
    Write-Host "Bundled models_face"
}

# models
$modelsDir = "models"
if (Test-Path $modelsDir) {
    $destModels = "dist\camai-engine\models"
    if (-not (Test-Path $destModels)) { New-Item -ItemType Directory -Path $destModels -Force | Out-Null }
    Copy-Item -Recurse -Force "$modelsDir\*" $destModels
    Copy-Item -Recurse -Force "$modelsDir\helmet" "dist\camai-engine\"
    Copy-Item -Recurse -Force "$modelsDir\plate" "dist\camai-engine\"
    if (Test-Path "$modelsDir\yolov8_visdrone.onnx") {
        Copy-Item -Force "$modelsDir\yolov8_visdrone.onnx" "dist\camai-engine\"
    }
    Write-Host "Bundled models"
}

Write-Host "==> Compressing complete camai-engine.zip..."
$zipPath = "dist\camai-engine.zip"
if (Test-Path $zipPath) { Remove-Item -Force $zipPath }
Compress-Archive -Path "dist\camai-engine\*" -DestinationPath $zipPath -CompressionLevel Optimal
$sizeMB = [math]::round((Get-Item $zipPath).Length / 1MB, 2)
Write-Host "==> SUCCESS: dist\camai-engine.zip size = $sizeMB MB"
