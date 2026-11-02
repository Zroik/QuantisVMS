const path = require('path');
const { chromium } = require(path.resolve(__dirname, '../apps/web-dashboard/node_modules/@playwright/test'));

const ARTIFACT_DIR = path.resolve('C:/Users/ZroiK/.gemini/antigravity/brain/d61fc82e-89e9-4114-8722-31f63fe177cb');

async function main() {
  console.log('[Test] Launching Chromium...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 }
  });
  const page = await context.newPage();

  // 1. Login
  console.log('[Test] Logging in...');
  await page.goto('http://localhost:5173/login', { waitUntil: 'networkidle' });
  await page.fill('input[type="text"]', 'admin');
  await page.fill('input[type="password"]', 'AdminPass123!');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/matrix', { timeout: 10000 });

  // 2. Go to /hardware
  console.log('[Test] Navigating to /hardware...');
  await page.goto('http://localhost:5173/hardware', { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);

  // Check initial SVG path and big value
  const getChartState = async () => {
    return await page.evaluate(() => {
      const pathEl = document.querySelector('#ch svg path[stroke="currentColor"]');
      const cvEl = document.querySelector('#cv');
      const circleEl = document.querySelector('#ch svg circle[stroke="var(--raised)"]');
      return {
        pathD: pathEl ? pathEl.getAttribute('d') : null,
        cvHtml: cvEl ? cvEl.innerText : null,
        circleCx: circleEl ? circleEl.getAttribute('cx') : null,
        circleCy: circleEl ? circleEl.getAttribute('cy') : null,
      };
    });
  };

  const state1 = await getChartState();
  console.log('[Test] Sample 1 (t = 0s):', {
    metric: state1.cvHtml,
    circlePoint: `(cx=${state1.circlePoint || state1.circleCx}, cy=${state1.circleCy})`,
    pathDStart: state1.pathD ? state1.pathD.substring(0, 45) + '...' : null,
  });

  const chartCard = await page.$('article:has(#ch)');
  if (chartCard) {
    await chartCard.screenshot({ path: path.join(ARTIFACT_DIR, 'chart_frame_1.png') });
  }

  // Wait 2.2 seconds for next tick
  console.log('[Test] Waiting 2.2s for interval tick...');
  await page.waitForTimeout(2200);

  const state2 = await getChartState();
  console.log('[Test] Sample 2 (t = 2.2s):', {
    metric: state2.cvHtml,
    circlePoint: `(cx=${state2.circleCx}, cy=${state2.circleCy})`,
    pathDStart: state2.pathD ? state2.pathD.substring(0, 45) + '...' : null,
  });

  if (chartCard) {
    await chartCard.screenshot({ path: path.join(ARTIFACT_DIR, 'chart_frame_2.png') });
  }

  // Wait another 2.2 seconds
  console.log('[Test] Waiting another 2.2s...');
  await page.waitForTimeout(2200);

  const state3 = await getChartState();
  console.log('[Test] Sample 3 (t = 4.4s):', {
    metric: state3.cvHtml,
    circlePoint: `(cx=${state3.circleCx}, cy=${state3.circleCy})`,
    pathDStart: state3.pathD ? state3.pathD.substring(0, 45) + '...' : null,
  });

  if (chartCard) {
    await chartCard.screenshot({ path: path.join(ARTIFACT_DIR, 'chart_frame_3.png') });
  }

  const isDChanged1 = state1.pathD !== state2.pathD;
  const isDChanged2 = state2.pathD !== state3.pathD;

  console.log('[Test] Path changed between t=0 and t=2.2s:', isDChanged1);
  console.log('[Test] Path changed between t=2.2s and t=4.4s:', isDChanged2);

  if (isDChanged1 && isDChanged2) {
    console.log('[Test] SUCCESS: Chart path is actively moving in real-time every 2s interval!');
  } else {
    console.error('[Test] FAILED: Chart path did not change across intervals!');
    process.exit(1);
  }

  await browser.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
