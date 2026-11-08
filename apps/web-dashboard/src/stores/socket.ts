import { defineStore } from "pinia";
import { ref } from "vue";
import { io, type Socket } from "socket.io-client";
import { useAuthStore } from "./auth.js";
import { useTelemetryStore } from "./telemetry.js";
import { useCamerasStore } from "./cameras.js";
import { cocoClassName } from "../data/cocoClasses.js";

export interface DetectionBox {
  bbox: [number, number, number, number]; // [x1, y1, x2, y2], normalized 0..1
  confidence: number;
  class_id: number;
  class_name: string;
}

export function normalizeDetectionBox(raw: any): DetectionBox | null {
  if (!raw) return null;
  const bbox = Array.isArray(raw.bbox)
    ? raw.bbox
    : [raw.x1, raw.y1, raw.x2, raw.y2];
  if (bbox.length !== 4 || bbox.some((v: unknown) => typeof v !== "number" || !Number.isFinite(v))) {
    return null;
  }
  const classId = Number(raw.class_id ?? raw.cls ?? -1);
  return {
    bbox: [bbox[0], bbox[1], bbox[2], bbox[3]],
    confidence: Number(raw.confidence ?? raw.conf ?? 0),
    class_id: classId,
    class_name: String(raw.class_name ?? cocoClassName(classId)),
  };
}

export interface CameraDetections {
  cameraId: number;
  timestamp: number;
  boxes: DetectionBox[];
}

export interface SystemAlertItem {
  id: number;
  level: string;
  type: string;
  message: string;
  timestamp: string;
}

export const useSocketStore = defineStore("socket", () => {
  const authStore = useAuthStore();
  const socket = ref<Socket | null>(null);
  const isConnected = ref<boolean>(false);
  const hasConnectedOnce = ref<boolean>(false);
  const activeRooms = ref<Set<number>>(new Set());
  // Throttle token-refresh attempts triggered by connect_error.
  let lastConnectRefresh = 0;

  // Store live detections per camera
  const cameraDetections = ref<Record<number, CameraDetections>>({});
  const systemAlerts = ref<SystemAlertItem[]>([]);
  const recordingStatusUpdates = ref<Record<number, string>>({});
  const vmafProgress = ref<Record<number, any>>({});
  let nextAlertId = 1;

  const dismissAlert = (id: number) => {
    systemAlerts.value = systemAlerts.value.filter((a) => a.id !== id);
  };

  const pushSystemAlert = (alert: any) => {
    const id = nextAlertId++;
    const item: SystemAlertItem = {
      id,
      level: String(alert?.level || "warn"),
      type: String(alert?.type || "system_alert"),
      message: String(alert?.reason || alert?.message || alert?.type || "Peringatan sistem diterima"),
      timestamp: String(alert?.timestamp || new Date().toISOString()),
    };
    systemAlerts.value = [item, ...systemAlerts.value].slice(0, 5);
    setTimeout(() => {
      dismissAlert(id);
    }, 10000);
  };

  const connect = () => {
    if (socket.value || !authStore.token) return;

    socket.value = io("/", {
      // Function form is re-evaluated before every (re)connection attempt, so a
      // rotated access token is always presented (no stale-token handshake).
      auth: (cb) => cb({ token: authStore.token ?? "" }),
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
    });

    socket.value.on("connect", () => {
      isConnected.value = true;
      hasConnectedOnce.value = true;
      // Re-join active rooms
      for (const camId of activeRooms.value) {
        socket.value?.emit("join:camera", camId);
      }
    });

    socket.value.on("disconnect", () => {
      isConnected.value = false;
    });

    socket.value.on("connect_error", async (err: any) => {
      isConnected.value = false;
      const now = Date.now();
      if (now - lastConnectRefresh < 5000) return;
      lastConnectRefresh = now;
      // The access token may have rotated while disconnected; refresh once and retry.
      const refreshed = await authStore.refreshAccessToken();
      if (refreshed) {
        socket.value?.connect();
      } else {
        console.warn("[socket] connect_error:", err?.message);
      }
    });

    socket.value.on("ai:detections", (data: any) => {
      const camId = Number(data.camera_id);
      if (camId) {
        const boxes = Array.isArray(data.boxes)
          ? data.boxes.map(normalizeDetectionBox).filter((b: DetectionBox | null): b is DetectionBox => b !== null)
          : [];
        cameraDetections.value[camId] = {
          cameraId: camId,
          timestamp: Date.now(),
          boxes,
        };
      }
    });

    socket.value.on("transcode:probe_step", (payload: any) => {
      const telemetryStore = useTelemetryStore();
      telemetryStore.addProbeStep(payload);
    });

    socket.value.on("system:alert", (alert: any) => {
      pushSystemAlert(alert);
    });

    // Spec §6.3 server events that previously had no consumer.
    socket.value.on("ai:class_state", (state: any) => {
      const camId = Number(state?.camera_id);
      if (!camId) return;
      const classes = Array.isArray(state.active_classes)
        ? state.active_classes
        : Array.isArray(state.resolved_active_ids)
          ? state.resolved_active_ids
          : [];
      useCamerasStore().applyClassState(camId, classes, Number(state.confidence_threshold));
    });

    socket.value.on("recording:status", (payload: any) => {
      const id = Number(payload?.recording_id);
      if (id) recordingStatusUpdates.value[id] = String(payload.status || "");
    });

    socket.value.on("vmaf:progress", (payload: any) => {
      const id = Number(payload?.recording_id);
      if (id) vmafProgress.value[id] = payload;
    });
  };

  const disconnect = () => {
    if (socket.value) {
      socket.value.disconnect();
      socket.value = null;
      isConnected.value = false;
      hasConnectedOnce.value = false;
    }
  };

  const joinCameraRoom = (cameraId: number) => {
    activeRooms.value.add(cameraId);
    if (socket.value && isConnected.value) {
      socket.value.emit("join:camera", cameraId);
    }
  };

  const leaveCameraRoom = (cameraId: number) => {
    activeRooms.value.delete(cameraId);
    if (socket.value && isConnected.value) {
      socket.value.emit("leave:camera", cameraId);
    }
    delete cameraDetections.value[cameraId];
  };

  return {
    isConnected,
    hasConnectedOnce,
    cameraDetections,
    systemAlerts,
    recordingStatusUpdates,
    vmafProgress,
    pushSystemAlert,
    dismissAlert,
    connect,
    disconnect,
    joinCameraRoom,
    leaveCameraRoom,
  };
});

