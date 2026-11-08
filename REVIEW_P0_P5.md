# P0 → P5 Remediation Review

**Date:** 2026-11-08
**Range:** `397c9db` (pre-remediation `up`) → `e35b93b` (P5), plus the review-fix commit `fc6b524`.
**Size:** 75 files, +2945 / −742 before the review fixes; the fixes add a further ~200 lines.
**Method:** three independent read-only passes over the same diff —
1. **Standards** (code quality, security, tests, consistency),
2. **Spec** (vs `docs/VMS_BUILD_SPEC.md` and the remediation claims),
3. **Regression** (correctness/failure modes of the changed logic).

Findings were rated and then adjudicated. The blockers were fixed in `fc6b524`; the remainder are recorded below as open or accepted.

---

## 1. Verdict

- **As reviewed (at `e35b93b`):** *Ship with fixes* — the remediation is real and typechecks/builds/tests green, but the review found **two release blockers** (the §8.6 verifier mis-handled retries; graceful shutdown deadlocked) plus a credential/exposure issue in the new seed path and several Medium correctness defects.
- **After `fc6b524`:** **Approved to continue**, with the residual risks in §6. No known data-loss path remains in the changed code; the open items are hardening/cleanup and hardware validation, not regressions.

---

## 2. Findings — status

Severity: Critical / High / Medium / Low. Status: **Fixed** (in `fc6b524`), **Open**, **Accepted** (documented decision/limitation).

