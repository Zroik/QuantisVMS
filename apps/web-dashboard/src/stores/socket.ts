import { defineStore } from "pinia";
import { ref } from "vue";
import { io, type Socket } from "socket.io-client";
import { useAuthStore } from "./auth.js";
import { useTelemetryStore } from "./telemetry.js";

export interface DetectionBox {
  bbox: [number, number, number, number]; // [ymin, xmin, ymax, xmax] or [x1, y1, x2, y2]
  confidence: number;
  class_id: number;
  class_name: string;
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
        cameraDetections.value[camId] = {
          cameraId: camId,
          timestamp: Date.now(),
          boxes: data.boxes || [],
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

