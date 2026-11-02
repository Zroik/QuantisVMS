import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { chromium } = require('../apps/web-dashboard/node_modules/@playwright/test');

async function run() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  await page.goto('http://localhost:5173/login');
  await page.fill('input[type="text"]', 'admin');
  await page.fill('input[type="password"]', 'admin123');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/matrix');
  await page.goto('http://localhost:5173/hardware');
  await page.waitForTimeout(2200);

  const mainEl = await page.$('.main-content');
  if (mainEl) {
    await mainEl.screenshot({ path: 'C:/Users/ZroiK/.gemini/antigravity/brain/cfa612f5-8420-4d78-a48e-88633f206655/hardware_full_scroll.png' });
    console.log('Saved hardware_full_scroll.png');
  }

  // Scroll to bottom and capture
  await page.evaluate(() => {
    const el = document.querySelector('.main-content');
    if (el) el.scrollTop = 700;
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'C:/Users/ZroiK/.gemini/antigravity/brain/cfa612f5-8420-4d78-a48e-88633f206655/hardware_scrolled_bottom.png' });
  console.log('Saved hardware_scrolled_bottom.png');

  // Also test chart tab switches
  await page.click('button:has-text("VRAM")');
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'C:/Users/ZroiK/.gemini/antigravity/brain/cfa612f5-8420-4d78-a48e-88633f206655/hardware_chart_vram.png' });

  await page.click('button:has-text("Bandwidth")');
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'C:/Users/ZroiK/.gemini/antigravity/brain/cfa612f5-8420-4d78-a48e-88633f206655/hardware_chart_bw.png' });

  // Also toggle dark mode and capture
  await page.evaluate(() => {
    document.documentElement.classList.add('dark');
    document.documentElement.setAttribute('data-theme', 'dark');
    const el = document.querySelector('.main-content');
    if (el) el.scrollTop = 0;
  });
  await page.waitForTimeout(500);

  if (mainEl) {
    await mainEl.screenshot({ path: 'C:/Users/ZroiK/.gemini/antigravity/brain/cfa612f5-8420-4d78-a48e-88633f206655/hardware_dark_full.png' });
    console.log('Saved hardware_dark_full.png');
  }

  await browser.close();
}

run().catch(console.error);
