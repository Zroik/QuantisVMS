"""Unit tests for ToggleSynchronizer (Spec §6.2, §8.2, Gates G2.3, G2.4)."""

import json
from unittest.mock import MagicMock

from src.classes import DEFAULT_ACTIVE_CLASS_IDS
from src.toggle_sync import CameraClassState, ToggleSynchronizer


def test_toggle_sync_initial_defaults():
    """Unknown camera defaults to standard COCO active ids and conf=0.35."""
    sync = ToggleSynchronizer()
    state = sync.get_state(camera_id=1)
    assert state.camera_id == 1
    assert state.active_classes == DEFAULT_ACTIVE_CLASS_IDS
    assert state.confidence_threshold == 0.35
    assert state.rev == 0


def test_toggle_sync_monotonic_revision_gate_g2_3():
    """Messages with lower or equal revision must be discarded."""
    sync = ToggleSynchronizer()

    # Apply rev 1
    msg1 = {
        "camera_id": 1,
        "resolved_active_ids": [0, 2],
        "confidence_threshold": 0.40,
        "rev": 1,
    }
    assert sync.update_from_message(msg1) is True
    state = sync.get_state(1)
    assert state.active_classes == [0, 2]
    assert state.confidence_threshold == 0.40
    assert state.rev == 1

    # Out-of-order rev 0 or duplicate rev 1 must be ignored
    stale_msg = {
        "camera_id": 1,
        "resolved_active_ids": [0],
        "confidence_threshold": 0.50,
        "rev": 1,
    }
    assert sync.update_from_message(stale_msg) is False
    assert sync.get_state(1).active_classes == [0, 2]

    # Valid newer rev 2 must be applied
    msg2 = {
        "camera_id": 1,
        "resolved_active_ids": [0],
        "confidence_threshold": 0.45,
        "rev": 2,
    }
    assert sync.update_from_message(msg2) is True
    assert sync.get_state(1).active_classes == [0]
    assert sync.get_state(1).confidence_threshold == 0.45
    assert sync.get_state(1).rev == 2


def test_reconciliation_reads_redis_keys_gate_g2_4():
    """Gate G2.4: key changed in Redis without publish is applied during reconciliation."""
    sync = ToggleSynchronizer()

    mock_redis = MagicMock()
    # Mock Redis get responses for cam:1:classes and cam:1:conf
    def mock_get(key: str):
        if key == "cam:1:classes":
            return json.dumps([0, 15, 16])
        if key == "cam:1:conf":
            return "0.55"
        return None

    mock_redis.get.side_effect = mock_get

    # Reconcile camera 1
    applied = sync.reconcile_camera(mock_redis, camera_id=1)
    assert applied is True

    state = sync.get_state(1)
    assert state.active_classes == [0, 15, 16]
    assert state.confidence_threshold == 0.55
    # Reconciliation updates internal state
    assert state.camera_id == 1


def test_thread_safety_concurrent_access():
    """Concurrent readers and writers do not throw or produce invalid states."""
    import concurrent.futures

    sync = ToggleSynchronizer()

    def writer(i: int):
        sync.update_from_message({
            "camera_id": 1,
            "resolved_active_ids": [i % 80],
            "confidence_threshold": 0.35 + (i % 10) * 0.01,
            "rev": i,
        })

    def reader():
        state = sync.get_state(1)
        assert isinstance(state, CameraClassState)
        assert len(state.active_classes) >= 1

    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
        futures = []
        for i in range(1, 100):
            futures.append(executor.submit(writer, i))
            futures.append(executor.submit(reader))
        for f in concurrent.futures.as_completed(futures):
            f.result()

