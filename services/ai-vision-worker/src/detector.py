"""YOLO26 Detector Engine Runner with Dynamic Class Filtering (Spec §8.2, Errata E3, Gates G2.1, G2.2, G2.3)."""

import logging
import os
import threading
import time
from collections.abc import Sequence
from typing import Any

import numpy as np
from ultralytics import YOLO

logger = logging.getLogger(__name__)


class YOLODetector:
    """
    Supervises a single loaded YOLO instance.
    Supports dynamic sub-second class filtering by passing classes=<ids> to predict()
    without reloading or recreating the model (Spec §8.2, Errata E3).
    """

    def __init__(self, model_path: str = "yolov8n.pt", device: str | None = None) -> None:
        self.model_path = model_path
        if device is None:
            try:
                import torch
                self.device = "cuda:0" if torch.cuda.is_available() else "cpu"
            except (ImportError, RuntimeError):
                self.device = "cpu"
        else:
            self.device = device

        logger.info("Loading YOLO model from %s on device %s...", model_path, self.device)
        self.model = YOLO(model_path)
        if self.device.startswith("cuda"):
            try:
                self.model.to(self.device)
            except (RuntimeError, ValueError) as e:
                # Falling back here matters: predict() is called with
                # device=self.device on every frame, so leaving "cuda:0" set
                # after a failed move would raise a RuntimeError per frame.
                logger.warning("Could not move model to %s (%s); falling back to CPU", self.device, e)
                self.device = "cpu"
        self._seq_by_camera: dict[int, int] = {}
        self._inference_lock = threading.Lock()
        logger.info(
            "YOLO model loaded successfully. Classes count: %d",
            len(self.model.names),
        )

    def get_class_names(self) -> dict[int, str]:
        """Return the mapping of class IDs to class names (Gate G2.1)."""
        # Ensure integer keys
        return {int(k): str(v) for k, v in self.model.names.items()}

    def normalize_box(self, box: Any, img_w: int, img_h: int) -> dict[str, Any]:
        """
        Extract and normalize bounding box coordinates to [0.0, 1.0] range (Gate G2.2).
        Clamps coordinates to guarantee strict adherence to [0.0, 1.0].
        """
        cls_id = int(box.cls[0])
        conf = float(box.conf[0])

        raw_xyxy = box.xyxy[0]
        x1_px = float(raw_xyxy[0])
        y1_px = float(raw_xyxy[1])
        x2_px = float(raw_xyxy[2])
        y2_px = float(raw_xyxy[3])

        # Normalize and clamp
        x1 = max(0.0, min(1.0, x1_px / max(1, img_w)))
        y1 = max(0.0, min(1.0, y1_px / max(1, img_h)))
        x2 = max(0.0, min(1.0, x2_px / max(1, img_w)))
        y2 = max(0.0, min(1.0, y2_px / max(1, img_h)))

        return {
            "cls": cls_id,
            "conf": round(conf, 4),
            "x1": round(x1, 4),
            "y1": round(y1, 4),
            "x2": round(x2, 4),
            "y2": round(y2, 4),
            "box": [round(x1, 4), round(y1, 4), round(x2, 4), round(y2, 4)],
        }

    def detect_frame(
        self,
        camera_id: int,
        frame: np.ndarray,
        active_classes: Sequence[int],
        confidence_threshold: float = 0.35,
        capture_ts_ms: int | None = None,
    ) -> dict[str, Any]:
        """
        Perform detection on a single frame.
        - seq is incremented contiguously per camera.
        - active_classes empty returns empty boxes immediately without GPU forward pass.
        - Errata E3: classes=<active_classes> and conf=<threshold> passed to predict; no nms=False.
        """
        frame_ts_ms = capture_ts_ms if capture_ts_ms is not None else int(time.time() * 1000)

        with self._inference_lock:
            # Contiguous sequence counter per camera (Gate G2.3)
            cur_seq = self._seq_by_camera.get(camera_id, 0) + 1
            self._seq_by_camera[camera_id] = cur_seq

            # Optimization: if no classes are active, return empty detections immediately
            if not active_classes:
                return {
                    "camera_id": camera_id,
                    "seq": cur_seq,
                    "frame_ts_ms": frame_ts_ms,
                    "boxes": [],
                    "latency_ms": 0.0,
                }

            start_time = time.perf_counter()
            img_h, img_w = frame.shape[:2]

            predict_kwargs: dict[str, Any] = {
                "source": frame,
                "classes": list(active_classes),
                "conf": confidence_threshold,
                "verbose": False,
                "imgsz": 640,
            }
            if self.device is not None:
                predict_kwargs["device"] = self.device

            try:
                results = self.model.predict(**predict_kwargs)
            except RuntimeError as exc:
                if self.device == "cpu":
                    raise
                # The GPU may disappear at runtime (driver reset, OOM, container
                # losing the device). Retry once on CPU and stay there instead of
                # failing every subsequent frame.
                logger.warning("Inference failed on %s (%s); retrying on CPU", self.device, exc)
                self.device = "cpu"
                predict_kwargs["device"] = "cpu"
                results = self.model.predict(**predict_kwargs)
            inference_duration_ms = round((time.perf_counter() - start_time) * 1000, 2)

        boxes: list[dict[str, Any]] = []
        if results and len(results) > 0 and results[0].boxes is not None:
            for b in results[0].boxes:
                boxes.append(self.normalize_box(b, img_w=img_w, img_h=img_h))

        return {
            "camera_id": camera_id,
            "seq": cur_seq,
            "frame_ts_ms": frame_ts_ms,
            "boxes": boxes,
            "latency_ms": inference_duration_ms,
        }

    def export_engine(
        self,
        target_path: str,
        half: bool = True,
        device: int | str = 0,
    ) -> str:
        """
        Export YOLO model to TensorRT engine cached in /data/models (Spec §8.2, Errata E3).
        """
        os.makedirs(os.path.dirname(os.path.abspath(target_path)), exist_ok=True)
        logger.info("Exporting YOLO model to TensorRT engine format: %s (half=%s)", target_path, half)
        with self._inference_lock:
            exported = self.model.export(
                format="engine",
                half=half,
                device=device,
            )
        return str(exported)
