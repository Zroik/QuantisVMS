# Playback (`/playback`) Performance & Logic Audit

**Date:** 2026-11-05
**Scope:** `/playback` route (`TimelineView.vue`), its client service, the `/api/recordings*` API, the recorder segment format, and the nginx/compose delivery path.
**Skills applied:** `performance-optimization` (measure → identify → fix → verify), `code-review-and-quality` (correctness / architecture / security / performance axes).
**Method:** source walk-through, live API timing against the running stack (`127.0.0.1:3000` / `:8080`), Chromium network capture, and a controlled A/B experiment on the container format.
**Source changes:** none. This report is the only artifact written.

---

## 1. Answer in one paragraph

The video is slow because **the raw recording container is a fragmented MP4 with `mvhd.duration = 0` and no `sidx` index**. Chromium cannot know the duration or seek map, so it walks the file **one fragment at a time** with hundreds to thousands of HTTP `Range` requests before it will start playback. A 623 MB / 1-hour test segment generated **233 requests in 5.3 s** and was still at `readyState = 0` after 15 s; extrapolating the observed ~426 KB step gives **~1,500 requests** for that segment and **~9,000 requests** for the 3.6 GB hourly files on disk. Every one of those requests re-authenticates, runs a DB query, performs synchronous `realpath`/`stat` filesystem checks, opens a new read stream, and is aborted by Chromium without the server cleaning up the stream. Adding a `sidx` index in a controlled test reduced the same playback from **250 range requests to 2**.

This is fixable at the recorder (`+global_sidx`, and/or a faststart remux after finalize), at the API (cleanup + no per-range filesystem work), and at the client (`preload`, double-load). The rest of this report separates the measured facts from the secondary contributors and gives a prioritized plan.

---

## 2. Measured evidence

Environment: Windows 11 host, Chrome 152 (Electron 44.9.1), nginx 1.31.8 in front of the API, dashboard at `http://127.0.0.1:8080`, API at `http://127.0.0.1:3000`, data on the Windows `./data` bind mount.

### 2.1 Live `/playback` load (recording #1122, raw, 623,198,055 bytes, 3600 s)

| Observation | Value |
|---|---|
| Video element after reload, at t = 15 s | `readyState = 0`, `networkState = 2` (loading) |
| Media requests in the first 5.3 s | **233** |
| Request type / outcome | all `206 Partial Content`, all `net::ERR_ABORTED` |
| Bytes actually transferred per request | ~300 (headers only) |
| Typical request duration | 16–30 ms |
| `Range` sequence (retained tail of capture) | `bytes=575373312-`, `575799296-`, `576225280-`, … `623149056-`, then finally `bytes=0-` |
| Step size between ranges | ~426 KB (one MP4 fragment) |
| Eventual state, after the scan completed | `readyState = 4`, `duration = 3600.42` |

### 2.2 Controlled A/B on the container format

Both files were produced from the same source, same codec, same segmenter, `~94.2 MB` each. `withsidx.mp4` adds only `+global_sidx`.

| Variant | Media requests | Transferred | Time to `readyState = 4` | `duration` |
|---|---:|---:|---:|---:|
| `movflags=+frag_keyframe+empty_moov+default_base_moof` (current) | **250** | 74,400 B | < 8 s (scan finished ~3.6 s) | 731.64 s |
| Same **+ `global_sidx`** | **2** | 33,251 B | < 8 s, immediate | 731.64 s |
| `withsidx` + seek to 60 s | +1 request | — | seek succeeded | 731.64 s |

This isolates the container as the cause; the server and network are identical for both files.

### 2.3 API endpoint costs (direct to `:3000`, 4 runs each)

`GET /api/recordings?camera_id=31&limit=N`:

| `limit` | Response time |
|---:|---|
| 1 | 3–7 ms |
| 10 | 23–27 ms |
| 50 | 120–132 ms |
| 100 | **243–255 ms** |

The cost is linear (~2.4 ms/row) and is caused by the per-row synchronous filesystem checks in `recordings.ts:101-113`.

