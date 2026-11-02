import dgram from "node:dgram";
import crypto from "node:crypto";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { sanitizeXAddr } from "./client.js";

export interface DiscoveredCamera {
  id: string; // uuid or ip-port
  ip: string;
  port: number;
  xaddr: string;
  brand: string;
  model: string;
  name: string;
  scopes: string[];
  profiles: string[];
}

/**
 * Builds standard WS-Discovery Probe XML payload requesting NetworkVideoTransmitters.
 */
function buildProbeXml(): string {
  const msgId = "urn:uuid:" + crypto.randomUUID();
  return `<?xml version="1.0" encoding="utf-8"?>
<Envelope xmlns:dn="http://www.onvif.org/ver10/network/wsdl" xmlns="http://www.w3.org/2003/05/soap-envelope">
  <Header>
    <wsa:MessageID xmlns:wsa="http://schemas.xmlsoap.org/ws/2004/08/addressing">${msgId}</wsa:MessageID>
    <wsa:To xmlns:wsa="http://schemas.xmlsoap.org/ws/2004/08/addressing">urn:schemas-xmlsoap-org:ws:2005:04:discovery</wsa:To>
    <wsa:Action xmlns:wsa="http://schemas.xmlsoap.org/ws/2004/08/addressing">http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</wsa:Action>
  </Header>
  <Body>
    <Probe xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns="http://schemas.xmlsoap.org/ws/2005/04/discovery">
      <Types>dn:NetworkVideoTransmitter</Types>
    </Probe>
  </Body>
</Envelope>`;
}

/**
 * Parses WS-Discovery ProbeMatch XML response into DiscoveredCamera object.
 */
export function parseProbeMatchXml(xml: string, senderIp: string, senderPort: number): DiscoveredCamera | null {
  try {
    const xaddrMatch = xml.match(/<[^:]*:XAddrs>([^<]+)<\/[^:]*:XAddrs>/i);
    if (!xaddrMatch) return null;

    // First XAddr token
    const rawXAddr = xaddrMatch[1].trim().split(/\s+/)[0];
    const xaddr = sanitizeXAddr(rawXAddr, senderIp);

    const parsedUrl = new URL(xaddr);
    const ip = parsedUrl.hostname || senderIp;
    const port = parsedUrl.port ? parseInt(parsedUrl.port, 10) : (parsedUrl.protocol === "https:" ? 443 : 80);

    const addrMatch = xml.match(/<[^:]*:Address>([^<]+)<\/[^:]*:Address>/i);
    const id = addrMatch ? addrMatch[1].trim() : `onvif-${ip}-${port}`;

    const scopesMatch = xml.match(/<[^:]*:Scopes>([^<]+)<\/[^:]*:Scopes>/i);
    const scopes = scopesMatch ? scopesMatch[1].trim().split(/\s+/) : [];

    let name = "Kamera ONVIF";
    let model = "Generic";
    let brand = "General";
    const profiles: string[] = [];

    for (const scope of scopes) {
      const decoded = decodeURIComponent(scope);
      if (decoded.includes("/name/")) {
        name = decoded.split("/name/")[1];
      } else if (decoded.includes("/hardware/")) {
        model = decoded.split("/hardware/")[1];
      } else if (decoded.includes("/Profile/")) {
        profiles.push(decoded.split("/Profile/")[1]);
      }
    }

    // Infer brand from name, model or scopes
    const combined = `${name} ${model} ${scopes.join(" ")}`.toLowerCase();
    if (combined.includes("hikvision")) brand = "Hikvision";
    else if (combined.includes("dahua")) brand = "Dahua";
    else if (combined.includes("v380")) brand = "V380";
    else if (combined.includes("uniview") || combined.includes("unv")) brand = "Uniview";
    else if (combined.includes("axis")) brand = "Axis";
    else if (combined.includes("imou")) brand = "Imou";
    else if (combined.includes("ezviz")) brand = "EZVIZ";

    return {
      id,
      ip,
      port,
      xaddr,
      brand,
      model,
      name,
      scopes,
      profiles,
    };
  } catch {
    return null;
  }
}

/**
 * Executes a WS-Discovery multicast scan on all non-internal IPv4 interfaces.
 * Gathers responses for a duration (default 2500ms).
 */
export async function runWsDiscovery(timeoutMs = 2500): Promise<DiscoveredCamera[]> {
  const devicesMap = new Map<string, DiscoveredCamera>();
  const probeXml = buildProbeXml();

  // Enumerate active interfaces (Multi-NIC binding per ODM analysis)
  const interfaces = os.networkInterfaces();
  const ipv4Addrs: { name: string; ip: string }[] = [];
  for (const [name, addrs] of Object.entries(interfaces)) {
    for (const addr of addrs || []) {
      if (addr.family === "IPv4" && !addr.internal) {
        ipv4Addrs.push({ name, ip: addr.address });
      }
    }
  }

  // Also include 0.0.0.0
  ipv4Addrs.push({ name: "default", ip: "0.0.0.0" });

  const sockets: dgram.Socket[] = [];

  for (const iface of ipv4Addrs) {
    try {
      const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
      sockets.push(socket);

      socket.on("message", (msg, rinfo) => {
        const parsed = parseProbeMatchXml(msg.toString(), rinfo.address, rinfo.port);
        if (parsed) {
          devicesMap.set(parsed.ip, parsed);
        }
      });

      socket.on("error", () => {});

      socket.bind({ address: iface.ip === "0.0.0.0" ? undefined : iface.ip, port: 0 }, () => {
        try {
          socket.setBroadcast(true);
          socket.setMulticastTTL(2);
          socket.send(probeXml, 3702, "239.255.255.250");
        } catch {}
      });
    } catch {}
  }

  const dataDir = process.env.DATA_DIR || path.resolve(process.cwd(), "data");
  const hostFile = path.resolve(dataDir, "discovered_onvif.json");

  const loadHostFile = () => {
    if (fs.existsSync(hostFile)) {
      try {
        const content = fs.readFileSync(hostFile, "utf8");
        const list = JSON.parse(content);
        if (Array.isArray(list)) {
          for (const item of list) {
            if (item?.ip) {
              devicesMap.set(item.ip, item);
            }
          }
        }
      } catch {}
    }
  };

  loadHostFile();

  await new Promise((resolve) => setTimeout(resolve, timeoutMs));

  loadHostFile();

  for (const s of sockets) {
    try {
      s.close();
    } catch {}
  }

  return Array.from(devicesMap.values());
}
