# Quantis VMS — Ground-Truth Deep Audit (Read-Only)

**Audit date:** 2026-11-06
**Auditor model:** DeepSeek V4.1 Flash
**Repository:** `D:\anothervms`
**Mode:** STRICT READ-ONLY. No source, config, database, or container state was modified. The only file created by this audit is this report.
**Scope:** `apps/api-server`, `apps/web-dashboard`, `services/media-engine` (recorder, rtsp-proxy, MediaMTX config), `services/ai-vision-worker`, Dockerfiles, `docker-compose.yml`, `docker-compose.dev.yml`, migrations, and cross-service contracts.

---

## 0. Method, Evidence Rules, and Verification Runs

### 0.1 Evidence rules

Every finding below is grounded in the current working tree. Each includes:

- an exact `path:line_start-line_end` location,
- a verbatim 2–10 line quote from that location (the only edits are indentation-neutral reflow inside the quote block; no words are changed),
- a concrete fix and a verification procedure.

Historical reports (`AUDIT_REPORT.md`, `FULL_AUDIT_2026-11-03.md`, `gemini_full_audit_report.md`, `FIXES_APPLIED.md`, `playback_report.md`, `docs/CLEAN_RESTRUCTURE_VERIFICATION_REPORT.md`) were treated **only as hypotheses**. Each claim in the ledger was re-checked against current code and classified as `VERIFIED FIXED`, `PARTIALLY FIXED`, `REGRESSION INTRODUCED`, or `STILL UNFIXED`. No historical claim was copied without current proof.

### 0.2 Commands actually executed (real output)

| Command | Result |
|---|---|
| `git status --porcelain` | Working tree already contained many modified/untracked files before this audit. The audit changed none of them. |
| `pnpm typecheck` | **PASS** — `apps/api-server`, `apps/web-dashboard`, `services/media-engine/recorder`: all `Done` (Scope: 3 of 4 workspace projects). |
| `pnpm --filter @vms/web-dashboard test` | **PASS** — `Test Files 7 passed (7)`, `Tests 30 passed (30)`, duration 2.92 s. |
| `docker compose ps` | **NOT RUN** — `docker` is not on the shell `PATH` (`The term 'docker' is not recognized`). No container health claim is made. |
| API Vitest / recorder Vitest / Python pytest | **NOT RUN** in this audit — the suites require a live MySQL/Redis and the Docker CLI needed to start them is unavailable here. No pass/fail claim is made. |

---

## 1. Executive Summary & True System State

### 1.1 Verdict

The codebase is **materially better than the 2026-11-03 baseline** on the specific regressions that had broken the product: API boot, FFmpeg `timeout` flag, VMAF frame-count math, watermark fail-closed behavior, PyAV error alias, refresh-token rotation, class-toggle contract, consolidator FK data loss, and stream file-descriptor cleanup are all genuinely fixed in the current tree.

However, the system still has **three structural classes of defects** that no amount of isolated patching has closed:

1. **Cross-service contract drift that survives because tests mock the wrong shape.** The clearest live case is `PROBE_SAMPLE_SEC`: the AI worker uses it as the activity-window width, while the transcode pipeline uses it as the VMAF sample length and hardcodes `windowDurationSec: 20`. With the shipped `.env.example` value (`10`), every AI window is 10 s wide but the pipeline expects 20 s windows, so coverage is miscomputed and smart probing degrades.
2. **Forensic data is still partly fabricated or misattributed.** Activity windows are attached to “the latest recording for this camera” with no containment check, and the API synthesizes 5-second windows with `frames_processed: 20` when the real table is empty.
3. **The runtime is not reproducible from the image.** `docker-compose.yml` bind-mounts host `dist/` directories over the built images for API, recorder, transcode worker, and dashboard, so the image contents can diverge from what actually runs.

### 1.2 Subsystem status table

| Phase / subsystem | True state | Severity of worst open issue |
|---|---|---|
| 1. Ingest, RTSP proxy, MediaMTX | Functional but protocol-fragile; WHEP is host-loopback-only; camera URLs exist in plaintext in Redis at runtime | **High** |
| 2. Recording engine | Segmentation and crash reconciliation work; ffprobe `N/A`/zero-duration handling can still permanently skip recoverable footage | **High** |
| 3. AI vision & activity indexing | Detection and inference locking work; activity windows can be attributed to the wrong recording; MySQL has no socket timeouts | **Critical** |
| 4. Playback & HTTP streaming | Range/suffix ranges and abort cleanup work; listing blocks the event loop per row; JWT still travels in URLs; synthesized forensic windows | **High** |
| 5. Compression, VMAF, consolidation | Consolidator is now transactional and reassigns events; final verification does not re-check VMAF; configured encoder is shadowed | **Medium-High** |
| 6. Security, telemetry, Docker | RBAC, secrets, audit persistence largely fixed; no CSP/HSTS on SPA; containers run as root; dist bind-mounts | **Medium-High** |

### 1.3 Top 15 findings (ranked by impact)

| # | ID | Severity | Finding | Primary location |
|---|---|---|---|---|
| 1 | `AI-01` | **Critical** | Activity windows are attached to the camera’s *latest* recording with no time-containment check | `services/ai-vision-worker/src/worker.py:87-108` |
| 2 | `AI-02` | **High** | `pymysql.connect()` has no `connect_timeout` / `read_timeout` / `write_timeout`; one stalled DB stalls every camera thread sharing the connection | `services/ai-vision-worker/src/main.py:40-48` |
| 3 | `TX-01` | **High** | `PROBE_SAMPLE_SEC` is used as the AI window width **and** VMAF sample length, while the pipeline hardcodes `windowDurationSec: 20` | `apps/api-server/src/transcode/pipeline.ts:231,343-352`; `services/ai-vision-worker/src/main.py:104,151` |
| 4 | `PB-01` | **High** | Recording list performs two synchronous filesystem calls per row on the request thread | `apps/api-server/src/routes/recordings.ts:106-118` |
| 5 | `PB-02` | **High** | API synthesizes 5-second “forensic” activity windows with `frames_processed: 20` when the table is empty | `apps/api-server/src/routes/recordings.ts:212-270` |
| 6 | `SEC-01` | **High** | Access JWT is stored in `localStorage` and placed in stream/download query strings, where nginx logs it | `apps/web-dashboard/src/stores/auth.ts:11,20`; `.../TimelineView.vue:635-640,858-864` |
| 7 | `PB-03` | **High** | `isPathSafe()` runs synchronous `existsSync`/`realpathSync` on every Range request | `apps/api-server/src/routes/recordings.ts:40-49,326` |
| 8 | `REC-01` | **High** | `parseFloat("N/A")` becomes `0`; a transient-zero duration is written as `SKIPPED`, excluding recoverable footage | `services/media-engine/recorder/src/probe.ts:39-40`; `recorder.ts:149-166` |
| 9 | `TX-02` | **Medium-High** | System-configured `compression.preferredEncoder` is dead because the non-null camera column is always truthy | `apps/api-server/src/transcode/pipeline.ts:285` |
| 10 | `TX-03` | **Medium-High** | Final verification checks duration/decode/size only; no full-file VMAF re-check, and a `NaN` duration silently passes | `apps/api-server/src/transcode/pipeline.ts:582-594,662` |
| 11 | `SEC-02` | **Medium-High** | Plaintext camera RTSP URLs (with credentials) are written to Redis at runtime | `apps/api-server/src/routes/cameras.ts:466-468,524`; `src/index.ts:97` |
| 12 | `INF-01` | **Medium-High** | Compose bind-mounts host `dist/` over the built images, defeating image reproducibility | `docker-compose.yml:110,148,199,274` |
| 13 | `INF-02` | **Medium-High** | WHEP advertises only `127.0.0.1`/`localhost`, so remote browsers cannot connect | `services/media-engine/mediamtx.yml:19-22` |
| 14 | `INF-03` | **Medium** | nginx `/api/` sends `Upgrade`/`Connection: upgrade` on every API call and buffers media responses | `apps/web-dashboard/nginx.conf:34-41` |
| 15 | `SEC-03` | **Medium** | SPA has no CSP/HSTS, and no Dockerfile declares a non-root `USER` | `apps/web-dashboard/nginx.conf:5-8`; all `Dockerfile*` |

---

## 2. Historical Audit Verification Ledger

### 2.1 VERIFIED FIXED

**H-01. `B-C4` — RBAC absent on mutating routes.**
*Source:* `AUDIT_REPORT.md` §1 (CRITICAL B-C4).
*Current proof:* every mutating camera/config route now requires admin.

```ts
// apps/api-server/src/routes/cameras.ts:492-493
// PUT /api/cameras/:id
camerasRouter.put("/:id", requireRole("admin"), async (req: Request, res: Response): Promise<void> => {
```

```ts
// apps/api-server/src/routes/config.ts:269-271
// PUT /api/config
configRouter.put("/", requireRole("admin"), async (req: Request, res: Response): Promise<void> => {
```

**H-02. `B-C5` — Consolidator races the transcoder / destroys work.**
*Source:* `AUDIT_REPORT.md` §1 (CRITICAL B-C5).
*Current proof:* candidates are restricted to finished `RAW` rows and re-checked under `FOR UPDATE` inside a transaction.

```ts
// apps/api-server/src/transcode/consolidator.ts:229-233
             AND status = 'RAW'
             AND ended_at IS NOT NULL
             AND raw_path NOT LIKE '%_merged.mp4'
           ORDER BY started_at ASC, id ASC`,
