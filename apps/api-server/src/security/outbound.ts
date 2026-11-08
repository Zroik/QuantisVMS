/**
 * Minimal SSRF guard for admin-supplied outbound targets.
 *
 * Private/LAN ranges are intentionally allowed (ONVIF cameras and NTP servers
 * legitimately live there). Loopback and cloud metadata endpoints are blocked,
 * which removes the highest-value SSRF targets from a compromised admin session.
 */
const BLOCKED_HOSTS = new Set([
  "localhost",
  "metadata",
  "metadata.google.internal",
  "169.254.169.254",
  "100.100.100.200", // Alibaba Cloud metadata
  "fd00:ec2::254", // AWS IPv6 metadata
]);

export function isBlockedOutboundHost(host: string): boolean {
  const normalized = String(host || "").trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (!normalized) return true;
  if (BLOCKED_HOSTS.has(normalized)) return true;
  if (normalized === "::1") return true;
  if (normalized === "0.0.0.0") return true;
  if (normalized.startsWith("127.")) return true;
  return false;
}

export function assertAllowedOutboundUrl(rawUrl: string, allowedProtocols: string[] = ["http:", "https:"]): void {
  const parsed = new URL(rawUrl);
  if (!allowedProtocols.includes(parsed.protocol)) {
    throw new Error(`Unsupported protocol: ${parsed.protocol}`);
  }
  if (isBlockedOutboundHost(parsed.hostname)) {
    throw new Error(`Blocked outbound host: ${parsed.hostname}`);
  }
}
