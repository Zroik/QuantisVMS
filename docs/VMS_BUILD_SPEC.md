# VMS BUILD SPEC — Smart Video Management System (VMAF-CUDA + YOLO26n)

Spec v1.0. Derived from `Analisis_dan_Arsitektur_Proyek_Video.docx`, then audited and corrected (see §2 Errata). This file overrides the source document.

## 0. How to read this spec

- **MUST / MUST NOT / SHOULD** are normative.
- `[VERIFY]` — check against official docs or real tool output before relying on it.
- `[DECISION]` — already decided here; do not re-debate. Only deviate with a `docs/DECISIONS.md` entry plus evidence.
- `[HW]` — provable only on the real RTX 4060 (otherwise report `UNVERIFIED-HW`).
- Anything numeric in the source (latency, FPS, savings %) is a **hypothesis to measure**, not a pass/fail requirement, unless §12 gives it as a gate.
- All time constants are configurable via env so the system can be tested in minutes instead of days (see §6.5).

## 1. Goal and envelope

**Goal.** A web VMS that:
1. ingests IP cameras over RTSP and records raw video without re-encoding (CPU ≈ 0);
2. shows a live preview in the browser with YOLO26n bounding boxes and instant per-class on/off toggles (no model reload);
3. after a retention delay, compresses each recording with NVENC (AV1 or HEVC) at the **highest CQ that still passes a VMAF quality gate**, measured on the most forensically active 20 s window of each 10-minute chunk (AI-Guided Smart Probing);
4. verifies the result and only then deletes the raw file;
5. presents everything in a flat, SwiftUI-style dashboard (no "AI-slop").

**Hardware envelope.** AMD Ryzen 7 7745HX (8C/16T), NVIDIA RTX 4060 (8 GB VRAM; Ada: NVENC AV1/HEVC/H.264 + NVDEC), 1 TB NVMe. OS is Windows 11 + WSL2 or Ubuntu 24.04/26.04 — **detect in Phase 0, do not assume**. Target: up to 10 cameras at 1080p; 4K allowed but capacity must be measured (§6.6).

**Non-goals.** Audio, PTZ, ONVIF discovery, cloud/multi-node, mobile apps, rich user management.

## 2. Errata — corrections to the source document

These were found by auditing the source. Each is binding.

| ID | Source says | Problem | Binding rule |
|---|---|---|---|
| E1 | Pet weight "bobot 11" | Footnote digit glued to "1". | Weights: **person=3, vehicle=2, pet=1**, any other enabled class = 1 (`OTHER_CLASS_WEIGHT`). |
| E2 | Thresholds garbled by lost symbols ("Mean VMAF Target", "Target 4") | Math symbols stripped in conversion. | Use the policy JSON: **mean ≥ 85.0 AND p25 ≥ 81.0** (defaults, per-camera override). Harmonic mean and min are logged, not gated. |
| E3 | `model.predict(frame, classes=…, nms=False, conf=0.35)` | In Ultralytics, `nms` is an **export** option and is unavailable for end-to-end models; YOLO26 is NMS-free by default. `half=True` on export is a deprecated alias in current docs. | Predict with `classes=`/`conf=` only; default end-to-end head. Export engine with the precision argument the **installed** Ultralytics version accepts (`help(YOLO.export)`); record it. Never pass `nms=False` to predict. `[VERIFY]` |
| E4 | Python 3.14 + TensorRT 10+ | TensorRT 10.x wheels stop at Python 3.13; 3.14 bindings arrive in TensorRT ≥ 11.1 (Windows 3.14 "preliminary"); PyTorch/Ultralytics/PyAV wheels for 3.14 are uncertain. | `[DECISION]` default **Python 3.12** for `ai-vision-worker`. Use 3.14 only if a smoke test (import ultralytics, torch CUDA, tensorrt, av; export + run engine) passes; log in DECISIONS. |
| E5 | "Parse probe.json for mean and p25" | libvmaf JSON pools mean/min/max/harmonic_mean; **p25 is not provided**. | Compute p25 from per-frame `frames[].metrics.vmaf` (sorted, linear interpolation = numpy default). `[VERIFY]` JSON field names on the built libvmaf. |
| E6 | Fall back to CPU VMAF "if CUDA returns non-zero exit" | The reported upstream failure is a **hang / stop after first frame**, which returns no exit code. CUDA/driver PTX mismatches can also hang. | Every VMAF run has a **watchdog timeout** (default `max(60 s, 6 × sample_duration)`), and a **frame-count check** (`frames_scored` must equal the reference frame count ±0). Timeout, non-zero exit, or wrong frame count ⇒ kill process group, retry once on CUDA, then fall back to CPU. Log `backend`. |
| E7 | Pixel formats like yuv444p10le in the CPU path | GPU VMAF path supports **8-bit** pipelines only (v0.6 model) `[VERIFY]`. Both inputs must have identical resolution, fps, pixel format, aligned first frame. | Probe encodes use 8-bit 4:2:0. Distorted = input 0 (`[dist]` first), reference = input 1. If source is 10-bit, convert both identically before VMAF. Use `-fps_mode passthrough` `[VERIFY]` so NVENC never drops/dups frames. |
| E8 | One CQ search per 10-min segment, but "full encode of the whole file" | Which CQ is used for the file? Contradiction. | `[DECISION]` **Chunked encode**: split recording into chunks of `PROBE_INTERVAL_SEC` (600 s); each chunk gets its own CQ from its own probe; encode chunks independently, then concat (`-c copy`) into one MP4. |
| E9 | Raw container unspecified; output `.mp4` | Browsers cannot play MKV; plain MP4 is unplayable if recording crashes; raw footage must be viewable during its 24 h wait. | `[DECISION]` Raw segments are **fragmented MP4** (`frag_keyframe+empty_moov+default_base_moof`), crash-safe and browser-playable (codec permitting). Final output: MP4 with `+faststart`. |
| E10 | Recorder, MediaMTX and AI worker each read RTSP | Many IP cameras allow only 2–3 simultaneous RTSP clients. | `[DECISION]` **One** connection to each camera: MediaMTX pulls from the camera; recorder and AI worker read from `rtsp://mediamtx:8554/cam{ID}` on the internal network. |
| E11 | Detections stored per 20 s window; compression uses file offsets | Detections are wall-clock; files have relative time; `recordings` row must exist before windows can reference it. | Recorder creates the `recordings` row (status `RECORDING`, `started_at`) when a segment file opens. AI worker maps wall-clock → recording by time range. Offset error up to one GOP is acceptable. See §7 schema. |
| E12 | "Delete raw file safely" after full encode | No verification step defined. | `[DECISION]` Mandatory verification (§8.6) before deletion; raw kept until `verified_at` is set; deletion delayed by `RAW_DELETE_GRACE_SEC`. |
| E13 | Hourly cron scans raw files older than 24 h | May pick a file still being written; duplicate jobs; disk can fill before 24 h at high bitrate. | Eligible = `status='RAW'` AND `ended_at ≤ now − RAW_RETENTION_SEC`. BullMQ `jobId = rec-{id}` (idempotent). Disk watermark override (§8.7). |
| E14 | Docker + NVENC | Containers need the **`video`** driver capability for NVENC/NVDEC. WSL2 bind mounts under `/mnt/c` are slow. | `NVIDIA_DRIVER_CAPABILITIES=compute,utility,video`. `/data` volumes live on the WSL2/Linux ext4 filesystem. |
| E15 | Patch & recompile ab-av1 (Option A) *and* custom orchestrator (Option B) | Patching Rust source is high-risk, unverified line references. | `[DECISION]` **Production path = Option B** (own CQ search in TypeScript with `libvmaf_cuda`). Option A is an optional, isolated benchmark in `tools/benchmark-ab-av1/` (Phase 8), never on the production path. |
| E16 | "<2 ms", "<10% GPU", ">300 FPS", "4–5 iterations", "50–75% savings" | Marketing-style numbers. | Measure and report in `docs/BENCHMARKS.md`. Only gates in §12 are pass/fail. |
| E17 | Every detection stored with snapshot | 10 FPS × many boxes would flood MySQL/disk. | Event dedupe: per `(camera, class)` cooldown `EVENT_COOLDOWN_SEC=5`, confidence ≥ threshold, max snapshot rate per camera. |
| E18 | 10 cameras on 1 TB | At 4 Mbps/camera ≈ 18 GB/h/camera raw; 24 h × 10 cams ≈ 430 GB; NVENC throughput may not keep pace. | Capacity benchmark in Phase 7 (§6.6). Report max sustainable cameras; do not assume 10. |
| E19 | Licensing | FFmpeg with `--enable-nonfree` is not redistributable; Ultralytics is AGPL-3.0. | Build FFmpeg locally; never publish the binary/image. README states AGPL/nonfree notes. |
| E20 | Output "H.265 or AV1" | Browser support differs (HEVC needs HW decode; AV1 varies). | Default `av1_nvenc`; UI shows a codec-compatibility notice; `hevc_nvenc` uses `-tag:v hvc1`. Player must fail gracefully with a download link. |

