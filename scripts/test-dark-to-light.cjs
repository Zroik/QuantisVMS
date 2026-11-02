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

  // Set to dark mode first
  await page.evaluate(() => {
    document.documentElement.classList.add('dark');
    document.documentElement.dataset.theme = 'dark';
  });
  await page.waitForTimeout(300);

  // Inject CSS rules
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

  // Start transition to light mode and pause mid-way
  await page.evaluate(async () => {
    const btn = document.getElementById('theme');
    const rect = btn.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const endRadius = Math.hypot(
      Math.max(x, window.innerWidth - x),
      Math.max(y, window.innerHeight - y)
    );

    const transition = document.startViewTransition(() => {
      document.documentElement.classList.remove('dark');
      document.documentElement.dataset.theme = 'light';
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
        duration: 2000,
        easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
        pseudoElement: '::view-transition-new(root)',
      }
    );

    anim.currentTime = 500;
    anim.pause();
  });

  await page.screenshot({ path: 'C:/Users/ZroiK/.gemini/antigravity/brain/cfa612f5-8420-4d78-a48e-88633f206655/transition_dark_to_light_30.png' });
  console.log('Saved transition_dark_to_light_30.png');

  await browser.close();
}

main().catch(console.error);

