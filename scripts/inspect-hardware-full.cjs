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

  // Navigate to hardware
  await page.goto('http://localhost:5173/hardware', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  // Screenshot with taller viewport so everything is visible
  await page.screenshot({ path: path.join(ARTIFACT_DIR, 'hardware_full_1600.png') });

  // Scroll to bottom and screenshot
  await page.evaluate(() => {
    const main = document.querySelector('.main-content') || window;
    main.scrollTo(0, 1000);
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(ARTIFACT_DIR, 'hardware_scrolled_bottom.png') });

  console.log('Screenshots taken');
  await browser.close();
}

main();

