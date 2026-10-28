"""Unit tests for EventDeduplicator (Spec §8.2, Errata E17, Gate G2.7)."""

from src.event_dedup import EventDeduplicator


def test_event_cooldown_gate_g2_7():
    """Gate G2.7: Event cooldown test (EVENT_COOLDOWN_SEC=5)."""
    dedup = EventDeduplicator(cooldown_sec=5.0)
    camera_id = 1
    recording_id = 100

    det_person = {"cls": 0, "conf": 0.85, "box": [0.1, 0.2, 0.3, 0.4]}
    det_car = {"cls": 2, "conf": 0.90, "box": [0.5, 0.5, 0.8, 0.8]}

    # At t=0.0: first detection of person triggers event
    ev1 = dedup.process_detection(
        camera_id=camera_id,
        recording_id=recording_id,
        detection=det_person,
        timestamp=0.0,
        confidence_threshold=0.35,
    )
    assert ev1 is not None
    assert ev1["camera_id"] == 1
    assert ev1["recording_id"] == 100
    assert ev1["class_id"] == 0
    assert ev1["class_name"] == "person"
    assert ev1["confidence"] == 0.85

    # At t=2.0 (< 5.0s cooldown): same camera and person class must be suppressed
    ev2 = dedup.process_detection(
        camera_id=camera_id,
        recording_id=recording_id,
        detection=det_person,
        timestamp=2.0,
        confidence_threshold=0.35,
    )
    assert ev2 is None

    # At t=2.0: different class (car) on same camera is NOT suppressed
    ev_car = dedup.process_detection(
        camera_id=camera_id,
        recording_id=recording_id,
        detection=det_car,
        timestamp=2.0,
        confidence_threshold=0.35,
    )
    assert ev_car is not None
    assert ev_car["class_id"] == 2
    assert ev_car["class_name"] == "car"

    # At t=4.9 (< 5.0s cooldown): person still suppressed
    ev3 = dedup.process_detection(
        camera_id=camera_id,
        recording_id=recording_id,
        detection=det_person,
        timestamp=4.9,
        confidence_threshold=0.35,
    )
    assert ev3 is None

    # At t=5.0 (>= 5.0s cooldown): person is emitted again
    ev4 = dedup.process_detection(
        camera_id=camera_id,
        recording_id=recording_id,
        detection=det_person,
        timestamp=5.0,
        confidence_threshold=0.35,
    )
    assert ev4 is not None
    assert ev4["class_id"] == 0


def test_confidence_threshold_filtering():
    """Detections below confidence_threshold must not trigger events."""
    dedup = EventDeduplicator(cooldown_sec=5.0)

    det_low_conf = {"cls": 0, "conf": 0.30, "box": [0.1, 0.2, 0.3, 0.4]}

    # Threshold is 0.35, detection is 0.30 -> rejected
    ev = dedup.process_detection(
        camera_id=1,
        recording_id=10,
        detection=det_low_conf,
        timestamp=1.0,
        confidence_threshold=0.35,
    )
    assert ev is None


def test_multi_camera_isolation():
    """Cooldown is per (camera_id, class_id), so camera 2 is not affected by camera 1."""
    dedup = EventDeduplicator(cooldown_sec=5.0)
    det = {"cls": 0, "conf": 0.85, "box": [0.1, 0.2, 0.3, 0.4]}

    # Cam 1 triggers at t=0.0
    ev1 = dedup.process_detection(
        camera_id=1,
        recording_id=10,
        detection=det,
        timestamp=0.0,
        confidence_threshold=0.35,
    )
    assert ev1 is not None

    # Cam 2 triggers at t=1.0 independently
    ev2 = dedup.process_detection(
        camera_id=2,
        recording_id=20,
        detection=det,
        timestamp=1.0,
        confidence_threshold=0.35,
    )
    assert ev2 is not None
