# Quantis VMS — Full Deep Audit

**Date:** 2026-11-03 (evening)
**Mode:** Read-only audit. No source files were changed.
**Scope:** the entire monorepo — `apps/api-server`, `apps/web-dashboard`, `services/media-engine` (recorder, rtsp-proxy, MediaMTX config), `services/ai-vision-worker`, Docker/compose, env, scripts, docs, tests — plus the **live Docker stack** running in WSL.
**Method:** static deep-read by area, cross-service contract comparison, and runtime verification against the running containers (`docker compose ps/logs/exec`, MySQL queries, HTTP probes, FFmpeg capability checks).

> This report deliberately includes problems that static review alone misses: the stack is currently "healthy" according to Docker while the core media path is broken. Evidence is quoted with file:line or container output.

---

## 0. Your immediate question: why is `localhost:5173` not working?

**Short answer: 5173 is no longer published by the Docker stack. Use `http://localhost:8080`.**

Evidence:

- `docker-compose.yml:250-251` publishes only `8080:80` for `web-dashboard`. The old duplicate `5173:80` mapping was removed.
- The running container confirms it: `vms-web-dashboard ... 0.0.0.0:8080->80/tcp`.
- `http://127.0.0.1:8080/` returns `200` with the Quantis HTML; `http://127.0.0.1:5173/` has no listener.
- 5173 is still the **Vite dev-server** port (`apps/web-dashboard/vite.config.ts:17`) and the Playwright/e2e base URL (`playwright.config.ts:12,32-33`), but the Vite server is not running. You only get 5173 if you run `pnpm --filter @vms/web-dashboard dev` (or `cd apps/web-dashboard && pnpm dev`).
- Docs and config still claim 5173 exists: `README.md:141,155`, `start-vms.bat:21`, `apps/api-server/src/routes/config.ts:65`, `apps/web-dashboard/src/stores/config.ts:140`, and the Configuration UI shows `5173 / 8080` (`ConfigurationView.vue:472`). That is documentation/config drift, not a working port.
- The API CORS default is still `http://localhost:5173` (`app.ts:22`, `sockets/gateway.ts:17`) and the `WEB_ORIGIN` env is not passed by compose. Same-origin nginx proxying masks this for normal use, but direct browser calls from `:8080` would be rejected; dev on `:5173` matches the default.

**What to do:** open `http://localhost:8080`. If you want the old behavior, either re-add a `5173:80` publish (not recommended — same content on two ports) or run the Vite dev server on 5173 and keep the API/MediaMTX ports reachable. Update the README, `start-vms.bat`, config defaults, and Configuration UI to stop advertising 5173.

---

## 1. Live-system audit (this is the most urgent part)

The running stack has been up ~16 minutes and Docker reports **every service healthy**. That health is misleading. Container evidence:

| Service | Docker status | Actual state |
|---|---|---|
| `vms-api-server` | healthy | Boots, but cannot authenticate to MediaMTX; 3 camera syncs fail at startup |
| `vms-mediamtx` | up | Rejects every RTSP client with HTTP 500 from the auth webhook |
| `vms-recorder` | healthy | Registered 3 cameras, but produces **no new segments** (auth failure loop, silently retried) |
| `vms-ai-vision-worker` | healthy | Both reader threads are dead (`AttributeError: module 'av' has no attribute 'AVError'`) |
| `vms-transcode-worker` | healthy | Runs, but VMAF/verification timeouts; **0 completed recordings** in the DB |
| `vms-web-dashboard` | healthy | HTML/API proxy works; live HLS redirect is broken (drops `:8080`) |
| `vms-rtsp-proxy` | up | Running; internal only (good) |
| `vms-mysql`, `vms-redis` | healthy | Up |

### OPS-1 (Critical) — MediaMTX auth is hard-failing with HTTP 500; all stream reads fail

**Evidence (MediaMTX log, repeated every few seconds):**

```
failed to authenticate: server replied with code 500:
{"error":"MEDIAMTX_AUTH_SECRET environment variable is mandatory in production"}
```

**Root cause:** `docker-compose.yml` gives the `api-server` service no `MEDIAMTX_AUTH_SECRET` (nor `MEDIAMTX_HOST/API_PORT`), while `apps/api-server/src/routes/internal.ts:9-18` throws when it is missing and `NODE_ENV=production` (set in `apps/api-server/Dockerfile`). The `.env` file contains `MEDIAMTX_AUTH_SECRET`, but compose only forwards the variables it explicitly lists. The API startup log confirms:

```
[API Server] Error syncing camera 1: MEDIAMTX_AUTH_SECRET environment variable is mandatory in production
[API Server] Error syncing camera 2: ...
[API Server] Error syncing camera 10: ...
```

**Impact:** MediaMTX asks the API to authorize every reader/publisher. The API returns 500 instead of 200/401, so every client is denied. The recorder, AI worker, and dashboard cannot read camera streams. The system is not recording, not detecting, and live view is broken — while all containers report healthy.

**Fix (small, high priority):** add `MEDIAMTX_AUTH_SECRET: ${MEDIAMTX_AUTH_SECRET}` (and `MEDIAMTX_HOST: mediamtx`, `MEDIAMTX_API_PORT: 9997`) to the `api-server` environment; also pass it to `recorder` and `ai-vision-worker` so they do not rely on the default literal. Better: make the auth hook return 401 (not 500) on configuration errors, and make the healthcheck exercise this path.

### OPS-2 (Critical) — AI reader threads die on the first error: `av.AVError` does not exist in PyAV 19

**Evidence (ai-vision log):**

```
File "/app/src/stream_reader.py", line 153, in run_reader
    except (av.AVError, ValueError, OSError, TimeoutError, RuntimeError) as exc:
AttributeError: module 'av' has no attribute 'AVError'
Exception in thread cam-1-reader:
```

Container check:

```
version 19.0.2
AVError False
FFmpegError True
error.FFmpegError True
```

**Root cause:** PyAV 19 removed the `av.AVError` alias. The `except` clause raises `AttributeError` while handling the first exception, so the reader thread exits permanently. Even after OPS-1 is fixed, detection would still be dead.

**Impact:** no AI detections, no activity windows (DB has **0** `recording_activity_windows` rows despite 1,204 historical `ai_detection_events`), no smart-probing input.

**Fix:** catch `av.FFmpegError` (or `av.error.FFmpegError`) in both the decode and close paths. Add a test that imports the installed PyAV and asserts the exception class exists. Add reader-thread supervision so a dead reader is restarted and surfaced.

### OPS-3 (High) — Recorder silently retries a broken ffmpeg; no segment is written and no failure is logged

**Evidence:** `data/raw/cam1` and `data/raw/cam2` contain only Nov 2 files; the newest segment is from before the current run. The recorder log only says "Registered camera …" and "monitoring". `supervisor.ts:241-285` increments failures and restarts, but never logs the ffmpeg exit code, stderr, or the auth error. The `system:alert` publish only happens after 5 failures and is fire-and-forget.

**Impact:** an operator sees a healthy recorder with no new files; there is no actionable log.

**Fix:** log the exit code + the drained stderr tail on every unexpected exit; surface the first failure immediately; add a real healthcheck that verifies a recent segment (mtime) per active camera; add alert throttling.

### OPS-4 (High) — Transcoder cannot finish a recording: VMAF and verification time out

**Evidence (DB failure reasons):**

```
Command timed out after 60000ms: ffmpeg -v error -i /data/compressed/cam1/20261102_080427.mp4.partial -f null -   1
VMAF calculation failed completely on both CUDA and CPU fallback (timeout: 120000ms, frames: 335)              1
VMAF calculation failed completely on both CUDA and CPU fallback (timeout: 120000ms, frames: 343)              1
NULL                                                                                                            7
```

- `recordings`: 7 `RAW`, 3 `FAILED`, **0 `COMPLETED`**.
- `data/compressed` is empty.
- The transcode container has FFmpeg n8.1.1, `libvmaf`, `libvmaf_cuda`, `av1_nvenc`, `hevc_nvenc`, and an RTX 4060 visible via `nvidia-smi`.
- 90 `vmaf_probe_logs` rows exist, so probing runs; it is the scoring/verification that fails.

**Impact:** the flagship "AI-guided VMAF-gated compression" never produces a compressed artifact in this deployment. Raw storage grows; nothing is reclaimed.

**Fix:** reproduce one VMAF command manually with the exact filtergraph (`vmaf/runner.ts:143,158`); confirm `hwupload_cuda`/`libvmaf_cuda` actually run on this GPU/driver; increase and/or scale the watchdog; add a per-command log with stderr; add a metrics counter for job success/failure; then re-run a single recording end-to-end. Also check the 60 s full-decode verification timeout — it is fixed while chunk/encode timeouts are scaled.

### OPS-5 (High) — Healthchecks say "healthy" while the product is broken

- `web-dashboard` healthcheck is just `wget /` (HTML served).
- `ai-vision-worker` healthcheck is a Redis TCP connect (`docker-compose.yml:222`), not "reader threads alive / detections flowing".
- `recorder` healthcheck is Redis TCP, not "a segment was written recently".
- `transcode-worker` healthcheck is Redis TCP, not "queue is consuming / last job succeeded".
- `api-server` `/healthz` is static; only `/readyz` checks DB+Redis.

**Impact:** orchestrators and operators are told everything is fine during a total media outage.

**Fix:** real readiness/liveness checks (recent segment mtime, queue heartbeat, last successful detection timestamp, MediaMTX auth probe), and make `depends_on` use the real checks.

### OPS-6 (Medium) — HLS fallback redirect drops the host port

Direct MediaMTX HLS:

```
GET http://127.0.0.1:8888/cam1/index.m3u8
302 Location: /cam1/index.m3u8?cookieCheck=1
Set-Cookie: cookieCheck=1; HttpOnly; Secure; SameSite=None; Partitioned
```

Through nginx (the dashboard path):

```
GET http://127.0.0.1:8080/stream/hls/cam1/index.m3u8
302 Location: http://127.0.0.1/stream/hls/cam1/index.m3u8?cookieCheck=1
```

The `Location` lost `:8080` because `nginx.conf` sets `proxy_set_header Host $http_host;` and `port_in_redirect off;` with `proxy_redirect / /stream/hls/;`. A browser following it hits port 80 and fails. The MediaMTX cookie is `Secure; SameSite=None`, which also needs HTTPS or localhost handling.

**Fix:** stop stripping the port (`port_in_redirect on`, or emit a relative redirect), test the cookie round-trip over the actual dashboard origin, and consider using `absolute_redirect off` with a relative Location.

### OPS-7 (Medium) — Live DB/config inconsistencies

- `system_config.network` has `httpPort: 5173` and `whepPort: 8555`; the deployed WHEP port is `8889`, and the dashboard is `8080`. `8555` is the RTSP proxy. The Configuration UI displays those wrong values (`ConfigurationView.vue:472,484`). Defaults are duplicated in `apps/api-server/src/routes/config.ts:65-69` and `apps/web-dashboard/src/stores/config.ts:140-144`.
- `system_config.ai_engine.model` says `YOLO26n`, but the worker loads `yolov8n.pt` (`MODEL_PATH` in compose) and has no TensorRT path. This is a claim-vs-code mismatch.
- `compression.preferredEncoder` shows `hevc_nvenc` in config, while camera rows say `av1_nvenc`.

**Fix:** one canonical network/port map derived from env, and a config migration/reconciliation on boot; stop duplicating defaults in the frontend store. Align the AI model claim with the actual weights.

---

## 2. Security findings visible in the deployed configuration

### SEC-1 (Critical) — Production still runs with the publicly known all-zero credential key and default JWT secret

`.env.example` (tracked) and the local `.env` (masked): `CREDENTIAL_KEY=AAAA...(44 chars)`, `JWT_SECRET=supe...(55 chars)`; these match the public defaults embedded in `docker-compose.yml:91-92` (`AAAAAAAA...=` and `super_secret_jwt_key_quantis_1234567890`). The API container resolves to those values.

**Impact:** every camera RTSP/ONVIF password is encrypted with a key published in the repo; any JWT can be forged by anyone who knows the default. The "fail-start when missing" hardening is bypassed because the values are present.

**Fix:** generate real random values once (e.g. `openssl rand -base64 32`), store them outside git, remove the fallbacks from compose, fail closed if the key is the known default, and rotate existing encrypted camera credentials + JWTs.

