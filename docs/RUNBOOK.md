# Quantis Operations Runbook

This runbook provides administrative procedures, database backup/restore workflows, troubleshooting guides, and GPU maintenance instructions for operators of Quantis Video Management System.

---

## 1. Quick Operations Reference

### Service Management
```bash
# Start full production stack
docker compose up -d

# Start development stack with simulated cameras and local port mappings
docker compose -f docker-compose.yml -f docker-compose.dev.yml --profile dev up -d

# Check health and container statuses
docker compose ps

# View unified live logs
docker compose logs -f

# View specific service logs
docker compose logs -f transcode-worker
docker compose logs -f ai-vision-worker
docker compose logs -f recorder
```

---

## 2. Database Backup & Disaster Recovery

### Creating a Full Database Backup
```bash
# Timestamped MySQL dump
BACKUP_FILE="/data/backups/vms_backup_$(date +%Y%m%d_%H%M%S).sql"
mkdir -p /data/backups

docker exec vms-mysql mysqldump \
  -u vms_user \
  -pvms_password_secret \
  --single-transaction \
  --quick \
  --triggers \
  --routines \
  vms_db > "${BACKUP_FILE}"

echo "Backup written to ${BACKUP_FILE}"
```

### Restoring from Backup
```bash
# Stop ingestion and workers before restoring state
docker compose stop recorder transcode-worker ai-vision-worker

# Restore schema and records
cat "${BACKUP_FILE}" | docker exec -i vms-mysql mysql -u vms_user -pvms_password_secret vms_db

# Restart services
docker compose start recorder transcode-worker ai-vision-worker
```

---

## 3. Zero-Downtime Service Upgrades

To upgrade application containers without losing live camera footage:

1. **Rebuild Application Images**:
   ```bash
   pnpm build
   docker compose build api-server transcode-worker ai-vision-worker web-dashboard
   ```

2. **Sequential Rolling Restart**:
   - Restart `api-server` (Recording processes continue uninterrupted):
     ```bash
     docker compose up -d --no-deps api-server
     ```
   - Restart `ai-vision-worker` (Camera RTSP ingest remains open in MediaMTX):
     ```bash
     docker compose up -d --no-deps ai-vision-worker
     ```
   - Restart `transcode-worker` (BullMQ gracefully pauses job processing during shutdown):
     ```bash
     docker compose up -d --no-deps transcode-worker
     ```
   - Recreate `recorder` (Startup reconciler auto-finalizes any open fragments per Decision D-006):
     ```bash
     docker compose up -d --no-deps recorder
     ```

---

## 4. NVIDIA GPU & Driver Maintenance (RTX 4060 Laptop GPU)

### System Requirements
- **Host GPU**: NVIDIA GeForce RTX 4060 Laptop GPU (8GB VRAM) or desktop Ada Lovelace / Ampere GPU.
- **NVIDIA Driver**: Version $\ge 550.00$ on Windows host (WSL2 GPU passthrough) or native Linux.
- **NVIDIA Container Toolkit**: Installed and registered inside WSL2 (`/etc/docker/daemon.json` configured with default runtime `nvidia`).

### Verifying GPU Passthrough
```bash
# Verify inside WSL2 container
docker run --rm --gpus all nvidia/cuda:12.4.1-base-ubuntu22.04 nvidia-smi

# Check FFmpeg NVENC and CUDA VMAF
docker run --rm --gpus all ghcr.io/feldjaeger/ffmpeg-vmaf-cuda:latest -encoders | grep nvenc
docker run --rm --gpus all ghcr.io/feldjaeger/ffmpeg-vmaf-cuda:latest -filters | grep vmaf
```

---

## 5. Troubleshooting & Diagnostics

### A. Hikvision Camera 401 Unauthorized
- **Symptom**: `DESCRIBE failed: 401 Unauthorized` in recorder or worker logs.
- **Cause**: IP cameras enforce HTTP Digest Authentication over RTSP. Special characters in passwords must be URL-encoded, and trailing sentence punctuation must not be included.
- **Solution**: Test RTSP URL with `ffprobe`:
  ```bash
  ffprobe -rtsp_transport tcp "rtsp://admin:SecretPassword123%40@192.168.1.100:554/Streaming/Channels/101"
  ```

### B. Segment Files Not Appearing in MySQL on WSL Bind Mounts
- **Symptom**: Media files exist in `/data/raw/camX/`, but database rows remain in `RECORDING` or are not registered.
- **Cause**: Linux `inotify` file creation events do not propagate reliably across WSL2 NTFS mounts (`/mnt/d/...`).
- **Solution**: The `vms-recorder` service includes a 1000ms directory polling fallback (`fsp.readdir`) to guarantee file detection regardless of filesystem event driver.

### C. VRAM Exhaustion or GPU Watchdog Timeout
- **Symptom**: `libvmaf_cuda` hangs or reports CUDA out-of-memory.
- **Remediation**:
  1. The VMAF runner enforces an automated watchdog timeout (`max(60s, 6 × sample_duration)`).
  2. If CUDA encounters a timeout, it falls back to CPU VMAF (`libvmaf` with 16 threads) and logs `backend='cpu'`.
  3. Ensure `TRANSCODE_CONCURRENCY=1` in `.env` to prevent multi-job VRAM contention on 8GB GPUs.

### D. 0-Byte Fragments on Hard Termination
- **Symptom**: Unplanned container crash leaves empty `.mp4` file.
- **Remediation**: Startup reconciler checks file duration via `ffprobe`. 0-duration fragments are transitioned to documented status `SKIPPED` with explanation in `failure_reason` (Decision D-006).

---

## 6. Storage Watermarks and Retention Management

- **High Watermark (85%)**: When disk usage exceeds 85%, the transcode scheduler triggers early enqueuing of the oldest RAW recordings regardless of the standard 24-hour retention window.
- **Critical Watermark (95%)**: Emits high-priority alert to Redis `system:alert` and Socket.IO.
- **Zero-Loss Guarantee**: Raw recordings are **NEVER** deleted without a valid `verified_at` timestamp confirming that the compressed replacement passed ffprobe validation, frame count checks, full decode, and sample VMAF scores.