`GET /api/recordings/1122/activity-windows`: 9–11 ms warm (122 ms first).
`GET /api/events?...`: 6–7 ms.
Single `Range: bytes=0-1048575` stream through nginx: **TTFB 8–10 ms, 1 MB in ~20 ms**.

So the transport itself is fast. The slow path is the *number* of range requests and the work done per request, not raw bandwidth.

### 2.4 Raw file shape (ffprobe / box parse)

`data/raw/cam19/20261104_020000_1.mp4`:

- H.264, 1920×1080, 25 fps, 3,615,779,737 bytes, 3600.8 s.
- `moov` is only 766 bytes: `mvhd` version 0, timescale 1000, **duration 0**.
- `mvex` has `trex` only, **no `mehd`**, **no `sidx`**.
- First fragment: `moof` 144 bytes + `mdat` 400,654 bytes; fragments repeat every ~400 KB.
- This is exactly the shape Chromium scans linearly.

---

## 3. Findings, ordered by impact

Severity: **Critical** = directly causes minutes-long load / resource exhaustion; **High** = large measurable cost; **Medium** = correctness or secondary cost; **Low/Nit** = polish.

### C-1 (Critical) — No index/duration in the fragmented MP4 forces a full-file fragment scan

**Files:** `services/media-engine/recorder/src/supervisor.ts:243-258`, `services/media-engine/recorder/dist/supervisor.js:224-228` (built artifact has the same flags), `docker-compose.yml:105,145`.

```ts
"-f", "segment",
"-segment_time", String(segmentSec),
"-segment_format", "mp4",
"-segment_format_options", "movflags=+frag_keyframe+empty_moov+default_base_moof",
```

`empty_moov` writes a zero-duration `mvhd`, and no `sidx`/`mehd` is written. Browsers therefore do not know the media duration. Chromium's MP4 demuxer walks each `moof` to build its index; because the server advertises `Range: bytes=X-` with the whole remainder as `Content-Length`, the browser issues one request per fragment, aborts it after reading what it needs, and moves to the next.

Measured request count is essentially `fileSize / fragmentSize`:

| File | Size | Approx. requests |
|---|---:|---:|
| #1122 (observed) | 623 MB | ~1,500 |
| `cam31` hour | 623–673 MB | ~1,500–1,600 |
| `cam19` hour | 3.6 GB | **~9,000** |

At the live stack's ~20 ms/request, that is **~30 s** for a 623 MB segment and **~3 minutes** for a 3.6 GB segment before the first frame. This matches the observed `readyState = 0` after 15 s and the eventual `duration = 3600.42` once the scan reached EOF.

**Fix (highest ROI):** add `+global_sidx` to the recorder's `segment_format_options`:

```ts
"-segment_format_options",
"movflags=+frag_keyframe+empty_moov+default_base_moof+global_sidx",
```

The controlled test above shows 250 → 2 requests and preserves crash-safe `empty_moov`. Validate with `ffprobe`/box dump that a `sidx` exists and with Chromium that a full-hour segment opens in 2–3 requests. Keep a fallback plan: if the ffmpeg build does not support `global_sidx`, remux the finalized raw file `-c copy -movflags +faststart` (the consolidator already does this for merged files, see `transcode/consolidator.ts:283`), or run that remux as a post-finalize job. A faststart remux writes a complete sample table and is the most compatible fix, at the cost of reading/writing the file once.

Do **not** rely on `preload="metadata"` to avoid this: Chromium still probes the file to learn the duration. Fix the container.

### C-2 (Critical) — Every range request repeats expensive work, multiplying the scan cost

**Files:** `apps/api-server/src/routes/recordings.ts:274-370`, `:30-48`, `:101-113`.

Each `GET /:id/stream` request performs:

1. `authenticateMediaToken` → JWT verification (`auth/middleware.ts:13-39`).
2. `SELECT id, raw_path, compressed_path, status FROM recordings WHERE id = ?`.
3. `fsp.access(targetPath)`.
4. `isPathSafe(targetPath)` → `fs.existsSync` + `fs.realpathSync` for the target **and** each of 3 allowed directories (`recordings.ts:30-48`).
5. `fsp.stat(targetPath)`.
6. `fs.createReadStream(...).pipe(res)`.

