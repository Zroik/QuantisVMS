import pkg from "../apps/web-dashboard/node_modules/@playwright/test/index.js";
const { chromium } = pkg;
import path from "node:path";
import fs from "node:fs";

const ARTIFACT_DIR = "C:/Users/ZroiK/.gemini/antigravity/brain/cfa612f5-8420-4d78-a48e-88633f206655";

async function run() {
  console.log("=== Starting ONVIF ODM Verification via Playwright ===");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 }
  });
  const page = await context.newPage();

  page.on("console", (msg) => {
    if (msg.type() === "error") console.log(`[Browser Console Error]`, msg.text());
  });

  // 1. Login
  console.log("1. Navigating to Login...");
  await page.goto("http://localhost:5173/login", { waitUntil: "networkidle" });
  await page.fill('input[type="text"]', "admin");
  await page.fill('input[type="password"]', "admin123");
  await page.click('button[type="submit"]');

  await page.waitForURL("**/matrix", { timeout: 10000 });
  console.log("Logged in! URL is at /matrix");
  await page.waitForTimeout(3000);

  // 2. Test LiveMatrix ONVIF Panel for Camera 2 (v380 pro)
  console.log("2. Testing ONVIF Panel on Camera 2 (v380 pro with PTZ)...");
  // Find the ONVIF pill or camera tile for v380 pro
  const onvifPills = await page.$$(".ptz-pill-btn");
  console.log(`Found ${onvifPills.length} ONVIF buttons on camera tiles`);

  if (onvifPills.length > 0) {
    // Click on Camera 2's ONVIF button
    await onvifPills[1].click();
    await page.waitForTimeout(2000);

    // Verify PTZ controls are visible
    const ptzDpad = await page.$(".ptz-grid");
    console.log("PTZ D-pad visible:", Boolean(ptzDpad));

    // Click UP arrow
    const upBtn = await page.$('.ptz-btn[title="Atas"]');
    if (upBtn) {
      console.log("Simulating PTZ Move Up...");
      await upBtn.hover();
      await page.mouse.down();
      await page.waitForTimeout(400);
      await page.mouse.up();
      console.log("PTZ Move Up simulated!");
    }

    // Capture screenshot of PTZ panel
    const ptzShotPath = path.join(ARTIFACT_DIR, "onvif_matrix_ptz_verified.png");
    await page.screenshot({ path: ptzShotPath });
    console.log(`Saved screenshot: ${ptzShotPath}`);
  }

  // 3. Test LiveMatrix ONVIF Panel for Camera 1 (Hikvision)
  console.log("3. Testing ONVIF Panel on Camera 1 (Hikvision with Imaging/IR)...");
  if (onvifPills.length > 0) {
    await onvifPills[0].click();
    await page.waitForTimeout(2000);

    // Verify Day/Night IR segmented buttons exist
    const dayNightButtons = await page.$$("text=Siang");
    console.log("Day/Night buttons present:", dayNightButtons.length > 0);

    // Capture screenshot of Imaging panel
    const imgShotPath = path.join(ARTIFACT_DIR, "onvif_matrix_imaging_verified.png");
    await page.screenshot({ path: imgShotPath });
    console.log(`Saved screenshot: ${imgShotPath}`);
  }

  // 4. Test Configuration View & ONVIF Network Discovery Modal
  console.log("4. Navigating to /configuration...");
  await page.goto("http://localhost:5173/configuration", { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);

  // Click on camera sub-item
  const cameraTabBtn = await page.$('button.sub-item-btn:has-text("Kamera")');
  if (cameraTabBtn) {
    await cameraTabBtn.click();
    await page.waitForTimeout(1000);
  }

  // Look for "Pindai Jaringan (ONVIF)" button
  console.log("5. Opening 'Pindai Jaringan (ONVIF)' Modal...");
  const scanBtn = await page.$('button:has-text("Pindai Jaringan (ONVIF)")');
  if (scanBtn) {
    await scanBtn.click();
    await page.waitForTimeout(3500); // Wait for WS-Discovery probe & host file sync

    // Verify Discovery Modal is rendered
    const modalTitle = await page.$('text=Pindai & Tambah Kamera Otomatis (ONVIF)');
    console.log("Discovery Modal opened:", Boolean(modalTitle));

    // Verify Anti-Lockout notice
    const antiLockoutNotice = await page.$('text=Proteksi Anti-Lockout Keamanan');
    console.log("Anti-Lockout Notice present:", Boolean(antiLockoutNotice));

    // Take screenshot of Discovery Modal
    const discoveryShotPath = path.join(ARTIFACT_DIR, "onvif_network_discovery_verified.png");
    await page.screenshot({ path: discoveryShotPath });
    console.log(`Saved screenshot: ${discoveryShotPath}`);
  } else {
    console.log("WARNING: 'Pindai Jaringan (ONVIF)' button not found!");
  }

  await browser.close();
  console.log("=== ONVIF ODM Verification Complete ===");
}

run().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});