## 3. Architecture

### 3.1 Services (docker compose)

| Service | Tech | GPU | Role |
|---|---|---|---|
| `mysql` | MySQL 8.4 LTS | no | Persistent data |
| `redis` | Redis | no | Pub/Sub, BullMQ, toggle state |
| `mediamtx` | MediaMTX | no | Single pull from camera; RTSP re-publish; WebRTC/HLS; auth hook |
| `recorder` | Node/TS or Python + ffmpeg `-c copy` | no | Supervises one ffmpeg per camera; creates/finalizes `recordings` rows |
| `ai-vision-worker` | Python + Ultralytics + TensorRT | yes | NVDEC → YOLO26n.engine → detections; activity windows; GPU stats |
| `api-server` | Node LTS + Express + Socket.IO | no | REST, auth, sockets, hourly scheduler |
| `transcode-worker` | same codebase as api-server (entry `worker.ts`) on the ffmpeg-cuda image | yes (`video`) | BullMQ consumer: probe, encode, verify |
| `web` | nginx serving Vue build | no | SPA + reverse proxy `/api`, `/socket.io`, `/webrtc` (single origin) |
| `sim-cameras` (profile `dev`) | ffmpeg looping files → MediaMTX | no | RTSP simulator for tests |

`[DECISION]` The transcode worker is a **separate process/container** from the API (API restarts must not interrupt encodes; GPU runtime only where needed). The recorder is a **separate container** (API restarts must not create recording gaps).

### 3.2 Data flow

```
IP Camera ──RTSP (1 conn)──▶ MediaMTX ──RTSP internal──▶ recorder: ffmpeg -c copy ─▶ /data/raw/cam{ID}/YYYYmmdd_HHMMSS.mp4
                               │                    └──▶ ai-vision-worker: NVDEC ▶ yolo26n.engine ▶ filter(active_class_ids)
                               │                                   ├─ Redis pub `ai:detections` ─▶ api-server ─Socket.IO─▶ browser
                               │                                   └─ 20 s windows ─▶ MySQL recording_activity_windows
                               └──WebRTC (WHEP) / HLS (authenticated)──▶ browser
api-server scheduler (hourly) ─▶ BullMQ `transcode` ─▶ transcode-worker (GPU):
    per 10-min chunk: pick peak-activity 20 s window ▶ CQ bisection (NVENC + libvmaf_cuda) ▶ chunk encode ▶ concat ▶ verify ▶ delete raw
```

### 3.3 Volumes
`/data/raw`, `/data/compressed`, `/data/tmp` (probe scratch; tmpfs or fast ext4), `/data/snapshots`, `/data/models` (yolo26n.pt/.engine cache). All on Linux-native filesystem.

## 4. Tech stack and version policy

Targets from the source. **Verify each against the registry/official docs in Phase 0 and pin in lockfiles; if a target does not exist or is incompatible, choose the nearest stable release and log a DECISION.** Do not guess versions.

| Area | Target | Notes |
|---|---|---|
| Frontend | Vue 3.5+, Vite (latest stable), TypeScript strict, Pinia, Tailwind CSS v4, shadcn-vue + Reka UI, lucide-vue-next, Chart.js (vue-chartjs) or Unovis | `hls.js` only as fallback player |
| Backend | Node.js LTS (verify current LTS), Express, TypeScript strict, Socket.IO 4.8+, BullMQ, ioredis, mysql2 (parameterized), zod, pino, argon2, jose or jsonwebtoken | tests: vitest + supertest |
| AI worker | Python 3.12 (see E4), Ultralytics (yolo26n), TensorRT (matching CUDA), PyAV or OpenCV-with-FFmpeg, redis-py, mysql-connector or PyMySQL, pynvml | tests: pytest; lint: ruff; types: pyright or mypy |
| Media | FFmpeg n8.1.x or master with `--enable-nonfree --enable-gpl --enable-version3 --enable-ffnvcodec --enable-cuda-nvcc --enable-nvenc --enable-nvdec --enable-cuvid --enable-libvmaf --enable-libsvtav1 --enable-libx265` (CPU fallback needs plain libvmaf), libvmaf 3.x built with Meson `-Denable_cuda=true -Denable_float=true -Dbuilt_in_models=true`, nv-codec-headers | build routes in §9.1 |
| Streaming | MediaMTX (latest stable) | auth via external HTTP hook `[VERIFY]` |
| DB / Cache | MySQL 8.4 LTS, Redis (set `requirepass`) | migrations are versioned files |
| Monorepo | pnpm workspaces for TS (fallback npm workspaces), Python in `services/ai-vision-worker` with its own `pyproject.toml` (uv or pip) | root `Makefile` with `verify`, `verify-gpu` |

## 5. Repository layout

