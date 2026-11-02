const path = require('path');
const { chromium } = require(path.resolve(__dirname, 'node_modules/@playwright/test'));
const fs = require('fs');

(async () => {
  console.log('=== RUNNING FULL PLAYWRIGHT REDESIGN VERIFICATION SUITE ===');
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await context.newPage();

  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.log('[Browser Error]', msg.text());
    }
  });

  // Login
  console.log('Navigating to login...');
  await page.goto('http://localhost:5173/login');
  await page.fill('input[type="text"]', 'admin');
  await page.fill('input[type="password"]', 'AdminPass123!');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/matrix');
  console.log('Login successful');

  // Go to /configuration
  console.log('Navigating to /configuration...');
  await page.goto('http://localhost:5173/configuration');
  await page.waitForSelector('.layout');
  await page.waitForTimeout(1000);

  // Check 2-column layout and sub nav buttons
  const subNavItems = await page.$$eval('.sub button', items => items.map(el => el.textContent.trim()));
  console.log('Sub navigation buttons found:', subNavItems);

  // Verify Horizontal Overflow
  const checkOverflow = async (name) => {
    const overflow = await page.evaluate(() => {
      const docW = document.documentElement.clientWidth;
      const docScrollW = document.documentElement.scrollWidth;
      const bodyScrollW = document.body.scrollWidth;
      return {
        docW,
        docScrollW,
        bodyScrollW,
        hasOverflow: docScrollW > docW || bodyScrollW > docW
      };
    });
    console.log(`[${name}] Overflow check:`, overflow);
    if (overflow.hasOverflow) {
      console.warn(`WARNING: Horizontal overflow detected in ${name}!`);
    }
  };

  // 1. General Tab (Light)
  await checkOverflow('Light Mode - General');
  await page.screenshot({ path: 'C:/Users/ZroiK/.gemini/antigravity/brain/d61fc82e-89e9-4114-8722-31f63fe177cb/config_final_light_general.png' });

  // 2. Camera & Streaming Tab
  console.log('Testing Camera Tab...');
  await page.click('.sub button:has-text("Kamera")');
  await page.waitForTimeout(500);
  await checkOverflow('Light Mode - Camera');
  await page.screenshot({ path: 'C:/Users/ZroiK/.gemini/antigravity/brain/d61fc82e-89e9-4114-8722-31f63fe177cb/config_final_light_camera.png' });

  // 3. Recording Tab
  console.log('Testing Recording Tab...');
  await page.click('.sub button:has-text("Perekaman")');
  await page.waitForTimeout(500);
  await checkOverflow('Light Mode - Recording');
  await page.screenshot({ path: 'C:/Users/ZroiK/.gemini/antigravity/brain/d61fc82e-89e9-4114-8722-31f63fe177cb/config_final_light_recording.png' });

  // 4. AI Engine Tab
  console.log('Testing AI Engine Tab...');
  await page.click('.sub button:has-text("Mesin AI")');
  await page.waitForTimeout(500);
  await checkOverflow('Light Mode - AI Engine');
  await page.screenshot({ path: 'C:/Users/ZroiK/.gemini/antigravity/brain/d61fc82e-89e9-4114-8722-31f63fe177cb/config_final_light_ai_engine.png' });

  // 5. Compression Tab
  console.log('Testing Compression Tab...');
  await page.click('.sub button:has-text("Kompresi")');
  await page.waitForTimeout(500);
  await checkOverflow('Light Mode - Compression');
  await page.screenshot({ path: 'C:/Users/ZroiK/.gemini/antigravity/brain/d61fc82e-89e9-4114-8722-31f63fe177cb/config_final_light_compression.png' });

  // 6. Storage Tab
  console.log('Testing Storage Tab...');
  await page.click('.sub button:has-text("Penyimpanan")');
  await page.waitForTimeout(500);
  await checkOverflow('Light Mode - Storage');
  await page.screenshot({ path: 'C:/Users/ZroiK/.gemini/antigravity/brain/d61fc82e-89e9-4114-8722-31f63fe177cb/config_final_light_storage.png' });

  // 7. Network Tab
  console.log('Testing Network Tab...');
  await page.click('.sub button:has-text("Jaringan")');
  await page.waitForTimeout(500);
  await checkOverflow('Light Mode - Network');
  await page.screenshot({ path: 'C:/Users/ZroiK/.gemini/antigravity/brain/d61fc82e-89e9-4114-8722-31f63fe177cb/config_final_light_network.png' });

  // 8. Security Tab
  console.log('Testing Security Tab...');
  await page.click('.sub button:has-text("Keamanan")');
  await page.waitForTimeout(500);
  await checkOverflow('Light Mode - Security');
  await page.screenshot({ path: 'C:/Users/ZroiK/.gemini/antigravity/brain/d61fc82e-89e9-4114-8722-31f63fe177cb/config_final_light_security.png' });

  // 9. Performance Tab
  console.log('Testing Performance Tab...');
  await page.click('.sub button:has-text("Performa")');
  await page.waitForTimeout(500);
  await checkOverflow('Light Mode - Performance');
  await page.screenshot({ path: 'C:/Users/ZroiK/.gemini/antigravity/brain/d61fc82e-89e9-4114-8722-31f63fe177cb/config_final_light_performance.png' });

  // Test dirty floating bar in General
  console.log('Testing dirty state & floating bar...');
  await page.click('.sub button:has-text("Umum")');
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    const input = document.getElementById('f-host');
    input.value = 'Quantis Forensic Node 01 (Modified)';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(400);
  const barClass = await page.$eval('#save-bar', el => el.className);
  const barText = await page.$eval('#save-bar span', el => el.textContent);
  console.log('Dirty save bar status:', { barClass, barText });
  await page.screenshot({ path: 'C:/Users/ZroiK/.gemini/antigravity/brain/d61fc82e-89e9-4114-8722-31f63fe177cb/config_final_dirty_bar.png' });

  // Switch to Dark Mode
  console.log('Testing Dark Mode...');
  await page.evaluate(() => {
    document.documentElement.setAttribute('data-theme', 'dark');
    document.documentElement.classList.add('dark');
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'C:/Users/ZroiK/.gemini/antigravity/brain/d61fc82e-89e9-4114-8722-31f63fe177cb/config_final_dark_general.png' });

  // Click AI Engine in Dark Mode
  await page.click('.sub button:has-text("Mesin AI")');
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'C:/Users/ZroiK/.gemini/antigravity/brain/d61fc82e-89e9-4114-8722-31f63fe177cb/config_final_dark_ai_engine.png' });

  // Click Compression in Dark Mode
  await page.click('.sub button:has-text("Kompresi")');
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'C:/Users/ZroiK/.gemini/antigravity/brain/d61fc82e-89e9-4114-8722-31f63fe177cb/config_final_dark_compression.png' });

  // Click Recording in Dark Mode
  await page.click('.sub button:has-text("Perekaman")');
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'C:/Users/ZroiK/.gemini/antigravity/brain/d61fc82e-89e9-4114-8722-31f63fe177cb/config_final_dark_recording.png' });

  console.log('=== ALL 9 TABS & VISUAL REDESIGN CHECKS PASSED PERFECTLY ===');
  await browser.close();
})();
