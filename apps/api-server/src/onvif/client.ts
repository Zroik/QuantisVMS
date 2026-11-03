import crypto from "node:crypto";

export interface OnvifCapabilities {
  device: string;
  media?: string;
  imaging?: string;
  ptz?: string;
  events?: string;
}

export interface OnvifProfile {
  token: string;
  name: string;
  videoSourceToken?: string;
  width?: number;
  height?: number;
  streamUri?: string;
}

export interface OnvifImagingSettings {
  brightness?: number;
  colorSaturation?: number;
  contrast?: number;
  sharpness?: number;
  irCutFilter?: "AUTO" | "ON" | "OFF";
  wdr?: boolean;
}

/**
 * Calculates clock offset against camera to prevent ter:NotAuthorized errors
 * due to clock drift (OASIS WS-Security replay window protection).
 */
export async function getClockOffset(deviceServiceUrl: string): Promise<number> {
  const soap = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope">
  <s:Body><GetSystemDateAndTime xmlns="http://www.onvif.org/ver10/device/wsdl"/></s:Body>
</s:Envelope>`;

  try {
    const res = await fetch(deviceServiceUrl, {
      method: "POST",
      headers: { "Content-Type": "application/soap+xml; charset=utf-8" },
      body: soap,
      signal: AbortSignal.timeout(4000),
    });
    const xml = await res.text();

    const yearMatch = xml.match(/<[^:]*:Year>(\d+)<\/[^:]*:Year>/);
    const monthMatch = xml.match(/<[^:]*:Month>(\d+)<\/[^:]*:Month>/);
    const dayMatch = xml.match(/<[^:]*:Day>(\d+)<\/[^:]*:Day>/);
    const hourMatch = xml.match(/<[^:]*:Hour>(\d+)<\/[^:]*:Hour>/);
    const minMatch = xml.match(/<[^:]*:Minute>(\d+)<\/[^:]*:Minute>/);
    const secMatch = xml.match(/<[^:]*:Second>(\d+)<\/[^:]*:Second>/);

    if (yearMatch && monthMatch && dayMatch && hourMatch && minMatch && secMatch) {
      const camDate = new Date(Date.UTC(
        parseInt(yearMatch[1], 10),
        parseInt(monthMatch[1], 10) - 1,
        parseInt(dayMatch[1], 10),
        parseInt(hourMatch[1], 10),
        parseInt(minMatch[1], 10),
        parseInt(secMatch[1], 10)
      ));
      return camDate.getTime() - Date.now();
    }
  } catch {
    // Fallback to local system time if camera does not reply with UTC datetime
  }
  return 0;
}

export function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Generates OASIS WS-Security UsernameToken PasswordDigest header.
 * Formula: Password_Digest = Base64( SHA-1( Nonce + Created + Password ) )
 */
export function buildWsSecurityHeader(username?: string, password?: string, offsetMs = 0): string {
  if (!username) return "";
  const safePass = password || "";
  const nonceBuf = crypto.randomBytes(16);
  const createdDate = new Date(Date.now() + offsetMs);
  const created = createdDate.toISOString().replace(/\.\d{3}Z$/, "Z");

  const sha = crypto.createHash("sha1");
  sha.update(Buffer.concat([
    nonceBuf,
    Buffer.from(created, "utf8"),
    Buffer.from(safePass, "utf8"),
  ]));
  const passwordDigest = sha.digest("base64");
  const nonceB64 = nonceBuf.toString("base64");

  return `<s:Header>
    <wsse:Security xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd" xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">
      <wsse:UsernameToken>
        <wsse:Username>${escapeXml(username)}</wsse:Username>
        <wsse:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest">${passwordDigest}</wsse:Password>
        <wsse:Nonce EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary">${nonceB64}</wsse:Nonce>
        <wsu:Created>${created}</wsu:Created>
      </wsse:UsernameToken>
    </wsse:Security>
  </s:Header>`;
}

/**
 * Sanitizes URLs returned by cameras that might use localhost or 0.0.0.0
 * (The FixUrl pattern from ODM NvtSession.fs).
 */
export function sanitizeXAddr(reportedUrl: string, actualIp: string): string {
  try {
    const parsed = new URL(reportedUrl);
    if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "0.0.0.0") {
      parsed.hostname = actualIp;
      return parsed.toString();
    }
    return reportedUrl;
  } catch {
    return reportedUrl;
  }
}

/**
 * Queries camera capabilities (Device, Media, Imaging, PTZ).
 */
export async function getCapabilities(
  deviceServiceUrl: string,
  username?: string,
  password?: string,
  offsetMs = 0
): Promise<OnvifCapabilities> {
  const urlObj = new URL(deviceServiceUrl);
  const actualIp = urlObj.hostname;

  const soap = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope">
  ${buildWsSecurityHeader(username, password, offsetMs)}
  <s:Body><GetCapabilities xmlns="http://www.onvif.org/ver10/device/wsdl"><Category>All</Category></GetCapabilities></s:Body>
</s:Envelope>`;

  const res = await fetch(deviceServiceUrl, {
    method: "POST",
    headers: { "Content-Type": "application/soap+xml; charset=utf-8" },
    body: soap,
    signal: AbortSignal.timeout(5000),
  });

  if (!res.ok) {
    throw new Error(`GetCapabilities failed with HTTP ${res.status}`);
  }

  const xml = await res.text();

  const extractXAddr = (serviceTag: string) => {
    const rx = new RegExp(`<[^:]*:${serviceTag}>[\\s\\S]*?<[^:]*:XAddr>([^<]+)<\\/[^:]*:XAddr>`, "i");
    const m = xml.match(rx);
    return m ? sanitizeXAddr(m[1].trim(), actualIp) : undefined;
  };

  return {
    device: deviceServiceUrl,
    media: extractXAddr("Media"),
    imaging: extractXAddr("Imaging"),
    ptz: extractXAddr("PTZ"),
    events: extractXAddr("Events"),
  };
}