```
.agents/rules/vms-guardrails.md
docs/  VMS_BUILD_SPEC.md  PROGRESS.md  DECISIONS.md  BLOCKERS.md  VERSIONS.md  BENCHMARKS.md  ARCHITECTURE.md  RUNBOOK.md  source/
apps/api-server/      src/{server.ts,worker.ts,routes,auth,sockets/gateway.ts,queues/transcode.worker.ts,queues/scheduler.ts,cq-search/,vmaf/,db/migrations,...}
apps/web-dashboard/   src/{components/video/BboxOverlay.vue,components/ai/ClassTogglePanel.vue,pages,stores,i18n,...}
services/media-engine/ Dockerfile.ffmpeg  recorder/  mediamtx.yml  scripts/
services/ai-vision-worker/ detector.py  activity_indexer.py  ...
tools/benchmark-ab-av1/   (Phase 7, optional)
tests/e2e/  tests/fixtures/
docker-compose.yml  docker-compose.dev.yml  Makefile  .env.example  README.md
```

## 6. Contracts and configuration

### 6.1 Input payloads (JSON, validated with zod / pydantic; reject unknown fields)

Class toggle (REST `PUT /api/cameras/:id/classes` or Socket.IO `ai:toggle_class`):
```json
{"camera_id":1,"preset_groups":{"person":true,"vehicle":true,"pets":true},"custom_class_ids":[24,28,43],
 "resolved_active_ids":[0,1,2,3,5,7,14,15,16,24,28,43],"confidence_threshold":0.35}
```
The **server** recomputes `resolved_active_ids` from `preset_groups ∪ custom_class_ids` (Appendix A) and ignores the client's value if it differs. Ids must be integers 0–79. Default: `[0,1,2,3,5,7,14,15,16]`, confidence 0.35 (allowed 0.05–0.95).

Compression policy (per camera, `PUT /api/cameras/:id/compression-policy`):
```json
{"target_vmaf_mean":85.0,"target_vmaf_p25":81.0,"vmaf_range":[80,90],"encoder":"av1_nvenc","preset":"p5",
 "sample_interval_sec":600,"sample_duration_sec":20,"smart_ai_sampling":true}
```
Camera registration: `{name, rtsp_url}` — `rtsp_url` must match `^rtsps?://`, host not empty; credentials are encrypted at rest; reject any other scheme.

### 6.2 Redis

| Key / channel | Direction | Payload |
|---|---|---|
| `cam:{id}:classes` | API writes, worker reads | JSON array of ids |
| `cam:{id}:conf` | API writes, worker reads | float |
| channel `ai:toggle` | API → worker | `{camera_id, resolved_active_ids, confidence_threshold, rev}` (`rev` monotonic) |
| channel `ai:detections` | worker → API | `{camera_id, seq, frame_ts_ms, boxes:[{cls,conf,x1,y1,x2,y2}]}` — coords **normalized 0–1** |
| channel `camera:changed` | API → recorder, worker | `{camera_id, action: added|updated|removed}` |
| channel `hw:gpu` | worker → API | `{gpu_util, vram_used_mb, vram_total_mb, temp_c, enc_util, dec_util}` every 2 s |

Pub/Sub is fire-and-forget: the worker MUST also **reconcile** by re-reading `cam:{id}:classes` every 5 s and at startup, ignoring messages with `rev` lower than the current one.

### 6.3 Socket.IO (authenticated at handshake with JWT; rooms `camera:{id}`, `system`)

| Event | Direction | Notes |
|---|---|---|
| `ai:toggle_class` | client → server (with ack) | toggle payload; ack `{ok, resolved_active_ids}` |
| `ai:class_state` | server → room `camera:{id}` | new state after toggle |
| `ai:detections` | server → room `camera:{id}` | batched per frame; clients join a room only for visible tiles |
| `transcode:probe_step` | server → `system` | `{recording_id, chunk_index, iteration, cq, vmaf_mean, vmaf_p25, backend, duration_ms}` |
| `vmaf:progress` | server → `system` | `{recording_id, phase, percent}` |
| `recording:status` | server → `system` | `{recording_id, status}` |
| `system:alert` | server → `system` | disk watermark, GPU fallback, worker failure |
| `hw:stats` | server → `system` | GPU + disk + CPU/RAM |

### 6.4 REST (all under `/api`, JSON, zod-validated, JWT unless noted)
- `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `GET /auth/me`
- `GET|POST /cameras`, `GET|PATCH|DELETE /cameras/:id` — never return credentials; return `rtsp_host` and a masked URL
- `PUT /cameras/:id/classes`, `PUT /cameras/:id/compression-policy`, `GET /yolo/classes` (80 names + group)
- `GET /recordings` (filters: camera, from, to, status; paginated), `GET /recordings/:id` (chunks, probes), `GET /recordings/:id/stream` (HTTP Range, authenticated, resolves by id only — never by client-supplied path), `POST /recordings/:id/requeue` (admin)
- `GET /events` (camera, class, from, to; paginated), `GET /vmaf/probes?recording_id=`
- `GET /stats/storage`, `GET /stats/hardware`
- Unauthenticated: `GET /healthz` (liveness), `GET /readyz` (DB + Redis). Internal only: `POST /internal/mediamtx/auth`.

### 6.5 Environment (all in `.env.example`, with defaults)
`RAW_RETENTION_SEC=86400`, `SEGMENT_SEC=3600`, `PROBE_INTERVAL_SEC=600`, `PROBE_SAMPLE_SEC=20`, `CQ_MIN=18`, `CQ_MAX=48`, `CQ_SAFETY_MARGIN=0`, `TRANSCODE_CONCURRENCY=1`, `VMAF_TIMEOUT_SEC` (derived), `STATIC_CQ_TTL_SEC=604800`, `RAW_DELETE_GRACE_SEC=3600`, `DELETE_RAW_AFTER_VERIFY=true`, `DISK_HIGH_WATERMARK_PCT=85`, `DISK_CRITICAL_PCT=95`, `EVENT_COOLDOWN_SEC=5`, `OTHER_CLASS_WEIGHT=1`, `AI_FPS=10`, `QUEUE_W_AGE=0.5`, `QUEUE_W_SIZE=0.2`, `QUEUE_W_CHEAP=0.3`, `CREDENTIAL_KEY` (32-byte base64), `JWT_SECRET`, `MYSQL_*`, `REDIS_PASSWORD`, `UI_DEFAULT_LANG=id`.
Fast test profile: `RAW_RETENTION_SEC=120 SEGMENT_SEC=60 PROBE_INTERVAL_SEC=30 PROBE_SAMPLE_SEC=10`.

### 6.6 Capacity check (Phase 7)
Compute and report: raw bytes/day = Σ(bitrate_i) × 86400 / 8; encode throughput = measured NVENC fps at the chosen preset; required = Σ(fps_i) × 86400 frames/day; sustainable cameras = throughput × 86400 / (fps × 86400) with a 30 % headroom. If raw retention would exceed `DISK_HIGH_WATERMARK_PCT`, state the maximum cameras/bitrate that fits 1 TB.

## 7. Database (MySQL 8.4, utf8mb4, InnoDB, versioned migrations with up and down)

Source tables are kept; columns marked **+** are required additions.

```sql
users(id BIGINT UNSIGNED PK AI, username VARCHAR(64) UNIQUE NOT NULL, password_hash VARCHAR(255) NOT NULL,
      role ENUM('admin','viewer') NOT NULL DEFAULT 'viewer', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);   -- +

