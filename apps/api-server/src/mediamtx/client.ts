/**
 * Centralized MediaMTX API client with timeouts and unified secret management (Spec §6.4, B-M18).
 */

export function getMediaMtxAuthHeader(): string | null {
  const mediamtxSecret = process.env.MEDIAMTX_AUTH_SECRET;
  if (!mediamtxSecret) {
    console.error(
      "[MediaMTX Client] MEDIAMTX_AUTH_SECRET is not set; MediaMTX API sync is disabled. " +
        "Set it in the service environment."
    );
    return null;
  }
  return "Basic " + Buffer.from(`internal_reader:${mediamtxSecret}`).toString("base64");
}

export function getMediaMtxApiBaseUrl(): string {
  const host = process.env.MEDIAMTX_HOST || "mediamtx";
  const port = process.env.MEDIAMTX_API_PORT || 9997;
  return `http://${host}:${port}`;
}

export async function syncCameraToMediaMTX(camId: number, customSource?: string): Promise<boolean> {
  const baseUrl = getMediaMtxApiBaseUrl();
  const authHeader = getMediaMtxAuthHeader();
  if (!authHeader) return false;
  const source = customSource || `rtsp://rtsp-proxy:8555/cam${camId}`;

  const body = JSON.stringify({
    source,
    sourceOnDemand: false,
    rtspTransport: "tcp",
  });

  try {
    const checkRes = await fetch(`${baseUrl}/v3/config/paths/get/cam${camId}`, {
      headers: { Authorization: authHeader },
      signal: AbortSignal.timeout(5000),
    });

    if (checkRes.ok) {
      const patchRes = await fetch(`${baseUrl}/v3/config/paths/patch/cam${camId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: authHeader },
        body,
        signal: AbortSignal.timeout(5000),
      });
      return patchRes.ok;
    } else {
      const addRes = await fetch(`${baseUrl}/v3/config/paths/add/cam${camId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: authHeader },
        body,
        signal: AbortSignal.timeout(5000),
      });
      return addRes.ok;
    }
  } catch (err: any) {
    console.warn(`[MediaMTX Client] Could not sync camera ${camId}: ${err.message}`);
    return false;
  }
}

export async function removeCameraFromMediaMTX(camId: number): Promise<boolean> {
  const baseUrl = getMediaMtxApiBaseUrl();
  const authHeader = getMediaMtxAuthHeader();
  if (!authHeader) return false;

  try {
    const res = await fetch(`${baseUrl}/v3/config/paths/delete/cam${camId}`, {
      method: "DELETE",
      headers: { Authorization: authHeader },
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch (err: any) {
    console.warn(`[MediaMTX Client] Could not delete camera ${camId}: ${err.message}`);
    return false;
  }
}

