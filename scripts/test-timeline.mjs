import pkg from "../apps/web-dashboard/node_modules/@playwright/test/index.js";
const { chromium } = pkg;
import path from "node:path";

async function testTimeline() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();

  const networkLogs = [];
  page.on("requestfailed", req => {
    networkLogs.push(`[FAILED] ${req.method()} ${req.url()} - ${req.failure()?.errorText}`);
  });
  page.on("response", res => {
    if (res.status() >= 400 || res.url().includes("/recordings") || res.url().includes("/events")) {
      networkLogs.push(`[RESP ${res.status()}] ${res.request().method()} ${res.url()}`);
    }
  });

  console.log("Logging into dashboard...");
  await page.goto("http://localhost:5173/login");
  await page.fill('input[type="text"]', "admin");
  await page.fill('input[type="password"]', "admin123");
  await page.click('button[type="submit"]');
  await page.waitForURL("**/matrix");

  console.log("Navigating to /timeline...");
  await page.goto("http://localhost:5173/timeline");
  await page.waitForTimeout(4000);

  // Check state
  let state = await page.evaluate(() => {
    const v = document.querySelector("video");
    const recordingsCount = document.querySelectorAll(".space-y-2 > div").length;
    const heatmapBars = document.querySelectorAll(".h-16 .flex-1").length;
    const eventCards = document.querySelectorAll(".grid .border").length;
    return {
      recordingsRendered: recordingsCount,
      heatmapBarsCount: heatmapBars,
      eventsCount: eventCards,
      video: {
        src: v?.src ? v.src.substring(0, 80) + "..." : null,
        error: v?.error ? { code: v.error.code, message: v.error.message } : null,
        readyState: v?.readyState,
        paused: v?.paused,
        duration: v?.duration,
        currentTime: v?.currentTime,
        playbackRate: v?.playbackRate,
      }
    };
  });

  console.log("Initial Timeline State:", JSON.stringify(state, null, 2));

  // Test 1: Click Play button
  console.log("Testing Play button...");
  const playBtn = page.locator('button:has-text("Putar"), button:has-text("Jeda")').first();
  if (await playBtn.count() > 0) {
    await playBtn.click();
    await page.waitForTimeout(1000);
  }

  // Test 2: Test 2x playback speed
  console.log("Testing 2x speed button...");
  const speedBtn = page.locator('button:has-text("2x")').first();
  if (await speedBtn.count() > 0) {
    await speedBtn.click();
    await page.waitForTimeout(500);
  }

  // Test 3: Test +5s seek button
  console.log("Testing +5s seek button...");
  const seekBtn = page.locator('button:has-text("+5s")').first();
  if (await seekBtn.count() > 0) {
    await seekBtn.click();
    await page.waitForTimeout(500);
  }

  // Test 4: Test Event Filter "Orang"
  console.log("Testing Event Filter 'Orang'...");
  const filterBtn = page.locator('button:has-text("Orang")').first();
  if (await filterBtn.count() > 0) {
    await filterBtn.click();
    await page.waitForTimeout(1000);
  }

  // Test 5: Test clicking first Event "Lompat" button
  const firstEventBtn = page.locator('button:has-text("Lompat")').first();
  if (await firstEventBtn.count() > 0) {
    console.log("Testing Event 'Lompat' button...");
    await firstEventBtn.click();
    await page.waitForTimeout(1000);
  }

  state = await page.evaluate(() => {
    const v = document.querySelector("video");
    const recordingsCount = document.querySelectorAll(".space-y-2 > div").length;
    const heatmapBars = document.querySelectorAll(".h-16 .flex-1").length;
    const eventCards = document.querySelectorAll(".grid .border").length;
    return {
      recordingsRendered: recordingsCount,
      heatmapBarsCount: heatmapBars,
      eventsCount: eventCards,
      video: {
        src: v?.src ? v.src.substring(0, 80) + "..." : null,
        error: v?.error ? { code: v.error.code, message: v.error.message } : null,
        readyState: v?.readyState,
        paused: v?.paused,
        duration: v?.duration,
        currentTime: v?.currentTime,
        playbackRate: v?.playbackRate,
      }
    };
  });

  console.log("Post-interaction Timeline State:", JSON.stringify(state, null, 2));

  const screenshotPath = path.resolve("docs/screenshots/timeline-enhanced-verified.png");
  await page.screenshot({ path: screenshotPath });
  console.log("Saved enhanced timeline verified screenshot to", screenshotPath);

  await browser.close();
}

testTimeline().catch(console.error);
