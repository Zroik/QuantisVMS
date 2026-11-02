<div align="center">

<img src="quantis_transparent.png" alt="Quantis Logo" width="180"/>

# Quantis VMS
### Enterprise AI Video Management System with Hardware-Accelerated Transcoding & Real-Time Analytics

[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue.svg)](https://www.typescriptlang.org/)
[![Vue 3](https://img.shields.io/badge/Vue-3.5-brightgreen.svg)](https://vuejs.org/)
[![NVIDIA CUDA](https://img.shields.io/badge/NVIDIA-CUDA_12.4-76B900.svg)](https://developer.nvidia.com/cuda-toolkit)
[![Docker](https://img.shields.io/badge/Docker-Compose_v2-2496ED.svg)](https://www.docker.com/)
[![License](https://img.shields.io/badge/License-AGPL--3.0-orange.svg)](LICENSE)

*Zero-CPU Raw RTSP Ingestion • Dynamic YOLOv8 Object Detection • AI-Guided VMAF-Gated NVENC Compression • Multi-Camera Timeline & ONVIF Discovery*

</div>

---

## 🌟 Key Highlights

- **Zero-CPU Stream Capture**: Ingests multi-camera RTSP feeds directly into fragmented MP4 (`frag_keyframe+empty_moov+default_base_moof`) without re-encoding, preserving exact original stream fidelity at minimum disk write overhead.
- **Hardware-Accelerated AI Vision**: Real-time object detection using YOLO (`yolov8n.pt` / YOLO26n) with TensorRT/CUDA acceleration, delivering live bounding-box overlays over WebSockets and dynamic class toggling (`person`, `vehicle`, `pet`, `other`).
- **AI-Guided VMAF-Gated NVENC Compression**:
  - Automatically identifies peak forensic activity windows within raw recordings.
  - Runs GPU-accelerated Bisection CQ search using `libvmaf_cuda` to find the optimal Constant Quality (`av1_nvenc` / `hevc_nvenc`) ensuring perceptual quality targets (Mean VMAF $\ge 85.0$, p25 $\ge 81.0$).
  - Performs 5-point atomic verification (ffprobe validation, frame count parity, full decode check, sample VMAF re-check, and file size reduction) before safe raw deletion.
- **Enterprise ONVIF Support**: Full ONVIF discovery probe, Profile S/T compatibility, PTZ controls, imaging presets, and RTSP Digest authentication with AES-256-GCM credential encryption at rest.
- **Modern Responsive Web Dashboard**: Dark/Light mode, multi-camera live matrix, 24-hour timeline scrubbing with forensic event overlays, hardware telemetry charts, and system configuration console.

---

## 🏗️ System Architecture

```mermaid
flowchart TD
    CAM["IP Cameras / ONVIF Feeds"] --> PROXY["RTSP Proxy (Port 8555)"]
    PROXY --> MTX["MediaMTX Server (Port 8554 / 8889)"]
    
    MTX -->|RTSP Passthrough| REC["vms-recorder (Zero-CPU Ingest)"]
    MTX -->|WebRTC / HLS| DASH["vms-web-dashboard (Port 8080)"]
    MTX -->|RTSP Raw Stream| AI["vms-ai-vision-worker (YOLO CUDA)"]
    
    REC -->|Raw .mp4| RAW_DIR[("/data/raw")]
    AI -->|Realtime Telemetry & BBoxes| REDIS[("vms-redis (Port 6380)")]
    
    RAW_DIR --> WORKER["vms-transcode-worker (NVENC + libvmaf_cuda)"]
    WORKER --> COMP_DIR[("/data/compressed")]
    
    API["vms-api-server (Port 3000)"] <--> MYSQL[("vms-mysql (Port 3307)")]
    API <--> REDIS
    API <--> DASH
```

---

## 💻 Hardware Requirements

Quantis is engineered to leverage modern NVIDIA GPU hardware capabilities:

| Component | Minimum Specification | Recommended Specification |
| :--- | :--- | :--- |
| **Processor** | 4-Core x86_64 CPU | 8-Core / 16-Thread (AMD Ryzen 7 or Intel Core i7) |
| **RAM** | 8 GB RAM | 16 GB RAM |
| **GPU** | NVIDIA GTX 1060 (6 GB VRAM) with NVENC support | NVIDIA RTX 4060 / 4070 (8 GB+ VRAM, Ada architecture with AV1/HEVC NVENC) |
| **Storage** | 256 GB SSD (NVMe recommended for concurrent writes) | 1 TB+ NVMe SSD |
| **Host OS** | Windows 11 with WSL2 (Ubuntu 22.04 / 24.04) or native Linux (Ubuntu 22.04+) | Ubuntu 24.04 LTS or Windows 11 WSL2 |

---

## 📦 Prerequisites

Before installing Quantis, ensure the following software is installed on your host machine:

1. **Docker Engine & Docker Compose v2**:
   - Install [Docker Desktop](https://www.docker.com/products/docker-desktop/) on Windows/macOS or `docker-ce` on Linux.
2. **NVIDIA Container Toolkit** (for GPU acceleration):
   - On Linux/WSL2, install `nvidia-container-toolkit` and configure the Docker runtime:
     ```bash
     sudo apt-get install -y nvidia-container-toolkit
     sudo nvidia-ctk runtime configure --runtime=docker
     sudo systemctl restart docker
     ```
   - Verify GPU access inside Docker:
     ```bash
     docker run --rm --gpus all nvidia/cuda:12.4.1-base-ubuntu22.04 nvidia-smi
     ```
3. **Node.js LTS (v22+) & pnpm**:
   - Install Node.js: `https://nodejs.org/`
   - Enable pnpm: `corepack enable pnpm`
4. **Python 3.12 & uv** (for native test execution):
   - Install `uv`: `pip install uv`

---

## 🚀 Quick Start (Clean Installation)

Follow these steps to clone, build, and launch Quantis on a new device:

### 1. Clone Repository
```bash
git clone https://github.com/your-username/quantis.git
cd quantis
```

### 2. Configure Environment
Copy the example environment configuration:
```bash
# On Linux / WSL / macOS
cp .env.example .env

# On Windows Command Prompt
copy .env.example .env
```
*(Optional: Open `.env` and configure custom database passwords, JWT secret, or camera storage paths).*

### 3. Install Monorepo Dependencies & Compile Binaries
Quantis mounts pre-compiled distribution bundles into lightweight production containers. Run the build command once before starting the stack:
```bash
# Install workspace dependencies
pnpm install

# Build all microservices (TypeScript, Vue 3, Migrations)
pnpm build
```

### 4. Launch the Docker Stack
Start all microservices in detached mode:
```bash
# Start all 9 microservices
docker compose up -d

# Or on Windows using helper batch scripts:
start-vms.bat     # Launches the complete container stack
stop-vms.bat      # Gracefully stops all microservices
compact-wsl.bat   # Shrinks and reclaims unused WSL2 virtual disk storage (Run as admin)
```

### 5. Access the Web Dashboard
Open your browser and navigate to:
- **Web Dashboard**: [http://localhost:8080](http://localhost:8080) (or [http://localhost:5173](http://localhost:5173))
- **API Server & Healthcheck**: [http://localhost:3000/healthz](http://localhost:3000/healthz)
- **MediaMTX WebRTC Stream Gateway**: [http://localhost:8889](http://localhost:8889)

**Default Credentials**:
- Username: `admin`
- Password: `AdminPassword123!` *(or seeded credentials from your `.env`)*

---

## 🚢 Service Architecture & Ports

| Service | Container Name | Host Port | Purpose |
| :--- | :--- | :--- | :--- |
| **Web Dashboard** | `vms-web-dashboard` | `8080`, `5173` | Vue 3 + Tailwind responsive management interface |
| **API Server** | `vms-api-server` | `3000` | REST API, WebSocket gateway, authentication, camera sync |
| **MediaMTX** | `vms-mediamtx` | `8554` (RTSP), `8889` (WebRTC), `8888` (HLS), `9997` (API) | Ultra-low latency streaming relay |
| **RTSP Proxy** | `vms-rtsp-proxy` | `8555` | RTSP basic-enforcer proxy for digest cameras |
| **Recorder** | `vms-recorder` | Internal | Zero-CPU segmented raw MP4 capture service |
| **Transcode Worker** | `vms-transcode-worker` | Internal (GPU) | NVENC AV1/HEVC compression with `libvmaf_cuda` validation |
| **AI Vision Worker** | `vms-ai-vision-worker` | Internal (GPU) | Real-time YOLOv8 object detection & telemetry |
| **MySQL Database** | `vms-mysql` | `3307` | Camera metadata, audit logs, recordings index, and users |
| **Redis Broker** | `vms-redis` | `6380` | Pub/Sub event bus, bounding-box streaming, telemetry cache |

---

## 🛠️ Operational Commands & Scripts

Quantis includes a complete suite of developer and operational scripts:

```bash
# Run unit tests across all monorepo workspaces
pnpm test

# Verify all packages and run linters
pnpm verify

# Reset database schema to fresh baseline
pnpm --filter @vms/api-server start:worker

# Verify hardware & GPU NVENC acceleration inside WSL/Linux
make verify-gpu

# Graceful stack shutdown
docker compose down
# (or run stop-vms.bat on Windows)
```

---

## 🔒 Security & Data Encryption

- **Credential Encryption at Rest**: Camera RTSP passwords and tokens are encrypted using **AES-256-GCM** with a master key (`CREDENTIAL_KEY`) stored in `.env`. Database fields store binary ciphertexts; cleartext credentials are never exposed in logs or API responses.
- **RTSP Masking**: All API endpoints and client telemetry automatically redact credentials (`rtsp://***:***@host:port/stream`).
- **Role-Based Access Control (RBAC)**: JWT-based authorization protecting administrative endpoints (`admin` vs `viewer`).

---

## ⚖️ Licensing & Compliance

- **Ultralytics**: Uses YOLO models under the [GNU Affero General Public License v3.0 (AGPL-3.0)](https://www.gnu.org/licenses/agpl-3.0.html). Any derivative work or network-accessible service using this component must comply with AGPL-3.0 provisions.
- **FFmpeg Nonfree Build**: FFmpeg images built with `--enable-nonfree` (incorporating NVIDIA NVENC/CUDA headers and `libvmaf`) produce binaries that are **non-redistributable**. Dockerfiles build or pull from documented public base images locally; never distribute nonfree compiled binary packages to public package registries.

---

<div align="center">
Developed with ❤️ by the Quantis Engineering Team.
</div>
