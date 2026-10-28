# VMS Performance Benchmarks Log

Recorded on AMD Ryzen 7 7745HX (8C/16T) and NVIDIA GeForce RTX 4060 Laptop GPU (8 GB VRAM, Ada Architecture).

---

## Phase 1 — VMAF-CUDA and NVENC Benchmarks

### Gate G1.2: Reference Self-Compare
- **Input**: 1080p 20 s sample (`fixture_20s.mp4`), 502 frames, 25 fps
- **Filter**: `[0:v]format=yuv420p,hwupload_cuda[dist];[1:v]format=yuv420p,hwupload_cuda[ref];[dist][ref]libvmaf_cuda`
- **Result**:
  - Mean VMAF: **99.9011** (Target: ≥ 99.5)
  - 25th Percentile (p25): **99.8553**
  - Frames Scored: **502 / 502**
  - Wall Time: **2,476 ms** (~203 FPS)
  - Status: **PASS**

---

### Gate G1.3: AV1 NVENC CQ Quality Sweep
Encoder: `av1_nvenc`, Preset: `p5`, Rate Control: `-b:v 0 -cq <CQ>`, Passthrough FPS.

| CQ | Mean VMAF | p25 VMAF | Harmonic Mean | Min VMAF | Scored Frames | Probe Duration | Quality Monotonicity |
|---|---|---|---|---|---|---|---|
| **20** | **99.64** | **99.37** | 99.64 | 96.92 | 502 / 502 | 3,347 ms | Baseline |
| **28** | **98.74** | **98.39** | 98.74 | 96.38 | 502 / 502 | 2,978 ms | Non-increasing (PASS) |
| **36** | **96.76** | **96.20** | 96.75 | 94.40 | 502 / 502 | 2,467 ms | Non-increasing (PASS) |
| **44** | **93.51** | **92.63** | 93.49 | 90.38 | 502 / 502 | 2,222 ms | Non-increasing (PASS) |

**Conclusion**: Quality strictly decreases monotonically as CQ increases (`99.64 → 98.74 → 96.76 → 93.51`).

---

### Gate G1.6: CUDA vs CPU VMAF Parity
- **Sample**: `dist_cq28.mp4` (encoded at CQ 28) vs raw reference `fixture_20s.mp4`
- **CUDA Pipeline**: `libvmaf_cuda` on RTX 4060
  - Mean VMAF: **98.7449**
- **CPU Pipeline**: `libvmaf` (16 threads, subsample=2) on Ryzen 7 7745HX
  - Mean VMAF: **98.8304**
- **Difference (|CUDA - CPU|)**: **0.0855** (Target: ≤ 2.0)
- **Status**: **PASS**

---

### Gate G1.9: Full CQ Bisection Search Convergence
- **Sample**: 20 s sample, CQ range [18, 48] (31 possible values)
- **Quality Gate**: Mean ≥ 85.0 AND p25 ≥ 81.0 (Spec §2 E2)
- **Search Log**:
  - Iteration 1: Tested CQ=33 → Mean=97.64, p25=97.22 (3,715 ms) → **PASS** (lo=34)
  - Iteration 2: Tested CQ=41 → Mean=94.59, p25=93.69 (4,519 ms) → **PASS** (lo=42)
  - Iteration 3: Tested CQ=45 → Mean=93.17, p25=92.20 (4,235 ms) → **PASS** (lo=46)
  - Iteration 4: Tested CQ=47 → Mean=92.33, p25=91.30 (4,032 ms) → **PASS** (lo=48)
  - Iteration 5: Tested CQ=48 → Mean=91.97, p25=90.97 (4,149 ms) → **PASS** (optimal CQ found)
- **Summary**:
  - Total Iterations: **5** (Target: ≤ 5)
  - Optimal Selected CQ: **48**
  - Final Quality: Mean=**91.97**, p25=**90.97**
  - Total Wall Time: **20.66 s**
  - Status: **PASS**

---

## Phase 2 Hardware Benchmarks (RTX 4060 Laptop GPU)

### Gate G2.8: YOLO Inference Latency & VRAM Benchmarks
- **Hardware**: NVIDIA GeForce RTX 4060 Laptop GPU (8,188 MB VRAM), AMD Ryzen 7 7745HX (8C/16T)
- **Model**: YOLO COCO Detector (`yolov8n.pt`, 3.2M params, 8.7 GFLOPs)
- **Input Resolution**: 1920x1080 (1080p Full HD)
- **Active Classes**: 9 classes (Person, Vehicles, Pets default preset)
- **Test Set**: 100 benchmark iterations (10 warmup runs)
- **Results**:
  - Latency p50: **8.61 ms** (~116 FPS throughput)
  - Latency p95: **12.75 ms** (well within ≤ 100 ms budget for 10 FPS real-time)
  - Latency Mean: **9.42 ms**
  - VRAM Utilization: **3035.4 MB / 8188.0 MB** (~37.1% usage)
  - GPU Utilization: **44.0%**
- **Status**: **PASS**


