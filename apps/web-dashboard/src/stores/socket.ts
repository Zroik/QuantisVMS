import { defineStore } from "pinia";
import { ref } from "vue";
import { io, type Socket } from "socket.io-client";
import { useAuthStore } from "./auth.js";
import { useTelemetryStore } from "./telemetry.js";
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

export const useSocketStore = defineStore("socket", () => {
  const authStore = useAuthStore();
  const socket = ref<Socket | null>(null);
  const isConnected = ref<boolean>(false);
  const activeRooms = ref<Set<number>>(new Set());

  // Store live detections per camera
  const cameraDetections = ref<Record<number, CameraDetections>>({});

  const connect = () => {
    if (socket.value || !authStore.token) return;

    socket.value = io("/", {
      auth: { token: authStore.token },
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
    });

    socket.value.on("connect", () => {
      isConnected.value = true;
      // Re-join active rooms
      for (const camId of activeRooms.value) {
        socket.value?.emit("join:camera", camId);
      }
    });

    socket.value.on("disconnect", () => {
      isConnected.value = false;
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
      console.warn("[SYSTEM ALERT]", alert);
    });
  };

  const disconnect = () => {
    if (socket.value) {
      socket.value.disconnect();
      socket.value = null;
      isConnected.value = false;
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
    cameraDetections,
    connect,
    disconnect,
    joinCameraRoom,
    leaveCameraRoom,
  };
});