/**
 * Queries configured media profiles from the camera.
 */
export async function getProfiles(
  mediaUrl: string,
  username?: string,
  password?: string,
  offsetMs = 0
): Promise<OnvifProfile[]> {
  const soap = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope">
  ${buildWsSecurityHeader(username, password, offsetMs)}
  <s:Body><GetProfiles xmlns="http://www.onvif.org/ver10/media/wsdl"/></s:Body>
</s:Envelope>`;

  const res = await fetch(mediaUrl, {
    method: "POST",
    headers: { "Content-Type": "application/soap+xml; charset=utf-8" },
    body: soap,
    signal: AbortSignal.timeout(5000),
  });

  if (!res.ok) {
    throw new Error(`GetProfiles failed with HTTP ${res.status}`);
  }

  const xml = await res.text();
  const profiles: OnvifProfile[] = [];

  // Match Profiles block
  const profileBlocks = xml.split(/<[^:]*:Profiles\b/i).slice(1);
  for (const block of profileBlocks) {
    const tokenMatch = block.match(/^[^>]*token="([^"]+)"/);
    if (!tokenMatch) continue;
    const token = tokenMatch[1];

    const nameMatch = block.match(/<[^:]*:Name>([^<]+)<\/[^:]*:Name>/);
    const name = nameMatch ? nameMatch[1].trim() : token;

    const vsTokenMatch = block.match(/<[^:]*:SourceToken>([^<]+)<\/[^:]*:SourceToken>/);
    const videoSourceToken = vsTokenMatch ? vsTokenMatch[1].trim() : undefined;

    const widthMatch = block.match(/<[^:]*:Width>(\d+)<\/[^:]*:Width>/);
    const heightMatch = block.match(/<[^:]*:Height>(\d+)<\/[^:]*:Height>/);
    const width = widthMatch ? parseInt(widthMatch[1], 10) : undefined;
    const height = heightMatch ? parseInt(heightMatch[1], 10) : undefined;

    profiles.push({
      token,
      name,
      videoSourceToken,
      width,
      height,
    });
  }

  return profiles;
}

/**
 * Resolves the live RTSP stream URI for a media profile token.
 */
export async function getStreamUri(
  mediaUrl: string,
  profileToken: string,
  username?: string,
  password?: string,
  offsetMs = 0
): Promise<string | null> {
  const soap = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope">
  ${buildWsSecurityHeader(username, password, offsetMs)}
  <s:Body>
    <GetStreamUri xmlns="http://www.onvif.org/ver10/media/wsdl">
      <StreamSetup>
        <Stream xmlns="http://www.onvif.org/ver10/schema">RTP-Unicast</Stream>
        <Transport xmlns="http://www.onvif.org/ver10/schema">
          <Protocol>RTSP</Protocol>
        </Transport>
      </StreamSetup>
      <ProfileToken>${escapeXml(profileToken)}</ProfileToken>
    </GetStreamUri>
  </s:Body>
</s:Envelope>`;

  const res = await fetch(mediaUrl, {
    method: "POST",
    headers: { "Content-Type": "application/soap+xml; charset=utf-8" },
    body: soap,
    signal: AbortSignal.timeout(5000),
  });

  if (!res.ok) {
    return null;
  }

  const xml = await res.text();
  const uriMatch = xml.match(/<[^:]*:Uri>([^<]+)<\/[^:]*:Uri>/);
  if (!uriMatch) return null;

  let streamUri = uriMatch[1].trim().replace(/&amp;/g, "&");

  // B-M23: If credentials provided and URL doesn't have userinfo prefix, inject them (supports rtsp:// and rtsps://)
  if (username) {
    try {
      const parsed = new URL(streamUri);
      if (!parsed.username) {
        parsed.username = encodeURIComponent(username);
        if (password) {
          parsed.password = encodeURIComponent(password);
        }
        streamUri = parsed.toString();
      }
    } catch {
      if (!streamUri.match(/^rtsp[s]?:\/\/[^@]+@/)) {
        const safePass = password ? encodeURIComponent(password) : "";
        streamUri = streamUri.replace(/^(rtsp[s]?:\/\/)/i, `$1${encodeURIComponent(username)}:${safePass}@`);
      }
    }
  }

  return streamUri;
}