```

```ts
// apps/api-server/src/transcode/consolidator.ts:327-333
          // Guarantee that every candidate segment is still in RAW status
          const allRaw = lockedRows.length === allIds.length && lockedRows.every((r) => r.status === "RAW");
          if (!allRaw) {
            console.warn(`[Consolidator] Status changed concurrently for segments in cam${cameraId} at ${hourBucket}, rolling back and skipping.`);
            await conn.rollback();
```

**H-03. `B-H3` — Query-string tokens accepted on every route.**
*Source:* `AUDIT_REPORT.md` §1 (HIGH B-H3).
*Current proof:* the media-token middleware is applied only to `/stream` and `/download`.

```ts
// apps/api-server/src/routes/recordings.ts:12-18
// Restrict query-string tokens to /:id/stream and /:id/download (B-H3 / [PH4-03])
recordingsRouter.use((req, res, next) => {
  if (req.path.endsWith("/stream") || req.path.endsWith("/download")) {
    return authenticateMediaToken(req, res, next);
  }
  return authenticateToken(req, res, next);
});
```

**H-04. `B-H4` — MediaMTX auth hook was a credential oracle.**
*Source:* `AUDIT_REPORT.md` §1 (HIGH B-H4).
*Current proof:* rate-limited, constant-time compare, fail-closed on missing secret.

```ts
// apps/api-server/src/routes/internal.ts:33-38
function safeSecretCompare(provided?: string, expected?: string | null): boolean {
  if (!provided || !expected) return false;
  const bufA = Buffer.from(provided, "utf-8");
  const bufB = Buffer.from(expected, "utf-8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
```

**H-05. `B-M10` — “NTP sync” was only a DNS lookup.**
*Source:* `AUDIT_REPORT.md` §1 (MEDIUM B-M10).
*Current proof:* a real SNTP UDP query with a 3 s timeout now runs, and failures return 502.

```ts
// apps/api-server/src/routes/config.ts:426-436
    const dgram = await import("node:dgram");
    const socket = dgram.createSocket("udp4");
    const packet = Buffer.alloc(48);
    // LI = 0, VN = 3, Mode = 3 (client) -> 0x1B
    packet[0] = 0x1b;

    await new Promise<{ latencyMs: number }>((resolve, reject) => {
      const timer = setTimeout(() => {
        try { socket.close(); } catch {}
        reject(new Error("SNTP query timeout (3000ms)"));
      }, 3000);
```

**H-06. `B-M21` — VMAF frame-count validation was never fed reference frames.**
*Source:* `AUDIT_REPORT.md` §1 (MEDIUM B-M21).
*Current proof:* the pipeline now passes `referenceFrames`.

```ts
// apps/api-server/src/transcode/pipeline.ts:413-420
            // Run VMAF with fallback (B-M21: pass referenceFrames for frame-count validation)
            const vmafRes = await runVmafWithFallback(distSamplePath, refSamplePath, {
              ffmpegBin: "ffmpeg",
              sampleDurationSec: probeSampleSec,
              referenceFrames: refProbe.fps > 0 ? Math.round(refProbe.duration * refProbe.fps) : refProbe.frames,
              tempDir: chunkTmpDir,
              executor,
            });
```

**H-07. `F-C1` — Class toggles wiped detection.**
*Source:* `AUDIT_REPORT.md` §2 (CRITICAL F-C1).
*Current proof:* the store sends `active_classes`; the REST route explicitly accepts it and resolves it.

```ts
// apps/web-dashboard/src/stores/cameras.ts:90-96
      const res = await apiFetch(`/api/cameras/${cameraId}/classes`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          active_classes: classes,
          confidence_threshold: confThreshold,
        }),
```

```ts
// apps/api-server/src/routes/cameras.ts:718-720
  // F-C1: Support active_classes, active_class_ids, custom_class_ids, and preset_groups
  const { preset_groups, custom_class_ids, active_classes, active_class_ids, confidence_threshold } = parseResult.data;
  const rawCustomIds = active_class_ids ?? active_classes ?? custom_class_ids ?? [];
```

**H-08. `F-C2` — Password change called a nonexistent endpoint and faked success.**
*Source:* `AUDIT_REPORT.md` §2 (CRITICAL F-C2).
*Current proof:* the endpoint exists and verifies the current password; the UI now branches on `res.ok`.

```ts
// apps/api-server/src/auth/routes.ts:164-171
  const isValid = await verifyPassword(rows[0].password_hash, currentPassword);
  if (!isValid) {
    res.status(401).json({ error: "Kata sandi saat ini tidak valid" });
    return;
  }

  const hashed = await hashPassword(newPassword);
  await pool.query("UPDATE users SET password_hash = ? WHERE id = ?", [hashed, userId]);
```

**H-09. `FE-04` — Concurrent 401 refresh race.**
*Source:* `FULL_AUDIT_2026-11-03.md` FE-04.
*Current proof:* single-flight `refreshPromise`.

```ts
// apps/web-dashboard/src/stores/auth.ts:59-63
  let refreshPromise: Promise<boolean> | null = null;

  const refreshAccessToken = async (): Promise<boolean> => {
    if (refreshPromise) return refreshPromise;
    refreshPromise = (async () => {
```

**H-10. `OPS-2` — PyAV 19 killed AI reader threads via `av.AVError`.**
*Source:* `FULL_AUDIT_2026-11-03.md` OPS-2.
*Current proof:* version-tolerant alias to `FFmpegError`.

```py
# services/ai-vision-worker/src/stream_reader.py:11-16
try:  # PyAV 19 renamed AVError -> FFmpegError; keep a version-tolerant alias.
    import av as _av

    FFmpegError = _av.FFmpegError
except (ImportError, AttributeError):  # pragma: no cover - requires an ancient PyAV
    FFmpegError = Exception
```

**H-11. `V-R1` — API could not boot under Express 5 path-to-regexp.**
*Source:* `AUDIT_REPORT.md` §V.1 (V-R1).
*Current proof:* the catch-all is mounted on the `/api` prefix, not `/api/*`.

```ts
// apps/api-server/src/app.ts:83-85
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "Endpoint not found" });
  });
```

**H-12. `V-R2` — `-stimeout` does not exist in FFmpeg 8.x.**
*Source:* `AUDIT_REPORT.md` §V.1 (V-R2).
*Current proof:* the RTSP demuxer option is now `-timeout` in microseconds.

```ts
// services/media-engine/recorder/src/supervisor.ts:243-248
    const args = [
      "-hide_banner",
      "-loglevel", "warning",
      "-rtsp_transport", "tcp",
      "-timeout", "10000000",
      "-i", this.config.rtspUrl,
```

**H-13. Gemini `REC-01` — source lacked `+global_sidx`.**
*Source:* `gemini_full_audit_report.md` Top 15 #1.
*Current proof:* `+global_sidx` is present in current source (this claim is now false).

```ts
// services/media-engine/recorder/src/supervisor.ts:256-258
      "-segment_format", "mp4",
      "-segment_format_options", "movflags=+frag_keyframe+empty_moov+default_base_moof+global_sidx",
      outputPattern,
```

**H-14. Gemini `TX-01` — consolidator deletes rows and wipes AI events via `ON DELETE SET NULL`.**
*Source:* `gemini_full_audit_report.md` Top 15 #2.
*Current proof:* events, windows, and probe logs are reassigned **before** the delete, inside the same transaction.

```ts
// apps/api-server/src/transcode/consolidator.ts:352-358
          // Re-assign AI detection events, activity windows, and probe logs to primary ID
          if (otherIds.length > 0) {
            // [PH5-01] Reassign forensic AI events to primary ID before deleting other rows to prevent data loss (ON DELETE SET NULL)
            await conn.query(
              `UPDATE ai_detection_events SET recording_id = ? WHERE recording_id IN (?)`,
              [primary.id, otherIds]
            );
```

**H-15. Gemini `AI-01` — unlocked concurrent YOLO inference.**
*Source:* `gemini_full_audit_report.md` Top 15 #3.
*Current proof:* one shared `_inference_lock` wraps predict and export.

```py
# services/ai-vision-worker/src/detector.py:45-47
        self._seq_by_camera: dict[int, int] = {}
        self._inference_lock = threading.Lock()
        logger.info(
```

```py
# services/ai-vision-worker/src/detector.py:103-106
        with self._inference_lock:
            # Contiguous sequence counter per camera (Gate G2.3)
            cur_seq = self._seq_by_camera.get(camera_id, 0) + 1
            self._seq_by_camera[camera_id] = cur_seq
```

**H-16. Gemini `STR-01` — stream leaks file descriptors on aborted Range requests.**
*Source:* `gemini_full_audit_report.md` Top 15 #4.
*Current proof:* `res.on("close")` destroys the read stream in both branches.

```ts
// apps/api-server/src/routes/recordings.ts:376-383
    const stream = fs.createReadStream(targetPath, { start, end });
    stream.on("error", () => {
      if (!res.headersSent) res.status(500).end();
      stream.destroy();
    });
    res.on("close", () => {
      stream.destroy();
    });
```

**H-17. Gemini `UI-01` — download buffers multi-GB video into browser RAM.**
*Source:* `gemini_full_audit_report.md` Top 15 #8.
*Current proof:* download is a direct anchor navigation, not `res.blob()`.

```ts
// apps/web-dashboard/src/views/TimelineView.vue:862-869
    const tokenParam = authStore.token ? `&token=${encodeURIComponent(authStore.token)}` : "";
    const downloadUrl = `/api/recordings/${rec.id}/download?mode=${streamMode.value}${tokenParam}`;
    const link = document.createElement("a");
    link.href = downloadUrl;
    link.download = `Cam${rec.camera_id}_${String(rec.id)}.mp4`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
```

**H-18. Gemini `REC-02` — transient ffprobe timeout permanently marks footage `SKIPPED`.**
*Source:* `gemini_full_audit_report.md` Top 15 #12.
*Current proof:* transient errors leave the row `RECORDING` for the next reconciliation.

```ts
// services/media-engine/recorder/src/reconciler.ts:74-79
    } catch (err: any) {
      const transient = /timed out|timeout|EACCES|EMFILE|ENFILE|EBUSY|EAGAIN/i.test(err?.message || "");
      if (transient) {
        console.error(`[Reconciler] Transient probe failure for #${id}; leaving RECORDING for next reconciliation:`, err?.message || "");
        continue;
      }
```

**H-19. Gemini `NET-01` — MediaMTX webhook rate limit keyed by container IP.**
*Source:* `gemini_full_audit_report.md` Top 15 #13.
*Current proof:* the key includes forwarded client IP, action, path, and client identifier; the cap is 6000/min.

```ts
// apps/api-server/src/routes/internal.ts:41-53
const authLimiter = createRateLimiter({
  windowSec: 60,
  // HLS/LL-HLS authenticates per segment/part; MediaMTX forwards requests on behalf of clients.
  // [PH1-01] Key by forwarded client IP (req.body?.ip), action, stream path, and client identifier.
  maxRequests: 6000,
  keyPrefix: "mtx-auth",
  keyGenerator: (req) => {
    const clientIp = req.body?.ip || req.ip || req.socket.remoteAddress || "unknown";
    const action = req.body?.action || "";
    const streamPath = req.body?.path || "";
    const userOrToken = req.body?.user || (typeof req.body?.query === "string" ? req.body.query.slice(0, 32) : "");
    return `${clientIp}:${action}:${streamPath}:${userOrToken}`;
  },
});
```

**H-20. Gemini `STR-03` — suffix ranges (`bytes=-500`) rejected.**
*Source:* `gemini_full_audit_report.md` Top 15 #14.
*Current proof:* suffix ranges are parsed explicitly.

```ts
// apps/api-server/src/routes/recordings.ts:348-356
    if (parts[0] === "" && parts[1] !== undefined) {
      // Suffix range: bytes=-500 (last 500 bytes per RFC 7233)
      const suffixLength = parseInt(parts[1], 10);
      if (isNaN(suffixLength) || suffixLength <= 0) {
        res.status(416).setHeader("Content-Range", `bytes */${fileSize}`).end();
        return;
      }
      start = Math.max(0, fileSize - suffixLength);
      end = fileSize - 1;
```

### 2.2 PARTIALLY FIXED

**P-01. `B-C1/B-C2` — hardcoded secret fallbacks remain in development.**
*Source:* `AUDIT_REPORT.md` §1.
*Current state:* production is fail-closed, but non-production still returns a literal JWT secret and a literal credential key.

```ts
// apps/api-server/src/auth/service.ts:22-26
    if (process.env.NODE_ENV === "production") {
      throw new Error("JWT_SECRET environment variable is mandatory in production");
    }
    return "super-secret-jwt-key-replace-in-production-min-32-chars";
```

```ts
// apps/api-server/src/crypto/credentials.ts:16-21
  if (!rawKey) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("CREDENTIAL_KEY environment variable is mandatory in production");
    }
    // In dev / test fallback to an explicit non-zero test key
    return Buffer.from("01234567890123456789012345678901", "utf-8");
```

**P-02. `B-C3` — seeded `admin/admin123`.**
*Source:* `AUDIT_REPORT.md` §1.
*Current state:* production generates a random password; development still seeds `admin123`.

```ts
// apps/api-server/src/index.ts:66-73
        if (!defaultPass) {
          if (process.env.NODE_ENV === "production") {
            const cryptoMod = await import("node:crypto");
            defaultPass = cryptoMod.randomBytes(12).toString("base64url");
            console.warn(`[API Server] SECURITY NOTICE: Generated random initial admin password: ${defaultPass}`);
          } else {
            defaultPass = "admin123";
          }
        }
```

**P-03. `B-M12` — fabricated telemetry fallbacks remain.**
*Source:* `AUDIT_REPORT.md` §1 (MEDIUM B-M12).
*Current state:* GPU/queue values are real now, but `statfs` failure still fabricates 512 GiB total / 250 GiB free, and the CPU delta fallback is synthetic.

```ts
// apps/api-server/src/routes/stats.ts:105-114
  let totalBytes = 512 * 1024 * 1024 * 1024;
  let freeBytes = 250 * 1024 * 1024 * 1024;

  try {
    const stat = await fsp.statfs(dataDir);
    totalBytes = stat.blocks * stat.bsize;
    freeBytes = stat.bavail * stat.bsize;
  } catch {
    // fallback if statfs fails
  }
```

```ts
// apps/api-server/src/routes/stats.ts:76-78
  if (totalDelta <= 0) return Math.min(100, Math.max(1.0, Number((os.loadavg()[0] * 12.5).toFixed(1))));
  const used = Math.max(0.5, Math.min(100, 100 - (idleDelta / totalDelta) * 100));
  return Number(used.toFixed(1));
```

**P-04. `B-M13` — `system:alert` bridge.**
*Source:* `AUDIT_REPORT.md` §1 (MEDIUM B-M13).
*Current state:* the gateway now subscribes and emits, but the only client handler still writes to `console.warn`; no banner/toast exists.

```ts
// apps/api-server/src/sockets/gateway.ts:205-209
    } else if (channel === "system:alert") {
      try {
        const payload = JSON.parse(message);
        io.emit("system:alert", payload);
      } catch {
```

```ts
// apps/web-dashboard/src/stores/socket.ts:87-89
    socket.value.on("system:alert", (alert: any) => {
      console.warn("[SYSTEM ALERT]", alert);
    });
```

**P-05. `B-M20` / Gemini `TX-02` — activity-window divisor mismatch.**
*Source:* `AUDIT_REPORT.md` §V.4 item 6; `gemini_full_audit_report.md` Top 15 #5.
*Current state:* `windowDurationSec` is now passed, but as a hardcoded `20`, while the writer derives the actual window width from `PROBE_SAMPLE_SEC` (default 20, example value 10). The mismatch moved rather than disappeared.

```ts
// apps/api-server/src/transcode/pipeline.ts:343-352
      // Window selection ([PH5-02] windowDurationSec is 20s as generated by AI worker)
      const winResult = selectProbeWindow({
        chunkIndex: k,
        chunkStartSec,
        chunkDurationSec,
        sampleDurationSec: probeSampleSec,
        windowDurationSec: 20,
        smartAiSampling,
        windows: winRows as ActivityWindow[],
```

```py
# services/ai-vision-worker/src/main.py:104-107
    sample_duration_sec = int(os.getenv("PROBE_SAMPLE_SEC", "20"))
    ai_fps = float(os.getenv("AI_FPS", "10.0"))
    if sample_duration_sec <= 0 or sample_duration_sec > 3600:
        raise ValueError("PROBE_SAMPLE_SEC must be between 1 and 3600")
```

**P-06. `F-S2` / `F-S3` / `FE-02` — frontend token and HTML-sink hardening.**
*Source:* `AUDIT_REPORT.md` §2 (F-S1, F-S2, F-S3), `FULL_AUDIT_2026-11-03.md` FE-02.
*Current state:* `heroSummary` is now a text interpolation, but the chart still uses `v-html`; JWTs remain in localStorage and media URLs; download still uses a query token.

```ts
// apps/web-dashboard/src/stores/auth.ts:11
  const token = ref<string | null>(localStorage.getItem("vms_access_token"));
```

```ts
// apps/web-dashboard/src/views/HardwareMonitorView.vue:132
          <div id="ch" ref="chartContainerRef" v-html="chartSvgHtml"></div>
```

**P-07. `V-R3` / `I-H4` — dist bind-mounts / stale-build risk.**
*Source:* `AUDIT_REPORT.md` §V.1 (V-R3).
*Current state:* the compiled `dist/` appears current (typecheck passes), but compose still mounts host `dist/` over each image, so the image is not the source of truth.

```yaml
# docker-compose.yml:108-110
    volumes:
      - ./data:/data
      - ./apps/api-server/dist:/app/apps/api-server/dist:ro
```

```yaml
# docker-compose.yml:272-275
    volumes:
      - ./apps/web-dashboard/dist:/usr/share/nginx/html:ro
      - ./apps/web-dashboard/nginx.conf:/etc/nginx/conf.d/default.conf:ro
```

**P-08. `OPS-5` — healthchecks.**
*Source:* `FULL_AUDIT_2026-11-03.md` OPS-5.
*Current state:* compose uses `/readyz`, but the API image still uses the static `/healthz`, and `/healthz` never checks dependencies.

```yaml
# docker-compose.yml:111-116
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/readyz"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 5s
```

```ts
// apps/api-server/src/app.ts:43-45
  app.get("/healthz", (_req, res) => {
    res.json({ status: "ok" });
  });
```

**P-09. Gemini `SEC-01` — Socket.IO room authorization.**
*Source:* `gemini_full_audit_report.md` Top 15 #9.
*Current state:* the gateway verifies the camera exists, but any authenticated viewer may join any camera room; there is no per-camera ACL in the schema.

```ts
// apps/api-server/src/sockets/gateway.ts:68-80
      try {
        const pool = getDbPool();
        const [rows] = await pool.query<any[]>(
          "SELECT id FROM cameras WHERE id = ? LIMIT 1",
          [cameraId]
        );
        if (rows.length === 0) {
          ack?.({ ok: false, error: `Camera ${cameraId} not found` });
          return;
        }

        socket.join(`camera:${cameraId}`);
        ack?.({ ok: true, room: `camera:${cameraId}` });
```

**P-10. Gemini `AI-02` — Unix epoch used as `window_index`.**
*Source:* `gemini_full_audit_report.md` Top 15 #10.
*Current state:* the DB write overrides both `window_index` and `start_offset_sec`, so persisted rows are relative; the `ActivityIndexer` itself still computes epoch-based indices, so any other consumer of `ActivityWindow` gets wrong values.

```py
# services/ai-vision-worker/src/activity_indexer.py:102-105
        window = ActivityWindow(
            window_index=int(self._current_window_start // self.window_duration_sec),
            start_offset_sec=int(self._current_window_start),
            duration_sec=self.window_duration_sec,
```

```py
# services/ai-vision-worker/src/worker.py:110-117
                rel_window_index = int(rel_offset // self.window_duration_sec)

                payload = window.to_db_payload(
                    recording_id=rec_id,
                    segment_index=0,
                )
                payload["start_offset_sec"] = rel_offset
                payload["window_index"] = rel_window_index
```

**P-11. Gemini `SEC-02` — volatile audit trail.**
*Source:* `gemini_full_audit_report.md` Top 15 #11.
*Current state:* logs are now persisted to MySQL, but an in-memory array capped at 50 remains as a fallback, and DB failures silently fall back to it.

```ts
// apps/api-server/src/routes/config.ts:98-99
let nextAuditId = 1;
const forensicAuditLogs: ConfigAuditLog[] = [];
```

```ts
// apps/api-server/src/routes/config.ts:129-131
  if (forensicAuditLogs.length > 50) {
    forensicAuditLogs.length = 50;
  }
```

**P-12. Gemini `UI-02` — double video load on stream-mode toggle.**
*Source:* `gemini_full_audit_report.md` Top 15 #15.
*Current state:* the explicit `load()` now happens after `nextTick`, but changing `:src` already starts a load, so an explicit `load()` still forces a second request; seeking immediately after `load()` before metadata is also unreliable.

```ts
// apps/web-dashboard/src/views/TimelineView.vue:879-887
  streamMode.value = mode;
  videoError.value = null;
  await nextTick();
  if (playbackVideoRef.value) {
    const prevTime = playbackVideoRef.value.currentTime;
    playbackVideoRef.value.load();
    playbackVideoRef.value.currentTime = prevTime;
    playbackVideoRef.value.playbackRate = playbackRate.value;
    playbackVideoRef.value.play().catch(() => {});
  }
```

### 2.3 STILL UNFIXED

**U-01. `B-M7` — rate limiter INCR/EXPIRE is not atomic.**
*Source:* `AUDIT_REPORT.md` §1 (MEDIUM B-M7).
*Current proof:* `multi()` queues INCR and TTL, then a separate `expire` runs only when `current === 1` or TTL is missing. A crash between the two leaves a key without a TTL (permanent 429).

```ts
// apps/api-server/src/auth/middleware.ts:77-87
      const pipeline = redis.multi();
      pipeline.incr(key);
      pipeline.ttl(key);
      const results = await pipeline.exec();
      const current = (results?.[0]?.[1] as number) || 1;
      let ttl = (results?.[1]?.[1] as number) || -1;

      if (current === 1 || ttl === -1) {
        await redis.expire(key, windowSec);
        ttl = windowSec;
      }
```

**U-02. `F-S1` — access JWT in `localStorage`.**
*Source:* `AUDIT_REPORT.md` §2 (HIGH F-S1).
*Current proof:* token is read from and written to localStorage.

```ts
// apps/web-dashboard/src/stores/auth.ts:18-21
  const setTokens = (newAccess: string) => {
    token.value = newAccess;
    localStorage.setItem("vms_access_token", newAccess);
  };
```

**U-03. `F-S2` — JWT in media URLs.**
*Source:* `AUDIT_REPORT.md` §2 (HIGH F-S2).
*Current proof:* both stream and download append the raw access token to the query string.

```ts
// apps/web-dashboard/src/views/TimelineView.vue:635-640
const videoPlaybackUrl = computed(() => {
  if (!activeRecording.value || !isRecordingPlayable(activeRecording.value)) return "";
  const token = authStore.token || localStorage.getItem("vms_access_token") || "";
  const tokenParam = token ? `&jwt=${encodeURIComponent(token)}` : "";
  return `/api/recordings/${activeRecording.value.id}/stream?mode=${streamMode.value}${tokenParam}`;
});
```

```ts
// apps/web-dashboard/src/views/TimelineView.vue:862-863
    const tokenParam = authStore.token ? `&token=${encodeURIComponent(authStore.token)}` : "";
    const downloadUrl = `/api/recordings/${rec.id}/download?mode=${streamMode.value}${tokenParam}`;
```

**U-04. Gemini `STR-02` — synchronous filesystem calls on the request path.**
*Source:* `gemini_full_audit_report.md` Top 15 #7.
*Current proof:* `isPathSafe` is synchronous and is called both per row in listing and per Range request.

```ts
// apps/api-server/src/routes/recordings.ts:40-49
export function isPathSafe(targetPath: string): boolean {
  try {
    const resolved = path.resolve(targetPath);
    let realPath = resolved;
    if (fs.existsSync(resolved)) {
      try { realPath = fs.realpathSync(resolved); } catch {}
    }
    return ALLOWED_STORAGE_DIRS.some((allowedDir) => {
      return realPath === allowedDir || realPath.startsWith(allowedDir + path.sep);
    });
```

**U-05. `SEC-3` — containers run as root.**
*Source:* `FULL_AUDIT_2026-11-03.md` SEC-3.
*Current proof:* none of the eight Dockerfiles declares a `USER`; `apps/api-server/Dockerfile` ends with `CMD ["node", "dist/index.js"]` running as root.

```dockerfile
# apps/api-server/Dockerfile:21-28
WORKDIR /app/apps/api-server

EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=5s --retries=5 --start-period=5s \
  CMD curl -f http://localhost:3000/healthz || exit 1

CMD ["node", "dist/index.js"]
```

**U-06. `F-S5` — no CSP/HSTS on the SPA.**
*Source:* `AUDIT_REPORT.md` §2 (HIGH F-S5).
*Current proof:* nginx sets only `X-Frame-Options`, `X-Content-Type-Options`, and `Referrer-Policy`.

```nginx
# apps/web-dashboard/nginx.conf:5-8
    # Security Headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
```

---

## 3. Deep-Dive Findings

### 3.1 Phase 1 — Ingest, RTSP Proxy, MediaMTX

#### [ING-01] WHEP is advertised on loopback addresses only
- **Severity:** High
- **Component:** MediaMTX configuration
- **Status:** Active
- **Location:** `services/media-engine/mediamtx.yml:19-22`

```yaml
webrtcAddress: :8889
webrtcLocalUDPAddress: :8189
webrtcLocalTCPAddress: :8189
webrtcAdditionalHosts: [127.0.0.1, localhost]
```

**Impact.** MediaMTX generates WHEP ICE candidates for `127.0.0.1`/`localhost`. A browser on another machine cannot reach those addresses, so WebRTC playback fails off-host even though the port is published.

**Root cause.** `webrtcAdditionalHosts` was never parameterized for deployment topology and still contains the development loopback list.

**Concrete fix.** Add a `MEDIAMTX_WEBRTC_HOSTS` environment variable and template it, or set `webrtcAdditionalHosts` to the host’s LAN IP/DNS name. Keep loopback only for single-host dev.

**Verification.** From a second machine, open the dashboard Live view with WebRTC selected; the browser must report `connected` and the MediaMTX log must show a non-loopback candidate pair. Add a config test that rejects `webrtcAdditionalHosts` containing only loopback when `NODE_ENV=production`.

---

#### [ING-02] RTSP proxy is a hand-rolled protocol translator with silent failure paths
- **Severity:** Medium-High
- **Component:** `services/media-engine/rtsp-proxy/proxy.py`
- **Status:** Active (improved, still fragile)
- **Location:** `services/media-engine/rtsp-proxy/proxy.py:103-110` and `:198-212`

```py
                data = client.recv(8192)
                if not data:
                    break

                if first_packet:
                    first_packet = False
                    txt = data.decode("utf-8", errors="ignore")
                    print(f"[RTSP-Proxy] Received first packet from client {addr}: {mask_sensitive(txt[:120])!r}")
                    sys.stdout.flush()
                    cid, t_url, _ = resolve_target(txt)
```

```py
                data = cam_socket.recv(8192)
                if not data:
                    break

                if not data.startswith(b"$"):
                    # 1. Strip Digest header ONLY IF Basic is also offered (fixes Hikvision / Dahua dual-auth while preserving digest-only cameras)
                    if b"WWW-Authenticate: Digest" in data and b"WWW-Authenticate: Basic" in data:
```

**Impact.** The first client packet is assumed to be a complete RTSP request and parsed with a regex. Interleaved binary RTP is handled only when the *first byte* is `$`; a TCP coalescing boundary that splits an RTSP request or merges `$` framing with text produces malformed forwarding. Both pump threads also wrap the entire loop in `except Exception: pass`, so a persistent protocol fault looks like a closed connection with no diagnostic.

**Root cause.** The service reimplements RTSP framing/rewriting instead of using a proxy library; error handling favors silence over structured logs.

**Concrete fix.** At minimum, buffer until `\r\n\r\n` plus `Content-Length` for text RTSP messages, and track `$` interleaved frame lengths from the 4-byte header. Log and count parse failures instead of `pass`. Long term, replace with an established RTSP proxy or MediaMTX `sourceRedirect`/`runOnDemand` configuration.

**Verification.** Fuzz the proxy with split requests across `recv()` boundaries and assert byte-identical forwarding. Add an integration test using a local RTSP server that sends interleaved RTP.

---

#### [ING-03] Camera enable toggle does not restore runtime Redis/MediaMTX state
- **Severity:** Medium
- **Component:** Camera REST API
- **Status:** Active
- **Location:** `apps/api-server/src/routes/cameras.ts:465-475` (PATCH), `:597-600` (PUT)

```ts
  // Keep Redis and MediaMTX in sync for the fields the recorder/AI/proxy read.
  if (data.rtsp_url !== undefined) {
    await redis.set(`cam:${id}:rtsp_url`, data.rtsp_url);
  }
  if (data.confidence_threshold !== undefined) {
    await redis.set(`cam:${id}:conf`, String(data.confidence_threshold));
  }
  let synced = true;
  if (data.rtsp_url !== undefined) {
    synced = await syncCameraToMediaMTX(id);
  }
```

**Impact.** A camera created with `enabled: false` never gets `cam:{id}:rtsp_url` (creation only writes it when enabled) and is never added to MediaMTX. A later `PATCH { "enabled": true }` updates only the DB and publishes `camera:changed`; it does not write the Redis URL or call `syncCameraToMediaMTX`. The recorder re-reads the DB and starts FFmpeg against `rtsp://…/cam{id}`, but MediaMTX has no path and the proxy has no target URL, so the stream 404s until a process restart.

**Root cause.** Runtime resource provisioning is keyed to `rtsp_url` changes, not to the `disabled → enabled` transition.

**Concrete fix.** Treat `enabled` as a resource-lifecycle field:

```ts
const enabling = data.enabled === true && !Boolean(existing[0].enabled);
if (data.rtsp_url !== undefined || enabling) {
  const plain = data.rtsp_url ?? decryptRtspUrl(existing[0].rtsp_url_enc, deriveCredentialKey());
  await redis.set(`cam:${id}:rtsp_url`, plain);
  synced = await syncCameraToMediaMTX(id);
}
if (data.enabled === false) {
  await removeCameraFromMediaMTX(id); // optional: keep URL for fast re-enable
}
```

**Verification.** Create a disabled camera, enable it via PATCH, then `GET /v3/config/paths/get/cam{id}` from MediaMTX and `GET cam:{id}:rtsp_url` from Redis; both must exist and an RTSP session must connect without restarting the stack.

---

#### [ING-04] Plaintext camera credentials are persisted in Redis
- **Severity:** Medium-High
- **Component:** API ↔ recorder/AI/proxy contract
- **Status:** Active
- **Location:** `apps/api-server/src/routes/cameras.ts:466-468`, `:524`; `apps/api-server/src/index.ts:94-98`

```ts
  if (data.rtsp_url !== undefined) {
    await redis.set(`cam:${id}:rtsp_url`, data.rtsp_url);
  }
```

```ts
              const plain = decryptRtspUrl(Buffer.from(c.rtsp_url_enc), key);
              await redis.set(`cam:${c.id}:rtsp_url`, plain);
```

**Impact.** AES-256-GCM at rest in MySQL is undone at runtime: any process that can reach Redis (or any Redis `MONITOR`/dump) sees `rtsp://user:password@host`. The Redis port is loopback-published, but container compromise or a future misconfiguration exposes all camera credentials.

**Root cause.** The internal contract chose a plaintext Redis value for simplicity; no Redis ACL or encrypted envelope is used.

**Concrete fix.** Store the encrypted buffer in Redis and decrypt inside the trusted consumers with `CREDENTIAL_KEY`, or issue short-lived signed proxy URLs instead of credentials. Add a dedicated Redis ACL user with `~cam:*:rtsp_url` read-only and no `KEYS`/`CONFIG`.

**Verification.** `redis-cli GET cam:1:rtsp_url` must not contain `://user:pass@`; the recorder/proxy integration test must still connect.

---

### 3.2 Phase 2 — Recording Engine

#### [REC-01] `ffprobe` `N/A` / zero duration can permanently discard recoverable footage
- **Severity:** High
- **Component:** recorder probe + finalize/reconcile
- **Status:** Active
- **Location:** `services/media-engine/recorder/src/probe.ts:38-40`; `recorder.ts:149-166`; `reconciler.ts:33-72`

```ts
  // Duration can be in format or stream
  const rawDuration = parseFloat(format?.duration || stream?.duration || "0");
  const durationSec = isNaN(rawDuration) ? 0 : rawDuration;
```

```ts
      const transient = /timed out|timeout|EACCES|EMFILE|ENFILE|EBUSY|EAGAIN/i.test(probeErr.message || "");
      if (transient) {
        console.error(`[Recorder:${cameraId}] Transient probe failure for #${recordingId}; leaving RECORDING:`, probeErr.message);
        return;
      }
      try {
        await this.options.pool.query(
          "UPDATE recordings SET status = 'SKIPPED', duration_sec = 0, failure_reason = ? WHERE id = ? AND status = 'RECORDING'",
```

**Impact.** Fragmented MP4 files produced during a crash can legitimately report `duration=N/A` while still containing readable frames. `parseFloat("N/A")` yields `NaN`, then `0`; `recorder.ts` and the reconciler interpret `durationSec <= 0` as “empty fragment” and set `SKIPPED`, so the footage never becomes playable or compressible. This is exactly the failure mode the reconciler was meant to recover.

**Root cause.** “Probe could not determine duration” is conflated with “the file has no content.”

**Concrete fix.** Return a discriminated result (`{ ok: true, durationSec } | { ok: false, reason }`) and treat `N/A` as unknown, not zero. For unknown duration, run `ffprobe -count_frames` or a decode-to-null test; only mark `SKIPPED` when the decode/stream probe proves there are no decodable frames.

**Verification.** Feed a fragmented MP4 with a missing/`N/A` `mvhd` duration; the row must remain `RAW` after finalize (or be recovered by the reconciler) and `ffmpeg -v error -i file -f null -` must succeed.

---

#### [REC-02] `r_frame_rate` is used instead of `avg_frame_rate` for VFR sources
- **Severity:** Medium
- **Component:** recorder probe
- **Status:** Active
- **Location:** `services/media-engine/recorder/src/probe.ts:42-51`

```ts
  // FPS can be "25/1" or "30000/1001" or float
  let fps = 25.0;
  if (stream?.r_frame_rate) {
    const parts = stream.r_frame_rate.split("/");
    if (parts.length === 2 && parseFloat(parts[1]) > 0) {
      fps = parseFloat(parts[0]) / parseFloat(parts[1]);
    } else {
      fps = parseFloat(stream.r_frame_rate) || 25.0;
    }
  }
```

**Impact.** `r_frame_rate` is the least common multiple of frame durations and can overstate the real average for variable-frame-rate cameras. That value is written to `recordings.fps` and later used to estimate reference frame counts for VMAF validation, so gating can compare against the wrong denominator.

**Root cause.** The transcode pipeline was updated to prefer `avg_frame_rate`, but the recorder was not.

**Concrete fix.** Prefer `avg_frame_rate`, fall back to `r_frame_rate`, then to `25`; return `fpsSource` for diagnostics.

**Verification.** Probe a VFR fixture where `r_frame_rate != avg_frame_rate`; `recordings.fps` must equal the average.

---

#### [REC-03] Camera operation lock map never deletes its entry
- **Severity:** Low
- **Component:** recorder service
- **Status:** Active
- **Location:** `services/media-engine/recorder/src/recorder.ts:30-39`

```ts
  private withCameraLock<T>(cameraId: number, fn: () => Promise<T>): Promise<T> {
    const previous = (this.cameraOps.get(cameraId) as Promise<unknown> | undefined) ?? Promise.resolve();
    const next = previous.then(fn, fn);
    this.cameraOps.set(
      cameraId,
      next.finally(() => {
        if (this.cameraOps.get(cameraId) === next) this.cameraOps.delete(cameraId);
      })
    );
    return next;
  }
```

**Impact.** The value stored in `cameraOps` is the promise returned by `next.finally(...)`, not `next`, so the identity check is never true and the entry is never removed. The map is bounded by the camera count, so this is a small retention leak, but it also leaves a permanently resolved promise chained to every future operation.

**Root cause.** The cleanup compares against the wrong promise identity.

**Concrete fix.**

```ts
const tracked = next.finally(() => {
  if (this.cameraOps.get(cameraId) === tracked) this.cameraOps.delete(cameraId);
});
this.cameraOps.set(cameraId, tracked);
return next;
```

**Verification.** After `registerCamera` resolves, `cameraOps.size` must be `0`; add a unit test.

---

### 3.3 Phase 3 — AI Vision & Activity Indexing

#### [AI-01] Activity windows are attached to the latest recording without a containment check
- **Severity:** Critical
- **Component:** AI vision worker
- **Status:** Active
- **Location:** `services/ai-vision-worker/src/worker.py:87-108`

```py
                rec_id = self.current_recording_id
                rec_started_at = None
                with self.db_connection.cursor() as cursor:
                    cursor.execute(
                        "SELECT id, UNIX_TIMESTAMP(started_at) as start_ts FROM recordings WHERE camera_id = %s ORDER BY id DESC LIMIT 1",
                        (self.camera_id,)
                    )
                    row = cursor.fetchone()
                    if row:
                        rec_id = row["id"] if isinstance(row, dict) else row[0]
                        rec_started_at = row.get("start_ts") if isinstance(row, dict) else (row[1] if len(row) > 1 else None)
                        self.current_recording_id = rec_id
```

**Impact.** Every closed activity window is assigned to whatever recording row was inserted most recently for that camera, regardless of whether the window’s wall-clock time falls inside `[started_at, ended_at]`. After a segment rollover, frames captured during the previous segment can be written into the new recording’s first windows (and vice versa during recorder lag), corrupting the AI peak-selection input and the forensic timeline. `current_recording_id` is initialized to `None` and is never set by the recorder, so this SELECT is the only assignment path.

**Root cause.** The worker has no recording-boundary event. It approximates “current recording” with “latest DB row,” which is not the same thing across retries, restarts, consolidation, and delayed inserts.

**Concrete fix.** Publish `recording:status` with `recording_id`, `started_at`, and `ended_at` (the recorder already publishes on start/finalize). In the worker, track an interval per camera and only accept a window when `window_start >= started_at && window_end <= ended_at`; otherwise buffer or drop with a counted metric. Better: have the recorder write `recording_id` into the Redis stream keyed by segment, and have the AI worker read it per frame.

**Verification.** Simulate a segment rollover at `T`; windows with `start_offset < T` must never be inserted under the new `recording_id`. Add a unit test with two overlapping recording rows and a clock-controlled window.

---

#### [AI-02] MySQL connection has no socket timeouts
- **Severity:** High
- **Component:** AI vision worker startup / shared DB connection
- **Status:** Active
- **Location:** `services/ai-vision-worker/src/main.py:40-48`

```py
    return pymysql.connect(
        host=host,
        port=port,
        user=user,
        password=password,
        database=database,
        cursorclass=pymysql.cursors.DictCursor,
        autocommit=True,
    )
```

**Impact.** A half-open TCP connection or a MySQL stall can block a worker thread indefinitely inside `cursor.execute`/`commit`. Because all camera pipelines share this one connection under `_db_lock`, one stalled query freezes activity and event writes for every camera. The heartbeat thread is separate, so the container still reports healthy while forensic data silently stops.

**Root cause.** `pymysql` defaults to no read/write timeout; the retry loop only covers connection establishment.

**Concrete fix.**

```py
return pymysql.connect(
    ...,
    connect_timeout=5,
    read_timeout=10,
    write_timeout=10,
    autocommit=True,
)
```

Also add a per-camera connection pool or a single writer queue instead of one shared connection.

**Verification.** Point the worker at a TCP proxy that accepts but never responds; every DB operation must raise within ~10 s, the healthcheck must go unhealthy, and the camera pipeline must recover when the proxy is removed.

---

#### [AI-03] `PROBE_SAMPLE_SEC` conflates “VMAF sample length” and “activity window width”
- **Severity:** High
- **Component:** cross-service contract
- **Status:** Active
- **Location:** `services/ai-vision-worker/src/main.py:104,151`; `apps/api-server/src/transcode/pipeline.ts:231,343-352`

```py
    sample_duration_sec = int(os.getenv("PROBE_SAMPLE_SEC", "20"))
```

```py
        window_duration_sec=sample_duration_sec,
```

```ts
    probeSampleSec = Number(process.env.PROBE_SAMPLE_SEC) || 20,
```

```ts
      // Window selection ([PH5-02] windowDurationSec is 20s as generated by AI worker)
      const winResult = selectProbeWindow({
        chunkIndex: k,
        chunkStartSec,
        chunkDurationSec,
        sampleDurationSec: probeSampleSec,
        windowDurationSec: 20,
```

**Impact.** The AI worker writes activity windows whose width equals `PROBE_SAMPLE_SEC` (default 20, shipped example 10). The pipeline assumes 20 s windows when computing `expectedRows` and coverage, while simultaneously using `PROBE_SAMPLE_SEC` as the number of seconds to extract for VMAF. With `PROBE_SAMPLE_SEC=10`, the pipeline expects half as many rows as actually exist (coverage inflates, so it may select a window that leaves part of the sample uncovered), and `sampleStartSec` is chosen from a window whose width no longer matches the sample. Smart probing output becomes inconsistent, and changing the probe length silently changes the forensic indexing granularity.

**Root cause.** One environment variable was reused for two independent dimensions. The comment in `pipeline.ts` documents the assumption instead of enforcing it.

**Concrete fix.** Introduce `ACTIVITY_WINDOW_SEC` (AI writer and pipeline reader) and keep `PROBE_SAMPLE_SEC` for the VMAF sample length. Pass `windowDurationSec: Number(process.env.ACTIVITY_WINDOW_SEC) || 20` into `selectProbeWindow`. Add a startup assertion that `PROBE_SAMPLE_SEC <= ACTIVITY_WINDOW_SEC`.

**Verification.** Run with `PROBE_SAMPLE_SEC=10`, `ACTIVITY_WINDOW_SEC=20`; inspect `recording_activity_windows.duration_sec` (must be 20) and the selected `sampling_mode` (must reach `ai_peak` when coverage is complete). Add a contract test that fails if the two envs diverge in the compose files.

---

#### [AI-04] Consumer thread dies on unexpected exception types
- **Severity:** Medium
- **Component:** AI vision worker
- **Status:** Active
- **Location:** `services/ai-vision-worker/src/worker.py:261-275`

```py
    def _consumer_loop(self) -> None:
        """Consumer thread: pops decoded frames from bounded queue and processes them."""
        while not self._stop_event.is_set():
            try:
                timestamp, frame = self.frame_queue.get(timeout=1.0)
                self.process_single_frame(frame, timestamp)
            except TimeoutError:
                # Check for timed out windows when no frames arrive
                now = time.time()
                for win in self.activity_indexer.check_closed_windows(now):
                    self.flush_activity_window(win)
            except (ValueError, TypeError, OSError, RuntimeError) as exc:
                if self._stop_event.is_set():
                    break
                logger.error("Error in consumer loop for camera %d: %s", self.camera_id, exc)
```

**Impact.** `flush_activity_window`/`flush_detection_event` catch `pymysql.MySQLError` internally, but any other exception (e.g., `KeyError` from a malformed row, `AttributeError`, `MemoryError`, `redis.RedisError` outside the narrow publish catch) escapes and terminates the consumer thread. The reader thread keeps decoding and filling the queue, which drops frames, and the manager never restarts the consumer — detection is silently dead for that camera while the process looks healthy.

**Root cause.** The loop catches a specific list instead of isolating per-frame failures and supervising the thread.

**Concrete fix.** Wrap each frame in `try/except Exception` with `logger.exception`, keep the loop alive, and increment a `consumer_errors` counter exposed in the heartbeat. Add a manager-level watchdog that restarts a dead pipeline (both reader and consumer).

**Verification.** Inject a detector stub that raises `KeyError` every 100th frame; the consumer must log and continue, and `ai:heartbeat` must show the camera still listed with a rising error count.

---

### 3.4 Phase 4 — Playback & HTTP Streaming

#### [PB-01] Recording list blocks the event loop with per-row synchronous filesystem calls
- **Severity:** High
- **Component:** recordings API
- **Status:** Active
- **Location:** `apps/api-server/src/routes/recordings.ts:106-118`

```ts
  const safeRecordings = rows.map((r) => {
    const rawOk = Boolean(r.raw_path && isPathSafe(r.raw_path) && fs.existsSync(r.raw_path));
    const compOk = Boolean(
      r.compressed_path && isPathSafe(r.compressed_path) && fs.existsSync(r.compressed_path)
    );
    const { raw_path, compressed_path, ...rest } = r;
    return {
      ...rest,
      has_raw: rawOk,
      has_compressed: compOk,
      playable: (r.status === "RAW" || r.status === "COMPLETED") && (rawOk || compOk),
    };
  });
```

**Impact.** `isPathSafe` performs `existsSync` + `realpathSync`, and the expression then performs another `existsSync`; each row can trigger up to six synchronous syscalls. With `limit=100` this is hundreds of blocking calls on the single Node event loop, delaying every other request and Socket.IO heartbeat. On a cold NFS/bind mount it can take seconds, and the timeline request timeouts cascade.

**Root cause.** Playability is computed from the filesystem at read time instead of being maintained as durable state.

**Concrete fix.** Use `fsp.access`/`fsp.stat` in `Promise.all` with a bounded concurrency (e.g., 8), and stop calling the synchronous `isPathSafe` per row. Better: persist `has_raw`/`has_compressed`/`playable` on the recording row (or a small `recording_files` table) and update it on finalize, transcode, and deletion. Cache negative lookups for a few seconds.

**Verification.** Load `/api/recordings?limit=100` with `NODE_OPTIONS=--trace-sync-io`; no sync FS calls should appear. Measure p95 latency before/after with a 100-row fixture.

---

#### [PB-02] The API synthesizes “forensic” activity windows
- **Severity:** High
- **Component:** recordings API
- **Status:** Active
- **Location:** `apps/api-server/src/routes/recordings.ts:221-224`, `:260-269`

```ts
  const durationSec = Math.max(10, recording.duration_sec || 60);
  const windowSize = 5; // 5s buckets
  const totalWindows = Math.ceil(durationSec / windowSize);
  const synthesizedWindows: any[] = [];
```

```ts
    synthesizedWindows.push({
      window_index: w,
      start_offset_sec: wStartSec,
      person_count: personCount,
      vehicle_count: vehicleCount,
      pet_count: petCount,
      other_count: otherCount,
      frames_processed: 20,
      weighted_activity_score: Number(score.toFixed(1)),
    });
```

**Impact.** When `recording_activity_windows` is empty (worker down, old recording, misattribution), the endpoint invents a complete 5-second window series and claims `frames_processed: 20` for every bucket. The UI then renders activity bars that look like detector output but are derived only from sparse events (or all zeros). This is forensic data fabrication in a system whose value proposition is evidentiary accuracy. It also conflicts with the AI worker’s actual window width (`PROBE_SAMPLE_SEC`).

**Root cause.** A UI convenience fallback was added to avoid an empty timeline and was never labeled as derived/estimated.

**Concrete fix.** Return `windows: []` plus `windows_source: "unavailable"` when the real table has no rows. If a derived visualization is required, mark each bucket `source: "derived_from_events"` and do not invent `frames_processed`; expose it as a separate series.

**Verification.** Point the API at a recording with zero activity rows; response must contain an explicit empty/unavailable marker, and the UI must render “activity index unavailable,” not synthetic bars.

---

#### [PB-03] `isPathSafe` does synchronous realpath on every Range request
- **Severity:** Medium-High
- **Component:** recordings streaming
- **Status:** Active
- **Location:** `apps/api-server/src/routes/recordings.ts:40-49`, `:325-329`

```ts
export function isPathSafe(targetPath: string): boolean {
  try {
    const resolved = path.resolve(targetPath);
    let realPath = resolved;
    if (fs.existsSync(resolved)) {
      try { realPath = fs.realpathSync(resolved); } catch {}
    }
    return ALLOWED_STORAGE_DIRS.some((allowedDir) => {
      return realPath === allowedDir || realPath.startsWith(allowedDir + path.sep);
    });
```

```ts
  // Gate G3.8: Path traversal defense
  if (!isPathSafe(targetPath)) {
    res.status(403).json({ error: "Access denied: file outside permitted storage path" });
    return;
  }
```

**Impact.** Every byte-range request from a seeking browser runs a blocking `existsSync`/`realpathSync` before the stream is created. Chromium can issue dozens to hundreds of ranges per seek; under concurrent viewers this serializes on the event loop and inflates seek latency. It also makes each range do a DB query + stat + sync realpath, which is unnecessary once a recording path has been validated at write time.

**Root cause.** Path validation is repeated on the hot path instead of being enforced when the path enters the database.

**Concrete fix.** Validate and canonicalize `raw_path`/`compressed_path` once at insert/finalize time; store the canonical path. On the stream path, compare the stored path against allowed roots with `path.resolve` (no FS) or use an async `fsp.realpath` guarded by a small per-path cache. Keep `isPathSafe` for write-time validation.

**Verification.** `--trace-sync-io` must be clean during a 60-range seek test; p95 time-to-first-byte should drop.

---

#### [PB-04] JWT in stream/download URLs leaks through nginx logs and browser history
- **Severity:** High
- **Component:** dashboard ↔ nginx ↔ API
- **Status:** Active
- **Location:** `apps/web-dashboard/src/views/TimelineView.vue:635-640`, `:862-863`; `apps/api-server/src/auth/middleware.ts:17-21`

```ts
  const token = authStore.token || localStorage.getItem("vms_access_token") || "";
  const tokenParam = token ? `&jwt=${encodeURIComponent(token)}` : "";
  return `/api/recordings/${activeRecording.value.id}/stream?mode=${streamMode.value}${tokenParam}`;
```

```ts
    const tokenParam = authStore.token ? `&token=${encodeURIComponent(authStore.token)}` : "";
    const downloadUrl = `/api/recordings/${rec.id}/download?mode=${streamMode.value}${tokenParam}`;
```

```ts
    const queryToken = allowQueryTokens
      ? (typeof req.query.jwt === "string" ? req.query.jwt : null) ||
        (typeof req.query.token === "string" ? req.query.token : null)
      : null;
    const token = headerToken || queryToken;
```

**Impact.** The access token appears in the nginx access log (default combined format logs `$request` including query), browser history, and any Referer header sent by the page. Anyone with log access can replay the token for its 15-minute lifetime. The token is also in `localStorage`, so any XSS exfiltrates it. This directly contradicts the httpOnly refresh-cookie hardening.

**Root cause.** The `<video>` element cannot set an Authorization header, and instead of issuing a short-lived path-scoped ticket, the implementation reuses the access token in the URL.

**Concrete fix.** Issue a per-recording, per-session media ticket (e.g., HMAC-signed `recording_id + user_id + exp`, 60 s TTL, single-use) and put only that ticket in the URL. Keep access tokens in memory; use the httpOnly refresh cookie for renewal. Add `Referrer-Policy: no-referrer` and redact `jwt`/`token` query params in nginx logs.

**Verification.** nginx access logs must contain no JWT; replaying a captured media URL after 60 s must return 401/403 while the user’s session still works.

---

#### [PB-05] `preload="auto"` downloads large recordings before the user presses play
- **Severity:** Low-Medium
- **Component:** Timeline player
- **Status:** Active
- **Location:** `apps/web-dashboard/src/views/TimelineView.vue:186-193`

```html
        <video
          v-if="videoPlaybackUrl"
          ref="playbackVideoRef"
          class="video-el"
          :style="timelineVideoStyle"
          playsinline
          preload="auto"
          :src="videoPlaybackUrl"
```

**Impact.** Selecting an hour-long raw segment causes the browser to start fetching aggressively even when the user is only browsing the timeline. On metered or slow links this wastes bandwidth and competes with the actual playback range requests.

**Root cause.** `preload="auto"` is a default copied from a short-clip player.

**Concrete fix.** Use `preload="metadata"` and start loading on `play`/seek intent. Combine with `#t=` fragment or a server-side poster if a thumbnail is needed.

**Verification.** Select a 1-hour recording without pressing play; network panel must show only metadata/range requests, not sustained multi-MB transfer.

---

### 3.5 Phase 5 — Compression, VMAF, Consolidation

#### [TX-01] Final verification never re-checks VMAF on the merged artifact
- **Severity:** Medium-High
- **Component:** transcode pipeline
- **Status:** Active
- **Location:** `apps/api-server/src/transcode/pipeline.ts:582-594`, `:629-635`, `:655-664`

```ts
    // 5. Verification Phase (Spec §8.6)
    await transitionRecordingStatus(pool, recordingId, "VERIFYING", {
      compressed_path: partialFinalPath,
    });

    // Check 1: ffprobe readable & duration within ±1s (or ±0.5%)
    const compProbe = await probeMedia(partialFinalPath);
    const durationDelta = Math.abs(compProbe.duration - totalDurationSec);
    const maxAllowedDelta = Math.max(1.0, totalDurationSec * 0.005);

    if (durationDelta > maxAllowedDelta) {
      throw new Error(`Duration check failed: raw ${totalDurationSec}s vs compressed ${compProbe.duration}s (delta ${durationDelta}s > ${maxAllowedDelta}s)`);
    }
```

```ts
    // Check 4: Sample re-check for each chunk vs raw sample
    let allChunksGateMet = true;
    for (const chunk of chunkResults) {
      if (!chunk.gateMet) {
        allChunksGateMet = false;
      }
    }
```

**Impact.** The only quality evidence recorded for the final file is the per-chunk probe result captured *before* concatenation. If concat drops/reorders frames, picks the wrong stream, or the final encode’s rate control diverges, the recording is still marked `COMPLETED` with `quality_gate_met` based on samples. There is no full-file or post-concat VMAF measurement, despite `Spec §8.6` being cited as the verification phase.

**Root cause.** Verification was implemented as container/decode checks plus reuse of pre-concat chunk gates.

**Concrete fix.** After concat, extract a deterministic sample (e.g., first/middle/last 10 s, or a stratified sample across chunks), run VMAF against the raw, and require the configured target before setting `quality_gate_met=1`. Store the post-concat score separately from the per-chunk scores.

**Verification.** Corrupt one concat input (e.g., swap segment order) and confirm the final verification fails or the quality flag is false. Add an integration test asserting a final VMAF row exists for a completed recording.

---

#### [TX-02] `NaN` duration passes the final duration check
- **Severity:** Medium
- **Component:** transcode pipeline
- **Status:** Active
- **Location:** `apps/api-server/src/transcode/pipeline.ts:588-594`

```ts
    const compProbe = await probeMedia(partialFinalPath);
    const durationDelta = Math.abs(compProbe.duration - totalDurationSec);
    const maxAllowedDelta = Math.max(1.0, totalDurationSec * 0.005);

    if (durationDelta > maxAllowedDelta) {
      throw new Error(`Duration check failed: raw ${totalDurationSec}s vs compressed ${compProbe.duration}s (delta ${durationDelta}s > ${maxAllowedDelta}s)`);
    }
```

**Impact.** `probeMedia` uses `parseFloat(... || "0")`; if ffprobe emits `N/A`, `duration` is `NaN`. `Math.abs(NaN - x)` is `NaN`, and `NaN > maxAllowedDelta` is `false`, so the check is skipped and a corrupt/unindexed output proceeds to `COMPLETED`. The same `probeMedia` is used for the raw duration fallback at line 316, where `NaN > 0` is also false, so `rec.duration_sec || 60` is used, potentially fabricating a 60 s duration.

**Root cause.** No `Number.isFinite` guard on probe results.

**Concrete fix.**

```ts
if (!Number.isFinite(compProbe.duration) || compProbe.duration <= 0) {
  throw new Error("Compressed output has no readable duration");
}
if (!Number.isFinite(totalDurationSec) || totalDurationSec <= 0) {
  throw new Error("Raw input has no readable duration");
}
```

**Verification.** Feed an MP4 whose `mvhd.duration` is zero/`N/A`; pipeline must fail with a clear error, not complete.

---

#### [TX-03] System `compression.preferredEncoder` is shadowed by the camera column
- **Severity:** Medium
- **Component:** transcode pipeline / configuration UI
- **Status:** Active
- **Location:** `apps/api-server/src/transcode/pipeline.ts:264-286`

```ts
    // Fetch system-configured compression settings if available
    let configuredEncoder = "";
    let configuredPreset = "";
    try {
      const [cfgRows] = await pool.query<any[]>(
        "SELECT config_value FROM system_config WHERE config_key = 'compression' LIMIT 1"
      );
```

```ts
    const encoder = rec.preferred_encoder || configuredEncoder || "av1_nvenc";
    const encoderPreset = resolveEncoderPreset(encoder, configuredPreset);
```

**Impact.** `cameras.preferred_encoder` is `NOT NULL DEFAULT 'av1_nvenc'` (migration 001), so `rec.preferred_encoder` is always a non-empty string. The system-level `compression.preferredEncoder` selected in Configuration → Compression is therefore never used unless the camera row is null (it cannot be). Operators change the setting, the API returns success and publishes `system:config_changed`, and nothing changes. Only `encoderPreset` is honored.

**Root cause.** Precedence is inverted: the per-camera value is treated as an override even when it is only the default.

**Concrete fix.** Either (a) make `cameras.preferred_encoder` nullable and use `COALESCE(c.preferred_encoder, cfg)`, or (b) define explicit precedence: camera override only when the user set it (add `preferred_encoder_overridden`), otherwise system config, otherwise default.

**Verification.** Set system `preferredEncoder=libx265` on a camera whose column is `av1_nvenc`; the pipeline’s encoder log/ffmpeg args must use `libx265` (or the UI must state that per-camera overrides win and hide the global control).

---

#### [TX-04] `avgVmafMean` is an unweighted mean of chunk means
- **Severity:** Medium
- **Component:** transcode metrics
- **Status:** Active
- **Location:** `apps/api-server/src/transcode/pipeline.ts:641-648`

```ts
    // Calculate aggregated metrics
    const minOptimalCq = Math.min(...chunkResults.map((c) => c.optimalCq));
    const avgVmafMean = Number(
      (chunkResults.reduce((acc, c) => acc + c.vmafMean, 0) / chunkResults.length).toFixed(2)
    );
    const minVmafP25 = Number(
      Math.min(...chunkResults.map((c) => c.vmafP25)).toFixed(2)
    );
```

**Impact.** Every chunk contributes equally regardless of duration. The final chunk is typically partial (the last `chunkDurationSec` is capped by the remaining duration), so a 10-second tail carries the same weight as a 600-second chunk. The reported `vmaf_mean` can be biased by short chunks and no longer represents the recording. The gate uses this value for alerts/reporting.

**Root cause.** Arithmetic mean of per-chunk means instead of a duration-weighted mean or a frame-weighted mean.

**Concrete fix.** Weight by `chunk.durationSec` (or `framesScored` if available) and compute the pooled P25 from per-chunk quantiles only approximately; for exactness, store frame scores and aggregate.

**Verification.** Compare against a frame-weighted VMAF on a fixture with a long and a short chunk; the reported mean must match within tolerance.

---

#### [TX-05] `ai_engine` and `security` configuration sections are not consumed by any service
- **Severity:** Medium
- **Component:** configuration contract
- **Status:** Active
- **Location:** `apps/api-server/src/routes/config.ts:357-363`; `services/ai-vision-worker/src/main.py:57-58`; `apps/api-server/src/auth/service.ts:32-33`

```ts
    // Publish to redis so services can react dynamically
    try {
      const redis = getRedisClient();
      await redis.publish("system:config_changed", JSON.stringify(validatedUpdates));
    } catch {
      // non-fatal
    }
```

```py
    pubsub = redis_client.pubsub()
    pubsub.subscribe("camera:changed")
```

```ts
const ACCESS_EXPIRES_SEC = Number(process.env.JWT_ACCESS_EXPIRES_SEC) || 900; // 15 mins
const REFRESH_EXPIRES_SEC = Number(process.env.JWT_REFRESH_EXPIRES_SEC) || 604800; // 7 days
```

**Impact.** The UI exposes `ai_engine.inferenceFps`, `ai_engine.confidenceThreshold`, and `security.jwtAccessExpiryMin`/`jwtRefreshExpiryDays`, validates them, persists them, and reports success. No subscriber applies them: the AI worker subscribes only to `camera:changed`, and JWT lifetimes are read once from env at module load. The recorder applies only `recording.segmentDurationMin`. This is a no-op configuration surface with security implications (operators believe they shortened token lifetimes).

**Root cause.** The config schema and UI were built ahead of the service-side consumers; there is no shared config bus contract.

**Concrete fix.** Either wire each section to its consumer (subscribe to `system:config_changed`, validate, hot-apply) or remove the controls from the UI until implemented. For JWT expiry, read the values at token-signing time from a cached config store, not module load.

**Verification.** Change `jwtAccessExpiryMin` to 5, log in, decode the token: `exp - iat` must be 300 s. Change `ai_engine.inferenceFps`, inspect worker logs/telemetry for the new target.

---

### 3.6 Phase 6 — Security, Telemetry, Docker

#### [SEC-01] SPA security headers omit CSP and HSTS
- **Severity:** Medium
- **Component:** nginx
- **Status:** Active
- **Location:** `apps/web-dashboard/nginx.conf:5-8`

```nginx
    # Security Headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
```

**Impact.** Without CSP, any injected script (including via a future `v-html` regression — one still exists in `HardwareMonitorView.vue:132`) can exfiltrate the access token from `localStorage`. Without HSTS, a browser can be downgraded to HTTP on first visit, exposing credentials and tokens. `Referrer-Policy` is `strict-origin-when-cross-origin`, which still sends the origin to third parties (though not the query string).

**Root cause.** Headers were partially added; CSP/HSTS were deferred.

**Concrete fix.** Add a strict CSP (`default-src 'self'; connect-src 'self' ws: wss:; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'` as a baseline), HSTS only when HTTPS is terminated, and `Referrer-Policy: no-referrer` for media routes. Remember nginx `add_header` inheritance: repeat headers in every `location` that defines its own `add_header`.

**Verification.** `curl -I https://host/` shows `Content-Security-Policy` and `Strict-Transport-Security`; a CSP report-only run produces no violations on the main views.

---

#### [SEC-02] Containers run as root
- **Severity:** Medium
- **Component:** all Dockerfiles
- **Status:** Active
- **Location:** `apps/api-server/Dockerfile:21-28` (representative; no Dockerfile declares `USER`)

```dockerfile
WORKDIR /app/apps/api-server

EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=5s --retries=5 --start-period=5s \
  CMD curl -f http://localhost:3000/healthz || exit 1

CMD ["node", "dist/index.js"]
```

**Impact.** A container escape or RCE runs as UID 0 inside the container, with the ability to write mounted volumes (`./data` is mounted read-write into API/recorder/transcode), modify `dist/`, and potentially exploit kernel/container misconfigurations. The web image (nginx) also runs its master as root.

**Root cause.** No `USER` directive and no `--user`/`user:` override in compose.

**Concrete fix.** Create a dedicated non-root user in each image, `chown` the app/data paths, and add `user: "10001:10001"` in compose. For nginx, use `nginxinc/nginx-unprivileged` or configure a non-root listen port. Mount `dist/` read-only (already) and make `./data` owned by the service UID.

**Verification.** `docker exec <container> id -u` must be non-zero; recorder must still write segments and healthchecks must pass.

---

#### [SEC-03] Compose bind-mounts host `dist/` over images
- **Severity:** Medium-High
- **Component:** deployment reproducibility
- **Status:** Active
- **Location:** `docker-compose.yml:108-110`, `:146-148`, `:197-199`, `:272-275`

```yaml
    volumes:
      - ./data:/data
      - ./apps/api-server/dist:/app/apps/api-server/dist:ro
```

```yaml
    volumes:
      - ./data:/data
      - ./services/media-engine/recorder/dist:/app/services/media-engine/recorder/dist:ro
```

**Impact.** The image build copies `dist/` (`apps/api-server/Dockerfile:19`), but compose immediately replaces it with the host directory. A deployment can therefore run code that was never built into the image, and a clean checkout without a prior build runs stale or missing code. It also makes image scanning/signing meaningless: the running bytes are host artifacts. This is the exact mechanism behind the historical `V-R3` “none of the recorder fixes are running” incident.

**Root cause.** Bind mounts were added for fast iteration and never removed for production.

**Concrete fix.** Remove the `dist/` mounts from `docker-compose.yml`; keep them only in an explicit `docker-compose.dev.yml` override with a watch/build workflow. Add a CI check that the image’s `dist` hash matches the build output.

**Verification.** Build images from a clean checkout and run compose without host `dist/`; the app must start and `/readyz` must pass. `docker exec ... sha256sum dist/index.js` must equal the image layer hash.

---

#### [SEC-04] Audit-log persistence silently degrades to a 50-item memory buffer
- **Severity:** Medium
- **Component:** config audit trail
- **Status:** Active
- **Location:** `apps/api-server/src/routes/config.ts:98-99`, `:124-141`, `:402-418`

```ts
let nextAuditId = 1;
const forensicAuditLogs: ConfigAuditLog[] = [];
```

```ts
  } catch (err: any) {
    console.warn(`[AuditLog] Failed to insert audit log to DB: ${err.message}`);
  }
```

```ts
  } catch {}
  res.json({ success: true, logs: forensicAuditLogs });
```

**Impact.** If the `system_audit_logs` insert fails (DB outage, schema drift, permissions), the route still reports the config change as successful and stores the record only in memory. The GET endpoint returns `success: true` with the in-memory fallback and no indication that persistence failed. A restart destroys the evidence, and an operator cannot distinguish “no audit events” from “audit persistence is broken.”

**Root cause.** Audit writes are best-effort and the fallback is indistinguishable from success.

**Concrete fix.** Make the audit insert part of the config transaction (or a durable outbox), and return `audit_persisted: false` with a warning when it fails. Do not silently cap forensic records; use a bounded local spool with a metric/alerts. The GET should expose `source: "db" | "memory"`.

**Verification.** Revoke INSERT on `system_audit_logs`; a config PUT must either fail or clearly report degraded auditing, and the UI must surface it.

---

#### [SEC-05] Hardware monitor re-renders a `v-html` SVG every 2 seconds
- **Severity:** Low-Medium
- **Component:** dashboard performance / XSS surface
- **Status:** Active
- **Location:** `apps/web-dashboard/src/views/HardwareMonitorView.vue:132`, `:681-694`, `:702-729`

```html
          <div id="ch" ref="chartContainerRef" v-html="chartSvgHtml"></div>
```

```ts
  chartSvgHtml.value =
    `<svg viewBox="0 0 ${w} ${h}" style="width:100%;height:240px;overflow:visible;color:${m.color}">` +
      `<defs>` +
```

```ts
const updateTelemetryAndChart = async () => {
  try {
    await telemetryStore.fetchStats();
  } catch {
    // Keep running
  }
  renderChart();
};
```

```ts
  // Initial immediate fetch & 2s interval loop
  updateTelemetryAndChart();
  pollTimer = setInterval(updateTelemetryAndChart, 2000);
```

**Impact.** Every 2 seconds the component fetches `/api/stats`, rebuilds an SVG string, and replaces the entire subtree via `v-html`. This destroys and recreates DOM nodes, defeats Vue’s patching, and keeps a raw-HTML sink in the app. It also polls continuously even when the tab is hidden.

**Root cause.** The chart is rendered by string concatenation and `v-html` rather than reactive SVG elements or a canvas.

**Concrete fix.** Render the chart with reactive `<svg>`/`<path>` bindings (or a small canvas chart) and update only the `d`/`cx`/`cy` attributes. Pause polling on `document.hidden` and resume on visibility. Increase the interval to 5 s or use server push.

**Verification.** Chrome Performance panel: no full subtree replacement every 2 s; CPU usage drops while the view is open. `v-html` grep in `HardwareMonitorView.vue` returns nothing.

---

## 4. Cross-Cutting Conclusions

1. **The “fixed” claims that matter most are real**, but the fixes are unevenly distributed: auth, consolidator transactions, VMAF frame math, and stream cleanup are solid; the activity-indexing contract and configuration wiring are not.
2. **The highest-risk remaining defect is not a crash — it is silently wrong data.** `AI-01` (wrong recording), `PB-02` (synthesized windows), and `TX-01` (no post-concat quality check) all produce plausible-looking forensic output that is not trustworthy. In a VMS, that is worse than an outage because it is invisible.
3. **The second-highest risk is availability coupling.** `AI-02` (no DB timeouts) and `AI-04` (consumer thread death) turn a transient dependency blip into permanent, silent detection loss for all cameras while healthchecks stay green.
4. **Deployment reproducibility is still an open architectural issue.** Host `dist/` bind-mounts (`SEC-03`) mean “the image” is not what runs. This should be fixed before any release artifact is trusted.

---

## 5. Recommended Remediation Order

| Order | Finding | Why first | Effort |
|---|---|---|---|
| 1 | `AI-02` DB timeouts | One-line config change; prevents cross-camera freezes | S |
| 2 | `AI-01` recording containment | Data integrity; requires recorder event + worker interval tracking | M |
| 3 | `PB-02` remove synthesized windows | Eliminates fabricated forensic evidence | S |
| 4 | `AI-03` split `PROBE_SAMPLE_SEC` / `ACTIVITY_WINDOW_SEC` | Restores smart probing correctness | S–M |
| 5 | `PB-01` async list + persisted playability | Removes event-loop blocking | M |
| 6 | `REC-01` distinguish unknown duration | Prevents recoverable-footage loss | M |
| 7 | `SEC-01` media tickets + memory-only access token | Closes token leakage | M |
| 8 | `SEC-03` drop `dist/` bind mounts | Makes deployments reproducible | S |
| 9 | `TX-03` config precedence | Makes the configuration UI honest | S |
| 10 | `TX-01` post-concat VMAF | Restores the verification guarantee | M |

**Verification gate for the remediation pass:** `pnpm typecheck` + web Vitest (as executed here) plus the API/recorder/Python suites under a live compose stack; all new findings above should gain a failing test before the fix and a passing test after.

---

*End of report. No source files were modified during this audit.*
