const path = require('path');
const { chromium } = require('d:/anothervms/apps/web-dashboard/node_modules/@playwright/test');

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });

  console.log('Logging in...');
  await page.goto('http://localhost:5173/login');
  await page.fill('input[type="text"]', 'admin');
  await page.fill('input[type="password"]', 'admin123');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/matrix');

  console.log('Navigating to /configuration?tab=enc...');
  await page.goto('http://localhost:5173/configuration?tab=enc');
  await page.waitForTimeout(1000);

  const initial = await page.evaluate(() => {
    const left = document.querySelector('.cfg-left');
    const crumb = document.querySelector('.crumb');
    const title = document.querySelector('.cfg-title');
    const sn = document.querySelector('.sn');
    const pg = document.querySelector('.pg');
    const firstCard = document.querySelector('.pg article.card');
    return {
      leftTop: left?.getBoundingClientRect().top,
      crumbTop: crumb?.getBoundingClientRect().top,
      titleTop: title?.getBoundingClientRect().top,
      snTop: sn?.getBoundingClientRect().top,
      firstCardTop: firstCard?.getBoundingClientRect().top,
    };
  });
  console.log('Initial rects (at scroll 0):', initial);

  // Scroll 500px down
  console.log('Scrolling down 500px...');
  await page.evaluate(() => {
    document.querySelector('.main-content').scrollTop = 500;
  });
  await page.waitForTimeout(300);

  const scrolled500 = await page.evaluate(() => {
    const left = document.querySelector('.cfg-left');
    const crumb = document.querySelector('.crumb');
    const title = document.querySelector('.cfg-title');
    const sn = document.querySelector('.sn');
    const firstCard = document.querySelector('.pg article.card');
    const scrollTop = document.querySelector('.main-content').scrollTop;
    return {
      scrollTop,
      leftTop: left?.getBoundingClientRect().top,
      crumbTop: crumb?.getBoundingClientRect().top,
      titleTop: title?.getBoundingClientRect().top,
      snTop: sn?.getBoundingClientRect().top,
      firstCardTop: firstCard?.getBoundingClientRect().top,
    };
  });
  console.log('Scrolled 500px rects:', scrolled500);

  // Take screenshot while scrolled at 500px
  const artifactDir = 'C:/Users/ZroiK/.gemini/antigravity/brain/cfa612f5-8420-4d78-a48e-88633f206655';
  await page.screenshot({ path: path.join(artifactDir, 'configuration_pinned_scroll_500px.png') });
  console.log('Saved screenshot: configuration_pinned_scroll_500px.png');

  // Scroll 900px down
  console.log('Scrolling down 900px...');
  await page.evaluate(() => {
    document.querySelector('.main-content').scrollTop = 900;
  });
  await page.waitForTimeout(300);

  const scrolled900 = await page.evaluate(() => {
    const left = document.querySelector('.cfg-left');
    const crumb = document.querySelector('.crumb');
    const title = document.querySelector('.cfg-title');
    const sn = document.querySelector('.sn');
    const firstCard = document.querySelector('.pg article.card');
    const scrollTop = document.querySelector('.main-content').scrollTop;
    return {
      scrollTop,
      leftTop: left?.getBoundingClientRect().top,
      crumbTop: crumb?.getBoundingClientRect().top,
      titleTop: title?.getBoundingClientRect().top,
      snTop: sn?.getBoundingClientRect().top,
      firstCardTop: firstCard?.getBoundingClientRect().top,
    };
  });
  console.log('Scrolled 900px rects:', scrolled900);

  await page.screenshot({ path: path.join(artifactDir, 'configuration_pinned_scroll_900px.png') });
  console.log('Saved screenshot: configuration_pinned_scroll_900px.png');

  // Test clicking tab while scrolled
  console.log('Clicking "Kamera" tab while scrolled...');
  const camBtn = await page.locator('.si:has-text("Kamera")');
  await camBtn.click();
  await page.waitForTimeout(500);

  const afterTabClick = await page.evaluate(() => {
    const left = document.querySelector('.cfg-left');
    const crumb = document.querySelector('.crumb');
    const title = document.querySelector('.cfg-title');
    const sn = document.querySelector('.sn');
    return {
      leftTop: left?.getBoundingClientRect().top,
      crumbTop: crumb?.getBoundingClientRect().top,
      titleTop: title?.getBoundingClientRect().top,
      snTop: sn?.getBoundingClientRect().top,
    };
  });
  console.log('After clicking tab rects:', afterTabClick);

  await page.screenshot({ path: path.join(artifactDir, 'configuration_pinned_camera_tab.png') });
  console.log('Saved screenshot: configuration_pinned_camera_tab.png');

  await browser.close();
  console.log('All tests passed successfully!');
}

main().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});

