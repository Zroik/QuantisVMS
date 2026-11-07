"""Redis Class Toggle Synchronizer & In-Memory State Cache (Spec §6.2, §8.2, Gates G2.3, G2.4)."""

import json
import logging
import threading
import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Any

import redis

from src.classes import DEFAULT_ACTIVE_CLASS_IDS

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class CameraClassState:
    """Thread-safe snapshot of camera active classes and confidence threshold."""

    camera_id: int
    active_classes: list[int]
    confidence_threshold: float
    rev: int


class ToggleSynchronizer:
    """
    Maintains thread-safe in-memory cache of active YOLO class IDs and confidence
    thresholds per camera. Listens to Redis pub/sub channel 'ai:toggle' with
    monotonic revision filtering, and periodically reconciles from Redis keys (Spec §6.2).
    """

    def __init__(self, default_confidence: float = 0.35) -> None:
        self._states: dict[int, CameraClassState] = {}
        self._lock = threading.Lock()
        self.default_confidence: float = float(default_confidence)

    def set_default_confidence(self, confidence: float) -> None:
        """Dynamically update default confidence threshold across un-overridden camera states."""
        conf = max(0.01, min(1.0, float(confidence)))
        with self._lock:
            self.default_confidence = conf
            for cid, state in list(self._states.items()):
                if state.rev == 0:
                    self._states[cid] = CameraClassState(
                        camera_id=cid,
                        active_classes=list(state.active_classes),
                        confidence_threshold=conf,
                        rev=state.rev,
                    )

    def get_state(self, camera_id: int) -> CameraClassState:
        """
        Get current class toggle state for a camera.
        If camera has not been initialized yet, returns default state.
        """
        with self._lock:
            state = self._states.get(camera_id)
            if state is None:
                # Return standard default per Spec §6.1
                state = CameraClassState(
                    camera_id=camera_id,
                    active_classes=list(DEFAULT_ACTIVE_CLASS_IDS),
                    confidence_threshold=self.default_confidence,
                    rev=0,
                )
                self._states[camera_id] = state
            return state

    def update_from_message(self, payload: dict[str, Any]) -> bool:
        """
        Process an incoming 'ai:toggle' message.
        Enforces monotonic revision tracking (ignores messages with rev <= current).
        """
        try:
            camera_id = int(payload["camera_id"])
            raw_classes = payload.get("resolved_active_ids", [])
            active_classes = sorted([int(cid) for cid in raw_classes if 0 <= int(cid) <= 79])
            confidence = float(payload.get("confidence_threshold", 0.35))
            rev = int(payload.get("rev", 0))
        except (KeyError, ValueError, TypeError) as exc:
            logger.warning("Invalid ai:toggle message payload: %s (error: %s)", payload, exc)
            return False

        with self._lock:
            current = self._states.get(camera_id)
            if current is not None and rev <= current.rev:
                logger.debug(
                    "Discarding stale ai:toggle message for camera %d (msg rev %d <= cur rev %d)",
                    camera_id,
                    rev,
                    current.rev,
                )
                return False

            self._states[camera_id] = CameraClassState(
                camera_id=camera_id,
                active_classes=active_classes,
                confidence_threshold=confidence,
                rev=rev,
            )
            logger.info(
                "Applied ai:toggle for camera %d (rev %d, %d classes, conf %.2f)",
                camera_id,
                rev,
                len(active_classes),
                confidence,
            )
            return True

    def reconcile_camera(self, redis_client: Any, camera_id: int) -> bool:
        """
        Reconcile a single camera's state by reading keys cam:{id}:classes and cam:{id}:conf.
        Returns True if state was found and updated/reconciled.
        """
        try:
            classes_key = f"cam:{camera_id}:classes"
            conf_key = f"cam:{camera_id}:conf"

            raw_classes = redis_client.get(classes_key)
            raw_conf = redis_client.get(conf_key)

            if raw_classes is None and raw_conf is None:
                return False

            with self._lock:
                current = self._states.get(camera_id)
                cur_classes = current.active_classes if current else list(DEFAULT_ACTIVE_CLASS_IDS)
                cur_conf = current.confidence_threshold if current else 0.35
                cur_rev = current.rev if current else 0

                if raw_classes is not None:
                    if isinstance(raw_classes, bytes):
                        raw_classes = raw_classes.decode("utf-8")
                    parsed_classes = json.loads(raw_classes)
                    cur_classes = sorted([int(c) for c in parsed_classes if 0 <= int(c) <= 79])

                if raw_conf is not None:
                    if isinstance(raw_conf, bytes):
                        raw_conf = raw_conf.decode("utf-8")
                    cur_conf = float(raw_conf)

                # Reconciled state preserves or increments rev
                self._states[camera_id] = CameraClassState(
                    camera_id=camera_id,
                    active_classes=cur_classes,
                    confidence_threshold=cur_conf,
                    rev=cur_rev,
                )
            return True
        except (redis.RedisError, json.JSONDecodeError, ValueError, KeyError, OSError, TypeError) as exc:
            logger.error("Failed to reconcile camera %d from Redis: %s", camera_id, exc)
            return False

    def reconcile_all(self, redis_client: Any, camera_ids: Sequence[int]) -> int:
        """Reconcile state for all known cameras."""
        count = 0
        for cid in camera_ids:
            if self.reconcile_camera(redis_client, cid):
                count += 1
        return count

    def listen_loop(
        self,
        redis_client: Any,
        channel: str = "ai:toggle",
        stop_event: threading.Event | None = None,
    ) -> None:
        """
        Listen to Redis pub/sub channel 'ai:toggle' and apply updates.
        Blocks until stop_event is set or exception occurs.
        """
        pubsub = redis_client.pubsub()
        pubsub.subscribe(channel)
        logger.info("Subscribed to Redis channel '%s'", channel)

        while stop_event is None or not stop_event.is_set():
            try:
                message = pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)
                if message and message["type"] == "message":
                    data = message["data"]
                    if isinstance(data, bytes):
                        data = data.decode("utf-8")
                    payload = json.loads(data)
                    self.update_from_message(payload)
            except (redis.RedisError, json.JSONDecodeError, ValueError, KeyError, OSError, TypeError) as exc:
                if stop_event and stop_event.is_set():
                    break
                logger.error("Error in ai:toggle pubsub listener loop: %s", exc)
                time.sleep(1.0)

        pubsub.unsubscribe(channel)
        pubsub.close()

    def reconciliation_loop(
        self,
        redis_client: Any,
        camera_ids_provider: Callable[[], Sequence[int]],
        stop_event: threading.Event,
        interval_sec: float = 5.0,
    ) -> None:
        """
        Periodically reconcile active classes and confidence thresholds every 5 seconds (Spec §6.2).
        """
        while not stop_event.is_set():
            try:
                cids = camera_ids_provider()
                self.reconcile_all(redis_client, cids)
            except (redis.RedisError, json.JSONDecodeError, ValueError, KeyError, OSError, TypeError) as exc:
                logger.error("Error in periodic reconciliation loop: %s", exc)
            stop_event.wait(interval_sec)
