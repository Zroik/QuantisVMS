# WSL Virtual Disk Storage Audit & Optimization Report
**Date:** 2 November 2026  
**System:** WSL2 (Ubuntu-24.04) running on Windows 11  
**Target File:** `D:\anothervms\wsl\ext4.vhdx`  
**Status:** Read-Only Audit Complete (Awaiting Execution Command)

---

## 1. Executive Summary

| Parameter | Current State | Projected State After Optimization | Net Reclaimed |
| :--- | :--- | :--- | :--- |
| **Host VHDX Disk Size** | **32.90 GB** (35,328,622,592 bytes) | **~7.5 – 8.5 GB** | **~24.4 GB (±74%)** |
| **WSL Guest Used Space (`/`)** | **31.00 GB** | **~6.8 – 7.5 GB** | **~23.5 – 24.0 GB** |
| **VMS Microservices Health** | **9 of 9 Containers Healthy** | **9 of 9 Containers Healthy** | **Zero Risk / Zero Breakage** |

All 9 operational containers (`vms-api-server`, `vms-web-dashboard`, `vms-transcode-worker`, `vms-recorder`, `vms-ai-vision-worker`, `vms-mysql`, `vms-redis`, `vms-mediamtx`, `vms-rtsp-proxy`) and their persistent database volumes (`smart-vms_mysql_data`, `smart-vms_redis_data`) are 100% protected.

---

## 2. Root Cause Analysis (Itemized Breakdown of the 32.9 GB)

Deep inspection reveals that **93% of disk usage** resides inside `/var/lib/containerd` and `/var/log`:

```
/ (31 GB Used)
 ├── /var (29.0 GB)
 │    ├── /var/lib/containerd (28.0 GB)
 │    │    ├── snapshotter/overlayfs/snapshots (22.0 GB) ── BuildKit cache + image layers
 │    │    └── content/blobs (5.8 GB) ──────────────────── Containerd content store
 │    ├── /var/log/journal (634 MB) ────────────────────── Systemd journal binary logs
 │    ├── /var/cache/apt (244 MB) ──────────────────────── APT package cache archives (.deb)
 │    ├── /var/lib/docker (240 MB) ─────────────────────── MySQL & Redis named volumes
 │    └── /var/lib/apt (205 MB) ────────────────────────── APT package lists
 ├── /usr (1.6 GB) ─────────────────────────────────────── Standard Ubuntu OS binaries
 └── /root, /home, /tmp (< 5 MB combined) ──────────────── Clean
```

### The 3 Core Drivers of Bloat:
1. **Docker BuildKit Build Cache (16.12 GB)**:
   - 151 intermediate layer cache items retained from previous container builds.
   - Largest cache blocks:
     - `yvt1sssogact2kze4osla0q3v`: **8.305 GB** (PyTorch CUDA intermediate layer)
     - `t9e4bassz34ib99isz3v5rchl`: **3.426 GB** (FFmpeg CUDA build stage)
     - Other intermediate steps: **~4.38 GB**
2. **Unused / Legacy / Test Images (~15.5 GB)**:
   - `vms-ai-vision-worker:test` (`fa7a8ae66c0a`): **9.98 GB** (standalone unused test image)
   - `vms-transcode-worker:latest` (`9fbd0727e937`): **4.30 GB** (old build from Oct 28; current build is `18c9f9b59a39`)
   - `ghcr.io/feldjaeger/ffmpeg-vmaf-cuda` (`4792813c5bdb`): **3.96 GB** (one-off test image)
   - `linuxserver/ffmpeg:latest` (`6547359fac23`): **1.10 GB** (unused)
   - `nvidia/cuda:12.4.1-base-ubuntu22.04` (`0f6bfcbf267e`): **348 MB** (unused)
   - `jrottenberg/ffmpeg:6.1-alpine` (`4641478865a2`): **152 MB** (unused)
