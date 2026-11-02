const fs = require('fs');

const idPath = 'apps/web-dashboard/src/locales/id.json';
const enPath = 'apps/web-dashboard/src/locales/en.json';

const idJson = JSON.parse(fs.readFileSync(idPath, 'utf8'));
const enJson = JSON.parse(fs.readFileSync(enPath, 'utf8'));

const newIdKeys = {
  "hw.crumb": "Perangkat Keras",
  "hw.headerTitle": "Kinerja perangkat keras",
  "hw.chipStatus": "Kondisi sehat & normal",
  "hw.chipSub": "Live · pembaruan tiap 2 dtk",
  "hw.heroSummary": "<b>{count} kamera</b> live dengan total <b>{mbps} Mbps</b> masuk. GPU berjalan di <b>{gpu}%</b> dan <b>{temp} °C</b>, masih jauh dari batas aman. <em>Disk D: terpakai {diskPct}%, sisa {diskFree} GB.</em>",
  "hw.btnRetention": "Atur retensi arsip",
  "hw.btnExport": "Ekspor laporan",
  "hw.exportToast": "Laporan metrik telemetri telah diekspor.",
  "hw.diskTitle": "Ruang disk fisik",
  "hw.diskPath": "/data · Drive D:\\",
  "hw.diskRaw": "Rekaman mentah",
  "hw.diskComp": "Kompresi",
  "hw.diskOther": "Data lain",
  "hw.diskFree": "Sisa bebas",
  "hw.bandwidthIn": "Bandwidth masuk",
  "hw.btnCameras": "Kamera",
  "hw.badgeActive": "{count} aktif",
  "hw.cardGpu": "Beban GPU · RTX 4060",
  "hw.cardVram": "VRAM dedicated",
  "hw.cardTemp": "Suhu GPU",
  "hw.cardEncDec": "Enkoder / dekoder",
  "hw.trendTitle": "Tren 60 detik terakhir",
  "hw.trendSub": "1 sampel / 2 dtk · skala otomatis",
  "hw.tabCpu": "CPU",
  "hw.tabGpu": "GPU core",
  "hw.tabVram": "VRAM",
  "hw.tabBw": "Bandwidth",
  "hw.axis60s": "−60 dtk",
  "hw.axis30s": "−30 dtk",
  "hw.axisNow": "Sekarang",
  "hw.cpuTitle": "Prosesor CPU",
  "hw.cpuCores": "{cores} core",
  "hw.ramTitle": "Memori host · RAM",
  "hw.ramCeiling": "Batas alokasi WSL2 MicroVM",
  "hw.tableTitle": "Bandwidth kamera",
  "hw.tableSub": "Unduhan masuk, per kamera IP",
  "hw.totalInbound": "Total masuk",
  "hw.thCamera": "Kamera",
  "hw.thBitrate": "Bitrate",
  "hw.thResolution": "Resolusi",
  "hw.thCodec": "Codec",
  "hw.thReceived": "Diterima",
  "hw.thStatus": "Status",
  "hw.statusLive": "Live"
};

const newEnKeys = {
  "hw.crumb": "Hardware",
  "hw.headerTitle": "Hardware Performance",
  "hw.chipStatus": "System Healthy & Normal",
  "hw.chipSub": "Live · updates every 2s",
  "hw.heroSummary": "<b>{count} cameras</b> live with total <b>{mbps} Mbps</b> inbound. GPU running at <b>{gpu}%</b> and <b>{temp} °C</b>, well within safe limits. <em>Disk D: {diskPct}% used, {diskFree} GB free.</em>",
  "hw.btnRetention": "Configure archive retention",
  "hw.btnExport": "Export report",
  "hw.exportToast": "Telemetry metrics report exported.",
  "hw.diskTitle": "Physical disk space",
  "hw.diskPath": "/data · Drive D:\\",
  "hw.diskRaw": "Raw recordings",
  "hw.diskComp": "Compression",
  "hw.diskOther": "Other data",
  "hw.diskFree": "Free space",
  "hw.bandwidthIn": "Inbound bandwidth",
  "hw.btnCameras": "Cameras",
  "hw.badgeActive": "{count} active",
  "hw.cardGpu": "GPU Load · RTX 4060",
  "hw.cardVram": "Dedicated VRAM",
  "hw.cardTemp": "GPU Temperature",
  "hw.cardEncDec": "Hardware Encoder / Decoder",
  "hw.trendTitle": "Last 60 seconds trend",
  "hw.trendSub": "1 sample / 2s · auto scale",
  "hw.tabCpu": "CPU",
  "hw.tabGpu": "GPU core",
  "hw.tabVram": "VRAM",
  "hw.tabBw": "Bandwidth",
  "hw.axis60s": "−60s",
  "hw.axis30s": "−30s",
  "hw.axisNow": "Now",
  "hw.cpuTitle": "CPU Processor",
  "hw.cpuCores": "{cores} cores",
  "hw.ramTitle": "Host Memory · RAM",
  "hw.ramCeiling": "WSL2 MicroVM allocation ceiling",
  "hw.tableTitle": "Camera bandwidth",
  "hw.tableSub": "Inbound bitrate per IP camera",
  "hw.totalInbound": "Total inbound",
  "hw.thCamera": "Camera",
  "hw.thBitrate": "Bitrate",
  "hw.thResolution": "Resolution",
  "hw.thCodec": "Codec",
  "hw.thReceived": "Received",
  "hw.thStatus": "Status",
  "hw.statusLive": "Live"
};

Object.assign(idJson, newIdKeys);
Object.assign(enJson, newEnKeys);

fs.writeFileSync(idPath, JSON.stringify(idJson, null, 2) + '\n');
fs.writeFileSync(enPath, JSON.stringify(enJson, null, 2) + '\n');

console.log('Successfully updated id.json and en.json with new hw.* keys');

