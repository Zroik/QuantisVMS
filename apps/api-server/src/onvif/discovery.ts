import dgram from "node:dgram";
import crypto from "node:crypto";
import net from "node:net";
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
  lastSeen?: number;
  source?: "multicast" | "host-cache" | "subnet";
}

export interface Ipv4Cidr {
  network: string;
  prefix: number;
  firstHost: string;
  lastHost: string;
  hostCount: number;
}

export interface OnvifDiscoveryOptions {
  multicastTimeoutMs?: number;
  subnetTimeoutMs?: number;
  subnet?: string;
  hostCachePath?: string;
  writeHostCache?: boolean;
  consoleWarn?: (message: string) => void;
}

const ONVIF_HTTP_PORTS = [80, 8899, 8000];
const ONVIF_AUX_PORTS = [554, 3702];
const ALL_SCAN_PORTS = [...ONVIF_HTTP_PORTS, ...ONVIF_AUX_PORTS];
const SCAN_CONCURRENCY = 96;
const TCP_PROBE_TIMEOUT_MS = 300;
const SOAP_PROBE_TIMEOUT_MS = 1500;

const GENERIC_BRANDS = new Set(["", "general", "generic", "onvif", "unknown"]);

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
      lastSeen: Date.now(),
      source: senderPort === 3702 ? "multicast" : "subnet",
    };
  } catch {
    return null;
  }
}

/**
 * Parses an IPv4 CIDR notation string into its usable host range.
 * Returns null for malformed input and for ranges without usable hosts (/31, /32).
 */
export function parseIpv4Cidr(cidr: string): Ipv4Cidr | null {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/.exec(String(cidr || "").trim());
  if (!match) return null;

  const octets = [match[1], match[2], match[3], match[4]].map((part) => Number(part));
  if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return null;

  const prefix = Number(match[5]);
  if (!Number.isInteger(prefix) || prefix < 16 || prefix > 30) return null;

  const ipInt = (((octets[0] << 24) >>> 0) + (octets[1] << 16) + (octets[2] << 8) + octets[3]) >>> 0;
  const mask = (0xffffffff << (32 - prefix)) >>> 0;
  const network = (ipInt & mask) >>> 0;
  const broadcast = (network | (~mask >>> 0)) >>> 0;
  const firstHost = (network + 1) >>> 0;
  const lastHost = (broadcast - 1) >>> 0;

  if (lastHost < firstHost) return null;

  return {
    network: intToIpv4(network),
    prefix,
    firstHost: intToIpv4(firstHost),
    lastHost: intToIpv4(lastHost),
    hostCount: lastHost - firstHost + 1,
  };
}

function intToIpv4(value: number): string {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff].join(".");
}

/**
 * Enumerates usable host addresses in a CIDR range. Caps the enumeration so a
 * misconfigured /16 can never turn a discovery request into an unbounded scan.
 */
export function enumerateHosts(cidr: string, maxHosts = 1024): string[] {
  const parsed = parseIpv4Cidr(cidr);
  if (!parsed || parsed.hostCount > maxHosts) return [];

  const start = ipv4ToInt(parsed.firstHost);
  const hosts: string[] = [];
  for (let offset = 0; offset < parsed.hostCount; offset++) {
    hosts.push(intToIpv4((start + offset) >>> 0));
  }
  return hosts;
}

