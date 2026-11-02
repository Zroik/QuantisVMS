import pkg from "../apps/web-dashboard/node_modules/@playwright/test/index.js";
const { chromium } = pkg;
import path from "node:path";

async function capture() {
  const browser = await chromium.launch({ headless: true });

  // 1. Light Mode with Dark OS emulation (the exact user scenario!)
  const ctxLight = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    colorScheme: 'dark' // OS in dark mode!
  });
  const pageLight = await ctxLight.newPage();
  await pageLight.goto("http://localhost:5173/login");
  await pageLight.fill('input[type="text"]', "admin");
  await pageLight.fill('input[type="password"]', "admin123");
  await pageLight.click('button[type="submit"]');
  await pageLight.waitForURL("**/matrix");

  // Force app theme to light
  await pageLight.evaluate(() => {
    localStorage.setItem("vms_theme", "light");
    document.documentElement.dataset.theme = "light";
    document.documentElement.classList.remove("dark");
  });

  await pageLight.goto("http://localhost:5173/timeline");
  await pageLight.waitForTimeout(3000);
  await pageLight.screenshot({ path: path.resolve("docs/screenshots/timeline-light-osdark.png"), fullPage: true });
  console.log("Captured timeline-light-osdark.png");

  // 2. Dark Mode
  await pageLight.evaluate(() => {
    localStorage.setItem("vms_theme", "dark");
    document.documentElement.dataset.theme = "dark";
    document.documentElement.classList.add("dark");
  });
  await pageLight.waitForTimeout(1000);
  await pageLight.screenshot({ path: path.resolve("docs/screenshots/timeline-dark.png"), fullPage: true });
  console.log("Captured timeline-dark.png");

  await browser.close();
}

capture().catch(console.error);