cameras(id INT UNSIGNED PK AI, name VARCHAR(100) NOT NULL,
        rtsp_url_enc VARBINARY(2048) NOT NULL,        -- AES-256-GCM(iv|tag|ciphertext) of full URL (replaces plain rtsp_url TEXT)
        rtsp_host VARCHAR(255) NOT NULL,              -- +, display only, no credentials
        enabled TINYINT(1) NOT NULL DEFAULT 1,        -- +
        active_yolo_classes JSON NOT NULL,            -- stores the toggle payload
        confidence_threshold FLOAT NOT NULL DEFAULT 0.35,  -- +
        target_vmaf FLOAT NOT NULL DEFAULT 85.0, target_vmaf_p25 FLOAT NOT NULL DEFAULT 81.0,  -- p25 is +
        preferred_encoder ENUM('av1_nvenc','hevc_nvenc') NOT NULL DEFAULT 'av1_nvenc',
        smart_ai_sampling TINYINT(1) NOT NULL DEFAULT 1,   -- +
        static_cq_cache SMALLINT NULL, static_cq_cached_at DATETIME(3) NULL,  -- +
        created_at, updated_at);

recordings(id BIGINT UNSIGNED PK AI, camera_id INT UNSIGNED FK,
        started_at DATETIME(3) NOT NULL, ended_at DATETIME(3) NULL, duration_sec INT NULL,  -- +
        raw_path VARCHAR(512) UNIQUE NOT NULL, compressed_path VARCHAR(512) NULL,
        raw_size_bytes BIGINT NULL, compressed_size_bytes BIGINT NULL,
        width INT NULL, height INT NULL, fps FLOAT NULL, codec_raw VARCHAR(16) NULL,       -- +
        optimal_cq DECIMAL(4,1) NULL,                 -- minimum (most conservative) chunk CQ, for display
        vmaf_mean FLOAT NULL, vmaf_p25 FLOAT NULL,    -- from final verification (worst chunk p25, duration-weighted mean)
        quality_gate_met TINYINT(1) NULL,             -- +
        status ENUM('RECORDING','RAW','QUEUED','PROBING','ENCODING','VERIFYING','COMPLETED','SKIPPED','FAILED') NOT NULL DEFAULT 'RECORDING',
        failure_reason TEXT NULL, attempts INT NOT NULL DEFAULT 0,
        verified_at DATETIME(3) NULL, raw_deleted_at DATETIME(3) NULL,                      -- +
        created_at, updated_at, INDEX(status, started_at), INDEX(camera_id, started_at));

recording_chunks(id BIGINT UNSIGNED PK AI, recording_id FK, chunk_index INT, start_offset_sec INT, duration_sec INT,   -- + (new table)
        sampling_mode ENUM('ai_peak','static_cache','blind_mid','blind_fallback') NOT NULL,
        sample_start_sec FLOAT NULL, optimal_cq DECIMAL(4,1) NULL, gate_met TINYINT(1) NULL,
        vmaf_mean FLOAT NULL, vmaf_p25 FLOAT NULL, compressed_path VARCHAR(512) NULL,
        status ENUM('PENDING','PROBING','ENCODED','VERIFIED','FAILED') DEFAULT 'PENDING', UNIQUE(recording_id, chunk_index));

recording_activity_windows(id BIGINT UNSIGNED PK AI, recording_id FK, segment_index INT, window_index INT, start_offset_sec INT,
        person_count INT, vehicle_count INT, pet_count INT, other_count INT,                -- other_count +
        frames_processed INT, weighted_activity_score FLOAT, UNIQUE(recording_id, window_index));

vmaf_probe_logs(id BIGINT UNSIGNED PK AI, recording_id FK, chunk_id NULL FK, iteration_num INT, tested_cq DECIMAL(4,1),
        sample_vmaf_mean FLOAT, sample_vmaf_p25 FLOAT, sample_vmaf_hmean FLOAT NULL, sample_vmaf_min FLOAT NULL,
        backend ENUM('cuda','cpu') NOT NULL, frames_scored INT, duration_ms INT, created_at);

ai_detection_events(id BIGINT UNSIGNED PK AI, camera_id FK, recording_id NULL FK, class_id INT, class_name VARCHAR(32),
        confidence FLOAT, bbox_json JSON, snapshot_path VARCHAR(512) NULL, detected_at DATETIME(3),
        INDEX(camera_id, detected_at), INDEX(class_id, detected_at));
```
Status transitions (enforced in one function, inside a DB transaction, rejecting illegal moves):
`RECORDING → RAW → QUEUED → PROBING → ENCODING → VERIFYING → COMPLETED`; any step → `FAILED` (after retries); `VERIFYING → SKIPPED` if no space gain; `FAILED/QUEUED → QUEUED` on requeue.

## 8. Algorithms (normative)

### 8.1 Recorder
- One supervised ffmpeg per enabled camera, input `rtsp://mediamtx:8554/cam{ID}` (E10), `-rtsp_transport tcp`. Template §9.2. No audio by default (`-an`; many camera audio codecs cannot be stored in MP4).
- Supervision: restart with exponential backoff (1 s → 30 s), reset after 60 s stable; never crash-loop silently — emit `system:alert` after 5 consecutive failures.
- When a segment file appears → insert `recordings` (`RECORDING`, `started_at` from filename in UTC, `raw_path`). When the next file appears, or ffmpeg exits → finalize previous: `ffprobe` (duration, size, codec, w/h/fps), set `ended_at`, status `RAW`.
- On startup, reconcile: files with status `RECORDING` and no live process → validate with ffprobe → finalize as `RAW` (fragmented MP4 survives crashes); unreadable → `FAILED` + alert (never delete).
- Reacts to `camera:changed`; adds/removes MediaMTX paths through its control API `[VERIFY]` so credentials live only in MediaMTX config at runtime.