### SEC-2 (High) — `MEDIAMTX_AUTH_SECRET` is a public default and is not passed to the API

Same root cause as OPS-1. Even after adding it to compose, the `.env.example` value/default is the literal `mediamtx_internal_token_secret`. Generate a unique secret and pass it to api-server, recorder, ai-vision, mediamtx, and dev sim-cams.

### SEC-3 (Medium) — API container runs as root; AI image runs as root

`apps/api-server/Dockerfile` has no `USER`; `services/ai-vision-worker/Dockerfile` has no `USER`. The web image runs nginx as root (master) and MediaMTX image default. Add non-root users where the image supports it, drop capabilities, and set `read_only` where possible.

### SEC-4 (Medium) — No CSP / HSTS on the SPA

Live headers show `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, and cache headers, but no `Content-Security-Policy` and no `Strict-Transport-Security`. `nginx.conf` also proxies `/api/` and `/stream/` without rate limits or body-size limits. Add a CSP compatible with Vue + HLS/WHEP and HSTS when TLS is enabled.

---

## 3. Frontend (`apps/web-dashboard`)

Verified by full read plus `vue-tsc` and `vitest` (13/13 pass). Typecheck/build are green � these are behavioral and contract defects, not compile errors.

### FE-01 � Critical � Live AI boxes never render � socket payload contract mismatch
**Files:** `src/components/BboxOverlay.vue:169-171,201-202`; `src/stores/socket.ts:50-58`; producer `services/ai-vision-worker/src/detector.py:75-82`, `worker.py:214-220`.
The worker publishes boxes as `{cls, conf, x1, y1, x2, y2, box}`; the gateway forwards the payload verbatim; `BboxOverlay` requires `b.bbox`, `b.confidence`, and `b.class_name`. Every real box is skipped by the `Array.isArray(b.bbox)` guard. The component test uses the frontend's invented shape, so CI cannot catch it.
**Fix:** normalize in `useSocketStore` (`bbox: b.box`, `confidence: b.conf`, `class_name: COCO_NAMES[b.cls]`), or publish the display contract from the worker. Add a producer?consumer fixture test using the raw Redis payload.

### FE-02 � High � "Unduh MP4" always returns 401
**Files:** `TimelineView.vue:810-816`; `apps/api-server/src/routes/recordings.ts:12-18,360-411`.
`window.open("/api/recordings/:id/download?jwt=�")` cannot send an `Authorization` header, and the router only enables query-token auth for paths ending in `/stream`. `/download` uses header-only auth, so the new tab shows `{"error":"Missing authentication token"}`.
**Fix:** fetch via `apiFetch` and save a Blob (or add a short-lived, path-scoped download ticket and extend the media-token exception to `/download` only).

### FE-03 � High � ONVIF discovery/verify/import is broken by contract drift
**Files:** `ConfigurationView.vue:2014-2075`; `apps/api-server/src/routes/onvif.ts:61-76,92,146-149`.
- Discovery returns `{ devices }`; the UI reads `data.cameras` ? always empty.
- The UI posts to `/api/onvif/probe`; the backend route is `/api/onvif/verify` ? 404.
- Verify returns `hasPtz/hasImaging/profiles/primaryStreamUri`; the UI reads `data.capabilities`.
- The UI imports via `createCamera` with a guessed `rtsp://user:pass@ip:554/onvif1`, bypassing `/api/onvif/add-bulk` (which resolves the real stream URI, encrypts `onvif_pass`, and stores capabilities).
**Fix:** use `data.devices`, call `/verify`, map `hasPtz/hasImaging`, and use `/add-bulk` (or pass the verified stream URI and `onvif_pass`). Surface non-2xx errors.

### FE-04 � High � Concurrent 401 refresh race logs the user out and revokes the winning token
**Files:** `src/services/api.ts:16-30`; `src/stores/auth.ts:64-88`; backend `auth/service.ts:124-137`.
`apiFetch` has no single-flight refresh. Two parallel 401s call `refreshAccessToken()` with the same single-use refresh token; the loser hits the backend's reuse-detection branch, which deletes all JTIs including the winner's. The loser then calls `clearAuth()` + hard `window.location.href = "/login"`.
**Fix:** share one `refreshPromise`; all callers await it; only clear auth once; consider a short server-side grace window.

### FE-05 � High � Timeline always shows a fabricated VMAF of 94.2
**File:** `TimelineView.vue:135`.
`(activeRecording?.vmaf_score || 94.2).toFixed(1)` � `vmaf_score` does not exist; the schema/API field is `vmaf_mean`. Every recording, including raw ones, displays a fake quality score.
**Fix:** use `vmaf_mean` and `quality_gate_met`; show "�/Belum diverifikasi" when null.

### FE-06 � High � VMAF chart falls back to a fabricated curve
**File:** `VmafTelemetryView.vue:380-393`.
When there are no probe points, the chart renders a hardcoded `{cq, vmaf}` curve (92.5 � 68.0) labeled as measured data. A fresh install or a failed fetch looks like a successful analysis.
**Fix:** render an explicit empty/error state; never synthesize chart points.

### FE-07 � High � Config load failure leaves defaults editable; save overwrites the server
**Files:** `ConfigurationView.vue:2135-2138`; `src/stores/config.ts:167-181`.
`fetchConfig` records `error` but the view ignores it, copies the hardcoded default object into `cfg`, and enables save. A transient API/DB outage lets an operator save defaults over the real configuration while the header says "Online".
**Fix:** track `loaded`; render a blocking error + retry and disable save on failure; only initialize from a successful fetch.

### FE-08 � High � Hardware monitor shows fabricated "healthy" telemetry on failure
**Files:** `HardwareMonitorView.vue:6,16`; `src/stores/telemetry.ts:117-151`.
The header always says "System Healthy & Normal" with a green dot; hero text says "well within safe limits". The store defaults are an "AMD Ryzen 7 7745HX", "RTX 4060 Laptop", 32 GB RAM, 8188 MB VRAM, 45 �C. Fetch errors are swallowed. "Export report" only shows a toast.
**Fix:** loading/stale/error state, derive health from thresholds, show "�" for unknown values, remove fake defaults; implement or remove export.

### FE-09 � High � Class panel keeps the previous camera's state when switching cameras
**Files:** `LiveMatrixView.vue:169-173`; `ClassTogglePanel.vue:213-214`.
`ClassTogglePanel` copies `initialClasses`/`initialConfidence` into local refs once and has no `watch`. Switching tiles changes props but not the refs; toggling then PUTs camera A's class set to camera B.
**Fix:** add `:key="activeCamera.id"` or watch the props; add a component test for a camera switch.

### FE-10 � High � Keyboard/screen-reader blockers
**Files:** `LiveMatrixView.vue:76-82`; `TimelineView.vue:168-182,220,346`; `ConfigurationView.vue:595-601,1208-1209`; `LoginView.vue:24-46`; `CameraControlPanel.vue:240-246`.
Camera tiles are clickable `<div>`s with no role/tabindex/key handler; the timeline video has no native controls and the scrubber is a `<div @click>`; the config modal has no `role="dialog"`, focus trap, or Escape close; custom switches have `aria-checked` but no accessible name; login labels have no `for`/id; PTZ ranges are unlabeled.
**Fix:** buttons/roles + keyboard handlers, native controls or `role="slider"`, reka-ui `Dialog` (already a dependency), label/id associations, `aria-label` on switches.

### FE-11 � Medium � i18n is largely decorative
Both catalogs have 173 keys; only ~90 distinct keys are referenced; ~84 are unused (all `login.*`, `timeline.*`, `vmaf.*`). Login, timeline, and the Configuration console hardcode Indonesian. `index.html` is always `lang="id"`; the saved locale is not applied to `<html lang>` on boot.
**Fix:** route every string through `t()`, add key-parity/unused-key CI, initialize `<html lang>` from the saved locale.

### FE-12 � Medium � VMAF queue status is overwritten with hardcoded zeros
`VmafTelemetryView.vue:441-451` runs `fetchVmafProbes` and `fetchStats` concurrently. `/api/stats` returns `queue: {queued:0, probing:0, encoding:0, verifying:0}` (`stats.ts:360-365`) and usually resolves last, clobbering real counts from `/api/vmaf-probes` (`:514-519`).
**Fix:** consume queue counts only from the real endpoint, or compute them in `/api/stats`.

### FE-13 � Medium � Socket layer degrades silently after token refresh / reconnect exhaustion
`src/stores/socket.ts:29-36` captures `auth.token` by value; there is no `connect_error` handler, no token update on refresh, and no UI when `isConnected === false`. `system:alert` still only `console.warn`s.
**Fix:** update `socket.auth` on refresh and reconnect; handle `connect_error` with one refresh; show a "live connection lost" banner and surface alerts.

### FE-14 � Medium � Config console shows static/fabricated status and no-op toggles
Hardcoded "Online"/"NTP Stratum 2", node ID `QUANTIS-NODE-RTX4060-01`, ports `5173/8080/8554/8555/8888` (WHEP is really 8889), GPU/AI switches pinned `aria-checked="true"` with a toast-only handler, browser clock labeled "WIB", "tamper-evident" audit claim, and `latencyMs ?? 15`.
**Fix:** bind to real config/API values, remove or implement no-op switches, label browser time honestly, and back or remove the audit claim.

### FE-15 � Medium � Password change mismatch
UI says "Minimal 6 karakter" and sends only `{password}`; backend requires `min(8)` and accepts an optional `currentPassword` (not sent). 6�7 char passwords always fail; a stolen access token can change the password without the old one.
**Fix:** require 8+ in the UI, add and send `currentPassword`, show field-level errors.

### FE-16 � Medium � Four different VMAF gate/target values
VMAF header says =93, chart gate/pass badge say 80, config defaults are 85/81, backend `gateMet` is hardcoded `>=80` (`stats.ts:512`).
**Fix:** one target sourced from config/API everywhere.

### FE-17 � Medium � Telemetry history is seeded and time-compressed
`telemetry.ts:255-272` fills 30 samples with the current value on first poll; the ring buffer is shared by 2 s Hardware polling and 5 s VMAF polling, and stops when Hardware unmounts. A "60 s" axis can contain stale or 150 s of samples.
**Fix:** store `{timestamp, value}`, prune by elapsed time, never seed, poll only while visible.

### FE-18 � Medium � Escape silently discards all unsaved config edits
`ConfigurationView.vue:2108-2118` binds a global `keydown`; pressing Escape in any field calls `revertAll()` without confirmation.
**Fix:** ignore Escape while focus is in an input/select/textarea; confirm before reverting.

### FE-19 � Medium � Stream playback cannot recover from token expiry; STUN config ignored
`VideoPlayer.vue:236,277-286` uses a hardcoded Google STUN server and raw `fetch` for WHEP; HLS/WHEP URLs bake the access token at render time and never refresh.
**Fix:** use the configured STUN server, refresh once on 401, rebuild URLs after refresh.

### FE-20 � Medium � Disabled cameras still stream and join detection rooms
`LiveMatrixView.vue:75-118` renders `<VideoPlayer>` for every camera regardless of `enabled`, and joins all rooms.
**Fix:** render a placeholder for disabled cameras; join/leave rooms based on the enabled list.

### FE-21 � Medium � No route-level code splitting
All views and `hls.js` are statically imported; the login page and first matrix paint download the configuration console and HLS library. The built JS is ~935 kB (Vite warns >500 kB).
**Fix:** dynamic `import()` per route and lazy-load hls.js in the fallback path.

### FE-22 � Medium � 1 s clocks + 2 s heavy polling re-render whole pages
Hardware/Timeline/Configuration run `setInterval(..., 1000)` in the page component; Hardware calls `/api/stats` every 2 s, and that endpoint does recursive disk work + MediaMTX fetch.
**Fix:** isolate the clock in a child; pause polling on `document.hidden`; lower cadence.

### FE-23 � Medium � Hardware table fabricates per-slice bitrate/resolution/bytes
`HardwareMonitorView.vue:480-505` derives child-slice values by dividing the parent stream and invents `1920�1080`/`2304�2592`/`2304�1296` by camera id.
**Fix:** show "�"/"shared stream" for slices or expose per-path stats.

### FE-24 � Medium � Login failure reads the wrong error field
`auth.ts:46-49` reads `data.message`; the backend returns `{error}`. Wrong password and 429 both show the generic English fallback.
**Fix:** `data.error || data.message || t("login.error")`.

