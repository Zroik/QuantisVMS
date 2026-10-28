import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import { io as ClientSocket, type Socket as ClientSocketType } from "socket.io-client";
import { createApp } from "../app.js";
import { setupSocketGateway } from "./gateway.js";
import { getDbPool, closeDbPool } from "../db/connection.js";
import { getRedisClient, closeRedisClients } from "../redis/client.js";
import { hashPassword, generateTokens } from "../auth/service.js";

describe("Gate G3.5: Socket.IO Gateway Authentication & Room-based Detections", () => {
  let server: http.Server;
  let serverPort: number;
  let validToken: string;
  let testCamId: number;

  const pool = getDbPool();
  const redis = getRedisClient();

  beforeAll(async () => {
    // 1. Start HTTP server + Socket.IO gateway on random available port
    const app = createApp();
    server = http.createServer(app);
    setupSocketGateway(server);

    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const addr = server.address() as any;
        serverPort = addr.port;
        resolve();
      });
    });

    // 2. Seed test viewer user and token
    await pool.query("DELETE FROM users WHERE username = 'socket_test_user'");
    const hashed = await hashPassword("SocketPass123!");
    const [userRes] = await pool.query<any>(
      "INSERT INTO users (username, password_hash, role) VALUES ('socket_test_user', ?, 'viewer')",
      [hashed]
    );
    const tokens = await generateTokens({
      userId: userRes.insertId,
      username: "socket_test_user",
      role: "viewer",
    });
    validToken = tokens.accessToken;

    // 3. Seed test camera
    const [camRes] = await pool.query<any>(
      `INSERT INTO cameras (name, rtsp_url_enc, rtsp_host, enabled, active_yolo_classes)
       VALUES ('Socket Test Cam', 0x1234, '127.0.0.1:554', 1, '[]')`
    );
    testCamId = camRes.insertId;
  });

  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    await pool.query("DELETE FROM cameras WHERE id = ?", [testCamId]);
    await pool.query("DELETE FROM users WHERE username = 'socket_test_user'");
    await closeDbPool();
    await closeRedisClients();
  });

  it("item 1: unauthenticated socket connection is rejected", async () => {
    let connectError: any = null;
    const socket: ClientSocketType = ClientSocket(`http://127.0.0.1:${serverPort}`, {
      transports: ["websocket"],
      reconnection: false,
    });

    await new Promise<void>((resolve) => {
      socket.on("connect_error", (err) => {
        connectError = err;
        socket.disconnect();
        resolve();
      });
      socket.on("connect", () => {
        socket.disconnect();
        resolve();
      });
    });

    expect(connectError).toBeDefined();
    expect(connectError.message).toContain("Authentication error");
  });

  it("item 2: socket connection with invalid token is rejected", async () => {
    let connectError: any = null;
    const socket: ClientSocketType = ClientSocket(`http://127.0.0.1:${serverPort}`, {
      auth: { token: "invalid.jwt.token" },
      transports: ["websocket"],
      reconnection: false,
    });

    await new Promise<void>((resolve) => {
      socket.on("connect_error", (err) => {
        connectError = err;
        socket.disconnect();
        resolve();
      });
      socket.on("connect", () => {
        socket.disconnect();
        resolve();
      });
    });

    expect(connectError).toBeDefined();
    expect(connectError.message).toContain("Authentication error");
  });

  it("item 3: socket connection with valid token succeeds, receives detections ONLY if joined to room", async () => {
    // Client 1: Joins camera room
    const clientJoined: ClientSocketType = ClientSocket(`http://127.0.0.1:${serverPort}`, {
      auth: { token: validToken },
      transports: ["websocket"],
      reconnection: false,
    });

    // Client 2: Does NOT join camera room
    const clientNotJoined: ClientSocketType = ClientSocket(`http://127.0.0.1:${serverPort}`, {
      auth: { token: validToken },
      transports: ["websocket"],
      reconnection: false,
    });

    await Promise.all([
      new Promise<void>((resolve) => clientJoined.on("connect", () => resolve())),
      new Promise<void>((resolve) => clientNotJoined.on("connect", () => resolve())),
    ]);

    expect(clientJoined.connected).toBe(true);
    expect(clientNotJoined.connected).toBe(true);

    // Client 1 joins room `camera:${testCamId}`
    clientJoined.emit("join:camera", { cameraId: testCamId });
    await new Promise((r) => setTimeout(r, 100)); // Allow join to register

    let joinedReceivedDetections: any = null;
    let notJoinedReceivedDetections: any = null;

    clientJoined.on("ai:detections", (data) => {
      joinedReceivedDetections = data;
    });

    clientNotJoined.on("ai:detections", (data) => {
      notJoinedReceivedDetections = data;
    });

    // Publish detection for testCamId on Redis channel ai:detections
    const testDetectionPayload = {
      camera_id: testCamId,
      boxes: [
        {
          class_id: 0,
          class_name: "person",
          confidence: 0.91,
          bbox: [0.1, 0.2, 0.3, 0.4],
        },
      ],
      frame_ts_ms: Date.now(),
      seq: 42,
    };

    await redis.publish("ai:detections", JSON.stringify(testDetectionPayload));

    // Wait for event dissemination
    await new Promise((r) => setTimeout(r, 200));

    // Client 1 MUST have received the detection
    expect(joinedReceivedDetections).toBeDefined();
    expect(joinedReceivedDetections.camera_id).toBe(testCamId);
    expect(joinedReceivedDetections.seq).toBe(42);

    // Client 2 MUST NOT have received the detection (Room isolation enforced)
    expect(notJoinedReceivedDetections).toBeNull();

    clientJoined.disconnect();
    clientNotJoined.disconnect();
  });

  it("item 4: client ai:toggle_class via socket executes toggle and returns ack", async () => {
    const socket: ClientSocketType = ClientSocket(`http://127.0.0.1:${serverPort}`, {
      auth: { token: validToken },
      transports: ["websocket"],
      reconnection: false,
    });

    await new Promise<void>((resolve) => socket.on("connect", () => resolve()));

    const ackResult = await new Promise<any>((resolve) => {
      socket.emit(
        "ai:toggle_class",
        {
          cameraId: testCamId,
          preset_groups: { person: true },
          confidence_threshold: 0.5,
        },
        (res: any) => resolve(res)
      );
    });

    expect(ackResult).toBeDefined();
    expect(ackResult.ok).toBe(true);
    expect(ackResult.resolved_active_ids).toEqual([0]);
    expect(ackResult.rev).toBeGreaterThan(0);

    socket.disconnect();
  });
});

