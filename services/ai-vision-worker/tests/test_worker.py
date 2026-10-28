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