### FE-25 � Medium � No viewer-aware UI
`ConfigurationView.vue` imports `authStore` but never uses it; viewers see every admin control and only discover the restriction via 403.
**Fix:** hide/disable admin controls by role; show a read-only banner.

### FE-26 � Medium � Quality gates are no-ops or blind to contracts
- JS `lint` is `echo` (no lint at all).
- Axe runs only `/matrix` with `color-contrast` disabled.
- Component tests use the wrong bbox shape (mask FE-01).
- i18n interpolation test passes no params.
- `stores.test.ts` does not await `logout()`.
- e2e config mocks still use the old flat shape.
- Three `.cjs` e2e scripts require a non-existent nested `@playwright/test`, target removed selectors, and hardcode `AdminPass123!` + `C:/Users/ZroiK/...`.
**Fix:** real ESLint, axe on every route, contract fixtures from real payloads, await async tests, replace mocks, delete or env-var-ize `.cjs` scripts.

### FE-27 � Low � nginx caching/upgrade regressions
`location /` sets `no-store` for hashed assets too (no immutable caching). API/socket/WebRTC locations hardcode `Connection "Upgrade"` instead of `map $http_upgrade $connection_upgrade`, which can confuse long-polling.
**Fix:** cache `/assets/*` as immutable; use the upgrade map; add CSP/HSTS when TLS is terminated here.

### FE-28 � Low � Dead code / bootstrap / mobile control
`SettingsView.vue` is dead; `splitCamera` and `saveSuccess` are unused; `app.ts`/`app.test.ts` only test constants; `index.html` is always `lang="id"`; mobile CSS hides the language button; three large brand PNGs are unused.
**Fix:** delete dead files/symbols/assets, initialize `<html lang>`, keep a language control on mobile.

### Frontend verified-good
`vue-tsc` and `vitest` pass; locale JSON has no duplicate keys and all referenced keys exist; the class-toggle HTTP contract is now correct; camera/stream naming is consistent across views; ONVIF control request bodies match the backend; router meta inheritance is correct; observers/timers/players are mostly cleaned up; nginx repeats security headers in both SPA locations; reduced-motion support exists.

### OPS-8 (High) � `/api/stats` reports several invented values and a false "100% savings"

A read-only `GET /api/stats` against the running API (authorized with the repo default JWT secret � itself proof of SEC-1) returned:

```json
"cpuModel": "AMD Ryzen 7 7745HX with Radeon Graphics",
"cpuCores": 8, "cpuThreads": 16,
"ramPercent": 55, "ramTotalBytes": 34359738368,
"gpuName": "NVIDIA GeForce RTX 4060 Laptop GPU",
"vramTotalMb": 8188,
"diskBreakdown": { "rawBytes": 5187091846, "compressedBytes": 6, "snapshotsBytes": 6, "otherBytes": 215827460718 },
"savings": { "totalRawBytes": 5187091846, "totalCompressedBytes": 6, "savingsPct": 100 },
"network": { "streams": [
  { "name": "cam1",  "ready": false, "codec": "H.264", "resolution": "1920x1080" },
  { "name": "cam2",  "ready": false, "codec": "H.264", "resolution": "2304x2592" },
  { "name": "cam10", "ready": false, "codec": "H.264", "resolution": "2304x2592" }
]},
"queue": { "queued": 0, "probing": 0, "encoding": 0, "verifying": 0 }
```

Problems proven by this response:

- `compressedBytes` is **6 bytes** (the `.gitkeep` file), yet `savingsPct` is **100**. The UI will advertise 100% storage savings with zero compressed recordings.
- `queue` is hardcoded zeros (`stats.ts:360-365`) even though the scheduler says it enqueues jobs.
- `network.streams` resolves `ready:false` cameras with invented codec/resolution strings (`stats.ts:191-192,257`), and `bitrateMbps` falls back to `7.4`/`1.0` by camera id (`:217-219`) when MediaMTX has no data.
- `cpuThreads` is `max(16, actual)` and host RAM defaults to 32 GB / 55% when `/data/host_ram.json` is empty (`stats.ts:282-295`).
- `gpu`/`vramTotal` are hardcoded to the RTX 4060 (8188 MB) when NVML data is missing (`stats.ts:339-343,433-439`).
- The `/api/stats` disk fallback fabricates 50% (`watermark.ts:38-46`) � the same number feeds the deletion-adjacent watermark gate.

**Fix:** return `null`/`"unknown"` for missing telemetry, compute savings only from `COMPLETED` recordings with a nonzero compressed size, compute queue counts from BullMQ/DB, and make the disk gate fail closed (or stop deleting) when usage cannot be measured.

### OPS-9 (Medium) � The API can be authenticated with the repo default secret

The same read-only call succeeded with a JWT signed using the public default in `.env.example`/compose (and the local `.env`). This is direct proof that SEC-1 is exploitable, not theoretical: an attacker with the repo can mint an admin token for any deployment that kept the default.

---

## 4. Backend (`apps/api-server`)

> Findings below were verified directly against code and the live API.

---

## 5. AI vision worker (`services/ai-vision-worker`)

PyAV 19.0.2, redis-py 8.1.0, PyMySQL 2.2.8 verified in the container. The live stack currently proves several of these (reader threads dead, 401s, zero activity windows).

### AI-01 � Critical � `av.AVError` does not exist in PyAV 19 � every reader error becomes `AttributeError`
**File:** `src/stream_reader.py:153,177`.
The except tuple evaluates `av.AVError`, which is absent (`hasattr(av,"AVError") == False`; the class is `av.FFmpegError`). Any open/decode error (including the deliberate `ValueError("No video stream found")`) raises `AttributeError` while handling it, escapes `run_reader`, and kills the daemon reader thread. `is_connected` is never set false, so health keeps reporting connected. Live evidence: `Exception in thread cam-1-reader � AttributeError: module 'av' has no attribute 'AVError'`.
**Fix:** catch `av.FFmpegError` / `av.error.FFmpegError`; add a reconnect test that monkeypatches `av.open`/`decode`.

### AI-02 � High � One shared MySQL connection with no read/write timeout, behind a global lock
**Files:** `src/main.py:40-48`; `src/worker.py:49-55,76-181`.
`pymysql.connect` sets no `connect_timeout`/`read_timeout`/`write_timeout`; both flush methods hold `_db_lock` across `ping`, `execute`, and `commit`. A half-open/stalled MySQL blocks the lock forever and freezes every camera's consumer thread while frames are silently dropped.
**Fix:** set 5 s timeouts; move writes to a dedicated writer/queue or per-thread connections; add a circuit breaker and degradation signal.

### AI-03 � High � Detection payload cannot be consumed by the dashboard
**Files:** `src/detector.py:75-83`; `src/worker.py:214-220`; `apps/web-dashboard/src/components/BboxOverlay.vue:169-171`.
The worker publishes `{cls, conf, x1..y2, box}`; the overlay requires `{bbox, confidence, class_id, class_name}`. Every box is skipped. See FE-01.
**Fix:** emit both shapes or normalize in the gateway; add a wire-contract test.

### AI-04 � High � Redis/MySQL outage at startup disables control-plane threads forever
**Files:** `src/main.py:101-126,158-165`; `src/worker.py:370-399`.
`r_client = None` / `db_conn = None` on startup failure; toggle listener, reconciliation, GPU telemetry, and camera-change listener are only started when `redis_client is not None`; pipelines still start but writes return immediately. A reboot-ordering blip turns the worker into a static detection-only process for its lifetime.
**Fix:** start supervisor threads unconditionally with reconnect/backoff, or fail fast and let `restart: unless-stopped` recover; expose connection state in health.

### AI-05 � High � Control-plane Redis threads die permanently; no resubscribe/backoff
**Files:** `src/toggle_sync.py:158-175,190-196`; `src/gpu_stats.py:114-123`; `src/main.py:57-86`.
`subscribe()` is outside the `try`; loops catch `OSError`/`ValueError`, not `redis.RedisError`; `reconcile_camera` does not catch Redis errors; `gpu_stats` catches builtin `ConnectionError`, not `redis.ConnectionError`. Any Redis restart kills the threads with no restart.
**Fix:** wrap connect/subscribe in the retry loop; catch `redis.RedisError`; close+resubscribe with `1?30 s` backoff; watchdog thread liveness.

### AI-06 � High � Camera enable/disable is ignored; `updated` always restarts a pipeline
**Files:** `src/main.py:73-79`; `apps/api-server/src/routes/cameras.ts:398-400,464-472`.
The API publishes `action:"updated"` for any change including `enabled`; the worker only reads `camera_id/action` and never re-checks `enabled`. Disabling a running camera does nothing; disabling a stopped camera starts AI on it. Metadata-only edits restart the RTSP connection unnecessarily.
**Fix:** include/read `enabled`; on `updated`, remove when disabled and only restart when the stream URL/path changed.

### AI-07 � Medium � Clean EOF is not a failure: `is_connected` stays true and reconnect is unthrottled
**File:** `src/stream_reader.py:127,136-178`.
A clean generator end exits the `for` loop without entering `except`, so no backoff and no `reconnect_attempt += 1`; the loop immediately reopens. `is_connected` stays true with no frames.
**Fix:** handle EOF in `finally`/after the loop as a disconnect; set state false; apply the same backoff for all disconnect paths.

### AI-08 � Medium � No read/liveness watchdog; `stop()` cannot interrupt a blocked decode
**Files:** `src/stream_reader.py:136-138`; `src/worker.py:277-284,323-346`.
`stop_event` is checked only when a frame arrives. A silent TCP stall blocks `container.decode` forever; `stop()` gives up after 2 s, leaving the old reader connected while `add_camera` opens a second connection.
**Fix:** wall-clock stale-frame watchdog that closes the container; use a generation token; wait for the old thread before starting a replacement.

### AI-09 � Medium � CUDA?CPU fallback is process-global and racy
**Files:** `src/detector.py:22-43,128-139`; `src/worker.py:302,331`.
One shared model/device is used by all camera threads. One camera's OOM/driver error mutates `self.device="cpu"` under another thread's predict; a transient OOM permanently downgrades all cameras with no alert or recovery.
**Fix:** serialize inference (single worker thread) or lock around predict/device; catch `torch.cuda.OutOfMemoryError`, empty cache, retry; expose `device/degraded` telemetry.

### AI-10 � Medium � Open activity window is dropped on stop/restart; multi-window gaps are skipped
**Files:** `src/worker.py:277-284,342-346`; `src/activity_indexer.py:97-144`.
`stop()` never flushes the current window; a jump over multiple window boundaries closes only the current one. Spec �8.2 wants every closed window persisted.
**Fix:** `close_and_get_all(now)` on stop/remove; optionally write explicit zero windows for known gaps.

### AI-11 � Medium � GPU telemetry has no TTL/staleness flag; fallback zeros look live
**Files:** `src/gpu_stats.py:52-61,118-119`; `apps/api-server/src/routes/stats.ts:273-277`.
`hw:gpu` is written without TTL or timestamp; fallback is all zeros; the API serves whatever is there without checking age. A dead telemetry thread shows frozen �live� values; unavailable NVML shows 0% as measured.
**Fix:** include `ts_ms`/`source`/`degraded`; `SETEX` with 3� interval; API rejects stale payloads; publish a degradation alert.

### AI-12 � Medium � Window/config drift; documented env knobs ignored
**Files:** `docker-compose.yml:222`; `.env`; `src/main.py:97-98`; `src/worker.py:304`; `src/activity_indexer.py:76`.
Compose hardcodes `PROBE_SAMPLE_SEC: 5` for the worker while `.env` says 10 and the API default is 20; `EVENT_COOLDOWN_SEC`, `OTHER_CLASS_WEIGHT`, and `MEDIAMTX_AUTH_SECRET` are not passed to the worker. The worker writes 5 s windows while the API sizes its expectations differently.
**Fix:** pass the same env into both services, validate, and assert the window size matches at startup.

### AI-13 � Medium � Malformed toggle messages can disable detection; thresholds/revisions unvalidated
**File:** `src/toggle_sync.py:60-68,81-86`.
Missing `resolved_active_ids` becomes `[]` (detect nothing); `confidence` accepts negative/NaN/Inf/>1; `rev` accepts negatives.
**Fix:** require the field, clamp confidence to `[0.05,0.95]`, reject non-finite values and negative revs.

