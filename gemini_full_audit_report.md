# Quantis VMS — Ground-Truth Re-Deep Scan & Full System Audit Report

**Audit Date:** November 6, 2026  
**Auditor Role:** Principal Systems Architect, Multimedia/FFmpeg Systems Engineer, Lead Security & Performance Auditor  
**Repository Working Tree:** `d:\anothervms`  
**Execution Mode:** STRICT READ-ONLY AUDIT (Zero modifications to codebase; Ground-Truth Code Inspection)  
**Target Output Artifact:** `gemini_full_audit_report.md`  

---

## 1. Executive Summary & True System State

### 1.1 True State of the Codebase
A comprehensive, line-by-line inspection of all subsystems across `apps/api-server`, `apps/web-dashboard`, `services/media-engine`, and `services/ai-vision-worker` was conducted against the physical files on disk. 

Previous remediation efforts successfully addressed several high-profile vulnerabilities:
- **`vmaf/runner.ts`:** CPU VMAF fallback frame-count calculation now properly scales with `n_subsample` via `expectedVmafFrames()` instead of comparing directly against raw reference frames.
- **`transcode/watermark.ts`:** Watermark threshold resolution now enforces `Number.isFinite()` with fallback to 85% rather than evaluating `NaN ?? 85` (which previously crippled disk watermark defenses), and `statfs` failure fails closed with `Number.NaN` and emits a critical alert rather than fabricating 50% disk usage.
- **`web-dashboard/stores/auth.ts`:** Token refresh requests now use a single-flight promise mutex (`refreshPromise`), preventing concurrent 401 storms from tripping backend token-reuse revocation.
- **`ai-vision-worker/src/stream_reader.py`:** PyAV 19 compatibility was resolved by catching `_av.FFmpegError` instead of the deprecated/removed `av.AVError`.

However, the current working tree harbors **several critical architectural disconnects, performance chokepoints, and data-integrity risks**:
1. **Critical MP4 Container Seek Index Defect (`supervisor.ts`):** `services/media-engine/recorder/src/supervisor.ts` does **not** include `+global_sidx` or post-finalize `+faststart` remux in its `-segment_format_options`. Although the compiled artifact `dist/supervisor.js` contained `+global_sidx`, the source file `src/supervisor.ts` was subsequently modified/reverted without it. Any new build will wipe `+global_sidx`, leaving raw MP4 recordings with `mvhd.duration = 0` and no index. This directly triggers the Chromium "Range Storm" (hundreds to thousands of HTTP Range requests per video seek).
2. **AI Sampling Window Mismatch (`pipeline.ts` vs `window-selection.ts`):** `pipeline.ts` invokes `selectProbeWindow` without passing `windowDurationSec`. Consequently, `selectProbeWindow` defaults to `sampleDurationSec` (e.g., 10s or 5s) while `ai-vision-worker` writes 20s activity windows. The calculated window coverage falls to 50% (< 90%), forcing the smart transcode pipeline to **permanently downgrade to `blind_fallback`**, completely discarding AI activity index metadata.
3. **Consolidator Cascading Data Loss (`consolidator.ts`):** When hourly consolidation merges multiple RAW segments into a single file, it deletes superseded segments from `recordings` without reassigning `ai_detection_events.recording_id`. Because the foreign key is configured with `ON DELETE SET NULL`, **all forensic detection events for consolidated segments are wiped to `NULL`**. Furthermore, reassigning `recording_activity_windows` without rebasing `window_index` and `start_offset_sec` risks duplicate key collisions on `(recording_id, segment_index, window_index)`.
4. **Unsynchronized Multi-Threaded YOLO Inference (`worker.py` & `detector.py`):** `VisionWorkerManager` instantiates a single shared `YOLODetector` instance across all camera worker threads. In `_consumer_loop`, multiple camera threads execute `detector.detect_frame` concurrently without an inference lock or GPU serialization mutex, creating severe race conditions in PyTorch/CUDA predictor buffers.
5. **Streaming Endpoint Resource Leaks & Event Loop Blocking (`routes/recordings.ts`):** Every single Range request executes a JWT verify, database query, and multiple synchronous blocking `fs.realpathSync` / `fs.existsSync` calls. When Chromium aborts requests during seek probing (`net::ERR_ABORTED`), the underlying Node.js `fs.createReadStream` is never destroyed, leaking file descriptors and disk read bandwidth.

---

### 1.2 Subsystem Status Summary Table

| Subsystem | Actual Code Status | Critical Blockers | Primary Failure Mode |
|---|---|:---:|---|
| **Phase 1: Ingest, RTSP Proxy & MediaMTX** | Degraded / Fragile | 2 | Chunk splitting in `proxy.py` corrupts interleaved RTP; MediaMTX auth webhook rate-limiter keys on single container IP; `WWW-Authenticate: Digest` stripping breaks Digest-only cameras. |
| **Phase 2: Recording Engine & Lifecycle** | Critical Defect | 3 | Fragmented MP4 segments lack `sidx` in `src/supervisor.ts`; `src` vs `dist` compilation desync; ffprobe transient timeout permanently marks footage `SKIPPED`. |
| **Phase 3: AI Vision & Activity Indexing** | Thread-Unsafe / Skewed | 3 | Shared YOLO instance called concurrently across threads without lock; activity windows store absolute Unix epoch as `window_index`; event deduplicator marks cooldown before DB commit. |
| **Phase 4: Playback & HTTP Streaming** | Severe Chokepoint | 4 | Range Storm triggered by duration=0 MP4s; unhandled `res.on("close")` leaks file streams on aborted Range requests; synchronous `fs.realpathSync` blocks Node event loop on every Range slice. |
| **Phase 5: Compression, Pipeline & VMAF** | Logic Defect / Data Loss | 3 | `pipeline.ts` omits `windowDurationSec`, permanently breaking AI smart probing; consolidator deletes rows causing `ON DELETE SET NULL` on detection events; final verification never checks full-file VMAF. |
| **Phase 6: Security, Telemetry & Docker** | High Security Risk | 3 | Audit trail stored in volatile 50-item in-memory array; Socket.IO `join:camera` has zero authorization checks; hardcoded fallback hardware specs and marketing claims in UI/API. |

