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
        connect_timeout=5,
        read_timeout=10,
        write_timeout=10,
    )


def listen_camera_changes(
    redis_client: redis.Redis,
    manager: VisionWorkerManager,
    stop_event: threading.Event,
) -> None:
    """Listen to Redis channels 'camera:changed' and 'system:config_changed' and dynamically update pipelines."""
    pubsub = redis_client.pubsub()
    pubsub.subscribe("camera:changed", "system:config_changed")
    logger.info("Subscribed to channels 'camera:changed' and 'system:config_changed'")

    mediamtx_host = os.getenv("MEDIAMTX_HOST", "mediamtx")
    mediamtx_port = os.getenv("MEDIAMTX_RTSP_PORT", "8554")
    mediamtx_secret = os.getenv("MEDIAMTX_AUTH_SECRET", "mediamtx_internal_token_secret")

    while not stop_event.is_set():
        try:
            msg = pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)
            if msg and msg["type"] == "message":
                channel = msg.get("channel")
                if isinstance(channel, bytes):
                    channel = channel.decode("utf-8")
                data = msg["data"]
                if isinstance(data, bytes):
                    data = data.decode("utf-8")
                payload = json.loads(data)

                if channel == "system:config_changed":
                    ai_cfg = payload.get("ai_engine")
                    if ai_cfg is None and isinstance(payload.get("config"), dict):
                        ai_cfg = payload["config"].get("ai_engine")
                    if isinstance(ai_cfg, dict):
                        manager.apply_ai_config(ai_cfg)
                    continue

                cam_id = int(payload.get("camera_id", 0))
                action = payload.get("action")

                if action in ("added", "updated") and cam_id > 0:
                    enabled = payload.get("enabled", True)
                    if not enabled:
                        logger.info("Camera %d disabled, stopping pipeline...", cam_id)
                        manager.remove_camera(cam_id)
                        continue
                    if action == "updated" and not payload.get("rtsp_url") and cam_id in manager.get_camera_ids():
                        continue
                    rtsp_url = f"rtsp://internal_reader:{mediamtx_secret}@{mediamtx_host}:{mediamtx_port}/cam{cam_id}"
                    logger.info("Camera %d %s, updating pipeline via MediaMTX...", cam_id, action)
                    manager.add_camera(cam_id, rtsp_url)
                elif action == "removed":
                    logger.info("Camera %d removed, stopping pipeline...", cam_id)
                    manager.remove_camera(cam_id)
        except (redis.RedisError, json.JSONDecodeError, ValueError, KeyError, OSError) as exc:
            if stop_event.is_set():
                break
            logger.error("Error processing pubsub event: %s", exc)

    pubsub.unsubscribe("camera:changed", "system:config_changed")
    pubsub.close()


