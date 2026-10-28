"""Phase 2 Hardware Benchmark: Measure YOLO inference latency p50/p95 and VRAM (Gate G2.8)."""

import time

import numpy as np

from src.classes import DEFAULT_ACTIVE_CLASS_IDS
from src.detector import YOLODetector
from src.gpu_stats import GPUStatsCollector


def run_benchmark(
    iterations: int = 100,
    warmup: int = 10,
    frame_width: int = 1920,
    frame_height: int = 1080,
    model_path: str = "yolov8n.pt",
) -> dict[str, float]:
    """Execute benchmark and return p50, p95 latency and GPU VRAM statistics."""
    print(f"=== Starting YOLO Benchmark on {frame_width}x{frame_height} frames ({iterations} runs) ===")
    detector = YOLODetector(model_path=model_path)
    gpu_stats = GPUStatsCollector()

    frame = np.zeros((frame_height, frame_width, 3), dtype=np.uint8)

    # Warmup
    print(f"Warming up for {warmup} iterations...")
    for _ in range(warmup):
        detector.detect_frame(
            camera_id=1,
            frame=frame,
            active_classes=DEFAULT_ACTIVE_CLASS_IDS,
            confidence_threshold=0.35,
        )

    # Benchmark loop
    latencies_ms: list[float] = []
    print(f"Running {iterations} benchmark iterations...")
    for _ in range(iterations):
        t0 = time.perf_counter()
        detector.detect_frame(
            camera_id=1,
            frame=frame,
            active_classes=DEFAULT_ACTIVE_CLASS_IDS,
            confidence_threshold=0.35,
        )
        elapsed_ms = (time.perf_counter() - t0) * 1000.0
        latencies_ms.append(elapsed_ms)

    latencies_sorted = sorted(latencies_ms)
    p50_idx = int(0.50 * len(latencies_sorted))
    p95_idx = int(0.95 * len(latencies_sorted))

    p50_ms = round(latencies_sorted[p50_idx], 2)
    p95_ms = round(latencies_sorted[p95_idx], 2)
    mean_ms = round(float(np.mean(latencies_ms)), 2)

    stats = gpu_stats.collect_stats()
    vram_used_mb = stats.get("vram_used_mb", 0.0)
    vram_total_mb = stats.get("vram_total_mb", 0.0)
    gpu_util = stats.get("gpu_util", 0.0)

    result = {
        "iterations": iterations,
        "p50_ms": p50_ms,
        "p95_ms": p95_ms,
        "mean_ms": mean_ms,
        "vram_used_mb": vram_used_mb,
        "vram_total_mb": vram_total_mb,
        "gpu_util": gpu_util,
    }

    print("\n=== Benchmark Results (Gate G2.8) ===")
    print(f"Frame Size:        {frame_width}x{frame_height}")
    print(f"Active Classes:    {len(DEFAULT_ACTIVE_CLASS_IDS)} classes")
    print(f"Inference Latency: p50 = {p50_ms} ms, p95 = {p95_ms} ms, mean = {mean_ms} ms")
    print(f"VRAM Memory:       {vram_used_mb} MB / {vram_total_mb} MB")
    print(f"GPU Utilization:   {gpu_util}%")
    return result


if __name__ == "__main__":
    run_benchmark()