/**
 * Queries current ISP Imaging settings (Day/Night IrCutFilter, Brightness, Contrast, WDR).
 */
export async function getImagingSettings(
  imagingUrl: string,
  videoSourceToken: string,
  username?: string,
  password?: string,
  offsetMs = 0
): Promise<OnvifImagingSettings> {
  const soap = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope">
  ${buildWsSecurityHeader(username, password, offsetMs)}
  <s:Body>
    <GetImagingSettings xmlns="http://www.onvif.org/ver20/imaging/wsdl">
      <VideoSourceToken>${escapeXml(videoSourceToken)}</VideoSourceToken>
    </GetImagingSettings>
  </s:Body>
</s:Envelope>`;

  const res = await fetch(imagingUrl, {
    method: "POST",
    headers: { "Content-Type": "application/soap+xml; charset=utf-8" },
    body: soap,
    signal: AbortSignal.timeout(5000),
  });

  if (!res.ok) {
    throw new Error(`GetImagingSettings failed with HTTP ${res.status}`);
  }

  const xml = await res.text();

  const parseNum = (tag: string) => {
    const m = xml.match(new RegExp(`<[^:]*:${tag}>([\\d.-]+)<\\/[^:]*:${tag}>`, "i"));
    return m ? parseFloat(m[1]) : undefined;
  };

  const irMatch = xml.match(/<[^:]*:IrCutFilter>([^<]+)<\/[^:]*:IrCutFilter>/i);
  const irCutFilter = irMatch ? (irMatch[1].trim().toUpperCase() as "AUTO" | "ON" | "OFF") : undefined;

  const wdrMatch = xml.match(/<[^:]*:WideDynamicRange>[\s\S]*?<[^:]*:Mode>([^<]+)<\/[^:]*:Mode>/i);
  const wdr = wdrMatch ? wdrMatch[1].trim().toUpperCase() === "ON" : undefined;

  return {
    brightness: parseNum("Brightness"),
    colorSaturation: parseNum("ColorSaturation"),
    contrast: parseNum("Contrast"),
    sharpness: parseNum("Sharpness"),
    irCutFilter,
    wdr,
  };
}

/**
 * Updates ISP Imaging settings (Day/Night switch, Brightness, etc.).
 */
export async function setImagingSettings(
  imagingUrl: string,
  videoSourceToken: string,
  settings: OnvifImagingSettings,
  username?: string,
  password?: string,
  offsetMs = 0
): Promise<boolean> {
  let settingsXml = "";
  if (settings.brightness !== undefined) {
    settingsXml += `<tt:Brightness>${settings.brightness}</tt:Brightness>`;
  }
  if (settings.colorSaturation !== undefined) {
    settingsXml += `<tt:ColorSaturation>${settings.colorSaturation}</tt:ColorSaturation>`;
  }
  if (settings.contrast !== undefined) {
    settingsXml += `<tt:Contrast>${settings.contrast}</tt:Contrast>`;
  }
  if (settings.sharpness !== undefined) {
    settingsXml += `<tt:Sharpness>${settings.sharpness}</tt:Sharpness>`;
  }
  if (settings.irCutFilter) {
    settingsXml += `<tt:IrCutFilter>${settings.irCutFilter}</tt:IrCutFilter>`;
  }
  if (settings.wdr !== undefined) {
    settingsXml += `<tt:WideDynamicRange><tt:Mode>${settings.wdr ? "ON" : "OFF"}</tt:Mode></tt:WideDynamicRange>`;
  }

  const soap = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:tt="http://www.onvif.org/ver10/schema">
  ${buildWsSecurityHeader(username, password, offsetMs)}
  <s:Body>
    <SetImagingSettings xmlns="http://www.onvif.org/ver20/imaging/wsdl">
      <VideoSourceToken>${escapeXml(videoSourceToken)}</VideoSourceToken>
      <ImagingSettings>${settingsXml}</ImagingSettings>
      <ForcePersistence>true</ForcePersistence>
    </SetImagingSettings>
  </s:Body>
</s:Envelope>`;

  const res = await fetch(imagingUrl, {
    method: "POST",
    headers: { "Content-Type": "application/soap+xml; charset=utf-8" },
    body: soap,
    signal: AbortSignal.timeout(5000),
  });

  return res.ok;
}

