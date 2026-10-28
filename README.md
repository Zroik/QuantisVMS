# Smart VMS (Video Management System)

A production-grade Smart Video Management System featuring zero-CPU RTSP raw recording, live browser preview with dynamic YOLO26n bounding boxes, AI-guided VMAF-gated NVENC compression, and verified retention.

## Hardware Envelope
- **Processor**: AMD Ryzen 7 7745HX (8 Cores, 16 Threads)
- **GPU**: NVIDIA GeForce RTX 4060 Laptop GPU (8 GB VRAM, Ada architecture with AV1/HEVC/H.264 NVENC + NVDEC)
- **Storage**: 1 TB NVMe

## Key Pipelines
1. **Record & Detect Pipeline**:
   - IP Camera RTSP (1 connection per camera via MediaMTX).
   - Zero-CPU stream capture to fragmented MP4 (`frag_keyframe+empty_moov+default_base_moof`).
   - YOLO26n single-engine inference with sub-second per-class toggle filtering.
   - 20 s forensic activity window indexing (`person=3, vehicle=2, pet=1, other=1`).
2. **Smart Probing & Compression Pipeline**:
   - Hourly scheduling of eligible RAW recordings older than retention window.
   - Peak 20 s forensic window selection per 10-minute chunk.
   - Bisection CQ search with NVENC (`av1_nvenc` / `hevc_nvenc`) and `libvmaf_cuda` (Mean ≥ 85.0, p25 ≥ 81.0).
   - Independent chunk encoding and atomic concat with `+faststart`.
   - Mandatory 5-point verification (ffprobe, frame counts, full decode, sample VMAF re-check, size reduction) before safe raw deletion.

## Licensing & Compliance Notice
- **Ultralytics**: Uses YOLO26n under GNU Affero General Public License v3.0 (AGPL-3.0). Any derivative software using this component must comply with AGPL-3.0 terms.
- **FFmpeg Nonfree Build**: FFmpeg compiled with `--enable-nonfree` (incorporating NVENC/CUDA headers and libvmaf) produces binaries that are **non-redistributable**. Builds must be generated locally and never published to public container registries or repositories.

## Quick Start
```bash
# Verify environment and monorepo packages
pnpm verify

# Start development stack
docker compose --profile dev up -d
```

