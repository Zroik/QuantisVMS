const path = require('path');
const fs = require('fs');
const { chromium } = require(path.resolve(__dirname, '../apps/web-dashboard/node_modules/@playwright/test'));

const ARTIFACT_DIR = 'C:/Users/ZroiK/.gemini/antigravity/brain/d61fc82e-89e9-4114-8722-31f63fe177cb';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });

  console.log('[1] Logging in...');
  await page.goto('http://localhost:5173/login', { waitUntil: 'domcontentloaded' });
  await page.fill('input[type="text"]', 'admin');
  await page.fill('input[type="password"]', 'AdminPass123!');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/matrix');

  console.log('[2] Navigating to /hardware...');
  await page.goto('http://localhost:5173/hardware', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500); // Wait for live stats poll

  // Test /api/stats directly in browser context
  const statsDebug = await page.evaluate(async () => {
    const token = localStorage.getItem('vms_access_token');
    const res = await fetch('/api/stats', {
      headers: token ? { Authorization: `Bearer ${token}` } : {}
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch (e) {}
    return {
      status: res.status,
      headers: Object.fromEntries(res.headers.entries()),
      hasToken: !!token,
      textPreview: text.slice(0, 300),
      json,
    };
  });

  console.log('\n--- API /api/stats DEBUG ---');
  console.log('Status:', statsDebug.status);
  console.log('Has Token:', statsDebug.hasToken);
  console.log('Text preview:', statsDebug.textPreview);
  const statsData = statsDebug.json || {};

  console.log('\n--- API /api/stats RESULT ---');
  console.log('API Status:', statsData.status || (statsData.error ? 'ERROR' : 'OK'));
  if (statsData.hardware) {
    console.log('hardware.network:', statsData.hardware.network);
    console.log('Host RAM:', {
      percent: statsData.hardware.ramPercent,
      usedGB: (statsData.hardware.ramUsedBytes / (1024**3)).toFixed(2),
      totalGB: (statsData.hardware.ramTotalBytes / (1024**3)).toFixed(2),
    });
    console.log('WSL2 RAM:', {
      percent: statsData.hardware.wslRamPercent,
      usedGB: (statsData.hardware.wslRamUsedBytes / (1024**3)).toFixed(2),
      totalGB: (statsData.hardware.wslRamTotalBytes / (1024**3)).toFixed(2),
    });
  } else {
    console.log('statsData payload:', statsData);
  }

  // Measure card heights & inspect contents
  const domReport = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('.col article.card'));
    const cpuCard = cards[0];
    const ramCard = cards[1];
    const chartCard = document.querySelector('.c > article.card');

    const cpuRect = cpuCard ? cpuCard.getBoundingClientRect() : null;
    const ramRect = ramCard ? ramCard.getBoundingClientRect() : null;
    const chartRect = chartCard ? chartCard.getBoundingClientRect() : null;

    // Check bandwidth card
    const bwCard = document.querySelector('.g.k article.st:nth-child(4)');
    const bwText = bwCard ? bwCard.innerText : null;

    // Check RAM card sections
    const ramText = ramCard ? ramCard.innerText : null;

    return {
      cpuHeight: cpuRect ? cpuRect.height : null,
      ramHeight: ramRect ? ramRect.height : null,
      chartHeight: chartRect ? chartRect.height : null,
      heightDiff: (cpuRect && ramRect) ? Math.abs(cpuRect.height - ramRect.height) : null,
      combinedHeightWithGap: (cpuRect && ramRect) ? cpuRect.height + 16 + ramRect.height : null,
      bwCardContent: bwText,
      ramCardContent: ramText,
    };
  });

  console.log('\n--- DOM MEASUREMENT & CONTENT ---');
  console.log(JSON.stringify(domReport, null, 2));

  // Screenshot in light mode
  const lightPath = path.join(ARTIFACT_DIR, 'hardware_fix_light.png');
  await page.screenshot({ path: lightPath, fullPage: false });
  console.log('Screenshot saved to:', lightPath);

  // Switch to dark mode if toggle exists or by class
  await page.evaluate(() => {
    document.documentElement.classList.add('dark');
    document.documentElement.setAttribute('data-theme', 'dark');
  });
  await page.waitForTimeout(500);

  const darkPath = path.join(ARTIFACT_DIR, 'hardware_fix_dark.png');
  await page.screenshot({ path: darkPath, fullPage: false });
  console.log('Dark mode screenshot saved to:', darkPath);

  await browser.close();
}

main().catch(err => {
  console.error('Error during test:', err);
  process.exit(1);
});

