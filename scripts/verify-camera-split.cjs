const path = require('path');
const { chromium } = require(path.resolve(__dirname, '../apps/web-dashboard/node_modules/@playwright/test'));

const ARTIFACT_DIR = 'C:/Users/ZroiK/.gemini/antigravity/brain/d61fc82e-89e9-4114-8722-31f63fe177cb';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();

  console.log('Navigating to login...');
  await page.goto('http://localhost:5173/login', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('input[type="text"], input[name="username"]', { timeout: 5000 });
  await page.fill('input[type="text"], input[name="username"]', 'admin');
  await page.fill('input[type="password"]', 'AdminPass123!');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(1000);

  // 1. Live Matrix View
  console.log('Checking /matrix...');
  await page.goto('http://localhost:5173/matrix', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  const tiles = await page.$$('.cam-tile');
  console.log(`Found ${tiles.length} camera tiles on /matrix.`);
  const camNames = await page.$$eval('.cam-name', els => els.map(e => e.textContent.trim()));
  console.log('Camera names on /matrix:', camNames);

  await page.screenshot({ path: path.join(ARTIFACT_DIR, 'matrix_3_cameras_split.png'), fullPage: true });
  console.log('Saved matrix screenshot.');

  // 2. Configuration View with ?tab=camera
  console.log('Checking /configuration?tab=camera...');
  await page.goto('http://localhost:5173/configuration?tab=camera', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  const tableRows = await page.$$eval('tbody tr', rows => rows.map(r => r.innerText.replace(/\n+/g, ' | ')));
  console.log('Configuration camera table rows:', tableRows);

  await page.screenshot({ path: path.join(ARTIFACT_DIR, 'config_camera_table_split.png') });
  console.log('Saved config table screenshot.');

  // Click "Ubah" on camera 2 (the split camera)
  const editBtns = await page.$$('button:has-text("Ubah")');
  console.log(`Found ${editBtns.length} 'Ubah' buttons.`);
  if (editBtns.length >= 2) {
    await editBtns[1].click();
    await page.waitForTimeout(600);
    console.log('Opened Edit Camera modal for Camera 2.');

    // Check the split dropdown value
    const splitVal = await page.$eval('#m-split', el => el.value);
    console.log('Split dropdown value in modal:', splitVal);

    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'config_camera_split_modal.png') });
    console.log('Saved config modal screenshot.');

    // Close modal
    const cancelBtn = await page.$('button:has-text("Batal")');
    if (cancelBtn) await cancelBtn.click();
    await page.waitForTimeout(400);
  }

  // 3. Hardware Monitor View
  console.log('Checking /hardware...');
  await page.goto('http://localhost:5173/hardware', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  const hwCamRows = await page.$$eval('tbody tr', rows => rows.map(r => r.innerText.replace(/\n+/g, ' | ')));
  console.log('Hardware monitor camera rows:', hwCamRows);

  await page.screenshot({ path: path.join(ARTIFACT_DIR, 'hardware_3_cameras.png'), fullPage: true });
  console.log('Saved hardware screenshot.');

  // 4. Timeline View
  console.log('Checking /timeline...');
  await page.goto('http://localhost:5173/timeline', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  const camOptions = await page.$$eval('select.sel option', opts => opts.map(o => o.textContent.trim()));
  console.log('Timeline camera options:', camOptions);

  await page.screenshot({ path: path.join(ARTIFACT_DIR, 'timeline_3_cameras.png'), fullPage: true });
  console.log('Saved timeline screenshot.');

  await browser.close();
  console.log('All verifications completed successfully!');
}

main().catch(err => {
  console.error('Error during verification:', err);
  process.exit(1);
});
