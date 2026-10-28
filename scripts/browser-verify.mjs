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
  await page.waitForTimeout(2000);

  // Take screenshot of Live Matrix
  const matrixScreenshotPath = path.resolve("docs/screenshots/browser-proof-matrix.png");
  await page.screenshot({ path: matrixScreenshotPath });
  console.log(`[Browser Verification] Saved Live Matrix screenshot to ${matrixScreenshotPath}`);

  // Check if camera name exists on page
  const pageContent = await page.content();
  const hasHikvision = pageContent.includes("Hikvision CCTV");
  console.log(`[Browser Verification] Live Matrix includes 'Hikvision CCTV': ${hasHikvision}`);

  // Navigate to Settings
  console.log("[Browser Verification] Navigating to http://localhost:5173/settings...");
  await page.goto("http://localhost:5173/settings", { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);

  // Take screenshot of Settings
  const settingsScreenshotPath = path.resolve("docs/screenshots/browser-proof-settings.png");
  await page.screenshot({ path: settingsScreenshotPath });
  console.log(`[Browser Verification] Saved Settings screenshot to ${settingsScreenshotPath}`);

  const settingsContent = await page.content();
  const hasHikvisionInSettings = settingsContent.includes("Hikvision CCTV");
  console.log(`[Browser Verification] Settings includes 'Hikvision CCTV': ${hasHikvisionInSettings}`);

  await browser.close();

  return {
    hasHikvision,
    hasHikvisionInSettings,
    matrixScreenshotPath,
    settingsScreenshotPath,
    apiResponses,
    consoleLogs: consoleLogs.slice(-10),
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
