export const API_SERVER_VERSION = "1.0.0";

export function getHealthStatus(): { status: string; timestamp: string } {
  return {
    status: "ok",
    timestamp: new Date().toISOString()
  };
}

