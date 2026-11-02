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

  const measurements = await page.evaluate(() => {
    const chartCard = document.querySelector('.g.c > article.card');
    const col = document.querySelector('.g.c > .col');
    const cpuCard = document.querySelector('.col > article:nth-child(1)');
    const ramCard = document.querySelector('.col > article:nth-child(2)');
    const gC = document.querySelector('.g.c');

    return {
      chartCardHeight: chartCard?.getBoundingClientRect().height,
      colHeight: col?.getBoundingClientRect().height,
      cpuCardHeight: cpuCard?.getBoundingClientRect().height,
      ramCardHeight: ramCard?.getBoundingClientRect().height,
      gCHeight: gC?.getBoundingClientRect().height,
      cpuCardComputed: window.getComputedStyle(cpuCard).height,
      ramCardComputed: window.getComputedStyle(ramCard).height,
    };
  });

  console.log('MEASUREMENTS:', JSON.stringify(measurements, null, 2));
  await browser.close();
}

main();