function ipv4ToInt(ip: string): number {
  const parts = ip.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return 0;
  return (((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3]) >>> 0;
}

/**
 * True when an address can plausibly be a camera on the physical LAN.
 * Loopback, link-local, container bridge (172.16/12) and WSL NAT addresses are excluded.
 */
export function isScannableIpv4(ip: string): boolean {
  const parts = String(ip || "").split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts;
  if (a === 0 || a === 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  return true;
}

/**
 * Derives a /24 scan target from the addresses of already known cameras.
 * The host publisher cache is the only reliable evidence of the physical LAN
 * subnet, because the container itself only sees the WSL2/Docker NAT network.
 */
export function deriveScanSubnet(ips: string[]): string | null {
  const candidate = (ips || []).find((ip) => isScannableIpv4(ip));
  if (!candidate) return null;
  const [a, b, c] = candidate.split(".");
  return `${a}.${b}.${c}.0/24`;
}

function isGenericBrand(brand: string | undefined | null): boolean {
  return GENERIC_BRANDS.has(String(brand || "").trim().toLowerCase());
}

function isGenericName(name: string | undefined | null, ip: string): boolean {
  const normalized = String(name || "").trim().toLowerCase();
  if (!normalized) return true;
  return (
    normalized === "kamera onvif" ||
    normalized === "onvif camera" ||
    normalized === "ip camera" ||
    normalized === `kamera ${ip}`.toLowerCase()
  );
}

/**
 * Merges discovery results from several sources. Later lists win for concrete
 * fields, but a generic brand/name never overwrites a specific one.
 */
export function mergeDiscoveredDevices(...lists: Array<DiscoveredCamera[] | null | undefined>): DiscoveredCamera[] {
  const byIp = new Map<string, DiscoveredCamera>();

  for (const list of lists) {
    for (const device of list || []) {
      if (!device?.ip) continue;
      const previous = byIp.get(device.ip);
      if (!previous) {
        byIp.set(device.ip, { ...device });
        continue;
      }

      byIp.set(device.ip, {
        ...previous,
        ...device,
        id: device.id || previous.id,
        xaddr: device.xaddr || previous.xaddr,
        port: device.port || previous.port,
        brand: isGenericBrand(device.brand) ? previous.brand : device.brand,
        model: !device.model || device.model === "Generic" ? previous.model : device.model,
        name: isGenericName(device.name, device.ip) ? previous.name : device.name,
        scopes: device.scopes && device.scopes.length > 0 ? device.scopes : previous.scopes,
        profiles: device.profiles && device.profiles.length > 0 ? device.profiles : previous.profiles,
        lastSeen: Math.max(previous.lastSeen || 0, device.lastSeen || 0) || Date.now(),
        source: device.source || previous.source,
      });
    }
  }

  return Array.from(byIp.values()).sort((a, b) =>
    a.ip.localeCompare(b.ip, undefined, { numeric: true })
  );
}

function readHostCache(hostFile: string): DiscoveredCamera[] {
  try {
    if (!fs.existsSync(hostFile)) return [];
    const parsed = JSON.parse(fs.readFileSync(hostFile, "utf8"));
    if (!Array.isArray(parsed)) return [];

    const devices: DiscoveredCamera[] = [];
    for (const item of parsed) {
      if (!item?.ip) continue;
      const ip = String(item.ip);
      const port = Number(item.port) || 80;
      devices.push({
        id: String(item.id || `onvif-${ip}-${port}`),
        ip,
        port,
        xaddr: String(item.xaddr || `http://${ip}${port === 80 ? "" : `:${port}`}/onvif/device_service`),
        brand: String(item.brand || "General"),
        model: String(item.model || "Generic"),
        name: String(item.name || `Kamera ${ip}`),
        scopes: Array.isArray(item.scopes) ? item.scopes.map(String) : [],
        profiles: Array.isArray(item.profiles) ? item.profiles.map(String) : [],
        lastSeen: Number(item.lastSeen) || Date.now(),
        source: "host-cache",
      });
    }
    return devices;
  } catch {
    return [];
  }
}

function writeHostCache(hostFile: string, devices: DiscoveredCamera[]): void {
  try {
    const dir = path.dirname(hostFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(hostFile, JSON.stringify(devices, null, 2), "utf8");
  } catch {
    // Discovery must still return results if the cache volume is read-only.
  }
}

/**
 * Bounded-concurrency map so a /24 scan never opens hundreds of sockets at once.
 */
async function mapLimit<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, Math.max(items.length, 1)) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index]);
    }
  });
  await Promise.all(runners);
  return results;
}

/**
 * Fast TCP reachability check on a single port.
 */
export function tcpProbe(ip: string, port: number, timeoutMs = TCP_PROBE_TIMEOUT_MS): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const socket = net.createConnection({ host: ip, port });

    const finish = (reachable: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(reachable);
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    socket.once("close", () => finish(false));
  });
}

/**
 * Confirms that an HTTP endpoint speaks ONVIF by issuing the unauthenticated
 * GetSystemDateAndTime request every conformant device service answers.
 */
