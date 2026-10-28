"""Detection Event Deduplicator with per-(camera, class) cooldown (Spec §8.2, Errata E17, Gate G2.7)."""

from datetime import UTC, datetime
from typing import Any

from src.classes import COCO_CLASSES


class EventDeduplicator:
    """
    Suppresses redundant event records for identical (camera_id, class_id)
    pairs within EVENT_COOLDOWN_SEC to prevent flooding MySQL and disk.
    """

    def __init__(self, cooldown_sec: float = 5.0) -> None:
        self.cooldown_sec = cooldown_sec
        # Map: (camera_id, class_id) -> last_event_timestamp
        self._last_event_timestamps: dict[tuple[int, int], float] = {}

    def process_detection(
        self,
        camera_id: int,
        recording_id: int | None,
        detection: dict[str, Any],
        timestamp: float,
        confidence_threshold: float,
        snapshot_path: str | None = None,
    ) -> dict[str, Any] | None:
        """
        Evaluate a detection against confidence threshold and cooldown window.
        Returns event dict for ai_detection_events insertion, or None if suppressed.
        """
        conf = float(detection.get("conf", 0.0))
        if conf < confidence_threshold:
            return None

        class_id = int(detection.get("cls", 0))
        key = (camera_id, class_id)
        last_ts = self._last_event_timestamps.get(key)

        if last_ts is not None and (timestamp - last_ts) < self.cooldown_sec:
            return None

        # Eligible event: record timestamp and build payload
        self._last_event_timestamps[key] = timestamp
        class_name = COCO_CLASSES.get(class_id, f"class_{class_id}")
        detected_dt = datetime.fromtimestamp(timestamp, tz=UTC).isoformat()

        return {
            "camera_id": camera_id,
            "recording_id": recording_id,
            "class_id": class_id,
            "class_name": class_name,
            "confidence": round(conf, 4),
            "bbox_json": detection.get("box", []),
            "snapshot_path": snapshot_path,
            "detected_at": detected_dt,
        }

    def prune_stale_entries(self, current_timestamp: float, max_age_sec: float = 3600.0) -> int:
        """Prune tracking keys older than max_age_sec to prevent unbounded memory growth."""
        keys_to_remove = [
            k
            for k, last_ts in self._last_event_timestamps.items()
            if (current_timestamp - last_ts) > max_age_sec
        ]
        for k in keys_to_remove:
            del self._last_event_timestamps[k]
        return len(keys_to_remove)