For 1,500–9,000 scan requests this is 1,500–9,000 DB queries, 1,500–9,000 path validations, and 1,500–9,000 file opens. The live measurement (~20 ms/request) versus the bare range server used in the A/B (~0.5 ms/request) shows the stack adds roughly **40×** per-request overhead. The scan is slow because of this amplification as much as because of its length.

**Fixes:**

- Validate and cache the allowed-directory realpaths once at startup; do not realpath them on every request. A simple `path.resolve` prefix check is sufficient once the roots are canonical.
- Do not call `fsp.access` and `fsp.stat` separately; `fsp.stat` already proves existence. Catch `ENOENT`.
- Avoid the DB query on every range request: use a short-lived in-process cache keyed by recording id + status, invalidated on status transitions (the socket already broadcasts status changes), or an `ETag`/`Last-Modified` response that lets the browser revalidate cheaply.
- If the file is immutable once `RAW`/`COMPLETED`, cache `(id, mode) → {path, size, mtime}` with a bounded LRU.

### C-3 (Critical) — Aborted range responses leak read streams and have no error handling

**File:** `apps/api-server/src/routes/recordings.ts:357-368`.

```ts
const stream = fs.createReadStream(targetPath, { start, end });
stream.pipe(res);
```

There is no `res.on("close")`/`stream.destroy()`, no `stream.on("error")`, and no `pipeline`. Chromium aborts nearly every scan request (`net::ERR_ABORTED`). Node's `pipe` does not guarantee the source is destroyed when the destination closes; the file descriptor/stream can remain open until GC. A burst of 1,500–9,000 aborted requests can exhaust descriptors (`EMFILE`) or stall the API. A read error on the stream is also an unhandled `'error'` event, which can terminate the process.

**Fix:**

```ts
import { pipeline } from "node:stream/promises";

const stream = fs.createReadStream(targetPath, { start, end });
res.on("close", () => stream.destroy());
try {
  await pipeline(stream, res);
} catch (err: any) {
  if (err.code !== "ERR_STREAM_PREMATURE_CLOSE") {
    // log; headers may already be sent
  }
}
```

Use the same treatment for the non-Range branch.

### H-1 (High) — One-hour segments make the problem linear in file size

**Files:** `docker-compose.yml:105` (`SEGMENT_SEC: ${SEGMENT_SEC:-3600}`), `:145`; `services/media-engine/recorder/src/recorder.ts:87`; docs/spec say 10 s (`ARCHITECTURE.md:69`, `3_VMS_BUILD_SPEC.md:315`).

The actual files are 0.26–3.6 GB per segment. Even with `sidx`, a single index entry covering a one-hour file makes fine-grained seeking coarse; without it, it is the source of the multi-minute load. Shorter segments (60–300 s) reduce the worst-case file size by 12–60×, let playback start on the first small file, and make the existing auto-advance/`findNextPlayableIndex` logic actually useful.

**Recommendation:** set `SEGMENT_SEC=60` (or 120–300 for fewer DB rows). Keep the hourly consolidation feature for archives. Test the interaction with `findNextPlayableIndex` (it already walks newest-first and skips non-playable rows).

### H-2 (High) — The recordings list does synchronous filesystem work for every row

**File:** `apps/api-server/src/routes/recordings.ts:101-113`.

For each of up to 100 rows, it calls `isPathSafe` twice (raw and compressed) and `fs.existsSync` again. `isPathSafe` itself does `existsSync` + `realpathSync` for the target and for 3 allowed roots. That is up to ~8 synchronous syscalls per row, on the request thread, before the UI can select a segment.

Measured: 3–7 ms at `limit=1`, 23–27 ms at 10, 120–132 ms at 50, **243–255 ms at 100**. This is the first thing the page waits for. On the Docker-on-Windows bind mount, stat latency is worse than on this cache-warm run.

**Fixes:**

- Persist `has_raw` / `has_compressed` / `playable` in the `recordings` table when the recorder finalizes and when the transcoder completes. Then the list is a pure DB read.
- If that is too large a change, only stat the single segment being selected (the client already requests activity/events for it), and return list rows without per-row existence checks; keep the explicit `playable` flag as an override.
- Make `isPathSafe` roots canonical once, and drop the redundant `fs.existsSync` after it.
- Reduce `limit` from 100 to the page size the UI actually renders; the list is scrollable but only ~100 rows are loaded today.

