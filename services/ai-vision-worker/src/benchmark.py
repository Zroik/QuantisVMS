"""Phase 2 Hardware Benchmark: Measure YOLO inference latency p50/p95 and VRAM on real video (Gate G2.8)."""

import argparse
import os
import time
from typing import Any

import av
import numpy as np

from src.activity_indexer import ActivityIndexer
from src.classes import COCO_CLASSES, DEFAULT_ACTIVE_CLASS_IDS
from src.detector import YOLODetector
from src.event_dedup import EventDeduplicator
from src.gpu_stats import GPUStatsCollector


def run_synthetic_benchmark(
    iterations: int = 100,
    warmup: int = 10,
    frame_width: int = 1920,
    frame_height: int = 1080,
    model_path: str = "yolov8n.pt",
) -> dict[str, Any]:
    """Execute synthetic benchmark and return p50, p95 latency and GPU VRAM statistics."""
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
    p50_ms = round(latencies_sorted[int(0.50 * len(latencies_sorted))], 2)
    p95_ms = round(latencies_sorted[int(0.95 * len(latencies_sorted))], 2)
    mean_ms = round(float(np.mean(latencies_ms)), 2)

    stats = gpu_stats.collect_stats()
    vram_used_mb = stats.get("vram_used_mb", 0.0)
    vram_total_mb = stats.get("vram_total_mb", 0.0)
    gpu_util = stats.get("gpu_util", 0.0)

    result = {
        "mode": "synthetic",
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


def run_video_benchmark(
    video_path: str,
    target_fps: float = 10.0,
    model_path: str = "yolov8n.pt",
    max_frames: int | None = None,
) -> dict[str, Any]:
    """
    Execute hardware benchmark on a real video file (e.g., tests/1minuteroad.mp4).
    Samples frames at target_fps, runs CUDA inference on RTX 4060, updates
    ActivityIndexer (20s forensic windows), and EventDeduplicator (5s cooldown).
    """
    if not os.path.isabs(video_path):
        video_path = os.path.abspath(video_path)

    if not os.path.exists(video_path):
        raise FileNotFoundError(f"Video file not found at {video_path}")

    container = av.open(video_path)
    video_stream = container.streams.video[0]
    stream_fps = float(video_stream.average_rate)
    width = video_stream.width
    height = video_stream.height
    total_stream_frames = video_stream.frames or int(float(video_stream.duration * video_stream.time_base) * stream_fps)
    duration_sec = float(video_stream.duration * video_stream.time_base) if video_stream.duration else 60.0

    print("=== Real-Video Benchmark on RTX 4060 Laptop GPU ===")
    print(f"Video File:       {video_path}")
    print(f"Resolution:       {width}x{height}")
    print(f"Stream FPS:       {stream_fps:.2f}")
    print(f"Stream Duration:  {duration_sec:.2f} s (~{total_stream_frames} frames)")
    print(f"Sampling Mode:    AI_FPS = {target_fps:.1f} FPS (Sample interval: {1.0/target_fps:.3f} s)")

    detector = YOLODetector(model_path=model_path)
    gpu_stats = GPUStatsCollector()
    indexer = ActivityIndexer(window_duration_sec=20)
    dedup = EventDeduplicator(cooldown_sec=5.0)

    # Warmup with first 5 frames
    print("Warming up CUDA context with initial frames...")
    for idx, frame in enumerate(container.decode(video_stream)):
        img = frame.to_ndarray(format="bgr24")
        detector.detect_frame(1, img, DEFAULT_ACTIVE_CLASS_IDS, 0.35)
        if idx >= 4:
            break

    # Re-open container for full benchmark pass
    container.close()
    container = av.open(video_path)
    video_stream = container.streams.video[0]

    sample_interval = 1.0 / target_fps
    last_sample_pts = -float("inf")
    time_base = float(video_stream.time_base)

    latencies_ms: list[float] = []
    class_detection_counts: dict[str, int] = {}
    events_triggered: list[dict[str, Any]] = []
    closed_windows = []

    total_decoded_frames = 0
    sampled_frames = 0
    wall_start = time.perf_counter()

    print(f"Processing video sampled at {target_fps} FPS...")
    for frame in container.decode(video_stream):
        total_decoded_frames += 1
        frame_pts_sec = float(frame.pts * time_base) if frame.pts is not None else (total_decoded_frames / stream_fps)

        if (frame_pts_sec - last_sample_pts) >= (sample_interval - 0.001):
            last_sample_pts = frame_pts_sec
            sampled_frames += 1

            img = frame.to_ndarray(format="bgr24")

            t0 = time.perf_counter()
            res = detector.detect_frame(
                camera_id=1,
                frame=img,
                active_classes=DEFAULT_ACTIVE_CLASS_IDS,
                confidence_threshold=0.35,
                capture_ts_ms=int(frame_pts_sec * 1000),
            )
            elapsed_ms = (time.perf_counter() - t0) * 1000.0
            latencies_ms.append(elapsed_ms)

            # Accumulate class counts
            for box in res["boxes"]:
                cname = COCO_CLASSES.get(box["cls"], f"cls_{box['cls']}")
                class_detection_counts[cname] = class_detection_counts.get(cname, 0) + 1

                # Check event deduplicator
                ev = dedup.process_detection(
                    camera_id=1,
                    recording_id=1,
                    detection=box,
                    timestamp=frame_pts_sec,
                    confidence_threshold=0.35,
                )
                if ev is not None:
                    events_triggered.append(ev)

            # Add to activity indexer
            closed = indexer.add_frame(frame_pts_sec, res["boxes"])
            if closed:
                closed_windows.extend(closed)

            if max_frames and sampled_frames >= max_frames:
                break

    # Flush final window
    final_closed = indexer.check_closed_windows(frame_pts_sec + 20.0)
    if final_closed:
        closed_windows.extend(final_closed)

    wall_total = time.perf_counter() - wall_start
    container.close()

    # Latency percentiles
    latencies_sorted = sorted(latencies_ms)
    p50_ms = round(latencies_sorted[int(0.50 * len(latencies_sorted))], 2)
    p90_ms = round(latencies_sorted[int(0.90 * len(latencies_sorted))], 2)
    p95_ms = round(latencies_sorted[int(0.95 * len(latencies_sorted))], 2)
    p99_ms = round(latencies_sorted[int(0.99 * len(latencies_sorted))], 2)
    mean_ms = round(float(np.mean(latencies_ms)), 2)
    min_ms = round(float(np.min(latencies_ms)), 2)
    max_ms = round(float(np.max(latencies_ms)), 2)

    stats = gpu_stats.collect_stats()
    vram_used_mb = stats.get("vram_used_mb", 0.0)
    vram_total_mb = stats.get("vram_total_mb", 0.0)
    gpu_util = stats.get("gpu_util", 0.0)
    effective_fps = round(sampled_frames / wall_total, 1)

    print("\n" + "=" * 50)
    print("=== Real-Video Benchmark Results (Gate G2.8) ===")
    print("=" * 50)
    print(f"Decoded Stream Frames:  {total_decoded_frames} frames")
    print(f"Sampled Frames @10FPS:  {sampled_frames} frames")
    print(f"Total Wall Time:        {wall_total:.2f} s")
    print(f"Overall Processing FPS: {effective_fps} FPS (includes decode + copy + inference)")
    print("Pure Inference Latency:")
    print(f"  - p50:  {p50_ms} ms (~{1000.0/p50_ms:.1f} FPS pure inference throughput)")
    print(f"  - p90:  {p90_ms} ms")
    print(f"  - p95:  {p95_ms} ms")
    print(f"  - p99:  {p99_ms} ms")
    print(f"  - Mean: {mean_ms} ms")
    print(f"  - Min:  {min_ms} ms, Max: {max_ms} ms")
    print(f"VRAM Memory:            {vram_used_mb} MB / {vram_total_mb} MB ({(vram_used_mb/vram_total_mb)*100:.1f}%)")
    print(f"GPU Utilization:        {gpu_util}%")
    print("\n--- Object Detection Summary ---")
    for cname, count in sorted(class_detection_counts.items(), key=lambda x: -x[1]):
        print(f"  - {cname:15s}: {count:5d} detections")
    print(f"Total Deduplicated Events (5s cooldown): {len(events_triggered)}")
    print(f"Total Forensic Windows (20s each):       {len(closed_windows)}")
    for w in closed_windows:
        print(
            f"  - Window {w.window_index} [{w.start_offset_sec}s - {w.start_offset_sec+w.duration_sec}s]: "
            f"score={w.weighted_activity_score:.1f}, persons={w.person_count}, "
            f"vehicles={w.vehicle_count}, pets={w.pet_count}, frames={w.frames_processed}"
        )
    print("=" * 50)

    return {
        "mode": "real_video",
        "video_path": video_path,
        "total_decoded_frames": total_decoded_frames,
        "sampled_frames": sampled_frames,
        "wall_total_s": round(wall_total, 2),
        "effective_fps": effective_fps,
        "p50_ms": p50_ms,
        "p90_ms": p90_ms,
        "p95_ms": p95_ms,
        "p99_ms": p99_ms,
        "mean_ms": mean_ms,
        "min_ms": min_ms,
        "max_ms": max_ms,
        "vram_used_mb": vram_used_mb,
        "vram_total_mb": vram_total_mb,
        "gpu_util": gpu_util,
        "class_detection_counts": class_detection_counts,
        "events_count": len(events_triggered),
        "windows_count": len(closed_windows),
        "windows": closed_windows,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Run YOLO Benchmark on real video or synthetic frames")
    parser.add_argument("--video", type=str, default="D:/anothervms/tests/1minuteroad.mp4", help="Path to video file")
    parser.add_argument("--synthetic", action="store_true", help="Run synthetic benchmark instead of video")
    parser.add_argument("--fps", type=float, default=10.0, help="Sampling FPS for video benchmark")
    args = parser.parse_args()

    if args.synthetic or not os.path.exists(args.video):
        run_synthetic_benchmark()
    else:
        run_video_benchmark(args.video, target_fps=args.fps)


if __name__ == "__main__":
    main()
