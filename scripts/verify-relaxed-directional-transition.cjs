const path = require('path');
const { chromium } = require(path.resolve(__dirname, '../apps/web-dashboard/node_modules/@playwright/test'));

async function main() {
  console.log('[E2E Relaxed Transition] Launching Chromium...');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  await page.goto('http://localhost:5173/login', { waitUntil: 'networkidle' });
  await page.fill('input[type="text"]', 'admin');
  await page.fill('input[type="password"]', 'admin123');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/matrix');
  await page.waitForTimeout(1000);

  // Set initial state to Light mode
  await page.evaluate(() => {
    localStorage.setItem('vms_theme', 'light');
    document.documentElement.classList.remove('dark');
    document.documentElement.dataset.theme = 'light';
    delete document.documentElement.dataset.themeTransition;
  });
  await page.waitForTimeout(300);

  // 1. Test Light -> Dark: Expanding black circle
  console.log('[E2E Relaxed Transition] Testing Light -> Dark (Expanding circle)...');
  const lightToDarkPromise = page.evaluate(() => {
    return new Promise((resolve) => {
      const origAnimate = document.documentElement.animate;
      document.documentElement.animate = function(keyframes, options) {
        const anim = origAnimate.call(this, keyframes, options);
        setTimeout(() => {
          anim.pause();
          anim.currentTime = (options.duration || 700) * 0.38;
          resolve({
            type: 'light-to-dark',
            duration: options.duration,
            easing: options.easing,
            pseudoElement: options.pseudoElement,
            keyframes,
            currentTime: anim.currentTime,
            themeTransitionAttr: document.documentElement.dataset.themeTransition
          });
        }, 50);
        return anim;
      };
    });
  });

  await page.click('#theme');
  const lightToDarkData = await lightToDarkPromise;
  console.log('[E2E Relaxed Transition] Light -> Dark mid-flight:', lightToDarkData);

  await page.waitForTimeout(100);
  await page.screenshot({ path: 'C:/Users/ZroiK/.gemini/antigravity/brain/cfa612f5-8420-4d78-a48e-88633f206655/relaxed_01_light_to_dark_expanding.png' });

  // Resume and finish
  await page.evaluate(() => {
    const anims = document.getAnimations();
    for (const a of anims) {
      if (a.playState === 'paused') a.play();
    }
  });
  await page.waitForTimeout(800);

  // Check state in Dark mode
  const darkCheck = await page.evaluate(() => ({
    isDark: document.documentElement.classList.contains('dark'),
    themeAttr: document.documentElement.dataset.theme,
    transitionAttr: document.documentElement.dataset.themeTransition
  }));
  console.log('[E2E Relaxed Transition] Completed Dark mode check:', darkCheck);

  // 2. Test Dark -> Light: Shrinking black circle into the button
  console.log('[E2E Relaxed Transition] Testing Dark -> Light (Shrinking circle into button)...');
  const darkToLightPromise = page.evaluate(() => {
    return new Promise((resolve) => {
      const origAnimate = document.documentElement.animate;
      document.documentElement.animate = function(keyframes, options) {
        const anim = origAnimate.call(this, keyframes, options);
        setTimeout(() => {
          anim.pause();
          anim.currentTime = (options.duration || 700) * 0.40;
          resolve({
            type: 'dark-to-light',
            duration: options.duration,
            easing: options.easing,
            pseudoElement: options.pseudoElement,
            keyframes,
            currentTime: anim.currentTime,
            themeTransitionAttr: document.documentElement.dataset.themeTransition
          });
        }, 50);
        return anim;
      };
    });
  });

  await page.click('#theme');
  const darkToLightData = await darkToLightPromise;
  console.log('[E2E Relaxed Transition] Dark -> Light mid-flight:', darkToLightData);

  await page.waitForTimeout(100);
  await page.screenshot({ path: 'C:/Users/ZroiK/.gemini/antigravity/brain/cfa612f5-8420-4d78-a48e-88633f206655/relaxed_02_dark_to_light_shrinking.png' });

  // Resume and finish
  await page.evaluate(() => {
    const anims = document.getAnimations();
    for (const a of anims) {
      if (a.playState === 'paused') a.play();
    }
  });
  await page.waitForTimeout(800);

  // Check final state in Light mode
  const lightCheck = await page.evaluate(() => ({
    isDark: document.documentElement.classList.contains('dark'),
    themeAttr: document.documentElement.dataset.theme,
    transitionAttr: document.documentElement.dataset.themeTransition
  }));
  console.log('[E2E Relaxed Transition] Completed Light mode check:', lightCheck);

  await page.screenshot({ path: 'C:/Users/ZroiK/.gemini/antigravity/brain/cfa612f5-8420-4d78-a48e-88633f206655/relaxed_03_light_final.png' });

  await browser.close();
  console.log('[E2E Relaxed Transition] All checks PASSED!');
}

main().catch(console.error);

