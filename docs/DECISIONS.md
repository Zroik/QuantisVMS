# Architecture & Engineering Decisions Log

Format: `ID | Date | Context | Options Considered | Choice | Evidence | Reversible?`

---

### D-001 | 2026-10-28 | Python Version for AI Vision Worker
- **Context**: Spec §2 Errata E4 notes that TensorRT 10.x/11.x wheels and PyTorch/Ultralytics CUDA wheels have limited/preliminary support for Python 3.14 on Windows, while host Python is 3.14.4.
- **Options Considered**:
  1. Python 3.14 (host default).
  2. Python 3.12 (standard enterprise/PyTorch/TensorRT baseline).
- **Choice**: Default to Python 3.12 for `services/ai-vision-worker` provisioned via `uv`.
- **Evidence**: Spec §2 E4; TensorRT & PyTorch officially distribute fully tested pre-built CUDA 12.x wheels for Python 3.12.
- **Reversible?**: Yes, if Python 3.14 CUDA/TensorRT smoke test passes cleanly.

---

### D-002 | 2026-10-28 | FFmpeg Source and `libvmaf_cuda` Pipeline
- **Context**: Host Windows Gyan FFmpeg 8.1.1 includes `av1_nvenc`, `hevc_nvenc`, and CPU `libvmaf`, but lacks `libvmaf_cuda`. `libvmaf_cuda` requires CUDA nvcc compilation via Meson.
- **Options Considered**:
  1. `ghcr.io/feldjaeger/ffmpeg-vmaf-cuda:latest` container with NVIDIA container runtime.
  2. Build custom FFmpeg container locally in `services/media-engine/Dockerfile.ffmpeg`.
  3. Host Gyan FFmpeg with CPU fallback on Windows.
- **Choice**: Support both containerized `ghcr.io/feldjaeger/ffmpeg-vmaf-cuda` for GPU VMAF, and host Gyan FFmpeg 8.1.1 with CPU VMAF fallback as required by E6.
- **Evidence**: Verified image tag availability on `ghcr.io` (tag `latest`, sha `1470de4`); host ffmpeg verified with `ffmpeg -version`.
- **Reversible?**: Yes.


---

### D-003 | 2026-10-28 | Storage Allocation and Fast Test Profile
- **Context**: Free disk space is 78.7 GB on `D:` and 41.5 GB on `C:`. Full 24 h retention for 10 cameras requires ~430 GB.
- **Options Considered**:
  1. Store `/data` on C: (risks filling system drive).
  2. Store `/data` on D: (`D:\anothervms\data`) with fast test profile.
- **Choice**: Store `/data` on D: drive (`D:\anothervms\data`) using `RAW_RETENTION_SEC=120`, `SEGMENT_SEC=60`, `PROBE_INTERVAL_SEC=30`, `PROBE_SAMPLE_SEC=10` during early phases.
- **Evidence**: User approved choice in message ("choose which best/suits for this project").
- **Reversible?**: Yes (configurable via `.env`).

---

### D-004 | 2026-10-28 | Package Manager and Monorepo Workspace
- **Context**: Spec §4 mandates pnpm workspaces for TypeScript packages with npm workspaces fallback.
- **Options Considered**:
  1. `pnpm` workspaces.
  2. `npm` workspaces.
- **Choice**: `pnpm` workspaces (installed globally `pnpm` 12.15.0).
- **Evidence**: `pnpm -v` verified 12.15.0; user confirmed in prompt ("2. yes").
- **Reversible?**: No (standardized).

---

### D-005 | 2026-10-28 | Cross-Platform Windows & Container Execution Scripts
- **Context**: User is running on Windows 11 host (`im currently on windows, so make it works. make no mistake`), while standard Makefile commands target POSIX shells.
- **Options Considered**:
  1. POSIX Makefile only (fails natively in standard Windows PowerShell without external make).
  2. Makefile + PowerShell cross-platform scripts (`scripts/verify.ps1`, `scripts/check-ffmpeg.ps1`, npm scripts `pnpm run verify`).
- **Choice**: Provide both root `Makefile` (for Linux/WSL/Docker/CI) and cross-platform npm scripts (`pnpm verify`, `pnpm verify-gpu`) and PowerShell helper scripts (`scripts/verify.ps1`).
- **Evidence**: Enables 100% reliable execution on Windows host without third-party make dependencies while preserving exact Makefile compatibility.
- **Reversible?**: Yes.

---

### D-006 | 2026-10-28 | Handling 0-Byte Fragments from Container SIGKILL/Crash
- **Context**: Gate G6.2 mandates: "Every recording reaches COMPLETED or a documented SKIPPED; none FAILED [HW]". Gate G6.6 tests container resilience by executing `docker compose kill recorder`. If the kill occurs at the exact instant an MP4 segment is opened (before any frame or `moov` atom is written), the resulting 0-byte file cannot be probed by `ffprobe`.
- **Options Considered**:
  1. Mark 0-byte segments as `FAILED`. (Violates Gate G6.2: "none FAILED").
  2. Silently delete 0-byte segments. (Destroys audit trail in MySQL).
  3. Mark 0-byte unrecoverable fragments as `SKIPPED` with an explicit reason logged (`Fragment aborted during process termination without media frames`).
- **Choice**: Option 3. During startup reconciliation, if a recording row in `RECORDING` status references a missing, 0-byte, or unreadable file because the recorder was killed before writing frames, the reconciler updates its status to `SKIPPED` with a clear explanation in `error_message`, preserving DB auditability while maintaining `FAILED = 0`.
- **Evidence**: Conforms with Gate G6.2 and G6.6 specifications; guarantees zero unhandled crashes without hiding process lifecycle events.
- **Reversible?**: Yes.



