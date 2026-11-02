import pkg from "../apps/web-dashboard/node_modules/@playwright/test/index.js";
const { chromium } = pkg;
import path from "node:path";

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await context.newPage();

  console.log("Logging in...");
  await page.goto("http://localhost:5173/login");
  await page.fill('input[type="text"]', "admin");
  await page.fill('input[type="password"]', "admin123");
  await page.click('button[type="submit"]');
  await page.waitForURL("**/matrix");

  const pages = [
    { name: "hardware", url: "http://localhost:5173/hardware" },
    { name: "matrix", url: "http://localhost:5173/matrix" },
    { name: "vmaf", url: "http://localhost:5173/vmaf" },
    { name: "timeline", url: "http://localhost:5173/timeline" },
    { name: "settings", url: "http://localhost:5173/settings" },
  ];

  for (const p of pages) {
    console.log(`Navigating to ${p.url}...`);
    await page.goto(p.url);
    await page.waitForTimeout(2500);

    const outPath = path.resolve(`docs/screenshots/redesign-${p.name}-light.png`);
    await page.screenshot({ path: outPath, fullPage: true });
    console.log(`Saved ${outPath}`);
  }

  // Also toggle dark mode and capture hardware dark mode
  console.log("Testing Dark Mode on /hardware...");
  await page.goto("http://localhost:5173/hardware");
  await page.waitForTimeout(1000);
  await page.click('#theme');
  await page.waitForTimeout(1500);
  const outDark = path.resolve("docs/screenshots/redesign-hardware-dark.png");
  await page.screenshot({ path: outDark, fullPage: true });
  console.log(`Saved ${outDark}`);

  await browser.close();
  console.log("All screenshots captured successfully.");
}

run().catch(console.error);