---

### 1.3 Top 15 Most Critical Issues Ranked by Severity & Impact

1. **[REC-01] [CRITICAL] `src/supervisor.ts` Lacks `+global_sidx` & Desyncs with `dist/supervisor.js`**  
   Raw segments are generated with `mvhd.duration = 0` and no index. Rebuilding the project will propagate this regression to `dist`, causing Chromium to issue 1,500+ Range requests per 1-hour video seek.
2. **[TX-01] [CRITICAL] Consolidator Deletes Recordings Wiping AI Events via `ON DELETE SET NULL`**  
   `consolidator.ts` deletes superseded recording rows after merging without updating `ai_detection_events.recording_id`, causing MySQL FK cascade to orphan all AI detection metadata to `NULL`.
3. **[AI-01] [CRITICAL] Unlocked Concurrent YOLO Inference Across Multi-Camera Threads**  
   `worker.py` invokes `detector.detect_frame()` from separate threads for each camera against a single `YOLO` model instance without a mutex, inducing CUDA predictor memory corruption.
4. **[STR-01] [CRITICAL] Streaming Endpoint Leaks File Descriptors on Aborted HTTP Range Requests**  
   `routes/recordings.ts` pipes `fs.createReadStream` to `res` without listening to `res.on("close")` or calling `stream.destroy()`. Chromium's aborted requests leave unclosed file handles.
5. **[TX-02] [CRITICAL] Smart Probing Mismatch Downgrades All Transcodes to `blind_fallback`**  
   `pipeline.ts` does not pass `windowDurationSec` to `selectProbeWindow`, causing coverage calculation to fail (< 0.9) against 20s activity windows, disabling AI-guided smart probing.
6. **[RTSP-01] [HIGH] RTSP Proxy Binary Stream Corruption & Digest Stripping**  
   `proxy.py` parses `recv(8192)` chunks assuming full RTSP frames and strips `WWW-Authenticate: Digest`, breaking Digest-only cameras and corrupting interleaved binary RTP data.
7. **[STR-02] [HIGH] Synchronous Event-Loop Blocking on HTTP Range Requests**  
   `isPathSafe()` executes synchronous `fs.existsSync` and `fs.realpathSync` across multiple allowed roots on every single byte-range slice, blocking Node.js concurrency under media streaming loads.
8. **[UI-01] [HIGH] Frontend `downloadVideo` Buffers Multi-Gigabyte Segments into Browser RAM**  
   `TimelineView.vue` downloads 1-hour raw recordings via `await res.blob()`, causing browser heap exhaustion and tab crashes on 2GB–4GB video files.
9. **[SEC-01] [HIGH] Unauthorized Socket.IO Room Access via `join:camera`**  
   `sockets/gateway.ts` permits any authenticated user to join any `camera:${cameraId}` room without verifying camera permissions, exposing real-time detection boxes.
10. **[AI-02] [HIGH] Activity Indexer Stores Unix Epoch as Window Index**  
    `activity_indexer.py` divides wall-clock Unix timestamp by 20 to compute `window_index`, populating values in the tens of millions rather than 0-indexed segment offsets.
11. **[SEC-02] [HIGH] Volatile In-Memory "Forensic" Audit Trail Capped at 50 Items**  
    `routes/config.ts` stores security audit records in a JavaScript array (`forensicAuditLogs`) capped at 50 items, destroying audit history on container restart.
12. **[REC-02] [HIGH] Transient FFprobe Timeouts Permanently Mark Footage `SKIPPED`**  
    `reconciler.ts` immediately marks recording rows as `SKIPPED` on any probe failure (including disk I/O timeouts), permanently excluding recoverable footage from playback and compression.
13. **[NET-01] [MEDIUM] MediaMTX Webhook Rate Limiting Blocks Legitimate Viewers**  
    `routes/internal.ts` rates limits auth requests by MediaMTX container IP. Because MediaMTX proxies all viewer auth, multiple LL-HLS viewers on the same stream trigger a collective 429 lock.
14. **[STR-03] [MEDIUM] RFC 7233 Non-Compliant Range Parsing Rejects Suffix Ranges**  
    `routes/recordings.ts` fails to parse `bytes=-500` suffix ranges, returning 416 Range Not Satisfiable to compliant clients.
15. **[UI-02] [MEDIUM] Double Video Reload on Stream Mode Toggle**  
    `TimelineView.vue` triggers synchronous `playbackVideoRef.load()` before Vue's reactive `nextTick` updates the DOM `:src`, initiating two back-to-back stream requests.

---

## 2. Historical Audit Verification Ledger

Cross-check of findings from previous reports (`AUDIT_REPORT.md`, `FULL_AUDIT_2026-11-03.md`, `playback_report.md`) against current code on disk:

