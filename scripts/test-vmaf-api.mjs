import pkg from "../apps/web-dashboard/node_modules/@playwright/test/index.js";
const { chromium } = pkg;

async function run() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  await page.goto("http://localhost:5173/login");
  await page.fill('input[type="text"]', "admin");
  await page.fill('input[type="password"]', "admin123");
  await page.click('button[type="submit"]');
  await page.waitForURL("**/matrix");

  const vmafData = await page.evaluate(async () => {
    const token = localStorage.getItem("vms_access_token");
    const res = await fetch("/api/stats/vmaf-probes", {
      headers: { Authorization: `Bearer ${token}` }
    });
    return { status: res.status, body: await res.json() };
  });

  console.log("STATUS:", vmafData.status);
  console.log("PROBES COUNT:", vmafData.body?.probes?.length);
  console.log("CURVE POINTS:", vmafData.body?.curve);
  await browser.close();
}

run().catch(console.error);
