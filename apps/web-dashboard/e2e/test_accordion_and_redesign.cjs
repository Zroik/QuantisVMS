const path = require('path');
const { chromium } = require(path.resolve(__dirname, 'node_modules/@playwright/test'));
const fs = require('fs');

const ARTIFACT_DIR = path.resolve('C:/Users/ZroiK/.gemini/antigravity/brain/d61fc82e-89e9-4114-8722-31f63fe177cb');

async function run() {
  console.log('[Test] Launching Chromium browser...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 }
  });
  const page = await context.newPage();

  // 1. Login to Quantis
  console.log('[Test] Navigating to /login...');
  await page.goto('http://localhost:5173/login', { waitUntil: 'networkidle' });
  await page.fill('input[type="text"]', 'admin');
  await page.fill('input[type="password"]', 'AdminPass123!');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/matrix', { timeout: 10000 });
  console.log('[Test] Login successful, currently at:', page.url());

  // 2. Test /configuration page with tree accordion
  console.log('[Test] Navigating to /configuration...');
  await page.goto('http://localhost:5173/configuration?tab=general', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

  // Check no horizontal scroll
  const noHScrollConfig = await page.evaluate(() => {
    return document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1;
  });
  console.log('[Test] /configuration zero horizontal scroll:', noHScrollConfig);

  // Check tree accordion elements
  const groupHeaders = await page.$$('.sub-group-header');
  console.log('[Test] Found sub-group-header count:', groupHeaders.length);

  const treeLines = await page.$$('.sub-tree-line');
  console.log('[Test] Found sub-tree-line count:', treeLines.length);

  // Click on "Kamera & Perekaman" to toggle collapse
  console.log('[Test] Toggling collapse on group 2...');
  if (groupHeaders.length >= 2) {
    await groupHeaders[1].click();
    await page.waitForTimeout(400);
  }

  // Capture screenshot of /configuration in Light mode
  const configLightPath = path.join(ARTIFACT_DIR, 'quantis_configuration_accordion_light.png');
  await page.screenshot({ path: configLightPath, fullPage: false });
  console.log('[Test] Saved screenshot:', configLightPath);

  // Re-open group 2 and switch tab to compression
  if (groupHeaders.length >= 2) {
    await groupHeaders[1].click();
    await page.waitForTimeout(300);
  }
  const compBtn = await page.$('button.sub-item-btn:has-text("Kompresi")');
  if (compBtn) {
    await compBtn.click();
    await page.waitForTimeout(500);
  }

  // Toggle Dark Theme
  console.log('[Test] Switching to dark theme...');
  const themeBtn = await page.$('#theme');
  if (themeBtn) {
    await themeBtn.click();
    await page.waitForTimeout(500);
  }

  // Capture screenshot of /configuration in Dark mode
  const configDarkPath = path.join(ARTIFACT_DIR, 'quantis_configuration_accordion_dark.png');
  await page.screenshot({ path: configDarkPath, fullPage: false });
  console.log('[Test] Saved screenshot:', configDarkPath);

  // 3. Test /timeline page
  console.log('[Test] Navigating to /timeline...');
  await page.goto('http://localhost:5173/timeline', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  // Check no horizontal scroll on /timeline
  const noHScrollTimeline = await page.evaluate(() => {
    return document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1;
  });
  console.log('[Test] /timeline zero horizontal scroll:', noHScrollTimeline);

  // Check timeline key components
  const hasPlayer = await page.$('.player-wrapper');
  console.log('[Test] Has player wrapper:', !!hasPlayer);

  const hasActivityBand = await page.$('.band-track');
  console.log('[Test] Has activity band track:', !!hasActivityBand);

  const hasBars = await page.$('.bars');
  console.log('[Test] Has equalizer bars:', !!hasBars);

  // Capture screenshot of /timeline in Dark mode
  const timelineDarkPath = path.join(ARTIFACT_DIR, 'quantis_timeline_redesign_dark.png');
  await page.screenshot({ path: timelineDarkPath, fullPage: false });
  console.log('[Test] Saved screenshot:', timelineDarkPath);

  // Switch back to Light Theme
  const themeBtn2 = await page.$('#theme');
  if (themeBtn2) {
    await themeBtn2.click();
    await page.waitForTimeout(500);
  }

  // Capture screenshot of /timeline in Light mode
  const timelineLightPath = path.join(ARTIFACT_DIR, 'quantis_timeline_redesign_light.png');
  await page.screenshot({ path: timelineLightPath, fullPage: false });
  console.log('[Test] Saved screenshot:', timelineLightPath);

  // 4. Test /hardware page
  console.log('[Test] Navigating to /hardware...');
  await page.goto('http://localhost:5173/hardware', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

  const hwLightPath = path.join(ARTIFACT_DIR, 'quantis_hardware_light.png');
  await page.screenshot({ path: hwLightPath, fullPage: false });
  console.log('[Test] Saved screenshot:', hwLightPath);

  // 5. Test /matrix page
  console.log('[Test] Navigating to /matrix...');
  await page.goto('http://localhost:5173/matrix', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

  const matrixLightPath = path.join(ARTIFACT_DIR, 'quantis_matrix_light.png');
  await page.screenshot({ path: matrixLightPath, fullPage: false });
  console.log('[Test] Saved screenshot:', matrixLightPath);

  await browser.close();
  console.log('[Test] All tests completed successfully!');
}

run().catch((err) => {
  console.error('[Test Error]:', err);
  process.exit(1);
});
