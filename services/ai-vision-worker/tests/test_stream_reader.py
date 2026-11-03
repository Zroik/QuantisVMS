"""Unit tests for StreamReader and frame sampling (Spec §8.2, Gate G2.5)."""

import threading

import av
import numpy as np

from src import stream_reader
from src.stream_reader import (
    CameraStreamReader,
    FFmpegError,
    FrameQueue,
    calculate_reconnect_backoff,
    mask_rtsp_url,
)


def test_pyav_exception_alias_matches_installed_version():
    """PyAV 19 removed av.AVError; the reader must use av.FFmpegError."""
    assert hasattr(av, "FFmpegError")
    assert FFmpegError is av.FFmpegError


def test_run_reader_handles_open_error_without_dying(monkeypatch):
    """An open/decode failure must be caught and enter the reconnect path, not raise AttributeError."""
    reader = CameraStreamReader(camera_id=99, rtsp_url="rtsp://127.0.0.1:1/nope", target_fps=10.0)
    stop_event = threading.Event()
    attempts = {"n": 0}

    def fake_open(*_args, **_kwargs):
        attempts["n"] += 1
        if attempts["n"] >= 2:
            stop_event.set()
        raise av.FFmpegError(1, "simulated stream failure")

    monkeypatch.setattr(stream_reader._av, "open", fake_open)
    monkeypatch.setattr(stream_reader, "calculate_reconnect_backoff", lambda *_a, **_k: 0.0)

    reader.run_reader(FrameQueue(maxsize=1), stop_event)

    assert attempts["n"] >= 2
    assert reader.is_connected is False


def test_mask_rtsp_url_security():
    """RTSP credentials must be masked in logs (Spec §10 item 6)."""
    raw_url = "rtsp://admin:super_secret_password@192.168.1.100:554/live/ch0"
    masked = mask_rtsp_url(raw_url)
    assert "super_secret_password" not in masked
    assert "admin" not in masked
    assert masked == "rtsp://***:***@192.168.1.100:554/live/ch0"

    # URL without credentials remains unchanged
    plain_url = "rtsp://mediamtx:8554/cam1"
    assert mask_rtsp_url(plain_url) == "rtsp://mediamtx:8554/cam1"


def test_reconnect_backoff_gate_g2_5():
    """Gate G2.5: Reconnect backoff with exponential increase capped at max_backoff <= 30s."""
    # Attempt 0: 1.0s
    assert calculate_reconnect_backoff(0, base_sec=1.0, max_sec=30.0) == 1.0
    # Attempt 1: 2.0s
    assert calculate_reconnect_backoff(1, base_sec=1.0, max_sec=30.0) == 2.0
    # Attempt 2: 4.0s
    assert calculate_reconnect_backoff(2, base_sec=1.0, max_sec=30.0) == 4.0
    # Attempt 5: 30.0s (capped)
    assert calculate_reconnect_backoff(5, base_sec=1.0, max_sec=30.0) == 30.0
    # Attempt 10: 30.0s (capped)
    assert calculate_reconnect_backoff(10, base_sec=1.0, max_sec=30.0) == 30.0


def test_bounded_frame_queue_drops_lagging_frames():
    """Queue drops oldest frame when full to prevent unbounded buffering lag."""
    queue = FrameQueue(maxsize=2)

    f1 = (1.0, np.zeros((10, 10), dtype=np.uint8))
    f2 = (2.0, np.ones((10, 10), dtype=np.uint8))
    f3 = (3.0, np.full((10, 10), 2, dtype=np.uint8))

    queue.put(f1)
    queue.put(f2)
    assert queue.size() == 2

    # Pushing 3rd frame drops f1
    dropped = queue.put(f3)
    assert dropped is True
    assert queue.size() == 2

    # Oldest remaining should now be f2
    ts, _ = queue.get(timeout=0.1)
    assert ts == 2.0

    # Next should be f3
    ts2, _ = queue.get(timeout=0.1)
    assert ts2 == 3.0
    assert queue.empty()


def test_stream_reader_fps_sampling():
    """Stream reader samples at target AI_FPS (10 FPS = 0.1s interval)."""
    reader = CameraStreamReader(camera_id=1, rtsp_url="rtsp://localhost:8554/cam1", target_fps=10.0)
    assert reader.sample_interval_sec == 0.1

    # First frame at t=0.0 -> sampled
    assert reader.should_sample_frame(timestamp=0.0) is True

    # Frame at t=0.05 -> skipped (< 0.10s)
    assert reader.should_sample_frame(timestamp=0.05) is False

    # Frame at t=0.10 -> sampled
    assert reader.should_sample_frame(timestamp=0.10) is True