### 8.2 AI vision worker
- One process, **one** loaded `yolo26n.engine` (exported once, cached in `/data/models`; rebuild if the TensorRT/GPU fingerprint differs). Never reload or retrain to change classes (E3).
- Per camera a reader thread decodes (NVDEC if available, else CPU decode with a warning) and samples at `AI_FPS`, dropping frames when behind (never queue unbounded). Reconnect with backoff on stream loss.
- Inference with `classes=<active ids>`, `conf=<threshold>`. Active set + threshold live in memory, updated from `ai:toggle` and reconciled every 5 s (§6.2). A toggle MUST take effect on the next processed frame without dropping frames or restarting.
- Emit `ai:detections` (normalized boxes, `frame_ts_ms` = server clock at frame capture, `seq`).
- Activity windows: wall-clock windows of `PROBE_SAMPLE_SEC` aligned to multiples of the window length. Per window accumulate counts per group and `weighted_activity_score = Σ over frames Σ over boxes weight(class)` with weights from E1. Flush each closed window to MySQL (upsert on `(recording_id, window_index)`); `recording_id` = the camera's recording whose `[started_at, ended_at|now]` contains the window start; if none yet, buffer ≤ 60 s then retry.
- Events: for detections above threshold, write `ai_detection_events` with per `(camera, class)` cooldown `EVENT_COOLDOWN_SEC` and optional JPEG snapshot (rate limited).
- GPU stats published on `hw:gpu` (pynvml). Health file/endpoint reports last-frame age per camera.

### 8.3 Smart probing — window selection (pure function, unit-tested)
For chunk `k` of recording `R` (offsets `[k·P, (k+1)·P)`, `P = PROBE_INTERVAL_SEC`):
1. Load windows with `start_offset_sec` in `[k·P, (k+1)·P − S]` (`S` = sample duration).
2. **Coverage** = rows / expected rows (`(P/S)`; last chunk uses actual duration).
3. If `smart_ai_sampling` is false → mode `blind_mid` (sample at the middle).
4. If coverage < 0.9 (AI data missing/incomplete) → mode **`blind_fallback`** (sample at the middle). Missing data is *unknown*, never treated as "static".
5. If coverage ≥ 0.9 and max score > 0 → mode **`ai_peak`**: sample = window with max score; ties → earliest.
6. If coverage ≥ 0.9 and all scores = 0 → mode **`static_cache`**: if `cameras.static_cq_cache` is set and younger than `STATIC_CQ_TTL_SEC` → use that CQ with **no probing** (still verified in §8.6); otherwise probe a middle sample as `blind_mid` and, if the chunk was static, store the result into `static_cq_cache`.

### 8.4 CQ search and VMAF runner

Assumption: quality is non-increasing in CQ (monotone), integers in `[CQ_MIN, CQ_MAX]` (31 values ⇒ ≤ 5 probes). Gate: `mean ≥ T_mean AND p25 ≥ T_p25`.

```
searchCq(probe, cqMin, cqMax, gate):          // probe(cq) → {mean, p25, hmean, min, backend, frames}; memoized
  lo = cqMin; hi = cqMax; best = null
  while lo <= hi:
     mid = floor((lo + hi) / 2); r = probe(mid)
     if gate(r): best = (mid, r); lo = mid + 1
     else:       hi = mid - 1
  if best == null: r = probe(cqMin); return {cq: cqMin, gateMet: false, r}   // flag, keep highest quality
  return {cq: max(cqMin, best.cq - CQ_SAFETY_MARGIN), gateMet: true, r: best.r}
```
This module is **pure TypeScript with an injected `probe` function** so it is unit-tested with fake monotone/noisy/non-monotone curves and edge cases (all pass, none pass, single value, cache hint) without a GPU.

`probe(cq)` pipeline (temp files under `/data/tmp/<recording>/<chunk>/`, cleaned in `finally`):
1. Encode the 20 s reference sample with NVENC at `cq` (template §9.3), 8-bit, `-fps_mode passthrough`.
2. Run VMAF (template §9.4) under the watchdog; parse JSON; compute `mean`, `hmean`, `min` from pooled metrics `[VERIFY]` and **p25 from per-frame values** (E5).
3. Validate `frames_scored == reference_frames`; else treat as probe failure (E6).
4. Failure policy: retry once on CUDA → fall back to CPU (`n_threads=16`, `n_subsample=2` allowed only for the fallback; record `backend='cpu'`) → if CPU also fails, chunk `FAILED`.
5. Insert a `vmaf_probe_logs` row and emit `transcode:probe_step`.

Resolution: if the source is > 1080p, scale **both** inputs identically on the GPU to 1920×1080 before VMAF (test `scale_cuda` vs `scale_npp`, keep the stable one, log DECISION). Use the default 1080p VMAF model.

### 8.5 Chunk encode and concat
- For each chunk: frame-accurate `-ss <start> -t <duration>` on the raw input with NVENC at its CQ (template §9.5). Encoder params other than CQ are identical across chunks.
- Concat with the concat demuxer `-c copy -movflags +faststart` into `<compressed>/cam{ID}/<same basename>.mp4` (HEVC: `-tag:v hvc1`).
- Write to `*.partial`, rename atomically only after verification passes.

### 8.6 Verification and deletion (mandatory)
Status `VERIFYING`; all must pass:
1. `ffprobe` readable; duration within ±1 s (or ±0.5 %, whichever larger) of raw.
2. Frame count within ±2 frames × chunk count of raw.
3. Full decode test `ffmpeg -v error -i final.mp4 -f null -` produces no errors.
4. **Sample re-check**: for each chunk, VMAF of the chosen 20 s window taken from the **final file** vs the raw sample must satisfy the gate. On failure re-encode that chunk with `cq−2` (max 2 retries); still failing ⇒ `FAILED`, raw kept.
5. If `compressed_size ≥ raw_size` ⇒ `SKIPPED` (keep raw, record reason).
On success: set `compressed_path`, sizes, aggregate VMAF, `quality_gate_met`, `verified_at`, status `COMPLETED`. Delete the raw file only if `DELETE_RAW_AFTER_VERIFY` and `now ≥ verified_at + RAW_DELETE_GRACE_SEC`; then set `raw_deleted_at`. If the gate was not met for any chunk, keep the encode but mark `quality_gate_met=0` and raise `system:alert`; raw is **kept**.

### 8.7 Scheduler, queue, priority, disk safety
- Hourly cron in `api-server`: select eligible (E13) and enqueue to BullMQ `transcode`, `jobId=rec-{id}`, attempts 3, exponential backoff; statuses updated transactionally. Also reconcile orphans (log + alert only, never delete).
- Concurrency `TRANSCODE_CONCURRENCY=1` (single NVENC pipeline), long-job lock extension, graceful shutdown: stop taking jobs, kill ffmpeg process group, reset interrupted recording to `RAW`, delete partial outputs; re-running a job is idempotent.
- Priority (BullMQ: lower number = served first), `[DECISION]` shortest-job-first with aging to avoid head-of-line blocking:
  `age = min(1, age_hours/48)`, `size = min(1, raw_gb/4)`, `cheap = 1 − min(1, Σscore/ACTIVITY_REF)` (quiet = cheap);
  `score = QUEUE_W_AGE·age + QUEUE_W_SIZE·size + QUEUE_W_CHEAP·cheap`; `priority = 1 + round((1 − score)·99)`.
  The scheduler recomputes priorities of waiting jobs each hour (`changePriority`). Unit-test the ordering.
- Disk watermark: if `/data` usage ≥ `DISK_HIGH_WATERMARK_PCT`, enqueue `RAW` recordings regardless of age (oldest first) and emit `system:alert`. At `DISK_CRITICAL_PCT` alert only. The system MUST NOT delete unverified data to free space.

