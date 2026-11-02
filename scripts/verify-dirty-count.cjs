const path = require('path');
const { chromium } = require('d:/anothervms/apps/web-dashboard/node_modules/@playwright/test');

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });

  console.log('Logging in...');
  await page.goto('http://localhost:5173/login');
  await page.fill('input[type="text"]', 'admin');
  await page.fill('input[type="password"]', 'admin123');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/matrix');

  console.log('Navigating to /configuration?tab=node...');
  await page.goto('http://localhost:5173/configuration?tab=node');
  await page.waitForTimeout(1000);

  const nameInput = page.locator('input[placeholder="Quantis Forensic Node 01"]');
  const locInput = page.locator('input[placeholder="Main Facility - Server Rack A"]');
  const ntpInput = page.locator('input[placeholder="id.pool.ntp.org"]');

  const origName = await nameInput.inputValue();
  const origLoc = await locInput.inputValue();
  const origNtp = await ntpInput.inputValue();

  console.log('Original values:', { origName, origLoc, origNtp });

  // TEST 1: Change 1 field (Nama node)
  console.log('\n--- 1. Change 1 field (Nama node) ---');
  await nameInput.fill(origName + ' Test1');
  await page.waitForTimeout(300);
  let text = (await page.locator('.sv #svn').textContent())?.trim();
  console.log('Current count text:', text);
  if (text !== '1 bagian diubah') throw new Error(`Expected '1 bagian diubah', got '${text}'`);

  // TEST 2: Change 2nd field in the SAME tab (Lokasi pemasangan)
  console.log('\n--- 2. Change 2nd field in same tab (Lokasi pemasangan) ---');
  await locInput.fill(origLoc + ' Floor 2');
  await page.waitForTimeout(300);
  text = (await page.locator('.sv #svn').textContent())?.trim();
  console.log('Current count text:', text);
  if (text !== '2 bagian diubah') throw new Error(`Expected '2 bagian diubah', got '${text}'`);

  // TEST 3: Change 3rd field in the SAME tab (Server NTP)
  console.log('\n--- 3. Change 3rd field in same tab (Server NTP) ---');
  await ntpInput.fill('ntp.bmkg.go.id');
  await page.waitForTimeout(300);
  text = (await page.locator('.sv #svn').textContent())?.trim();
  console.log('Current count text:', text);
  if (text !== '3 bagian diubah') throw new Error(`Expected '3 bagian diubah', got '${text}'`);

  // Capture screenshot for 3 fields
  const artifactDir = 'C:/Users/ZroiK/.gemini/antigravity/brain/cfa612f5-8420-4d78-a48e-88633f206655';
  await page.screenshot({ path: path.join(artifactDir, 'configuration_3_bagian_diubah.png') });
  console.log('Captured configuration_3_bagian_diubah.png');

  // TEST 4: Switch to Tab "Rekaman" and change 4th field
  console.log('\n--- 4. Switch to Rekaman tab and change 4th field ---');
  await page.locator('.si').filter({ hasText: 'Rekaman' }).click();
  await page.waitForTimeout(300);

  const durationBtn = page.locator('.seg button').filter({ hasText: '30 mnt' });
  await durationBtn.click();
  await page.waitForTimeout(300);
  text = (await page.locator('.sv #svn').textContent())?.trim();
  console.log('Current count text:', text);
  if (text !== '4 bagian diubah') throw new Error(`Expected '4 bagian diubah', got '${text}'`);

  // Capture screenshot for 4 fields
  await page.screenshot({ path: path.join(artifactDir, 'configuration_4_bagian_diubah.png') });
  console.log('Captured configuration_4_bagian_diubah.png');

  // TEST 5: Switch to Tab "Deteksi AI" and change 5th field
  console.log('\n--- 5. Switch to Deteksi AI tab and change 5th field ---');
  await page.locator('.si').filter({ hasText: 'Deteksi AI' }).click();
  await page.waitForTimeout(300);
  // Change FPS range slider
  const fpsSlider = page.locator('input[type="range"][min="1"][max="30"]');
  await fpsSlider.fill('20');
  await page.waitForTimeout(300);
  text = (await page.locator('.sv #svn').textContent())?.trim();
  console.log('Current count text:', text);
  if (text !== '5 bagian diubah') throw new Error(`Expected '5 bagian diubah', got '${text}'`);

  // TEST 6: Decrement by reverting 5th field manually
  console.log('\n--- 6. Decrement: Revert FPS slider back to 10 ---');
  await fpsSlider.fill('10');
  await page.waitForTimeout(300);
  text = (await page.locator('.sv #svn').textContent())?.trim();
  console.log('Current count text after reverting FPS to 10:', text);
  if (text !== '4 bagian diubah') throw new Error(`Expected '4 bagian diubah', got '${text}'`);

  // TEST 7: Test "Batalkan" button
  console.log('\n--- 7. Click Batalkan button to revert everything ---');
  await page.click('.sv .b1');
  await page.waitForTimeout(500);

  const isBarClosed = await page.evaluate(() => {
    const sv = document.querySelector('.sv');
    return !sv?.classList.contains('on');
  });
  console.log('Is floating bar hidden:', isBarClosed);
  if (!isBarClosed) throw new Error('Floating bar should be hidden after Batalkan');

  // Verify fields returned to original
  await page.locator('.si').filter({ hasText: 'Node & waktu' }).click();
  await page.waitForTimeout(300);
  const revertedName = await nameInput.inputValue();
  const revertedLoc = await locInput.inputValue();
  const revertedNtp = await ntpInput.inputValue();
  console.log('Values after Batalkan:', { revertedName, revertedLoc, revertedNtp });
  if (revertedName !== origName || revertedLoc !== origLoc || revertedNtp !== origNtp) {
    throw new Error('Fields were not properly restored to original values!');
  }

  // TEST 8: Test "Simpan" button
  console.log('\n--- 8. Test modifying and Saving ---');
  const newName = 'Quantis Forensic Node Verified';
  await nameInput.fill(newName);
  await locInput.fill(origLoc + ' Lab');
  await page.waitForTimeout(300);
  text = (await page.locator('.sv #svn').textContent())?.trim();
  console.log('Count before save:', text);
  if (text !== '2 bagian diubah') throw new Error(`Expected '2 bagian diubah', got '${text}'`);

  // Click Save
  await page.click('.sv .b2');
  await page.waitForTimeout(1000);

  const isBarClosedAfterSave = await page.evaluate(() => {
    const sv = document.querySelector('.sv');
    return !sv?.classList.contains('on');
  });
  console.log('Is floating bar hidden after Save:', isBarClosedAfterSave);
  if (!isBarClosedAfterSave) throw new Error('Floating bar should be hidden after Simpan');

  // Restore back to original name & location and save cleanly
  console.log('\n--- 9. Restore baseline settings and Save ---');
  await nameInput.fill(origName);
  await locInput.fill(origLoc);
  await page.waitForTimeout(300);
  await page.click('.sv .b2');
  await page.waitForTimeout(1000);

  await browser.close();
  console.log('\n=== ALL TESTS PASSED SUCCESSFULLY! ===');
}

main().catch((err) => {
  console.error('Test error:', err);
  process.exit(1);
});
