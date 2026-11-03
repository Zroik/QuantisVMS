# FIXES APPLIED — Quantis VMS

**Date:** 2026-11-03
**Scope:** remediation of `FULL_AUDIT_2026-11-03.md`.
**Mode:** code fixes + tests + live Docker verification. No source data deleted.

> This pass closed the P0 set and the highest-value P1 items. It did **not** complete every P2 item (RTSP framing/digest, full i18n/a11y, route code-splitting, audit-log persistence, etc.). Deferred items are listed explicitly in §6 with residual risk. "Fixed" below means the specific behavior was changed and verified; it does not mean every related finding was closed.

---

## 1. Baseline (before)

Captured on the running stack before changes:

| Check | Result |
|---|---|
| `pnpm -r typecheck` / `build` | PASS |
| `pnpm --filter @vms/web-dashboard test` | 13/13 |
| `uv ... pytest` / `ruff` | 28/28, clean |
| Live `/healthz`, `/readyz` | 200, 200 |
| MediaMTX auth | `HTTP 500 {"error":"MEDIAMTX_AUTH_SECRET ... mandatory in production"}` |
| AI worker | `AttributeError: module 'av' has no attribute 'AVError'`; readers dead |
| Recordings | 7 RAW, 3 FAILED, 0 COMPLETED; no new segments |
| `recording_activity_windows` | 0 |
| HLS through 8080 | 302 with `Location: http://127.0.0.1/...` (port dropped) |
| JWT forged with repo default | accepted by `/api/stats` |
| DB tests | `ECONNREFUSED 127.0.0.1:3306` (compose uses 3307) |

---

## 2. Result (after)

| Check | Result |
|---|---|
| Compose services | 8/8 healthy (plus rtsp-proxy/mediamtx up) |
| MediaMTX auth | working; RTSP/HLS/WebRTC sessions created |
| AI worker | connected, no `AVError`; `recording_activity_windows` = **288** |
| New segments | written under `data/raw/cam*` (PID-suffixed names) |
| Recordings | **2 COMPLETED**, 1 SKIPPED, 9 RAW, 2 RECORDING, 3 FAILED |
| Real VMAF | recording #91: `vmaf_mean=85.54`, `quality_gate_met=1`, `compressed_path=/data/compressed/cam1/...mp4` (218 MB → 13.9 MB) |
| `/api/stats` | real queue counts, real GPU name/VRAM/temp, real RAM %, savings from COMPLETED rows only (93.6%) |
| `/readyz` | 200 `{db,redis,mediamtx: ok}` |
| HLS with `?jwt=` | 200 and playlist body |
| JWT signed with old public default | **401** |
| `pnpm test` | PASS (API 101 passed/5 skipped, web 15, recorder 5/3 skipped, Python 30) |
| `pnpm lint` | PASS (real `tsc`/`vue-tsc`; ruff) |
| `pnpm -r typecheck` / `build` | PASS |

---

## 3. Commit log

```
f99a7b3 fix(P0): fail-closed secrets, MediaMTX auth, JWT type separation, real healthchecks
5f84d53 fix(P0): recorder/AI resilience, PyAV errors, canonical detection payload
aab5933 fix(P1): transcode verification, state machine, telemetry honesty, frontend contracts
c7afcdc fix(P1): stop ignoring apps/web-dashboard/src/data source directory
6acff3f fix(P1): password UX, container hardening, encoder migration, check-ffmpeg script
```

---

## 4. Finding status (grouped)

### Fixed / verified