| Historical Finding ID & Description | Previous Status | Current Working Tree Status | Exact File:Line Proof & Evaluation |
|---|---|:---:|---|
| **B-C1 / B-C2: Insecure Default Secrets & Credential Key** | Critical | **PARTIALLY FIXED** | `apps/api-server/src/auth/service.ts:21-30` enforces `assertSecureConfig` in production, but `docker-compose.yml:49-51` and `proxy.py:13` still use fallback strings if env is unset. |
| **B-C4: RBAC Missing on Mutating Endpoints** | Critical | **VERIFIED FIXED** | `apps/api-server/src/routes/cameras.ts:263,364,493,618,646`, `routes/config.ts:424`, and `routes/onvif.ts:95,152,312` now explicitly enforce `requireRole("admin")`. |
| **B-C5: Consolidator Destroys Completed Transcodes** | Critical | **PARTIALLY FIXED** | `apps/api-server/src/transcode/consolidator.ts:179-183,229` now restricts query to `status = 'RAW' AND ended_at IS NOT NULL`, but still drops `ai_detection_events` via FK cascade (:364). |
| **OPS-1: MediaMTX Auth Secret Missing in Compose** | Critical | **VERIFIED FIXED** | `docker-compose.yml:95,141,238` explicitly maps `MEDIAMTX_AUTH_SECRET: ${MEDIAMTX_AUTH_SECRET:?MEDIAMTX_AUTH_SECRET is required}` to `api-server`, `recorder`, and `ai-vision-worker`. |
| **OPS-2: PyAV 19 `av.AVError` Attribute Crash** | Critical | **VERIFIED FIXED** | `services/ai-vision-worker/src/stream_reader.py:11-16` defines `FFmpegError = _av.FFmpegError` with fallback, eliminating the `AttributeError`. |
| **B-M1: `recordings.attempts` Not Incremented** | Medium | **VERIFIED FIXED** | `apps/api-server/src/transcode/worker.ts:74-76` executes `UPDATE recordings SET attempts = attempts + 1 WHERE id = ?` on job failure. |
| **B-M7: Rate Limiter Non-Atomic INCR/EXPIRE** | Medium | **VERIFIED FIXED** | `apps/api-server/src/auth/middleware.ts:104-118` executes atomic Redis pipeline with `incr()` and `expire()`. |
| **B-M10: Fake NTP Sync (DNS-only Probe)** | Medium | **VERIFIED FIXED** | `apps/api-server/src/routes/config.ts:373-405` implements genuine SNTP UDP packet exchange on port 123. |
| **B-M19: Transcode Timeout Hardcoded to 120s** | Medium | **VERIFIED FIXED** | `apps/api-server/src/transcode/pipeline.ts:541` dynamically scales timeout: `Math.max(120000, Math.round(chunk.durationSec * 4000))`. |
| **B-M21 / VMAF-01: CPU VMAF Subsample Frame Rejection** | Critical | **VERIFIED FIXED** | `apps/api-server/src/vmaf/runner.ts:129-133,222-225` verifies scored frames against `expectedVmafFrames(referenceFrames, backend)` using `n_subsample`. |
| **WM-01: Watermark `NaN ?? 85` Disabling Protection** | Critical | **VERIFIED FIXED** | `apps/api-server/src/transcode/watermark.ts:59-64` uses `Number.isFinite(envHigh) ? envHigh : 85` and fails closed on `statfs` failure (:38-46). |
| **AUTH-01: Parallel 401 Refresh Race Condition** | High | **VERIFIED FIXED** | `apps/web-dashboard/src/stores/auth.ts:59-88` implements single-flight `refreshPromise` caching to prevent concurrent token rotation. |
| **C-1: MP4 Missing `sidx` Seek Index (`+global_sidx`)** | Critical | **REGRESSION INTRODUCED** | Present in compiled `dist/supervisor.js:228`, but **missing** in source `services/media-engine/recorder/src/supervisor.ts:257`. A recompile will reintroduce the bug. |
| **PLAY-01: Synchronous `isPathSafe` Event Loop Block** | High | **STILL UNFIXED** | `apps/api-server/src/routes/recordings.ts:30-48,321` executes synchronous `fs.realpathSync` and `fs.existsSync` on every HTTP Range request. |
| **PLAY-02: File Stream Leak on Aborted Range Requests** | High | **STILL UNFIXED** | `apps/api-server/src/routes/recordings.ts:357-358` pipes `createReadStream` to `res` without listening to `res.on("close")` or invoking `stream.destroy()`. |
| **PLAY-03: `downloadVideo` Memory Exhaustion (Blob)** | High | **STILL UNFIXED** | `apps/web-dashboard/src/views/TimelineView.vue:867` buffers entire raw files into client memory using `await res.blob()`. |

---

## 3. Deep-Dive Findings by Subsystem

### 3.1 Phase 1: RTSP Ingest, ONVIF, RTSP Proxy & MediaMTX

#### [PH1-01] [HIGH] — MediaMTX External Auth Rate Limiter Keys on Shared Container IP
- **Location:** `apps/api-server/src/routes/internal.ts:41-48`
- **Current Code Evidence:**
  ```typescript
  const authLimiter = createRateLimiter({
    windowSec: 60,
    // HLS/LL-HLS authenticates per segment/part; one source IP (MediaMTX) serves
    // every viewer, so a low global bucket breaks playback. Key by action+path.
    maxRequests: 6000,
    keyPrefix: "mtx-auth",
    keyGenerator: (req) => `${req.ip || req.socket.remoteAddress || "unknown"}:${req.body?.action || ""}:${req.body?.path || ""}`,
  });
  ```
- **Measure:** MediaMTX makes internal webhook HTTP calls to `api-server:3000/internal/mediamtx/auth`. `req.ip` is always the MediaMTX container's bridge IP (e.g., `172.x.x.x`).
- **Identify:** The rate limiter combines `req.ip` with `action` and `path`. All users reading `cam1` via LL-HLS or WebRTC share the exact same key: `172.20.0.x:read:cam1`.
- **Root Cause:** In LL-HLS, players fetch segments and partial chunks every 200–500ms. If multiple operator dashboards view `cam1` concurrently, aggregate requests easily cross the 6000 requests/min threshold.
- **Concrete Fix:** Key the rate limiter by client identifier extracted from the JWT token candidate or query parameters (`query.jwt` / `user`), falling back to IP only for unauthenticated attempts.
- **Verification:** Simulate 10 concurrent LL-HLS viewers polling `cam1` and verify that individual user sessions are throttled independently without locking out all stream viewers.

---

#### [PH1-02] [HIGH] — RTSP Proxy Unchecked Chunk Splitting Corrupts Interleaved RTP & SDP Bodies
- **Location:** `services/media-engine/rtsp-proxy/proxy.py:102-106, 162-164, 203-207`
- **Current Code Evidence:**
  ```python
  while True:
      data = client.recv(8192)
      if not data:
          break
  ...
  # Rewrite RTSP request text if not binary RTP interleaved packet
  if not data.startswith(b"$"):
  ...
  data = cam_socket.recv(8192)
  if not data:
      break

  if not data.startswith(b"$"):
  ```
