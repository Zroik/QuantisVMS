"""GPU Telemetry Publisher via NVML (Spec §6.2, §8.2)."""

import json
import logging
import threading
import time
from typing import Any

try:
    import pynvml
except ImportError:
    pynvml = None

logger = logging.getLogger(__name__)

# Base exception types to catch from NVML
NVML_EXCEPTIONS: tuple[type[BaseException], ...]
if pynvml is not None:
    NVML_EXCEPTIONS = (pynvml.NVMLError, OSError, AttributeError, ValueError, RuntimeError)
else:
    NVML_EXCEPTIONS = (OSError, AttributeError, ValueError, RuntimeError)


class GPUStatsCollector:
    """
    Queries NVIDIA Management Library (NVML) every 2 seconds for hardware telemetry:
    {gpu_util, vram_used_mb, vram_total_mb, temp_c, enc_util, dec_util}
    and publishes the JSON payload to Redis channel 'hw:gpu' (Spec §6.2).
    """

    def __init__(self, gpu_index: int = 0) -> None:
        self.gpu_index = gpu_index
        self._nvml_initialized = False
        self._handle = None

        if pynvml is not None:
            try:
                pynvml.nvmlInit()
                self._handle = pynvml.nvmlDeviceGetHandleByIndex(gpu_index)
                self._nvml_initialized = True
                name = pynvml.nvmlDeviceGetName(self._handle)
                if isinstance(name, bytes):
                    name = name.decode("utf-8")
                logger.info("Initialized NVML for GPU %d: %s", gpu_index, name)
            except NVML_EXCEPTIONS as exc:
                logger.warning(
                    "NVML initialization failed for GPU %d: %s. Using telemetry fallback.",
                    gpu_index,
                    exc,
                )

    def collect_stats_fallback(self) -> dict[str, float]:
        """Safe fallback telemetry when NVML is not available."""
        return {
            "gpu_util": 0.0,
            "vram_used_mb": 0.0,
            "vram_total_mb": 0.0,
            "temp_c": 0.0,
            "enc_util": 0.0,
            "dec_util": 0.0,
        }

    def collect_nvml_stats(self, handle: Any) -> dict[str, float]:
        """Read metrics from an active NVML device handle."""
        util = pynvml.nvmlDeviceGetUtilizationRates(handle)
        gpu_util = float(util.gpu)

        mem = pynvml.nvmlDeviceGetMemoryInfo(handle)
        vram_used_mb = round(mem.used / (1024.0 * 1024.0), 1)
        vram_total_mb = round(mem.total / (1024.0 * 1024.0), 1)

        try:
            temp_c = float(pynvml.nvmlDeviceGetTemperature(handle, pynvml.NVML_TEMPERATURE_GPU))
        except NVML_EXCEPTIONS:
            temp_c = 0.0

        try:
            enc_util = float(pynvml.nvmlDeviceGetEncoderUtilization(handle)[0])
        except NVML_EXCEPTIONS:
            enc_util = 0.0

        try:
            dec_util = float(pynvml.nvmlDeviceGetDecoderUtilization(handle)[0])
        except NVML_EXCEPTIONS:
            dec_util = 0.0

        return {
            "gpu_util": gpu_util,
            "vram_used_mb": vram_used_mb,
            "vram_total_mb": vram_total_mb,
            "temp_c": temp_c,
            "enc_util": enc_util,
            "dec_util": dec_util,
        }

    def collect_stats(self) -> dict[str, float]:
        """Collect current GPU stats or return fallback."""
        if self._nvml_initialized and self._handle is not None and pynvml is not None:
            try:
                return self.collect_nvml_stats(self._handle)
            except NVML_EXCEPTIONS as exc:
                logger.warning("Error querying NVML stats: %s", exc)
        return self.collect_stats_fallback()

    def publish_loop(
        self,
        redis_client: Any,
        channel: str = "hw:gpu",
        stop_event: threading.Event | None = None,
        interval_sec: float = 2.0,
    ) -> None:
        """Publish GPU telemetry to Redis channel 'hw:gpu' every interval_sec (Spec §6.2)."""
        logger.info("Starting GPU telemetry publisher loop (interval=%.1fs)...", interval_sec)
        while stop_event is None or not stop_event.is_set():
            try:
                stats = self.collect_stats()
                payload = json.dumps(stats)
                redis_client.set("hw:gpu", payload)
                redis_client.publish(channel, payload)
            except (OSError, ConnectionError, ValueError, TypeError) as exc:
                if stop_event and stop_event.is_set():
                    break
                logger.error("Error publishing GPU telemetry: %s", exc)

            if stop_event is not None:
                stop_event.wait(interval_sec)
            else:
                time.sleep(interval_sec)