| IDs | What changed | Test / evidence |
|---|---|---|
| OPS-1, INF-01, BE-02, SEC-2, R-S14, X-I11 | `MEDIAMTX_AUTH_SECRET/HOST/API_PORT` passed to api/recorder/AI; secret removed from compose fallbacks; auth hook returns 403 not 500 on missing config; validates action/path; publish requires internal secret/admin; API/metrics excluded in MediaMTX config; rate limit keyed by action+path and raised | `internal.auth.test.ts`; live HLS/RTSP sessions; `readyz` MediaMTX check |
| OPS-2, AI-01 | `av.AVError` → `av.FFmpegError` with version-tolerant alias; clean EOF treated as disconnect; `is_connected=false` in `finally`; backoff on all exit paths | `test_stream_reader.py` (6 tests, including fake `av.open` failure); live AI connected |
| OPS-3, REC-01, R-S1, R-S2, R-S3 | exit code/signal/stderr tail logged; spawn error enters backoff; restart in `finally`; bounded `stop()`; safe Redis publishes; watcher error handler; alert re-arm | `supervisor.test.ts`; live recorder health + new segments |
| OPS-5, INF-04, R-S18 | real healthchecks: recorder heartbeat+DB, AI heartbeat+reader liveness+DB, transcode heartbeat+DB; API `/readyz` checks DB+Redis+MediaMTX; nginx proxies `/readyz`; AI/recorder depended on MediaMTX | live `docker compose ps`; `docker inspect` health logs |
| OPS-6 | nginx HLS redirect preserves host port and query token | live `?jwt=` HLS returns 200 |
| OPS-8, BE-05 | `/api/stats` no longer hardcodes resolutions/bitrates/GPU/queue/RAM; savings computed from COMPLETED rows with nonzero compressed bytes; `.gitkeep` excluded from storage counts; disk usage fails closed (NaN + alert) instead of 50% | `/api/stats` output; `watermark.config.test.ts` |
| OPS-9, SEC-1, BE-01, INF-05 | rotated JWT, credential, MediaMTX, MySQL and Redis secrets; re-encrypted 3 camera credential rows; removed compose fallbacks; startup rejects known-public defaults/all-zero key; old default JWT returns 401 | `credentials.test.ts`, `token-type.test.ts`, live 401 |
| SEC-2, BE-S1 | MediaMTX auth action/path validation; publish restricted | `internal.auth.test.ts` |
| SEC-3/4 (partial) | API/AI/recorder healthchecks, non-root not yet (see deferred); helmet CSP/HSTS present on API | live headers |
| BE-02, X-06 | `getMediaMtxAuthHeader` returns `null`, sync/remove return `false` instead of throwing; camera create/PATCH/PUT include a warning when sync fails; PATCH now updates Redis/MediaMTX | typecheck + live camera sync logs |
| BE-03 (partial), X-04, AI-06 | `camera:changed` includes `enabled`; recorder/AI re-check DB enabled/parent; disabled cameras stop; metadata-only updates do not restart; child slices excluded from recorder/AI; no child MediaMTX paths | live disable behavior path; code review |
| BE-04 | audit-logs admin-gated | route change |
| BE-06, BE-07, BE-S6 | manual trigger admin-gated + deterministic `rec-${id}` + enqueue-then-transition; worker failure no longer raw-overwrites terminal states; pipeline re-reads status and transitions via the state machine; `RECORDING -> SKIPPED` added | API tests; recording #91 completed |
| BE-S2, X-09 | deferred raw deletion requires `quality_gate_met=1`, existing compressed artifact, `DELETE_RAW_AFTER_VERIFY=true`, configured grace | code review; no raw deletion in test |
| BE-S4, BE-S11, X-I11 | JWT `typ` separation; refresh tokens rejected as access; refresh token no longer returned in JSON; cookie-only refresh; frontend no longer stores refresh token; `COOKIE_SECURE` env; `/me` returns `id` | `token-type.test.ts`, `auth.test.ts`, live login/refresh |
| BE-S5 | CPU VMAF frame check compares against `ceil(referenceFrames / n_subsample)`; skips when referenceFrames <= 0; `avg_frame_rate` used for reference frames | `vmaf/index.test.ts`; recording #91 real VMAF |
| BE-S7 (partial), OPS-4 | full-decode timeout scales with duration; VMAF watchdog raised to 180 s; per-command failure logging; VMAF now completes | live #91 COMPLETED |
| BE-S8 | pipeline clears `compressed_path` on SKIPPED | DB check for #94 |
| BE-S9/X-10 (partial) | internal rate limiter keyed by action/path; login still IP-keyed (see deferred) | code |
| BE-S10, FE-15 | password change requires current password server-side; UI sends it and requires 8+ chars | typecheck; code |
| BE-S12, BE-S13 | camera create no longer publishes/creates stream resources when disabled; child slices no longer get Redis RTSP URLs; ONVIF discovery remains viewer-readable (deferred) | code |
| BE-S14 (partial) | split-camera recording filters still only include requested+parent (deferred) | — |
| BE-S18 | transcode worker `error` listener | code |
| FE-01, AI-03 | canonical wire payload `{cls,conf,x1..y2}`; store normalizes to `{bbox,confidence,class_id,class_name}` with COCO names; duplicate `box` removed from publish | `stores.test.ts` contract tests |
| FE-02, BE-15 | download uses authenticated `apiFetch` + Blob instead of `window.open` + query JWT | typecheck; code |
| FE-04 | single-flight refresh promise in auth store | code |
| FE-05 | timeline uses `vmaf_mean` and `—` instead of hardcoded 94.2 | code |
| FE-06 | VMAF chart returns empty state, no synthesized curve | code |
| FE-07 | config load failure shows Offline + retry and disables save | code |
| FE-08 | hardware store no longer seeds RTX 4060/32 GB/8188 MB/45 °C; table no longer invents slice bitrate/resolution | code |
| FE-09 | class panel keyed by camera id; `??` for empty class list | code |
| FE-12 | queue counts from real DB statuses; `/api/stats` no longer hardcoded zeros | `/api/stats` |
| FE-16 (partial) | chart no longer synthesizes gate values; target still duplicated (deferred) | code |
| FE-20 | disabled cameras render an offline placeholder instead of opening streams | code |
| FE-24 | login reads `data.error` | code |
| FE-25 (partial) | config UI no longer claims Online when load failed | code |
| REC-02, R-S5 | finalize guarded by `status='RECORDING'`; per-boot PID filename suffix | `supervisor.test.ts`; new segment names |
| REC-05, R-S14 | `setSegmentSec` updates live supervisor config | code |
| REC-06, R-S8/R-S9 | transient probe failures stay RECORDING; duration uses first finite candidate | code |
| REC-07, R-S1 | bounded stop; SIGKILL timer cleared; watcher error handler | `supervisor.test.ts` |
| AI-04/AI-05 | startup Redis/MySQL retry; control loops catch `redis.RedisError`; GPU stats TTL + `ts_ms`/`source`/`degraded`/name | `pytest` 30/30; live GPU name |
| AI-12 | `PROBE_SAMPLE_SEC` passed to AI and transcode (both 20 s) | compose |
| AI-17 | env/model validation at startup | code |
| AI-19 | RTSP mask regex remains (edge case deferred) | — |
| X-02 | watermark `Number.isFinite` fix; env passed to transcode | `watermark.config.test.ts` |
| X-03 (partial) | `RECORDING -> SKIPPED` legal; terminal states not downgraded; pipeline uses state machine; recorder finalize guarded | API tests; #91 |
| X-06 | PATCH updates Redis/MediaMTX | code |
| X-08 | same `PROBE_SAMPLE_SEC` to AI/transcode | compose |
| X-11 | trigger-probe and audit-logs admin-gated | code |
| X-12 (partial) | manual trigger enqueue-then-transition; scheduler/requeue/watermark still transition-first (deferred) | — |
| X-I5 (partial) | TS `lint` scripts now run `tsc`/`vue-tsc` instead of `echo`; no CI workflow yet | `pnpm lint` |
| X-I6 | dev compose duplicate port bindings still (deferred) | — |
| X-I11 | `COOKIE_SECURE` env; `WEB_ORIGIN` now 8080 | compose/env |
| INF-08 | Vitest uses host published ports 3307/6380; API full suite passes | API 101 passed |
| X-I14 | `.env` is gitignored; `.env.example` has blank secrets + generation comments | code |
| `.gitignore` | root `/data/` only, so `apps/web-dashboard/src/data/cocoClasses.ts` is tracked | commit c7afcdc |

