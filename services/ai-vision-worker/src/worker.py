"""Camera Worker Pipeline and Manager (Spec §6.2, §8.2, Gates G2.2, G2.3, G2.5)."""

import json
import logging
import threading
import time
from collections.abc import Sequence
from typing import Any

import numpy as np
import pymysql
import redis

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
        self._db_lock = getattr(db_connection, "_lock", None) if db_connection is not None else None
        if self._db_lock is None and db_connection is not None:
            self._db_lock = threading.Lock()
            try:
                db_connection._lock = self._db_lock
            except (AttributeError, TypeError) as exc:
                logger.warning("Could not attach shared DB lock to connection: %s", exc)
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
        self.consumer_errors: int = 0
        self.dropped_activity_windows: int = 0
        self._buffered_windows: list[ActivityWindow] = []

    def is_reader_alive(self) -> bool:
        """Return True if the stream reader thread is currently alive."""
        return bool(self._reader_thread and self._reader_thread.is_alive())

    def is_consumer_alive(self) -> bool:
        """Return True if the frame consumer thread is currently alive."""
        return bool(self._consumer_thread and self._consumer_thread.is_alive())

    def _reconnect_db_safely(self) -> None:
        """Attempt to ping/reconnect MySQL connection after a socket timeout or operational error."""
        if self.db_connection is not None and hasattr(self.db_connection, "ping"):
            try:
                self.db_connection.ping(reconnect=True)
            except (pymysql.MySQLError, OSError) as exc:
                logger.warning("DB reconnect failed for camera %d: %s", self.camera_id, exc)

    def _persist_single_window(self, window: ActivityWindow, is_retry: bool = False) -> bool:
        """
        Attempt to match an activity window against a time-contained recording row and persist it.
        Returns True if persisted, False if no time-contained recording row matched.
        """
        win_start_epoch = (
            float(window.window_start_ts)
            if getattr(window, "window_start_ts", 0.0) > 0
            else float(window.start_offset_sec)
        )

        rec_id: int | None = None
        rec_started_at: float | None = None
        rec_ended_at: float | None = None

        with self.db_connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT id, UNIX_TIMESTAMP(started_at) AS start_ts, UNIX_TIMESTAMP(ended_at) AS end_ts
                FROM recordings
                WHERE camera_id = %s
                  AND UNIX_TIMESTAMP(started_at) <= %s
                  AND (ended_at IS NULL OR UNIX_TIMESTAMP(ended_at) >= %s)
                ORDER BY started_at DESC, id DESC
                LIMIT 1
                """,
                (self.camera_id, win_start_epoch, win_start_epoch),
            )
            row = cursor.fetchone()
            if row:
                if isinstance(row, dict):
                    rec_id = row.get("id")
                    rec_started_at = row.get("start_ts")
                    rec_ended_at = row.get("end_ts")
                else:
                    rec_id = row[0] if len(row) > 0 else None
                    rec_started_at = row[1] if len(row) > 1 else None
                    rec_ended_at = row[2] if len(row) > 2 else None

        # Verify strict time containment even if mock cursor returned an unfiltered row
        if not rec_id:
            return False
        if rec_started_at is not None and win_start_epoch < float(rec_started_at):
            return False
        if rec_ended_at is not None and win_start_epoch >= float(rec_ended_at):
            return False

        self.current_recording_id = int(rec_id)
        if rec_started_at is not None:
            self.activity_indexer.set_recording_start_ts(float(rec_started_at))
            rel_offset = max(0, int(win_start_epoch - float(rec_started_at)))
        else:
            rel_offset = max(0, int(window.start_offset_sec))

        rel_window_index = int(rel_offset // self.window_duration_sec)

        payload = window.to_db_payload(
            recording_id=int(rec_id),
            segment_index=0,
        )
        payload["start_offset_sec"] = rel_offset
        payload["window_index"] = rel_window_index

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
        return True

    def flush_activity_window(self, window: ActivityWindow) -> None:
        """Upsert completed activity window into MySQL recording_activity_windows table."""
        if self.db_connection is None:
            return

        lock = self._db_lock or threading.Lock()
        try:
            # The whole read-modify-write sequence runs under the shared
            # connection lock: pymysql connections are not thread-safe.
            with lock:
                self._reconnect_db_safely()

                # First attempt any buffered windows from the previous flush cycle
                if self._buffered_windows:
                    pending = list(self._buffered_windows)
                    self._buffered_windows.clear()
                    for buf_win in pending:
                        if not self._persist_single_window(buf_win, is_retry=True):
                            self.dropped_activity_windows += 1
                            logger.warning(
                                "Dropping buffered activity window (ts=%.1f) for camera %d: no time-contained recording found",
                                getattr(buf_win, "window_start_ts", buf_win.start_offset_sec),
                                self.camera_id,
                            )

                if not self._persist_single_window(window, is_retry=False):
                    # Buffer once for the next flush cycle in case of slight recorder insert lag
                    if len(self._buffered_windows) < 5:
                        self._buffered_windows.append(window)
                        logger.debug(
                            "Buffered activity window (ts=%.1f) for camera %d awaiting active recording row",
                            getattr(window, "window_start_ts", window.start_offset_sec),
                            self.camera_id,
                        )
                    else:
                        self.dropped_activity_windows += 1
                        logger.warning(
                            "Dropping activity window (ts=%.1f) for camera %d: buffer full and no matching recording",
                            getattr(window, "window_start_ts", window.start_offset_sec),
                            self.camera_id,
                        )
        except (pymysql.OperationalError, pymysql.InterfaceError) as exc:
            logger.error("MySQL operational/interface error flushing activity window: %s", exc)
            with lock:
                self._reconnect_db_safely()
        except (pymysql.MySQLError, RuntimeError, OSError, ValueError, KeyError) as exc:
            logger.error("Failed to flush activity window to MySQL: %s", exc)

    def flush_detection_event(self, event: dict[str, Any]) -> bool:
        """Insert detection event into MySQL ai_detection_events table. Returns True if committed."""
        if self.db_connection is None:
            return True

        lock = self._db_lock or threading.Lock()
        try:
            with lock:
                self._reconnect_db_safely()
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
                return True
        except (pymysql.OperationalError, pymysql.InterfaceError) as exc:
            logger.error("MySQL operational/interface error flushing detection event: %s", exc)
            with lock:
                self._reconnect_db_safely()
            return False
        except (pymysql.MySQLError, AttributeError, OSError, ValueError) as exc:
            logger.error("Failed to flush detection event to MySQL: %s", exc)
            return False

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
                    # One canonical wire shape; the dashboard normalizes x1..y2.
                    "boxes": [
                        {
                            "cls": b["cls"],
                            "conf": b["conf"],
                            "x1": b["x1"],
                            "y1": b["y1"],
                            "x2": b["x2"],
                            "y2": b["y2"],
                        }
                        for b in dets["boxes"]
                    ],
                }
                self.redis_client.publish("ai:detections", json.dumps(publish_payload))
            except (redis.RedisError, OSError, TypeError, ValueError) as exc:
                logger.error("Failed to publish ai:detections to Redis: %s", exc)

        # 3. Activity Indexer aggregation
        closed_windows = self.activity_indexer.add_frame(timestamp, dets["boxes"])
        for win in closed_windows:
            self.flush_activity_window(win)

        # 4. Event deduplication ([PH3-03])
        for box in dets["boxes"]:
            event = self.event_dedup.process_detection(
                camera_id=self.camera_id,
                recording_id=self.current_recording_id,
                detection=box,
                timestamp=timestamp,
                confidence_threshold=state.confidence_threshold,
            )
            if event is not None:
                committed = self.flush_detection_event(event)
                if not committed:
                    self.event_dedup.revert_cooldown(self.camera_id, event["class_id"])

        return dets

    def _consumer_loop(self) -> None:
        """Consumer thread: pops decoded frames from bounded queue and processes them."""
        while not self._stop_event.is_set():
            try:
                timestamp, frame = self.frame_queue.get(timeout=1.0)
            except TimeoutError:
                # No frame arrived; still close any window whose time has elapsed.
                try:
                    now = time.time()
                    for win in self.activity_indexer.check_closed_windows(now):
                        self.flush_activity_window(win)
                except Exception:
                    self.consumer_errors += 1
                    logger.exception("Error flushing timed-out activity window for camera %d", self.camera_id)
                continue

            # A TimeoutError raised *inside* frame processing must not be
            # mistaken for an idle-queue tick.
            try:
                self.process_single_frame(frame, timestamp)
            except Exception:
                if self._stop_event.is_set():
                    break
                self.consumer_errors += 1
                logger.exception("Unhandled error processing frame for camera %d", self.camera_id)

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
        """Stop pipeline threads gracefully and flush the open activity window."""
        self._stop_event.set()
        if self._reader_thread and self._reader_thread.is_alive():
            self._reader_thread.join(timeout=2.0)
        if self._consumer_thread and self._consumer_thread.is_alive():
            self._consumer_thread.join(timeout=2.0)

        # Persist the last partial window instead of silently dropping it.
        try:
            open_window = self.activity_indexer.flush_current_window()
            if open_window is not None:
                self.flush_activity_window(open_window)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Could not flush final activity window for camera %d: %s", self.camera_id, exc)

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
        self._db_lock = getattr(db_connection, "_lock", None) if db_connection is not None else None
        if self._db_lock is None and db_connection is not None:
            self._db_lock = threading.Lock()
            try:
                db_connection._lock = self._db_lock
            except (AttributeError, TypeError) as exc:
                logger.warning("Could not attach shared DB lock to connection: %s", exc)
        self.window_duration_sec = window_duration_sec
        self.target_fps = target_fps

        self.pipelines: dict[int, CameraWorkerPipeline] = {}
        # The pipelines map is mutated by the camera-change listener, the
        # watchdog loop, and config paths; guard it.
        self._pipelines_lock = threading.RLock()
        self._stop_event = threading.Event()
        self._bg_threads: list[threading.Thread] = []

    def add_camera(self, camera_id: int, rtsp_url: str) -> None:
        """Register and start a new camera pipeline."""
        # Pop/stop the old pipeline OUTSIDE the lock: stop() joins threads and may
        # flush to MySQL, and holding the map lock there would block healthchecks.
        with self._pipelines_lock:
            existing = self.pipelines.pop(camera_id, None)
        if existing is not None:
            existing.stop()

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
        with self._pipelines_lock:
            self.pipelines[camera_id] = pipeline
        pipeline.start()

    def remove_camera(self, camera_id: int) -> None:
        """Stop and unregister an active camera pipeline."""
        with self._pipelines_lock:
            pipeline = self.pipelines.pop(camera_id, None)
        if pipeline is not None:
            pipeline.stop()

    def get_camera_ids(self) -> Sequence[int]:
        """Return list of active camera IDs."""
        with self._pipelines_lock:
            return list(self.pipelines.keys())

    def _pipeline_snapshot(self) -> list[tuple[int, CameraWorkerPipeline]]:
        """Return a stable snapshot of the pipelines map for lock-free iteration."""
        with self._pipelines_lock:
            return list(self.pipelines.items())

    def get_reader_health(self) -> dict[int, bool]:
        """Return whether each camera's reader thread is alive (for healthchecks)."""
        return {cid: p.is_reader_alive() for cid, p in self._pipeline_snapshot()}

    def get_consumer_health(self) -> dict[int, bool]:
        """Return whether each camera's consumer thread is alive (for healthchecks)."""
        return {cid: p.is_consumer_alive() for cid, p in self._pipeline_snapshot()}

    def get_consumer_errors(self) -> dict[int, int]:
        """Return cumulative consumer error counts per camera."""
        return {cid: p.consumer_errors for cid, p in self._pipeline_snapshot()}

    def check_and_restart_dead_pipelines(self) -> list[int]:
        """
        Watchdog check: inspect all active camera workers and restart any pipeline
        whose reader_thread or consumer_thread has died unexpectedly.
        """
        restarted: list[int] = []
        if self._stop_event.is_set():
            return restarted

        for cid, pipeline in self._pipeline_snapshot():
            if pipeline._stop_event.is_set():
                continue
            reader_alive = pipeline.is_reader_alive()
            consumer_alive = pipeline.is_consumer_alive()
            if not reader_alive or not consumer_alive:
                logger.warning(
                    "Watchdog restarting camera %d pipeline (reader_alive=%s, consumer_alive=%s)",
                    cid,
                    reader_alive,
                    consumer_alive,
                )
                rtsp_url = pipeline.rtsp_url
                self.add_camera(cid, rtsp_url)
                restarted.append(cid)
        return restarted

    def apply_ai_config(self, ai_cfg: dict[str, Any]) -> None:
        """
        Dynamically apply ai_engine configuration updates (inferenceFps, confidenceThreshold)
        to active camera workers without restarting threads.
        """
        if not isinstance(ai_cfg, dict):
            return
        if "inferenceFps" in ai_cfg and ai_cfg["inferenceFps"] is not None:
            try:
                new_fps = max(0.1, min(60.0, float(ai_cfg["inferenceFps"])))
                self.target_fps = new_fps
                for _, p in self._pipeline_snapshot():
                    p.stream_reader.set_target_fps(new_fps)
                logger.info("Dynamically updated AI target_fps to %.2f", new_fps)
            except (ValueError, TypeError) as exc:
                logger.warning("Invalid inferenceFps in ai_engine config: %s", exc)

        if "confidenceThreshold" in ai_cfg and ai_cfg["confidenceThreshold"] is not None:
            try:
                new_conf = max(0.01, min(1.0, float(ai_cfg["confidenceThreshold"])))
                self.toggle_sync.set_default_confidence(new_conf)
                logger.info("Dynamically updated default AI confidence_threshold to %.2f", new_conf)
            except (ValueError, TypeError) as exc:
                logger.warning("Invalid confidenceThreshold in ai_engine config: %s", exc)

    def get_health_status(self) -> dict[str, Any]:
        """Report health status including last-frame age per camera (Spec §8.2)."""
        now = time.time()
        cameras_health: dict[int, dict[str, Any]] = {}
        for cid, p in self._pipeline_snapshot():
            last_ts = p.stream_reader.last_frame_ts
            age_sec = round(now - last_ts, 2) if last_ts > 0 else None
            cameras_health[cid] = {
                "connected": p.stream_reader.is_connected,
                "last_frame_age_sec": age_sec,
            }

        return {
            "status": "healthy",
            "active_cameras": len(self._pipeline_snapshot()),
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
        for cid in [cid for cid, _ in self._pipeline_snapshot()]:
            self.remove_camera(cid)
        for t in self._bg_threads:
            if t.is_alive():
                t.join(timeout=2.0)
        self._bg_threads.clear()
        logger.info("VisionWorkerManager stopped.")
