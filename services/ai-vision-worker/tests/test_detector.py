"""Unit and integration tests for YOLODetector (Spec §8.2, Errata E3, Gates G2.1, G2.2, G2.3)."""

from unittest.mock import MagicMock

import numpy as np

from src.detector import YOLODetector


def test_coco_names_assertion_gate_g2_1():
    """Gate G2.1: model.names assertion matches all Appendix A / COCO groups."""
    detector = YOLODetector(model_path="yolov8n.pt")
    model_names = detector.get_class_names()

    required_check = {
        0: "person",
        1: "bicycle",
        2: "car",
        3: "motorcycle",
        5: "bus",
        7: "truck",
        14: "bird",
        15: "cat",
        16: "dog",
        24: "backpack",
        25: "umbrella",
        26: "handbag",
        28: "suitcase",
        34: "baseball bat",
        39: "bottle",
        43: "knife",
        76: "scissors",
        62: "tv",
        63: "laptop",
        64: "mouse",
        66: "keyboard",
        67: "cell phone",
    }
    for class_id, expected_name in required_check.items():
        assert model_names[class_id] == expected_name, (
            f"Class {class_id} mismatch: expected {expected_name}, got {model_names.get(class_id)}"
        )


def test_bounding_box_normalization_gate_g2_2():
    """Gate G2.2: coords must be normalized to [0, 1]."""
    detector = YOLODetector(model_path="yolov8n.pt")

    # Mock raw prediction output with box on a 640x480 frame
    mock_box = MagicMock()
    mock_box.cls = [0]
    mock_box.conf = [0.88]
    # Pixels: x1=64, y1=48, x2=320, y2=240 on (640, 480)
    mock_box.xyxy = [[64.0, 48.0, 320.0, 240.0]]

    normalized = detector.normalize_box(mock_box, img_w=640, img_h=480)
    assert normalized["cls"] == 0
    assert normalized["conf"] == 0.88
    assert normalized["x1"] == 0.10
    assert normalized["y1"] == 0.10
    assert normalized["x2"] == 0.50
    assert normalized["y2"] == 0.50

    # Ensure bounds clamping
    clamped_box = MagicMock()
    clamped_box.cls = [2]
    clamped_box.conf = [0.95]
    clamped_box.xyxy = [[-20.0, -10.0, 700.0, 500.0]]
    clamped = detector.normalize_box(clamped_box, img_w=640, img_h=480)
    assert 0.0 <= clamped["x1"] <= 1.0
    assert 0.0 <= clamped["y1"] <= 1.0
    assert 0.0 <= clamped["x2"] <= 1.0
    assert 0.0 <= clamped["y2"] <= 1.0
    assert clamped["x1"] == 0.0
    assert clamped["y1"] == 0.0
    assert clamped["x2"] == 1.0
    assert clamped["y2"] == 1.0


def test_toggle_without_model_reload_and_contiguous_seq_gate_g2_3():
    """Gate G2.3: Toggle off person => no person boxes; model loaded once; seq contiguous."""
    detector = YOLODetector(model_path="yolov8n.pt")
    initial_model = detector.model

    frame = np.zeros((480, 640, 3), dtype=np.uint8)

    # 1. Inference with person enabled
    res1 = detector.detect_frame(
        camera_id=1,
        frame=frame,
        active_classes=[0],
        confidence_threshold=0.35,
    )
    assert res1["camera_id"] == 1
    assert res1["seq"] == 1
    assert detector.model is initial_model

    # 2. Toggle off all classes (empty active_classes)
    res2 = detector.detect_frame(
        camera_id=1,
        frame=frame,
        active_classes=[],
        confidence_threshold=0.35,
    )
    assert res2["camera_id"] == 1
    assert res2["seq"] == 2
    assert len(res2["boxes"]) == 0
    # Model instance MUST NOT be reloaded or re-instantiated
    assert detector.model is initial_model

    # 3. Subsequent frame with active classes restores detection with contiguous seq
    res3 = detector.detect_frame(
        camera_id=1,
        frame=frame,
        active_classes=[0, 2],
        confidence_threshold=0.35,
    )
    assert res3["seq"] == 3
    assert detector.model is initial_model