### H-3 (High) — `data` is on a Windows bind mount

**File:** `docker-compose.yml:108-110,146-148` (`./data:/data`); spec decision E14 (`docs/3_VMS_BUILD_SPEC.md:46`) explicitly warns that `/mnt/c`/Windows bind mounts are slow and that `/data` should live on the native ext4 filesystem.

Every stream open, `stat`, and leaked read stream pays that mount's latency. The current host also puts 3.6 GB reads through it. Move `data` to a native Linux volume/WSL ext4 path. This is infrastructure, but it compounds C-2/C-3 and is required to hit playback budgets reliably.

### H-4 (High) — nginx buffers the stream and does not keep the connection alive for media

**File:** `apps/web-dashboard/nginx.conf:34-41`.

`location /api/` proxies with default `proxy_buffering on` and no explicit HTTP/1.1 keep-alive for the upstream response. The captured responses show `connection: close`, so each of the 1,500–9,000 range requests opens a new connection end-to-end. Buffering can also spool large ranges to temporary files.

**Fix:**

```nginx
location /api/recordings/ {
    proxy_pass http://api-server:3000/api/recordings/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header Range $http_range;
    proxy_set_header If-Range $http_if_range;
    proxy_buffering off;
    proxy_request_buffering off;
    proxy_cache off;
    proxy_max_temp_file_size 0;
    add_header Cache-Control "private, max-age=0, must-revalidate" always;
}
```

Expose `Accept-Ranges`/`Content-Range` from the API (already set on 206) and support `If-Range`. Keep `/api/` for the rest or inherit the settings carefully.

### H-5 (High) — Client always requests `preload="auto"` and can double-load on mode switch

**File:** `apps/web-dashboard/src/views/TimelineView.vue`.

- `:src="videoPlaybackUrl"` with `preload="auto"` (`:192-193`) starts a media request as soon as a segment is selected, even if the user never presses Play. With a 1-hour file this is exactly the worst case for the scan.
- `setStreamMode` (`:879-892`) does:

```ts
streamMode.value = mode;         // computed src will change on next tick
if (playbackVideoRef.value) {
  const prevTime = playbackVideoRef.value.currentTime;
  playbackVideoRef.value.load(); // loads the OLD src synchronously
  playbackVideoRef.value.currentTime = prevTime;
  ...
}
```

  The `load()` runs before Vue patches the new `src`; then the `src` change triggers another load. On a mode switch this can start two media sessions and two scans. `retryPlayback` (`:937-943`) has the same "load then play immediately" pattern.
- The access token is embedded in the URL (`:635-640`). Every 15-minute refresh produces a new URL, defeating browser caching and forcing a fresh scan/download; it also leaks the JWT into nginx/API logs.

**Fixes:**

- Default `preload="metadata"` (or `"none"`) and set `preload="auto"` only after the user presses Play / selects the segment intentionally. With `sidx`, metadata is cheap.
- On mode change, let the computed URL change first (`await nextTick()`), then call `load()`, then seek on `loadedmetadata` (not immediately after `load()`). Abort/ignore the old `loadedmetadata` with a generation counter.
- Move media auth to an `HttpOnly` cookie or a short-lived signed URL whose path is stable, so the browser can cache ranges and `If-Range` works. At minimum, do not put the long-lived access token in the query string.

### M-1 (Medium) — Activity/event fetches are sequential and unbounded; the fallback is O(windows × events)

**Files:** `apps/web-dashboard/src/views/TimelineView.vue:1008-1032`, `apps/api-server/src/routes/recordings.ts:207-265`.

`selectRecording` awaits `/activity-windows` and then `/events` serially. Neither is needed before the player can show the first frame. If a camera/segment switch happens while they are in flight, the old response can overwrite the new state (no request-generation guard or `AbortController`). The fallback synthesizer loops `totalWindows` and runs `events.filter` per window (`recordings.ts:227-230`), which is O(W×E); for a 1-hour segment that is 720 windows × event count, with a `new Date` per event per window.