### AI-14 � Medium � Reconciliation can overwrite newer pub/sub state; authoritative `cam:{id}:rev` ignored
**Files:** `src/toggle_sync.py:101-135`; `apps/api-server/src/routes/cameras.ts:319,737`.
A reconcile read outside the lock can write old classes with the new rev; the API resets rev to 1 on camera writes, so a worker with local rev 7 discards all new toggles until orchestration catches up.
**Fix:** `MGET` classes/conf/rev and apply atomically only when the authoritative rev is newer; treat Redis as source of truth.

### AI-15 � Medium � Event is marked emitted before the DB insert; failed insert loses the event for the cooldown
**Files:** `src/event_dedup.py:41-47`; `src/worker.py:229-239,150-184`.
`_last_event_timestamps` is set before persistence; a DB failure only logs, and the same camera/class is suppressed for the next 5 s.
**Fix:** mark only after a successful commit, or buffer/retry events.

### AI-16 � Medium � Unbounded per-frame event inserts under the global DB lock
**Files:** `src/worker.py:230-239`; `src/event_dedup.py:38-45`.
One row per detected object, each with ping+INSERT+commit while holding `_db_lock`; a crowded frame blocks all cameras.
**Fix:** one multi-row insert per frame or a writer queue; cap events per frame/camera.

### AI-17 � Medium � No env validation; `PROBE_SAMPLE_SEC=0` kills the consumer, `AI_FPS=0` becomes 0.1 FPS, missing model downloads weights
**Files:** `src/main.py:96-98`; `src/activity_indexer.py:88-95`; `src/worker.py:247-257`; `src/detector.py:34`; `src/stream_reader.py:84`.
`ZeroDivisionError` is not in the consumer guard; `1/max(0.1, fps)` turns 0 into a 10 s interval; `YOLO(model_path)` auto-downloads when the path is wrong.
**Fix:** validate all envs at startup and abort with a clear error; add `ArithmeticError` to the guard; require an existing model path.

### AI-18 � Low � Duplicate per-frame Redis payload and error-log flood
**Files:** `src/worker.py:212-222`; `src/detector.py:75-83`.
Each box carries `x1..y2` plus a duplicate `box`; each frame is a separate JSON publish; each failure logs at frame rate.
**Fix:** publish one canonical shape; remove the duplicate; rate-limit error logs; optionally skip publish when no subscribers.

### AI-19 � Low � RTSP credential masking is incomplete; secrets are not URL-encoded
**Files:** `src/stream_reader.py:14-17`; `src/main.py:77,140`.
The regex stops at the first `@`, so a password containing `@` leaks its tail; no-password userinfo and query tokens are not masked; `mediamtx_secret` is interpolated raw into the URL.
**Fix:** build/mask URLs with `urllib.parse`; encode the secret.

### AI-20 � Low � Duplicate weight tables and dead code
**Files:** `src/__init__.py:5-22` vs `src/activity_indexer.py:10-37`; `src/detector.py:155`; `src/activity_indexer.py:92`; `src/event_dedup.py:66`; `src/worker.py:352`.
Two independent weight maps; `get_window_index`, `prune_stale_entries`, `export_engine`, `get_class_names`, `get_health_status` have no production callers.
**Fix:** one weight source; delete or wire the dead helpers.

### AI-21 � Low � Tests never exercise the real failures
`tests/test_detector.py:12` loads the real model and runs real inference; `mock_db` is a `MagicMock`; `run_reader`, `main.py`, Redis failures, `flush_*`, and the payload contract are untested.
**Fix:** monkeypatch YOLO; fake cursor/connection assertions; fake `av` container; raw-payload contract test.

### AI-22 � Low � Non-reproducible image, root user, weak health, no MediaMTX dependency
**File:** `Dockerfile`; `docker-compose.yml:203-236`.
`uv.lock` is copied but `uv pip install` ignores it; no `USER`/`HEALTHCHECK`; no `depends_on: mediamtx`; healthcheck is Redis TCP only; no `NVIDIA_DRIVER_CAPABILITIES`.
**Fix:** `uv sync --frozen`, pin base digest, non-root, real health, MediaMTX dependency.

### AI carried over (re-verified)
`window_index` is still an absolute epoch bucket; recording selection is `ORDER BY id DESC LIMIT 1` without `[started_at, ended_at]` containment; `rel_offset % 60` and `segment_index=0` remain; YOLO26/TensorRT/NVDEC/FP16 claims are still not implemented; `remove_camera` does not clear toggle/seq state; `get_health_status` still hardcodes healthy; wall-clock sampling remains; early events still get `recording_id=NULL`; `prune_stale_entries` is never called.

### AI verified-good
The `_db_lock` now covers the full read-modify-write (V-R7); `bbox_json` is fixed in current code; the publish path catches `redis.RedisError`; `ToggleSynchronizer` uses a lock and immutable state; `FrameQueue` is bounded and drops oldest; toggles do not reload the model; detector init and per-frame `RuntimeError` fall back to CPU; `container.close()` exists; GPU payload keys match the spec; DB columns/upsert keys match the schema; window alignment/weights are correct; coordinates are clamped; standard `user:pass@host` masking works.

---

## 6. Recorder and RTSP proxy (`services/media-engine`)

### REC-01 � High � ffmpeg failures are invisible and the recorder silently retries forever
**Files:** `recorder/src/supervisor.ts:241-285`; live logs.
The exit handler increments failures, finalizes the current segment, and restarts with backoff, but never logs the exit code, signal, or the drained stderr tail. In the current deployment the recorder has written no new segments (MediaMTX auth 500) while the log only says "monitoring". The `system:alert` publish starts after 5 failures and is fire-and-forget, unthrottled.
**Fix:** log code/signal + last stderr lines on every unexpected exit; emit one alert per outage (with re-arm); add a recent-segment healthcheck.

### REC-02 � High � Finalize UPDATE has no status guard / single-flight
**Files:** `recorder/src/recorder.ts:139-171`; `supervisor.ts:128-160`.
The final UPDATE sets `RAW` with `WHERE id = ?` only; the exit handler and the file-watch handler can both finalize the same segment. There is no `WHERE status='RECORDING'` and no in-flight set, so last write wins.
**Fix:** `WHERE id=? AND status='RECORDING'` and an in-flight set keyed by path; skip if another finalize is running.

### REC-03 � Medium � Probe fabricates fps/codec and uses `r_frame_rate`; no maxBuffer
**File:** `recorder/src/probe.ts:42-56`.
`fps` defaults to `25.0`, `codec` to `"unknown"`, and the nominal `r_frame_rate` is used instead of `avg_frame_rate`; `execFile` has no `maxBuffer`, so a corrupt file can produce `ENOBUFS` and be misclassified as SKIPPED.
**Fix:** use `avg_frame_rate`, return `null`/0 for unknown values, set `maxBuffer`, and distinguish zero-duration from unreadable.

### REC-04 � Medium � Same-second filename collision vs UNIQUE(raw_path)
**File:** `supervisor.ts:180` + `001_initial_schema.up.sql` (`raw_path UNIQUE`).
A crash/restart inside one second can regenerate the same filename; the INSERT fails and feeds the silent retry loop.
**Fix:** add a sequence/pid suffix or `INSERT � ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)`.

### REC-05 � Medium � `setSegmentSec` is a no-op for running ffmpegs
**File:** `recorder/src/recorder.ts:43-45` + `main.ts` `system:config_changed`.
It updates options used only by future supervisors; running ffmpegs keep `-segment_time`, while the log claims the new duration is configured.
**Fix:** recreate/restart supervisors on change or log truthfully that it applies to the next spawn.

### REC-06 � Medium � Config/env validation gaps
**File:** `main.ts:41-55,105-117`.
`Number(val.segmentDurationMin) * 60` can produce `NaN` (`Math.max(60, NaN)` is `NaN`), which reaches `-segment_time`; config load errors are swallowed. `camera:changed updated` always unregisters/re-registers, restarting the RTSP stream for metadata-only edits; there is no retry for failed registrations and no periodic DB?supervisor reconcile.
**Fix:** zod-validate the recording config, clamp to a valid range, only restart on stream-relevant changes, and add a periodic reconcile.

### REC-07 � Medium � `stop()` can hang / double-finalize
**Files:** `supervisor.ts:84-111`.
`stop()` waits for `exit` after SIGTERM, schedules SIGKILL after 3 s, and then may call `onFinalizeSegment` while the exit handler may also finalize. If `proc.kill()` throws, the promise rejects. `fs.watch` `error` events are still unhandled.
**Fix:** guard `kill`, attach an error handler, set a bounded settle timer that resolves even if `exit` never fires, and make finalize idempotent.

### REC-08 � Medium � Absolute `raw_path` coupled to container paths
**Files:** `recorder.ts:86`; `reconciler.ts`.
The recorder writes `/data/...` absolute paths; host tests/dev with `data/raw` cannot reconcile the same rows. This is the remaining half of R-H6.
**Fix:** store a path relative to `RAW_DIR` and resolve at read time.

### REC-09 � Medium � Reconciler finalizes without a status guard and sequential probes can block startup
**Files:** `reconciler.ts:22-80`.
Every `RECORDING` row is probed sequentially (15 s each); UPDATEs are unguarded; `failed` counts SKIPPED/unreadable but the naming suggests errors. The reverse pass now inserts orphan files (fixed).
**Fix:** `WHERE status='RECORDING'`, parallelize with a small pool, and rename/define counters.

### RTSP-01 � High � Protocol handling is still fragile
**File:** `rtsp-proxy/proxy.py`.
- Request/response rewriting is per `recv(8192)` chunk (`:162-190`), so split request lines bypass rewriting and SDP `config=`/Content-Length patches garble when messages span chunks. No RTSP message framing.
- The proxy strips the camera's `WWW-Authenticate: Digest` challenge and injects Basic (`:208-212`), breaking digest-only firmware; the OPTIONS special case is a symptom.
- Hand-rolled Redis RESP (`:30-58`) mis-parses coalesced/split replies and truncates >4096-byte bulks; one AUTH handshake per lookup per 15 s.
- Bare `except: pass` on both pumps (`:191,229`); `URL_CACHE` is never pruned; only the first packet determines the camera, then the session is retargeted.
**Fix:** buffer and parse complete RTSP messages, relay challenges untouched (or implement digest), use `redis-py`, add idle/keepalive timeouts and a connection cap, and log/limit errors instead of swallowing.

### RTSP-02 � Medium � Deployment/runtime hygiene
`rtsp-proxy/Dockerfile` is `python:3.11-alpine`, root, no healthcheck; compose bind-mounts `proxy.py` over the image; `test_v380.py` hardcodes a LAN IP and validates a different Content-Length algorithm; `LISTEN_PORT` is hardcoded to 8555 despite the env convention. The host port is now internal-only (good).
**Fix:** pin the base, add a non-root user/healthcheck, stop bind-mounting source in prod, env-ize the port, and delete/fix the ad-hoc test.

---

## 7. Infrastructure, compose, env, docs

### INF-01 � Critical � Compose does not pass `MEDIAMTX_AUTH_SECRET` (root cause of OPS-1)
**File:** `docker-compose.yml` (api-server/recorder/ai-vision blocks).
`NODE_ENV=production` + the fail-closed check in `internal.ts:9-18` makes the auth hook return 500. The `.env` value exists but is never forwarded. Add it to api-server, recorder, ai-vision-worker, and the dev sim-cams; generate a unique value.

### INF-02 � High � 30+ documented env knobs are inert in Docker
`.env.example` defines `WEB_ORIGIN`, `JWT_*_EXPIRES_SEC`, `MODELS_DIR`, `RAW_DELETE_GRACE_SEC`, `DELETE_RAW_AFTER_VERIFY`, `PROBE_INTERVAL_SEC`, `CQ_*`, `STATIC_CQ_TTL_SEC`, `DEFAULT_TARGET_VMAF_*`, `DEFAULT_ENCODER/PRESET`, `VMAF_TIMEOUT_SEC`, `EVENT_COOLDOWN_SEC`, `WEIGHT_*`, `OTHER_CLASS_WEIGHT`, `DISK_*`, `QUEUE_W_*`, `TMP_DIR`, `UI_DEFAULT_LANG`, etc. Compose forwards almost none of them. `TMP_DIR` vs `TEMP_DIR` is inconsistent. `RAW_RETENTION_SEC` is `${RAW_RETENTION_SEC:-30}` for api-server but hardcoded `86400` for transcode.
**Fix:** one canonical env list passed to every service; unify names; derive presets in one place; fail startup on unknown/missing required values.

