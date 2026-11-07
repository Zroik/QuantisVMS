import { describe, it, expect } from "vitest";
import {
  parseIpv4Cidr,
  enumerateHosts,
  deriveScanSubnet,
  isScannableIpv4,
  mergeDiscoveredDevices,
  parseProbeMatchXml,
  type DiscoveredCamera,
} from "./discovery.js";

function camera(overrides: Partial<DiscoveredCamera> = {}): DiscoveredCamera {
  return {
    id: "onvif-192.168.100.67-80",
    ip: "192.168.100.67",
    port: 80,
    xaddr: "http://192.168.100.67/onvif/device_service",
    brand: "General",
    model: "Generic",
    name: "Kamera ONVIF",
    scopes: [],
    profiles: [],
    ...overrides,
  };
}

describe("ONVIF discovery — subnet parsing", () => {
  it("parses a /24 into its usable host range", () => {
    expect(parseIpv4Cidr("192.168.100.0/24")).toEqual({
      network: "192.168.100.0",
      prefix: 24,
      firstHost: "192.168.100.1",
      lastHost: "192.168.100.254",
      hostCount: 254,
    });
  });

  it("normalises a host address to its network base", () => {
    expect(parseIpv4Cidr("192.168.100.67/24")?.network).toBe("192.168.100.0");
  });

  it("rejects malformed, out-of-range and host-less ranges", () => {
    expect(parseIpv4Cidr("192.168.100.0")).toBeNull();
    expect(parseIpv4Cidr("192.168.100.256/24")).toBeNull();
    expect(parseIpv4Cidr("192.168.100.0/33")).toBeNull();
    expect(parseIpv4Cidr("192.168.100.0/31")).toBeNull();
    expect(parseIpv4Cidr("192.168.100.0/32")).toBeNull();
    expect(parseIpv4Cidr("not-a-cidr")).toBeNull();
  });
});

describe("ONVIF discovery — host enumeration", () => {
  it("enumerates every usable host in a /24 without the network or broadcast address", () => {
    const hosts = enumerateHosts("192.168.100.0/24");
    expect(hosts).toHaveLength(254);
    expect(hosts[0]).toBe("192.168.100.1");
    expect(hosts[hosts.length - 1]).toBe("192.168.100.254");
    expect(hosts).not.toContain("192.168.100.0");
    expect(hosts).not.toContain("192.168.100.255");
  });

  it("returns no hosts when the range exceeds the scan cap", () => {
    expect(enumerateHosts("10.0.0.0/16")).toEqual([]);
    expect(enumerateHosts("10.0.0.0/16", 70000)).toHaveLength(65534);
  });
});

describe("ONVIF discovery — subnet derivation", () => {
  it("derives the physical /24 from a known camera address", () => {
    expect(deriveScanSubnet(["192.168.100.67", "192.168.100.16"])).toBe("192.168.100.0/24");
  });

  it("skips loopback, link-local and container NAT addresses", () => {
    expect(deriveScanSubnet(["127.0.0.1", "172.18.0.2", "169.254.1.1"])).toBeNull();
    expect(deriveScanSubnet(["172.18.0.2", "192.168.100.67"])).toBe("192.168.100.0/24");
  });

  it("classifies addresses that can host a LAN camera", () => {
    expect(isScannableIpv4("192.168.100.67")).toBe(true);
    expect(isScannableIpv4("10.10.0.5")).toBe(true);
    expect(isScannableIpv4("127.0.0.1")).toBe(false);
    expect(isScannableIpv4("172.20.1.4")).toBe(false);
    expect(isScannableIpv4("169.254.10.10")).toBe(false);
    expect(isScannableIpv4("999.1.1.1")).toBe(false);
  });
});

describe("ONVIF discovery — result merging", () => {
  it("deduplicates by IP and keeps the specific brand from the host cache", () => {
    const merged = mergeDiscoveredDevices(
      [
        camera({
          brand: "Hikvision",
          model: "DS-2CD2020F-I",
          name: "HIKVISION DS-2CD2020F-I",
          source: "host-cache",
        }),
      ],
      [camera({ brand: "General", model: "Generic", name: "Kamera 192.168.100.67", source: "subnet" })]
    );

    expect(merged).toHaveLength(1);
    expect(merged[0].brand).toBe("Hikvision");
    expect(merged[0].model).toBe("DS-2CD2020F-I");
    expect(merged[0].name).toBe("HIKVISION DS-2CD2020F-I");
  });

  it("merges distinct cameras and sorts them by numeric IP", () => {
    const merged = mergeDiscoveredDevices(
      [camera({ ip: "192.168.100.16", port: 8899, xaddr: "http://192.168.100.16:8899/onvif/device_service" })],
      [camera({ ip: "192.168.100.9", xaddr: "http://192.168.100.9/onvif/device_service" })]
    );

    expect(merged.map((device) => device.ip)).toEqual(["192.168.100.9", "192.168.100.16"]);
  });

  it("keeps the port and xaddr of the entry that actually answered", () => {
    const merged = mergeDiscoveredDevices(
      [camera({ ip: "192.168.100.16", port: 80, xaddr: "http://192.168.100.16/onvif/device_service" })],
      [camera({ ip: "192.168.100.16", port: 8899, xaddr: "http://192.168.100.16:8899/onvif/device_service" })]
    );

    expect(merged[0].port).toBe(8899);
    expect(merged[0].xaddr).toBe("http://192.168.100.16:8899/onvif/device_service");
  });
});

describe("ONVIF discovery — ProbeMatch parsing", () => {
  const probeMatch = `<?xml version="1.0" encoding="utf-8"?>
<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://www.w3.org/2003/05/soap-envelope">
  <SOAP-ENV:Body>
    <d:ProbeMatches xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery">
      <d:ProbeMatch>
        <a:EndpointReference xmlns:a="http://schemas.xmlsoap.org/ws/2004/08/addressing">
          <a:Address>urn:uuid:e8a060af-b414-11b3-8205-1868cb758528</a:Address>
        </a:EndpointReference>
        <d:Scopes>onvif://www.onvif.org/type/video_encoder onvif://www.onvif.org/hardware/DS-2CD2020F-I onvif://www.onvif.org/name/HIKVISION%20DS-2CD2020F-I</d:Scopes>
        <d:XAddrs>http://192.168.100.67/onvif/device_service</d:XAddrs>
      </d:ProbeMatch>
    </d:ProbeMatches>
  </SOAP-ENV:Body>
</SOAP-ENV:Envelope>`;

  it("extracts address, brand, model and name from a Hikvision ProbeMatch", () => {
    const parsed = parseProbeMatchXml(probeMatch, "192.168.100.67", 3702);

    expect(parsed).not.toBeNull();
    expect(parsed?.ip).toBe("192.168.100.67");
    expect(parsed?.port).toBe(80);
    expect(parsed?.brand).toBe("Hikvision");
    expect(parsed?.model).toBe("DS-2CD2020F-I");
    expect(parsed?.name).toBe("HIKVISION DS-2CD2020F-I");
  });

  it("rewrites a localhost XAddr to the responding sender address", () => {
    const xml = probeMatch.replace(
      "http://192.168.100.67/onvif/device_service",
      "http://localhost/onvif/device_service"
    );
    const parsed = parseProbeMatchXml(xml, "192.168.100.16", 3702);
    expect(parsed?.xaddr).toContain("192.168.100.16");
  });

  it("returns null for a payload without XAddrs", () => {
    expect(parseProbeMatchXml("<Envelope><Body></Body></Envelope>", "192.168.100.67", 3702)).toBeNull();
  });
});
