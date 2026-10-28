"""Camera Worker Pipeline and Manager (Spec §6.2, §8.2, Gates G2.2, G2.3, G2.5)."""

import json
import logging
import threading
import time
from collections.abc import Sequence
from typing import Any

import numpy as np

from src.activity_indexer import ActivityIndexer, ActivityWindow
from src.detector import YOLODetector
from src.event_dedup import EventDeduplicator
from src.gpu_stats import GPUStatsCollector
from src.stream_reader import CameraStreamReader, FrameQueue
from src.toggle_sync import ToggleSynchronizer

logger = logging.getLogger(__name__)


class CameraWorkerPipeline:
    """
    Coordinates streaming, dynamic class-filtered detection, Redis publication,
    forensic activity indexing, and event deduplication for a single camera.
    """

    def __init__(
        self,
        camera_id: int,
        rtsp_url: str,
        detector: YOLODetector,
        toggle_sync: ToggleSynchronizer,
        event_dedup: EventDeduplicator,
        redis_client: Any,
        db_connection: Any = None,
        window_duration_sec: int = 20,
        target_fps: float = 10.0,
    ) -> None:
        self.camera_id = camera_id
        self.rtsp_url = rtsp_url
        self.detector = detector
        self.toggle_sync = toggle_sync
        self.event_dedup = event_dedup
        self.redis_client = redis_client
        self.db_connection = db_connection
        self.window_duration_sec = window_duration_sec

        self.activity_indexer = ActivityIndexer(window_duration_sec=window_duration_sec)
        self.stream_reader = CameraStreamReader(
            camera_id=camera_id,
            rtsp_url=rtsp_url,
            target_fps=target_fps,
        )
        self.frame_queue = FrameQueue(maxsize=2)

        self._stop_event = threading.Event()
        self._reader_thread: threading.Thread | None = None
        self._consumer_thread: threading.Thread | None = None
        self.current_recording_id: int | None = None

    def flush_activity_window(self, window: ActivityWindow) -> None:
        """Upsert completed activity window into MySQL recording_activity_windows table."""
        if self.db_connection is None:
            return

        payload = window.to_db_payload(
            recording_id=self.current_recording_id or 0,
            segment_index=0,
        )
        try:
            with self.db_connection.cursor() as cursor:
                sql = """
                INSERT INTO recording_activity_windows
                (recording_id, segment_index, window_index, start_offset_sec,
                 person_count, vehicle_count, pet_count, other_count,
                 frames_processed, weighted_activity_score)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON DUPLICATE KEY UPDATE
                 person_count = VALUES(person_count),
                 vehicle_count = VALUES(vehicle_count),
                 pet_count = VALUES(pet_count),
                 other_count = VALUES(other_count),
                 frames_processed = VALUES(frames_processed),
                 weighted_activity_score = VALUES(weighted_activity_score)
                """
                cursor.execute(
                    sql,
                    (
                        payload["recording_id"],
                        payload["segment_index"],
                        payload["window_index"],
                        payload["start_offset_sec"],
                        payload["person_count"],
                        payload["vehicle_count"],
                        payload["pet_count"],
                        payload["other_count"],
                        payload["frames_processed"],
                        payload["weighted_activity_score"],
                    ),
                )
            self.db_connection.commit()
        except (AttributeError, OSError, ValueError) as exc:
            logger.error("Failed to flush activity window to MySQL: %s", exc)

    def flush_detection_event(self, event: dict[str, Any]) -> None:
        """Insert detection event into MySQL ai_detection_events table."""
        if self.db_connection is None:
            return

        try:
            with self.db_connection.cursor() as cursor:
                sql = """
                INSERT INTO ai_detection_events
                (camera_id, recording_id, class_id, class_name, confidence, bbox_json, snapshot_path, detected_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                """
                cursor.execute(
                    sql,
                    (
                        event["camera_id"],
                        event["recording_id"],
                        event["class_id"],
                        event["class_name"],
                        event["confidence"],
                        json.dumps(event["bbox_json"]),
                        event.get("snapshot_path"),
                        event["detected_at"],
                    ),
                )
            self.db_connection.commit()
        except (AttributeError, OSError, ValueError) as exc:
            logger.error("Failed to flush detection event to MySQL: %s", exc)

    def process_single_frame(
        self,
        frame: np.ndarray,
        timestamp: float,
    ) -> dict[str, Any]:
        """
        Process a single decoded frame through the vision worker pipeline:
        1. Fetch dynamic class toggle state
        2. Execute YOLO detection without reloading model
        3. Publish ai:detections to Redis
        4. Update activity indexer and flush any closed windows
        5. Check event deduplicator and flush events
        """
        state = self.toggle_sync.get_state(self.camera_id)
        capture_ts_ms = int(timestamp * 1000)

        # 1. Dynamic YOLO inference
        dets = self.detector.detect_frame(
            camera_id=self.camera_id,
            frame=frame,
            active_classes=state.active_classes,
            confidence_threshold=state.confidence_threshold,
            capture_ts_ms=capture_ts_ms,
        )

        # 2. Redis publication to 'ai:detections'
        if self.redis_client is not None:
            try:
                publish_payload = {
                    "camera_id": dets["camera_id"],
                    "seq": dets["seq"],
                    "frame_ts_ms": dets["frame_ts_ms"],
                    "boxes": dets["boxes"],
                }
                self.redis_client.publish("ai:detections", json.dumps(publish_payload))
            except (ConnectionError, OSError) as exc:
                logger.error("Failed to publish ai:detections to Redis: %s", exc)

        # 3. Activity Indexer aggregation
        closed_windows = self.activity_indexer.add_frame(timestamp, dets["boxes"])
        for win in closed_windows:
            self.flush_activity_window(win)

        # 4. Event deduplication
        for box in dets["boxes"]:
            event = self.event_dedup.process_detection(
                camera_id=self.camera_id,
                recording_id=self.current_recording_id,
                detection=box,
                timestamp=timestamp,
                confidence_threshold=state.confidence_threshold,
            )
            if event is not None:
                self.flush_detection_event(event)

        return dets

    def _consumer_loop(self) -> None:
        """Consumer thread: pops decoded frames from bounded queue and processes them."""
        while not self._stop_event.is_set():
            try:
                timestamp, frame = self.frame_queue.get(timeout=1.0)
                self.process_single_frame(frame, timestamp)
            except TimeoutError:
                # Check for timed out windows when no frames arrive
                now = time.time()
                for win in self.activity_indexer.check_closed_windows(now):
                    self.flush_activity_window(win)
            except (ValueError, TypeError, OSError) as exc:
                if self._stop_event.is_set():
                    break
                logger.error("Error in consumer loop for camera %d: %s", self.camera_id, exc)

    def start(self) -> None:
        """Start reader and consumer threads."""
        self._stop_event.clear()
        self._reader_thread = threading.Thread(
            target=self.stream_reader.run_reader,
            args=(self.frame_queue, self._stop_event),
            daemon=True,
            name=f"cam-{self.camera_id}-reader",
        )
        self._consumer_thread = threading.Thread(
            target=self._consumer_loop,
            daemon=True,
            name=f"cam-{self.camera_id}-consumer",
        )
        self._reader_thread.start()
        self._consumer_thread.start()
        logger.info("Started pipeline threads for camera %d", self.camera_id)

    def stop(self) -> None:
        """Stop pipeline threads gracefully."""
        self._stop_event.set()
        if self._reader_thread and self._reader_thread.is_alive():
            self._reader_thread.join(timeout=2.0)
        if self._consumer_thread and self._consumer_thread.is_alive():
            self._consumer_thread.join(timeout=2.0)
        logger.info("Stopped pipeline for camera %d", self.camera_id)


