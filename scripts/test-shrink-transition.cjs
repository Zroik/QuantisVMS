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

  // Set dark mode first
  await page.evaluate(() => {
    localStorage.setItem('vms_theme', 'dark');
    document.documentElement.classList.add('dark');
    document.documentElement.dataset.theme = 'dark';
  });
  await page.waitForTimeout(300);

  // Add styles for shrinking transition
  await page.addStyleTag({
    content: `
      ::view-transition-old(root),
      ::view-transition-new(root) {
        animation: none;
        mix-blend-mode: normal;
      }
      [data-theme-transition="dark-to-light"]::view-transition-old(root) {
        z-index: 9999;
      }
      [data-theme-transition="dark-to-light"]::view-transition-new(root) {
        z-index: 1;
      }
    `
  });

  // Test dark -> light shrink transition
  const frameInfo = await page.evaluate(async () => {
    const btn = document.getElementById('theme');
    const rect = btn.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const endRadius = Math.hypot(
      Math.max(x, window.innerWidth - x),
      Math.max(y, window.innerHeight - y)
    );

    document.documentElement.dataset.themeTransition = 'dark-to-light';

    const transition = document.startViewTransition(() => {
      document.documentElement.classList.remove('dark');
      document.documentElement.dataset.theme = 'light';
    });

    await transition.ready;

    // Animate OLD (dark) view shrinking down to the button coordinates!
    const anim = document.documentElement.animate(
      {
        clipPath: [
          `circle(${endRadius}px at ${x}px ${y}px)`,
          `circle(0px at ${x}px ${y}px)`,
        ],
      },
      {
        duration: 2000, // slow for pause
        easing: 'cubic-bezier(0.25, 1, 0.5, 1)',
        pseudoElement: '::view-transition-old(root)',
      }
    );

    // Pause at 40% of shrink
    anim.currentTime = 800;
    anim.pause();

    return { x, y, endRadius, currentTime: anim.currentTime };
  });

  console.log('Paused shrink animation at 40%:', frameInfo);
  await page.screenshot({ path: 'C:/Users/ZroiK/.gemini/antigravity/brain/cfa612f5-8420-4d78-a48e-88633f206655/test_shrink_frame_40.png' });

  // Resume and finish
  await page.evaluate(async () => {
    const anims = document.getAnimations();
    for (const a of anims) {
      if (a.playState === 'paused') a.play();
    }
  });
  await page.waitForTimeout(1400);

  await page.screenshot({ path: 'C:/Users/ZroiK/.gemini/antigravity/brain/cfa612f5-8420-4d78-a48e-88633f206655/test_shrink_frame_100.png' });

  await browser.close();
  console.log('Shrink test completed!');
}

main().catch(console.error);