## 9. Media engine

### 9.1 Getting an FFmpeg with `libvmaf_cuda` + NVENC
Preference order: (1) pull the community image `ghcr.io/feldjaeger/ffmpeg-vmaf-cuda` **only if it exists and passes `scripts/check-ffmpeg.sh`** `[VERIFY]` — it is third-party, so inspect its FFmpeg/libvmaf versions and pin by digest; (2) build locally in `services/media-engine/Dockerfile.ffmpeg` (CUDA 12.x devel base → nv-codec-headers → libvmaf via Meson with CUDA → FFmpeg `./configure` flags in §4). Before `make`, confirm `libvmaf_cuda` appears under "Enabled filters". Never push/redistribute the nonfree build (E19).

`scripts/check-ffmpeg.sh` must assert: `ffmpeg -filters` contains `libvmaf_cuda` and `libvmaf`; `-encoders` contains `av1_nvenc` and `hevc_nvenc`; `-hwaccels` contains `cuda`; prints versions. Run it against both the ffmpeg image and the transcode-worker image.

### 9.2 Recorder command (starting point `[VERIFY]` flags on the built ffmpeg)
```
ffmpeg -hide_banner -loglevel warning -rtsp_transport tcp -i rtsp://mediamtx:8554/cam{ID}
  -map 0:v:0 -an -c:v copy -f segment -segment_time {SEGMENT_SEC} -segment_atclocktime 1 -reset_timestamps 1 -strftime 1
  -segment_format mp4 -segment_format_options movflags=+frag_keyframe+empty_moov+default_base_moof
  /data/raw/cam{ID}/%Y%m%d_%H%M%S.mp4          # add -tag:v hvc1 for HEVC sources
```
### 9.3 Probe encode (GPU)
```
ffmpeg -hide_banner -y -hwaccel cuda -hwaccel_output_format cuda -i sample_ref.mkv -an
  -c:v {av1_nvenc|hevc_nvenc} -preset {p5} -cq {CQ} -b:v 0 -fps_mode passthrough sample_dist.mkv
```
Cut the reference sample with `-ss <t> -t 20 -c copy -an` (stream copy snaps to a keyframe; measure the real frame count with ffprobe and use that, not 20 s × fps).
### 9.4 VMAF (GPU) — `[dist]` first, `[ref]` second, always
```
Variant A (CPU decode): ffmpeg -i sample_dist.mkv -i sample_ref.mkv -filter_complex
  "[0:v]hwupload_cuda[dist];[1:v]hwupload_cuda[ref];[dist][ref]libvmaf_cuda=log_path=probe.json:log_fmt=json:n_threads=8" -an -f null -
Variant B (NVDEC decode, frames stay on GPU): same filter graph with -hwaccel cuda -hwaccel_output_format cuda on both inputs.
CPU fallback: -filter_complex "[0:v][1:v]libvmaf=log_path=probe.json:log_fmt=json:n_threads=16:n_subsample=2"
```
Choose A or B by what passes Gate G1 (prefer B if equal). Run under the watchdog (§8.4). Use `spawn` with arg arrays; the filter string is built from constants and validated numbers only.

### 9.5 Chunk encode and concat
```
ffmpeg -hide_banner -y -hwaccel cuda -hwaccel_output_format cuda -ss {start} -t {dur} -i raw.mp4 -an
  -c:v {encoder} -preset {preset} -cq {CQ} -b:v 0 chunk_{k}.mp4
ffmpeg -hide_banner -y -f concat -safe 0 -i chunks.txt -c copy -movflags +faststart final.mp4.partial   (HEVC: -tag:v hvc1)
```
### 9.6 MediaMTX
Per-camera path `cam{ID}` with `source: <rtsp url>`, on-demand off (recorder/AI worker keep it active), recording **disabled** (our recorder does it), WebRTC + HLS enabled, `authMethod: http` pointing to `api-server /internal/mediamtx/auth` `[VERIFY keys]`. Internal readers (recorder, ai-worker) authenticate with a service credential; browsers with a short-lived token derived from their JWT. For WebRTC under Docker/WSL2 set the ICE host options so the browser can reach UDP `[VERIFY]`; HLS is the documented fallback.

### 9.7 GPU in Docker
Services with GPU use `deploy.resources.reservations.devices: [{driver: nvidia, count: 1, capabilities: [gpu, compute, utility, video]}]` and `NVIDIA_DRIVER_CAPABILITIES=compute,utility,video`. Prove with `docker run --rm --gpus all <cuda image> nvidia-smi` and by running an NVENC encode inside the worker image. NVENC session limits on consumer GPUs: never run more simultaneous NVENC sessions than measured to work (default 1).

## 10. Security requirements (all verified in Phase 7)
1. Passwords: argon2id. JWT access ≤ 15 min; rotating refresh token in `httpOnly; SameSite=Strict; Secure` cookie (Secure off only in dev profile).
2. Socket.IO handshake authenticated; room joins authorized; per-socket rate limits.
3. `helmet`, strict CORS allowlist (same-origin through nginx), rate limiting on `/auth/*`, request body size limits, zod on every input.
4. SQL only via parameterized queries; no string-built SQL.
5. **No shell**: `spawn(file, args[])` everywhere; RTSP URL validated; file paths resolved server-side from DB ids; any served path is `path.resolve`d and checked to be inside `/data`.
6. RTSP credentials: AES-256-GCM with `CREDENTIAL_KEY`; masked in logs (`rtsp://***:***@host`); never in API responses, Socket.IO payloads, or error messages; a test greps captured logs/responses for a known sentinel password.
7. Internal network: only `web` (80/443) and MediaMTX WebRTC/HLS ports are published; MySQL and Redis are not exposed to the host; Redis `requirepass`.
8. Containers: non-root users where possible, read-only root FS where feasible, resource limits, `restart: unless-stopped`, healthchecks.
9. Dependency audit (`pnpm audit`, `pip-audit`) with no unaddressed high/critical findings; lockfiles committed.
10. README documents AGPL-3.0 (Ultralytics) and FFmpeg nonfree constraints.

## 11. Frontend specification

**Stack:** Vue 3 Composition API + TS strict + Pinia + Tailwind v4 + shadcn-vue (Reka UI) + lucide-vue-next. Components are copied into `src/components/ui/` (shadcn "open code"). Language via i18n catalogs (`id` default, `en` included); no hard-coded UI strings.

**Pages:** Login · **Live Camera Matrix** (1–4 column grid, per-tile status badge, fullscreen) · **Class Toggle panel** (`ClassTogglePanel.vue`, iOS-Settings-style grouped rows with pill `<Switch>`: Person/Vehicles/Pets ON by default; Luggage, Sharp & Dangerous, Devices OFF; searchable **Advanced Class Drawer** for the remaining COCO classes; confidence slider) · **VMAF Telemetry Center** (queue, live probe steps, CQ-vs-VMAF curve with gate lines, savings summary) · **Forensic Playback Timeline** (per camera, activity heat strip from `recording_activity_windows`, event markers, click-to-play raw or compressed with Range) · **Hardware Monitor** (GPU util/VRAM/temp/NVENC, disk, CPU/RAM) · **Settings** (cameras CRUD, compression policy, per-camera classes).

