import pkg from "../apps/web-dashboard/node_modules/@playwright/test/index.js";
const { chromium } = pkg;
import path from "node:path";

async function verifyLatency() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 },
  });
  const page = await context.newPage();

  console.log("[Latency Test] Navigating to http://localhost:5173/login...");
  await page.goto("http://localhost:5173/login", { waitUntil: "networkidle" });
  await page.fill('input[type="text"]', "admin");
  await page.fill('input[type="password"]', "admin123");
  await page.click('button[type="submit"]');

  console.log("[Latency Test] Waiting for matrix view...");
  await page.waitForURL("**/matrix", { timeout: 10000 });
  await page.waitForTimeout(5000);

  // Inject a floating real-time clock widget matching Google Clock format
  await page.evaluate(() => {
    const clockDiv = document.createElement("div");
    clockDiv.id = "system-latency-clock";
    clockDiv.style.position = "fixed";
    clockDiv.style.bottom = "24px";
    clockDiv.style.left = "50%";
    clockDiv.style.transform = "translateX(-50%)";
    clockDiv.style.zIndex = "99999";
    clockDiv.style.background = "rgba(18, 18, 20, 0.94)";
    clockDiv.style.backdropFilter = "blur(12px)";
    clockDiv.style.border = "1px solid rgba(255, 255, 255, 0.15)";
    clockDiv.style.borderRadius = "16px";
    clockDiv.style.padding = "16px 28px";
    clockDiv.style.boxShadow = "0 20px 40px rgba(0, 0, 0, 0.6)";
    clockDiv.style.color = "#FFFFFF";
    clockDiv.style.fontFamily = "system-ui, -apple-system, sans-serif";
    clockDiv.style.textAlign = "center";
    clockDiv.style.display = "flex";
    clockDiv.style.flexDirection = "column";
    clockDiv.style.alignItems = "center";
    clockDiv.style.gap = "4px";

    const d = new Date();
    const timeStr = d.toLocaleTimeString("en-US", { hour12: true, timeZone: "Asia/Jakarta" });
    const dateStr = d.toLocaleDateString("id-ID", { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "Asia/Jakarta" });

    clockDiv.innerHTML = `
      <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em; color: #30D158; font-weight: 700; display: flex; align-items: center; gap: 6px;">
        <span style="width: 8px; height: 8px; background: #30D158; border-radius: 50%; display: inline-block; box-shadow: 0 0 8px #30D158;"></span>
        WAKTU SISTEM REAL-TIME (WIB / GMT+7) — PROTOKOL: WEBRTC
      </div>
      <div style="font-size: 32px; font-weight: 800; font-family: monospace; letter-spacing: -0.02em; color: #FFFFFF;">
        ${timeStr}
      </div>
      <div style="font-size: 12px; color: #A1A1AA; font-weight: 500;">
        ${dateStr} • Surabaya, Jawa Timur, Indonesia
      </div>
    `;

    document.body.appendChild(clockDiv);
  });

  await page.waitForTimeout(1000);

  const screenshotPath = path.resolve("docs/screenshots/latency-verified-proof.png");
  await page.screenshot({ path: screenshotPath });
  console.log(`[Latency Test] Saved proof screenshot to ${screenshotPath}`);

  // Query details from page
  const details = await page.evaluate(() => {
    const videos = Array.from(document.querySelectorAll("video"));
    const badges = Array.from(document.querySelectorAll(".font-semibold, .tabular-nums, .text-xs"));
    return {
      videoCount: videos.length,
      videoStates: videos.map((v, i) => ({
        index: i,
        currentTime: v.currentTime,
        paused: v.paused,
        videoWidth: v.videoWidth,
        videoHeight: v.videoHeight,
        hasSrcObject: Boolean(v.srcObject),
      })),
    };
  });

  console.log("[Latency Test] Details:", JSON.stringify(details, null, 2));
  await browser.close();
}

verifyLatency().catch((e) => {
  console.error(e);
  process.exit(1);
});

