import pkg from "../apps/web-dashboard/node_modules/@playwright/test/index.js";
const { chromium } = pkg;

async function run() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', err => console.log('PAGE ERROR:', err));
  page.on('requestfailed', req => console.log('REQ FAILED:', req.url(), req.failure()?.errorText));
  page.on('response', res => {
    if (res.url().includes('/stream') || res.status() >= 400) {
      console.log('HTTP RESP:', res.status(), res.url());
    }
  });

  await page.goto('http://localhost:5173/login');
  await page.fill('input[type="text"]', 'admin');
  await page.fill('input[type="password"]', 'admin123');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/matrix');

  await page.goto('http://localhost:5173/timeline');
  await page.waitForTimeout(3000);

  // Click on segment 1054 in the right list
  const seg1054 = page.locator('text=Segmen #1054');
  if (await seg1054.count() > 0) {
    console.log("Found Segmen #1054, clicking...");
    await seg1054.first().click();
    await page.waitForTimeout(3000);
  } else {
    console.log("Segmen #1054 not found in list");
  }

  const videoState = await page.evaluate(() => {
    const v = document.querySelector('video');
    return {
      src: v?.src,
      error: v?.error ? { code: v.error.code, message: v.error.message } : null,
      currentSrc: v?.currentSrc,
      readyState: v?.readyState,
      networkState: v?.networkState
    };
  });
  console.log('Video state 1054:', JSON.stringify(videoState, null, 2));

  await browser.close();
}

run().catch(console.error);
