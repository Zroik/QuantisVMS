# Quantis VMS — Part 3: Regression Remediation Verification

**Date:** 2026-11-03 (evening pass)
**Scope:** the 13 regressions from `AUDIT_REPORT.md` Part 2 — §V.1 (4 critical) and §V.2 (9 data-integrity items), plus the V.7 build/ruff/rebuild steps.
**Method:** re-read every cited code path, executed the build/typecheck/test/lint gates, exercised the API boot path over HTTP, and checked the FFmpeg option against a real FFmpeg 8.1.1 binary. Docker is not installed in this environment, so compose was validated statically (YAML parse + env inspection) rather than by container start.

---

## 0. Result in one paragraph

All 13 regressions (V-R1 … V-R13) are **resolved in the working tree**. The four critical ones are fixed in source, the recorder/API/web `dist` artifacts have been rebuilt from that source, `ruff` is clean, `pytest` is 28/28, and the API now boots and serves the expected JSON 404 and health responses. The changes were already present when this pass started (the working tree is the post-remediation state that the Part 2 report asked for); this pass independently verified each one, rebuilt the artifacts, re-ran every runnable gate, and added one regression test so V-R1 cannot silently return.

The only non-green suites are the 8 API suites and 1 recorder integration suite that need a local MySQL on `127.0.0.1:3306`. Port 3306 is closed in this environment; those suites fail in `beforeAll` with `ECONNREFUSED`, not on an import or assertion error. This is the same environmental limitation recorded in Part 2 §V.6.

---

## 1. Critical regressions (V.1)

| ID | Claim in Part 2 | Current code | Verification |
|---|---|---|---|
| **V-R1** | `app.use("/api/*", …)` throws in Express 5 / path-to-regexp v8, so the API cannot boot | `apps/api-server/src/app.ts:65-70` mounts `app.use("/api", …)` after all routers. No wildcard segment. | `createApp()` succeeds against the built `dist`; live HTTP: `GET /healthz` → `200 {"status":"ok"}`, `GET /api/does-not-exist` → `404 {"error":"Endpoint not found"}`, `GET /api/cameras` → `401` (router matched before the catch-all). New test file `apps/api-server/src/app.test.ts` covers exactly these four assertions. |
| **V-R2** | `-stimeout` does not exist in FFmpeg 8.x; every recorder spawn would exit instantly | `services/media-engine/recorder/src/supervisor.ts:200` uses `-timeout 5000000` (microseconds) before `-i`. | Local `ffmpeg -version` is **8.1.1**; `ffmpeg -h demuxer=rtsp` lists `-timeout <int64>` and no `-stimeout`. The option is placed in the input options block, which is where the RTSP demuxer consumes it. |
| **V-R3** | Recorder/API/web `dist` were stale, so compose bind-mounts ran old code | Build ran for all three workspaces: `pnpm -r --workspace-concurrency=1 run build`. | Fresh artifacts (2026-11-03 19:07): `recorder/dist/supervisor.js` contains `-timeout`, `empty_moov`, `TZ: "UTC"`; `api-server/dist/app.js` contains the `/api` 404 handler; `api-server/dist/db/migrations/005_widen_preferred_encoder.up.sql` is present; web `dist/index.html` + assets rebuilt. |
| **V-R4** | rtsp-proxy lost Redis auth because compose passed no `REDIS_*` env while Redis requires a password | `docker-compose.yml:47-51` now sets `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD: ${REDIS_PASSWORD:-redis_password_secret}` for `rtsp-proxy`; the host port publish is gone. | YAML parses; the service environment resolves to the three keys above. `proxy.py:11-13` reads the same variables, and `proxy.py:42-44` sends `AUTH` whenever a password is set. |

---

## 2. Data-integrity regressions (V.2)

| ID | Claim in Part 2 | Current code / verification |
|---|---|---|
| **V-R5** | A `DELETE FROM recordings WHERE raw_path = ? AND id != ?` cleanup deleted legitimate merged rows | That statement no longer exists. `consolidator.ts` now selects only `status='RAW' AND ended_at IS NOT NULL`, excludes `%_merged.mp4`, skips an hour that already has a merged artifact (`:250-265`), re-checks every candidate under `FOR UPDATE` (`:319-332`), and deletes superseded rows **by id** inside the same transaction (`:360-364`). Raw files are unlinked only after commit (`:375-389`). |
| **V-R6** | Camera delete cleaned Redis but left child DB rows and emitted `removed` for cameras still in DB | `cameras.ts:626-681` runs the delete in a transaction: locks the parent, collects `allIds = [id, ...childIds]`, deletes child rows, then the parent, commits, and only then clears `cam:{id}:*` + MediaMTX and publishes `camera:changed removed` for each id in `allIds`. |
| **V-R7** | The new recording `SELECT` in `flush_activity_window` ran outside `_db_lock` | `worker.py:74-146`: `with lock:` now wraps the `ping`, the recording `SELECT`, the relative-offset calculation, the `INSERT … ON DUPLICATE KEY UPDATE`, and `commit()`. Same pattern is used in `flush_detection_event` (`:155-184`). |
| **V-R8** | A CUDA `.to()` failure produced a per-frame `RuntimeError` that the consumer loop did not catch | `detector.py:34-44`: a failed `.to(self.device)` logs a warning and permanently falls back to `self.device = "cpu"`. The consumer loop catches `(ValueError, TypeError, OSError, RuntimeError)` (`worker.py:254`) and exits cleanly when the stop event is set. |
| **V-R9** | JTI revocation set had no TTL / no sweep → unbounded growth | `auth/service.ts:79-82`: the token key is written with `EX REFRESH_EXPIRES_SEC`, the per-user set is `SADD`-ed, then `EXPIRE`-d to the same window. The set is also `SREM`-ed on rotation/logout and deleted outright on reuse detection (`:124-135`). |
| **V-R10** | `Number(env) ?? 1` passed `NaN` to BullMQ when the env var was unset | `transcode/worker.ts:38-41`: `const envConcurrency = Number(...)`; the value is used only when `Number.isFinite(envConcurrency) && envConcurrency > 0`, otherwise `1`. |
| **V-R11** | “Add Camera” linked to the removed named `settings` route | `LiveMatrixView.vue:69` targets `{ name: "configuration" }`. `router/index.ts:47-54` defines `name: "configuration"` and keeps `path: "settings"` as a redirect to `/configuration`. |
| **V-R12** | Locale `hw.heroSummary` still contained `<b>/<em>` while the view renders it as text | `en.json:121` and `id.json:121` are plain strings; a JSON parse with duplicate-key detection finds zero duplicate keys and no `<b>/<em>` in either file. The view interpolates `{{ heroSummary }}` as text (`HardwareMonitorView.vue:13`); the misleading `heroSummaryHtml` computed was renamed to `heroSummary` in this pass. |
| **V-R13** | `add_header` inheritance meant the SPA document got no security headers | `nginx.conf` repeats `X-Frame-Options`, `X-Content-Type-Options`, and `Referrer-Policy` in both `location = /index.html` (`:15-21`) and `location /` (`:24-31`), which are the two locations that also set `Cache-Control`. |