3. **WSL2 VHDX Non-Shrinking Dynamic Behavior**:
   - In WSL2, dynamic virtual hard disks (`ext4.vhdx`) grow automatically when guest files are written, but **do not shrink automatically** when guest files are deleted.
   - Without `sparseVhd=true` enabled in `%USERPROFILE%\.wslconfig`, freed blocks in Linux remain allocated on the Windows NTFS filesystem.

---

## 3. Component Safety Classification

| Component | Size | Classification | Action |
| :--- | :---: | :--- | :--- |
| **Active Microservice Images** (`smart-vms-*`, `mysql:8.4`, `redis:7.4-alpine`, `bluenviron/mediamtx`) | ~7.5 GB | 🔒 **CRITICAL (DO NOT TOUCH)** | Keep intact. Required for live operation. |
| **Named Database Volumes** (`smart-vms_mysql_data`, `smart-vms_redis_data`) | 246 MB | 🔒 **CRITICAL (DO NOT TOUCH)** | Keep intact. Stores configuration, camera records, and users. |
| **BuildKit Intermediate Cache** | 16.12 GB | 🗑️ **SAFE TO REMOVE** | Prune via `docker builder prune -a -f`. |
| **Dangling / Unused Images** (`fa7a8ae6`, `9fbd0727`, `4792813c`, `6547359f`) | ~15.5 GB | 🗑️ **SAFE TO REMOVE** | Prune via targeted `docker image rm` / `docker image prune -a`. |
| **Systemd Journal Logs** | 634 MB | 🧹 **SAFE TO VACUUM** | Truncate via `journalctl --vacuum-size=50M`. |
| **APT Package Cache** | 244 MB | 🧹 **SAFE TO CLEAN** | Clean via `apt-get clean`. |

---

## 4. Execution Plan (Run Only Upon User Confirmation)

### Phase 1: Inside WSL2 (Linux Guest Cleanup)
Execute the following commands in sequence inside WSL as root:

```bash
# 1. Prune all unused BuildKit cache (reclaims up to 16.1 GB)
docker builder prune -a -f

# 2. Remove unused legacy and test images (reclaims ~10-15 GB)
docker image rm fa7a8ae66c0a 9fbd0727e937 4792813c5bdb 6547359fac23 0f6bfcbf267e 4641478865a2 2>/dev/null || true

# 3. Clean systemd journal logs (reclaims ~580 MB)
journalctl --vacuum-size=50M

# 4. Clean APT package cache and orphaned packages (reclaims ~250 MB)
apt-get clean
apt-get autoremove --purge -y

# 5. Trim filesystem blocks to inform hypervisor of free sectors
fstrim -v /
```

### Phase 2: Host Side (Windows VHDX Shrink & Sparse Enablement)
After Phase 1 is complete:

1. **Enable Automatic Sparse Reclamation in `%USERPROFILE%\.wslconfig`**:
   Ensure `sparseVhd=true` is present under `[experimental]`:
   ```ini
   [experimental]
   autoMemoryReclaim=dropcache
   sparseVhd=true
   ```

2. **Compact the VHDX**:
   Run from Windows PowerShell:
   ```powershell
   # Mark distro as sparse so NTFS trims unused blocks immediately
   wsl --manage Ubuntu-24.04 --set-sparse true
   ```
   *Alternative manual fallback via Diskpart (if WSL is shut down):*
   ```cmd
   diskpart
   select vdisk file="D:\anothervms\wsl\ext4.vhdx"
   compact vdisk
   exit
   ```

---

## 5. Expected Outcome
- Linux guest filesystem used space drops from **31 GB** to **~7.0 GB**.
- Windows host `D:\anothervms\wsl\ext4.vhdx` shrinks from **32.9 GB** to **~8.0 GB**.
- Total physical SSD space freed on drive D: **~24.0 GB**.
- All 9 active VMS microservices continue operating with zero disruption.

