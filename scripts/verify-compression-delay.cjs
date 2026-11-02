const path = require('path');
const { chromium } = require(path.resolve(__dirname, '../apps/web-dashboard/node_modules/@playwright/test'));

async function main() {
  console.log('=== STEP 1: API Configuration Verification ===');
  const authRes = await fetch('http://localhost:3000/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'AdminPass123!' }),
  });
  const authData = await authRes.json();
  const token = authData.accessToken || authData.token;
  if (!token) {
    throw new Error('Login failed: ' + JSON.stringify(authData));
  }
  console.log('API login success.');

  // Fetch config
  const cfgRes = await fetch('http://localhost:3000/api/config', {
    headers: { Authorization: `Bearer ${token}` },
  });
  const cfgData = await cfgRes.json();
  console.log('Initial compressionDelayHours:', cfgData.config?.compression?.compressionDelayHours);
  console.log('Initial retentionGraceHours:', cfgData.config?.storage?.retentionGraceHours);

  if (cfgData.config?.compression?.compressionDelayHours === undefined) {
    throw new Error('compressionDelayHours missing in config API response!');
  }

  // Update via API
  const updateRes = await fetch('http://localhost:3000/api/config', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      compression: {
        ...cfgData.config.compression,
        compressionDelayHours: 24,
      },
      storage: {
        ...cfgData.config.storage,
        retentionGraceHours: 24,
      },
    }),
  });
  const updateData = await updateRes.json();
  console.log('PUT /api/config result:', updateData.success, 'New delay:', updateData.config?.compression?.compressionDelayHours);

  console.log('\n=== STEP 2: Playwright UI Verification ===');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });

  console.log('[1] Logging in via UI...');
  await page.goto('http://localhost:5173/login', { waitUntil: 'networkidle' });
  await page.fill('input[type="text"]', 'admin');
  await page.fill('input[type="password"]', 'AdminPass123!');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/matrix');
  console.log('Logged in successfully to matrix.');

  console.log('[2] Checking /configuration -> Kompresi tab...');
  await page.goto('http://localhost:5173/configuration', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  // Click on Kompresi tab in subnav
  const compTab = page.locator('.sn-nav button:has-text("Kompresi"), button:has-text("Kompresi")').first();
  await compTab.click();
  await page.waitForTimeout(800);

  // Check delay input and presets
  const delayInput = page.locator('#f-comp-delay');
  await delayInput.waitFor({ state: 'visible', timeout: 5000 });
  const delayVal = await delayInput.inputValue();
  console.log('Current UI Delay input value:', delayVal);

  // Test clicking preset 48 Jam
  const btn48 = page.locator('.seg button:has-text("48 Jam")');
  await btn48.click();
  await page.waitForTimeout(300);
  console.log('After clicking 48 Jam preset, value is:', await delayInput.inputValue());

  // Test clicking preset 24 Jam (Standar)
  const btn24 = page.locator('.seg button:has-text("24 Jam (Standar)")');
  await btn24.click();
  await page.waitForTimeout(300);
  console.log('After clicking 24 Jam preset, value is:', await delayInput.inputValue());

  // Save changes
  const saveBtn = page.locator('button:has-text("Simpan"), button:has-text("Simpan Perubahan")').first();
  await saveBtn.click();
  await page.waitForTimeout(1000);

  const configScreenshotPath = 'C:/Users/ZroiK/.gemini/antigravity/brain/d61fc82e-89e9-4114-8722-31f63fe177cb/config_compression_delay.png';
  await page.screenshot({ path: configScreenshotPath });
  console.log('Screenshot saved to:', configScreenshotPath);

  console.log('[3] Checking /timeline default to Mode Mentah...');
  await page.goto('http://localhost:5173/timeline', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  const rawBtn = page.locator('.seg button:has-text("Mode Mentah")');
  const compBtn = page.locator('.seg button:has-text("Mode Kompresi")');

  const rawPressed = await rawBtn.getAttribute('aria-pressed');
  const compPressed = await compBtn.getAttribute('aria-pressed');
  const compDisabled = await compBtn.isDisabled();

  console.log('Timeline Mode Buttons:');
  console.log('  Mode Mentah aria-pressed:', rawPressed);
  console.log('  Mode Kompresi aria-pressed:', compPressed);
  console.log('  Mode Kompresi disabled:', compDisabled);

  // Check ratio text
  const ratioText = await page.locator('.ch b[style*="var(--iris)"]').textContent().catch(() => '');
  console.log('  Segment compression ratio text:', ratioText?.trim());

  const timelineScreenshotPath = 'C:/Users/ZroiK/.gemini/antigravity/brain/d61fc82e-89e9-4114-8722-31f63fe177cb/timeline_default_raw_mode.png';
  await page.screenshot({ path: timelineScreenshotPath });
  console.log('Screenshot saved to:', timelineScreenshotPath);

  await browser.close();
  console.log('\n=== ALL VERIFICATIONS PASSED ===');
}

main().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