---

## 3. Build, lint and test evidence (executed)

| Gate | Command | Result |
|---|---|---|
| Typecheck | `pnpm -r --workspace-concurrency=1 run typecheck` | ✅ all 3 workspaces pass |
| Build | `pnpm -r --workspace-concurrency=1 run build` | ✅ API `tsc`, recorder `tsc`, web `vue-tsc && vite build` (1.18 s) |
| Lint | `pnpm lint` | ✅ JS workspace lint + `ruff check .` → “All checks passed!” |
| Ruff | `uv run --directory services/ai-vision-worker --with pytest,ruff ruff check .` | ✅ 0 errors (Part 2 had 13) |
| Python tests | `uv run --directory services/ai-vision-worker --with pytest pytest` | ✅ 28/28 |
| Web tests | `pnpm --filter @vms/web-dashboard test` | ✅ 13/13 in 4 files |
| API regression test | `pnpm --filter @vms/api-server exec vitest run src/app.test.ts` | ✅ 4/4 (boot, healthz, JSON 404, known-route-before-catch-all) |
| API full suite | `pnpm --filter @vms/api-server test` | ⚠️ 59 passed, 35 skipped; 8 suites fail only with `ECONNREFUSED 127.0.0.1:3306` in `beforeAll` |
| Recorder suite | `pnpm --filter @vms/recorder test` | ⚠️ unit passes (2/2); integration suite fails only with `ECONNREFUSED 127.0.0.1:3306` |
| API boot smoke | `node` + `createApp()` + `fetch` | ✅ `createApp OK`; `/healthz` 200; `/api/does-not-exist` 404 JSON |
| FFmpeg option | `ffmpeg -h demuxer=rtsp` | ✅ `-timeout <int64>` present; `-stimeout` absent (binary 8.1.1) |

**Why the DB suites are yellow, not red:** every failure stack in the API run points at `beforeAll`/`afterAll` `pool.query(...)`, and the message is `connect ECONNREFUSED 127.0.0.1:3306`. No suite fails at module import anymore (the Part 2 V-R1 symptom), and no non-DB assertion fails. Starting a MySQL instance was not attempted: no MySQL service is registered on this machine, port 3306 is closed, and the Laragon data directory contains no `vms_db`. Running those suites requires the project’s normal local DB setup.

---

## 4. Changes made in this pass

The V.1/V.2 fixes were already in the working tree when this verification began, so this pass did not need to rewrite them. It did make two small, deliberate changes:

1. **Added `apps/api-server/src/app.test.ts`** — a 4-test regression guard for V-R1 (app constructs, `/healthz` works, unknown `/api` path returns JSON 404, known `/api` route still resolves before the catch-all). This is the one gap Part 2 left open: the Express-5 boot failure had no test that would have caught it.
2. **Renamed `heroSummaryHtml` → `heroSummary`** in `HardwareMonitorView.vue` (template + computed). The value is now plain text, and the old name invited a future `v-html` regression.

All `dist` artifacts were regenerated afterwards.

---

## 5. Residual risks / intentionally out of scope

- **DB-backed integration coverage** for V-R5/V-R6/V-R7 was not executed in this environment. The fixes were verified by reading the exact SQL/transaction/lock boundaries; the existing suites will exercise them once MySQL is up.
- **Docker runtime** (compose `rtsp-proxy` → Redis auth, MediaMTX wiring, container healthchecks) was validated only statically because `docker` is not on PATH here.
- **V.5 backlog is untouched** by design: `stats.ts` fabricated telemetry, `events.ts` deep-OFFSET, the remaining ai-vision thread/Redis-reconnect work, proxy protocol robustness, recorder `R-H6/H7/M1/M4/M5/M6`, frontend S1/S2/S4 and store/view hygiene, and the compose/env inert-knob work remain open.
- The JavaScript workspace `lint` scripts are still `echo` no-ops; only the Python worker has a real linter. `pnpm verify` therefore still gates mostly on typecheck + tests.

---

## 6. Verdict

**The Part 2 regression set is closed for the requested scope.** The API can boot, the recorder receives a valid FFmpeg timeout option, the shipped `dist` matches source, rtsp-proxy receives Redis credentials, the nine data-integrity items are fixed, ruff is clean, and the build/typecheck/web/Python gates are green. The only remaining red is the pre-existing “no local MySQL” environmental gap, which is not a code regression.