### Added tests
`app.test.ts`, `internal.auth.test.ts`, `token-type.test.ts`, `watermark.config.test.ts`, `supervisor.test.ts`, extended `stream_reader` tests, `stores.test.ts` wire-contract tests, fixed `auth.test.ts` cookie rotation, fixed `gateway.test.ts` admin toggle, fixed `watermark.test.ts` `ended_at`/relative order, fixed migrations test env.

---

## 5. Verification output (final)

```text
pnpm -r run typecheck        PASS (3/3)
pnpm -r run build            PASS (API, recorder, web)
pnpm lint                    PASS (tsc/vue-tsc + ruff)
pnpm test                    PASS
  API:      101 passed, 5 skipped (22 files + 1 skipped)
  Web:      15 passed
  Recorder: 5 passed, 3 skipped (live-camera suite)
  Python:   30 passed
docker compose ps            all healthy
GET /readyz                  200 {"db":"ok","redis":"ok","mediamtx":"ok"}
GET HLS cam1 + ?jwt          200, playlist returned
JWT with old default secret  401
recordings                   2 COMPLETED, 1 SKIPPED, 9 RAW, 2 RECORDING, 3 FAILED
recording_activity_windows   288
#91 compressed               218,072,998 B -> 13,949,970 B; vmaf_mean=85.54; gate=1
```

---

## 6. Deferred / residual risk (must read)

These were **not** fully fixed. They are real and remain in the codebase:

