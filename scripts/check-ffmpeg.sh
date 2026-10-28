#!/usr/bin/env bash
set -euo pipefail

echo "=== Checking FFmpeg Build Capabilities ==="
FFMPEG_BIN="${1:-ffmpeg}"

echo "FFmpeg binary: $(which "$FFMPEG_BIN" || echo "$FFMPEG_BIN")"
"$FFMPEG_BIN" -version | head -n 2

echo "Checking hwaccels for cuda..."
"$FFMPEG_BIN" -hwaccels | grep -w "cuda" || { echo "ERROR: cuda hwaccel missing"; exit 1; }
echo "  [OK] cuda hwaccel found"

echo "Checking encoders (av1_nvenc, hevc_nvenc)..."
"$FFMPEG_BIN" -hide_banner -encoders | grep -E "av1_nvenc" || { echo "ERROR: av1_nvenc missing"; exit 1; }
echo "  [OK] av1_nvenc found"
"$FFMPEG_BIN" -hide_banner -encoders | grep -E "hevc_nvenc" || { echo "ERROR: hevc_nvenc missing"; exit 1; }
echo "  [OK] hevc_nvenc found"

echo "Checking filters (libvmaf, libvmaf_cuda)..."
"$FFMPEG_BIN" -hide_banner -filters | grep -w "libvmaf" || { echo "ERROR: libvmaf missing"; exit 1; }
echo "  [OK] libvmaf found"
"$FFMPEG_BIN" -hide_banner -filters | grep -w "libvmaf_cuda" || { echo "ERROR: libvmaf_cuda missing"; exit 1; }
echo "  [OK] libvmaf_cuda found"

echo "=== All FFmpeg checks passed successfully ==="
