import { defineStore } from "pinia";
import { ref } from "vue";
import { apiFetch } from "../services/api.js";

export interface Camera {
  id: number;
  name: string;
  rtsp_url?: string;
  rtsp_host: string;
  enabled: boolean | number;
  active_yolo_classes: number[];
  confidence_threshold: number;
  target_vmaf: number;
  target_vmaf_p25: number;
  preferred_encoder: string;
  smart_ai_sampling: boolean | number;
  split_count?: number;
  slice_index?: number;
  parent_camera_id?: number | null;
  stream_path?: string;
  onvif_xaddr?: string | null;
  onvif_user?: string | null;
  onvif_capabilities?: {
    ptz?: boolean;
    imaging?: boolean;
    events?: boolean;
    mediaUrl?: string;
    imagingUrl?: string;
    ptzUrl?: string;
  } | null;
}

/**
 * Camera payload accepted by the write endpoints. `onvif_pass` is write-only:
 * the API encrypts it at rest and never returns it.
 */
export type CameraInput = Partial<Camera> & { onvif_pass?: string };

export const useCamerasStore = defineStore("cameras", () => {
  const cameras = ref<Camera[]>([]);
  const activeCameraId = ref<number | null>(null);
  const isLoading = ref<boolean>(false);
  const error = ref<string | null>(null);

  const fetchCameras = async () => {
    isLoading.value = true;
    error.value = null;
    try {
      const res = await apiFetch("/api/cameras");
      if (!res.ok) throw new Error("Failed to fetch cameras");
      const data = await res.json();
      const rawList = Array.isArray(data) ? data : data.cameras || [];
      cameras.value = rawList.map((c: any) => {
        let classes: number[] = [];
        if (Array.isArray(c.active_yolo_classes)) {
          classes = c.active_yolo_classes;
        } else if (Array.isArray(c.active_yolo_classes?.resolved_active_ids)) {
          classes = c.active_yolo_classes.resolved_active_ids;
        } else if (typeof c.active_yolo_classes === "string") {
          try {
            const parsed = JSON.parse(c.active_yolo_classes);
            classes = Array.isArray(parsed) ? parsed : parsed?.resolved_active_ids || [];
          } catch {
            classes = [];
          }
        }
        return {
          ...c,
          active_yolo_classes: classes,
          confidence_threshold: Number(c.confidence_threshold) || 0.25,
        };
      });

      if (cameras.value.length > 0 && !activeCameraId.value) {
        activeCameraId.value = cameras.value[0].id;
      }
    } catch (err: any) {
      error.value = err.message;
    } finally {
      isLoading.value = false;
    }
  };

  const updateCameraClasses = async (
    cameraId: number,
    classes: number[],
    confThreshold: number
  ): Promise<boolean> => {
    try {
      const res = await apiFetch(`/api/cameras/${cameraId}/classes`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          active_classes: classes,
          confidence_threshold: confThreshold,
        }),
      });

      if (!res.ok) return false;
      const data = await res.json();

      const cam = cameras.value.find((c) => c.id === cameraId);
      if (cam) {
        cam.active_yolo_classes = data.resolved_active_ids || data.active_classes || classes;
        cam.confidence_threshold = data.confidence_threshold || confThreshold;
      }
      return true;
    } catch {
      return false;
    }
  };

  const createCamera = async (cameraData: CameraInput): Promise<boolean> => {
    try {
      const res = await apiFetch("/api/cameras", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cameraData),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        error.value = data.error || (data.details ? JSON.stringify(data.details) : `Server error: ${res.status}`);
        return false;
      }
      await fetchCameras();
      return true;
    } catch (err: any) {
      error.value = err.message || "Network error";
      return false;
    }
  };

  const updateCamera = async (cameraId: number, cameraData: CameraInput): Promise<boolean> => {
    try {
      const res = await apiFetch(`/api/cameras/${cameraId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cameraData),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        error.value = data.error || (data.details ? JSON.stringify(data.details) : `Server error: ${res.status}`);
        return false;
      }
      await fetchCameras();
      return true;
    } catch (err: any) {
      error.value = err.message || "Network error";
      return false;
    }
  };

  const deleteCamera = async (cameraId: number): Promise<boolean> => {
    try {
      const res = await apiFetch(`/api/cameras/${cameraId}`, {
        method: "DELETE",
      });
      if (!res.ok) return false;
      cameras.value = cameras.value.filter((c) => c.id !== cameraId);
      if (activeCameraId.value === cameraId) {
        activeCameraId.value = cameras.value[0]?.id ?? null;
      }
      return true;
    } catch {
      return false;
    }
  };

  const splitCamera = async (cameraId: number, splitCount: number): Promise<boolean> => {
    try {
      const res = await apiFetch(`/api/cameras/${cameraId}/split`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ split_count: splitCount }),
      });
      if (!res.ok) return false;
      await fetchCameras();
      return true;
    } catch {
      return false;
    }
  };

  return {
    cameras,
    activeCameraId,
    isLoading,
    error,
    fetchCameras,
    updateCameraClasses,
    createCamera,
    updateCamera,
    deleteCamera,
    splitCamera,
  };
});