### INF-03 � High � Production runs from host bind-mounts, not images
`docker-compose.yml` bind-mounts `apps/api-server/dist`, `services/media-engine/recorder/dist`, `apps/web-dashboard/dist`, and `services/ai-vision-worker/src` over the image. The running code is whatever sits on the host; a stale/missing dist silently ships old code or crashes. Images also COPY the same files (dead weight).
**Fix:** bake code into multi-stage images for prod; keep host mounts in a dev overlay only.

### INF-04 � High � Healthchecks do not check the product
Recorder/transcode/ai-vision probe only Redis TCP (`docker-compose.yml:139,181,222`); web probes `GET /`; api `/healthz` is static. The live stack reports all healthy while recording, AI, and auth are broken. `/readyz` exists but is not proxied by nginx and is not used by any healthcheck.
**Fix:** real probes (recent segment mtime, queue heartbeat, last detection, MediaMTX auth ping), and expose `/readyz` through nginx.

### INF-05 � High � Default secrets are real and committed
`.env.example` (tracked) and the local `.env` use the public all-zero `CREDENTIAL_KEY` and the public default JWT secret; compose embeds both as fallbacks (`docker-compose.yml:91-92,134`). The running API accepted a JWT signed with the repo default (OPS-9). `MEDIAMTX_AUTH_SECRET` is also the public literal.
**Fix:** generate unique values, keep them out of git, remove compose fallbacks, fail closed on the known defaults, rotate encrypted camera credentials and all sessions.

### INF-06 � Medium � Unpinned/moving images and implicit build order
`bluenviron/mediamtx:latest`, `ghcr.io/feldjaeger/ffmpeg-vmaf-cuda:latest`, `nvidia/cuda:12.4.1-*` (tag not digest), `python:3.11-alpine`, `nginx:alpine`, `mysql:8.4`, `redis:7.4-alpine`. The recorder Dockerfile is `FROM vms-transcode-worker:latest` � an image that only exists after another service is built, so `docker compose build recorder` alone is unreliable. `Dockerfile.ffmpeg` exists but no compose service builds it; the transcode worker uses the third-party image.
**Fix:** pin digests/tags, add a dedicated recorder base, and either use the local FFmpeg build or document the third-party image as the supported one.

### INF-07 � Medium � MediaMTX config limits remote playback
`services/media-engine/mediamtx.yml` sets `webrtcAdditionalHosts: [127.0.0.1, localhost]`, so WHEP candidates are loopback-only for any remote viewer; `hlsAlwaysRemux: yes` remuxes every path continuously even with no viewers; `sourceOnDemand: no` for cam1/cam2 keeps pulling; `authMethod: http` depends on the broken hook. `part duration changed` warnings appear in the logs.
**Fix:** derive additional hosts from `WEB_ORIGIN`/env, switch to on-demand where appropriate, and verify ICE candidates from a non-loopback client.

### INF-08 � Medium � Dev/test workflow is inconsistent with the deployed topology
- Compose MySQL is `127.0.0.1:3307`, Redis `6380`; `.env` and the test suites use `3306`/`6379`, so `pnpm test` / `pnpm verify` fail with `ECONNREFUSED` on a normal `docker compose up`. There is no test profile or `.env.test`.
- `pnpm verify` includes Playwright, which needs the Vite dev server on 5173 and a seeded backend; it is not runnable in the deployed 8080 stack.
- Root `package.json` has no `dev` or `start` convenience script; `pnpm dev` at the root does nothing.
**Fix:** add a documented test profile/env (3307/6380), separate unit from e2e, and add root `dev`/`start` scripts.

### INF-09 � Medium � Documentation/config drift
- README and `start-vms.bat` still advertise 5173 and RTSP proxy `8555`; only 8080 is published (OPS answer).
- README default credentials `admin` / `AdminPassword123!` are not guaranteed; production seeds a random password when the users table is empty.
- README table says API "3000", MediaMTX API "9997" without noting the 127.0.0.1 binding; MySQL/Redis host ports differ from `.env`.
- `system_config.network.httpPort=5173`, `whepPort=8555`; deployed values are 8080/8889.
- Docs claim YOLO26n/TensorRT/NVDEC/FP16 and "zero-CPU" recording; the worker loads `yolov8n.pt` FP32 PyTorch, and ffmpeg RTSP ingest still uses CPU for the container/protocol work.
- `configuration-export.html` (472 KB) and a 357 KB `ONVIF_DEVICE_MANAGER_ANALYSIS.md` are large committed artifacts; `tes/` is an empty directory; `data/` contains ~4.9 GB of test recordings.
**Fix:** generate docs from code/env where possible; remove stale claims and artifacts; add a docs-lint for port/command drift.

### INF-10 � Medium � Quality gates are largely decorative
- JS workspace `lint` is `echo` (api, web, recorder); only the Python worker has a real linter.
- The only CI-like gate (`pnpm verify`) runs typecheck + mostly DB-gated tests + Playwright, and is red on a stock compose setup.
- No dependency audit, no image scanning, no secret scanning, no migration dry-run.
- `.env` is correctly gitignored; `configuration-export.html`/screenshots are in the tree.
**Fix:** add real ESLint, a unit/integration split, a compose-based CI profile, secret/dependency/image scanning, and a pre-commit hook.

### INF-11 � Low � Container hardening
API/web/recorder/transcode/AI images run as root; no `read_only`, `cap_drop`, `no-new-privileges`, or resource limits (except the GPU reservation). MySQL/Redis publish only to 127.0.0.1 (good), but MediaMTX RTSP/HLS/WebRTC are on all interfaces and the API is on 127.0.0.1.
**Fix:** non-root images, `security_opt: [no-new-privileges:true]`, `cap_drop: [ALL]`, resource limits, and a reverse proxy/TLS termination plan.

### INF-12 � Low � Repo hygiene
Dead/one-off scripts (~47 in `scripts/`), duplicated capture/check scripts, committed screenshots/proof PNGs, machine-specific absolute paths in e2e helpers, `.cjs` scripts with `AdminPass123!`, `test-results/.last-run.json`, and an empty `tes/` directory. `.gitignore` ignores `*.html` globally, which can hide real templates.
**Fix:** delete one-off artifacts or move them to `docs/artifacts`; env-var-ize credentials/paths; tighten `.gitignore`.

### BE-01 � Critical � Committed default secrets bypass the new fail-closed logic
**Files:** `.env`; `docker-compose.yml:91-92,134`; `apps/api-server/src/auth/service.ts` (JWT); `crypto/credentials.ts`.
The app now refuses a non-32-byte `CREDENTIAL_KEY` and fails when `JWT_SECRET` is missing, but both are present with the public defaults. The running API accepted a JWT signed with the repo default (OPS-9). Camera credentials are therefore encrypted with a known key.
**Fix:** unique secrets, no compose fallbacks, reject the known defaults by value, rotate credentials and sessions.

### BE-02 � High � MediaMTX sync throws outside its try/catch and the secret is missing
**Files:** `apps/api-server/src/mediamtx/client.ts:5-12,17-24`; `routes/cameras.ts:339,577`; `routes/onvif.ts:229`; `docker-compose.yml`.
`getMediaMtxAuthHeader()` throws in production when the env is missing, before `syncCameraToMediaMTX`'s own `try`. Camera create/update/delete call it outside a try, so a DB/Redis commit can be followed by a 500 and an unsynced MediaMTX path. This is the same root cause as OPS-1.
**Fix:** move header construction inside the try (return `false` on config error), pass the secret in compose, and make the route report the partial-sync failure explicitly.

### BE-03 � High � `join:camera` has no authorization
**File:** `sockets/gateway.ts:60-65`.
Any authenticated socket can join `camera:<id>` for any camera and receive that camera�s detection feed. There is no per-camera ACL; a viewer can subscribe to every camera.
**Fix:** check that the camera exists and that the user is allowed to view it; leave rooms on revoke; add a test.

### BE-04 � High � Audit log is in-memory and not admin-gated
**File:** `routes/config.ts:363-366`; in-memory `forensicAuditLogs`.
`GET /api/config/audit-logs` is available to any authenticated user and is lost on restart; the UI calls it �tamper-evident�. This is forensic theater.
**Fix:** persist to a DB table, add `requireRole("admin")`, and never claim tamper-evidence without a hash chain.

### BE-05 � High � Fabricated telemetry and a false 100% savings figure
See OPS-8. `stats.ts` hardcodes queue zeros, camera resolutions, initial bitrates, GPU/VRAM, CPU threads, host RAM; `watermark.ts` fabricates 50% disk usage; `savingsPct` is 100 because the only �compressed� file is the 6-byte `.gitkeep`.
**Fix:** honest null/unknown states, real queue counts, savings only from `COMPLETED` rows with nonzero compressed size.

### BE-06 � Medium � Manual trigger bypasses the state machine and uses a unique jobId
**File:** `routes/stats.ts:540-565`.
It sets `status='QUEUED'` with a raw UPDATE and enqueues `manual-rec-${id}-${Date.now()}`, so repeated clicks can enqueue concurrent jobs for the same recording (the `rec-${id}` dedupe is bypassed).
**Fix:** `transitionRecordingStatus` + deterministic `rec-${id}` jobId.

### BE-07 � Medium � Pipeline failure reset is a raw UPDATE; attempts can double-count
**Files:** `transcode/pipeline.ts:700-705`; `transcode/worker.ts:66-84`.
On error, `pipeline.ts` sets `status='RAW'` directly. The worker�s failed handler increments `attempts` and transitions to `FAILED`; if the transition fails, the catch fallback also increments. BullMQ retry plus the raw reset can produce conflicting states.
**Fix:** one failure path through `transitionRecordingStatus`, one attempts increment, and a documented retry policy.

### BE-08 � Medium � `events.ts` deep OFFSET pagination
**File:** `routes/events.ts:14-47`.
`LIMIT ? OFFSET ?` with a deep page scans/sorts the whole filtered set; `SELECT *` returns every column. The composite `(camera_id, detected_at)` index helps but deep offsets remain linear.
**Fix:** cursor pagination on `(detected_at, id)`, select only needed columns, and cap the page size (already 100).

### BE-09 � Medium � Activity-window offsets are still normalized by fabrication
**File:** `routes/recordings.ts:161-181`.
If `start_offset_sec` is missing/epoch-like/out of range, the API invents `idx * 5` offsets. That makes a broken writer look plausible and corrupts forensic timing.
**Fix:** return the stored value or `null`; fix the writer (AI-10/A-H6) instead of normalizing.

### BE-10 � Medium � Admin-only SSRF in `test-camera-ping` (and NTP)
**File:** `routes/config.ts:424-483`.
The route connects to any host/port supplied by an admin, including loopback/private ranges. `sync-ntp` also accepts an arbitrary server. Admin-only reduces the risk but does not eliminate lateral movement from a compromised admin session.
**Fix:** resolve the host and reject private/link-local/loopback ranges (with an explicit allowlist for LAN cameras), or document the capability.

### BE-11 � Medium � Socket toggle duplicates HTTP logic; confidence is unvalidated
**Files:** `sockets/gateway.ts:75-150`; `routes/cameras.ts:684-780`.
The socket path validates class IDs and admin, but `confidence_threshold` is passed through unvalidated; the HTTP path has its own copy. Both must stay in sync (they already diverged once).
**Fix:** extract one toggle service; clamp confidence; use it from both transports.

### BE-12 � Medium � Stats/MediaMTX code ignores its own env
**File:** `routes/stats.ts:167-171`.
`http://mediamtx:9997` is hardcoded and the secret falls back to the public literal, while `MEDIAMTX_HOST`/`MEDIAMTX_API_PORT` exist and are honored elsewhere.
**Fix:** use the shared MediaMTX client/env.

### BE-13 � Medium � Migrator false atomicity and naive `;` splitting
**File:** `db/migrator.ts:13-27,80-105`.
DDL inside `beginTransaction` is not atomic in MySQL (implicit commits); splitting on `;` breaks on semicolons inside strings/routines. A mid-migration failure leaves `schema_migrations` unmarked and reruns fail.
**Fix:** idempotent `IF NOT EXISTS` statements, one DDL per migration, checksums, no transaction pretense.

