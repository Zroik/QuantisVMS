const { chromium } = require('d:/anothervms/apps/web-dashboard/node_modules/@playwright/test');

async function testBar() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });

  await page.goto('http://localhost:5173/login');
  await page.fill('input[type="text"]', 'admin');
  await page.fill('input[type="password"]', 'admin123');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/matrix');

  await page.goto('http://localhost:5173/configuration?tab=node');
  await page.waitForTimeout(1000);

  // Check initial state of .sv
  const initial = await page.evaluate(() => {
    const sv = document.querySelector('.sv');
    return {
      classes: sv?.className,
      opacity: window.getComputedStyle(sv).opacity,
      pointerEvents: window.getComputedStyle(sv).pointerEvents,
      text: sv?.querySelector('#svn')?.textContent,
    };
  });
  console.log('1. Initial .sv state:', initial);

  // Edit instance name input
  const input = page.locator('input[placeholder="Quantis Forensic Node 01"]');
  const originalVal = await input.inputValue();
  console.log('Original input value:', originalVal);

  await input.fill(originalVal + ' - Edited');
  await page.waitForTimeout(300);

  const afterEdit = await page.evaluate(() => {
    const sv = document.querySelector('.sv');
    return {
      classes: sv?.className,
      opacity: window.getComputedStyle(sv).opacity,
      text: sv?.querySelector('#svn')?.textContent,
      hasDotOnNodeTab: !!document.querySelector('.si[aria-current="page"] i'),
    };
  });
  console.log('2. After edit 1 tab state:', afterEdit);

  // Switch to tab 'enc' and edit workers
  const encBtn = page.locator('.si').filter({ hasText: 'Kompresi' });
  await encBtn.click();
  await page.waitForTimeout(300);

  // Click worker 2
  const worker2Btn = page.getByRole('button', { name: '2', exact: true });
  if (await worker2Btn.count() > 0) {
    await worker2Btn.click();
    await page.waitForTimeout(300);
  }

  const afterEdit2 = await page.evaluate(() => {
    const sv = document.querySelector('.sv');
    return {
      text: sv?.querySelector('#svn')?.textContent,
      dirtyTabs: Array.from(document.querySelectorAll('.si i')).map(i => i.parentElement.textContent.trim()),
    };
  });
  console.log('3. After editing 2nd tab state:', afterEdit2);

  // Click 'Batalkan'
  console.log('Clicking Batalkan...');
  await page.click('.sv .b1');
  await page.waitForTimeout(500);

  const afterRevert = await page.evaluate(() => {
    const sv = document.querySelector('.sv');
    const toast = document.querySelector('.toast');
    return {
      classes: sv?.className,
      opacity: window.getComputedStyle(sv).opacity,
      toastText: toast?.textContent?.trim(),
      toastActive: toast?.classList.contains('on'),
    };
  });
  console.log('4. After revert state:', afterRevert);

  // Go back to 'node' tab to check if input value reverted
  const nodeBtn = page.locator('.si').filter({ hasText: 'Node' });
  await nodeBtn.click();
  await page.waitForTimeout(300);
  const revertedVal = await input.inputValue();
  console.log('Reverted input value:', revertedVal, 'Matched original:', revertedVal === originalVal);

  // Now test 'Simpan' flow
  console.log('\n--- Testing Simpan Flow ---');
  await input.fill(originalVal + ' - SavedTest');
  await page.waitForTimeout(300);
  console.log('Filled new value, bar text:', await page.locator('.sv #svn').textContent());

  // Listen for network PUT /api/config
  const putPromise = page.waitForRequest(req => req.url().includes('/api/config') && req.method() === 'PUT');
  await page.click('.sv .b2');
  const putReq = await putPromise;
  console.log('PUT request sent with payload keys:', Object.keys(JSON.parse(putReq.postData())));

  await page.waitForTimeout(1000);

  const afterSave = await page.evaluate(() => {
    const sv = document.querySelector('.sv');
    const toast = document.querySelector('.toast');
    return {
      classes: sv?.className,
      opacity: window.getComputedStyle(sv).opacity,
      toastText: toast?.textContent?.trim(),
      toastActive: toast?.classList.contains('on'),
    };
  });
  console.log('5. After save state:', afterSave);

  // Revert back to original value so we leave DB clean
  await input.fill(originalVal);
  await page.click('.sv .b2');
  await page.waitForTimeout(1000);
  console.log('Restored original value cleanly.');

  await browser.close();
}

testBar().catch(console.error);
