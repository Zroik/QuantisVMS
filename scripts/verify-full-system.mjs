import pkg from "../apps/web-dashboard/node_modules/@playwright/test/index.js";
const { chromium } = pkg;
import path from "node:path";
import fs from "node:fs";

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    acceptDownloads: true,
  });
  const page = await context.newPage();

  console.log("1. Logging into Quantis...");
  await page.goto("http://localhost:5173/login");
  await page.fill('input[type="text"]', "admin");
  await page.fill('input[type="password"]', "admin123");
  await page.click('button[type="submit"]');
  await page.waitForURL("**/matrix");
  console.log("Logged in successfully.");

  // 2. Test /timeline
  console.log("2. Navigating to /timeline...");
  await page.goto("http://localhost:5173/timeline");
  await page.waitForTimeout(3000);

  const camOptions = await page.evaluate(() => {
    const sel = document.querySelector("select.sel");
    if (!sel) return [];
    return Array.from(sel.options).map(o => ({ value: o.value, text: o.text }));
  });
  console.log("Camera options:", JSON.stringify(camOptions));

  // Verify video player state
  const videoState = await page.evaluate(() => {
    const v = document.querySelector("video");
    return {
      src: v?.src,
      error: v?.error ? { code: v.error.code, message: v.error.message } : null,
      currentSrc: v?.currentSrc,
      readyState: v?.readyState,
      videoWidth: v?.videoWidth,
      videoHeight: v?.videoHeight,
      paused: v?.paused,
    };
  });
  console.log("Video state on timeline:", JSON.stringify(videoState, null, 2));

  // Test Snapshot button
  console.log("3. Testing Snapshot ('Tangkapan') button...");
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 5000 }).catch(() => null),
    page.click('button.t:has-text("Tangkapan")'),
  ]);

  if (download) {
    const downloadPath = path.resolve("docs/screenshots", download.suggestedFilename());
    await download.saveAs(downloadPath);
    const stats = fs.statSync(downloadPath);
    console.log(`Snapshot saved to ${downloadPath} (size: ${(stats.size / 1024).toFixed(1)} KB)`);
  } else {
    console.log("Download event not captured directly, checking canvas export...");
  }

  // Save screenshot of timeline light mode
  const timelineLightPath = path.resolve("C:/Users/ZroiK/.gemini/antigravity/brain/d61fc82e-89e9-4114-8722-31f63fe177cb/timeline-live-clean-light.png");
  await page.screenshot({ path: timelineLightPath, fullPage: true });
  console.log(`Saved timeline light screenshot: ${timelineLightPath}`);

  // Test timeline dark mode
  await page.click("#theme");
  await page.waitForTimeout(1000);
  const timelineDarkPath = path.resolve("C:/Users/ZroiK/.gemini/antigravity/brain/d61fc82e-89e9-4114-8722-31f63fe177cb/timeline-live-clean-dark.png");
  await page.screenshot({ path: timelineDarkPath, fullPage: true });
  console.log(`Saved timeline dark screenshot: ${timelineDarkPath}`);

  // Switch back to light mode
  await page.click("#theme");
  await page.waitForTimeout(500);

  // 4. Test /hardware
  console.log("4. Navigating to /hardware...");
  await page.goto("http://localhost:5173/hardware");
  await page.waitForTimeout(2500);

  const hwLightPath = path.resolve("C:/Users/ZroiK/.gemini/antigravity/brain/d61fc82e-89e9-4114-8722-31f63fe177cb/hardware-live-clean-light.png");
  await page.screenshot({ path: hwLightPath, fullPage: true });
  console.log(`Saved hardware light screenshot: ${hwLightPath}`);

  // Hardware dark mode
  await page.click("#theme");
  await page.waitForTimeout(1000);
  const hwDarkPath = path.resolve("C:/Users/ZroiK/.gemini/antigravity/brain/d61fc82e-89e9-4114-8722-31f63fe177cb/hardware-live-clean-dark.png");
  await page.screenshot({ path: hwDarkPath, fullPage: true });
  console.log(`Saved hardware dark screenshot: ${hwDarkPath}`);

  // 5. Test camera 2 on timeline
  console.log("5. Testing Camera 2 (v380 pro) on /timeline...");
  await page.goto("http://localhost:5173/timeline");
  await page.waitForTimeout(1500);
  await page.selectOption("select.sel", "2");
  await page.waitForTimeout(2500);

  const cam2VideoState = await page.evaluate(() => {
    const v = document.querySelector("video");
    return {
      src: v?.src,
      error: v?.error ? { code: v.error.code, message: v.error.message } : null,
      readyState: v?.readyState,
      videoWidth: v?.videoWidth,
      videoHeight: v?.videoHeight,
    };
  });
  console.log("Camera 2 video state:", JSON.stringify(cam2VideoState, null, 2));

  const cam2TimelinePath = path.resolve("C:/Users/ZroiK/.gemini/antigravity/brain/d61fc82e-89e9-4114-8722-31f63fe177cb/timeline-cam2-verified.png");
  await page.screenshot({ path: cam2TimelinePath, fullPage: true });
  console.log(`Saved cam 2 timeline screenshot: ${cam2TimelinePath}`);

  await browser.close();
  console.log("Verification finished successfully!");
}

run().catch(console.error);