### BE-14 � Medium � N+1 priority recompute and recursive disk scans
**Files:** `transcode/priority.ts:56-89`; `routes/stats.ts:17-49`.
For every waiting job, a DB query plus `changePriority` per 15 s tick; `getDirSize` recursively walks `data/` (4.9 GB now, potentially TB) per 15 s, cached only 15 s. Both scale poorly.
**Fix:** one aggregate query + batched `changePriority`, and cache storage stats for longer / use `statfs` + a maintained counter.

### BE-15 � Medium � Password change does not require the current password
**File:** `auth/routes.ts:94-100,155-172`.
`currentPassword` is optional; a stolen access token can change the password. The UI does not send it and advertises 6 characters (FE-15).
**Fix:** require and verify the current password for self-service changes (or require re-auth); align UI/server validation.

### BE-16 � Medium � Socket alerts are broadcast to every client
**File:** `sockets/gateway.ts:186-195`.
`transcode:probe_step` and `system:alert` use `io.emit`, not a `system` room; every viewer receives all operational alerts and probe steps. The spec�s `system` room semantics are not implemented.
**Fix:** have system clients join a `system` room and emit there; keep camera-scoped events in camera rooms.

### BE-17 � Low � Rate limiter is non-atomic and fail-open
**File:** `auth/middleware.ts:60-95`.
INCR and conditional EXPIRE are separate round-trips (crash window leaves a TTL-less key); Redis errors fail open; `app.set("trust proxy")` is not configured, so behind a proxy all clients share `req.ip`.
**Fix:** Lua/`SET NX EX`+INCR, fail closed for auth endpoints, configure trusted proxy hops.

### BE-18 � Low � Config defaults still advertise fiction
**File:** `routes/config.ts:20-30`.
`ai_engine.model: "YOLO26n"`, `engineVersion: "YOLO26n TensorRT 10.x �"`, `whepPort: 8555`, `httpPort: 5173`. The worker loads `yolov8n.pt` FP32 and WHEP is 8889.
**Fix:** derive defaults from the real runtime/config; remove unverified model claims.

### Backend verified-good
RBAC (`requireRole("admin")`) now covers the mutating camera/config/ONVIF routes; a global JSON error middleware exists (stack hidden in production); `/readyz` genuinely checks DB+Redis; DB fail-fast in production; ONVIF XML is escaped; a shared MediaMTX client has 5 s timeouts; query tokens are restricted to `/stream`; the internal auth hook is rate-limited and uses `timingSafeEqual`; recording path checks resolve real paths; `requeue` now transitions + uses `rec-${id}`; the scheduler has `LIMIT 50`; the fresh activity/priority/window tests pass. The API boots and serves `{"error":"Endpoint not found"}` for unknown `/api` routes.

---

## 8. Executive summary � the 15 things that matter most

| # | Severity | Problem | Where |
|---|---|---|---|
| 1 | Critical | MediaMTX auth webhook returns 500 because `MEDIAMTX_AUTH_SECRET` is not passed to the API container; all streams denied, recorder/AI/dashboard dead | `docker-compose.yml`, `routes/internal.ts:9-18` |
| 2 | Critical | Default all-zero `CREDENTIAL_KEY` + default `JWT_SECRET` are committed/used; a JWT signed with the repo secret authenticates | `.env`, compose, OPS-9 |
| 3 | Critical | AI reader threads die on every error because `av.AVError` no longer exists in PyAV 19 | `stream_reader.py:153,177` |
| 4 | Critical | Live AI boxes never render: producer/consumer payload contract mismatch (`box/conf/cls` vs `bbox/confidence/class_name`) | `detector.py`, `BboxOverlay.vue` |
| 5 | High | Recorder silently retries broken ffmpeg and writes no segments; no error/exit logging | `supervisor.ts`, live logs |
| 6 | High | Transcoder never completes a recording: VMAF and verification timeouts; 0 `COMPLETED`, empty `compressed/`, false 100% savings | `pipeline.ts`, `vmaf/runner.ts`, live DB |
| 7 | High | Camera create/update/delete can return 500 after partial DB/Redis commit because MediaMTX sync throws outside try | `mediamtx/client.ts`, `routes/cameras.ts` |
| 8 | High | Healthchecks are Redis-TCP/HTTP tautologies; all services �healthy� during total media outage | compose |
| 9 | High | `join:camera` has no authorization; any viewer can subscribe to any camera�s detections | `sockets/gateway.ts:60-65` |
| 10 | High | Concurrent 401 refresh race revokes the winning token and logs the user out | `services/api.ts`, `auth/service.ts` |
| 11 | High | ONVIF discovery/verify/import entirely broken by endpoint/field drift | `ConfigurationView.vue`, `routes/onvif.ts` |
| 12 | High | Timeline always shows VMAF 94.2; VMAF chart synthesizes a curve; hardware/config panels show fabricated �healthy� data | `TimelineView.vue`, `VmafTelemetryView.vue`, `HardwareMonitorView.vue`, `stats.ts` |
| 13 | High | AI control-plane Redis threads die permanently on any Redis blip; startup outage disables toggles/reconciliation/telemetry forever | `main.py`, `toggle_sync.py`, `gpu_stats.py` |
| 14 | High | Camera enable/disable is ignored live; `updated` restarts or starts AI on disabled cameras | `main.py`, `routes/cameras.ts` |
| 15 | High | 30+ documented env knobs are inert; prod runs from host bind-mounts; unpinned FFmpeg/MediaMTX images | compose/Dockerfiles |

---

## 9. Prioritized remediation plan (suggested order)

### P0 � restore a working, secure system (days)
1. Pass `MEDIAMTX_AUTH_SECRET` (+ `MEDIAMTX_HOST/PORT`) to api-server, recorder, ai-vision, dev sim-cams; make the auth hook return 401 (not 500) on config errors.
2. Generate unique `CREDENTIAL_KEY`, `JWT_SECRET`, `MEDIAMTX_AUTH_SECRET`, DB/Redis passwords; remove compose fallbacks; reject the known defaults; rotate camera credentials and all sessions.
3. Fix `av.AVError` ? `av.FFmpegError`; add reader supervision and a real liveness check.
4. Normalize the detection payload (or emit the dashboard shape) and add a producer?consumer contract test.
5. Add exit/stderr logging to the recorder and a �recent segment� healthcheck.
6. Reproduce one VMAF command manually; fix the CUDA/CPU timeout and the 60 s full-decode verification; log stderr; add job success metrics.
7. Replace tautology healthchecks; expose `/readyz` through nginx.

### P1 � data integrity and contract correctness (1�2 weeks)
8. Make MediaMTX sync safe on all camera routes; make camera delete/update atomic with Redis/MediaMTX best-effort + explicit status.
9. Require current password for password changes; align the UI 8-char rule; fix the login `error` field.
10. Add `join:camera` authorization and a `system` room for alerts/probe steps.
11. Fix the refresh single-flight, stale socket token, and per-route media-token/download handling.
12. Fix ONVIF discovery/verify/add-bulk; use `data.devices`, `/verify`, `hasPtz/hasImaging`, and the verified stream URI.
13. Fix the activity-window writer (containment, relative `window_index`, real offsets, flush on stop) and remove API offset fabrication.
14. Remove fabricated telemetry/savings/health; return `null`/`unknown`; fix the disk-watermark fail-open.
15. Stop binding prod to host `dist`/`src`; pin images; pass one canonical env list; add a test compose profile (3307/6380).

### P2 � UX, performance, docs, quality (2�4 weeks)
16. i18n completion + key-parity CI; remove hardcoded Indonesian from login/timeline/config.
17. Keyboard/a11y fixes (tiles, scrubber, modal focus trap, labeled switches).
18. Route-level code splitting, lazy hls.js, pause hidden-tab polling, isolate clocks.
19. Remove dead files/assets/scripts; fix `SettingsView`, locale bootstrap, mobile language control.
20. Real ESLint, axe on every route, contract fixtures, await async tests, delete/parameterize `.cjs` e2e scripts.
21. Persist audit logs; add DB-backed tamper evidence or drop the claim.
22. Update README/start scripts/config defaults (8080, 8889, real credentials/model).

---

## 10. Verification commands used

```bash
# static
pnpm -r --workspace-concurrency=1 run typecheck
pnpm -r --workspace-concurrency=1 run build
pnpm lint
uv run --directory services/ai-vision-worker --with pytest,ruff ruff check .
uv run --directory services/ai-vision-worker --with pytest pytest

# live stack (WSL)
docker compose ps
docker compose logs --tail=200 api-server recorder ai-vision-worker mediamtx transcode-worker
docker compose exec -T ai-vision-worker python -   # PyAV introspection
docker compose exec -T transcode-worker ffmpeg -hide_banner -filters
docker compose exec -T mysql mysql -u... -e 'SELECT status, COUNT(*) ...'
curl -i http://127.0.0.1:8080/
curl -i http://127.0.0.1:8080/stream/hls/cam1/index.m3u8
```

Observed: typecheck/build/tests pass (except DB-gated suites against 3306), ruff clean, pytest 28/28, but the live stack has 0 new segments, 0 activity windows, 0 completed recordings, 12+ dead reader-thread tracebacks, and repeated MediaMTX 500s.

---

## 11. What is genuinely working

- Express 5 boot + JSON 404 + `/healthz`; `/readyz` checks DB+Redis.
- Typed build across all three TS workspaces; 59 API unit tests, 13 web tests, 28 Python tests pass.
- RBAC on the mutating camera/config/ONVIF routes; global JSON error middleware; ONVIF XML escaping; query-token restriction; internal auth rate limit + constant-time compare.
- Class-toggle HTTP contract (client ? backend ? Redis/worker) is now coherent; the store reads `resolved_active_ids`.
- Recording consolidation is confined to `RAW` + `ended_at`, uses a transaction/`FOR UPDATE`, skips existing merges, and deletes superseded rows by id.
- Camera delete now captures children and cleans Redis/MediaMTX after the DB transaction.
- `_db_lock` covers the full activity-window read-modify-write; `bbox_json` is fixed in current code; `FrameQueue` is bounded.
- MediaMTX/Redis/MySQL are bound to localhost on the host; the RTSP proxy has no host port; nginx repeats security headers on both SPA locations.
- Router de-duplication, `settings ? configuration` redirect, locale JSON duplicate-key cleanup, and the class-toggle contract are genuinely fixed.

---

*End of report. No source files were modified during this audit; `FULL_AUDIT_2026-11-03.md` is the only new artifact.*

---

## 12. Cross-service contract findings (verified against both sides)

These are the mismatches that single-area passes miss. Some overlap with BE/AI items above; the IDs here are the contract-level statement.

### X-01 - High - Split-sensor child cameras are recorded and AI-processed as full duplicate streams
**Files:** `routes/cameras.ts:185-236`; `recorder/src/main.ts:78-85`; `ai-vision-worker/src/main.py:76-79,136-141`; `mediamtx/client.ts:26`.
Each split child is inserted with the parent's `rtsp_url`, gets its own `cam:{childId}` Redis key and MediaMTX path, and is selected by the recorder/AI startup queries (`enabled = 1`, no parent filter). The browser never uses child paths - it crops the parent stream with CSS. A 4-slice camera therefore opens 4 RTSP sessions to the same camera, writes 4 full-frame raw files, runs inference 4x, and inflates ingest stats 4x.
**Fix:** exclude `parent_camera_id IS NOT NULL` from recorder/AI registration and MediaMTX paths, or implement real server-side cropping. Keep children as a UI-only concept.

### X-02 - High - Disk-watermark protection is disabled by `Number(undefined) ?? default`
**File:** `transcode/watermark.ts:66-67`.
`Number(process.env.DISK_HIGH_WATERMARK_PCT)` is `NaN` when unset; `NaN ?? 85` stays `NaN`, so both comparisons are false and the level is always `normal`. Compose does not pass `DISK_*` to the transcode worker. The UI watermarks are never read. `getDiskUsage` also fabricates 50% on `statfs` failure.
**Fix:** `Number.isFinite(v) ? v : 85`, pass the env, read `system_config.storage`, and fail closed on statfs errors.

