"""Integration and pipeline tests for VisionWorker (Spec §8.2, Gates G2.2, G2.3)."""

import json
from unittest.mock import MagicMock

import numpy as np

from src.detector import YOLODetector
from src.event_dedup import EventDeduplicator
from src.toggle_sync import ToggleSynchronizer
from src.worker import CameraWorkerPipeline


def test_camera_worker_pipeline_frame_processing():
    """Verify end-to-end frame processing, detection publishing, and activity indexer update."""
    mock_redis = MagicMock()
    mock_db = MagicMock()

    detector = YOLODetector(model_path="yolov8n.pt")
    toggle_sync = ToggleSynchronizer()
    event_dedup = EventDeduplicator(cooldown_sec=5.0)

    pipeline = CameraWorkerPipeline(
        camera_id=1,
        rtsp_url="rtsp://localhost:8554/cam1",
        detector=detector,
        toggle_sync=toggle_sync,
        event_dedup=event_dedup,
        redis_client=mock_redis,
        db_connection=mock_db,
        window_duration_sec=20,
    )

    # Process a synthetic frame
    frame = np.zeros((480, 640, 3), dtype=np.uint8)
    ts = 1000.0

    detections = pipeline.process_single_frame(frame, timestamp=ts)
    assert detections is not None
    assert detections["camera_id"] == 1
    assert detections["seq"] == 1
    assert "frame_ts_ms" in detections
    assert "boxes" in detections

    # Verify redis publish was called with channel 'ai:detections'
    mock_redis.publish.assert_called_once()
    call_args = mock_redis.publish.call_args[0]
    assert call_args[0] == "ai:detections"
    payload = json.loads(call_args[1])
    assert payload["camera_id"] == 1
    assert payload["seq"] == 1
    assert isinstance(payload["boxes"], list)


def test_dynamic_toggle_in_pipeline():
    """Verify toggling active classes affects pipeline output immediately without reload."""
    mock_redis = MagicMock()
    detector = YOLODetector(model_path="yolov8n.pt")
    toggle_sync = ToggleSynchronizer()
    event_dedup = EventDeduplicator(cooldown_sec=5.0)

    pipeline = CameraWorkerPipeline(
        camera_id=1,
        rtsp_url="rtsp://localhost:8554/cam1",
        detector=detector,
        toggle_sync=toggle_sync,
        event_dedup=event_dedup,
        redis_client=mock_redis,
    )

    # 1. By default, classes are active
    frame = np.zeros((480, 640, 3), dtype=np.uint8)
    d1 = pipeline.process_single_frame(frame, timestamp=10.0)
    assert d1["seq"] == 1

    # 2. Toggle all classes off
    toggle_sync.update_from_message({
        "camera_id": 1,
        "resolved_active_ids": [],
        "confidence_threshold": 0.35,
        "rev": 1,
    })

    # Next frame processed immediately uses empty active_classes (0 boxes, contiguous seq 2)
    d2 = pipeline.process_single_frame(frame, timestamp=10.1)
    assert d2["seq"] == 2
    assert len(d2["boxes"]) == 0
    assert d2["latency_ms"] == 0.0


def test_mysql_connection_timeout_kwargs(monkeypatch):
    """[AI-02] get_mysql_connection passes connect_timeout=5, read_timeout=10, write_timeout=10."""
    from src import main as worker_main

    captured_kwargs = {}

    def fake_connect(**kwargs):
        captured_kwargs.update(kwargs)
        return MagicMock()

    monkeypatch.setattr(worker_main.pymysql, "connect", fake_connect)
    worker_main.get_mysql_connection()

    assert captured_kwargs["connect_timeout"] == 5
    assert captured_kwargs["read_timeout"] == 10
    assert captured_kwargs["write_timeout"] == 10


def test_recording_time_containment_in_flush_activity_window():
    """[AI-01] flush_activity_window only persists windows contained within recording [start_ts, end_ts)."""
    from src.activity_indexer import ActivityWindow

    mock_redis = MagicMock()
    mock_db = MagicMock()
    mock_cursor = MagicMock()
    mock_db.cursor.return_value.__enter__.return_value = mock_cursor

    detector = YOLODetector(model_path="yolov8n.pt")
    toggle_sync = ToggleSynchronizer()
    event_dedup = EventDeduplicator(cooldown_sec=5.0)

    pipeline = CameraWorkerPipeline(
        camera_id=1,
        rtsp_url="rtsp://localhost:8554/cam1",
        detector=detector,
        toggle_sync=toggle_sync,
        event_dedup=event_dedup,
        redis_client=mock_redis,
        db_connection=mock_db,
        window_duration_sec=20,
    )

    # Case 1: Recording started at 2000, window was at 1960 (before recording started) -> rejected/buffered
    mock_cursor.fetchone.return_value = {"id": 55, "start_ts": 2000, "end_ts": None}
    old_win = ActivityWindow(
        window_index=0,
        start_offset_sec=0,
        duration_sec=20,
        frames_processed=10,
        person_count=1,
        vehicle_count=0,
        pet_count=0,
        other_count=0,
        weighted_activity_score=3.0,
        window_start_ts=1960.0,
    )
    pipeline.flush_activity_window(old_win)
    # Should only have executed the SELECT query, NOT the INSERT
    assert mock_cursor.execute.call_count == 1
    assert len(pipeline._buffered_windows) == 1

    # Case 2: Window at 2020 falls inside active recording [2000, None) -> persisted with rel_offset=20, window_index=1
    pipeline._buffered_windows.clear()
    mock_cursor.reset_mock()
    mock_cursor.fetchone.return_value = {"id": 55, "start_ts": 2000, "end_ts": 2060}
    valid_win = ActivityWindow(
        window_index=0,
        start_offset_sec=0,
        duration_sec=20,
        frames_processed=15,
        person_count=2,
        vehicle_count=1,
        pet_count=0,
        other_count=0,
        weighted_activity_score=8.0,
        window_start_ts=2020.0,
    )
    pipeline.flush_activity_window(valid_win)
    assert mock_cursor.execute.call_count == 2
    insert_args = mock_cursor.execute.call_args_list[1][0][1]
    assert insert_args[0] == 55  # recording_id
    assert insert_args[2] == 1   # window_index = 20 // 20 = 1
    assert insert_args[3] == 20  # start_offset_sec = 2020 - 2000 = 20


def test_consumer_loop_resilience_and_watchdog():
    """[AI-04] _consumer_loop survives unexpected KeyError/AttributeError and increments consumer_errors."""
    mock_redis = MagicMock()
    detector = YOLODetector(model_path="yolov8n.pt")
    toggle_sync = ToggleSynchronizer()
    event_dedup = EventDeduplicator(cooldown_sec=5.0)

    pipeline = CameraWorkerPipeline(
        camera_id=1,
        rtsp_url="rtsp://localhost:8554/cam1",
        detector=detector,
        toggle_sync=toggle_sync,
        event_dedup=event_dedup,
        redis_client=mock_redis,
    )

    calls = 0

    def boom_then_stop(frame, ts):
        nonlocal calls
        calls += 1
        if calls == 1:
            raise KeyError("unexpected key error in frame")
        pipeline._stop_event.set()
        return {}

    pipeline.process_single_frame = boom_then_stop  # type: ignore[method-assign]
    frame = np.zeros((32, 32, 3), dtype=np.uint8)
    pipeline.frame_queue.put((1.0, frame))
    pipeline.frame_queue.put((2.0, frame))

    pipeline._consumer_loop()
    assert calls == 2
    assert pipeline.consumer_errors == 1
