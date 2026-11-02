import pkg from "../apps/web-dashboard/node_modules/@playwright/test/index.js";
const { chromium } = pkg;

async function testHw() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('request', req => {
    if (req.url().includes('/api/')) console.log('PAGE REQ:', req.method(), req.url());
  });
  page.on('response', async res => {
    if (res.url().includes('/api/')) {
      console.log('PAGE RESP:', res.status(), res.url());
      try {
        const text = await res.text();
        console.log('RESP BODY:', text.slice(0, 200));
      } catch(e) {}
    }
  });

  await page.goto('http://localhost:5173/login');
  await page.fill('input[type="text"]', 'admin');
  await page.fill('input[type="password"]', 'admin123');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/matrix');

  console.log('Navigating to /hardware...');
  await page.goto('http://localhost:5173/hardware');
  await page.waitForTimeout(4000);

  const hwValues = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('.tabular-nums')).map(el => el.textContent.trim());
  });
  console.log('HARDWARE DOM VALUES:', hwValues);

  await browser.close();
}
testHw();
