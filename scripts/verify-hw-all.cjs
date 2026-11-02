const path = require('path');
const { chromium } = require(path.resolve(__dirname, '../apps/web-dashboard/node_modules/@playwright/test'));

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });

  console.log('[1] Logging in...');
  await page.goto('http://localhost:5173/login', { waitUntil: 'networkidle' });
  await page.fill('input[type="text"]', 'admin');
  await page.fill('input[type="password"]', 'admin123');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/matrix');

  console.log('[2] Navigating to /hardware...');
  await page.goto('http://localhost:5173/hardware', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2200); // Wait for live telemetry update

  // 1. Measure card numbers height & val-box height
  const cardMeasurements = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('.g.k article.st'));
    return cards.map((c, i) => {
      const title = c.querySelector('.lab')?.textContent?.trim();
      const valBox = c.querySelector('.val-box');
      const big = c.querySelector('.big');
      return {
        cardIndex: i,
        title,
        valBoxHeight: valBox ? valBox.getBoundingClientRect().height : null,
        bigHeight: big ? big.getBoundingClientRect().height : null,
        bigComputedHeight: big ? window.getComputedStyle(big).height : null,
      };
    });
  });

  console.log('\n--- CARD HEIGHT MEASUREMENTS ---');
  console.log(JSON.stringify(cardMeasurements, null, 2));

  // 2. Check RAM card text & absence of WSL2 caption
  const ramCardInfo = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('.col article.card'));
    const ramCard = cards[1];
    return {
      title: ramCard?.querySelector('.lab')?.textContent?.trim(),
      ramRatio: ramCard?.querySelector('.ch span:last-child')?.textContent?.trim(),
      bigVal: ramCard?.querySelector('.big')?.textContent?.trim(),
      hasWslText: document.body.innerText.includes('Batas alokasi WSL2 MicroVM') ||
                  document.body.innerText.includes('WSL2'),
    };
  });

  console.log('\n--- RAM CARD INFO ---');
  console.log(JSON.stringify(ramCardInfo, null, 2));

  // 3. Check NVENC / NVDEC Sensor text
  const encDecInfo = await page.evaluate(() => {
    const encCard = document.querySelectorAll('.g.k article.st')[3];
    return {
      text: encCard?.innerText?.replace(/\s+/g, ' '),
    };
  });

  console.log('\n--- ENCODER / DECODER CARD ---');
  console.log(JSON.stringify(encDecInfo, null, 2));

  // 4. Check Bandwidth Card .cam and #bars
  const bwCardInfo = await page.evaluate(() => {
    const camRows = Array.from(document.querySelectorAll('#bwc .cam > span')).map((sp, idx) => {
      const parent = sp.parentElement;
      const bEl = parent.querySelectorAll('div b')[idx];
      const mbpsEl = parent.querySelectorAll('b:not(div b)')[idx];
      return {
        name: sp.textContent?.trim(),
        barWidth: bEl ? bEl.style.width : null,
        mbps: mbpsEl ? mbpsEl.textContent?.trim() : null,
      };
    });
    const barsCount = document.querySelectorAll('#bars i').length;
    const barHeights = Array.from(document.querySelectorAll('#bars i')).slice(0, 5).map(i => i.style.height);
    return { camRows, barsCount, sampleHeights: barHeights };
  });

  console.log('\n--- BANDWIDTH CARD INFO ---');
  console.log(JSON.stringify(bwCardInfo, null, 2));

  // 5. Check Trend Chart Scale Lines & Units
  const trendInfo = await page.evaluate(() => {
    const textElements = Array.from(document.querySelectorAll('#ch svg text')).map(t => ({
      y: t.getAttribute('y'),
      text: t.textContent?.trim(),
    }));
    const lineElements = Array.from(document.querySelectorAll('#ch svg line')).map(l => ({
      y1: l.getAttribute('y1'),
      x1: l.getAttribute('x1'),
      x2: l.getAttribute('x2'),
    }));
    const pathD = document.querySelector('#ch svg path[stroke="currentColor"]')?.getAttribute('d');
    return {
      scaleLabelsCount: textElements.length,
      scaleLabels: textElements,
      gridLinesCount: lineElements.length,
      sampleCurveD: pathD?.slice(0, 80),
    };
  });

  console.log('\n--- TREND CHART INFO ---');
  console.log(JSON.stringify(trendInfo, null, 2));

  // 6. Test Switching Tabs to VRAM, Bandwidth, and CPU
  const tabsTest = [];
  for (const tab of ['cpu', 'vram', 'bw', 'gpu']) {
    await page.click(`div.seg button:has-text("${tab === 'cpu' ? 'CPU' : tab === 'vram' ? 'VRAM' : tab === 'bw' ? 'Bandwidth' : 'GPU'}")`);
    await page.waitForTimeout(300);
    const tabData = await page.evaluate((tName) => {
      const labels = Array.from(document.querySelectorAll('#ch svg text')).map(t => t.textContent?.trim());
      const big = document.querySelector('#cv')?.textContent?.trim();
      return { tab: tName, big, labels };
    }, tab);
    tabsTest.push(tabData);
  }

  console.log('\n--- TABS SWITCHING TEST ---');
  console.log(JSON.stringify(tabsTest, null, 2));

  // Capture Screenshots
  await page.screenshot({ path: 'C:/Users/ZroiK/.gemini/antigravity/brain/cfa612f5-8420-4d78-a48e-88633f206655/hardware_verified_id.png', fullPage: true });

  // Toggle Language to EN
  console.log('\n[3] Toggling language to English...');
  const langBtn = await page.$('button:has-text("ID"), button:has-text("EN")');
  if (langBtn) {
    await langBtn.click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'C:/Users/ZroiK/.gemini/antigravity/brain/cfa612f5-8420-4d78-a48e-88633f206655/hardware_verified_en.png', fullPage: true });
    console.log('Saved hardware_verified_en.png');
  }

  await browser.close();
  console.log('\nVerification complete!');
}

main().catch(console.error);