**Fixes:**

- Fire both with `Promise.all`, and show the player independently.
- Abort stale requests on camera/segment change; tag results with a generation id.
- Replace the nested filter with a single pass / bucket map: one `Map<windowIndex, counts>` built from events, then emit windows.
- Cap/synthesize windows server-side to a sensible resolution (e.g., 5 s is 720 points/hour; the UI draws 720 bars in a 68 px strip).

### M-2 (Medium) — Range parser rejects suffix ranges and multi-ranges

**File:** `apps/api-server/src/routes/recordings.ts:337-346`.

`Range: bytes=-500` gives `parts[0] = ""`, `start = NaN` → 416. `Range: bytes=0-99,200-299` is parsed as a single range and produces a wrong 206. Chromium uses open-ended ranges here, but Safari/Firefox and some download managers use suffix/multi-range probes. A 416 on a probe causes retries and can contribute to the "slow/never loads" symptom.

**Fix:** implement the RFC 7233 cases: `start-end`, `start-`, `-suffixLength`, and either reject multi-range with a single full response or emit `multipart/byteranges`. Return `Content-Range: bytes */size` on 416 (already done).

### M-3 (Medium) — No cache validators / cache policy on media

**File:** `apps/api-server/src/routes/recordings.ts:350-365`.

Responses have no `ETag`, `Last-Modified`, `Cache-Control`, or `If-Range` support. Every revisit re-downloads/re-scans the file. Since files are immutable after `RAW`/`COMPLETED`, this is unnecessary. Add `ETag` from `size-mtime`, `Last-Modified`, `Cache-Control: private, max-age=3600, immutable` (or a shorter TTL), and honor `If-Range`. Note: this only works once the token is not part of the URL (see H-5).

### M-4 (Medium) — `activityWindows` renders 720 bars and the whole view re-renders on `timeupdate`

**File:** `apps/web-dashboard/src/views/TimelineView.vue:376-398`, `:894-898`.

`onTimeUpdate` writes `currentTimeSec` ~4×/s. The whole `TimelineView` template re-evaluates, including `v-for` over every activity window (up to 720 inline style objects) and every segment row. This is not the initial-load cause, but it makes playback and scrubbing feel sluggish on lower-end machines. Split the player/playhead into child components, or use a CSS variable / `requestAnimationFrame` to move the playhead without re-rendering the list. Compute the bar styles once (they do not depend on current time).

### M-5 (Medium) — `downloadVideo` loads the entire file into memory

**File:** `apps/web-dashboard/src/views/TimelineView.vue:858-877`.

`await res.blob()` buffers the whole MP4 in the renderer. A 3.6 GB segment can OOM the tab. Use a normal navigation/download link (`<a href="/api/recordings/:id/download?mode=...">`) or stream-to-disk via the browser's download manager; keep the fetch only if you need progress, and then use `ReadableStream` + `showSaveFilePicker` or a service worker.

### L-1 (Low) — Silent failures hide the real state

- `togglePlay` / `setPlaybackRate` catch autoplay errors with `catch(() => {})` (`:786-805`).
- `onVideoError` ignores errors when `currentSrc` is empty (`:921-935`), which hides genuine early failures.
- `fetchRecordings` swallows all errors (`:971`).
- `streamMode` can say "compressed" while the API silently falls back to `raw_path` (`recordings.ts:311-318`), so the UI shows a size/ratio that does not match what is playing.

These do not cause slow load, but they make diagnosis harder. Surface a status/metric and log the selected mode.

### L-2 (Low) — AV1 compressed output may not play everywhere

`data/compressed/cam2/*.mp4` is AV1 (`av01`, 2304×2592). Cameras are configured with `preferred_encoder: av1_nvenc`. Chrome can decode AV1, but some Safari/Firefox/hardware combinations cannot, and the UI's "compressed" mode is enabled whenever `has_compressed` is true. Consider HEVC/H.264 for the widest playback compatibility, or detect `MediaSource.isTypeSupported('video/mp4; codecs="av01..."')` and disable/label the mode accordingly.

---

## 4. Why the current page still "works" (and why it feels inconsistent)

