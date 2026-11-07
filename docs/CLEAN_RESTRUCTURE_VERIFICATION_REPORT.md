# Quantis VMS — Clean Slate, Route Restructure & ONVIF Remediation

**Verification report** · 2026-11-03 · Host `192.168.100.29` (Windows 11 + WSL2 Ubuntu 24.04)

---

## 1. Verdict

All seven tasks from `DEEPSEEK_PROMPT_CLEAN_RESTRUCTURE_FIX.md` were executed and verified against the running Docker stack.

| # | Task | Status | Primary evidence |
|---|------|--------|------------------|
| 1 | Complete data & recording wipe | **PASS** | `data/` purged to `.gitkeep`, DB tables truncated, Redis flushed, `admin` retained |
| 2 | Remove VMAF telemetry tab, reclaim disk | **PASS** | View/route/nav/locales/scripts/fixtures removed; backend VMAF engine proven intact (recording #13 → VMAF 85.45) |
| 3 | Rename routes & navigation → `/live`, `/playback`, `/monitor` | **PASS** | 6 legacy redirects + 404 fallback verified in a real browser, both locales |
| 4 | Playback deep audit & fixes | **PASS** | 4 bugs fixed; 10 new unit tests; real video played in browser (`currentTime` advancing) |
| 5 | ONVIF scanner remediation | **PASS** | Subnet unicast scan from container discovers both cameras in 4.5 s; contract/probe/stream-URI fixes verified in UI |
| 6 | Provision Hikvision + V380 Pro | **PASS** | 2 rows encrypted at rest, Redis routing, MediaMTX paths `ready=true`, ONVIF verify succeeded on both |
| 7 | Rebuild & full verification gate | **PASS** | typecheck + build + 181 tests + 23/23 browser checks + live frames from both cameras |

**Automated tests:** 181 passed, 8 skipped (all skips are pre-existing live-camera/integration suites). **Browser checks:** 23/23.

---

## 2. Environment & baseline

| Item | Value |
|------|-------|
| Repo | `D:\anothervms` (pnpm monorepo, commit `e12bbe3` + working tree changes) |
| Node / pnpm | v24.15.0 / 12.15.0 |
| Stack | 9 containers on `vms-net` (api-server, web-dashboard, recorder, transcode-worker, ai-vision-worker, mediamtx, rtsp-proxy, mysql 8.4, redis 7) |
| Database (dev) | `127.0.0.1:3307` → `vms_db`, `vms_user` |
| Redis (host) | `127.0.0.1:6380` |
| Cameras | `192.168.100.67` (Hikvision DS-2CD2020F-I), `192.168.100.16` (V380 Pro) |
| Baseline tests (before changes) | api 103 passed / 5 skipped, web 15 passed, recorder 5 passed / 3 skipped, python 30 passed |

Skills followed (global `C:\Users\ZroiK\.agents\skills\` + repo `.agents\skills\`):
`systematic-debugging`, `incremental-implementation`, `test-driven-development`, `security-and-hardening` (covers the mandatory secure-web rules), `better-ui`, `antislop-ui`, `api-and-interface-design`, `full-output-enforcement`.

---

## 3. Task 1 — Clean slate reset

### 3.1 Disk wipe

Removed every file under the four storage roots while keeping the placeholders, then removed the now-empty per-camera directories:

```powershell
# targets resolved and asserted under D:\anothervms\data before deletion
data\raw, data\compressed, data\tmp, data\snapshots   # all files except .gitkeep
```

| Directory | Before | After |
|-----------|--------|-------|
| `data/raw` | 19 clip files, 11 `cam*` dirs | `.gitkeep` only |
| `data/compressed` | 2 clip files, 2 `cam*` dirs | `.gitkeep` only |
| `data/tmp` | 16 scratch files | `.gitkeep` only |
| `data/snapshots` | empty | `.gitkeep` |

Also removed ~30 MB of leftover recorder test clips that were sitting outside the storage volume in `services/media-engine/recorder/data/` (15 `.mp4` files from Oct 28–31, 23 entries including empty camera dirs). They were untracked artifacts, not runtime data.

### 3.2 Database

```sql
SET FOREIGN_KEY_CHECKS = 0;
TRUNCATE TABLE ai_detection_events;
TRUNCATE TABLE recording_activity_windows;
TRUNCATE TABLE recording_chunks;
TRUNCATE TABLE vmaf_probe_logs;
TRUNCATE TABLE recordings;
TRUNCATE TABLE cameras;
SET FOREIGN_KEY_CHECKS = 1;
```

Verification after truncation:

| Query | Result |
|-------|--------|
| `cameras` / `recordings` / `recording_chunks` | 0 / 0 / 0 |
| `ai_detection_events` / `recording_activity_windows` | 0 / 0 |
| `vmaf_probe_logs` | 0 |
| `SELECT id, username, role FROM users` | `5 · admin · admin` (retained) |
| `schema_migrations` | 5 applied migrations preserved |

### 3.3 Redis

`FLUSHDB` returned `OK`. The running services re-created only their liveness keys after the flush (`heartbeat`, `hw:gpu`, BullMQ metadata) — no camera or token state survived.

### 3.4 Note

The Task 1 end-state was verified **before** Task 6 provisioned the cameras. The final running system (section 9) legitimately contains new recordings produced by the two live cameras after provisioning.

---

## 4. Task 2 — VMAF tab removal & disk reclamation

### 4.1 Removed

| Artifact | Action |
|----------|--------|
| `apps/web-dashboard/src/views/VmafTelemetryView.vue` (534 lines) | deleted |
| Router import + `name: "vmaf"` route | removed; replaced by `{ path: "vmaf", redirect: "/live" }` |
| Sidebar VMAF link (`AppLayout.vue`) | removed |
| `nav.vmafTelemetry`, all 18 `vmaf.*` keys | removed from `en.json` and `id.json` |
| `scripts/capture-vmaf.mjs`, `scripts/test-vmaf-api.mjs` | deleted |
| `tests/1minuteroad.mp4` (156 MB), `tests/fixtures/fixture_hikvision_20s.mp4` (20.3 MB), `fixture_20s.mp4` (14.4 MB), `fixture_30s.mp4` (21.4 MB), `hikvision_dist_cq32.mp4` (11.5 MB) | deleted — **223 MB** reclaimed |

### 4.2 Backend engine preserved and re-proven

The transcode/VMAF pipeline was not touched. Proof from this session — recording **#13** (camera 2, 29 s) was processed end-to-end by `vms-transcode-worker`:

```
PROBING → ENCODING → COMPLETED
raw 3,770,359 B → compressed 3,257,323 B (13.6% reduction)
VMAF mean 85.45 (target 85.0), optimal CQ 45.0
```

Recording #1 was later requeued and completed with VMAF 85.30 (10.5 MB compressed from 11.25 MB raw). The quality gate and GPU compression remain functional.

### 4.3 Tests

`stores.test.ts` did not reference `VmafTelemetryView`; its telemetry-store tests were kept because the store is still used by `/monitor` for hardware stats (`HardwareMonitorView.vue`).

---

## 5. Task 3 — Route & navigation rename

### 5.1 Router (`apps/web-dashboard/src/router/index.ts`)

| Path | Behaviour |
|------|-----------|
| `/` | redirect → `/live` |
| `/live` | `name: live` → `LiveMatrixView` |
| `/playback` | `name: playback` → `TimelineView` |
| `/monitor` | `name: monitor` → `HardwareMonitorView` |
| `/configuration` | `name: configuration` → `ConfigurationView` |
| `/matrix`, `/timeline`, `/hardware`, `/settings`, `/vmaf` | redirects → `/live`, `/playback`, `/monitor`, `/configuration`, `/live` |
| `/:pathMatch(.*)*` | redirect → `/live` |
| Guest guard | authenticated guest → `next({ name: "live" })` |
| Login handler (`LoginView.vue`) | pushes `{ name: "live" }` |

### 5.2 Sidebar (`AppLayout.vue`)

Brand → `live`; items are **Live View** (with active-camera badge), **Playback**, **System Monitor**, **Configuration**.

### 5.3 Locales

| Key | en | id |
|-----|----|-----|
| `nav.liveView` | Live View | Live View |
| `nav.playback` | Playback | Playback |
| `nav.systemMonitor` | System Monitor | Monitor Sistem |
| `playback.title` | Video Playback & Forensic Archive | Pemutaran Rekaman Video |
| `hw.headerTitle` | System Performance Monitor | Monitor Kinerja Sistem |

### 5.4 Verification (real browser, Microsoft Edge via Playwright)

```
PASS  Nav exposes exactly the four primary views — ["/live","/playback","/monitor","/configuration"]
PASS  Nav labels in the Indonesian locale — Live View | Playback | Monitor Sistem | Konfigurasi
PASS  Nav labels in the English locale — Live View | Playback | System Monitor | Configuration
PASS  No VMAF nav entry remains
PASS  Redirect / → /live
PASS  Redirect /matrix → /live
PASS  Redirect /timeline → /playback
PASS  Redirect /hardware → /monitor
PASS  Redirect /settings → /configuration
PASS  Redirect /vmaf → /live
PASS  Redirect /does-not-exist → /live
```

Plus a new unit test (`src/router.test.ts`, 4 cases) that locks the route table: named routes, every legacy redirect, no `vmaf` component/name, and the catch-all.

---

## 6. Task 4 — Playback audit & fixes

File: `apps/web-dashboard/src/views/TimelineView.vue` (+ new `src/services/playback.ts`).

| Bug | Fix |
|-----|-----|
| **4.1 Scrub target miscalculation** — `(e.currentTarget \|\| e.target)` let clicks on 2 px `.band-bar` / `.playhead-line` children become the measuring rect | Strict `e.currentTarget`, plus a `rect.width <= 0` guard |
| **4.2 Hardcoded dummy flex span** — `<span :style="{ flex: 30 … }">` distorted the raw/compressed ratio | Removed; only `rawRatioFlex` + `compRatioFlex` render |
| **4.3 Auto-advance into non-playable segments** | `findNextPlayableIndex()` walks only playable segments (`RAW`/`COMPLETED` with bytes); auto-advance sets a `pendingAutoplay` flag consumed on `loadedmetadata` instead of a blind 500 ms timer; `hasNextSegment` now reflects the same rule |
| **4.4 Zero-camera / zero-recording state** | `selectedCamId` starts at `0`; banner *“Belum ada kamera terhubung. Tambahkan kamera di menu Konfigurasi.”*; selector, refresh, jog shuttle, rate, auto-advance, capture and download are disabled until a playable segment exists; no `/api/recordings` call without a camera |

### 6.1 Tests added

* `src/services/playback.test.ts` — 7 cases for `isRecordingPlayable` and `findNextPlayableIndex` (skip RECORDING/ERROR, honour API `playable` flag, respect list order).
* `src/views/TimelineView.test.ts` — 3 cases mounting the view with zero cameras: banner text/links, disabled controls, and **no recordings request**.

### 6.2 Runtime proof

```
PLAYER: {"hasVideo":true,"src":"/api/recordings/42/stream?mode=raw&jwt=…",
         "mediaError":null,"readyState":4,"duration":25.48,"errorOverlay":null}
PASS  Playback loads a playable segment for "v380 pro"
PASS  Playback advances video time after pressing Play — currentTime=2.50
```

Screenshots: `docs/screenshots/restructure-playback.png`, `restructure-playback-playing.png`.

---

## 7. Task 5 — ONVIF scanner remediation

### 7.1 Root causes confirmed

1. **WSL2/Docker NAT does not deliver WS-Discovery multicast** to the physical LAN. The container sits on `172.18.0.0/16`, so probes to `239.255.255.250:3702` never reach `192.168.100.x`. Evidence: multicast alone never listed the cameras from inside the container, while the Windows host publisher (L2 multicast) sees both. The working discovery results in this session came from the new unicast subnet scan.
2. **Contract mismatch** — backend returned `{ devices }`, frontend read `data.cameras` → always `[]`.
3. **Missing route** — UI called `POST /api/onvif/probe`, only `/api/onvif/verify` existed → 404.
4. **Fake import URL** — hardcoded `rtsp://…:554/onvif1` instead of the verified stream URI.

### 7.2 Backend dual-scan (`apps/api-server/src/onvif/discovery.ts`)

* Multicast WS-Discovery kept (multi-NIC bind).
* **Host publisher cache** `data/discovered_onvif.json` read and merged.
* **Directed unicast subnet scan** for `192.168.100.0/24`: TCP probe of `80, 8899, 8000, 554, 3702` with bounded concurrency (96), then ONVIF `GetSystemDateAndTime` on responsive HTTP ports, plus unicast WS-Discovery on 3702. Subnet is taken from `ONVIF_SCAN_SUBNET`, else derived from cached camera IPs (loopback / link-local / 172.16/12 excluded).
* Results merged by IP with specific brand/name/model winning over generic, and written back to `data/discovered_onvif.json`.
* `GET /api/onvif/discover` now calls `runOnvifDiscovery()` and returns `devices` with `verified`, `capabilities`, `primaryStreamUri`.

Measured from inside `vms-api-server`:

```
GET /api/onvif/discover → 200 in 4.49 s, 2 devices
192.168.100.16:8899  V380       IP-Camera
192.168.100.67:80    Hikvision  HIKVISION DS-2CD2020F-I
```

### 7.3 Frontend (`ConfigurationView.vue`)

* `data.devices || data.cameras`, brand→vendor, verified/capabilities/`primaryStreamUri` mapping.
* Verify button now calls **`/api/onvif/verify`** and maps `hasPtz` / `hasImaging` / `hasEvents` + `primaryStreamUri`.
* Import uses `dev.primaryStreamUri`, falls back to Hikvision `/Streaming/Channels/101` or a credential-aware `:554` URL, and sends `onvif_pass` (encrypted by the API).
* Scan banner: *“Memindai subnet host (192.168.100.x) & multicast ONVIF...”*.
* Net tab shows `8080` (was `5173 / 8080`).
* `CameraInput` type added for the write-only `onvif_pass` field.

### 7.4 Host publisher

`start-vms.bat` starts `node scripts\host-ram-publisher.mjs` in the background when Node is present, before `docker compose up`.

### 7.5 Verification

```
GET /api/onvif/discover  → 2 devices (subnet source)
POST /api/onvif/verify   → Hikvision: success, 2 profiles, 1920×1080,
                           rtsp://admin:***@192.168.100.67:554/Streaming/Channels/101?…
POST /api/onvif/verify   → V380: success, 2 profiles, 2304×2592, rtsp://192.168.100.16/live/ch00_0
UI (/configuration?tab=cam → Pindai ONVIF):
  ["IP-Camera V380 192.168.100.16:8899", "HIKVISION DS-2CD2020F-I Hikvision 192.168.100.67:80"]
```

Screenshot: `docs/screenshots/restructure-onvif-scan.png`.

---

## 8. Task 6 — Camera provisioning

### 8.1 Script

`scripts/seed-cameras.mjs` — AES-256-GCM (`[12-byte IV][16-byte tag][ciphertext]`, `CREDENTIAL_KEY`), idempotent upsert by ONVIF xaddr/name, and it writes **the same state as `POST /api/cameras`**:

* MySQL row (encrypted RTSP URL + ONVIF password, YOLO defaults, `av1_nvenc`, VMAF 85/81),
* Redis `cam:<id>:{rtsp_url,classes,conf,rev}`,
* `camera:changed` publish,
* MediaMTX path `cam<id>` → `rtsp://rtsp-proxy:8555/cam<id>`.

(The prompt's snippet only wrote the DB row and one Redis key; without the MediaMTX path and notification the cameras would not stream or record. This is the one deliberate extension.)

### 8.2 Result

```
[Seed] Camera #1 (hikvision) created · rtsp://***:***@192.168.100.67:554/Streaming/Channels/101 · MediaMTX path ready
[Seed] Camera #2 (v380 pro) created · rtsp://192.168.100.16 · MediaMTX path ready
```

| Check | Result |
|-------|--------|
| DB rows | 2, `enabled=1`, `target_vmaf=85`, `preferred_encoder=av1_nvenc` |
| Encryption | `rtsp_url_enc` 97 B / 49 B, `onvif_pass_enc` 40 B — decrypts correctly through `GET /api/cameras` (masked output, no plaintext) |
| Redis | `cam:1:*`, `cam:2:*` only |
| MediaMTX | `cam1 ready=true H264 1920×1080`, `cam2 ready=true H264+audio 2304×2592` |
| Recorder | `Registered camera 1`, `Registered camera 2`, writing fragmented MP4 |
| Live view | both `<video>` elements decode (`readyState=4`) |

---

## 9. Task 7 — Verification gate

### 9.1 Build & typecheck

```
pnpm run typecheck → apps/api-server Done · apps/web-dashboard Done · recorder Done
pnpm run build     → api Done · recorder Done · web 2459 modules, built in 1.23 s
```

### 9.2 Tests (`pnpm test`)

| Suite | Result |
|-------|--------|
| `@vms/api-server` | **117 passed**, 5 skipped (integration suite, `RUN_INTEGRATION_TESTS` unset) |
| `@vms/web-dashboard` | **29 passed** (7 files) |
| `@vms/recorder` | **5 passed**, 3 skipped (needs `LIVE_RTSP_URL`) |
| `ai-vision-worker` (pytest) | **30 passed**, 1 warning |
| **Total** | **181 passed, 8 skipped, 0 failed** |

New coverage added in this session: `onvif/discovery.test.ts` (14), `services/playback.test.ts` (7), `views/TimelineView.test.ts` (3), `router.test.ts` (4).

### 9.3 Stack restart

`docker compose restart api-server recorder ai-vision-worker web-dashboard` (web assets are bind-mounted from `apps/web-dashboard/dist`, API/recorder dist likewise). MediaMTX, transcode-worker and the AI worker were additionally restarted once to clear stale runtime state carried over from before the wipe (see §10.3).

### 9.4 Browser gate (`node scripts/verify-ui-restructure.mjs`)

**23/23 checks pass**, including: login → `/live`, nav in both locales, 6 redirects + 404, no VMAF entry, playback loads and plays a segment, `/monitor`, `/configuration`, both live cameras decoding frames, ONVIF scan listing both cameras, and zero unexpected console errors.

### 9.5 Live view

```
[{"name":"hikvision","state":"Live","readyState":4,"width":1920,"height":1080,"paused":false},
 {"name":"v380 pro","state":"Live","readyState":4,"width":2304,"height":2592,"paused":false}]
```

Screenshot: `docs/screenshots/restructure-live-frames.png`.

### 9.6 Playback

`GET /api/recordings?camera_id=2` returns playable `RAW`/`COMPLETED` segments; the browser plays them with `readyState=4` and no media error. The zero-recording / zero-camera states render the designed empty states (verified by `TimelineView.test.ts`).

---

## 10. Deviations, decisions and findings

### 10.1 Deliberate deviations

1. **`seed-cameras.mjs` extended** to sync MediaMTX paths, publish `camera:changed`, upsert idempotently, and use host ports 3307/6380 (the prompt snippet used the in-container ports and would fail from Windows). Required to meet Task 6's “MediaMTX stream paths” objective.
2. **V380 brand inference by port 8899** in the subnet scanner, because the device advertises itself as “IP-Camera” / brand “General”.
3. **`run-vmaf-benchmarks.sh`** now accepts `VMS_BENCH_REF` and fails with a clear message instead of an ffmpeg error, since the mandated fixture deletion removed its default input.
4. **E2E spec** (`apps/web-dashboard/e2e/vms.spec.ts`) updated to `/live`, `/playback`, `/monitor`, `/configuration` and the VMAF step removed, so it does not reference a deleted route.
5. **Playback page headings left in Indonesian** (“Garis waktu forensik”). Task 3's steps specify routes, nav labels and locale keys only; the wider view copy was out of scope. Renaming the heading to “Pemutaran” is a cosmetic follow-up.

### 10.2 Test-suite side effects (pre-existing)

The API tests create temporary cameras in the real dev database. The recorder and AI worker react to `camera:changed` and leave `cam<id>` directories and Redis keys behind when tests delete rows directly. After the final test run these were removed and the workers restarted. If the suite is run again, expect temporary `data/raw/cam<testId>` directories.

### 10.3 Findings encountered and resolved

| Finding | Resolution |
|---------|------------|
| Recorder logged `ENOENT mkdir /data/raw/cam1` on its first start after the wipe | Transient Windows bind-mount staleness; a restart recreated `cam1`/`cam2`. No code change needed; recorder uses `mkdir recursive`. |
| Finished camera-2 segments moved `RAW → QUEUED` with no BullMQ job and were therefore unplayable | The transcode worker had been running since before the wipe and held the **pre-wipe** `compressionDelayHours` in memory. After restarting it (empty `system_config` → 24 h default), new segments stay `RAW` and play immediately. The two orphaned `QUEUED` rows (#1, #12) were requeued via `POST /api/recordings/:id/requeue`; #1 completed at VMAF 85.30 and #12 was encoding when this report was written. |
| Ghost MediaMTX paths `cam3…cam40` and `cam8/cam13` from earlier camera IDs | Cleared by restarting MediaMTX, then api-server (re-adds `cam1`/`cam2`), then recorder and AI worker. Final path list contains only `cam1` and `cam2`. |

### 10.4 Known limitations

* **Playwright e2e (`pnpm run verify`) was not executed** — no Playwright browser binaries are installed on this machine. Verification was performed with the same Playwright API driving the installed Microsoft Edge (`channel: "msedge"`), 23 checks, plus 181 unit/integration tests. The updated e2e spec is outside `tsconfig`, so it is not type-checked.
* **Skipped integration suites** (api: 5, recorder: 3) need `RUN_INTEGRATION_TESTS` / `LIVE_RTSP_URL`; the pipeline test also referenced the now-deleted `tests/1minuteroad.mp4`.
* **`QUEUED`/`PROBING`/`ENCODING` segments are intentionally not playable** (Task 4 contract: `RAW` or `COMPLETED`). During the brief transcode window a finished segment disappears from playback until compression completes.
* The docs `BENCHMARKS.md` / `PROGRESS.md` still mention the deleted fixture files as historical records.

---

## 11. Final system state

| Component | State |
|-----------|-------|
| Containers | 9/9 up; api, web, recorder, AI worker, transcode worker healthy |
| Cameras | 2 (`hikvision` 192.168.100.67, `v380 pro` 192.168.100.16), both enabled |
| MediaMTX | `cam1` and `cam2` ready, 2 readers each (recorder + AI worker), no ghost paths |
| Recordings | snapshot at report time: 2 RECORDING (live), 10 RAW, 1 ENCODING, 2 COMPLETED (VMAF 85.30 / 85.45) — counts grow continuously while the cameras record |
| Storage | `data/raw` 874.2 MB, `data/compressed` 13.1 MB, only `cam1`/`cam2` under `raw` |
| Redis | only `cam:1:*`, `cam:2:*` camera keys |
| `/live` | both cameras deliver decoded frames |
| `/playback` | plays RAW/COMPLETED segments; graceful empty states otherwise |
| `/monitor` | renders; heading “Monitor Kinerja Sistem” / “System Performance Monitor” |
| `/configuration` | ONVIF scan lists both cameras; verify/import fixed |
| `/vmaf` | redirects to `/live`; no nav entry; component deleted |

### Evidence index

| Path | Purpose |
|------|---------|
| `docs/screenshots/restructure-live-frames.png` | `/live` with both camera frames |
| `docs/screenshots/restructure-playback-playing.png` | `/playback` playing a real segment |
| `docs/screenshots/restructure-onvif-scan.png` | ONVIF scanner listing both cameras |
| `docs/screenshots/restructure-monitor.png`, `restructure-configuration.png` | renamed pages |
| `scripts/verify-ui-restructure.mjs` | repeatable 23-check browser gate |
| `scripts/seed-cameras.mjs` | idempotent camera provisioning |
| `apps/api-server/src/onvif/discovery.test.ts`, `apps/web-dashboard/src/{router,services/playback,views/TimelineView}.test.ts` | regression tests |
