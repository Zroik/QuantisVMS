import pkg from "../apps/web-dashboard/node_modules/@playwright/test/index.js";
const { chromium } = pkg;
import fs from "node:fs/promises";
import path from "node:path";

async function runBrowserVerification() {
  console.log("[Browser Verification] Launching Chromium browser...");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();

  const consoleLogs = [];
  page.on("console", (msg) => {
    consoleLogs.push(`[${msg.type()}] ${msg.text()}`);
  });

  const apiResponses = [];
  page.on("response", async (res) => {
    if (res.url().includes("/api/")) {
      try {
        const text = await res.text();
        apiResponses.push({ url: res.url(), status: res.status(), body: text.slice(0, 300) });
      } catch {}
    }
  });

  console.log("[Browser Verification] Navigating to http://localhost:5173/login...");
  await page.goto("http://localhost:5173/login", { waitUntil: "networkidle" });

  console.log("[Browser Verification] Filling login form with admin / admin123...");
  await page.fill('input[type="text"]', "admin");
  await page.fill('input[type="password"]', "admin123");
  await page.click('button[type="submit"]');

  console.log("[Browser Verification] Waiting for matrix view navigation...");
  await page.waitForURL("**/matrix", { timeout: 10000 });
  // Wait 6 seconds for live video buffering & first segment playback
  await page.waitForTimeout(6000);

  const videoState = await page.evaluate(() => {
    const v = document.querySelector("video");
    const errEl = document.querySelector(".text-red-400");
    return {
      exists: Boolean(v),
      paused: v ? v.paused : null,
      currentTime: v ? v.currentTime : null,
      videoWidth: v ? v.videoWidth : null,
      videoHeight: v ? v.videoHeight : null,
      src: v ? (v.src || (v.srcObject ? "MediaStream" : null)) : null,
      errorMessage: errEl ? errEl.textContent : null,
    };
  });
  console.log("[Browser Verification] Video State on Matrix:", JSON.stringify(videoState));

  // Take screenshot of Live Matrix
  const matrixScreenshotPath = path.resolve("docs/screenshots/browser-proof-matrix.png");
  await page.screenshot({ path: matrixScreenshotPath });
  console.log(`[Browser Verification] Saved Live Matrix screenshot to ${matrixScreenshotPath}`);

  // Check if camera names exist on page
  const pageContent = await page.content();
  const hasHikvision = pageContent.includes("Hikvision CCTV");
  const hasV380 = pageContent.includes("v380 pro");
  console.log(`[Browser Verification] Live Matrix includes 'Hikvision CCTV': ${hasHikvision}`);
  console.log(`[Browser Verification] Live Matrix includes 'v380 pro': ${hasV380}`);

  // Navigate to Hardware Monitor (Monitor Perangkat Keras) via client router navigation
  console.log("[Browser Verification] Navigating to http://localhost:5173/hardware...");
  await page.click('a[href="/hardware"]');
  // Wait for the tabular stats to populate from /api/stats (real hardware metrics)
  await page.waitForFunction(() => {
    const el = document.querySelectorAll('.tabular-nums');
    // el[1] is GPU load percentage, wait until it's loaded and not 0% (or temp is updated)
    return el.length >= 3 && el[1].textContent.trim() !== '0%' && el[2].textContent.includes('GB') && !el[2].textContent.startsWith('0.00');
  }, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1000);

  const hwScreenshotPath = path.resolve("docs/screenshots/browser-proof-hardware.png");
  await page.screenshot({ path: hwScreenshotPath });
  console.log(`[Browser Verification] Saved Hardware Monitor screenshot to ${hwScreenshotPath}`);

  // Navigate to Settings
  console.log("[Browser Verification] Navigating to http://localhost:5173/settings...");
  await page.click('a[href="/settings"]');
  await page.waitForSelector('td:has-text("Hikvision CCTV")', { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(1000);

  // Take screenshot of Settings
  const settingsScreenshotPath = path.resolve("docs/screenshots/browser-proof-settings.png");
  await page.screenshot({ path: settingsScreenshotPath });
  console.log(`[Browser Verification] Saved Settings screenshot to ${settingsScreenshotPath}`);

  const settingsContent = await page.content();
  const hasHikvisionInSettings = settingsContent.includes("Hikvision CCTV");
  const hasV380InSettings = settingsContent.includes("v380 pro");
  console.log(`[Browser Verification] Settings includes 'Hikvision CCTV': ${hasHikvisionInSettings}`);
  console.log(`[Browser Verification] Settings includes 'v380 pro': ${hasV380InSettings}`);

  await browser.close();

  return {
    hasHikvision,
    hasV380,
    hasHikvisionInSettings,
    hasV380InSettings,
    videoState,
    matrixScreenshotPath,
    hwScreenshotPath,
    settingsScreenshotPath,
    apiResponses,
    consoleLogs: consoleLogs.slice(-15),
  };
}

runBrowserVerification()
  .then((res) => {
    console.log("[Browser Verification] RESULT:", JSON.stringify(res, null, 2));
    process.exit(res.hasHikvision && res.hasHikvisionInSettings ? 0 : 1);
  })
  .catch((err) => {
    console.error("[Browser Verification] FAILED:", err);
    process.exit(1);
  });
