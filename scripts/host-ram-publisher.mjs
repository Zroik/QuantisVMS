import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import dgram from 'node:dgram';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const hostRamFilePath = path.resolve(__dirname, '../data/host_ram.json');
const onvifFilePath = path.resolve(__dirname, '../data/discovered_onvif.json');
const onvifTriggerPath = path.resolve(__dirname, '../data/onvif_discover_trigger.json');

function updateHostRam() {
  try {
    const totalBytes = os.totalmem();
    const freeBytes = os.freemem();
    const usedBytes = totalBytes - freeBytes;
    const percent = Number(((usedBytes / totalBytes) * 100).toFixed(1));

    const payload = JSON.stringify({
      totalBytes,
      usedBytes,
      freeBytes,
      percent,
      timestamp: Date.now(),
    });

    fs.writeFileSync(hostRamFilePath, payload, 'utf8');
  } catch (err) {
    // Ignore error
  }
}

// WS-Discovery Multi-NIC scanning
let isScanning = false;
const discoveredMap = new Map();

function runHostDiscovery() {
  if (isScanning) return;
  isScanning = true;

  const msgId = "urn:uuid:" + crypto.randomUUID();
  const probeXml = `<?xml version="1.0" encoding="utf-8"?>
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

  const ifaces = os.networkInterfaces();
  const ipv4s = [];
  for (const [name, addrs] of Object.entries(ifaces)) {
    for (const a of addrs || []) {
      if (a.family === "IPv4" && !a.internal) {
        ipv4s.push({ name, ip: a.address });
      }
    }
  }

  const sockets = [];
  for (const iface of ipv4s) {
    try {
      const sock = dgram.createSocket({ type: "udp4", reuseAddr: true });
      sockets.push(sock);

      sock.on("message", (msg, rinfo) => {
        try {
          const xml = msg.toString();
          const xaddrMatch = xml.match(/<[^:]*:XAddrs>([^<]+)<\/[^:]*:XAddrs>/i);
          if (!xaddrMatch) return;

          let rawXAddr = xaddrMatch[1].trim().split(/\s+/)[0];
          try {
            const u = new URL(rawXAddr);
            if (u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "0.0.0.0") {
              u.hostname = rinfo.address;
              rawXAddr = u.toString();
            }
          } catch {}

          const parsedUrl = new URL(rawXAddr);
          const ip = parsedUrl.hostname || rinfo.address;
          const port = parsedUrl.port ? parseInt(parsedUrl.port, 10) : 80;

          const addrMatch = xml.match(/<[^:]*:Address>([^<]+)<\/[^:]*:Address>/i);
          const id = addrMatch ? addrMatch[1].trim() : `onvif-${ip}-${port}`;

          const scopesMatch = xml.match(/<[^:]*:Scopes>([^<]+)<\/[^:]*:Scopes>/i);
          const scopes = scopesMatch ? scopesMatch[1].trim().split(/\s+/) : [];

          let name = "Kamera ONVIF";
          let model = "Generic";
          let brand = "General";
          const profiles = [];

          for (const s of scopes) {
            const dec = decodeURIComponent(s);
            if (dec.includes("/name/")) name = dec.split("/name/")[1];
            else if (dec.includes("/hardware/")) model = dec.split("/hardware/")[1];
            else if (dec.includes("/Profile/")) profiles.push(dec.split("/Profile/")[1]);
          }

          const combined = `${name} ${model} ${scopes.join(" ")}`.toLowerCase();
          if (combined.includes("hikvision")) brand = "Hikvision";
          else if (combined.includes("dahua")) brand = "Dahua";
          else if (combined.includes("v380")) brand = "V380";
          else if (combined.includes("uniview") || combined.includes("unv")) brand = "Uniview";
          else if (combined.includes("imou")) brand = "Imou";
          else if (combined.includes("ezviz")) brand = "EZVIZ";

          discoveredMap.set(ip, {
            id,
            ip,
            port,
            xaddr: rawXAddr,
            brand,
            model,
            name,
            scopes,
            profiles,
            lastSeen: Date.now(),
          });
        } catch {}
      });

      sock.bind({ address: iface.ip, port: 0 }, () => {
        try {
          sock.setBroadcast(true);
          sock.setMulticastTTL(2);
          sock.send(probeXml, 3702, "239.255.255.250");
        } catch {}
      });
    } catch {}
  }

  setTimeout(() => {
    for (const s of sockets) {
      try { s.close(); } catch {}
    }
    isScanning = false;

    try {
      const list = Array.from(discoveredMap.values());
      fs.writeFileSync(onvifFilePath, JSON.stringify(list, null, 2), "utf8");
    } catch {}

    if (fs.existsSync(onvifTriggerPath)) {
      try { fs.unlinkSync(onvifTriggerPath); } catch {}
    }
  }, 2500);
}

// Initial discovery & RAM write
updateHostRam();
runHostDiscovery();

// Periodic update every 2 seconds for RAM
setInterval(updateHostRam, 2000);

// Periodic discovery scan every 25 seconds or on trigger
setInterval(() => {
  if (fs.existsSync(onvifTriggerPath)) {
    runHostDiscovery();
  }
}, 2000);

setInterval(runHostDiscovery, 25000);

console.log('[Host Publisher] Publishing RAM and ONVIF devices to data directory');
