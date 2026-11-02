const path = require('path');
const { chromium } = require(path.resolve(__dirname, '../apps/web-dashboard/node_modules/@playwright/test'));

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });

  await page.goto('http://localhost:5173/login', { waitUntil: 'networkidle' });
  await page.fill('input[type="text"]', 'admin');
  await page.fill('input[type="password"]', 'AdminPass123!');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/matrix');

  // Switch to dark theme if not already dark
  await page.evaluate(() => {
    document.documentElement.setAttribute('data-theme', 'dark');
    localStorage.setItem('vms_theme', 'dark');
  });

  // 1. Configuration dark mode
  await page.goto('http://localhost:5173/configuration', { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    document.documentElement.setAttribute('data-theme', 'dark');
  });
  await page.waitForTimeout(500);

  const compTab = page.locator('.sn-nav button:has-text("Kompresi"), button:has-text("Kompresi")').first();
  await compTab.click();
  await page.waitForTimeout(800);

  await page.screenshot({ path: 'C:/Users/ZroiK/.gemini/antigravity/brain/d61fc82e-89e9-4114-8722-31f63fe177cb/config_compression_delay_dark.png' });
  console.log('Saved config_compression_delay_dark.png');

  // 2. Timeline dark mode
  await page.goto('http://localhost:5173/timeline', { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    document.documentElement.setAttribute('data-theme', 'dark');
  });
  await page.waitForTimeout(1000);

  await page.screenshot({ path: 'C:/Users/ZroiK/.gemini/antigravity/brain/d61fc82e-89e9-4114-8722-31f63fe177cb/timeline_default_raw_mode_dark.png' });
  console.log('Saved timeline_default_raw_mode_dark.png');

  await browser.close();
}

main().catch(console.error);

