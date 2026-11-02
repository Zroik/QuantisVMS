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

  const result = await page.evaluate(async () => {
    const btn = document.getElementById('theme');
    const rect = btn ? btn.getBoundingClientRect() : { left: 100, top: 100, width: 40, height: 40 };
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const endRadius = Math.hypot(
      Math.max(x, window.innerWidth - x),
      Math.max(y, window.innerHeight - y)
    );

    let transitionFinished = false;
    let animFinished = false;

    const transition = document.startViewTransition(() => {
      document.documentElement.classList.toggle('dark');
      document.documentElement.dataset.theme = document.documentElement.classList.contains('dark') ? 'dark' : 'light';
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
        duration: 400,
        easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
        pseudoElement: '::view-transition-new(root)',
      }
    );

    anim.onfinish = () => { animFinished = true; };
    await anim.finished;
    await transition.finished;
    transitionFinished = true;

    return {
      success: true,
      x,
      y,
      endRadius,
      animFinished,
      transitionFinished,
      isDark: document.documentElement.classList.contains('dark')
    };
  });

  console.log('Transition Result:', result);
  await browser.close();
}

main().catch(console.error);

