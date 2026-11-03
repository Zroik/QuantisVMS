"""Container healthcheck: the worker is only healthy if the control plane and
reader threads are alive, not merely if Redis accepts a TCP connection."""

import json
import os
import sys
import time
from typing import Any

import pymysql
import redis


def main() -> int:
    r = redis.Redis(
        host=os.getenv("REDIS_HOST", "redis"),
        port=int(os.getenv("REDIS_PORT", "6379")),
        password=os.getenv("REDIS_PASSWORD"),
        socket_connect_timeout=2,
        socket_timeout=2,
    )
    r.ping()
    raw = r.get("ai:heartbeat")
    if not raw:
        print("ai:heartbeat missing")
        return 1
    data: dict[str, Any] = json.loads(raw)
    age_ms = int(time.time() * 1000) - int(data.get("ts_ms", 0))
    if age_ms > 20000:
        print(f"ai:heartbeat stale ({age_ms}ms)")
        return 1
    dead = [cid for cid, alive in dict(data.get("readers_alive", {})).items() if not alive]
    if dead:
        print(f"dead reader threads: {dead}")
        return 1

    db = pymysql.connect(
        host=os.getenv("MYSQL_HOST", "mysql"),
        port=int(os.getenv("MYSQL_PORT", "3306")),
        user=os.getenv("MYSQL_USER", "vms_user"),
        password=os.getenv("MYSQL_PASSWORD"),
        database=os.getenv("MYSQL_DATABASE", "vms_db"),
        connect_timeout=3,
        read_timeout=3,
    )
    try:
        with db.cursor() as cur:
            cur.execute("SELECT 1")
    finally:
        db.close()
    print("ai-vision-worker healthy")
    return 0


if __name__ == "__main__":
    sys.exit(main())
