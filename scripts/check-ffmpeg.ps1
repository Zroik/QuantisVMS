# PowerShell script to verify FFmpeg capabilities on Windows host
param (
    [string]$FfmpegBin = "ffmpeg"
)

$ErrorActionPreference = "Stop"

Write-Host "=== Checking FFmpeg Build Capabilities ===" -ForegroundColor Cyan
Write-Host "FFmpeg binary: $(Get-Command $FfmpegBin | Select-Object -ExpandProperty Source)"
& $FfmpegBin -version | Select-Object -First 2

Write-Host "Checking hwaccels for cuda..."
$hwaccels = & $FfmpegBin -hwaccels
if ($hwaccels -match "cuda") {
    Write-Host "  [OK] cuda hwaccel found" -ForegroundColor Green
} else {
    Write-Warning "cuda hwaccel not found"
}

Write-Host "Checking encoders (av1_nvenc, hevc_nvenc)..."
$encoders = & $FfmpegBin -hide_banner -encoders
if ($encoders -match "av1_nvenc") {
    Write-Host "  [OK] av1_nvenc found" -ForegroundColor Green
} else {
    Write-Warning "av1_nvenc missing"
}

if ($encoders -match "hevc_nvenc") {
    Write-Host "  [OK] hevc_nvenc found" -ForegroundColor Green
} else {
    Write-Warning "hevc_nvenc missing"
}

Write-Host "Checking filters (libvmaf, libvmaf_cuda)..."
$filters = & $FfmpegBin -hide_banner -filters
if ($filters -match "\blibvmaf\b") {
    Write-Host "  [OK] libvmaf found (CPU)" -ForegroundColor Green
} else {
    Write-Warning "libvmaf missing"
}

if ($filters -match "\blibvmaf_cuda\b") {
    Write-Host "  [OK] libvmaf_cuda found (GPU)" -ForegroundColor Green
} else {
    Write-Host "  [INFO] libvmaf_cuda not present in host build (available via GPU container)" -ForegroundColor Yellow
}

