"""Main Entrypoint for AI Vision Worker Service (Spec §8.2)."""

import json
import logging
import os
import signal
import sys
import threading
import time
from typing import Any

import pymysql
import redis

from src.worker import VisionWorkerManager

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("ai-vision-worker")


def get_redis_client() -> redis.Redis:
    """Initialize Redis client from environment."""
    host = os.getenv("REDIS_HOST", "redis")
    port = int(os.getenv("REDIS_PORT", "6379"))
    password = os.getenv("REDIS_PASSWORD", "redis_password_secret")
    return redis.Redis(host=host, port=port, password=password, decode_responses=False)


def get_mysql_connection() -> pymysql.Connection:
    """Initialize MySQL connection from environment."""
    host = os.getenv("MYSQL_HOST", "mysql")
    port = int(os.getenv("MYSQL_PORT", "3306"))
    user = os.getenv("MYSQL_USER", "vms_user")
    password = os.getenv("MYSQL_PASSWORD", "vms_password_secret")
    database = os.getenv("MYSQL_DATABASE", "vms_db")

    return pymysql.connect(
        host=host,
        port=port,
        user=user,
        password=password,
        database=database,
        cursorclass=pymysql.cursors.DictCursor,
        autocommit=True,
    )


def listen_camera_changes(
    redis_client: redis.Redis,
    manager: VisionWorkerManager,
    stop_event: threading.Event,
) -> None:
    """Listen to Redis channel 'camera:changed' and dynamically update camera pipelines."""
    pubsub = redis_client.pubsub()
    pubsub.subscribe("camera:changed")
    logger.info("Subscribed to channel 'camera:changed'")

    while not stop_event.is_set():
        try:
            msg = pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)
            if msg and msg["type"] == "message":
                data = msg["data"]
                if isinstance(data, bytes):
                    data = data.decode("utf-8")
                payload = json.loads(data)
                cam_id = int(payload.get("camera_id", 0))
                action = payload.get("action")
                rtsp_url = payload.get("rtsp_url")

                if action in ("added", "updated") and rtsp_url:
                    logger.info("Camera %d %s, updating pipeline...", cam_id, action)
                    manager.add_camera(cam_id, rtsp_url)
                elif action == "removed":
                    logger.info("Camera %d removed, stopping pipeline...", cam_id)
                    manager.remove_camera(cam_id)
        except (json.JSONDecodeError, ValueError, KeyError, OSError) as exc:
            if stop_event.is_set():
                break
            logger.error("Error processing camera:changed event: %s", exc)

    pubsub.unsubscribe("camera:changed")
    pubsub.close()


def main() -> None:
    """Start the AI vision worker."""
    logger.info("Starting AI Vision Worker (Spec §8.2)...")

    model_path = os.getenv("MODEL_PATH", "yolov8n.pt")
    sample_duration_sec = int(os.getenv("PROBE_SAMPLE_SEC", "20"))
    ai_fps = float(os.getenv("AI_FPS", "10.0"))

    # Connect to Redis
    r_client: redis.Redis | None = None
    try:
        r_client = get_redis_client()
        r_client.ping()
        logger.info("Connected to Redis successfully.")
    except (redis.RedisError, OSError) as exc:
        logger.warning("Could not connect to Redis: %s (running in local mode)", exc)
        r_client = None

    # Connect to MySQL
    db_conn: Any = None
    try:
        db_conn = get_mysql_connection()
        logger.info("Connected to MySQL successfully.")
    except (pymysql.MySQLError, OSError) as exc:
        logger.warning("Could not connect to MySQL: %s (running in local mode)", exc)
        db_conn = None

    manager = VisionWorkerManager(
        model_path=model_path,
        redis_client=r_client,
        db_connection=db_conn,
        window_duration_sec=sample_duration_sec,
        target_fps=ai_fps,
    )
    manager.start()

    stop_event = threading.Event()

    def handle_exit(sig: int, frame: Any) -> None:
        logger.info("Shutdown signal received (%d). Terminating worker...", sig)
        stop_event.set()
        manager.stop()
        sys.exit(0)

    signal.signal(signal.SIGINT, handle_exit)
    signal.signal(signal.SIGTERM, handle_exit)

    # If Redis is active, start camera change listener
    if r_client is not None:
        t_cam = threading.Thread(
            target=listen_camera_changes,
            args=(r_client, manager, stop_event),
            daemon=True,
            name="cam-listener",
        )
        t_cam.start()

    logger.info("AI Vision Worker initialized and ready.")

    try:
        while not stop_event.is_set():
            time.sleep(1.0)
    except KeyboardInterrupt:
        handle_exit(signal.SIGINT, None)


if __name__ == "__main__":
    main()