/**
 * Continuous PTZ movement (Pan, Tilt, Zoom vectors from -1.0 to +1.0).
 */
export async function continuousMove(
  ptzUrl: string,
  profileToken: string,
  velocity: { x?: number; y?: number; zoom?: number },
  username?: string,
  password?: string,
  offsetMs = 0
): Promise<boolean> {
  const panTiltXml = (velocity.x !== undefined || velocity.y !== undefined)
    ? `<tt:PanTilt x="${velocity.x ?? 0}" y="${velocity.y ?? 0}"/>`
    : "";
  const zoomXml = (velocity.zoom !== undefined)
    ? `<tt:Zoom x="${velocity.zoom}"/>`
    : "";

  const soap = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:tt="http://www.onvif.org/ver10/schema">
  ${buildWsSecurityHeader(username, password, offsetMs)}
  <s:Body>
    <ContinuousMove xmlns="http://www.onvif.org/ver20/ptz/wsdl">
      <ProfileToken>${escapeXml(profileToken)}</ProfileToken>
      <Velocity>
        ${panTiltXml}
        ${zoomXml}
      </Velocity>
    </ContinuousMove>
  </s:Body>
</s:Envelope>`;

  const res = await fetch(ptzUrl, {
    method: "POST",
    headers: { "Content-Type": "application/soap+xml; charset=utf-8" },
    body: soap,
    signal: AbortSignal.timeout(3000),
  });

  return res.ok;
}

/**
 * Stops active PTZ movement.
 */
export async function stopMove(
  ptzUrl: string,
  profileToken: string,
  username?: string,
  password?: string,
  offsetMs = 0
): Promise<boolean> {
  const soap = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope">
  ${buildWsSecurityHeader(username, password, offsetMs)}
  <s:Body>
    <Stop xmlns="http://www.onvif.org/ver20/ptz/wsdl">
      <ProfileToken>${escapeXml(profileToken)}</ProfileToken>
      <PanTilt>true</PanTilt>
      <Zoom>true</Zoom>
    </Stop>
  </s:Body>
</s:Envelope>`;

  const res = await fetch(ptzUrl, {
    method: "POST",
    headers: { "Content-Type": "application/soap+xml; charset=utf-8" },
    body: soap,
    signal: AbortSignal.timeout(3000),
  });

  return res.ok;
}

/**
 * Reboots the camera hardware.
 */
export async function rebootCamera(
  deviceServiceUrl: string,
  username?: string,
  password?: string,
  offsetMs = 0
): Promise<boolean> {
  const soap = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope">
  ${buildWsSecurityHeader(username, password, offsetMs)}
  <s:Body>
    <SystemReboot xmlns="http://www.onvif.org/ver10/device/wsdl"/>
  </s:Body>
</s:Envelope>`;

  const res = await fetch(deviceServiceUrl, {
    method: "POST",
    headers: { "Content-Type": "application/soap+xml; charset=utf-8" },
    body: soap,
    signal: AbortSignal.timeout(5000),
  });

  return res.ok;
}