### X-03 - High - The state machine is bypassed by six writers; a late failure can turn `COMPLETED` into `FAILED`
**Files:** `transitions.ts:14-25`; `recorder.ts:126,143`; `reconciler.ts:40,65,77`; `pipeline.ts:703`; `worker.ts:65-84`; `stats.ts:548`.
`RECORDING -> SKIPPED` is not a legal edge but the recorder writes it; `pipeline` resets any state to `RAW`; the worker's failed handler first tries `transitionRecordingStatus(..., "FAILED")`, and on rejection falls back to a raw `UPDATE recordings SET status='FAILED'` - which can overwrite a `COMPLETED` row. `attempts` is incremented before the transition and again in the fallback.
**Fix:** add the legal `RECORDING -> SKIPPED` edge, route every writer through one helper, forbid terminal-state writes, and move `attempts` into transition metadata.

### X-04 - High - `enabled` is not propagated to the recorder/AI worker
**Files:** `routes/cameras.ts:509-519,576-586,466-471`; `recorder/src/main.ts:101-104`; `ai-vision-worker/src/main.py:76-79`.
PUT only publishes `camera:changed` when `rtsp_url` changes; PATCH publishes `updated` without an `enabled` field. Both services treat every `updated` as "register/start". Disabling a camera therefore leaves it recording and analyzing; disabling a stopped camera can start it.
**Fix:** include `enabled` in the event, unregister when false, register when true, and publish on every enabled change.

### X-05 - High - Consolidation moves activity windows without rebasing offsets
**File:** `transcode/consolidator.ts:353-355`.
When an hour is merged, windows from all segments are reassigned to the primary recording but keep their per-segment `start_offset_sec`/`window_index`. The primary keeps the first segment's `started_at`, so the merged file's windows pile up at the start; coverage collapses and smart probing falls back to `blind_fallback`. Events from deleted source segments are `ON DELETE SET NULL`.
**Fix:** rebase each offset by `source.started_at - primary.started_at`, assign sequential `window_index`/`segment_index`, and update `ai_detection_events.recording_id` before deleting source rows.

### X-06 - Medium - PATCH camera updates only the DB, not Redis or MediaMTX
**File:** `routes/cameras.ts:363-474` vs `:500-585`.
PATCH accepts `rtsp_url`/`confidence_threshold`/`enabled` but does not write `cam:{id}:rtsp_url`/`conf` or call `syncCameraToMediaMTX`; PUT does. The proxy keeps the old URL, MediaMTX the old source, and the AI reconcile overwrites the new confidence from stale Redis.
**Fix:** route both verbs through one side-effect block, or remove PATCH.

### X-07 - Medium - Camera delete leaves raw/compressed files behind; the reconciler cannot re-own them
**Files:** `routes/cameras.ts:626-681`; `recorder/src/reconciler.ts:103-128`.
The route deletes rows/keys/paths but not `data/raw/cam{id}` or `data/compressed/cam{id}`. The reverse reconciler tries to insert rows for orphan files with the deleted `camera_id`, which fails the FK and is swallowed.
**Fix:** remove/quarantine both directories after commit, or tombstone the camera; skip camera IDs with no row in the reconciler.

### X-08 - Medium - AI writes 5 s windows, the transcode worker assumes 20 s
**Files:** `docker-compose.yml:222`; `pipeline.ts:223-224,338`; `window-selection.ts:47,68`.
AI gets `PROBE_SAMPLE_SEC=5`; the transcode worker gets no `PROBE_SAMPLE_SEC`/`PROBE_INTERVAL_SEC` and defaults to 20. `selectProbeWindow` computes `expectedRows = chunkDuration / windowDurationSec` with 20 s, while AI wrote 5 s windows; coverage clamps to 1.0 with only ~25% actual coverage, so `blind_fallback` never triggers.
**Fix:** pass the same window duration to both services and assert agreement at startup.

### X-09 - Medium - Raw-deletion flags are disconnected; `RAW_RETENTION_SEC` is dead
**Files:** `pipeline.ts:219-220`; `worker.ts:150-178`; `.env.example:62`; compose.
`DELETE_RAW_AFTER_VERIFY`/`RAW_DELETE_GRACE_SEC` are read by the pipeline but not passed to the worker; the worker unconditionally deletes COMPLETED raw after 24 h from `storage.rawDeleteGraceSec` (never written by the UI). `RAW_RETENTION_SEC` is read by nothing.
**Fix:** one retention policy in the worker, gate on the flag, read the configured grace, and delete the dead env.

### X-10 - Medium - IP rate limiters collapse behind nginx; login lockout is global
**Files:** `auth/middleware.ts:68-72`; `app.ts` (no `trust proxy`); `nginx.conf:34-39`; `auth/routes.ts:25-27`.
nginx does not forward `X-Forwarded-For` on `/api/`, and Express does not trust a proxy, so every browser shares the nginx container IP. Five failed logins lock out all users; the internal MediaMTX auth limiter (120/min) is one bucket for all viewers.
**Fix:** `app.set("trust proxy", 1)`, forward `X-Real-IP`/`X-Forwarded-For`, key login by username+IP, and key the media auth by path/session.

### X-11 - Medium - Mutating `trigger-probe` and audit logs are not admin-gated
**Files:** `stats.ts:10,527`; `config.ts:363-366`.
Any viewer can enqueue VMAF/transcode work and change recording status; any viewer can read the audit log.
**Fix:** `requireRole("admin")` on both.

### X-12 - Medium - Status is committed to `QUEUED` before the job exists
**Files:** `worker.ts:206-227`; `recordings.ts:440-460`; `watermark.ts:90-92`.
If `queue.add` fails, the row stays `QUEUED`, the scheduler only scans `RAW`, and nothing retries it.
**Fix:** enqueue with an idempotent jobId first, then transition; on failure transition back; add a reconciler for orphaned `QUEUED` rows.

### X-13 - Low - Remaining field/consumer mismatches
- `GET /api/recordings/:id` returns `raw_path`/`compressed_path` while the list masks them (`recordings.ts:142` vs `:100`).
- `/auth/me` returns `{ userId }` while login returns `{ id }`; after reload `authStore.user.id` is undefined (`auth/routes.ts:76,145`; frontend `User` type).
- The recorder publishes `recording:status`, but neither the gateway nor the socket store subscribes (`recorder.ts:95,168`; `gateway.ts:161`).
- `pipeline.ts:703` resets status to `RAW` but leaves `compressed_path` pointing at the deleted `.partial`.
- The consolidation lock is fail-open (`consolidator.ts:195-205`): a Redis error proceeds to merge without a lock.
- README credentials/ports and config `whepPort: 8555` are stale.

---

## 13. Supplementary verified findings (backend + recorder/proxy passes)

These were found in the independent area passes after the main sections were written. They are real and current; several are severe enough to change the P0/P1 order.

### Backend

- **BE-S1 (Critical/High) - MediaMTX auth hook ignores `action`; viewers can publish/hijack streams.** `routes/internal.ts:39-95` destructures `action` and `path` but never checks either. Any viewer JWT, or any database username/password (the hook also accepts Basic DB credentials), authorizes MediaMTX `publish` on arbitrary paths. A viewer can spoof/overwrite a camera feed. **Fix:** allow `publish` only for the internal service secret/admin; validate `action` and path; reject unknown actions.
- **BE-S2 (High) - Deferred raw deletion ignores the quality gate and compressed-file existence.** `transcode/worker.ts:142-184` selects `status='COMPLETED'` rows by `verified_at` age only; it never checks `quality_gate_met`, `compressed_path`, or `DELETE_RAW_AFTER_VERIFY`. A recording whose gate failed (raw intentionally kept) can have its only copy deleted later. **Fix:** delete only when `quality_gate_met=1`, `compressed_path` exists and is readable, the flag is true, and the grace elapsed.
- **BE-S3 (High) - Split-count changes and camera deletion cascade-delete recordings, leaving media files.** `routes/cameras.ts:159-171,241-253,626-682` + `recordings.camera_id ON DELETE CASCADE`. Reducing `split_count` from 4 to 1 deletes every recording/detection/probe for the removed slices; no media file is unlinked. **Fix:** soft-delete slices, or archive/verify before deleting; unlink media only after commit.
- **BE-S4 (High) - Refresh tokens are accepted as access tokens.** `auth/service.ts:64-105`: the refresh token has the same `userId/username/role` claims plus `jti`; `verifyAccessToken` never checks token type. A stolen 7-day refresh token works as a Bearer token on REST, sockets, and MediaMTX. **Fix:** add `typ: "access"|"refresh"` (or separate keys/audiences) and validate.
- **BE-S5 (High) - CPU VMAF fallback is rejected by the frame-count check.** `vmaf/runner.ts:150-158,209-212` uses `n_subsample=2` but compares `framesScored` to the full `referenceFrames` (�5). CPU fallback scores roughly half the frames, so it is discarded as a mismatch; this is a likely contributor to the live VMAF failures. The unit test mocks a full 500-frame log, so it never catches it. **Fix:** compare to `ceil(referenceFrames / nSubsample)` or skip the check on the CPU path; skip when `referenceFrames <= 0`.
- **BE-S6 (High) - Pipeline can revert `COMPLETED` to `RAW`.** `pipeline.ts:286-292,693-705` has no terminal-state guard; a retry/duplicate job reads `COMPLETED`, fails the `COMPLETED -> QUEUED` transition, catches, and raw-UPDATEs `RAW`. The failed handler then forces `FAILED`. **Fix:** no-op for `COMPLETED`/`SKIPPED`; never raw-reset; restrict the catch to pre-terminal states.
- **BE-S7 (High) - Verification does not re-check the final file.** `pipeline.ts:571-623` checks duration and a decode, but not final-file VMAF or encoded-vs-raw frame count (�2 � chunks). `vmaf_mean`/`p25` are probe values, not final verification. **Fix:** implement the spec�s final sample VMAF + frame-count check; re-encode or keep raw on failure.
- **BE-S8 (High) - Consolidator deletes originals without content verification.** `consolidator.ts:285-305,375-389` accepts `exitCode=0` + size > 1 KB; `probeDurationSec` returns 0 on ffprobe failure and is not checked; then the original segments are unlinked. A corrupt/truncated merge can destroy the only copies. **Fix:** require duration within tolerance of the sum, a full decode test, and `duration > 0`; otherwise abort and keep originals.
- **BE-S9 (Medium) - Rate limiting is effectively global; Redis can hang instead of fail-open.** `auth/middleware.ts:66-72` keys on `req.ip` with no `trust proxy`; nginx does not forward `X-Forwarded-For` on `/api/`. Five failed logins lock out everyone. `redis/client.ts` uses `maxRetriesPerRequest: null`, so the �fail open� catch never fires during a Redis outage. **Fix:** trust proxy + real IP, key login by username+IP, finite Redis timeouts for non-BullMQ clients.
- **BE-S10 (Medium) - Password change does not require the current password or revoke sessions.** `auth/routes.ts:95-98,148-176`. A stolen access/refresh token can change the password; old refresh JTIs remain valid. **Fix:** require current password/re-auth; revoke the user�s JTI set; rotate the session.
- **BE-S11 (Medium) - Refresh token is returned in JSON despite the httpOnly cookie.** `auth/routes.ts:64-75,100-123`; frontend stores both in Pinia/localStorage. The httpOnly hardening is nullified. **Fix:** stop returning the refresh token; rely on the cookie.
- **BE-S12 (Medium) - Camera credentials are stored/broadcast in plaintext.** `cameras.ts:317-337,465-472,578-585` writes `cam:{id}:rtsp_url` and publishes `rtsp_url` on `camera:changed`; `/api/onvif/verify` returns a credential-bearing `primaryStreamUri`. **Fix:** keep only the encrypted blob; hand the proxy a short-lived token; mask/omit URLs from responses and pub/sub.
- **BE-S13 (Medium) - ONVIF discovery is viewer-accessible and unbounded.** `routes/onvif.ts:46-80` has no `requireRole`, opens UDP sockets per interface for 2.5 s, and writes a host trigger file. **Fix:** admin-only, rate-limit, coalesce scans.
- **BE-S14 (Medium) - Split-camera filters are wrong.** `recordings.ts:64-75` (and `events.ts:23-30`) includes only the requested child + parent, never all siblings; selecting the parent omits all children. **Fix:** resolve the full family and use `camera_id IN (...)`.
- **BE-S15 (Medium) - Activity-window endpoint fabricates buckets and has unbounded work.** `recordings.ts:178-189,203-257` invents offsets (`idx*5`), a constant `frames_processed: 20`, and filters events by camera/time rather than `recording_id`; a 24 h recording creates 17,280 buckets. **Fix:** return real rows, scope by recording, use the real window size, and paginate/aggregate in SQL.
- **BE-S16 (Medium) - Requeue leaks a BullMQ Queue per request.** `recordings.ts:443-456` constructs a Queue and never closes it. **Fix:** shared singleton or `try/finally await queue.close()`.
- **BE-S17 (Medium) - Video stream has no error/abort handler.** `recordings.ts:345-356` pipes a ReadStream with no `error` handler and no `res.on("close")` destroy; a file race can crash the API, and aborted playback keeps reading. **Fix:** `stream.pipeline` or explicit error/close handling.
- **BE-S18 (Medium) - Transcode worker has no `error` listener.** `worker.ts:43-87` attaches only `failed`; a BullMQ/Redis `error` event can terminate the process. **Fix:** `worker.on("error")` + `queue.on("error")`.
- **BE-S19 (Medium) - Docker build depends on gitignored `dist`.** `apps/api-server/Dockerfile:16-19` + `.gitignore` `dist/`; compose bind-mounts `dist`. A clean checkout cannot build; a source change without a rebuild runs stale code. **Fix:** build inside the image, drop the prod bind-mount.
- **BE-S20 (Medium) - Tests encode wrong expectations.** `gateway.test.ts` seeds a `viewer` but expects `ai:toggle_class` to succeed (the handler rejects non-admins); `watermark.test.ts` seeds RAW rows without `ended_at` while the query requires it. These tests either fail or hide regressions. **Fix:** use an admin + a viewer/403 case; seed `ended_at`; add merge/scheduler/ONVIF/config tests.
- **BE-S21 (Low) - `rtsp_url` validation rejects `rtsps://`, and masking/host extraction are regex-fragile.** `cameras.ts:28,45`; `crypto/credentials.ts:77-97`. Secure cameras cannot be added; an unescaped `@` can leak part of the password into `rtsp_host`. **Fix:** `new URL()` with `rtsps?`, parser-based userinfo.

