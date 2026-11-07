/**
 * Browser verification for the route/navigation restructure (Tasks 2-5).
 * Uses the locally installed Microsoft Edge through Playwright, so it needs no
 * browser download. Requires the Docker stack on http://localhost:8080 and the
 * seeded admin account.
 *
 * Usage: node scripts/verify-ui-restructure.mjs
 */
import path from "node:path";
import fs from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverRequire = createRequire(path.join(repoRoot, "apps", "web-dashboard", "package.json"));
const { chromium } = serverRequire("@playwright/test");

const BASE_URL = process.env.VMS_WEB_URL || "http://localhost:8080";
const ADMIN_USER = process.env.VMS_ADMIN_USER || "admin";
const ADMIN_PASS = process.env.VMS_ADMIN_PASSWORD || "admin123";
const screenshotDir = path.join(repoRoot, "docs", "screenshots");

const results = [];
const failures = [];

function check(name, condition, detail = "") {
  const entry = { name, ok: Boolean(condition), detail };
  results.push(entry);
  if (!entry.ok) failures.push(entry);
  console.log(`${entry.ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

const consoleErrors = [];
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});
page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${error.message}`));

try {
  await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
  await page.fill('input[type="text"]', ADMIN_USER);
  await page.fill('input[type="password"]', ADMIN_PASS);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/live$/, { timeout: 15000 });
  check("Login redirects to /live", true);

  await page.waitForSelector("aside .nav a", { timeout: 15000 });
  const readNav = () =>
    page.$$eval("aside .nav a", (links) =>
      links.map((link) => ({
        href: link.getAttribute("href"),
        label: link.querySelector("span")?.textContent?.trim() ?? link.textContent.trim(),
        badge: link.querySelector("i")?.textContent?.trim() ?? null,
      }))
    );

  const nav = await readNav();
  console.log("NAV(id):", JSON.stringify(nav));

  check(
    "Nav exposes exactly the four primary views",
    JSON.stringify(nav.map((item) => item.href)) ===
      JSON.stringify(["/live", "/playback", "/monitor", "/configuration"]),
    JSON.stringify(nav.map((item) => item.href))
  );
  check(
    "Nav labels in the Indonesian locale",
    nav[0]?.label === "Live View" &&
      nav[1]?.label === "Playback" &&
      nav[2]?.label === "Monitor Sistem" &&
      nav[3]?.label === "Konfigurasi",
    nav.map((item) => item.label).join(" | ")
  );
  check("No VMAF nav entry remains", !nav.some((item) => String(item.href).includes("vmaf")));

  // Switch to English through the sidebar language toggle and re-read the nav.
  await page.click("button.tb.id");
  await page.waitForTimeout(300);
  const navEn = await readNav();
  console.log("NAV(en):", JSON.stringify(navEn));
  check(
    "Nav labels in the English locale",
    navEn[0]?.label === "Live View" &&
      navEn[1]?.label === "Playback" &&
      navEn[2]?.label === "System Monitor" &&
      navEn[3]?.label === "Configuration",
    navEn.map((item) => item.label).join(" | ")
  );
  await page.click("button.tb.id");
  await page.waitForTimeout(200);

  fs.mkdirSync(screenshotDir, { recursive: true });
  await page.screenshot({ path: path.join(screenshotDir, "restructure-live.png") });

  const redirects = [
    ["/", "/live"],
    ["/matrix", "/live"],
    ["/timeline", "/playback"],
    ["/hardware", "/monitor"],
    ["/settings", "/configuration"],
    ["/vmaf", "/live"],
    ["/does-not-exist", "/live"],
  ];
  for (const [from, to] of redirects) {
    await page.goto(`${BASE_URL}${from}`, { waitUntil: "domcontentloaded" });
    await page.waitForURL(new RegExp(`${to.replace("/", "\\/")}$`), { timeout: 10000 });
    check(`Redirect ${from} -> ${to}`, page.url().endsWith(to), page.url());
  }

  await page.goto(`${BASE_URL}/playback`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".timeline-view", { timeout: 15000 });
  const playback = await page.evaluate(() => {
    const banner = document.querySelector(".empty-banner");
    const video = document.querySelector("video");
    const segments = document.querySelectorAll(".segment-card-row").length;
    const emptyPlayer = document.querySelector(".video-empty-state");
    return {
      banner: banner ? banner.textContent.replace(/\s+/g, " ").trim() : null,
      videoSrc: video ? video.getAttribute("src") : null,
      segments,
      emptyPlayer: emptyPlayer ? emptyPlayer.textContent.replace(/\s+/g, " ").trim() : null,
      heading: document.querySelector("h1")?.textContent?.trim() || null,
    };
  });
  console.log("PLAYBACK:", JSON.stringify(playback));
  check("Playback renders without the zero-camera banner while cameras exist", playback.banner === null);
  check(
    "Playback lists recording segments or a clean empty state",
    playback.segments > 0 || Boolean(playback.emptyPlayer)
  );
  await page.screenshot({ path: path.join(screenshotDir, "restructure-playback.png") });

  // Pick a camera that owns finished segments and play one.
  const cameraOptions = await page.$$eval("select.sel option", (options) =>
    options.map((option) => ({ value: option.value, text: option.textContent.trim() }))
  );
  const targetCamera = cameraOptions.find((option, index) => index > 0) || cameraOptions[0];
  if (targetCamera) {
    await page.selectOption("select.sel", targetCamera.value);
    await page.waitForTimeout(3000);
  }

  const player = await page.evaluate(() => {
    const video = document.querySelector("video");
    const errorOverlay = document.querySelector(".video-error-overlay");
    return {
      hasVideo: Boolean(video),
      src: video?.getAttribute("src") || null,
      mediaError: video?.error?.code ?? null,
      readyState: video?.readyState ?? null,
      duration: Number.isFinite(video?.duration) ? Number(video?.duration) : null,
      errorOverlay: errorOverlay?.textContent?.replace(/\s+/g, " ").trim() || null,
    };
  });
  console.log("PLAYER:", JSON.stringify(player));
  check(
    `Playback loads a playable segment for "${targetCamera?.text}"`,
    player.hasVideo && !player.errorOverlay,
    JSON.stringify(player)
  );

  const playButton = page.locator(".bardeck-controls button", { hasText: "Putar" }).first();
  if (await playButton.count()) {
    await playButton.click();
    await page.waitForTimeout(2500);
  }
  const currentTime = await page.evaluate(() => {
    const video = document.querySelector("video");
    return video ? video.currentTime : -1;
  });
  check("Playback advances video time after pressing Play", currentTime > 0, `currentTime=${currentTime.toFixed(2)}`);
  await page.screenshot({ path: path.join(screenshotDir, "restructure-playback-playing.png") });

  for (const [route, name] of [
    ["/monitor", "monitor"],
    ["/configuration", "configuration"],
  ]) {
    await page.goto(`${BASE_URL}${route}`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("h1, h2", { timeout: 15000 });
    const heading = await page.locator("h1").first().textContent().catch(() => null);
    check(`${route} renders a heading`, Boolean(heading && heading.trim()), heading?.trim());
    await page.screenshot({ path: path.join(screenshotDir, `restructure-${name}.png`) });
  }

  // Live view: both provisioned cameras must deliver decoded frames.
  await page.goto(`${BASE_URL}/live`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".cam-tile", { timeout: 20000 });
  await page.waitForTimeout(12000);
  const tiles = await page.$$eval(".cam-tile", (nodes) =>
    nodes.map((tile) => {
      const video = tile.querySelector("video");
      return {
        name: tile.querySelector(".cam-name")?.textContent?.trim() ?? null,
        state: tile.querySelector(".ok, .offline-pill")?.textContent?.trim() ?? null,
        readyState: video?.readyState ?? null,
        width: video?.videoWidth ?? null,
        height: video?.videoHeight ?? null,
        paused: video?.paused ?? null,
      };
    })
  );
  console.log("LIVE:", JSON.stringify(tiles));
  check(
    "Both cameras deliver decoded video frames on /live",
    tiles.length === 2 && tiles.every((tile) => (tile.readyState ?? 0) >= 2 && (tile.width ?? 0) > 0),
    JSON.stringify(tiles)
  );
  await page.screenshot({ path: path.join(screenshotDir, "restructure-live-frames.png") });

  // ONVIF scanner from the Configuration tab: the subnet scan must list both cameras.
  await page.goto(`${BASE_URL}/configuration?tab=cam`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  const scanTrigger = page.locator('button:has-text("Pindai ONVIF")').first();
  check("Configuration exposes the ONVIF scan action", (await scanTrigger.count()) > 0);
  if (await scanTrigger.count()) {
    await scanTrigger.click();
    await page.waitForSelector(".modal-backdrop", { timeout: 10000 });

    let deviceRows = [];
    for (let attempt = 0; attempt < 20; attempt++) {
      await page.waitForTimeout(1000);
      deviceRows = await page.$$eval(".modal-backdrop table tbody tr", (rows) =>
        rows.map((row) => row.textContent.replace(/\s+/g, " ").trim())
      );
      const hasDevices = deviceRows.some((row) => /192\.168\.100\.(67|16)/.test(row));
      if (hasDevices) break;
    }
    console.log("ONVIF ROWS:", JSON.stringify(deviceRows));
    check(
      "ONVIF scan lists both physical cameras",
      deviceRows.some((row) => row.includes("192.168.100.67")) &&
        deviceRows.some((row) => row.includes("192.168.100.16")),
      JSON.stringify(deviceRows)
    );
    const scanStatus = await page.locator(".modal-backdrop").first().textContent();
    check(
      "ONVIF status banner mentions the host subnet scan",
      /Memindai subnet host|Ditemukan \d+ perangkat ONVIF/.test(scanStatus || "")
    );
    await page.screenshot({ path: path.join(screenshotDir, "restructure-onvif-scan.png") });
    await page.keyboard.press("Escape").catch(() => {});
  }

  const appErrors = consoleErrors.filter((text) => !/Failed to load resource|WHEP|WebRTC|net::ERR/.test(text));
  check("No unexpected console errors", appErrors.length === 0, appErrors.slice(0, 5).join(" || "));
} catch (error) {
  check("Browser verification completed", false, error.message);
} finally {
  await browser.close();
}

const passed = results.filter((entry) => entry.ok).length;
console.log(`\nRESULT ${passed}/${results.length} checks passed`);
process.exit(failures.length === 0 ? 0 : 1);