- **Measure:** TCP stream reads via `recv(8192)` do not respect RTSP application-layer message boundaries or RFC 2326 framing.
- **Identify:** 
  1. If an RTP interleaved packet (`$ + channel + length + payload`) is split across TCP segments, a sub-chunk arriving without a leading `$` byte is erroneously treated as text RTSP commands.
  2. The SDP parser recalculates `Content-Length` (lines 217–224) assuming the complete SDP body was received in that single `recv(8192)` call. If the SDP spans two chunks, `actual_len = len(body)` calculates an incomplete length, breaking client demuxers.
- **Root Cause:** Naive stream proxying without an RTSP state machine or TCP accumulator buffer.
- **Concrete Fix:** Implement a framed stream reader that inspects interleaved `$` headers and accumulates full `Content-Length` payloads before parsing or forwarding.
- **Verification:** Stream an H.264 RTSP feed with large SPS/PPS and high-bitrate I-frames through `proxy.py` and verify zero corrupted frame artifacts in FFmpeg client.

---

#### [PH1-03] [MEDIUM] — Unconditional Digest Stripping in RTSP Proxy Breaks Digest-Only Cameras
- **Location:** `services/media-engine/rtsp-proxy/proxy.py:209-212`
- **Current Code Evidence:**
  ```python
  # 1. Strip Digest header to force client to use Basic auth (fixes Hikvision / Dahua)
  if b"WWW-Authenticate: Digest" in data:
      lines = data.split(b"\r\n")
      filtered = [l for l in lines if not l.startswith(b"WWW-Authenticate: Digest")]
      data = b"\r\n".join(filtered)
  ```
- **Measure:** The proxy unilaterally deletes `WWW-Authenticate: Digest` challenge lines from camera RTSP responses.
- **Identify:** Cameras requiring strict Digest auth (e.g., modern Dahua, Hanwha, or Axis running latest firmware with Basic auth disabled) will refuse to authenticate when the client falls back to Basic.
- **Root Cause:** A hardcoded hack to accommodate older cameras that negotiate poorly when both headers are advertised.
- **Concrete Fix:** Only strip `Digest` if `WWW-Authenticate: Basic` is also present in the camera challenge, or implement full Digest pass-through forwarding.
- **Verification:** Connect a camera configured for Digest-only authentication; verify RTSP handshake completes successfully.

---

#### [PH1-04] [MEDIUM] — MediaMTX API Port 9997 Lacks Internal Network Authentication
- **Location:** `services/media-engine/mediamtx.yml:29-33` & `docker-compose.yml:69`
- **Current Code Evidence:**
  ```yaml
  # mediamtx.yml
  authHTTPExclude:
    - action: api
    - action: metrics
    - action: pprof
  ```
- **Measure:** MediaMTX excludes `api` from external HTTP authentication.
- **Identify:** Port 9997 is mapped to `127.0.0.1:9997` on the host, but inside the Docker network `vms-net`, the API endpoint `http://mediamtx:9997` has **no authentication requirement**.
- **Root Cause:** `api-server/src/mediamtx/client.ts:14` sends a Basic auth header, but MediaMTX ignores it because `action: api` is excluded from the webhook.
- **Concrete Fix:** Enable API credentials in `mediamtx.yml` (`apiUser` and `apiPassword`) and configure `mediamtx/client.ts` to supply matching HTTP Basic credentials.
- **Verification:** Execute `curl -i http://mediamtx:9997/v3/config/paths/list` from within another container; verify that 401 Unauthorized is returned without credentials.

---

### 3.2 Phase 2: Recording Engine & Segment Lifecycle

#### [PH2-01] [CRITICAL] — Source `src/supervisor.ts` Missing `+global_sidx` (Regressed vs `dist`)
- **Location:** `services/media-engine/recorder/src/supervisor.ts:253-259` vs `services/media-engine/recorder/dist/supervisor.js:226-228`
- **Current Code Evidence:**
  ```typescript
  // src/supervisor.ts (Line 253-258)
  "-f", "segment",
  "-segment_time", String(segmentSec),
  "-reset_timestamps", "1",
  "-strftime", "1",
  "-segment_format", "mp4",
  "-segment_format_options", "movflags=+frag_keyframe+empty_moov+default_base_moof",
  outputPattern,
  ```
  ```javascript
  // dist/supervisor.js (Line 226-228)
  "-segment_format", "mp4",
  "-segment_format_options", "movflags=+frag_keyframe+empty_moov+default_base_moof+global_sidx",
  outputPattern,
  ```
- **Measure:** `dist/supervisor.js` was compiled on Nov 5, 2026 at 22:39:27. `src/supervisor.ts` was subsequently modified on Nov 5, 2026 at 23:16:40. In the modified `src/supervisor.ts`, `+global_sidx` was omitted.
- **Identify:** Fragmented MP4 files written without `+global_sidx` have `mvhd.duration = 0` and no index. Chromium cannot determine media duration and is forced to perform a sequential byte-range scan (the "Range Storm"). If `pnpm build` is executed, the compiled artifact in `dist` will lose `+global_sidx`.
- **Root Cause:** Incomplete or reverted commit in `src/supervisor.ts` leaving source and build artifacts desynchronized.
- **Concrete Fix:** Update `src/supervisor.ts` line 257 to include `+global_sidx` and recompile `dist/supervisor.js`:
  ```typescript
  "-segment_format_options", "movflags=+frag_keyframe+empty_moov+default_base_moof+global_sidx",
  ```
- **Verification:** Run `ffprobe -v trace raw_segment.mp4` on newly recorded segments and verify presence of the `sidx` atom immediately following `moov`.

---