### Recorder / RTSP proxy

- **R-S1 (High) - Spawn `error` never schedules a restart and makes `stop()` hang.** `supervisor.ts:215-232,100-108`: `ENOENT` emits `error`/`close`, not `exit`; `childProcess` stays set, so `stop()` waits forever and the camera never retries. **Fix:** route spawn error into the failure/backoff path, clear `childProcess`, and bound `stop()`.
- **R-S2 (High) - A finalize rejection skips the restart.** `supervisor.ts:241-285`: if `onFinalizeSegment` rejects (e.g. DB down), the `catch` logs and the restart at the end of the `try` never runs. **Fix:** schedule the restart in `finally`.
- **R-S3 (High) - Fire-and-forget Redis publishes can crash the recorder.** `recorder.ts:94-99,167-172`, `supervisor.ts:260-271`, `reconciler.ts:86-97` call `publish()` without `await`/`.catch`; Node 22�s default unhandled-rejection behavior terminates the process � exactly during outages. **Fix:** `void publish(...).catch(log)` + `.on("error")` on clients.
- **R-S4 (High) - `registerCamera` is not serialized; two ffmpeg processes can record one camera.** `recorder.ts:47-74` awaits `stop()` before deleting the map entry and sets the new entry only after `start()`; concurrent `camera:changed` messages interleave. **Fix:** per-camera promise chain/mutex, delete before await, restart only on URL/enable changes.
- **R-S5 (High) - Same-second filenames + ffmpeg�s silent overwrite + `raw_path UNIQUE` = silent footage loss.** `supervisor.ts:194,209`; FFmpeg 8.1.1 truncates an existing target with exit 0. A clock step, restart, or duplicate ffmpeg destroys the old file; the new INSERT fails UNIQUE, and finalize can overwrite the old row�s metadata. **Fix:** per-boot/pid filename suffix and `ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)`.
- **R-S6 (High) - ffmpeg inherits the full recorder environment and the MediaMTX secret is in argv.** `supervisor.ts:215-218` passes `{...process.env}`; `main.ts:69-75` builds `rtsp://internal_reader:<secret>@...`. ffmpeg parses hostile camera input; any leak yields DB/Redis/credential-key secrets. **Fix:** minimal env; short-lived internal token.
- **R-S7 (High) - Consolidation nulls detection events.** `consolidator.ts:353-365` remaps activity windows and VMAF logs but not `ai_detection_events`; `ON DELETE SET NULL` wipes their recording link when source rows are deleted. **Fix:** update events in the same transaction.
- **R-S8 (Medium) - Any ffprobe failure becomes `SKIPPED, duration=0`.** `recorder.ts:119-131`, `probe.ts:28` (15 s timeout). A transient timeout permanently disqualifies valid footage. **Fix:** classify transient vs corrupt; retry; only SKIP unreadable/empty.
- **R-S9 (Medium) - `format.duration="N/A"` hides a valid stream duration.** `probe.ts:39-40` uses `parseFloat(format.duration || stream.duration)`; `"N/A"` is truthy ? 0. **Fix:** take the first finite candidate.
- **R-S10 (Medium) - Startup reconciliation blocks recording.** `recorder.ts:22-28` runs before camera registration, serially probing every row/orphan with a 15 s timeout. **Fix:** register first, reconcile in the background with bounded concurrency.
- **R-S11 (Medium) - Shutdown finalizes serially; Docker�s 10 s stop timeout SIGKILLs mid-probe.** `supervisor.ts:79-114`, `recorder.ts:30-37`, compose has no `stop_grace_period`. **Fix:** bounded parallel finalize, per-camera timeout, `stop_grace_period: 30s`.
- **R-S12 (Medium) - Finalize can run before the new segment�s INSERT is visible.** `supervisor.ts:128-161` advances `currentSegmentPath` before awaiting finalize; the new row stays `RECORDING` for the hour. **Fix:** serialize per-camera events; guard UPDATE with `status='RECORDING'`.
- **R-S13 (Medium) - No timezone normalization in the MySQL pool.** `main.ts:15-23`; mysql2 defaults to local time while filenames are UTC. **Fix:** `timezone: "Z"`, `TZ=UTC`.
- **R-S14 (Medium) - MediaMTX auth is limited to 120/min per source IP.** `internal.ts:28-32`; all MediaMTX auth calls come from one container IP. LL-HLS makes ~5 req/s; two viewers exhaust the bucket and get 429. **Fix:** exempt the MediaMTX source or key by action/path.
- **R-S15 (Low/Medium) - `-timeout 5000000` is 5 seconds, not 5,000 seconds.** `supervisor.ts:200`; a legitimate >5 s camera pause tears down the stream. There is also no segment-mtime watchdog. **Fix:** 10�15 s + stale-file watchdog.
- **R-S16 (Low) - HEVC segments are tagged `hev1` and won�t play in Chromium.** `supervisor.ts:202-211` copies without `-tag:v hvc1`. **Fix:** tag `hvc1` or document the limitation.
- **R-S17 (Low) - `stop()`�s delayed SIGKILL can hit a recycled PID.** `supervisor.ts:103-107`; clear the timer on exit and `unref()`.
- **R-S18 (Low) - Recorder healthcheck only proves Redis TCP.** `docker-compose.yml:140-145`. **Fix:** last-segment mtime/DB ping heartbeat.

---

## 14. Supplementary infrastructure, scripts and test findings

- **X-I1 (High) - The transcode integration suite can never run.** `pipeline.integration.test.ts:9` is `describe.skipIf(!process.env.RUN_INTEGRATION_TESTS)`; nothing sets that variable, and the test copies `tests/1minuteroad.mp4`, which is gitignored/untracked. `docs/PROGRESS.md` still claims G4.4-G4.11 PASS. **Fix:** add a real `test:integration` script/fixture and run it in CI, or stop claiming the gates.
- **X-I2 (High) - The recorder "integration" test defaults to a live Hikvision camera.** `recorder.integration.test.ts:53,113` uses `rtsp://admin:***@192.168.1.100:554/...` with no lavfi fallback and copies an untracked video. `pnpm test` fails/hangs on a clean clone. **Fix:** generate synthetic RTSP with lavfi and gate the live-camera test behind an explicit env.
- **X-I3 (High) - Playwright mocks every backend and stream.** `e2e/vms.spec.ts:8-183` fulfills login, cameras, stats, recordings, config, events, WHEP, and `*.m3u8`. The "live dashboard" gates never touch the real API/MediaMTX/DB. **Fix:** keep mocked tests for components, add a separate real-stack E2E target.
- **X-I4 (High) - Clean-clone/security/soak scripts overstate their checks.** `clean-clone-test.sh` never clones/builds and prints PASS unconditionally; `security-audit.mjs` "Item 8" only checks `container_name` strings, so MediaMTX/rtsp-proxy with no healthcheck pass; `soak-test.mjs` runs 25 seconds and calls it a leak test. **Fix:** real clone/build/up/health assertions, YAML/healthcheck inspection, and a multi-hour soak.
- **X-I5 (High) - No CI at all; all TS lint scripts are `echo`.** No `.github/`; `pnpm verify` has no real lint, no image build, no compose validation, no secret scan. **Fix:** add a pipeline with install/build/typecheck/unit/Compose build and secret scanning; add ESLint configs.
- **X-I6 (Medium) - Dev compose appends ports instead of overriding.** `docker-compose.dev.yml` adds `3306:3306`/`6379:6379` on top of the base `3307`/`6380`; starting both profiles yields duplicate bindings and "port already allocated". **Fix:** use `!override` or define host ports in one place; align `.env`/tests.
- **X-I7 (Medium) - Windows/WSL scripts report success on failure and stop all of WSL.** `start-vms.bat` never checks the compose exit code, does not run install/build, and always prints "[BERHASIL]"; `stop-vms.bat` runs `wsl --shutdown` (kills unrelated work); `verify.ps1` ignores `$LASTEXITCODE`. **Fix:** check exit codes, build when `dist` is missing, use `docker compose down`/targeted `wsl --terminate`.
- **X-I8 (Medium) - Runbook backup/restore is unsafe.** `docs/RUNBOOK.md:34-57` writes to `/data/backups` (not a mounted volume), hardcodes the DB password in the command line, and restores while the API is still writing. **Fix:** use `./backups`/a named volume, `MYSQL_PWD`/`--defaults-extra-file`, stop the API during restore, and verify row counts.
- **X-I9 (Medium) - `scripts/e2e-full.sh` can delete the live DB volumes.** It runs `docker compose ... down -v --remove-orphans` with the normal project name before building, and does not run `pnpm build` first. **Fix:** dedicated `-p quantis-e2e` project/volumes, build first, require confirmation for `down -v`.
- **X-I10 (Medium) - Missing `LICENSE` despite AGPL-3.0 claims.** README badges/links `LICENSE`, but no license file is tracked. **Fix:** add AGPL-3.0 and third-party notices (Ultralytics/FFmpeg/NVIDIA).
- **X-I11 (Medium) - Secure cookies over plain HTTP; `WEB_ORIGIN` still 5173.** `auth/routes.ts:64-69` sets `secure` when `NODE_ENV=production`, but the stack is served over HTTP; LAN browsers can reject the refresh cookie. CORS defaults to 5173 while the deployed dashboard is 8080. **Fix:** terminate TLS or set `COOKIE_SECURE=false` explicitly; pass `WEB_ORIGIN=8080` (or the real origin) in compose.
- **X-I12 (Low) - `make verify` duplicates pytest/ruff and `verify-gpu` is a no-op.** The Makefile re-runs what root `pnpm verify` already does; `verify-gpu` just echoes. **Fix:** remove duplicates and implement a real encode + `libvmaf_cuda` smoke test.
- **X-I13 (Low) - Dead scripts/artifacts.** `host-ram-publisher.mjs` is not started by compose (so `/data/host_ram.json` is empty/stale), `update-compose-ports.cjs`/`verify-port8080.cjs` are obsolete, and the `.cjs` e2e scripts target removed selectors/5173. **Fix:** delete or wire them; document the optional host-RAM publisher.
- **X-I14 (Info) - `.env` is correctly gitignored; `.env.example` is tracked and contains the public defaults.** The dangerous part is that `.env.example`, the compose fallbacks, and the local `.env` all carry the same known values. Generate secrets instead of copying the example.