| ID | Sev | Summary | Status |
|---|---|---|---|
| REG-01 / STD-01 / SPEC-02 | High | Verifier measured size/duration before the `cq−2` retry loop, then reused stale values; a retry could exceed raw and still complete. | **Fixed** — re-probe + re-stat + re-apply duration/frame/size gates after retries |
| REG-02 / STD-05 | High | Graceful shutdown awaited `server.close()` before `io.close()`, so any open WebSocket hung it until Docker SIGKILL. | **Fixed** — `io.close()` → `closeAllConnections()` → bounded `server.close()` + force timer |
| STD-03 / REG-12 | High | Login limiter keyed only by IP+username (no per-IP cap; username unbounded → Redis key amplification). | **Fixed** — separate per-IP limiter + username truncated to 64 chars |
| SPEC-01 / BE-01 | High | Consolidator renamed the merged file and unlinked originals without validating duration or decodability. | **Fixed** — duration tolerance vs Σsegments + bounded tail-decode; keep originals on failure |
| REG-03 | High/Med | Media-ticket TTL was clamped to 300 s in `signMediaTicket`, so the "up to 6 h" ticket still died at 5 min. | **Fixed** — cap raised to 6 h |
| BE-01 in audit | High | `AUDIT_2026-11-08.md` listed BE-01 as fixed while `consolidator.ts` was untouched. | **Corrected** (and now actually fixed) |
| REG-01 contract | Med | Final re-check failure threw → `FAILED` + 3× GPU retries, breaking the documented `G4.7` "keep best-effort + flag" behavior. | **Fixed** — only throw when probing passed but the final artifact regressed; unreachable targets complete with `gate=0` + alert |
| REG-04 / STD-06 | Med | Socket `connect_error` refreshed on every error and `refreshAccessToken` cleared auth on network failure → users logged out on a network blip. | **Fixed** — refresh only on auth errors; network failures keep the token |
| REG-05 / STD-01 | Med | `compressed_size_bytes`/savings stale after a retry. | **Fixed** (same change as REG-01) |
| REG-07 | Med | Reconciler catch-all `UPDATE … WHERE id = ?` could flip a freshly finalized `RAW` row to `SKIPPED`. | **Fixed** — `AND status='RECORDING'` |
| REG-08 | Med | AI `add_camera` held the pipelines lock across `pipeline.stop()` (thread joins + DB flush), stalling healthchecks. | **Fixed** — stop outside the lock; `manager.stop()` uses the snapshot |
| REG-09 | Med | Watch + poller could race `processNewFile`, stranding the newest segment. | **Fixed** — per-supervisor file-event promise chain |
| STD-07 | Med | New `seed-cameras.mjs` stored plaintext RTSP credentials in Redis and broadcast them on `camera:changed`. | **Fixed** — `enc:v1:` envelope + masked publish |
| STD-08 | Med | CI `db-backed` job was unreachable (no `workflow_dispatch`) and the proxy tests ran nowhere. | **Fixed** — `workflow_dispatch` + proxy-test step |
| STD-11 | Low/Med | Tile `@keydown.space` (no `.self`) hijacked Space when a nested ONVIF button was focused. | **Fixed** — `.self` on tile key handlers |
| STD-13 / REG-16 | Low/Med | Production logged only the password-file path (README said "logs it once"); a failed write silently lost the only copy. | **Fixed** — README corrected; startup fails in production if the file cannot be written |
| STD-14 / SPEC-13 | Low/Med | UI/docs still claimed `8555`, TensorRT/FP16, `YOLO26n`; README said Digest was pending after it was implemented. | **Fixed** — UI + README + pyproject corrected |
| STD-15 | Low | `TRUST_PROXY=0` was treated as `1`. | **Fixed** — explicit `false`/`0` disable |
| STD-18 | Low | `/assets/` nginx block dropped CSP/HSTS/X-Frame-Options. | **Fixed** — full header set repeated |
| STD-19 | Low | `.env` written with default umask. | **Fixed** — mode `0600` |
| SPEC-06 | Med | Camera validation rejected `rtsps://`. | **Fixed** — `/^rtsps?:\/\//` |
| REG-11 | Med | 300 s idle timeout applied to the client socket could drop healthy RTSP sessions. | **Fixed** — camera 300 s, client ≥ 1800 s |
| REG-13 | Low | Socket.IO CORS default `8080` vs Express `5173`. | **Fixed** — both `8080` |
| REG-06 / STD-02 | Med | `quality_gate_met` is derived from the probe-time gate, not the final re-check. | **Accepted** — the probe gate is the policy signal; the final artifact is guaranteed to pass or the job fails. Documented. |
| STD-04 / REG-14 | Med | SSRF guard is string-only (no DNS/IP canonicalisation) and applied to verify/add-bulk only; device-returned media URLs are unguarded. | **Open** — LAN ranges must stay allowed; needs resolved-IP checks |
| STD-10 | Low | `join:system` has no role check and every dashboard joins it (so it is still effectively broadcast). | **Accepted** — all authenticated users may see operational alerts; not a new exposure |
| STD-12 | Low | Lazy hls.js import has no generation token; a stream switch during import can leak one instance. | **Open** |
| STD-16 | Low | `/api/vmaf/probes` is a third copy of the same query; audit table has both runtime DDL and a migration. | **Open** — refactor |
| STD-17 / SPEC-07 | Low/Med | `recordingStatusUpdates`/`vmafProgress` are stored but unread; `vmaf:progress`/`hw:stats` have no producer. | **Open** — needs UI/relay or removal + spec amendment |
| STD-20 | Low | `enqueueRecording` can report success when an active job already holds the id. | **Open** — minor |
| REG-15 | Low | Frame-parity check reads `nb_frames`, which is usually absent for fragmented MP4 → check is skipped on real data. | **Open** — needs `-count_frames` or `-count_packets` |
| REG-17 | Low | A last chunk shorter than the sample window samples the previous chunk. | **Open** — clamp sample duration per chunk |
| SPEC-04 | Med | `PROBE_SAMPLE_SEC` default 10 vs spec 20; `.env.example` now labels 10 as production. | **Open** — align default/docs |
| SPEC-05 | Med | Recorder lacks `-segment_atclocktime 1` and the HEVC `hvc1` tag from §9.2. | **Open** |
| SPEC-08 | Med | Transcode-worker shutdown does not kill ffmpeg/reset in-flight rows; no startup recovery for `PROBING/ENCODING/VERIFYING`. | **Open** |
| SPEC-09 | Low | Some untouched scripts still carry known-dummy `*_secret` defaults; `db/connection.ts` and the AI worker keep non-production fallbacks. | **Open** (dummy values, low risk) |
| SPEC-10 | Low | Watermark enqueues at CRITICAL; spec says alert-only. | **Open** |
| SPEC-11 / SPEC-12 | Low/Med | Spec design tokens not reconciled; `check-design-tokens`/`check-i18n` still warn-only and unwired. | **Open** (P2 backlog) |
| SPEC-13 | Med | Spec's VMAF Telemetry Center page is still absent (`/vmaf` redirects). | **Open** |

---

## 3. What the review confirmed is genuinely good