def main() -> None:
    """Start the AI vision worker."""
    logger.info("Starting AI Vision Worker (Spec §8.2)...")

    model_path = os.getenv("MODEL_PATH", "yolov8n.pt")
    activity_window_sec = int(os.getenv("ACTIVITY_WINDOW_SEC", "20"))
    ai_fps = float(os.getenv("AI_FPS", "10.0"))
    if activity_window_sec <= 0 or activity_window_sec > 3600:
        raise ValueError("ACTIVITY_WINDOW_SEC must be between 1 and 3600")
    if ai_fps <= 0 or ai_fps > 60:
        raise ValueError("AI_FPS must be between 0.1 and 60")
    if not os.path.exists(model_path):
        raise FileNotFoundError(f"MODEL_PATH does not exist: {model_path}")

    # Connect to Redis (retry so a startup ordering blip does not permanently
    # disable toggles/telemetry/camera changes).
    r_client: redis.Redis | None = None
    for attempt in range(15):
        try:
            r_client = get_redis_client()
            r_client.ping()
            logger.info("Connected to Redis successfully.")
            break
        except (redis.RedisError, OSError) as exc:
            r_client = None
            if attempt == 14:
                logger.error("Could not connect to Redis after 15 attempts: %s", exc)
                if os.getenv("NODE_ENV", os.getenv("ENV", "production")) == "production":
                    raise
            else:
                logger.warning("Waiting for Redis (attempt %d/15): %s", attempt + 1, exc)
                time.sleep(2)

    # Connect to MySQL
    db_conn: Any = None
    for attempt in range(15):
        try:
            db_conn = get_mysql_connection()
            logger.info("Connected to MySQL successfully.")
            break
        except (pymysql.MySQLError, OSError) as exc:
            db_conn = None
            if attempt == 14:
                logger.error("Could not connect to MySQL after 15 attempts: %s", exc)
                if os.getenv("NODE_ENV", os.getenv("ENV", "production")) == "production":
                    raise
            else:
                logger.warning("Waiting for MySQL (attempt %d/15): %s", attempt + 1, exc)
                time.sleep(2)

    manager = VisionWorkerManager(
        model_path=model_path,
        redis_client=r_client,
        db_connection=db_conn,
        window_duration_sec=activity_window_sec,
        target_fps=ai_fps,
    )
    manager.start()

    # Spec §10 item E10: Register initial cameras from MySQL via MediaMTX internal stream
    mediamtx_host = os.getenv("MEDIAMTX_HOST", "mediamtx")
    mediamtx_port = os.getenv("MEDIAMTX_RTSP_PORT", "8554")
    mediamtx_secret = os.getenv("MEDIAMTX_AUTH_SECRET", "mediamtx_internal_token_secret")

    if db_conn is not None:
        try:
            with db_conn.cursor() as cur:
                cur.execute("SELECT id FROM cameras WHERE enabled = 1 AND parent_camera_id IS NULL")
                rows = cur.fetchall()
                for r in rows:
                    c_id = r["id"]
                    rtsp_url = f"rtsp://internal_reader:{mediamtx_secret}@{mediamtx_host}:{mediamtx_port}/cam{c_id}"
                    manager.add_camera(c_id, rtsp_url)
                    logger.info("Registered initial camera %d via MediaMTX stream", c_id)
        except (pymysql.MySQLError, RuntimeError, OSError) as exc:
            logger.error("Failed to load initial cameras from database: %s", exc)

    stop_event = threading.Event()

    def handle_exit(sig: int, frame: Any) -> None:
        logger.info("Shutdown signal received (%d). Terminating worker...", sig)
        stop_event.set()
        manager.stop()
        sys.exit(0)

    signal.signal(signal.SIGINT, handle_exit)
    signal.signal(signal.SIGTERM, handle_exit)

    # If Redis is active, start camera change listener and heartbeat.
    if r_client is not None:
        t_cam = threading.Thread(
            target=listen_camera_changes,
            args=(r_client, manager, stop_event),
            daemon=True,
            name="cam-listener",
        )
        t_cam.start()

        def heartbeat_loop() -> None:
            while not stop_event.is_set():
                try:
                    payload = json.dumps(
                        {
                            "ts_ms": int(time.time() * 1000),
                            "cameras": list(manager.get_camera_ids()),
                            "readers_alive": manager.get_reader_health(),
                            "consumers_alive": manager.get_consumer_health(),
                            "consumer_errors": manager.get_consumer_errors(),
                        }
                    )
                    r_client.set("ai:heartbeat", payload, ex=15)
                except (redis.RedisError, OSError) as exc:
                    logger.warning("AI heartbeat publish failed: %s", exc)
                stop_event.wait(5)

        threading.Thread(target=heartbeat_loop, daemon=True, name="ai-heartbeat").start()

    logger.info("AI Vision Worker initialized and ready.")

    try:
        while not stop_event.is_set():
            manager.check_and_restart_dead_pipelines()
            time.sleep(1.0)
    except KeyboardInterrupt:
        handle_exit(signal.SIGINT, None)


if __name__ == "__main__":
    main()
