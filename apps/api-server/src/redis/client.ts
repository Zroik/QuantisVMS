import { Redis } from "ioredis";
import path from "node:path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });
dotenv.config({ path: path.resolve(process.cwd(), "../.env") });
dotenv.config({ path: path.resolve(process.cwd(), "../../.env") });

let redisClient: Redis | null = null;
let redisSubClient: Redis | null = null;
let redisRateLimitClient: Redis | null = null;

/**
 * ioredis emits an `error` event for connection problems; with no listener that
 * is an unhandled exception that can terminate the process. Always attach one.
 */
function attachErrorHandler(client: Redis, label: string): void {
  client.on("error", (err) => {
    console.error(`[Redis:${label}] ${err.message}`);
  });
}

function baseOptions() {
  return {
    host: process.env.REDIS_HOST || "127.0.0.1",
    port: Number(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
  };
}

/**
 * Shared client for general use and BullMQ. BullMQ requires
 * `maxRetriesPerRequest: null` because it issues blocking commands.
 */
export function getRedisClient(): Redis {
  if (!redisClient) {
    redisClient = new Redis({
      ...baseOptions(),
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      retryStrategy(times) {
        return Math.min(times * 100, 3000);
      },
    });
    attachErrorHandler(redisClient, "main");
  }
  return redisClient;
}

export function getRedisSubClient(): Redis {
  if (!redisSubClient) {
    redisSubClient = new Redis({
      ...baseOptions(),
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      retryStrategy(times) {
        return Math.min(times * 100, 3000);
      },
    });
    attachErrorHandler(redisSubClient, "sub");
  }
  return redisSubClient;
}

/**
 * Dedicated low-latency client for request rate limiting. Unlike the main
 * client it has finite retries, no offline queue, and a command timeout, so a
 * Redis outage surfaces as an error quickly instead of hanging the request.
 * (Spec §10 item 3.)
 */
export function getRateLimitRedis(): Redis {
  if (!redisRateLimitClient) {
    redisRateLimitClient = new Redis({
      ...baseOptions(),
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      commandTimeout: 1000,
      enableReadyCheck: true,
      retryStrategy(times) {
        return Math.min(times * 200, 2000);
      },
    });
    attachErrorHandler(redisRateLimitClient, "ratelimit");
  }
  return redisRateLimitClient;
}

export async function closeRedisClients(): Promise<void> {
  const clients = [redisClient, redisSubClient, redisRateLimitClient];
  redisClient = null;
  redisSubClient = null;
  redisRateLimitClient = null;
  for (const client of clients) {
    if (client) {
      try {
        await client.quit();
      } catch {}
    }
  }
}