- **P0 secrets/hygiene**: masking now URL-parses and handles `@` in passwords (tested); `.env*` excluded from the Docker build context; `gen-env`, `secret-scan`, and the pre-commit hook exist; the leaked value is absent from reachable history; the false "sanitized" claim is gone.
- **P1**: enqueue safety + orphan reconciler (state machine legal; reconciler skips live jobs); Redis error listeners + dedicated finite/timeout rate-limit client; `trust proxy` works with the bundled nginx; playback-ticket refresh; AI decode watchdog/flush-on-stop/pipeline lock; recorder UTC + per-spawn filenames + finalize ordering; proxy idle cap + redis-py; route code-splitting and lazy hls.js (initial bundle ~102 kB).
- **P2**: ONVIF `discover` admin-only, verify no longer returns credential-bearing URIs, family filters parameterized and shared, `/api/vmaf/probes`, config defaults aligned.
- **P3**: fabricated hardware telemetry removed, health derived from thresholds, VMAF coloured by gate, real byte units, error/retry state, tile/scrubber keyboard support, dialog semantics, `<html lang>`, glass removed.
- **P4**: real CI, container hardening (`no-new-privileges`, stop grace, GPU `compute,utility,video`), AI→MediaMTX dependency, AGPL `LICENSE`, honest PROGRESS/RUNBOOK.
- **P5**: graceful shutdown (after fix), `system` room + `recording:status` relay, batched priority query, RTSP Digest with unit-tested helpers.

---

## 4. Phase mapping

| Phase | Commit | Verdict at review | After `fc6b524` |
|---|---|---|---|
| P0 secrets/hygiene | `153413b` | Implemented (residual dummy fallbacks) | Implemented |
| P1 data integrity & UX | `d3bd056`…`19bb62b` | Partial — BE-01 overclaimed; verifier contract bug | Implemented (BE-01 added; verifier fixed) |
| P2 ONVIF/SSRF/family/spec | `0a80338` | Implemented (SSRF partial by design) | Implemented |
| P3 telemetry/a11y/design | `91f909e` | Partial (tokens/i18n gates open) | Partial (documented) |
| P4 CI/hardening/docs | `dc4777d` | Implemented | Implemented |
| P5 shutdown/rooms/perf/digest | `e35b93b` | Partial — shutdown hang; `vmaf:progress` dead | Implemented (shutdown fixed) |

---

## 5. Verification evidence (after the review fixes)

- `pnpm -r run typecheck` — 3/3 pass.
- `pnpm -r run build` — 3/3 pass (web initial bundle ~102 kB; hls.js lazy).
- API DB-free suite — **73/73**; web — **30/30**; recorder — **9/9** (+3 gated).
- AI worker — **35/35** pytest, `ruff check .` clean.
- RTSP proxy Digest helpers — **5/5**; `py_compile` clean.
- `node scripts/scan-secrets.mjs` — PASS.
- `docker-compose.yml` and `.github/workflows/ci.yml` parse.

Not run here: the DB-backed API suite, migrations against a live MySQL, the GPU/NVENC transcode path, MediaMTX/WebRTC, and the proxy against a real digest-only camera.

---

## 6. Residual risks (cannot be verified in this environment)

1. **Hardware**: the §8.6 retry/verification and AV1/HEVC NVENC path need a real GPU run; `av1_nvenc` fails on pre-Ada GPUs.
2. **Digest**: only the pure helpers are tested; convergence against `MD5-sess`, `SHA-512-256`, `qop=auth-int`, or nonce rotation is unverified.
3. **CI**: the workflow has not been executed on GitHub; the DB-backed job requires `workflow_dispatch`.
4. **Timezones**: the recorder now writes UTC; a non-UTC MySQL/API combination would shift activity-window matching (the bundled compose is UTC).
5. **Frame parity**: effectively a no-op on fragmented MP4 until `-count_frames` is added (REG-15).
6. **BullMQ**: scheduler jobs are enqueued with a priority, so they live in the prioritized set — `recomputeHourlyPriorities` uses `getWaiting()` and may not reprioritize them.

---

## 7. Recommended next steps

**Before release**
1. Run the DB-backed API suite and a real GPU end-to-end transcode on the target host; record evidence.
2. Validate RTSP Digest against an actual digest-only camera.
3. Decide `quality_gate_met` semantics (probe vs final re-check) and add the pipeline retry + `enqueueRecording`/reconciler unit tests.

**Then**
4. Frame parity via `-count_frames`; short-last-chunk sampling; transcode-worker graceful reset/ffmpeg kill.
5. SSRF: resolve DNS and check resolved IPs; guard device-returned media URLs.
6. Finish the P2 backlog: design-token reconciliation, i18n completion + gates in CI, VMAF Telemetry page (or spec amendment), `vmaf:progress`/`hw:stats` producer or removal.
7. Cleanup: dedupe the VMAF probe query, GC the socket state maps, align `PROBE_SAMPLE_SEC`, add `-segment_atclocktime`/hvc1.

*This review and the fixes were read-only except for the remediation commit `fc6b524`; no product data was touched.*
