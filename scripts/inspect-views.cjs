const path = require('path');
const { chromium } = require(path.resolve(__dirname, '../apps/web-dashboard/node_modules/@playwright/test'));

const ARTIFACT_DIR = path.resolve('C:/Users/ZroiK/.gemini/antigravity/brain/d61fc82e-89e9-4114-8722-31f63fe177cb');

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 }
  });
  const page = await context.newPage();

  // 1. Login
  console.log('Logging in...');
  await page.goto('http://localhost:5173/login', { waitUntil: 'networkidle' });
  await page.fill('input[type="text"]', 'admin');
  await page.fill('input[type="password"]', 'AdminPass123!');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/matrix', { timeout: 10000 });

  // 2. Hardware Page (Check chart and camera table)
  console.log('Checking /hardware...');
  await page.goto('http://localhost:5173/hardware', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(ARTIFACT_DIR, 'hardware_view_light.png'), fullPage: true });

  // 3. Configuration Page (Check sub-tabs / accordion)
  console.log('Checking /configuration...');
  await page.goto('http://localhost:5173/configuration', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(ARTIFACT_DIR, 'configuration_view_light.png'), fullPage: true });

  // Also focus on sub-navigation rail in /configuration
  const subNav = await page.$('nav.sub');
  if (subNav) {
    await subNav.screenshot({ path: path.join(ARTIFACT_DIR, 'configuration_subnav_light.png') });
  }

  console.log('Done!');
  await browser.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