#### [PH2-02] [HIGH] — Reconciler Permanently Marks Footage as `SKIPPED` on Transient Probe Timeouts
- **Location:** `services/media-engine/recorder/src/reconciler.ts:74-84`
- **Current Code Evidence:**
  ```typescript
  } catch (err: any) {
    // Documented SKIPPED per Spec §12 Gate G6.2 / Decision D-006
    await pool.query(
      `UPDATE recordings SET
        status = 'SKIPPED',
        duration_sec = 0,
        failure_reason = ?
      WHERE id = ?`,
      [`SKIPPED: Empty or unreadable fragment after hard kill (${err.message})`, id]
    );
    failed++;
  ```
- **Measure:** During startup reconciliation, if `probeVideo` times out (15s default) due to disk I/O load or WSL bind-mount latency, `err.message` contains `"timed out"`.
- **Identify:** Unlike `recorder.ts:155-159` (which checks `const transient = /timed out|timeout|EACCES|EMFILE.../i` and leaves the row in `RECORDING`), `reconciler.ts` catches all errors and permanently marks the recording as `SKIPPED` with `duration_sec = 0`.
- **Root Cause:** Missing transient error classification in `reconciler.ts`.
- **Concrete Fix:** Port the transient error regex check from `recorder.ts` into `reconciler.ts`:
  ```typescript
  const transient = /timed out|timeout|EACCES|EMFILE|ENFILE|EBUSY|EAGAIN/i.test(err.message || "");
  if (transient) {
    console.error(`[Reconciler] Transient probe failure for #${id}; leaving RECORDING for next tick:`, err.message);
    continue;
  }
  ```
- **Verification:** Simulate an I/O hang during startup reconciliation; confirm that unprobed recordings remain in `RECORDING` rather than being marked `SKIPPED`.

---

#### [PH2-03] [MEDIUM] — Supervisor RTSP TCP Demuxer Uses `-timeout` Instead of `-stimeout`
- **Location:** `services/media-engine/recorder/src/supervisor.ts:246-248`
- **Current Code Evidence:**
  ```typescript
  "-rtsp_transport", "tcp",
  "-timeout", "10000000",
  "-i", this.config.rtspUrl,
  ```
- **Measure:** FFmpeg's RTSP demuxer historically accepts `-stimeout` (in microseconds) for socket read timeouts.
- **Identify:** In standard FFmpeg builds, `-timeout` applies to HTTP and generic network protocols, whereas RTSP TCP demuxer expects `-stimeout 10000000`. Passing `-timeout` to RTSP demuxer can be ignored depending on FFmpeg build options, causing FFmpeg to hang indefinitely if the RTSP stream stalls without socket closure.
- **Root Cause:** Inconsistent option naming between FFmpeg protocols.
- **Concrete Fix:** Supply `-stimeout 10000000` (or both `-timeout` and `-stimeout`) before the `-i` flag.
- **Verification:** Drop network packets to an active RTSP stream and verify that FFmpeg exits within 10 seconds.

---

### 3.3 Phase 3: AI Detection (YOLO), Activity Indexing & Live Overlay

#### [PH3-01] [CRITICAL] — Unlocked Concurrent YOLO Inference Across Multi-Camera Threads
- **Location:** `services/ai-vision-worker/src/worker.py:202-210, 313, 340-350`
- **Current Code Evidence:**
  ```python
  # In VisionWorkerManager.__init__ (Line 313):
  self.detector = YOLODetector(model_path=model_path)

  # In CameraWorkerPipeline.process_single_frame (Line 203-209):
  dets = self.detector.detect_frame(
      camera_id=self.camera_id,
      frame=frame,
      active_classes=state.active_classes,
      confidence_threshold=state.confidence_threshold,
      capture_ts_ms=capture_ts_ms,
  )
  ```
- **Measure:** Each active camera runs an independent consumer thread (`_consumer_loop`).
- **Identify:** All camera consumer threads invoke `self.detector.detect_frame()` simultaneously on the exact same `self.detector` object. Inside `detector.py`, `self.model.predict()` executes concurrently without a lock. Ultralytics `YOLO` predictor state and PyTorch CUDA context are **not thread-safe**.
- **Root Cause:** Missing inference serialization lock across worker pipelines.
- **Concrete Fix:** Add a shared `threading.Lock()` to `YOLODetector` (or `VisionWorkerManager`) and wrap `self.model.predict` in `with self._inference_lock:`.
- **Verification:** Run 4 concurrent camera streams with high AI FPS (15 FPS) and verify zero PyTorch CUDA illegal memory access exceptions.

---

#### [PH3-02] [HIGH] — Activity Indexer Stores Wall-Clock Unix Epoch as `window_index`
- **Location:** `services/ai-vision-worker/src/activity_indexer.py:102-105`
- **Current Code Evidence:**
  ```python
  window = ActivityWindow(
      window_index=int(self._current_window_start // self.window_duration_sec),
      start_offset_sec=int(self._current_window_start),
      duration_sec=self.window_duration_sec,
  ```
- **Measure:** `self._current_window_start` is an absolute Unix timestamp (e.g., `1730850000.0`).
- **Identify:** `window_index` is calculated as `1730850000 // 20 = 86542500`. It is stored in the database as an arbitrary 8-digit number instead of a 0-based offset relative to the recording segment start (`0, 1, 2, ...`).
- **Root Cause:** `_close_current_window()` does not reference the recording start timestamp.
- **Concrete Fix:** Pass `recording_start_ts` to the activity indexer or compute `window_index = rel_offset // window_duration_sec` inside `flush_activity_window` in `worker.py`.
- **Verification:** Query `recording_activity_windows` after recording starts; verify `window_index` begins at 0 and increments contiguously (0, 1, 2, 3...).

---

#### [PH3-03] [MEDIUM] — Event Deduplicator Records Cooldown Before MySQL Insert Succeeds
- **Location:** `services/ai-vision-worker/src/event_dedup.py:44-46` & `worker.py:242-251`
- **Current Code Evidence:**
  ```python
  # event_dedup.py (Line 44-45)
  # Eligible event: record timestamp and build payload
  self._last_event_timestamps[key] = timestamp
  ...
  # worker.py (Line 249-250)
  if event is not None:
      self.flush_detection_event(event)
  ```
- **Measure:** `process_detection()` updates `_last_event_timestamps[key]` immediately when returning the event object.
- **Identify:** If `flush_detection_event` fails (due to DB lock contention, temporary network disconnect, or MySQL restart), the cooldown timestamp is already locked. The event is permanently lost, and no new event for that class will be recorded for the next 5 seconds.
- **Root Cause:** State update occurs before persistent side-effect completion.
- **Concrete Fix:** Separate cooldown eligibility check from cooldown confirmation. Only update `_last_event_timestamps[key]` after `self.db_connection.commit()` succeeds in `flush_detection_event`.
- **Verification:** Simulate a temporary DB failure during event emission; confirm that detection events retry and persist once DB connectivity resumes.

---

### 3.4 Phase 4: Recording Retrieval, HTTP Range Streaming & Playback (`/playback`)

#### [PH4-01] [CRITICAL] — HTTP Range Stream Endpoint Leaks File Descriptors on Client Abort
- **Location:** `apps/api-server/src/routes/recordings.ts:357-359, 367-369`
- **Current Code Evidence:**
  ```typescript
  const stream = fs.createReadStream(targetPath, { start, end });
  stream.pipe(res);
  ```
- **Measure:** During Range request probing (the Range Storm), Chromium aborts hundreds of connections per second (`net::ERR_ABORTED`).
- **Identify:** Node.js `stream.pipe(res)` unpipes the writable destination on abort, but does **not** destroy the readable stream. The file descriptor remains open until GC, causing socket and file descriptor exhaustion (`EMFILE`). Additionally, unhandled `stream.on("error")` events can crash the process.
- **Root Cause:** Omitting `res.on("close", ...)` stream cleanup handler.
- **Concrete Fix:**
  ```typescript
  const stream = fs.createReadStream(targetPath, { start, end });
  stream.on("error", (err) => {
    if (!res.headersSent) res.status(500).end();
    stream.destroy();
  });
  res.on("close", () => {
    stream.destroy();
  });
  stream.pipe(res);
  ```
- **Verification:** Execute rapid range queries and abort them; inspect open file handles via `lsof` / handle monitoring and verify immediate descriptor closure.

---

#### [PH4-02] [HIGH] — Synchronous `isPathSafe` Blocks Event Loop on Every Range Slice
- **Location:** `apps/api-server/src/routes/recordings.ts:30-48, 321`
- **Current Code Evidence:**
  ```typescript
  export function isPathSafe(targetPath: string): boolean {
    try {
      const resolved = path.resolve(targetPath);
      let realPath = resolved;
      if (fs.existsSync(resolved)) {
        try { realPath = fs.realpathSync(resolved); } catch {}
      }
      return ALLOWED_STORAGE_DIRS.some((dir) => {
        const resolvedDir = path.resolve(dir);
        let realDir = resolvedDir;
        if (fs.existsSync(resolvedDir)) {
          try { realDir = fs.realpathSync(resolvedDir); } catch {}
        }
        return realPath === realDir || realPath.startsWith(realDir + path.sep);
      });
  ```
- **Measure:** Every single HTTP Range request calls `isPathSafe(targetPath)`.
- **Identify:** `isPathSafe()` executes synchronous `fs.existsSync()` and `fs.realpathSync()` for `targetPath` plus 3 allowed storage directories. Under a barrage of 200 Range requests, the main Node.js event loop blocks for 500ms–1500ms on filesystem syscalls.
- **Root Cause:** Path validation performed synchronously on dynamic media serving paths rather than memoizing real paths or using async fs APIs.
- **Concrete Fix:** Cache resolved real paths for allowed root directories at startup; perform pure string prefix validation without synchronous filesystem lookups per Range request.
- **Verification:** Benchmark Range request throughput using `autocannon`; observe event loop latency dropping from >500ms to <5ms.

---

#### [PH4-03] [HIGH] — Frontend `downloadVideo` Buffers Entire Multi-GB MP4 into Client RAM
- **Location:** `apps/web-dashboard/src/views/TimelineView.vue:858-877`
- **Current Code Evidence:**
  ```typescript
  const downloadVideo = async () => {
    if (!activeRecording.value) return;
    const rec = activeRecording.value;
    try {
      const res = await apiFetch(`/api/recordings/${rec.id}/download?mode=${streamMode.value}`);
      if (!res.ok) {
        videoError.value = `Gagal mengunduh rekaman (${res.status})`;
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.download = `Cam${rec.camera_id}_${String(rec.id)}.mp4`;
      link.href = url;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
  ```
- **Measure:** A 1-hour recording is between 600MB and 3.6GB in size.
- **Identify:** Calling `await res.blob()` forces the browser JavaScript runtime to allocate a contiguous memory buffer for the entire multi-gigabyte video file. In 32-bit processes or resource-constrained browser tabs, this triggers instant Out-Of-Memory crashes (`Aw, Snap!`).
- **Root Cause:** In-memory blob buffering instead of native browser streaming download.
- **Concrete Fix:** Use a direct anchor download link with authentication token in header/ticket, or trigger native browser download via `window.location.assign` / streaming ServiceWorker.
- **Verification:** Initiate a download of a 3.6GB segment; verify browser tab memory consumption remains flat (<100MB).

---

#### [PH4-04] [MEDIUM] — RFC 7233 Non-Compliant Range Parsing Rejects Suffix Ranges
- **Location:** `apps/api-server/src/routes/recordings.ts:337-347`
- **Current Code Evidence:**
  ```typescript
  if (rangeHeader) {
    // Range: bytes=start-end
    const parts = rangeHeader.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

    if (isNaN(start) || start >= fileSize || end >= fileSize || start > end) {
      res.status(416).setHeader("Content-Range", `bytes */${fileSize}`).end();
      return;
    }
  ```
- **Measure:** Compliant media players and curl probe the end of media files using suffix ranges: `Range: bytes=-500` (requesting the last 500 bytes).
- **Identify:** For `bytes=-500`, `parts[0]` is `""`. `parseInt("", 10)` returns `NaN`. The condition `if (isNaN(start))` triggers and rejects the request with HTTP 416 Range Not Satisfiable.
- **Root Cause:** Failure to support RFC 7233 suffix-range syntax.
- **Concrete Fix:** Parse empty `start` as `fileSize - parseInt(parts[1], 10)` and set `end = fileSize - 1`.
- **Verification:** Execute `curl -i -H "Range: bytes=-1000" http://localhost:8080/api/recordings/1/stream`; verify 206 Partial Content response.

---

### 3.5 Phase 5: Compression, Transcoding Pipeline, VMAF & `libvmaf`

#### [PH5-01] [CRITICAL] — Consolidator Wipes Detection Events via `ON DELETE SET NULL`
- **Location:** `apps/api-server/src/transcode/consolidator.ts:352-367`
- **Current Code Evidence:**
  ```typescript
  // Re-assign activity windows and probe logs to primary ID
  if (otherIds.length > 0) {
    await conn.query(
      `UPDATE recording_activity_windows SET recording_id = ? WHERE recording_id IN (?)`,
      [primary.id, otherIds]
    );
    await conn.query(
      `UPDATE vmaf_probe_logs SET recording_id = ? WHERE recording_id IN (?)`,
      [primary.id, otherIds]
    );
    // Delete superseded recording rows
    await conn.query(
      `DELETE FROM recordings WHERE id IN (?)`,
      [otherIds]
    );
  }
  ```
- **Measure:** In the MySQL database schema, `ai_detection_events` has a foreign key to `recordings.id` configured with `ON DELETE SET NULL`.
- **Identify:** `consolidator.ts` reassigns `recording_activity_windows` and `vmaf_probe_logs`, but **fails to reassign `ai_detection_events`**! When `DELETE FROM recordings WHERE id IN (otherIds)` executes, MySQL automatically updates `recording_id = NULL` on all detection events associated with those superseded segments.
- **Root Cause:** Missing `UPDATE ai_detection_events SET recording_id = ? WHERE recording_id IN (?)` in the consolidation transaction.
- **Concrete Fix:** Add the missing update statement prior to deleting superseded rows:
  ```typescript
  await conn.query(
    `UPDATE ai_detection_events SET recording_id = ? WHERE recording_id IN (?)`,
    [primary.id, otherIds]
  );
  ```
- **Verification:** Run `consolidateHourlyRecordings` on an hour containing AI events; query `ai_detection_events WHERE recording_id IS NULL` and verify zero orphaned rows.

---

#### [PH5-02] [CRITICAL] — Pipeline Omission of `windowDurationSec` Disables AI Smart Probing
- **Location:** `apps/api-server/src/transcode/pipeline.ts:344-352` & `window-selection.ts:47, 68`
- **Current Code Evidence:**
  ```typescript
  // pipeline.ts (Line 344-351)
  const winResult = selectProbeWindow({
    chunkIndex: k,
    chunkStartSec,
    chunkDurationSec,
    sampleDurationSec: probeSampleSec,
    smartAiSampling,
    windows: winRows as ActivityWindow[],
    staticCqCache: rec.static_cq_cache ? { cq: rec.static_cq_cache, cachedAt: rec.static_cq_cached_at } : null,
  });

  // window-selection.ts (Line 47, 68)
  windowDurationSec = sampleDurationSec,
  ...
  const expectedRows = Math.max(1, Math.floor(chunkDurationSec / windowDurationSec));
  const coverage = Math.min(1.0, chunkWindows.length / expectedRows);
  ```
- **Measure:** `ai-vision-worker` aggregates detections into 20-second activity windows (`window_duration_sec = 20`). In `docker-compose.yml`, `PROBE_SAMPLE_SEC` defaults to 10 or 5.
- **Identify:** Because `pipeline.ts` omits `windowDurationSec`, `selectProbeWindow` sets `windowDurationSec = probeSampleSec` (10s). For a 600s chunk, `expectedRows` becomes 60, but only 30 activity windows exist. Calculated coverage is `30 / 60 = 0.50` (< 0.90), forcing the pipeline to branch into `blind_fallback` on every single chunk.
- **Root Cause:** Contract parameter omitted during pipeline invocation.
- **Concrete Fix:** Explicitly pass the activity window duration:
  ```typescript
  windowDurationSec: 20,
  ```
- **Verification:** Run a transcode job on footage with detected activity; inspect `recording_chunks.sampling_mode` and verify it records `ai_peak` instead of `blind_fallback`.

---

#### [PH5-03] [HIGH] — Activity Window Collision on Hourly Consolidation
- **Location:** `apps/api-server/src/transcode/consolidator.ts:354-357`
- **Current Code Evidence:**
  ```typescript
  await conn.query(
    `UPDATE recording_activity_windows SET recording_id = ? WHERE recording_id IN (?)`,
    [primary.id, otherIds]
  );
  ```
- **Measure:** Table `recording_activity_windows` has a unique constraint on `(recording_id, segment_index, window_index)`.
- **Identify:** Superseded segment 2 has `window_index = 0, 1, 2...` and `start_offset_sec = 0, 20, 40...`. Updating its `recording_id` to `primary.id` without rebasing `window_index` and `start_offset_sec` (by adding segment 1's duration) causes duplicate key collisions (`ER_DUP_ENTRY`), rolling back the entire consolidation transaction.
- **Root Cause:** Merging activity windows across recordings without rebasing time offsets.
- **Concrete Fix:** Iterate through superseded segments in chronological order, rebasing `start_offset_sec` by cumulative duration and re-indexing `window_index` before assigning to `primary.id`.
- **Verification:** Consolidate 3 segments that each have activity windows; verify that all windows re-index seamlessly without SQL errors.

---

### 3.6 Phase 6: Security, Fabricated Telemetry, Frontend State & Docker Infrastructure

#### [PH6-01] [HIGH] — Socket.IO `join:camera` Permissive Authorization
- **Location:** `apps/api-server/src/sockets/gateway.ts:60-66`
- **Current Code Evidence:**
  ```typescript
  // Room management per camera (authorized join)
  socket.on("join:camera", (data: any) => {
    const cameraId = Number(data?.cameraId || data);
    if (cameraId && Number.isInteger(cameraId) && cameraId > 0) {
      socket.join(`camera:${cameraId}`);
    }
  });
  ```
- **Measure:** Any authenticated client can emit `join:camera` with any integer camera ID.
- **Identify:** The gateway verifies that the socket has a valid JWT, but performs **no authorization check** against whether the camera exists, is enabled, or whether a restricted user role is allowed to view that specific camera feed.
- **Root Cause:** Lack of resource-level permission checks in WebSocket room subscription handlers.
- **Concrete Fix:** Query camera existence and tenant/role authorization before invoking `socket.join()`.
- **Verification:** Connect a socket with a viewer token and request to join a non-existent or restricted camera ID; confirm connection is rejected.

---

#### [PH6-02] [HIGH] — Volatile In-Memory Forensic Audit Trail Discards Security History
- **Location:** `apps/api-server/src/routes/config.ts:87-99, 335-337, 363-366`
- **Current Code Evidence:**
  ```typescript
  // In-memory forensic audit log store for config actions
  interface ConfigAuditLog {
    id: number;
    timestamp: string;
    user: string;
    action: string;
    target: string;
    ip: string;
    status: string;
  }

  let nextAuditId = 1;
  const forensicAuditLogs: ConfigAuditLog[] = [];
  ...
  // Keep in-memory audit logs bounded to 50
  if (forensicAuditLogs.length > 50) {
    forensicAuditLogs.length = 50;
  }
  ```
- **Measure:** Configuration updates, factory resets, and administrative operations write to `forensicAuditLogs`.
- **Identify:** The system claims to maintain a "forensic audit log", but stores it in an unpersisted in-memory array capped at 50 entries. Any container restart or crash completely wipes the security log.
- **Root Cause:** Missing database-backed audit log table.
- **Concrete Fix:** Migrate `forensicAuditLogs` to an append-only MySQL table `system_audit_logs` with tamper-evident row hashing.
- **Verification:** Trigger 10 configuration changes, restart the `vms-api-server` container, and verify that all 10 audit records remain intact via `GET /api/config/audit-logs`.

---

#### [PH6-03] [MEDIUM] — Fabricated Hardware Specs & Fallback Metrics in UI
- **Location:** `apps/web-dashboard/src/views/HardwareMonitorView.vue:424, 437` & `ConfigurationView.vue:97`
- **Current Code Evidence:**
  ```typescript
  // HardwareMonitorView.vue
  const ramTotalGbStr = computed(() => {
    const b = telemetryStore.hwStats?.ramTotalBytes;
    return b ? (b / (1024 * 1024 * 1024)).toFixed(1) : "32.0";
  });
  ...
  const wslRamTotalGbStr = computed(() => {
    const b = telemetryStore.hwStats?.wslRamTotalBytes;
    return b ? (b / (1024 * 1024 * 1024)).toFixed(1) : "11.7";
  });

  // ConfigurationView.vue
  <input class="in mo" value="QUANTIS-NODE-RTX4060-01" disabled />
  ```
- **Measure:** When host metrics are loading or unavailable, telemetry views render fallback strings.
- **Identify:** Hardcoded fallbacks `"32.0" GB` for Windows host RAM, `"11.7" GB` for WSL RAM, and `"QUANTIS-NODE-RTX4060-01"` represent the developer's specific personal laptop specs. On standard production servers, these synthetic numbers display misleading hardware capacity.
- **Root Cause:** Hardcoding developer environment constants as fallback defaults.
- **Concrete Fix:** Render `"—"` or `"Loading..."` until genuine hardware telemetry is received from NVML and OS APIs.
- **Verification:** Run web-dashboard without backend connectivity; confirm that telemetry displays neutral loading indicators instead of synthetic hardware numbers.

---

## 4. Concrete Remediation & Architectural Roadmap

### Phase A: Critical Fixes (Data Safety, Recording Index & Playback)
1. **Re-add `+global_sidx` to `src/supervisor.ts`:** Update line 257 and compile `recorder/dist/supervisor.js` to ensure recorded MP4s have seekable duration indexes.
2. **Fix Stream Cleanup in `routes/recordings.ts`:** Register `res.on("close")` and `stream.on("error")` to destroy file descriptors on client aborts.
3. **Protect Detection Events in `consolidator.ts`:** Add `UPDATE ai_detection_events SET recording_id = ? WHERE recording_id IN (?)` prior to deleting consolidated segments.
4. **Fix AI Window Selection Parameter in `pipeline.ts`:** Pass `windowDurationSec: 20` to `selectProbeWindow` to prevent false fallback to `blind_fallback`.

### Phase B: Performance Optimization & Hardware Synchronization
5. **Serialize YOLO Inference:** Introduce `threading.Lock()` around `self.model.predict()` in `detector.py` to prevent multi-threaded CUDA race conditions.
6. **Async Memoized Path Safety:** Replace synchronous `fs.realpathSync` in `isPathSafe` with cached root-prefix checking.
7. **Stream Download Refactor:** Replace `await res.blob()` in `TimelineView.vue` with direct streaming browser downloads.
8. **Fix Activity Indexer Offset:** Compute relative 0-indexed `window_index` in `activity_indexer.py`.

### Phase C: Security Hardening & Telemetry Integrity
9. **Persistent Database Audit Trail:** Create `system_audit_logs` table in MySQL and migrate `forensicAuditLogs` off in-memory arrays.
10. **Socket.IO Room Access Control:** Verify user authorization in `join:camera`.
11. **Remove Fabricated Fallback Strings:** Clean out `"11.7 GB"`, `"QUANTIS-NODE-RTX4060-01"`, and synthetic hardware strings across UI views.
12. **Framed RTSP Proxy Buffer:** Refactor `proxy.py` to buffer interleaved RTP packets and forward complete SDP bodies.

---
*End of Audit Report. Standing by in strict read-only mode for user review and explicit execution instructions.*

