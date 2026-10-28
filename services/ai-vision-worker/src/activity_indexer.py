"""Forensic Activity Indexer for Smart Probing (Spec §8.2, Errata E1, Gate G2.6)."""

import math
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

from src.classes import PRESET_GROUPS

WEIGHTS: dict[str, float] = {
    "person": 3.0,
    "vehicle": 2.0,
    "pet": 1.0,
    "other": 1.0,
}

# Fast lookup for class categories
_CATEGORY_BY_CLASS_ID: dict[int, str] = {}
for cid in PRESET_GROUPS.get("person", []):
    _CATEGORY_BY_CLASS_ID[cid] = "person"
for cid in PRESET_GROUPS.get("vehicles", []):
    _CATEGORY_BY_CLASS_ID[cid] = "vehicle"
for cid in PRESET_GROUPS.get("pets", []):
    _CATEGORY_BY_CLASS_ID[cid] = "pet"


def get_class_category(class_id: int) -> str:
    """Return 'person', 'vehicle', 'pet', or 'other' based on class ID."""
    return _CATEGORY_BY_CLASS_ID.get(class_id, "other")


def get_class_weight(class_id: int, other_weight: float = 1.0) -> float:
    """Return forensic activity weight per Errata E1 (person=3, vehicle=2, pet=1, other=1)."""
    category = get_class_category(class_id)
    if category == "other":
        return other_weight
    return WEIGHTS[category]


@dataclass
class ActivityWindow:
    """Represents a closed forensic window of duration PROBE_SAMPLE_SEC (Spec §8.2)."""

    window_index: int
    start_offset_sec: int
    duration_sec: int
    frames_processed: int
    person_count: int
    vehicle_count: int
    pet_count: int
    other_count: int
    weighted_activity_score: float

    def to_db_payload(self, recording_id: int, segment_index: int = 0) -> dict[str, Any]:
        """Format dictionary for MySQL upsert into recording_activity_windows table."""
        return {
            "recording_id": recording_id,
            "segment_index": segment_index,
            "window_index": self.window_index,
            "start_offset_sec": self.start_offset_sec,
            "person_count": self.person_count,
            "vehicle_count": self.vehicle_count,
            "pet_count": self.pet_count,
            "other_count": self.other_count,
            "frames_processed": self.frames_processed,
            "weighted_activity_score": self.weighted_activity_score,
        }


class ActivityIndexer:
    """
    Accumulates frame detection counts into aligned forensic activity windows.
    Windows are aligned to multiples of window_duration_sec (Spec §8.2).
    """

    def __init__(self, window_duration_sec: int = 20, other_weight: float = 1.0) -> None:
        self.window_duration_sec = window_duration_sec
        self.other_weight = other_weight

        self._current_window_start: float | None = None
        self._frames_processed: int = 0
        self._person_count: int = 0
        self._vehicle_count: int = 0
        self._pet_count: int = 0
        self._other_count: int = 0
        self._weighted_score: float = 0.0

    def get_window_start(self, timestamp: float) -> float:
        """Calculate the aligned start timestamp for a given wall-clock timestamp."""
        return math.floor(timestamp / self.window_duration_sec) * self.window_duration_sec

    def get_window_index(self, timestamp: float, recording_start_ts: float = 0.0) -> int:
        """Calculate the 0-based integer window index relative to recording start."""
        elapsed = max(0.0, timestamp - recording_start_ts)
        return int(elapsed // self.window_duration_sec)

    def _close_current_window(self) -> ActivityWindow | None:
        """Close the active window and return the ActivityWindow instance."""
        if self._current_window_start is None:
            return None

        window = ActivityWindow(
            window_index=int(self._current_window_start // self.window_duration_sec),
            start_offset_sec=int(self._current_window_start),
            duration_sec=self.window_duration_sec,
            frames_processed=self._frames_processed,
            person_count=self._person_count,
            vehicle_count=self._vehicle_count,
            pet_count=self._pet_count,
            other_count=self._other_count,
            weighted_activity_score=self._weighted_score,
        )

        # Reset counters
        self._frames_processed = 0
        self._person_count = 0
        self._vehicle_count = 0
        self._pet_count = 0
        self._other_count = 0
        self._weighted_score = 0.0
        self._current_window_start = None

        return window

    def add_frame(
        self,
        timestamp: float,
        detections: Sequence[dict[str, Any]],
    ) -> list[ActivityWindow]:
        """
        Record detections for a frame at given timestamp.
        Returns any closed ActivityWindow objects if this frame pushed past window boundary.
        """
        closed_windows: list[ActivityWindow] = []
        aligned_start = self.get_window_start(timestamp)

        if self._current_window_start is None:
            self._current_window_start = aligned_start
        elif aligned_start > self._current_window_start:
            # Current window closed
            closed = self._close_current_window()
            if closed is not None:
                closed_windows.append(closed)
            self._current_window_start = aligned_start

        # Accumulate detections in current window
        self._frames_processed += 1
        for det in detections:
            cls_id = int(det.get("cls", 0))
            category = get_class_category(cls_id)
            weight = get_class_weight(cls_id, self.other_weight)

            if category == "person":
                self._person_count += 1
            elif category == "vehicle":
                self._vehicle_count += 1
            elif category == "pet":
                self._pet_count += 1
            else:
                self._other_count += 1

            self._weighted_score += weight

        return closed_windows

    def check_closed_windows(self, current_timestamp: float) -> list[ActivityWindow]:
        """Check if time has advanced past the current window end without new frames."""
        if self._current_window_start is None:
            return []

        if current_timestamp >= self._current_window_start + self.window_duration_sec:
            closed = self._close_current_window()
            return [closed] if closed is not None else []

        return []
