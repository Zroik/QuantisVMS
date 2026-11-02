import pkg from "../apps/web-dashboard/node_modules/@playwright/test/index.js";
const { chromium } = pkg;
import path from "node:path";

async function testCamera2() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();

  await page.goto("http://localhost:5173/login");
  await page.fill('input[type="text"]', "admin");
  await page.fill('input[type="password"]', "admin123");
  await page.click('button[type="submit"]');
  await page.waitForURL("**/matrix");

  await page.goto("http://localhost:5173/timeline");
  await page.waitForTimeout(3000);

  console.log("Switching to Camera 2 (v380 pro)...");
  await page.selectOption("select", { label: "v380 pro" });
  await page.waitForTimeout(4000);

  const state = await page.evaluate(() => {
    const v = document.querySelector("video");
    const recordingsCount = document.querySelectorAll(".space-y-2 > div").length;
    const heatmapBars = document.querySelectorAll(".h-14 .flex-1").length;
    return {
      recordingsRendered: recordingsCount,
      heatmapBarsCount: heatmapBars,
      video: {
        src: v?.src ? v.src.substring(0, 80) + "..." : null,
        error: v?.error ? { code: v.error.code, message: v.error.message } : null,
        readyState: v?.readyState,
        duration: v?.duration,
      }
    };
  });

  console.log("Camera 2 State:", JSON.stringify(state, null, 2));

  const screenshotPath = path.resolve("docs/screenshots/timeline-camera2-verified.png");
  await page.screenshot({ path: screenshotPath });
  console.log("Saved camera 2 timeline screenshot to", screenshotPath);

  await browser.close();
}

testCamera2().catch(console.error);