class VisionWorkerManager:
    """
    Supervises all camera pipelines, Redis pub/sub listeners,
    reconciliation, and GPU telemetry.
    """

    def __init__(
        self,
        model_path: str = "yolov8n.pt",
        redis_client: Any = None,
        db_connection: Any = None,
        gpu_index: int = 0,
        window_duration_sec: int = 20,
        target_fps: float = 10.0,
    ) -> None:
        self.detector = YOLODetector(model_path=model_path)
        self.toggle_sync = ToggleSynchronizer()
        self.event_dedup = EventDeduplicator(cooldown_sec=5.0)
        self.gpu_stats = GPUStatsCollector(gpu_index=gpu_index)

        self.redis_client = redis_client
        self.db_connection = db_connection
        self.window_duration_sec = window_duration_sec
        self.target_fps = target_fps

        self.pipelines: dict[int, CameraWorkerPipeline] = {}
        self._stop_event = threading.Event()
        self._bg_threads: list[threading.Thread] = []

    def add_camera(self, camera_id: int, rtsp_url: str) -> None:
        """Register and start a new camera pipeline."""
        if camera_id in self.pipelines:
            self.remove_camera(camera_id)

        pipeline = CameraWorkerPipeline(
            camera_id=camera_id,
            rtsp_url=rtsp_url,
            detector=self.detector,
            toggle_sync=self.toggle_sync,
            event_dedup=self.event_dedup,
            redis_client=self.redis_client,
            db_connection=self.db_connection,
            window_duration_sec=self.window_duration_sec,
            target_fps=self.target_fps,
        )
        self.pipelines[camera_id] = pipeline
        pipeline.start()

    def remove_camera(self, camera_id: int) -> None:
        """Stop and unregister an active camera pipeline."""
        pipeline = self.pipelines.pop(camera_id, None)
        if pipeline is not None:
            pipeline.stop()

    def get_camera_ids(self) -> Sequence[int]:
        """Return list of active camera IDs."""
        return list(self.pipelines.keys())

    def get_health_status(self) -> dict[str, Any]:
        """Report health status including last-frame age per camera (Spec §8.2)."""
        now = time.time()
        cameras_health: dict[int, dict[str, Any]] = {}
        for cid, p in self.pipelines.items():
            last_ts = p.stream_reader.last_frame_ts
            age_sec = round(now - last_ts, 2) if last_ts > 0 else None
            cameras_health[cid] = {
                "connected": p.stream_reader.is_connected,
                "last_frame_age_sec": age_sec,
            }

        return {
            "status": "healthy",
            "active_cameras": len(self.pipelines),
            "cameras": cameras_health,
        }

    def start(self) -> None:
        """Start background threads: toggle listener, reconciliation, and GPU telemetry."""
        self._stop_event.clear()

        if self.redis_client is not None:
            # 1. Redis pubsub listener for ai:toggle
            t_listen = threading.Thread(
                target=self.toggle_sync.listen_loop,
                args=(self.redis_client, "ai:toggle", self._stop_event),
                daemon=True,
                name="toggle-listener",
            )
            # 2. Redis periodic reconciliation loop (5s)
            t_recon = threading.Thread(
                target=self.toggle_sync.reconciliation_loop,
                args=(self.redis_client, self.get_camera_ids, self._stop_event, 5.0),
                daemon=True,
                name="reconciliation-loop",
            )
            # 3. GPU stats publisher (2s)
            t_gpu = threading.Thread(
                target=self.gpu_stats.publish_loop,
                args=(self.redis_client, "hw:gpu", self._stop_event, 2.0),
                daemon=True,
                name="gpu-telemetry",
            )

            self._bg_threads = [t_listen, t_recon, t_gpu]
            for t in self._bg_threads:
                t.start()

    def stop(self) -> None:
        """Stop all pipelines and background supervisor threads."""
        self._stop_event.set()
        for cid in list(self.pipelines.keys()):
            self.remove_camera(cid)
        for t in self._bg_threads:
            if t.is_alive():
                t.join(timeout=2.0)
        self._bg_threads.clear()
        logger.info("VisionWorkerManager stopped.")