1. **RTSP proxy protocol robustness (RTSP-01):** no RTSP message framing; Digest challenge still stripped/forced to Basic; hand-rolled Redis RESP; no idle/keepalive cap. Risk: intermittent stream failures with digest-only cameras and thread/socket leaks. (`proxy.py` was only hardened for logging/secret default in this pass.)
2. **ONVIF frontend contract (FE-03):** discovery still reads `data.cameras`; verify still calls `/probe`; capabilities shape mismatch; import bypasses `/add-bulk`. Backend routes are correct; the UI remains broken.
3. **Split-sensor duplication (X-01):** recorder/AI now skip child rows and children no longer get MediaMTX paths/RTSP Redis keys, but the DB/UI still creates child camera rows and the recorder/AI skip is the only guard. No server-side crop.
4. **Camera delete / split-count media files (BE-S3, X-07):** DB rows still cascade-delete while raw/compressed files are left on disk. No soft-delete/quarantine.
5. **Consolidation (X-05, R-S7):** activity-window offsets are still not rebased and `ai_detection_events.recording_id` is still nulled on source-row delete.
6. **Full verification (BE-S7):** we added final-decode timeout scaling and real VMAF completion, but not the spec’s final-file VMAF sample re-check + frame-count parity before `COMPLETED`. Current `vmaf_mean` comes from the probe.
7. **State-machine completeness (X-03/X-12):** some writers still bypass transitions (consolidator/reconciler/requeue/scheduler/watermark transition before enqueue). Manual trigger is fixed.
8. **Socket authorization (BE-03):** `join:camera` still has no per-camera authz; `system:alert`/`probe_step` still broadcast to all (`io.emit`).
9. **Auth/rate limiting (BE-S9):** login is still IP-keyed and `app.set("trust proxy")` is not configured; nginx still does not forward `X-Forwarded-For` on `/api/`. External clients behind nginx share a bucket.
10. **Audit log (BE-04):** now admin-gated, still in-memory and lost on restart; no tamper-evident hash chain.
11. **SSRF (BE-S10):** admin-only `test-camera-ping`/NTP/ONVIF still accept arbitrary hosts; no private-range denylist.
12. **Credential plaintext (BE-S29/R-18):** `cam:{id}:rtsp_url` and `camera:changed` still carry plaintext RTSP URLs; ONVIF verify returns a credential-bearing URI. The proxy still reads plaintext from Redis.
13. **Recorder path/collision/relative data (REC-08, R-S6):** `raw_path` remains absolute; ffmpeg still gets a minimal env (fixed) but the MediaMTX secret remains in argv; same-second collision mitigated by PID suffix only.
14. **Container hardening (INF-03/11):** prod still bind-mounts `dist`/`src`; images remain root, no `cap_drop`/`no-new-privileges`/resource limits; MediaMTX/FFmpeg tags are unpinned; recorder image still `FROM vms-transcode-worker:latest`.
15. **Frontend P2 (FE-10/11/21/22/25/26/27/28):** keyboard/a11y gaps, i18n completion, route-level code splitting, 1 s clocks/2 s polling, viewer-aware controls, axe/contract test expansion, asset caching, dead files/assets. Some fabricated data removed; full UX pass not done.
16. **Config/docs drift (OPS-7/INF-09):** `system_config` still advertises `httpPort:5173`, `whepPort:8555`; README/start-vms still mention 5173; README credentials may not match a random production seed; `YOLO26n`/TensorRT claims remain.
17. **Test/CI infrastructure (X-I1/I3/I4/I7/I9/I10):** transcode integration suite is still skipped/fixture-dependent; Playwright still mocks every backend; no real CI workflow; `clean-clone-test.sh`/`security-audit.mjs` are not trustworthy; `e2e-full.sh` is destructive; no `LICENSE` file. Recorder live-camera suite is now skipped unless `LIVE_RTSP_URL` is set.
18. **Dev compose ports (X-I6):** `docker-compose.dev.yml` still appends 3306/6379 to the base 3307/6380, so both profiles can collide.
19. **Notification (L-04):** recorder `recording:status` still has no gateway subscriber.

---

## 7. Operator notes

- `.env` is local/gitignored and now contains freshly generated secrets. Keep it out of git. Rotate again if it was ever shared.
- `MEDIAMTX_AUTH_SECRET`, `JWT_SECRET`, `CREDENTIAL_KEY`, `MYSQL_PASSWORD`, `MYSQL_ROOT_PASSWORD`, `REDIS_PASSWORD` are required by compose; missing values fail fast.
- MediaMTX control API is excluded from HTTP auth and bound to `127.0.0.1:9997` on the host; keep it internal.
- HLS playback needs `?jwt=<access token>`; the dashboard appends it. Without it, MediaMTX returns 401 by design.
- The recorder/AI now record only parent cameras. Child “sensors” are display slices; they do not get their own MediaMTX paths.
- If `DELETE_RAW_AFTER_VERIFY` is not `true`, raw files are retained. When enabled, deletion requires a met quality gate and an existing compressed file.

---

*End of FIXES_APPLIED.md.*