**Player:** WebRTC (WHEP) primary, HLS fallback. `BboxOverlay.vue` draws on an SVG/canvas layer above the `<video>`; boxes use normalized coords mapped to the displayed video rect (handle letterboxing and resize); a box older than 1000 ms is hidden; with HLS the overlay is disabled and a badge says so.

**Design tokens (binding — "SwiftUI flat", no AI-slop):**
| Element | Rule |
|---|---|
| Surfaces | Light: bg `#F5F5F7`, card `#FFFFFF`. Dark: bg `#000000`/`#09090B`, card `#1C1C1E`. |
| Borders/elevation | 1 px hairline (`border-zinc-200/80`, dark `border-zinc-800/80`), no or micro shadow only. |
| Accents | Blue `#007AFF` actions · Green `#34C759` YOLO-on + VMAF-pass · Amber `#FF9500` probing/queue · Red `#FF3B30` alerts. Max 3 accent hues per screen. |
| Typography | `-apple-system, BlinkMacSystemFont, 'Inter', sans-serif`; titles `tracking-tight`; **`tabular-nums` on every changing number** (VMAF, bitrate, MB, FPS, counts); reserve width so layout never jitters. |
| Toggles | shadcn-vue/Reka `<Switch>` pill (h-5 w-9) in rounded-xl grouped lists (`divide-y`). Never raw checkboxes. |
| Bounding boxes | rx 4, stroke 1.5 px, fill rgba(0,122,255,0.08), small pill label top-left (10 px, medium, tabular-nums). |
| Forbidden | purple/indigo gradients, neon glow, heavy shadows (`shadow-2xl`, colored shadows), `backdrop-blur` glassmorphism, decorative fonts, emoji as icons. |

`scripts/check-design-tokens.mjs` fails the build if forbidden classes (`bg-gradient-*`, `from-*/to-*`, `shadow-2xl`, `backdrop-blur*`, colored `shadow-*/NN`) appear in `src/`, and if a metric element lacks `tabular-nums`.
**Quality:** keyboard accessible, visible focus rings, contrast ≥ 4.5:1, `aria-label` on switches, `prefers-reduced-motion` respected, light/dark + manual toggle, skeletons/empty/error states on every page, no console errors, responsive down to 360 px.

## 12. Phases, tasks and gates

Every gate check has an ID. A phase passes only if every non-`[HW]` check is PASS with pasted evidence. `[HW]` checks you cannot execute are reported `UNVERIFIED-HW` (the user will run them). After each gate: Gate Report (Appendix C), then wait for `GO PHASE n+1`.

### Phase 0 — Audit and foundation
Audit commands (record outputs): OS/shell (`uname -a`, WSL status if Windows), `nvidia-smi`, `docker version`, `docker info`, GPU container test, `node -v`, `pnpm -v`, `python3 --version`, `uv --version`, `ffmpeg -version`, `ffmpeg -hide_banner -encoders | grep nvenc`, `ffmpeg -hide_banner -filters | grep vmaf`, `df -h` for the workspace and `/data` (**workspace must not be under `/mnt/c`**). Verify every target version in §4 via registry/docs and write `docs/VERSIONS.md` with the command used. Create monorepo skeleton, Makefile (`verify`, `verify-gpu`), lint/format/test configs, `.env.example`, compose with `mysql`, `redis`, `mediamtx`, `docs/DECISIONS.md` (D-001 Python version, D-002 FFmpeg source, …).
**Gate:** G0.1 `make verify` green on skeleton · G0.2 compose services healthy · G0.3 `nvidia-smi` inside a container [HW] · G0.4 VERSIONS.md complete with evidence · G0.5 DECISIONS has D-001/D-002 · G0.6 workspace on Linux filesystem.

### Phase 1 — Media engine and VMAF-CUDA validation
Tasks: ffmpeg image + `check-ffmpeg.sh`; TS `vmaf/` module (spawn runner, watchdog, JSON parser, p25, frame-count validation, CUDA→CPU fallback); pure `cq-search/` module; fixtures generated with `ffmpeg lavfi` (1080p, 30 s, mixed static + motion) under `tests/fixtures/`.
**Gate:** G1.1 check-ffmpeg passes [HW] · G1.2 self-compare VMAF ≥ 99.5 [HW] · G1.3 CQ {20,28,36,44}: mean VMAF non-increasing, table in BENCHMARKS.md [HW] · G1.4 `frames_scored == reference frames` · G1.5 simulated hang (wrapper that sleeps) → killed at timeout, CPU fallback used, `backend='cpu'` · G1.6 CPU vs CUDA mean difference recorded, ≤ 2.0 `[VERIFY tolerance]` [HW] · G1.7 cq-search unit tests: all-pass, none-pass, single value, noisy, non-monotone, memoization, ≤ 5 probes for 31 values · G1.8 p25 equals numpy reference on fixed arrays · G1.9 full CQ search on a 20 s sample converges ≤ 5 iterations; report wall time [HW] · G1.10 worker image passes check-ffmpeg.

### Phase 2 — AI vision worker and dynamic class toggle
Tasks: export `yolo26n.engine`; `detector.py`; `activity_indexer.py`; Redis toggle sync + reconcile; event dedupe; GPU stats; sim camera in compose dev profile.
**Gate:** G2.1 engine exports and loads; `model.names` assertion: ids {0 person,1 bicycle,2 car,3 motorcycle,5 bus,7 truck,14 bird,15 cat,16 dog,24 backpack,25 umbrella,26 handbag,28 suitcase,34 baseball bat,39 bottle,43 knife,76 scissors,62 tv,63 laptop,64 mouse,66 keyboard,67 cell phone} match [HW] · G2.2 detections reach `ai:detections` ≤ 1 s, coords within [0,1] · G2.3 toggle off `person` ⇒ no person boxes within 1 s; on ⇒ returns; model loaded exactly once; `seq` contiguous · G2.4 key changed without publish ⇒ applied ≤ 6 s · G2.5 kill/restore sim stream ⇒ reconnect ≤ 30 s, process alive · G2.6 weights test (person 3, vehicle 2, pet 1, other 1) · G2.7 event cooldown test · G2.8 latency p50/p95 + VRAM recorded in BENCHMARKS.md [HW] · G2.9 pytest + ruff + type check green.

