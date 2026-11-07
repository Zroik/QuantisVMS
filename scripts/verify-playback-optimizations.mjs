import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverRequire = createRequire(path.join(repoRoot, "apps", "web-dashboard", "package.json"));
const { chromium } = serverRequire("@playwright/test");

const BASE_URL = process.env.VMS_WEB_URL || "http://localhost:8080";
const ADMIN_USER = process.env.VMS_ADMIN_USER || "admin";
const ADMIN_PASS = process.env.VMS_ADMIN_PASSWORD || "admin123";

async function run() {
  console.log("=== 1. API Verification ===");

  // 1. Login
  const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: ADMIN_USER, password: ADMIN_PASS }),
  });
  if (!loginRes.ok) throw new Error(`Login failed: ${loginRes.status}`);
  const { accessToken } = await loginRes.json();
  console.log("Logged in successfully. Token acquired.");

  // 2. Measure GET /api/recordings?limit=100
  const timings = [];
  let recsData = null;
  for (let i = 0; i < 4; i++) {
    const t0 = performance.now();
    const res = await fetch(`${BASE_URL}/api/recordings?camera_id=31&limit=100`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const t1 = performance.now();
    if (res.ok) {
      timings.push(t1 - t0);
      recsData = await res.json();
    }
  }
  const avgTime = timings.reduce((a, b) => a + b, 0) / timings.length;
  console.log(`GET /api/recordings?limit=100 (4 runs): ${timings.map(t => t.toFixed(1) + "ms").join(", ")} | Avg: ${avgTime.toFixed(1)}ms (Baseline was 243-255ms, Target: <=50ms)`);

  const playableRec = recsData?.recordings?.find(r => r.playable && (r.raw_size_bytes > 500000 || r.compressed_size_bytes > 500000)) || recsData?.recordings?.[0];
  if (!playableRec) {
    console.warn("No playable recording found to test streaming.");
    return;
  }
  console.log(`Testing stream with recording #${playableRec.id}...`);

  // 3. Test Range Header (bytes=0-1048575)
  const streamRes = await fetch(`${BASE_URL}/api/recordings/${playableRec.id}/stream`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Range: "bytes=0-1048575",
    },
  });
  console.log("Range bytes=0-1048575 status:", streamRes.status, `(Expected: 206)`);
  console.log("Content-Range:", streamRes.headers.get("content-range"));
  console.log("Accept-Ranges:", streamRes.headers.get("accept-ranges"));
  console.log("ETag:", streamRes.headers.get("etag"));
  console.log("Cache-Control:", streamRes.headers.get("cache-control"));

  // 4. Test Suffix Range (bytes=-500)
  const suffixRes = await fetch(`${BASE_URL}/api/recordings/${playableRec.id}/stream`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Range: "bytes=-500",
    },
  });
  console.log("Suffix range bytes=-500 status:", suffixRes.status, `(Expected: 206)`);
  console.log("Suffix Content-Range:", suffixRes.headers.get("content-range"));

  // 5. Test If-None-Match with ETag
  const etag = streamRes.headers.get("etag");
  if (etag) {
    const etagRes = await fetch(`${BASE_URL}/api/recordings/${playableRec.id}/stream`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "If-None-Match": etag,
      },
    });
    console.log("If-None-Match matching ETag status:", etagRes.status, `(Expected: 304)`);
  }

  // 6. Test Activity Windows fallback & performance
  const actRes = await fetch(`${BASE_URL}/api/recordings/${playableRec.id}/activity-windows`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const actData = await actRes.json();
  console.log(`Activity windows returned: ${actData.windows?.length || 0} windows`);

  console.log("\n=== 2. Headless Chromium / Edge Browser Verification ===");
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  let mediaRequestsCount = 0;
  const mediaRanges = [];

  page.on("request", (req) => {
    if (req.url().includes("/stream")) {
      mediaRequestsCount++;
      mediaRanges.push(req.headers()["range"] || "no-range");
    }
  });

  console.log("Navigating to /playback in Edge...");
  await page.goto(`${BASE_URL}/login`);
  await page.fill('input[type="text"]', ADMIN_USER);
  await page.fill('input[type="password"]', ADMIN_PASS);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 10000 });

  await page.goto(`${BASE_URL}/playback`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);

  const videoState = await page.evaluate(() => {
    const v = document.querySelector("video");
    if (!v) return null;
    return {
      readyState: v.readyState,
      duration: v.duration,
      currentTime: v.currentTime,
      paused: v.paused,
      preload: v.preload,
      error: v.error ? v.error.message : null,
      currentSrc: v.currentSrc,
    };
  });

  console.log("Video state on /playback:", videoState);
  console.log(`Total /stream requests made: ${mediaRequestsCount} (Baseline was 233+ in 5s; Target: <= 5)`);
  console.log("Media request ranges:", mediaRanges);

  await page.screenshot({ path: path.join(repoRoot, "docs", "screenshots", "playback-verification.png") });
  console.log("Screenshot saved to docs/screenshots/playback-verification.png");

  await browser.close();
}

run().catch(console.error);

