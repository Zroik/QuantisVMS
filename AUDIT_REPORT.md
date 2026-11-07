# Quantis VMS — Full Project Audit Report

**Date:** 2026-11-03 · **Scope:** entire monorepo (`apps/api-server`, `apps/web-dashboard`, `services/media-engine` (recorder + rtsp-proxy + mediamtx.yml), `services/ai-vision-worker`, docker-compose, Dockerfiles, `.env*`, docs, scripts, tests)
**Method:** deep read of every source file in all four service areas (4 parallel deep-dive passes), cross-contract verification (frontend ↔ backend, worker ↔ API, recorder ↔ schema), independent spot-verification of every headline finding. All findings below were checked against actual code — no speculative items. **No files were modified.** (Report file itself is new and can be deleted.)

---

## 0. Executive summary — the ten worst problems

| # | Area | Problem | Impact |
|---|------|---------|--------|
| 1 | Frontend↔Backend | Dashboard sends `active_classes`; backend expects `preset_groups`/`custom_class_ids` and **silently writes `active_yolo_classes = []`** — every class toggle in the UI disables YOLO detection on that camera | Silent AI feature loss, forensic timeline empties |
| 2 | Auth/Secrets | Every secret has a committed hardcoded fallback, including `CREDENTIAL_KEY` whose default **decodes to 32 zero bytes** (AES key = publicly known), `JWT_SECRET`, MySQL/Redis passwords, MediaMTX secret, plus a seeded `admin/admin123` | Auth bypass / plaintext-equivalent credential storage |
| 3 | RBAC | `requireRole("admin")` is used **once** in the whole backend; a `viewer` can delete cameras (cascade-deletes all recordings), factory-reset config, PTZ-move/reboot cameras | Full data-destruction from least-privileged account |
| 4 | Transcode | Raw file "grace-period" deletion can never fire (`verifiedAt` compared against a timestamp set 30 lines earlier) → **raw storage grows unbounded**; `raw_deleted_at` can never be recorded (illegal `COMPLETED→COMPLETED` transition, swallowed) | Disk exhaustion; DB/disk truth divergence |
| 5 | Consolidator | Consolidator merges statuses belonging to in-flight/finished transcodes, `unlink`s raw files the transcoder may be reading, resets `status='RAW'`/`compressed_path=NULL` on `COMPLETED` rows | Destroys compression results; illegal-transition loops; orphan multi-GB files |
| 6 | Recorder | ffmpeg `stderr` piped but never drained + missing `spawn` `error` handler + unhandled rejections in `fs.watch`/exit paths → a chatty camera or a DB hiccup **deadlocks/kills recording for all cameras** | Recording availability |
| 7 | RTSP proxy | Port 8555 published on the host with **no authentication**, and it fetches full plaintext camera credentials from Redis and injects them into any client's session; plaintext RTSP URL incl. password also persisted in Redis by the API | Anonymous camera access; defeats at-rest encryption |
| 8 | AI worker | All Redis-dependent threads catch the *builtin* `ConnectionError` instead of `redis.RedisError` (never caught) + shared single `pymysql` connection across camera threads + `bbox_json` always `'[]'` | Any Redis/DB hiccup silently kills detection threads; forensic bbox data permanently lost |
| 9 | Docker | `services/media-engine/Dockerfile.ffmpeg:81` COPYs `scripts/check-ffmpeg.sh` that **does not exist in its build context** (the script lives at repo-root `scripts/`) → image cannot be built from a clean checkout; runtime image missing `libnuma1` | Build breakage; CPU-HEVC fallback crashes at runtime |
| 10 | Contracts | Dashboard calls `POST /api/auth/update-password` which **does not exist**; both failure branches show *success* toasts | Admin password change feature is fake |

Full details per area below, each with file:line and a concrete suggested fix.

---

## 1. Backend — `apps/api-server` (Express 5 + socket.io + MySQL/BullMQ)

> Note: README/docs imply Fastify + DI; the actual stack is **Express + module singletons**. `"lint": "echo ..."` is a **no-op**, so `pnpm verify` runs typecheck+tests only — no linting exists in the backend at all.

### CRITICAL

- **B-C1. Default JWT secret.** `src/auth/service.ts:18` — `process.env.JWT_SECRET || "super-secret-jwt-key-replace-in-production-min-32-chars"`. Same pattern: Redis `redis_password_secret` (`redis/client.ts:17,33` — also applies a password even to passwordless Redis, which itself breaks connections), MySQL defaults (db/connection.ts:16-17), MediaMTX `mediamtx_internal_token_secret` (internal.ts:7, cameras.ts:27, onvif.ts:46, stats.ts:167, index.ts:70). **Fix:** fail-start (`process.exit(1)`) when any secret env is missing in production; never ship defaults.

- **B-C2. All-zero credential-encryption key.** `src/crypto/credentials.ts:14` — default base64 `"AAAA…="` = 32 zero bytes, used as the AES-256-GCM key for every camera RTSP URL and ONVIF password. Also `deriveCredentialKey` silently SHA-256-derives a key when the provided one isn't exactly 32 bytes (:16-21) — makes key mismatch invisible ("auth tag failed" mysteries). **Fix:** refuse to start without an explicit 32-byte `CREDENTIAL_KEY`; loud error instead of derivation; see §8 for a versioned-envelope refactor.

- **B-C3. Seeded `admin/admin123`.** `src/index.ts:50-58` — `INITIAL_ADMIN_PASSWORD || "admin123"`, no warning, no forced-change flag. **Fix:** generate a random password and print once, or refuse to seed.

- **B-C4. RBAC is effectively absent.** `requireRole()` exists (`auth/middleware.ts:33-47`) but is used exactly once (`routes/recordings.ts:390`) and has **zero tests**. Result: any `viewer` can (a) `PUT /api/config` with `{}` → `DELETE FROM system_config` (config.ts:272-310), (b) `DELETE /api/cameras/:id` → FK cascade destroys all recordings/chunks/windows/probe logs (cameras.ts:674-704), (c) POST/PTZ/reboot cameras (onvif.ts:344,404,449), (d) edit/recreate cameras and streams. **Fix:** wrap every mutating camera/config/onvif route in `requireRole("admin")`.

- **B-C5. Consolidator races the transcoder and destroys work.** `transcode/consolidator.ts:171-182,217-227` — merge candidates are `status NOT IN ('RECORDING','FAILED')`, so it merges/unlinks raw files that BullMQ jobs are actively reading, and hard-sets `status='RAW'`, `compressed_path=NULL` on `COMPLETED` rows (:296-309) — wiping the compression result while the compressed file becomes an orphan and pipeline transitions then throw `IllegalStatusTransitionError`. **Fix:** merge only `WHERE status='RAW' AND ended_at IS NOT NULL` inside a transaction with `FOR UPDATE` re-check; never touch `COMPLETED` rows.

### HIGH

- **B-H1. `POST /api/recordings/:id/requeue` dead-ends.** `recordings.ts:405-411` sets `status='QUEUED'` but nothing enqueues a job (scheduler only picks `RAW`). The row stays `QUEUED` forever; it also bypasses the state machine. **Fix:** use `transitionRecordingStatus` + enqueue with `jobId: rec-${id}` (dedupe-safe).
- **B-H2. Brute-force limiter keyed on spoofable `x-forwarded-for`.** `auth/middleware.ts:59-63` — rotate the header, bypass the 5/60s login limit. Fix: trust `req.ip` only unless a trusted proxy is explicitly configured.
- **B-H3. Access tokens accepted from query strings on every route.** `middleware.ts:15-17` — `?token=`/`?jwt=` on every GET leaks tokens into logs/history/Referer system-wide. Fix: restrict query tokens to the one media route; use short-lived path-scoped signed media tickets.
- **B-H4. `/internal/mediamtx/auth` credential oracle.** `internal.ts:14-75` — no rate limit, non-constant-time secret compare, default-secret fallback; also dead re-check at :47-53. Fix: rate-limit + `timingSafeEqual` + mandatory secret env.
- **B-H5. Disk-watermark age filter contradicts spec.** `transcode/watermark.ts:82-89` comment says "enqueue RAW regardless of age", but `shouldApplyDelay` is always true because scheduler always passes `delaySeconds` (worker.ts:115-117) — at critical watermark the freshest (usually most important) recordings are *excluded*. Fix: pass `delaySeconds: 0` at watermark or branch explicitly.
- **B-H6. `preferred_encoder` schema mismatch → 500s.** Zod accepts `libx265`/`libsvtav1` (cameras.ts:83,100,118; config.ts:189; onvif.ts) but the enum is `ENUM('av1_nvenc','hevc_nvenc')` (`001_initial_schema.up.sql:22`) → ER_TRUNCATED_DATA → unhandled 500. Fix: migration 005 to widen the enum; keep zod/DB in sync.
- **B-H7. Camera delete unguarded.** Parent-camera delete cascades all children + their recordings; Redis keys (`cam:{child}:rtsp_url` — plaintext) and MediaMTX paths are left behind (cameras.ts:674-704 only cleans parent keys). Fix: collect children first, clean keys/paths, then delete; block deletion while dependents exist or soft-delete.