### Phase 3 — Database, API, auth, recorder
Tasks: migrations (§7) with down scripts; auth; cameras CRUD with encryption; class/policy endpoints; Socket.IO gateway; recorder service; MediaMTX path management + auth hook; stream endpoint with Range; stats; health.
**Gate:** G3.1 migrations up/down/up on clean DB; schema diff vs §7 empty · G3.2 auth matrix (ok / wrong password 401 / no token 401 / rate-limit 429 / refresh rotation) · G3.3 credentials never present in any API response, socket payload, or captured logs; DB column holds ciphertext · G3.4 toggle API recomputes ids; invalid ids → 400; Redis key + publish + socket ack · G3.5 unauthenticated socket rejected; detections only to joined rooms · G3.6 recorder with sim camera (fast profile): segments created, rows `RECORDING→RAW`, durations within ±2 s of ffprobe · G3.7 kill ffmpeg ⇒ restart with backoff; kill recorder mid-file ⇒ file finalized as `RAW` after restart · G3.8 stream endpoint: 206 on Range, 401 unauth, traversal attempts rejected · G3.9 MediaMTX unauthenticated read rejected, authorized read accepted `[VERIFY]` · G3.10 vitest/supertest, lint, typecheck green.

### Phase 4 — Transcode pipeline (Smart Probing)
Tasks: scheduler; BullMQ queue/worker (separate entry); window selection (§8.3); priority (§8.7); probe runner; chunk encode/concat; verification and deletion (§8.6); crash recovery; sockets for progress; savings stats.
**Gate:** G4.1 window-selection tests (peak, tie→earliest, coverage<0.9→`blind_fallback`, all-zero→`static_cache`, no rows) · G4.2 priority ordering tests + hourly re-prioritization · G4.3 illegal status transitions rejected · G4.4 fast-profile real run (seeded activity): chosen sample equals expected peak window; probe logs written; final MP4 plays; duration matches; verification passes; raw deleted only after grace [HW] · G4.5 kill worker mid-encode ⇒ idempotent re-run, no `.partial` leftovers · G4.6 forced VMAF hang ⇒ CPU fallback logged · G4.7 forced unmet gate ⇒ `quality_gate_met=0`, raw kept, alert · G4.8 compressed ≥ raw ⇒ `SKIPPED`, raw kept · G4.9 low-watermark test triggers early enqueue; nothing unverified deleted · G4.10 `transcode:probe_step` per iteration · G4.11 stored sizes equal `stat` sizes; savings % computed.

### Phase 5 — Frontend
Tasks per §11. Use the installed frontend/design skill if present; use the browser agent for visual review.
**Gate:** G5.1 build + typecheck + lint + vitest green · G5.2 design-token script green · G5.3 Playwright (Chromium) with sim cameras: login → matrix shows live video → toggling a class changes boxes within 1 s → timeline plays a recording · G5.4 HLS fallback works when WebRTC disabled · G5.5 axe: 0 critical/serious · G5.6 screenshots light/dark for every page in `docs/screenshots/` · G5.7 no console errors; 360 px responsive · G5.8 i18n: no hard-coded strings (script).

### Phase 6 — Integration and end-to-end
`scripts/e2e-full.sh`: clean `docker compose --profile dev up -d --build`; add 3 sim cameras via API; fast profile; run ≥ 15 min.
**Gate:** G6.1 all containers healthy · G6.2 every recording reaches `COMPLETED` or a documented `SKIPPED`; none `FAILED` [HW] · G6.3 raw deleted only for verified recordings; sizes in DB equal disk · G6.4 compressed files play in Chromium; sample VMAF re-check passes [HW] · G6.5 restart `api-server` during recording ⇒ no gap in segments · G6.6 `docker compose kill recorder` ⇒ auto-resume, files finalized · G6.7 toggle propagates UI→worker→boxes end to end · G6.8 dashboard values match DB.

### Phase 7 — Hardening and release
Security checklist §10 (evidence per item) · capacity benchmark §6.6 · soak ≥ 60 min with 4 sim cameras (sample RSS/VRAM each minute; flag a sustained upward trend) · audits · README, ARCHITECTURE, RUNBOOK (backup/restore MySQL, upgrade, troubleshooting, GPU driver notes) · clean-clone test (fresh clone, `.env` from example, one command to run).
**Gate:** G7.1 each §10 item PASS with evidence · G7.2 BENCHMARKS.md complete with capacity statement · G7.3 soak report, no leak trend · G7.4 audits clean or documented · G7.5 clean-clone start works · G7.6 §14 checklist all ticked. Recommend the user runs a 24 h real-camera soak.

### Phase 8 — Optional ab-av1 benchmark (isolated)
Only if the user asks. Build/patch ab-av1 under `tools/benchmark-ab-av1/` from the **actual** upstream source (inspect real files; do not trust line numbers in the source doc), compare against the production CQ search on the same samples, report in BENCHMARKS.md. Must not affect production code.

## 13. Observability and operations
Structured JSON logs (pino / Python `logging` JSON) with request/recording/camera ids; `/healthz`, `/readyz`; per-service healthchecks; log rotation (`json-file` max-size/max-file); graceful shutdown handlers everywhere; metrics endpoint optional. Every ffmpeg invocation logs its sanitized command and exit status; stderr tail kept in `failure_reason` on failure.

## 14. Definition of Done (final checklist)
- [ ] All phase gates PASS (UNVERIFIED-HW items listed and handed to the user with exact commands).
- [ ] No TODO/FIXME/stubs/mocks in production code; `make verify` green; `make verify-gpu` documented.
- [ ] Errata E1–E20 each have a test or a documented decision.
- [ ] Raw data is never deleted without `verified_at`; proven by test G4.4/G4.7/G4.8/G4.9.
- [ ] Credentials never leak (test G3.3).
- [ ] `docs/` complete: ARCHITECTURE, RUNBOOK, DECISIONS, VERSIONS, BENCHMARKS, PROGRESS.
- [ ] Clean-clone start works with one command.

## Appendix A — COCO groups (names come from `model.names` at runtime; this table is asserted by test G2.1)
| Group | Default | Ids |
|---|---|---|
| Person | ON | 0 |
| Vehicles | ON | 1 bicycle, 2 car, 3 motorcycle, 5 bus, 7 truck |
| Pets | ON | 14 bird, 15 cat, 16 dog |
| Luggage | OFF | 24 backpack, 25 umbrella, 26 handbag, 28 suitcase |
| Sharp & Dangerous | OFF | 34 baseball bat, 39 bottle, 43 knife, 76 scissors |
| Devices | OFF | 62 tv, 63 laptop, 64 mouse, 66 keyboard, 67 cell phone |
| Everything else | OFF | remaining ids 0–79 via Advanced Class Drawer |

## Appendix C — Report templates
**Gate Report**
```
## GATE <n> REPORT — <PASS | PARTIAL | FAIL>
Skills used: <names or "none matched">
| Check | Command | Result | Evidence (file/line in PROGRESS.md) |
UNVERIFIED-HW (with the exact command the user must run):
Deviations (DECISIONS ids):
Open risks / blockers:
Next: waiting for "GO PHASE <n+1>"
```
**DECISIONS entry:** `D-xxx | date | context | options considered | choice | evidence | reversible? (y/n)`