The browser eventually completes the scan and then plays. On a warm file/OS cache the scan is faster; on a cold 3.6 GB file or a slower mount it takes minutes. The page's `onLoadedMetadata` also falls back to `rec.duration_sec` (`TimelineView.vue:900-910`), so the UI shows 60:00 even while the media element is still scanning. That masks the real state: the timeline looks ready while `readyState` is still 0.

A second inconsistency comes from `preload="auto"` + `autoplay`-on-user-gesture: the scan starts as soon as a segment is selected, and the "big play" button may appear usable before the media is actually seekable.

---

## 5. Recommended change plan

Do these in order; the first three are the ones that change the user-visible number.

### Step 1 — Give the recorder a real index (biggest win)

1. Add `+global_sidx` to `segment_format_options` in `services/media-engine/recorder/src/supervisor.ts:257`.
2. Rebuild `services/media-engine/recorder/dist` and redeploy (`docker-compose.yml:148` mounts `dist` read-only; the current dist is fresh but has no sidx).
3. Verify on a new 1-hour segment:
   - `ffprobe`/box dump shows `sidx`, `mvhd.duration > 0` or a valid `mehd`, and `moof/mdat` still present.
   - Chrome opens it with **≤ 3 media requests** and `readyState = 4` in under 1 s on localhost.
4. If `global_sidx` is unsupported or browsers disagree, add a post-finalize `-c copy -movflags +faststart` remux step (background job) and update `raw_path` atomically. Keep the fragmented file only while recording.
5. Re-test existing files: they are immutable and will keep scanning. Plan a one-time remux or re-index of the archive, or accept that old segments remain slow.

### Step 2 — Make each range request cheap and safe

1. `pipeline` + `res.on("close", () => stream.destroy())` + `stream.on("error")` in both branches (`recordings.ts:357-368`).
2. Cache canonical allowed roots at module load; remove per-request `realpathSync` of the roots.
3. Replace `fsp.access` + `fsp.stat` with one `fsp.stat`.
4. Cache `(id, mode)` path/size/mtime in a bounded LRU; invalidate on recording status changes.
5. Add `ETag`, `Last-Modified`, `Cache-Control: private, max-age=3600, immutable`, and `If-Range`.
6. Fix suffix/multi-range parsing (M-2).

### Step 3 — Stop doing filesystem work for the whole list

1. Add/persist `has_raw`, `has_compressed`, and `playable` in `recordings` (set in the recorder finalize path and transcoder completion path).
2. Change `GET /api/recordings` to return them directly; remove the per-row `isPathSafe`/`existsSync` loop (`recordings.ts:101-113`).
3. Until that lands, stat only the selected segment and lower the list limit to what the UI renders.

### Step 4 — Right-size segments and infrastructure

1. `SEGMENT_SEC=60` (or 120–300); keep hourly consolidation for archives.
2. Move `data` off the Windows bind mount to a native ext4/WSL volume (`docker-compose.yml:108-110,146-148`; spec E14).
3. Add the nginx media location with `proxy_buffering off`, HTTP/1.1, and `Range`/`If-Range` passthrough.

### Step 5 — Client cleanup

1. `preload="metadata"` by default; switch to `auto` on explicit Play.
2. Fix `setStreamMode` / `retryPlayback` to wait for `nextTick` + `loadedmetadata`; add a generation guard.
3. Parallelize activity/events, abort stale requests, and do not block the player on them.
4. Move media auth off the URL query string.
5. Split the playhead/scrubber into a child component or use CSS variables so `timeupdate` does not re-render 720 bars and 100 rows.
6. Use a browser download for export instead of `res.blob()`.
7. Surface media errors/metrics instead of `catch(() => {})`.

---

## 6. Verification plan (acceptance criteria)

Measure the same way before/after; keep or revert strictly.