### MEDIUM

- **B-M1.** `recordings.attempts` never incremented (`worker.ts:61-70`) → retry limiting dead; `worker.ts:702` resets any failure to `RAW` via raw UPDATE, bypassing the state machine.
- **B-M2.** State-machine bypasses: direct status UPDATEs in `recordings.ts:410`, `stats.ts:548`, `worker.ts:65`, `consolidator.ts:302`. Fix: route all writes through `transitionRecordingStatus` (single audit choke point).
- **B-M3.** Consolidator merge is not crash-atomic (rename→probe→UPDATE→unlink across separate steps, `consolidator.ts:280-340`); crash leaves DB↔disk drift. Fix: one transaction + startup reconciliation of unreferenced files.
- **B-M4.** Temp-file cleanup deletes **any** current file matching `.tmp_` / `_merged.mp4.tmp` under `raw/cam*` with no mtime or DB-reference check (`consolidator.ts:122-129`). Fix: require age + verify the path isn't a live `raw_path`.
- **B-M5.** Path-safety truth is split across 4 modules with different cwd-relative/absolute defaults (`recordings.ts:13-32` vs `worker.ts:26`, `pipeline.ts:221-222`) → 403/404 for valid paths under some env combos; `fs.realpath` not used (symlinks pass). Also monkey-patches invented offsets in `recordings.ts:151-165` instead of fixing the writer.
- **B-M6. N+1 / unbounded queries:** `transcode/priority.ts:56-89` (one query + one changePriority per job per 15s tick); scheduler `SELECT` without LIMIT (`worker.ts:130-140`); consolidator scans all past recordings every 15s; `recordings.ts:75,87` `SELECT *` leaks `raw_path` filesystem paths to API clients; `events.ts` deep-OFFSET filesort without composite index; `stats.ts:16-47` `getDirSize` walks potentially TB of tree per 15s window.
- **B-M7.** Rate limiter INCR/EXPIRE is non-atomic — a crash between the two bricks an IP at 429 with no TTL (`middleware.ts:66-71`). Fix: `SET ... EX nx` + INCR or Lua.
- **B-M8.** Refresh rotation: `redis.del` not atomic with `set` (crash = logout); `rotateRefreshToken` never re-reads user role → demoted admin keeps tokens (service.ts:91-121); revocation scan uses `redis.keys()` (blocker) instead of a per-user JTI set.
- **B-M9.** "Forensic" audit trail is in-memory, lost on restart, and **seeded with 5 fabricated historical entries** (config.ts:87-145, IDs 97–101); frontend adds more fabricated rows on fetch failure (see F-M2). Fix: DB-backed audit table, no seeds.
- **B-M10.** `POST /api/config/sync-ntp` does **only a DNS lookup** and reports "NTP tersinkronisasi" (config.ts:410-431) — no NTP at all. Clock-offset ops misinformation. Fix: real SNTP query (node `dgram`) or rename to "DNS check".
- **B-M11. SSRF:** `test-camera-ping` (`config.ts:434-483`) and `sync-ntp` accept arbitrary host/port (internal port-scan possible); `onvif.ts:127-166` POSTs SOAP to user-specified xaddr. Fix: CIDR allowlist + admin-only.
- **B-M12. Fabricated telemetry in `stats.ts`:** hardcoded GPU name "RTX 4060 Laptop", fake util/VRAM/temp fallbacks, `cpuThreads = max(16, actual)`, camera resolutions by ID (`cam.id===1?"1920x1080":"2304x2592"`), invented `cam1/cam2` on DB failure, `queue:{queued:0,...}` hardcoded zeros while `/vmaf-probes` computes the real thing (= duplicated feature, one broken), `getDiskUsage` fabricates 50% on statfs failure (`watermark.ts:38-46`) — the disk-safety gate consumes fiction. `mediamtx:9997` hardcoded while `MEDIAMTX_HOST/API_PORT` envs exist and are honored elsewhere. Fix: honest "unknown" states; use envs.
- **B-M13. Socket gateway gaps** (`sockets/gateway.ts`): no per-camera room authorization (any viewer joins any room); `ai:toggle_class` duplicates `PUT /cams/:id/classes` logic (divergent copies incl. skipping admin check and unvalidated confidence); `transcode:probe_step` broadcast to all instead of `system` room; **`system:alert` never subscribed** so watermarked disk/pipeline alerts never reach clients; no disconnect on token revocation. Fix: room authz, subscribe to `system:alert`, extract one shared toggle service.
- **B-M14.** No global error middleware → DB failures in auth/routes surface as Express-HTML 500s (some files try/catch JSON, others don't); malformed refresh cookie (`%`) makes `decodeURIComponent` throw → 500 (no `cookie-parser` dependency).
- **B-M15.** DB retry loop exits "up" into a broken state (`index.ts:26-39,110-112`): serves un-migrated schema while `/healthz` stays green and never checks DB. Fix: exit non-zero; make `/readyz` the only readiness source.
- **B-M16. Migrator fragility:** `--;`-splitting breaks on literal semicolons; DDL inside `beginTransaction` is false atomicity (implicit commits) → mid-migration failure leaves `schema_migrations` unmarked and reruns fail with "duplicate column". Fix: idempotent statements / checksums / documented single-statement DDL.
- **B-M17. ONVIF XML built by string concatenation** with camera-controlled values (client.ts:96,247,369) → a malicious camera can inject XML into subsequent server requests. Fix: XML-escape every interpolation.
- **B-M18. MediaMTX sync logic triplicated** (index.ts:62-109, cameras.ts:23-71, onvif.ts:42-75) incl. duplicated secret-default header; `fetch` without `AbortSignal.timeout` (a hung MediaMTX stalls boot/requests). Fix: one `mediamtxClient` module with timeouts.
- **B-M19.** Chunk-encode timeout hardcoded 120 s (`pipeline.ts:529`) vs default chunk of 600 s → all CPU-encoder paths (allowed by schema) time out permanently; concat/verify timeouts similar. Fix: scale with `chunkDurationSec`.
- **B-M20.** `selectProbeWindow` `expectedRows` computed from probe sample length while recorder actually writes 5-s buckets (`window-selection.ts:66` vs `recordings.ts:184`) → mismatch silently downgrades all chunks to `blind_fallback` (AI probing can never engage). Fix: derive expectedRows from the actual recorder bucket size; also the tie-break branch at window-selection.ts:97-103 is dead code.
- **B-M21.** VMAF frame-count validation is implemented (`vmaf/runner.ts:209-217`) but never called with `referenceFrames` in the real pipeline (pipeline.ts:403-408) — exists only in tests. Pass `refProbe.frames`.
- **B-M22.** Dead schema/paths: `vmaf_probe_logs.chunk_id` and `recording_chunks.compressed_path` never written; `manual-trigger` uses unique `jobId` bypassing `rec-${id}` dedupe → double enqueue of same recording → transition fight (stats.ts:550-561).
- **B-M23.** `getStreamUri` misses `rtsps://` scheme and `.includes("@")` desync (onvif/client.ts:270-273) → credentials silently missing.

### LOW (selected)
`spawn` import unused; duration fallback `|| 60` fabricates probe durations that later "verify" (pipeline.ts:306); raw-delete failure in empty catch (pipeline.ts:667); worker `SIGTERM` exits 0 mid-insert; `test_v380`-style fixture URLs with real-style credentials; `stats.ts` CPU fallback meaningless on Windows; masking regex `[^@]+` can leak userinfo; `discovery.ts:44-76` regex-parses untrusted UDP datagrams without size cap (regex-DoS surface); IPv6/`:`-containing usernames break mask regexes.

---

## 2. Frontend — `apps/web-dashboard` (Vue 3 + Tailwind + Pinia)

### CRITICAL

- **F-C1. Class toggles wipe detection (verified end-to-end).** `src/stores/cameras.ts:84-91` sends `{ active_classes: [...] }`; backend `routes/cameras.ts:720,741` reads `preset_groups`/`custom_class_ids`, and since both are optional they resolve to `[]` → DB + Redis get `[]` → AI worker detects nothing. Response uses `resolved_active_ids`, store reads `data.active_classes` (:98) and silently keeps optimistic local state, masking it. **Fix:** translate preset ids into the backend contract (`preset_groups` + `custom_class_ids`) and read `resolved_active_ids`; or extend the backend to accept `active_class_ids: number[]` and resolve server-side.
- **F-C2. Password change calls a nonexistent endpoint with fake success.** `views/ConfigurationView.vue:1768-1792` — `POST /api/auth/update-password` doesn't exist (auth/routes.ts has login/refresh/logout/me only). `res.ok?success-toast` / else *“Kata sandi diperbarui untuk sesi ini”* / catch *“Kata sandi berhasil diperbarui”* — users are told the change worked when it never did. **Fix:** add the endpoint (verify current password + rehash, admin/self) and make `!res.ok`/`catch` show real errors.
- **F-C3. `system:alert` bridge is dead.** Client subscribes (`stores/socket.ts:66-68`, only `console.warn`s), backend publishes (`pipeline.ts:653`, `watermark.ts:113`), but the gateway never subscribes to the channel (`gateway.ts:143` only `ai:detections`,`transcode:probe_step`). Disk-critical alerts can never reach the UI. Fix: gateway subscribe+emit; UI renders banner/toast instead of console.
- **F-C4. E2E mocks encode the broken contract.** `e2e/vms.spec.ts:59-71` echoes the frontend's own wrong `active_classes` shape; config mock is a flat object while views read nested tree → tests "pass" and permanently mask F-C1/M-shape bugs. Fix: mocks must mirror `apps/api-server/src/routes/*.ts` real payloads, or test against a seeded dev backend.

### HIGH

- **F-S1. Both JWTs in `localStorage`** (`stores/auth.ts:11-12,21-24`; router guard reads raw storage at `router/index.ts:73`) — the backend's httpOnly refresh cookie hardening is undone; any script exfiltrates tokens. Fix: access token in memory only, rely on httpOnly cookie for refresh (`credentials:"include"`).
- **F-S2. JWT in media URLs** (`VideoPlayer.vue:160-161,277-278`; `TimelineView.vue:597-599`) — full tokens land in nginx logs/history/Referer. Fix: short-lived path-scoped stream tickets; `Referrer-Policy: no-referrer`.
- **F-S3. `v-html` sinks** in HardwareMonitorView (:13,121,132) fed by strings containing `authStore.user?.username` — XSS-pattern sink bypassing Vue's sanitizer; chart `innerHTML` re-swap every 2-5 s is also the perf issue (L10/L11). Fix: text nodes + reactive SVG bindings.
- **F-S4. Committed admin credentials & per-machine paths** in `e2e/test_accordion_and_redesign.cjs:5,19`, `test_scroll_timeline.cjs:11`, `test_verify_redesign.cjs:21` (`AdminPass123!`, `C:/Users/ZroiK/...`). Fix: env-var-ize (`E2E_USER/PASS/ARTIFACT_DIR`), **rotate the committed password**, convert to Playwright specs or delete.
- **F-S5. nginx: no security headers on the SPA** (no CSP, X-Frame-Options, HSTS, nosniff, Referrer-Policy; helmet only protects the API). Add headers.
- **F-S6.** `nginx.conf:45` `proxy_redirect ... http://$http_host/...` breaks HTTPS deployments (mixed-content redirects). Fix: scheme-agnostic redirect.
- **F-F1. Confidence slider fires a network PUT on every drag tick** (`ClassTogglePanel.vue:27-33,214,262-265`) — combined with F-C1 this re-wipes classes N times per drag; double event binding (`v-model` **and** `@update:model-value`); `props.initialConfidence || 0.25` treats legitimate `0` as falsy. Fix: debounce/commit on release, remove duplicate binding, use `??`.

### HIGH (functional)

- **F-F2. Audit UI fabricates entries on fetch failure** (`ConfigurationView.vue:1806-1823`) — a forensic panel that invents "success" rows after a transient network error. Fix: error state + retry, never synthetic rows.
- **F-F3. Router duplication:** `/configuration` has `alias:["settings"]` **and** a separate `/settings` record to the same view (`router/index.ts:8-9,48-58`); `SettingsView.vue` (whole file) is imported but used **nowhere** — dead code in the bundle. Fix: one record + redirect; delete the file and import.
- **F-F4. `cameras?.length || 2`** — sidebar shows a fake camera count of **2 when there are zero cameras** (`AppLayout.vue:138-139`); count also ignores `enabled`. Fix: filter + honest 0/hide.
- **F-F5. HardwareMonitor fabricates host data** ("AMD Ryzen 7 7745HX" default, per-ID resolution table, hardcoded 8.00 GB VRAM ceiling even on a 24 GB GPU, `cpuCores || 8`). This mirrors backend B-M12 — a monitoring dashboard showing invented specs is an ops trust hazard. Fix: `??` to "—"; real VRAM total from `hwStats`.
- **F-F6.** VmafTelemetry pagination can exceed `totalPages` (no clamp, `:288,297`); no in-flight guard on manual probe (double-click = double probe); `let pollTimer: NodeJS.Timeout` Node types in browser code (`:323`, contrast `HardwareMonitorView:247`).
- **F-F7.** `apiFetch` refresh-failure does a hard `window.location.href="/login"` destroying all client state; **any** 401 (not just auth-401) triggers global logout (`services/api.ts:18-31`). Fix: `router.push` + scope the logout to auth-error signature.
- **F-F8. VideoPlayer post-unmount resurrection:** awaits inside WHEP flow then continues to `setRemoteDescription` even after `stopAll()` runs, catch path creates a new `Hls` on a detached element, and the scheduled `whepWatchdog` can `startHls` after unmount (`VideoPlayer.vue:234-306,334-336`); `on*` handler reassignment churn across fallback transitions. Fix: `alive` flag checked after every await; `addEventListener` with paired removal.
- **F-F9. BboxOverlay:** split-mode maps coords directly against container ignoring the letterboxing used by non-split mode (`:182-198`), index `:key` on boxes that reorder each frame, inconsistent `videoRect` guard. Fix: stable keys; rect per slice.
- **F-F10.** `parent_camera_id || 0` resolves detections against a `cam0` bucket that never exists (`LiveMatrixView`) — boxes silently vanish instead of "no data". Fix: `parent_camera_id ?? camera.id`.

### MEDIUM

- **F-M1. i18n is structural theater:** `login.*`, `matrix.*`, most of `vmaf.*`/`timeline.*` keys are defined but views hardcode Indonesian (LoginView:11,55; TimelineView:623-629; ConfigurationView's toasts; VmafTelemetryView:231). **Both locale files contain duplicate JSON keys** (`nav.hardware` ×2, `nav.theme` ×2, `nav.lang` ×2 in en.json:15-25 and id.json — last silently wins; the pairs have *different meanings*). Fix: route strings through `t()`; add a CI assert that every `t('…')` literal exists in both locales; lint JSON for duplicate keys; delete dead keys.
- **F-M2. Vite dev proxy lacks `/stream/*`** (`vite.config.ts:19-50`) — HLS/WHEP unreachable in dev, blocking the whole dev loop outside nginx. Fix: add `/stream/hls → :8888`, `/stream/webrtc → :8889`.
- **F-M3. Two parallel theming systems:** ui/ primitives hardcode iOS palette + Tailwind `zinc-*/dark:` classes while `style.css` defines a `--text/--surface/--iris` variable system keyed on `[data-theme]` — the two can disagree (dark-mode gates in tests flip `.dark` but not `data-theme`); `stroke="#007AFF"` hardcoded in `BboxOverlay.vue:24,36`. `Card.vue` manually forwards `$attrs.class` despite normal fallthrough. Fix: migrate primitives to `var(--*)`, one dark-mode selector mechanism, delete the manual forward.
- **F-M4.** `<a href="#kamera">` navigates router history and muddles back-button behavior (HardwareMonitorView:41). Fix: `scrollIntoView` on click.prevent.
- **F-M5. `formatBytes`/format helpers triplicated with diverging unit semantics** (VmafTelemetryView:412-417 vs TimelineView vs HardwareMonitorView:384-397); duplicated `.card/.btn/.toast` scoped styles; sr-only duplicated. Fix: `src/utils/format.ts` + shared CSS, with unit test.
- **F-M6.** Theme store `applyTheme` at creation makes the `@media (prefers-color-scheme)` block in style.css dead-after-first-paint (FOUC hazard), and OS theme *changes* are never listened for (`stores/theme.ts:121`, style.css media block). Fix: delete block or `data-theme="auto"`; add `matchMedia` change listener.
- **F-M7.** Config store always sends the full object, `saveConfig({})` + `{reset:true} as any` overload load-bearing semantics; `saveSuccess` timer never cleared. Fix: diff-based saves + dedicated `factoryReset()` typed method.
- **F-M8. Socket store hygiene:** stale boxes never expire in-store; unresolved `console.warn([SYSTEM ALERT])` in production; telemetry store resolved inside every hot event; no `socket.off` before reconnect (stale closures of old auth state).

### LOW
Stale-token flash through router guard (token-presence check only, `router/index.ts:73`); HLS fatal errors brick the tile with no retry affordance (VideoPlayer:160-172); TimelineView invents 75 % savings (`raw*0.25` fallback, :604-619), no scrub debounce, click offset math ignores `getBoundingClientRect` (:780,943); no `ended`-fallback watchdog for auto-advance (:849); `tsx`/tsconfig `@/*` alias declared but dead; whitelisting all "Failed to load resource" in the e2e console filter swallows genuine 500s (vms.spec.ts:188-195).

---

## 3. Recorder — `services/media-engine/recorder`

### CRITICAL

- **R-C1. ffmpeg stderr piped but never drained + no spawn `error` handler + unhandled rejections** (`supervisor.ts:196-230,156-158,211-230`): a chatty camera fills the 64 KB pipe → ffmpeg deadlocks in a stderr write → no exit event → supervisor never notices; a missing ffmpeg binary emits an unhandled `'error'` that kills the whole Node process (recording for all cameras); any DB hiccup inside `fs.watch`/exit-handler await chains becomes `unhandledRejection` → process death. **Fix:** `proc.on("error", …)` routed to the normal failure path; drain/ignore stdio; try/catch both async callback sites.

### HIGH

- **R-H1. Fragmented-MP4 flags omit `+empty_moov`.** `supervisor.ts:196` — README/spec advertise `frag_keyframe+empty_moov+default_base_moof`; actual args differ → crash-before-first-flush yields an unprobeable file → reconciler mis-classifies `SKIPPED`. Fix: add `+empty_moov`.
- **R-H2. No RTSP stall watchdog.** No `-timeout/-rw_timeout`; a jammed camera blocks forever with no retry, no alert (`supervisor.ts:182-198`). Fix: socket timeouts + supervisor watchdog on segment-file mtime staleness.
- **R-H3. Re-entrancy race finalizes a segment twice / clobbers `currentSegmentPath`** (`supervisor.ts:128-152`): the await between check-and-set is interrupted by newer events; newest file's row stays `RECORDING` until restart. Fix: set `currentSegmentPath` before any await; serialize per-camera events; guard row updates with `WHERE status='RECORDING'`.
- **R-H4. Catch-all turns any finalization hiccup into permanent `SKIPPED, duration=0`** (`recorder.ts:154-160`): MySQL failure or a file already deleted by the transcoder degrades good recordings; no single-flight guard on finalize. Fix: only probe-failure ⇒ SKIPPED; in-flight set per path.
- **R-H5. Orphan files never reconciled** (`reconciler.ts:18-20`): reconciles DB→file only; files with no DB row (crash between ffmpeg file creation and INSERT) are invisible forever, consuming disk and never transcode. Fix: reverse pass over `raw/cam*` → insert rows (name-derived timestamps) or delete+alert.
- **R-H6. Absolute-path coupling across environments** (`recorder.ts:48` vs reconciler): dev `data/raw` ≠ compose `/data/raw` ⇒ every abandoned row from the previous run fails `fs.access` and is rewritten `SKIPPED`. Fix: store `raw_path` relative to `RAW_DIR`.
- **R-H7. `setSegmentSec` is a lie:** `recorder.ts:43-45` sets options used only for *future* supervisors; running ffmpegs keep the old `-segment_time` while the log claims "Dynamic update … configured". Fix: propagate to supervisors' next spawn or recreate them; log truthfully.
- **R-H8. `registerCamera` overwrites an existing supervisor without `stop()`** (`recorder.ts:47-68`) → duplicate ffmpeg writers, duplicate files, UNIQUE(raw_path) collisions. Fix: unregister-then-register guard.
- **R-C-H9. (cross-checked crypto duplication)** `recorder/src/crypto.ts` is a byte-for-byte duplicate of `apps/api-server/src/crypto/credentials.ts` (+ dead never-imported module, `main.ts:6`): two copies of AES-256-GCM with no versioned envelope today and silent drift tomorrow. Fix: single shared workspace package with `key_id‖iv‖tag‖ct` envelope.

### MEDIUM

- **R-M1. Same-second filename collisions vs `raw_path UNIQUE`** (`supervisor.ts:180` + schema): crash-restart within one second duplicates the filename → INSERT fails → feeds R-C1. Fix: add sequence suffix or `INSERT … ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)`.
- **R-M2. Timezone:** ffmpeg `-strftime` names files in process-local time while both TS parsers assume UTC (`index.ts`, `recorder.ts:21-36`) → off-by-TZ (Asia/Jakarta = 7 h) timeline corruption on non-UTC hosts. Fix: spawn with `TZ=UTC` or name files from TS.
- **R-M3.** Fire-and-forget Redis publishes (recorder.ts:88-93,148-153, supervisor.ts:230, reconciler.ts:84) — ioredis offline-queue rejection = unhandled rejection; status events silently lost.
- **R-M4.** Startup register-window race + no retry for failed registrations, no periodic DB↔supervisor reconcile (main.ts:78-93); every `camera:updated` event restarts ffmpeg even for metadata-only edits (recording gaps) (main.ts:101-109); payload trusted without enabled-check.
- **R-M5.** All system_config config-load errors swallowed silently (`main.ts:41-55`); unvalidated `Number()` propagates `"NaN"` into `-segment_time` (main.ts:105-117) — zod is a dependency but unused.
- **R-M6.** Reconciler's `recovered/failed` contract is wrong: `failed` never incremented; error branch counts as `recovered` (reconciler.ts:15-16,81,98); sequential per-row probe with 15 s timeout each can block startup minutes; probe zero-duration maps to 0 indistinguishable from crash-truncated files (probe.ts:39-40); probe persists fabricated `fps=25`/`codec="unknown"` to MySQL (probe.ts:43,55); `r_frame_rate` (nominal) used instead of `avg_frame_rate`; no `maxBuffer` on ffprobe (corrupt file → ENOBUFS → misclassified).
- **R-M7.** Supervisor `stop()` can hang forever racing exit-listener attach (supervisor.ts:100-108); alert spam publishes critical alert every ~30 s forever after 5 failures without re-arm (:228-240); inconsistent default `segmentSec || 60` vs 3600 elsewhere (:179); triple dotenv paths including one **outside the repo** (main.ts:8-10); integration test commits live-camera-style credentials and hard-depends on an internal `192.168.1.100` (`recorder.integration.test.ts:53,113`).

---

## 4. RTSP proxy — `services/media-engine/rtsp-proxy`

- **P-C1 (CRITICAL). Unauthenticated credential oracle on the host.** `proxy.py:10,126-130,174-179` + compose `ports: "8555:8555"`: any client reaching :8555 gets camera credentials (pulled from Redis) injected into their own session. Fix: remove the host port publish entirely; require a shared secret before credential serving.
- **P-H2. Plaintext RTSP URL w/ password persisted in Redis** (`cam:{id}:rtsp_url`, written by `routes/cameras.ts:368,557,273`) — defeats the entire "credentials encrypted at rest" design; proxy also prints first-packet bytes that can echo credentials into logs (:102). Fix: hand the proxy an encrypted blob or DB reference only; mask all logs.
- **P-H3. No TCP framing / state-machine corruption** (`proxy.py:95-179,199-216`): rewrites applied per `recv(8192)` chunk — request lines split across chunks bypass rewriting; SDP `config=` patch + Content-Length recompute garbles when responses span chunks or interleave `$`-RTP after headers → entire RTSP/TCP desync. Fix: buffer + reassemble complete messages; forward interleaved data untouched.
- **P-H4. "Digest-enforcer" actually forces Basic and breaks digest-only cameras** (`:200-204,176-179`): strips the server's Digest challenge and injects Basic proactively — the targeted Hikvision/V380 digest-only firmware class never connects (the `OPTIONS` hack is a symptom). Fix: relay challenges untouched; or implement real server-side digest; per-camera `auth_mode: auto`.
- **P-H5. Hand-rolled RESP client mis-parses** coalesced/split replies, truncates >4096-byte bulk strings, one fresh AUTH handshake per lookup per 15 s (`:30-46`). Fix: use the `redis` package; parse length prefixes.
- **P-M6. No post-connect timeout / keepalive:** half-dead cameras leak 2 sockets+2 threads each with no cap on concurrency (:151,136,243-244). Fix: idle timeouts, keepalive, connection cap.
- **P-M7.** Every pump-thread exception swallowed by bare `except: pass` (:183-184,221-222); synthetic 404/503 with regex-CSeq that isn't anchored to header block; `URL_CACHE` never prunes and is lock-free-but-cross-thread (:16-17,46); only the *first* packet is inspected for camera id then all subsequent requests on that session are re-targeted (multi-camera tunneling bug) (:86,91-114, X10).
- **P-M8.** Dockerfile: unpinned `python:3.11-alpine`, root, no tini/healthcheck; compose bind-mounts source over the image copy (runtime ≠ image); `test_v380.py:5` hardcodes LAN IP and validates a **different** Content-Length algorithm than proxy.py ships.
- Backlog `listen(25)`, cam-1-only fallback URL, `LISTEN_PORT` hardcoded despite env conventions.

---

## 5. AI vision worker — `services/ai-vision-worker` (Python, PyAV + Ultralytics)

- **A-C1 (CRITICAL). `bbox_json` always `'[]'`.** `event_dedup.py:55` reads `detection.get("box", [])` but detectors produce `x1,y1,x2,y2` keys — every forensic event row is written with empty coordinates, permanently. **Fix:** build the array from x1..y2 (or add `box` in `normalize_box`); add a round-trip test.
- **A-C2 (CRITICAL). Wrong exception tuples kill threads on any Redis outage.** `worker.py:198`, `gpu_stats.py:120`, `toggle_sync.py:171,194`, `main.py:83` catch *builtin* `ConnectionError` — redis-py's `ConnectionError` inherits `RedisError` and is **never caught** → detections, GPU telemetry, toggle sync, and the camera-change listener all silently die on a Redis blip (correct pattern exists once, `main.py:106`). Also `worker.py:160` omits `pymysql.MySQLError` from the detection-event flush → DB hiccup kills the consumer thread. **Fix:** catch `redis.RedisError, OSError` everywhere; supervisor/watchdog that restarts dead pipelines.
- **A-C3 (CRITICAL). One shared pymysql connection across all camera threads** (`worker.py:71,100,130` built in `main.py:119`). PyMySQL connections are not thread-safe → protocol interleaving/corruption. Fix: per-thread connection or pool.
- **A-H4. Wall-clock (`time.time()`) for sampling/cooldown/window math** (`stream_reader.py:139-149`, `event_dedup.py:41`, `activity_indexer.py`) — NTP backward steps freeze sampling and suppress dedup for up to the jump; forward jumps over-sample. Fix: `time.monotonic()` internally, epoch only for stored timestamps.
- **A-H5. Container/decoder leak + EOF reconnect storm.** `stream_reader.py:135-171`: on `AVError` the container never closes (descriptor leak); on clean EOF the backoff counter is never incremented → instant reconnect loop against MediaMTX. Fix: `try/finally` close; measure connection lifetime on both paths for backoff.
- **A-H6. Activity/offset math is a magic-threshold hack.** `worker.py:200-202,89-98` — `>= 1000000000` epoch heuristic, `rel_offset % 60` invented offsets, recording chosen by `ORDER BY id DESC LIMIT 1` regardless of `[started_at, ended_at]` containment (spec requires containment + ≤60 s buffering; windows get misattributed at segment boundaries); `window_index` written as epoch-bucket (~89,000,000) instead of recording-relative index; dead `get_window_index` code. Fix: SQL predicate on containment, real relative window index, delete the 1e9 hack.
- **A-H7. No supervision on `_consumer_loop`** (`worker.py`): any uncaught exception permanently kills a camera's detection while health reports "connected"; `get_health_status` is **dead code** and the compose healthcheck is `python -c "sys.exit(0)"` (tautology). Fix: wrap loops; watchdog; real health signal (heartbeat key or tiny endpoint).
- **A-H8. TensorRT + YOLO26n + NVDEC + "FP16" are claims, not code:** `export_engine()` has no caller; `MODEL_PATH` runs plain `yolov8n.pt`; no TensorRT dep, no `/data/models` engine cache/fingerprint logic (spec §8.2/§239); `stream_reader.py` selects no HW decoder (nvdec does not exist in plain `av` builds) and `thread_count=1` (CPU decode); "YOLO26n TensorRT (FP16 N-Free)" UI copy vs actual yolov8n FP32 PyTorch. Fix: either implement (TensorRT export-on-fingerprint + half precision + hw decode) or align all docs/claims — today the flagship marketing claim is fiction.
- **A-H9. Shared YOLO model object across camera threads without warm-up or lock** (`worker.py:36-56`): Ultralytics `predict()` mutates predictor state; simultaneous first-inference races can crash; no warm-up in production (only benchmark.py warms up) breaking the ≤1 s publish gate on first frames. Fix: predictor lock + warm-up inference in `__init__`.
- **A-M10. COCO convention mismatch (documented hazard):** `classes.py`/`classes.ts` use the Ultralytics contiguous 0–79 ids (self-consistently correct for the shipped model); official COCO dataset ids differ from id 29 on. Any external tool consuming "COCO" ids will mislabel ≥29. `luggage` preset includes umbrella (25). Fix: single canonical table + conversion helper + assertion tests.
- **A-M11. Stale per-camera toggle state on removal** (`toggle_sync.py` `_states`/`detector._seq_by_camera` never cleared on `camera:removed`; camera re-added starts with pre-delete class set) + reconciliation never reads authoritative `cam:{id}:rev` (api-server camerega:115/283/367). Fix: `forget(camera_id)` on removal; reconcile rev too.
- **A-M12. No MySQL reconnect after startup failure** (`main.py`: if DB unreachable at boot, worker runs forever in "local mode" with zero detection, no retry loop — the recorder/API retry but the AI worker never does).
- **A-M13.** Dockerfile: `uv.lock` copied but unused (`uv pip install` ignores it — non-reproducible builds; use `uv sync --frozen`); no `USER`; model baked into image while compose mounts `./src` (dev/prod drift); `EVENT_COOLDOWN_SEC`/`OTHER_CLASS_WEIGHT` envs documented in .env.example/spec but never read (hardcoded 5.0/1.0); `AI_FPS=0` silently becomes 10 (`stream_reader.py:84`).
- **A-M14.** `activity_indexer` writes raw un-normalized counts as `weighted_activity_score` (spec formula ambiguity vs the dashboard's %-normalized display — verify consumer); last-event-timestamps map never pruned (`prune_stale_entries` defined, never called); dedup state resets on restart → event burst; `snapshot_path` never populated (whole `ai_detection_events` table is registry-only today: bbox always `[]` + snapshot always NULL); early events per recording get `recording_id=NULL`.
- **A-L15.** Detector `device` kwarg only sent when truthy — `.to()` failure leaves `"cuda:0"` per frame → RuntimeError storm per frame (feeds A-H7); benchmark defaults to a Windows path `D:/anothervms/tests/1minuteroad.mp4`; mask regex breaks on IPv6; missing tests: `main.py`, `benchmark.py`, `stream_reader.run_reader`, event-flush paths (C1/C2/C3 would all have been caught), `export_engine`, worker manager lifecycle.

---

## 6. Infrastructure — compose, Dockerfiles, env, scripts (my direct pass)

- **I-C1 (CRITICAL). `services/media-engine/Dockerfile.ffmpeg:81` COPYs `scripts/check-ffmpeg.sh` — not in build context** (the file exists at repo-root `scripts/check-ffmpeg.sh`; context is `services/media-engine`, whose `scripts/` dir is empty). Any clean-checkout build fails at that layer. Fix: move/copy the script into the context or delete the COPY line (and actually use it as smoke test/HEALTHCHECK — its absence is one reason `libnuma1` went unnoticed). **Also runtime image misses `libnuma1`** (built for libx265 in builder, absent in runtime) → CPU-HEVC fallback crashes exactly during GPU-outage resilience (:71-76). Plus ffmpeg cloned from a **moving branch** `release/8.1` — two builds produce different encoders for a system whose quality contract is VMAF-based reproducibility; pin to a commit hash.
- **I-C2. Healthchecks are tautologies.** recorder/transcode/ai-vision healthchecks are `node -e process.exit(0)` / `python -c "sys.exit(0)"` (docker-compose.yml:139,181,222) — "healthy" while the service does nothing, which combined with `depends_on: service_healthy` masks real outages. Fix: real probes (DB/Redis ping, socket heartbeat).
- **I-H3. Env-var XOR drift between .env.example and compose.** `RAW_DELETE_GRACE_SEC`, `DELETE_RAW_AFTER_VERIFY`, `PROBE_INTERVAL_SEC`, `CQ_MIN/CQ_MAX/CQ_SAFETY_MARGIN`, `DEFAULT_TARGET_VMAF_*`, `DEFAULT_ENCODER/PRESET`, `STATIC_CQ_TTL_SEC`, `QUEUE_W_*`, `DISK_*`, `EVENT_COOLDOWN_SEC`, `WEIGHT_*`, `MODELS_DIR` are documented/tuned in `.env.example` but **never passed to any container** — the tuning surface is inert in Docker. Additionally `TMP_DIR` (.env) vs `TEMP_DIR` (code/compose) inconsistency, and compose contradicts itself: transcode-worker hardcodes `RAW_RETENTION_SEC: 86400` while api-server is `${RAW_RETENTION_SEC:-30}` (type-1 and type-2 retention semantics split across services silently). Fix: pass through everything on one canonical list; unify names; derive presets in one place.
- **I-H4. Prod deploy is a host-mount delivery system:** both prod containers get **host dist/ bind-mounted read-only over the image** (`docker-compose.yml:102,137,179,252`) — running code is whatever accidentally sits on the host (stale-code hazard); images also COPY the same dist (dead weight). rtsp-proxy mounts `proxy.py`, ai-vision mounts `./src`. Fix: bake code into images (multi-stage), drop host mounts in the prod compose (keep for dev overlay).
- **I-H5. Recorder Dockerfile base `FROM vms-transcode-worker:latest`** (recorder/Dockerfile:1) is an image that only exists after building another compose service first — `docker compose build recorder` standalone fails or picks a stale tag. Fix: dedicated multi-stage.
- **I-M6.** `mediamtx:latest` unpinned; webcam API `9997` published to the host with no auth (better attack surface than the streams themselves — path add/remove/hijack); MediaMTX not HLS/secrets aligned (`videomaster` remuxes all paths continuously even when nobody watches — CPU cost scales with cameras not viewers).
- **I-M7.** `web-dashboard` publishes **two host ports (8080 and 5173) to the same nginx:80** (compose :248-250) — README claims 5173 is "Vite dev", misleading; the duplicated publish just exposes the same thing twice.
- **I-M8. Dev-compose hardcodes the default internal secret in camera URLs** (`docker-compose.dev.yml` sim-cams: `mediamtx_internal_token_secret`) — will silently 401 forever if the real secret is changed in one place only (the recorder has the same desync: `MEDIAMTX_AUTH_SECRET` is not even declared for the recorder service).
- **I-M9. Repo hygiene:** root `configuration-export.html` (472 KB, git-ignored artifact), empty `tes/` directory, `test-results/.last-run.json` stat inside web-dashboard, ~74 untracked-by-any-wiring one-off scripts in `scripts/` (verify/test/capture/debug scripts with no npm-script entry or docs — several duplicate each other), `.gitignore` `*.html` global ignore is coarse, `.env` header still titled "Smart VMS" (branding drift), `data/raw` sample files live inside the recorder build context (no `**/data/**` in recorder .dockerignore — build context pollution with 18 mp4s).
- **I-M10. Docs:** README "Reset database schema to fresh baseline: `pnpm --filter @vms/api-server start:worker`" is wrong (that's just the worker entrypoint; the actual reset lives in `scripts/reset-db.sql` and isn't wired to any pnpm script); "Python 3.12 + uv" but ai-vision pins torch cu124 wheels with `>=3.12` allowing 3.13; memory of "relative URL placeholder" clone link (`your-username`); Fastify/DI claims mismatch actual Express; claims `pnpm test` covers unit tests across "all monorepo workspaces" but backend `pipeline.integration.test.ts` is **skipped unless `RUN_INTEGRATION_TESTS` is set** and consolidator merge logic has zero tests.

---

## 7. Cross-service design flaws (systemic)

1. **Two crypto implementations of the same secret store** (api-server `credentials.ts`, recorder `crypto.ts`, identical byte-for-byte) with no versioned key envelope and no AAD — any future change breaks decryption in one service silently.
2. **MediaMTX sync logic triplicated** (index/boot, cameras route, onvif route) — the constant-time-held `MEDIAMTX_AUTH_SECRET` default is in all three copies.
3. **Class-toggle logic duplicated across three transports** (HTTP route, socket gateway `ai:toggle_class`, worker `toggle_sync`) with paralyzed divergences (only one checks admin; only one validates confidence).
4. **"Plausible fake numbers" as a design pattern** — backend stats (fake GPU/CPU/resolution/queue), frontend (fake sound-model name / VRAM / camera count / savings ratio), fake NTP success, fabricated audit rows, healthcheck lies. This is the single most pervasive quality problem: **the system reports success when it did not happen** in at least eight places.
5. **State-machine exists to prevent exactly what the code does** — five direct status UPDATE sites bypass `transitions.ts`.
6. **Config surface spread:** recorder reads system_config from MySQL and falls back to env; api-server reads from same table via different merge logic; ai-worker reads almost none of it; compose overrides some of it — four sources of truth for the same knobs.
7. **Time semantics inconsistent everywhere:** ffmpeg strftime (local), TS parsers (UTC), Python wall-clock for durations, epoch-vs-recording-relative window indices, `started_at` fallback to `Date.now()`.
8. **No shared workspace package layer (pnpm workspace has only `apps/*` + recorder):** crypto, MediaMTX client, Redis config, DB config, class-id tables (TS↔Py), mask regexes, i18n of error strings are each re-implemented per service.

---

## 8. Test coverage — what's actually verified vs gaps

**Well covered:** auth matrix, AES round-trip, bisection (cq-search), window selection, priority math, migrator up/down, streaming (401/206/traversal), socket auth, MediaMTX hook, class mapping (Py+TS), event dedup basics, SSE/dedup/`FrameQueue`.

**Gaps that mask production bugs:**
- RBAC (`requireRole`) — 0 tests; the system's biggest hole sits exactly there.
- Consolidator **merge** path — 0 tests (only orphan-cleanup tested).
- Raw-reclamation chain (grace deletion, requeue, `raw_deleted_at`) — 0 tests; transitions.test never attempts `COMPLETED→COMPLETED` (would have caught B-H6-adjacent bug).
- `config`, `onvif`, `stats`, `events` routes — 0 route tests.
- `pipeline.integration.test.ts` skipped unless `RUN_INTEGRATION_TESTS` — the core transcode loop runs unverified in CI.
- AI worker: `worker.py` flush paths, `stream_reader.run_reader`, `main.py`, `benchmark.py` — no tests.
- Frontend: no contract test for `updateCameraClasses`; i18n test only asserts fallback-to-key (a typo'd key passes); e2e mocks encode the broken contract (see F-C4/M9).
- Bonus: `.pytest_cache/v/cache/lastfailed` exists → local test suite has been red before shipping the last commit.

---

## 9. Remediation plan (recommended order)

**Phase 0 — stop the bleeding (1 day, all config/doc-level):**
1. Remove all hardcoded secret fallbacks; fail-start on missing `JWT_SECRET`, `CREDENTIAL_KEY`, `MEDIAMTX_AUTH_SECRET`, DB/Redis creds, `INITIAL_ADMIN_PASSWORD` (B-C1/2/3, I-*, R-* defaults). Rotate any committed password (`AdminPass123!`).
2. `docker-compose.yml`: drop host-publish of proxy :8555 and MediaMTX :9997; make healthchecks real; pass the full env knob list through or delete it from `.env.example`; unify `TMP_DIR/TEMP_DIR`.
3. Fix `Dockerfile.ffmpeg` COPY path (+`libnuma1`, pin ffmpeg commit). Fix README's reset-DB command.
4. Add `requireRole("admin")` to every mutating camera/config/onvif/PTZ route (B-C4) and a global JSON error middleware + cookie-parser (B-M14).

**Phase 1 — data integrity (core pipeline correctness):**
5. Frontend↔backend class-toggle contract (F-C1) + real `update-password` endpoint (F-C2).
6. Consolidator merge confinement (`status='RAW' AND ended_at IS NOT NULL`, transaction + FOR UPDATE; exclude COMPLETED) (B-C5, B-H8).
7. Raw-reclamation chain: real deferred deletion scheduler, recordable `raw_deleted_at`, working `requeue` that enqueues (B-H1/H5/H6).
8. recorder: stderr drain + `error` handler + rejection guards (R-C1), `+empty_moov` (R-H1), finalized-status guards (R-H3/H4), orphan-file reconcile pass (R-H5), relative `raw_path` (R-H6).
9. AI worker: right exception tuples (A-C2), per-thread DB handles (A-C3), real `bbox_json` (A-C1), consumer supervision (A-H7).

**Phase 2 — robustness/consistency:**
10. Route ALL recording status writes through `transitionRecordingStatus` (B-M1/2); increment `attempts`.
11. rtsp-proxy: TLS/host isolation already handled in Phase 0; then message framing, digest relay, redis-py, timeouts (P-H3..P-M7).
12. Socket gateway: `system:alert` bridge, room authz, extract one toggle service (F-C3, B-M13).
13. i18n completion + duplicate-key lint + contract-shaped e2e mocks (F-M1, F-C4, F-M9).
14. UI polish battery: slider debounce, router deadcode, fake-data removal (both sides), VideoPlayer alive-flag, BboxOverlay keys, theme unification, `utils/format` extraction.

**Phase 3 — performance & design debt:**
15. Batch the priority N+1, LIMIT scheduler queries, composite index on events, real-size stats caching.
16. Extract `packages/crypto-credentials` (versioned envelope), `packages/mediamtx-client`, shared `utils` — dissolve the duplication chapter (§7).
17. Honest-fact policy: delete every fabricated number on both sides (B-M12, F-F5, NTP fake, audit seeds, watermark 50 %).
18. Claim-vs-code alignment for TensorRT/YOLO26n/NVDEC/FP16: implement or document.

---

## 10. Verified-good (checked, no finding)

`crypto/credentials.ts` GCM usage itself (12-B IV, tag verified, truncation guard); `vmaf/percentile.ts` NumPy-linear emulation; `cq-search` bisection integer-mid convergence + memoization + bounds guard; COCO 0-79 contiguous tables Py↔TS identical; recordings range-streaming (416 + traversal defense); `FrameQueue` bounded + thread-safe; backend/infra socket auth (`auth.token` handshake honored); nginx `/stream/*` prefix stripping; ONVIF route coverage matrix (verify/controls/ptz/imaging); `event_dedup` cooldown boundary semantics; camera split child-mapping contract front↔back; MediaMTX `cam{N}` path naming consistent across all four services.

---

---

# PART 2 — FIX VERIFICATION (re-audit after remediation pass, same day)

Scope: 44 files modified, ~989 insertions. Every original finding re-checked against the current working tree, plus a regression hunt in all fixed files, plus **actual execution**: `pnpm typecheck` (3 workspaces, PASS), `pnpm test` (api/web/recorder), `pytest` (28/28), `ruff check`, official FFmpeg docs cross-check for the new spawn flags.

**Tally: ≈28 findings FIXED · ≈15 PARTLY FIXED · ≈45 NOT FIXED (mostly in deliberately-untouched files) · 13 NEW REGRESSIONS introduced by the fixes (4 of them Critical).**

## V.1 🔴 Critical regressions introduced by the fixes

- **V-R1. The API server cannot boot at all.** `apps/api-server/src/app.ts:66` — new 404 catch-all `app.use("/api/*", …)` is invalid syntax for Express 5's path-to-regexp v8 (`Missing parameter name at index 6: /api/*`). It throws at module load. Verified by execution: 5 vitest suites crash at import (`auth`, `cameras`, `internal`, `recordings`, `gateway`). Any container running the built dist would crash on startup. **Fix:** `app.use("/api/{*path}", …)` — or mount the handler without a path (`app.use(…)` with a `req.path.startsWith("/api")` guard placed after all mounts).
- **V-R2. Recorder fix kills recording: `-stimeout` does not exist in FFmpeg 8.x.** `services/media-engine/recorder/src/supervisor.ts:200` added `-stimeout 5000000`. The deployed ffmpeg (`Dockerfile.worker` → `ghcr.io/feldjaeger/ffmpeg-vmaf-cuda` = FFmpeg n8.1.1) uses the RTSP-demuxer option `timeout` (microseconds) — confirmed against the official ffmpeg-protocols documentation; `stimeout` is the old pre-rename name and is gone. Every spawn exits instantly ("Unrecognized option") → total recording outage → and because the alert-spam throttle (R-M4) was NOT fixed, this also publishes a critical alert to Redis every ~30 s forever. **Fix:** `-timeout 5000000` (or `-rw_timeout`); verify with `ffmpeg -h demuxer=rtsp` in the actual image.
- **V-R3. None of the recorder fixes are running.** `services/media-engine/recorder/dist/*` is **stale** — contains none of the new code (no `empty_moov`, no `stimeout`, no `TZ`, no register-stop guard; verified by marker scan). `docker-compose.yml:135` mount-runs `node dist/main.js` from that stale dist. Same story for api-server and web-dashboard dist mounts. **Fix:** `pnpm build` (all workspaces) before/redeploy; ideally stop shipping dist via bind-mounts (I-H4).
- **V-R4. rtsp-proxy can no longer authenticate to Redis — the hardening broke itself.** `proxy.py:13` changed the password default to `""` (good), but `docker-compose.yml` gives the **rtsp-proxy service no `environment:` block**, while redis runs with `--requirepass ${REDIS_PASSWORD:-redis_password_secret}` (`:31`). Result: AUTH skipped → `NOAUTH` on every `GET cam:{id}:rtsp_url` → every proxied camera 404s. **Fix:** add `REDIS_PASSWORD: ${REDIS_PASSWORD:-redis_password_secret}` (and `REDIS_HOST/PORT`) to the rtsp-proxy service environment.

## V.2 Data-integrity regressions in the new code

- **V-R5.** `consolidator.ts:318` — new spurious-row cleanup `DELETE FROM recordings WHERE raw_path = ? AND id != ?` also matches *legitimate* previously-merged rows for the same hour (their `raw_path` is exactly the merged path) and deletes them without removing compressed artifacts or reassigning windows/probe logs → silent data loss on re-merge.
- **V-R6.** `cameras.ts:636-657` — camera delete now cleans child Redis keys and publishes `camera:changed removed` — but never deletes the **child DB rows**, so the new code emits removal events for cameras that still exist in DB (listeners now act on a removal for a listed camera), and slices still leak every re-parented read.
- **V-R7.** `worker.py:78-87` (ai-vision) — new recording-SELECT in `flush_activity_window` runs **outside** the new `_db_lock`, while other cameras' INSERT/commit run inside it → the shared pymysql connection still gets unsynchronized cursor use (the bug V-C/A-C3 set out to fix).
- **V-R8.** `detector.py` device kwarg storm + `_consumer_loop` catching only `ValueError,TypeError,OSError`: a CUDA `.to()` failure now produces a `RuntimeError` *per frame* that the loop doesn't catch → permanent silent camera-black (interaction made worse by the lock changes).
- **V-R9.** `auth/service.ts:79-80` — JTI revocation set has no TTL and no sweep → unbounded per-user growth (replaced `redis.keys()` with a leak).
- **V-R10.** `transcode/worker.ts:38` — `options.concurrency ?? Number(env) ?? 1`: when env is unset, `Number(undefined)` is `NaN`, and `??` doesn't catch NaN → NaN BullMQ concurrency. Unhit today only because `src/worker.ts` passes `|| 1`.
- **V-R11.** Frontend breakage from router deduplication: `LiveMatrixView.vue:69` — "Add Camera" link `{ name: "settings" }` no longer resolves (the named `/settings` record was removed) → dead empty-state link.
- **V-R12.** Frontend regression from v-html removal: `HardwareMonitorView.vue:13` now interpolates `heroSummaryHtml` as text, but `hw.heroSummary` in `en.json/id.json:121` still contains `<b>/<em>` markup → users see raw HTML tags rendered as literal text.
- **V-R13.** `nginx.conf` — security headers added at server level, but `location = /index.html` and `location /` define their own `add_header (Cache-Control)` — nginx `add_header` inheritance means **the SPA document itself gets no security headers** as configured.

## V.3 Verified FIXED (executed or evidence-checked)

| Area | Items |
|---|---|
| Secrets (B-C2/C3/C4, H3/H4) | `CREDENTIAL_KEY` all-zero default gone + refuses non-32-byte keys (test in `crypto/credentials.test.ts`); random admin password in prod; `admin123` dev-only; full RBAC: `requireRole("admin")` on all mutating camera/config/onvif routes incl. factory-reset and camera delete, **covered by the new `auth/rbac.test.ts`**; query-token restricted to `/stream` endpoints; internal route rate-limited + `timingSafeEqual` |
| Transcode (B-C5, H1/H5/H6, M2-part, M19, M21, M23) | Consolidator confined to `status='RAW' AND ended_at IS NOT NULL`, transaction + `FOR UPDATE`, unlink only after commit; requeue transitions + enqueues `rec-${id}`; watermark drops the age filter at high/critical; migration 005 widens the encoder enum (up+down) and zod now matches; LIMIT 50 on scheduler; chunk/concat timeouts scaled to chunk length; VMAF `referenceFrames` passed; `rtsps://` credentials fixed |
| Auth (B-M8, M10) | Refresh rotation: single-use via `del` return, `redis.keys()` → JTI set, role re-read from DB on rotate; **real SNTP query** over `dgram` with honest failure (report-only, clock not adjusted) |
| Backend misc (M14-part, M15-part, M17, M18) | Global JSON error middleware exists (stack hidden in prod); ONVIF XML fully escaped (`escapeXml`); new `src/mediamtx/` client with 5 s timeouts used by all three former duplicate sites; DB fail-fast in prod; `/readyz` genuinely checks DB+Redis |
| Frontend (C1, C2, F2/F11, F4, M1-part, M2, S3-part, S6, F3-part, F10-part) | Class-toggle contract **closed end-to-end** (store sends the backend's contract; backend now also accepts `active_classes` and returns `resolved_active_ids`; socket path matches too) — verified against current code on both sides; `POST /update-password` implemented backend + honest errors frontend; audit-log fabrication removed (clears to empty + loading state on failure); honest camera count with `enabled` filter; duplicate locale JSON keys removed (both files); vite dev proxy has `/stream/hls→8888` and `/stream/webrtc→8889`; `v-html` removed from greeting + two chart nodes; nginx HTTPS-hostile redirect fixed; router de-duplicated |
| Recorder (R-C1-part, H1, H3, H5-part, H8, M2) | stderr drained boundedly + `proc.on("error")` + try/catch watch/poll/exit paths; `+empty_moov` added; check-then-await-then-set race closed; per-path scoped SKIPPED; registerCamera stops the old supervisor; `TZ:"UTC"` passed to ffmpeg |
| Reconciler (R-H5-part, C3) | Reverse file→DB pass added (orphan INSERT); `failed` counter now actually increments |
| Docker (X1-part, Y1-part, I-M7) | rtsp-proxy host port publish removed; MediaMTX API bound to `127.0.0.1` on the host; duplicate 5173:80 publish removed; healthchecks upgraded from `exit(0)` tautologies to Redis-TCP probes |
| Proxies (P-H2-part) | First-packet logging masked; `REDIS_PASSWORD` default removed from proxy code |

## V.4 PARTLY FIXED — what's still missing

1. **B-C1/C4 leftovers:** dev-mode secret fallbacks remain (by design per fail-fast comments, but the fallback strings are the same public ones — consider random-dev or loud warn); `GET /api/config/audit-logs` still not admin-gated; SSRF (M11) now admin-only but no private-range denylist; media-token factory `endsWith("/stream")` is permissive-form.
2. **B-H2 caveat:** limiter now keys on `req.ip` but `app.set("trust proxy")` is never configured — behind any proxy all clients share one bucket.
3. **B-H7:** child Redis cleanup added, child **DB rows** still orphaned (see V-R6) — camera delete remains inconsistent DB↔Redis.
4. **B-M4:** temp-file cleanup now age-bounded (600 s) but still no DB cross-reference — a long-running live job older than 10 min matching `.tmp_` can still be deleted.
5. **B-M13:** `ai:toggle_class` admin check + class-ID validation + `system:alert` bridge done; confidence still unvalidated in socket path; `join:camera` still room-open to any viewer; no disconnect-on-revoke; direct `io.to("system")` probe path is a no-op (clients never join `system`) while the Redis path broadcasts to ALL — inconsistent.
6. **B-M20:** `window-selection` gained `windowDurationSec`, but `pipeline.ts:334-342` doesn't pass it → coverage divisor still ~4× too coarse in the live path (still downgrade-to-blind-fallback risk).
7. **B-M7:** rate-limiter now a `multi()` pipeline but INCR and conditional EXPIRE are separate round-trips — crash window still leaves a TTL-less key; still fail-open on Redis error.
8. **B-M15:** prod exits on failed DB boot ✓ but dev continues into a broken unmigrated state; `/healthz` still static.
9. **B-M12:** `watermark.getDiskUsage` still fabricates 50% on `statfs` failure (the disk-safety gate consuming fiction — this one is dangerous for a deletion-adjacent subsystem).
10. **Frontend F5:** "AMD Ryzen" fallback and `v-html` removed, but hardcoded `cpuCores || 8`, `8080→||8.00` GB VRAM, per-ID resolutions `2304×2592`, RAM 32.0/11.7 WSL, and the RTX 4060 strings in locale tables all remain.
11. **Frontend F10:** `??当家` fix landed for stream_path but the detection bucket is still `cameraDetections[camera.parent_camera_id ?? 0]` — null-parent resolves bucket 0 (never populated).
12. **Frontend M1:** duplicate locale keys removed; but LoginView / TimelineView / VmafTelemetryView / ConfigurationView toasts / LiveMatrixView remain hardcoded Indonesian while the keys exist.
13. **Recorder R-C1 remainders:** `stop()` can still hang (unconditional await on `exit`; `proc.kill()` throw = unhandled rejection); FSWatcher `error` events still unhandled.
14. **Recorder R-H4:** status guard `WHERE status='RECORDING'` on the finalize UPDATE and a single-flight set still absent — double-finalize UPDATEs are still last-write-wins.
15. **Recorder R-M3/M4:** reconciler publishes awaited ✓, but `system:alert` (supervisor.ts:260-271) and `recording:status` publishes remain fire-and-forget; alert spam unthrottled (with V-R2 this hammers Redis ~every 30 s while a camera is down).
16. **Recorder R-H8:** stop-before-register added ✓ but two concurrent `registerCamera` calls can still both pass pre-set check → double spawn window remains.
17. **Crypto CR1:** still two copies (content now near-identical, envelope compatible, old rows decrypt with the shipped zero-key `.env`), no shared workspace package; dev fallback key silently changed from all-zero to `0123…` string — only matters for env-unset deployments with pre-existing rows.
18. **I-C1:** `check-ffmpeg.sh` now exists in `services/media-engine/scripts/` ✓ and `libnuma1` added ✓ — but capture **still unbuildable from a clean checkout** because no compose/docker entry builds Dockerfile.ffmpeg (recorder actually derives from `vms-transcode-worker:latest`, which uses the third-party unpinned `ghcr.io/feldjaeger/ffmpeg-vmaf-cuda:latest`), and ffmpeg stays cloned from moving `release/8.1`.

## V.5 NOT FIXED (unchanged files — the remaining backlog)

**api-server** (files untouched, findings unchanged): `stats.ts` fabricated telemetry + hardcoded queue zeros + `mediamtx:9997` + invented cam1/cam2 + CPU fallback; `events.ts` unindexed deep-OFFSET; `internal.ts`-adjacent AAA; `transcode/priority.ts` N+1; `db/migrator.ts` false-atomicity DDL; `stats.ts:548` direct status UPDATE + manual-trigger unique jobId (M22 — double-enqueue fight remains); `recordings.ts:151-165` offset fabrication; `vmaf/`-related L items; pipeline catch-all status reset to RAW (V-R10-adjacent; see also V.2); `attempts` double-counting (V-R10-adjacent).

**web-dashboard** (untouched): S1 tokens in localStorage; S2 JWT in media URLs; S4 committed `AdminPass123!` + machine paths in `.cjs`; C4 e2e mocks encode the old contract; F7 hard `window.location` logout on any 401; VideoPlayer post-unmount resurrection (alive-flag) + handler churn; BboxOverlay letterboxing/index keys/`#007AFF`; VmafTelemetryView pagination clamp + NodeJS browser timers + in-flight guard; TimelineView scrub debounce/ratio fabrication; theme store media-query dead block + no OS listener; config store full-object save; socket store stale detections + console.warn; `formatBytes` triplication; M3 dual theming systems; **dead file `views/SettingsView.vue` still on disk** (nothing imports it).

**rtsp-proxy** (proxy.py barely touched): P-H3 framing, P-H4 digest-strip→Basic, P-H5 hand-rolled RESP, P-M6 no timeouts/keepalive/cap, P-M7 bare-except + URL_CACHE never pruned, P-M9 nginx-side whatever — the proxy is today only slightly safer (host-unbound, masked logs) but still protocol-fragile.

**recorder**: R-H6 relative `raw_path`; R-H7 `setSegmentSec` no-op; R-M1 same-second filename collision vs UNIQUE(raw_path); R-M4 alert spam; R-M5 main.ts (config swallow, register window race, restart churn on every camera:updated, unvalidated Number → NaN, dotenv path outside repo); R-M6 probe.ts (zero-duration indistinction, fabricated fps=25/codec, `r_frame_rate`; no maxBuffer).

**ai-vision** (untouched except 4 files): A-C2 in `gpu_stats.py:120`, `toggle_sync.py:171/194`, `main.py:83` (redis.RedisError never caught — all three of these threads still die on a Redis blip); A-C3 main.py still passes one shared connection (lock is partial, see V-R7); A-H4 sampling/cooldown still wall-clock epoch (self-consistent storage, jump-vulnerable); A-H5 EOF busy-reconnect storm (finally-close fixed, zero-backoff clean-EOF NOT); A-H6 offset/`window_index` hack completely untouched; A-H7 no supervision/dead `get_health_status`/compose healthcheck still dependency-only (now: "is Redis reachable" — not "is the worker alive"); A-H8/H9 TensorRT/YOLO26n/NVDEC/FP16 claims remain fiction; no detector lock/warm-up; A-M11 stale toggle state on camera:removed; A-M12 no MySQL reconnect; MODEL_PATH unvalidated; L4 device-storm (see V-R8).

**compose/env**: covered above (V-R4, I-* remainders) → env knobs still inert in Docker (RAW_DELETE_GRACE_SEC etc. still not passed); recorder Dockerfile still `FROM vms-transcode-worker:latest`; webrtcAdditionalHosts still loopback-only (WHEP broken off-host); `.env` header brand drift; ffmpeg unpinned.

## V.6 Verification runs (executed)

| Check | Result |
|---|---|
| `pnpm typecheck` (api, web, recorder) | ✅ all 3 PASS |
| `pnpm --filter @vms/web-dashboard test` (vitest) | ✅ 13/13 in 4 suites |
| `pytest` ai-vision-worker | ✅ 28/28 |
| `ruff check` ai-vision-worker | ❌ **13 errors** — all in the NEW fix code: `S110/B010/BLE001` in `worker.py` (blind `except Exception: pass` on lock attach + ping; blind-Exception publish) and `stream_reader.py` (close pass). `pnpm verify` gates on this → CI red |
| `pnpm test` api-server vitest | ❌ 55 pass / 16 skip, but **5 suites crash at import on V-R1** (`/api/*` path-to-regexp); 3 suites `ECONNREFUSED 127.0.0.1:3306` (environmental — needs the local MySQL; not a code failure) |
| recorder vitest | unit file ✅; integration suite ❌ ECONNREFUSED (same environmental DB need) |
| FFmpeg docs cross-check | ✅ confirms `stimeout` gone, `timeout` (µs) is the RTSP-demuxer option — V-R2 verified |

## V.7 Recommended next actions (priority order)

1. **Fix V-R1** (`/api/{*path}`) — API won't boot otherwise. Re-run `pnpm -F @vms/api-server test`; bring up the local MySQL for the 4 DB-gated suites.
2. **Fix V-R2** (`-stimeout` → `-timeout`) and confirm with `ffmpeg -h demuxer=rtsp` inside the actual image.
3. **Fix V-R3** — `pnpm build` (api-server, recorder, web-dashboard), and ideally drop the dist bind-mounts.
4. **Fix V-R4** — pass REDIS_* env to rtsp-proxy in compose.
5. Re-ruff: give worker.py/stream_reader.py proper loggers instead of `except: pass` (ruff clean), or vendor `# noqa: S110`/`BLE001` with justification.
6. Apply V.2 data-integrity patch-up (consolidator DELETE cross-check, camera-delete child DB rows, `_db_lock` coverage in flush_activity_window, JTI TTL `EXPIRE`, NaN default, `{ name: 'settings' }` link, hero-locale de-HTML, nginx add_header repositioning).
7. Then the remaining untouched backlog (Part 1 §9 Phases 2-3), reprioritized by the V.5 lists.
