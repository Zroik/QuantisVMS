const path = require('path');
const { chromium } = require(path.resolve(__dirname, '../apps/web-dashboard/node_modules/@playwright/test'));

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto('http://localhost:5173/login', { waitUntil: 'networkidle' });
  await page.fill('input[type="text"]', 'admin');
  await page.fill('input[type="password"]', 'admin123');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/matrix');
  await page.goto('http://localhost:5173/hardware', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  // Click theme toggle to dark
  await page.click('#theme');
  await page.waitForTimeout(650);
  const isDark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
  console.log('Hardware page switched to dark:', isDark);

  // Click theme toggle back to light
  await page.click('#theme');
  await page.waitForTimeout(650);
  const isLight = await page.evaluate(() => !document.documentElement.classList.contains('dark'));
  console.log('Hardware page switched back to light:', isLight);

  await browser.close();
}

main().catch(console.error);

