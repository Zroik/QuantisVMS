"""RTSP Camera Stream Reader & Frame Sampler (Spec §8.2, Gate G2.5)."""

import collections
import logging
import re
import threading
import time

import numpy as np

logger = logging.getLogger(__name__)


def mask_rtsp_url(url: str) -> str:
    """Mask credentials in RTSP URL for safe logging (Spec §10 item 6)."""
    # Matches rtsps?://username:password@host...
    return re.sub(r"://([^:]+):([^@]+)@", "://***:***@", url)


def calculate_reconnect_backoff(attempt: int, base_sec: float = 1.0, max_sec: float = 30.0) -> float:
    """Calculate exponential backoff capped at max_sec (Gate G2.5: reconnect <= 30s)."""
    return min(max_sec, base_sec * (2.0 ** attempt))


class FrameQueue:
    """
    Thread-safe bounded frame queue that drops the oldest frame when full.
    Prevents unbounded queue growth and latency spikes (Spec §8.2).
    """

    def __init__(self, maxsize: int = 2) -> None:
        self.maxsize = maxsize
        self._queue: collections.deque[tuple[float, np.ndarray]] = collections.deque(maxlen=maxsize)
        self._lock = threading.Lock()
        self._not_empty = threading.Condition(self._lock)

    def put(self, item: tuple[float, np.ndarray]) -> bool:
        """
        Push a frame. If queue is at capacity, the oldest frame is dropped.
        Returns True if a frame was dropped, False otherwise.
        """
        with self._lock:
            dropped = len(self._queue) >= self.maxsize
            self._queue.append(item)
            self._not_empty.notify()
            return dropped

    def get(self, timeout: float | None = None) -> tuple[float, np.ndarray]:
        """Pop the oldest frame, blocking up to timeout seconds."""
        with self._not_empty:
            if not self._queue and not self._not_empty.wait(timeout=timeout):
                raise TimeoutError("Frame queue timed out waiting for frame")
            if not self._queue:
                raise TimeoutError("Frame queue empty after wait")
            return self._queue.popleft()

    def empty(self) -> bool:
        """Return True if queue contains no items."""
        with self._lock:
            return len(self._queue) == 0

    def size(self) -> int:
        """Return current number of items in queue."""
        with self._lock:
            return len(self._queue)


class CameraStreamReader:
    """
    Decodes RTSP stream using PyAV, samples at AI_FPS (default 10 FPS),
    drops frames when behind, and handles auto-reconnect with backoff.
    """

    def __init__(
        self,
        camera_id: int,
        rtsp_url: str,
        target_fps: float = 10.0,
        max_reconnect_backoff_sec: float = 30.0,
    ) -> None:
        self.camera_id = camera_id
        self.rtsp_url = rtsp_url
        self.target_fps = target_fps
        self.sample_interval_sec = 1.0 / max(0.1, target_fps)
        self.max_reconnect_backoff_sec = max_reconnect_backoff_sec

        self._last_sample_ts: float = -float("inf")
        self.last_frame_ts: float = 0.0
        self.is_connected: bool = False

    def should_sample_frame(self, timestamp: float) -> bool:
        """Determine if a frame at given timestamp should be sampled at AI_FPS."""
        if (timestamp - self._last_sample_ts) >= (self.sample_interval_sec - 0.001):
            self._last_sample_ts = timestamp
            return True
        return False

    def run_reader(self, queue: FrameQueue, stop_event: threading.Event) -> None:
        """
        Main reader loop: decodes stream and enqueues sampled frames.
        Automatically reconnects on failure with exponential backoff.
        """
        import av

        masked_url = mask_rtsp_url(self.rtsp_url)
        reconnect_attempt = 0

        while not stop_event.is_set():
            logger.info("Connecting to stream for camera %d: %s", self.camera_id, masked_url)
            conn_start_time = time.time()

            try:
                # Open container with TCP transport
                container = av.open(
                    self.rtsp_url,
                    options={"rtsp_transport": "tcp", "stimeout": "5000000"},
                )
                video_stream = next((s for s in container.streams if s.type == "video"), None)
                if video_stream is None:
                    raise ValueError(f"No video stream found for camera {self.camera_id}")

                # Cap PyAV decoding threads to 1 per stream to prevent CPU core saturation
                video_stream.codec_context.thread_count = 1
                video_stream.codec_context.thread_type = "FRAME"

                self.is_connected = True
                logger.info(
                    "Connected to stream for camera %d (%s, %dx%d)",
                    self.camera_id,
                    video_stream.codec_context.name,
                    video_stream.width or 0,
                    video_stream.height or 0,
                )

                for frame in container.decode(video_stream):
                    if stop_event.is_set():
                        break

                    now = time.time()
                    self.last_frame_ts = now

                    # Reset reconnect backoff if connection has survived over 60 seconds
                    if (now - conn_start_time) > 60.0:
                        reconnect_attempt = 0

                    if self.should_sample_frame(now):
                        # Convert frame to numpy BGR array for YOLO
                        img = frame.to_ndarray(format="bgr24")
                        queue.put((now, img))

                container.close()
            except (av.AVError, ValueError, OSError, TimeoutError, RuntimeError) as exc:
                self.is_connected = False
                if stop_event.is_set():
                    break

                backoff_sec = calculate_reconnect_backoff(
                    reconnect_attempt,
                    base_sec=1.0,
                    max_sec=self.max_reconnect_backoff_sec,
                )
                logger.warning(
                    "Stream disconnected for camera %d (%s): %s. Reconnecting in %.1fs (attempt %d)...",
                    self.camera_id,
                    masked_url,
                    exc,
                    backoff_sec,
                    reconnect_attempt,
                )
                reconnect_attempt += 1
                stop_event.wait(backoff_sec)
