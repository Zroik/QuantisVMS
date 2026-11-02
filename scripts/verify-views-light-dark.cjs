const path = require('path');
const { chromium } = require(path.resolve(__dirname, '../apps/web-dashboard/node_modules/@playwright/test'));

const ARTIFACT_DIR = 'C:/Users/ZroiK/.gemini/antigravity/brain/d61fc82e-89e9-4114-8722-31f63fe177cb';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1100 } });
  const page = await context.newPage();

  // Login
  await page.goto('http://localhost:5173/login', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('input[type="text"], input[name="username"]', { timeout: 5000 });
  await page.fill('input[type="text"], input[name="username"]', 'admin');
  await page.fill('input[type="password"]', 'AdminPass123!');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(1000);

  // Set dark theme via localStorage
  await page.evaluate(() => {
    localStorage.setItem('vms_theme', 'dark');
  });

  // 1. Matrix Dark
  await page.goto('http://localhost:5173/matrix', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(ARTIFACT_DIR, 'matrix_3_cameras_dark.png') });

  // 2. Hardware Dark
  await page.goto('http://localhost:5173/hardware', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(ARTIFACT_DIR, 'hardware_3_cameras_dark.png'), fullPage: true });

  // 3. Configuration Camera Tab Dark
  await page.goto('http://localhost:5173/configuration?tab=camera', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(ARTIFACT_DIR, 'config_3_cameras_dark.png') });

  await browser.close();
  console.log('Finished dark mode captures.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