export async function probeOnvifDeviceService(xaddr: string, timeoutMs = SOAP_PROBE_TIMEOUT_MS): Promise<boolean> {
  const soap = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope">
  <s:Body><GetSystemDateAndTime xmlns="http://www.onvif.org/ver10/device/wsdl"/></s:Body>
</s:Envelope>`;

  try {
    const res = await fetch(xaddr, {
      method: "POST",
      headers: { "Content-Type": "application/soap+xml; charset=utf-8" },
      body: soap,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return false;
    const xml = await res.text();
    return /SystemDateAndTime/i.test(xml);
  } catch {
    return false;
  }
}

/**
 * Sends a WS-Discovery Probe over unicast UDP. Most cameras ignore unicast
 * probes; those that answer are merged like multicast responses.
 */
export function probeUnicastDiscovery(ip: string, timeoutMs = 800): Promise<DiscoveredCamera | null> {
  return new Promise((resolve) => {
    let settled = false;
    let socket: dgram.Socket | null = null;

    const finish = (device: DiscoveredCamera | null) => {
      if (settled) return;
      settled = true;
      try {
        socket?.close();
      } catch {}
      resolve(device);
    };

    try {
      socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
    } catch {
      resolve(null);
      return;
    }

    socket.on("message", (msg, rinfo) => {
      const parsed = parseProbeMatchXml(msg.toString(), rinfo.address, rinfo.port);
      if (parsed) finish(parsed);
    });
    socket.on("error", () => finish(null));

    setTimeout(() => finish(null), timeoutMs).unref?.();

    socket.bind(() => {
      try {
        socket?.send(buildProbeXml(), 3702, ip);
      } catch {
        finish(null);
      }
    });
  });
}

/**
 * Directed scan of the physical subnet over unicast TCP. This is the only path
 * that reaches cameras when WSL2 NAT blocks WS-Discovery multicast.
 */
export async function runSubnetScan(subnet: string, timeoutMs = 4000): Promise<DiscoveredCamera[]> {
  const hosts = enumerateHosts(subnet);
  if (hosts.length === 0) return [];

  const deadline = Date.now() + timeoutMs;

  const openPortsByHost = new Map<string, number[]>();
  await mapLimit(hosts, SCAN_CONCURRENCY, async (host) => {
    for (const port of ALL_SCAN_PORTS) {
      if (Date.now() > deadline) return;
      if (await tcpProbe(host, port)) {
        const ports = openPortsByHost.get(host) || [];
        ports.push(port);
        openPortsByHost.set(host, ports);
      }
    }
  });

  const responsiveHosts = Array.from(openPortsByHost.keys());
  if (responsiveHosts.length === 0) return [];

  const discovered = await mapLimit(responsiveHosts, Math.min(16, responsiveHosts.length), async (host) => {
    const ports = openPortsByHost.get(host) || [];
    const found: DiscoveredCamera[] = [];

    for (const port of ports) {
      if (!ONVIF_HTTP_PORTS.includes(port)) continue;
      const xaddr = `http://${host}${port === 80 ? "" : `:${port}`}/onvif/device_service`;
      if (!(await probeOnvifDeviceService(xaddr))) continue;
      found.push({
        id: `onvif-${host}-${port}`,
        ip: host,
        port,
        xaddr,
        // Port 8899 is the V380 Pro / generic OEM device service convention.
        brand: port === 8899 ? "V380" : "General",
        model: "Generic",
        name: `Kamera ${host}`,
        scopes: [],
        profiles: [],
        lastSeen: Date.now(),
        source: "subnet",
      });
      break;
    }

    if (ports.includes(3702) && found.length === 0) {
      const unicast = await probeUnicastDiscovery(host, 600);
      if (unicast) found.push({ ...unicast, ip: host, source: "subnet" });
    }

    return found;
  });

  return discovered.flat();
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
          devicesMap.set(parsed.ip, { ...parsed, source: "multicast" });
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

  await new Promise((resolve) => setTimeout(resolve, timeoutMs));

  for (const s of sockets) {
    try {
      s.close();
    } catch {}
  }

  return Array.from(devicesMap.values());
}

/**
 * Full ONVIF discovery: multicast WS-Discovery + host publisher cache +
 * unicast subnet scan. Results are merged and written back to the shared cache.
 */
export async function runOnvifDiscovery(options: OnvifDiscoveryOptions = {}): Promise<DiscoveredCamera[]> {
  const dataDir = process.env.DATA_DIR || path.resolve(process.cwd(), "data");
  const hostFile = options.hostCachePath || path.resolve(dataDir, "discovered_onvif.json");
  const cached = readHostCache(hostFile);

  const configuredSubnet = options.subnet || process.env.ONVIF_SCAN_SUBNET || "";
  const subnet = configuredSubnet || deriveScanSubnet(cached.map((device) => device.ip));

  const [multicastDevices, subnetDevices] = await Promise.all([
    runWsDiscovery(options.multicastTimeoutMs ?? 2500),
    subnet
      ? runSubnetScan(subnet, options.subnetTimeoutMs ?? 4000).catch(() => [])
      : Promise.resolve([]),
  ]);

  if (!subnet && options.consoleWarn) {
    options.consoleWarn("ONVIF subnet scan skipped: no scannable LAN address in the host cache.");
  }

  const merged = mergeDiscoveredDevices(cached, multicastDevices, subnetDevices);

  if (options.writeHostCache !== false && merged.length > 0) {
    writeHostCache(hostFile, merged);
  }

  return merged;
}