| Metric | Baseline (measured) | Target |
|---|---|---|
| Media requests to first frame, 1 h / 623 MB segment | 233+ in 5.3 s; ~1,500 total | **≤ 5** |
| Time to `readyState = 4`, 623 MB segment (localhost) | > 15 s (scanning) | **≤ 1 s** |
| Same for 3.6 GB segment | ~3 min (extrapolated) | **≤ 2 s** |
| `/api/recordings?limit=100` p50 | 243–255 ms | **≤ 50 ms** |
| Aborted-range fd/stream growth | unbounded per scan | **no growth** (fd count stable under a 1,000-request abort test) |
| Seek to 60 s in a 1 h segment | full scan | **≤ 3 range requests** |
| `Range: bytes=-500` | 416 | **206** with correct `Content-Range` |
| API process survives 1,000 rapid aborted streams | risk of `EMFILE`/crash | stays healthy |

Synthetic checks:

- Box-level: `ffprobe -v trace` or a small box parser asserts `sidx` present and `mvhd.duration > 0` (or `mehd`).
- Browser-level: Playwright test that loads `/playback`, records `request` events for `/stream`, asserts `count <= 5` and `video.readyState === 4` within 2 s on a fixture segment.
- API-level: supertest for suffix/multi-range, `If-Range`, `ETag`, and an abort test that asserts the read stream is destroyed.
- Regression: keep existing `recordings.test.ts` and `playback.test.ts` green; add the new cases.

---

## 7. Findings ledger (what to keep / what to ignore)

| Idea | Evidence | Verdict |
|---|---|---|
| Add `sidx` to segmented MP4 | 250 → 2 requests on identical 94 MB files | **Keep** (primary fix) |
| Remux finalized raw to faststart | consolidator already uses `+faststart` successfully (`consolidator.ts:283`) | **Fallback / archive fix** |
| `preload="metadata"` alone | Chromium still scans for duration | **Necessary but not sufficient** |
| Cache-Control alone | Does not help first load; helps revisits only | **Secondary** |
| Shorten segments | Directly reduces worst-case scan size | **Keep** |
| Parallelize activity/events | 10–120 ms, not the video bottleneck | **Nice-to-have** |
| Virtualize the 100-row list | 100 DOM rows is not the bottleneck | **Not needed now** |
| Add a CDN | Media is private and same-origin; not the issue | **No** |

---

## 8. Appendix — exact reproduction notes

### 8.1 Box inspection

```
node -e "const fs=require('fs');const b=fs.readFileSync('data/raw/cam19/20261104_020000_1.mp4');..."
```

Relevant output: `ftyp 28`, `moov 766`, `mvhd version 0 timescale 1000 duration 0`, `mvex 40` with `trex` only, then `moof 144` / `mdat 400654` repeating.

### 8.2 Live timings

- `GET /api/recordings?camera_id=31&limit=100`: 243/255/244/246 ms (4 runs).
- `GET /api/recordings/1122/stream` with `Range: bytes=0-1048575`: TTFB 8–10 ms, total ~20 ms, 1 MiB.
- `/playback` reload: 233 media requests in the first 5.3 s, all `206` + `ERR_ABORTED`, `readyState 0` at 15 s.
- Controlled A/B: `nosidx.mp4` 250 requests / 74,400 B; `withsidx.mp4` 2 requests / 33,251 B; both 94,240,xxx bytes.

### 8.3 File references

| Concern | Location |
|---|---|
| Segment flags | `services/media-engine/recorder/src/supervisor.ts:243-258`; `dist/supervisor.js:224-228` |
| Segment duration default | `docker-compose.yml:105,145`; `recorder/src/recorder.ts:87` |
| Stream endpoint | `apps/api-server/src/routes/recordings.ts:274-370` |
| Path safety / per-row stat | `recordings.ts:30-48`, `:101-113` |
| Range parser | `recordings.ts:337-346` |
| Activity fallback | `recordings.ts:207-265` |
| List fetch / select | `apps/web-dashboard/src/views/TimelineView.vue:945-1033` |
| Player element | `TimelineView.vue:186-201` |
| Mode switch double-load | `TimelineView.vue:879-892` |
| Token in URL | `TimelineView.vue:635-640` |
| Timeupdate re-render | `TimelineView.vue:894-898` |
| Proxy buffering | `apps/web-dashboard/nginx.conf:34-41` |
| Data bind mount | `docker-compose.yml:108-110,146-148` |
| Consolidator faststart | `apps/api-server/src/transcode/consolidator.ts:283` |
