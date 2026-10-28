# Smart VMS Architecture Document

This document describes the high-level architecture, module decomposition, pipeline lifecycles, and security boundaries of the Smart Video Management System (VMS).

---

## 1. System Topology & Data Flow

```mermaid
flowchart TD
    subgraph Edge ["Cameras & Sources"]
        Hikvision["Hikvision IP Camera\n(RTSP 1080p25)"]
        SimCams["Simulated Cameras 1-3\n(FFmpeg testsrc / smpte)"]
    end

    subgraph MediaRouter ["Media Routing Layer"]
        MediaMTX["MediaMTX Server\n(RTSP/HLS/WebRTC WHEP)"]
    end

    subgraph CoreServices ["VMS Engine Services"]
        Recorder["vms-recorder\n(Zero-CPU Supervised FFmpeg)\nFragmented MP4"]
        Vision["vms-ai-vision-worker\n(YOLO26n FP16 PyTorch)\nActivity Indexer & NVML"]
        Transcoder["vms-transcode-worker\n(BullMQ + NVENC + VMAF)\nChunked Bisection Search"]
    end

    subgraph DataPlane ["Persistence & State"]
        MySQL[("MySQL 8.4\nRecordings, Chunks, Probes, Events")]
        Redis[("Redis 7.4\nPub/Sub, Rev Sync, Rate Limits")]
        Disk[("/data\n/data/raw, /data/compressed, /data/snapshots")]
    end

    subgraph ApplicationPlane ["API & Frontend"]
        APIServer["vms-api-server\n(Express 5 + Socket.IO + Zod)"]
        Dashboard["vms-web-dashboard\n(Vue 3 + Tailwind v4 + Nginx)"]
    end

    Hikvision -->|RTSP TCP| MediaMTX
    SimCams -->|RTSP TCP| MediaMTX

    MediaMTX -->|Single Internal Pull| Recorder
    MediaMTX -->|Single Internal Pull| Vision
    MediaMTX -->|WebRTC / HLS| Dashboard

    Recorder -->|Write .mp4 Fragments| Disk
    Recorder -->|Status RECORDING->RAW| MySQL
    Recorder -->|camera:changed| Redis

    Vision -->|BBoxes & Classes| Redis
    Vision -->|Windows & Dedupe| MySQL
    Vision -->|cam:rev & classes| Redis

    APIServer <-->|Pub/Sub & Sockets| Redis
    APIServer <-->|Queries & Migrations| MySQL
    APIServer -->|Range 206 Playback| Disk

    Transcoder <-->|Queue & Watermark| Redis
    Transcoder <-->|Status & Probe Logs| MySQL
    Transcoder -->|Read Raw & Write AV1| Disk

    Dashboard <-->|REST & Socket.IO| APIServer
```

---

## 2. Core Pipelines

### A. Zero-CPU Capture & Fragmentation Pipeline
1. **Single Connection Ingestion**: MediaMTX pulls one stream per camera (`rtsp://mediamtx:8554/cam{ID}`).
2. **Crash-Safe Segmenting**: FFmpeg captures the RTSP feed using `-c copy -f mp4 -movflags frag_keyframe+empty_moov+default_base_moof` in 10-second segments.
3. **Continuous Playability**: Every fragment is fully readable and browser-playable without requiring finalization.
4. **Resilience & Reconciliation**: If the recorder crashes (`SIGKILL`), the startup reconciler inspects orphaned `RECORDING` rows. Valid fragments are finalized as `RAW`; 0-byte or unreadable fragments are documented as `SKIPPED` per Decision D-006.

### B. AI Vision & Dynamic Class Filtering Pipeline
1. **Frame Ingestion**: PyAV reads the stream at `AI_FPS=10.0` with a bounded drop queue.
2. **YOLO26n Inference**: Single loaded PyTorch CUDA engine executes inference across all active cameras.
3. **Sub-Second Class Toggle**: Class masks (Person, Vehicles, Pets, Custom) are stored in Redis (`cam:{id}:classes`) with monotonic revision tracking. Toggling classes updates in-memory filter sets in < 1 second without reloading the neural network.
4. **Forensic Activity Indexing**: Weights detections (`person=3, vehicle=2, pet=1, other=1`) over 20-second time-aligned windows (`recording_activity_windows`).

### C. Smart Probing & Hardware Transcoding Pipeline
1. **Prioritization Scheduler**: Shortest-job-first + aging + activity weighting formula selects candidate recordings.
2. **Peak Window Selection**: Selects the highest activity 20-second window for each 10-minute chunk.
3. **Bisection CQ Search**: Probes the peak window using NVENC (`av1_nvenc` / `hevc_nvenc`) and evaluates quality with `libvmaf_cuda` in ≤ 5 iterations until reaching optimal CQ satisfying Mean ≥ 85.0 and p25 ≥ 81.0.
4. **Chunked Encode & Concat**: Encodes independent chunks at their optimal CQ and joins them with `-c copy` and `+faststart`.
5. **5-Point Verification**: Before unlinking raw data, verifies ffprobe compliance, frame count match, decode completeness, sample VMAF score, and positive size reduction.

---

## 3. Trust Boundaries & Security Architecture (Spec §10)

| Boundary | Threat (STRIDE) | Enforced Mitigation |
|---|---|---|
| **Client $\to$ API** | Spoofing, Elevation | Argon2id password hashing, 15-min JWT access tokens, rotating `httpOnly; SameSite=Strict; Secure` refresh cookies, Socket.IO handshake auth |
| **API $\to$ Database** | Tampering, Injection | 100% parameterized SQL queries via `mysql2/promise` with `?` placeholders; zero string-interpolated SQL |
| **Client $\to$ Filesystem** | Information Disclosure | `isPathSafe` verifies `path.resolve` strictly resides within `/data/raw` or `/data/compressed`; traversal sequences (`../`) rejected with 403 |
| **RTSP Credentials** | Information Disclosure | Encrypted with AES-256-GCM using 32-byte `CREDENTIAL_KEY`; masked as `rtsp://***:***@host` in all responses, logs, and sockets |
| **Docker Network** | Denial of Service, Tampering | MySQL and Redis are unexposed to the host network; Redis protected by `requirepass`; external access routed strictly through Nginx reverse proxy |
| **OS Processes** | Remote Code Execution | Zero shell executions (`spawn(file, args[])` used exclusively); no `child_process.exec` in production code |

---

## 4. Legal & Compliance Notice

- **Ultralytics YOLO**: Licensed under GNU Affero General Public License v3.0 (AGPL-3.0). Any network service interacting with modified derivatives must provide source code availability under AGPL-3.0.
- **FFmpeg Nonfree**: Binaries linking `libvmaf` and NVIDIA NVENC proprietary SDK headers fall under FFmpeg `--enable-nonfree`. They are intended for internal self-hosted enterprise deployment and must not be redistributed commercially as public pre-compiled binaries.

