const path = require('path');
const { chromium } = require(path.resolve(__dirname, '../apps/web-dashboard/node_modules/@playwright/test'));

const ARTIFACT_DIR = path.resolve('C:/Users/ZroiK/.gemini/antigravity/brain/d61fc82e-89e9-4114-8722-31f63fe177cb');

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1600 }
  });
  const page = await context.newPage();

  // Login
  await page.goto('http://localhost:5173/login', { waitUntil: 'networkidle' });
  await page.fill('input[type="text"]', 'admin');
  await page.fill('input[type="password"]', 'AdminPass123!');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/matrix', { timeout: 10000 });

  // Toggle Dark Theme
  console.log('Toggling dark theme...');
  const themeBtn = await page.$('#theme');
  if (themeBtn) {
    await themeBtn.click();
    await page.waitForTimeout(500);
  }

  // Hardware in Dark Mode
  console.log('Checking /hardware in dark mode...');
  await page.goto('http://localhost:5173/hardware', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(ARTIFACT_DIR, 'hardware_view_dark.png') });

  // Configuration in Dark Mode
  console.log('Checking /configuration in dark mode...');
  await page.goto('http://localhost:5173/configuration', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(ARTIFACT_DIR, 'configuration_view_dark.png') });

  const subNav = await page.$('nav.sub');
  if (subNav) {
    await subNav.screenshot({ path: path.join(ARTIFACT_DIR, 'configuration_subnav_dark.png') });
  }

  console.log('Dark mode screenshots captured');
  await browser.close();
}

main();

