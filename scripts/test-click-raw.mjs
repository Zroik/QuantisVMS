import pkg from "../apps/web-dashboard/node_modules/@playwright/test/index.js";
const { chromium } = pkg;

async function testClickRaw() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  await page.goto("http://localhost:5173/login");
  await page.fill('input[type="text"]', "admin");
  await page.fill('input[type="password"]', "admin123");
  await page.click('button[type="submit"]');
  await page.waitForURL("**/matrix");

  await page.goto("http://localhost:5173/timeline");
  await page.waitForTimeout(3000);

  // Click on the second recording (#425 or whichever is RAW)
  const rawTile = page.locator('.max-h-96 > div:has-text("RAW")').first();
  await rawTile.click();
  await page.waitForTimeout(2000);

  const state = await page.evaluate(() => {
    const v = document.querySelector("video");
    return {
      src: v?.src,
      error: v?.error ? { code: v.error.code, message: v.error.message } : null,
      networkState: v?.networkState,
      duration: v?.duration,
    };
  });

  console.log("State after clicking RAW recording:", state);
  await browser.close();
}

testClickRaw().catch(console.error);

