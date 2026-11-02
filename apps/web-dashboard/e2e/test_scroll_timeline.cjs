const path = require('path');
const { chromium } = require(path.resolve(__dirname, 'node_modules/@playwright/test'));

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();

  await page.goto('http://localhost:5173/login');
  await page.fill('input[type="text"]', 'admin');
  await page.fill('input[type="password"]', 'AdminPass123!');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/matrix');

  await page.goto('http://localhost:5173/timeline');
  await page.waitForTimeout(1500);

  // Scroll main-content by 1150px
  await page.evaluate(() => {
    const el = document.querySelector('.main-content');
    if (el) el.scrollTop = 1150;
  });
  await page.waitForTimeout(600);

  const outPath = 'C:/Users/ZroiK/.gemini/antigravity/brain/d61fc82e-89e9-4114-8722-31f63fe177cb/quantis_timeline_bottom_events.png';
  await page.screenshot({ path: outPath });
  console.log('Saved bottom timeline screenshot:', outPath);

  await browser.close();
})();
