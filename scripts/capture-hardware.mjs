import pkg from "../apps/web-dashboard/node_modules/@playwright/test/index.js";
const { chromium } = pkg;
import path from "node:path";

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await context.newPage();
  await page.goto("http://localhost:5173/login");
  await page.fill('input[type="text"]', "admin");
  await page.fill('input[type="password"]', "admin123");
  await page.click('button[type="submit"]');
  await page.waitForURL("**/matrix");

  await page.goto("http://localhost:5173/hardware");
  await page.waitForTimeout(3000);

  const outPath = path.resolve("docs/screenshots/hardware-current.png");
  await page.screenshot({ path: outPath, fullPage: true });
  console.log("Hardware current screenshot saved to", outPath);
  await browser.close();
}

run().catch(console.error);

