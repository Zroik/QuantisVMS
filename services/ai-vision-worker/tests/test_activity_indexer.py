"""Unit tests for ActivityIndexer and forensic weighting (Spec §8.2, Errata E1, Gate G2.6)."""

from src.activity_indexer import (
    WEIGHTS,
    ActivityIndexer,
    ActivityWindow,
    get_class_category,
    get_class_weight,
)


def test_weights_gate_g2_6():
    """Gate G2.6: Weights test (person=3, vehicle=2, pet=1, other=1)."""
    assert WEIGHTS["person"] == 3.0
    assert WEIGHTS["vehicle"] == 2.0
    assert WEIGHTS["pet"] == 1.0
    assert WEIGHTS["other"] == 1.0

    # Person (class 0)
    assert get_class_category(0) == "person"
    assert get_class_weight(0) == 3.0

    # Vehicles (1, 2, 3, 5, 7)
    for cid in [1, 2, 3, 5, 7]:
        assert get_class_category(cid) == "vehicle"
        assert get_class_weight(cid) == 2.0

    # Pets (14, 15, 16)
    for cid in [14, 15, 16]:
        assert get_class_category(cid) == "pet"
        assert get_class_weight(cid) == 1.0

    # Others (e.g. 24 backpack, 43 knife, 63 laptop, 76 scissors)
    for cid in [24, 43, 63, 76]:
        assert get_class_category(cid) == "other"
        assert get_class_weight(cid) == 1.0


def test_window_time_alignment():
    """Windows must align to multiples of sample_sec (e.g., 20s: 0-20, 20-40)."""
    indexer = ActivityIndexer(window_duration_sec=20)

    # Timestamp 45.5 -> window starts at 40.0, ends at 60.0, window_index = 2
    start_ts = indexer.get_window_start(45.5)
    assert start_ts == 40.0
    assert indexer.get_window_index(45.5, recording_start_ts=0.0) == 2


def test_activity_accumulation_and_scoring():
    """Accumulate detections across multiple frames and verify counts and weighted score."""
    indexer = ActivityIndexer(window_duration_sec=20)

    # Frame 1 at t=1.0: 1 person, 1 car
    indexer.add_frame(
        timestamp=1.0,
        detections=[{"cls": 0, "conf": 0.8}, {"cls": 2, "conf": 0.9}],
    )

    # Frame 2 at t=2.0: 1 dog, 1 backpack
    indexer.add_frame(
        timestamp=2.0,
        detections=[{"cls": 16, "conf": 0.75}, {"cls": 24, "conf": 0.6}],
    )

    # Frame 3 at t=3.0: no detections
    indexer.add_frame(timestamp=3.0, detections=[])

    # Window should not be closed yet
    closed = indexer.check_closed_windows(current_timestamp=5.0)
    assert len(closed) == 0

    # Frame at t=21.0 triggers closing of window [0.0, 20.0)
    closed = indexer.add_frame(timestamp=21.0, detections=[{"cls": 0, "conf": 0.9}])
    assert len(closed) == 1

    win = closed[0]
    assert isinstance(win, ActivityWindow)
    assert win.start_offset_sec == 0
    assert win.duration_sec == 20
    assert win.frames_processed == 3
    assert win.person_count == 1
    assert win.vehicle_count == 1
    assert win.pet_count == 1
    assert win.other_count == 1
    # Weighted score: 1*3 (person) + 1*2 (vehicle) + 1*1 (pet) + 1*1 (other) = 7.0
    assert win.weighted_activity_score == 7.0


def test_upsert_payload_generation():
    """ActivityWindow generates dict matching MySQL schema recording_activity_windows."""
    win = ActivityWindow(
        window_index=0,
        start_offset_sec=0,
        duration_sec=20,
        frames_processed=100,
        person_count=4,
        vehicle_count=2,
        pet_count=1,
        other_count=3,
        weighted_activity_score=4 * 3 + 2 * 2 + 1 * 1 + 3 * 1,
    )
    payload = win.to_db_payload(recording_id=42, segment_index=0)
    assert payload["recording_id"] == 42
    assert payload["segment_index"] == 0
    assert payload["window_index"] == 0
    assert payload["start_offset_sec"] == 0
    assert payload["person_count"] == 4
    assert payload["vehicle_count"] == 2
    assert payload["pet_count"] == 1
    assert payload["other_count"] == 3
    assert payload["frames_processed"] == 100
    assert payload["weighted_activity_score"] == 20.0


def test_epoch_timestamps_produce_relative_offsets():
    """[P-10] ActivityIndexer never leaks raw Unix epoch values into window_index or start_offset_sec."""
    indexer = ActivityIndexer(window_duration_sec=20, recording_start_ts=1762400000.0)
    indexer.add_frame(timestamp=1762400005.0, detections=[{"cls": 0, "conf": 0.9}])
    closed = indexer.add_frame(timestamp=1762400025.0, detections=[{"cls": 2, "conf": 0.8}])

    assert len(closed) == 1
    win = closed[0]
    assert win.window_start_ts == 1762400000.0
    assert win.start_offset_sec == 0
    assert win.window_index == 0

    closed2 = indexer.check_closed_windows(current_timestamp=1762400045.0)
    assert len(closed2) == 1
    win2 = closed2[0]
    assert win2.window_start_ts == 1762400020.0
    assert win2.start_offset_sec == 20
    assert win2.window_index == 1
