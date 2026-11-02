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

  // Inject CSS rules to test
  await page.addStyleTag({
    content: `
      ::view-transition-old(root),
      ::view-transition-new(root) {
        animation: none;
        mix-blend-mode: normal;
      }
      ::view-transition-old(root) {
        z-index: 1;
      }
      ::view-transition-new(root) {
        z-index: 9999;
      }
    `
  });

  // Start transition and pause at mid points
  const frames = await page.evaluate(async () => {
    const btn = document.getElementById('theme');
    const rect = btn.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const endRadius = Math.hypot(
      Math.max(x, window.innerWidth - x),
      Math.max(y, window.innerHeight - y)
    );

    const transition = document.startViewTransition(() => {
      document.documentElement.classList.add('dark');
      document.documentElement.dataset.theme = 'dark';
    });

    await transition.ready;

    const anim = document.documentElement.animate(
      {
        clipPath: [
          `circle(0px at ${x}px ${y}px)`,
          `circle(${endRadius}px at ${x}px ${y}px)`,
        ],
      },
      {
        duration: 2000, // slower for capturing frames
        easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
        pseudoElement: '::view-transition-new(root)',
      }
    );

    // Pause at 25% progress
    anim.currentTime = 500;
    anim.pause();
    return { x, y, endRadius, currentTime: anim.currentTime };
  });

  console.log('Frame at 25%:', frames);
  await page.screenshot({ path: 'C:/Users/ZroiK/.gemini/antigravity/brain/cfa612f5-8420-4d78-a48e-88633f206655/transition_frame_25.png' });

  // Advance to 60% progress
  await page.evaluate(() => {
    const anims = document.getAnimations();
    for (const a of anims) {
      a.currentTime = 1200;
      a.pause();
    }
  });
  await page.screenshot({ path: 'C:/Users/ZroiK/.gemini/antigravity/brain/cfa612f5-8420-4d78-a48e-88633f206655/transition_frame_60.png' });

  // Finish transition
  await page.evaluate(() => {
    const anims = document.getAnimations();
    for (const a of anims) {
      a.play();
      a.finish();
    }
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'C:/Users/ZroiK/.gemini/antigravity/brain/cfa612f5-8420-4d78-a48e-88633f206655/transition_frame_100.png' });

  console.log('Screenshots captured!');
  await browser.close();
}

main().catch(console.error);

