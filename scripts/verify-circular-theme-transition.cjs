const path = require('path');
const { chromium } = require(path.resolve(__dirname, '../apps/web-dashboard/node_modules/@playwright/test'));

async function main() {
  console.log('[E2E Theme Transition] Launching Chromium browser...');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  // Login
  await page.goto('http://localhost:5173/login', { waitUntil: 'networkidle' });
  await page.fill('input[type="text"]', 'admin');
  await page.fill('input[type="password"]', 'admin123');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/matrix');
  await page.waitForTimeout(1000);

  // Ensure starting in light mode
  await page.evaluate(() => {
    localStorage.setItem('vms_theme', 'light');
    document.documentElement.classList.remove('dark');
    document.documentElement.dataset.theme = 'light';
  });
  await page.waitForTimeout(300);

  console.log('[E2E Theme Transition] Starting in Light mode...');
  await page.screenshot({ path: 'C:/Users/ZroiK/.gemini/antigravity/brain/cfa612f5-8420-4d78-a48e-88633f206655/theme_01_light_initial.png' });

  // 1. Click theme toggle button to transition Light -> Dark
  console.log('[E2E Theme Transition] Clicking theme toggle (Light -> Dark)...');
  
  // Intercept and slow down or catch mid-transition
  const transitionPromise = page.evaluate(() => {
    return new Promise((resolve) => {
      const origAnimate = document.documentElement.animate;
      document.documentElement.animate = function(keyframes, options) {
        const anim = origAnimate.call(this, keyframes, options);
        // Pause briefly at 30% to capture frame
        setTimeout(() => {
          anim.pause();
          anim.currentTime = (options.duration || 500) * 0.35;
          resolve({
            duration: options.duration,
            easing: options.easing,
            keyframes,
            currentTime: anim.currentTime
          });
        }, 50);
        return anim;
      };
    });
  });

  // Real user click on #theme
  await page.click('#theme');
  const midFlightData = await transitionPromise;
  console.log('[E2E Theme Transition] Mid-flight data:', midFlightData);

  // Capture circular reveal mid-flight
  await page.waitForTimeout(100);
  await page.screenshot({ path: 'C:/Users/ZroiK/.gemini/antigravity/brain/cfa612f5-8420-4d78-a48e-88633f206655/theme_02_light_to_dark_reveal.png' });

  // Resume animation and let it complete
  await page.evaluate(() => {
    const anims = document.getAnimations();
    for (const a of anims) {
      if (a.playState === 'paused') a.play();
    }
  });
  await page.waitForTimeout(600);

  // Capture fully Dark mode
  await page.screenshot({ path: 'C:/Users/ZroiK/.gemini/antigravity/brain/cfa612f5-8420-4d78-a48e-88633f206655/theme_03_dark_complete.png' });

  // 2. Click theme toggle button to transition Dark -> Light
  console.log('[E2E Theme Transition] Clicking theme toggle (Dark -> Light)...');
  const reversePromise = page.evaluate(() => {
    return new Promise((resolve) => {
      const origAnimate = document.documentElement.animate;
      document.documentElement.animate = function(keyframes, options) {
        const anim = origAnimate.call(this, keyframes, options);
        setTimeout(() => {
          anim.pause();
          anim.currentTime = (options.duration || 500) * 0.35;
          resolve({
            duration: options.duration,
            easing: options.easing,
            keyframes,
            currentTime: anim.currentTime
          });
        }, 50);
        return anim;
      };
    });
  });

  await page.click('#theme');
  const reverseMidData = await reversePromise;
  console.log('[E2E Theme Transition] Reverse mid-flight data:', reverseMidData);

  await page.waitForTimeout(100);
  await page.screenshot({ path: 'C:/Users/ZroiK/.gemini/antigravity/brain/cfa612f5-8420-4d78-a48e-88633f206655/theme_04_dark_to_light_reveal.png' });

  // Resume animation
  await page.evaluate(() => {
    const anims = document.getAnimations();
    for (const a of anims) {
      if (a.playState === 'paused') a.play();
    }
  });
  await page.waitForTimeout(600);

  // Capture fully Light mode again
  await page.screenshot({ path: 'C:/Users/ZroiK/.gemini/antigravity/brain/cfa612f5-8420-4d78-a48e-88633f206655/theme_05_light_restored.png' });

  const finalCheck = await page.evaluate(() => {
    return {
      themeInStore: localStorage.getItem('vms_theme'),
      isDarkClass: document.documentElement.classList.contains('dark'),
      datasetTheme: document.documentElement.dataset.theme
    };
  });
  console.log('[E2E Theme Transition] Final verification state:', finalCheck);

  await browser.close();
  console.log('[E2E Theme Transition] SUCCESS! All 5 screenshots saved.');
}

main().catch(console.error);

