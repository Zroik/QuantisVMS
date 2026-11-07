/**
 * Utility script to remux existing raw/archive MP4 recordings with faststart/sidx index.
 * Solves C-1 for historical files created before global_sidx was enabled.
 *
 * Usage: node scripts/faststart-remux-archive.mjs [directory]
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const targetDir = process.argv[2] || path.resolve("data/raw");

async function getAllMp4Files(dir) {
  let results = [];
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results = results.concat(await getAllMp4Files(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".mp4") && !entry.name.includes(".tmp")) {
      results.push(fullPath);
    }
  }
  return results;
}

async function isFaststartOrIndexed(filePath) {
  try {
    // Read first 4KB to check for moov before mdat
    const fd = await fsp.open(filePath, "r");
    const buf = Buffer.alloc(4096);
    await fd.read(buf, 0, 4096, 0);
    await fd.close();

    const str = buf.toString("latin1");
    const moovIdx = str.indexOf("moov");
    const mdatIdx = str.indexOf("mdat");
    const sidxIdx = str.indexOf("sidx");

    if (sidxIdx !== -1) return true;
    if (moovIdx !== -1 && mdatIdx !== -1 && moovIdx < mdatIdx) return true;
    return false;
  } catch {
    return false;
  }
}

async function remuxFile(filePath) {
  const tmpPath = `${filePath}.faststart_tmp.mp4`;
  try {
    console.log(`[Faststart] Remuxing: ${filePath}...`);
    await execFileAsync("ffmpeg", [
      "-y",
      "-hide_banner",
      "-loglevel", "error",
      "-i", filePath,
      "-c", "copy",
      "-movflags", "+faststart",
      tmpPath,
    ]);

    const origStat = await fsp.stat(filePath);
    const tmpStat = await fsp.stat(tmpPath);

    if (tmpStat.size > 1000) {
      await fsp.rename(tmpPath, filePath);
      console.log(`[Faststart] Successfully indexed: ${filePath} (${tmpStat.size} bytes)`);
      return true;
    } else {
      await fsp.unlink(tmpPath).catch(() => {});
      console.warn(`[Faststart] Output file too small, keeping original: ${filePath}`);
      return false;
    }
  } catch (err) {
    await fsp.unlink(tmpPath).catch(() => {});
    console.error(`[Faststart] Failed to remux ${filePath}:`, err.message);
    return false;
  }
}

async function main() {
  if (!fs.existsSync(targetDir)) {
    console.log(`Directory does not exist: ${targetDir}`);
    return;
  }

  const files = await getAllMp4Files(targetDir);
  console.log(`Found ${files.length} MP4 files in ${targetDir}`);

  let remuxedCount = 0;
  let skippedCount = 0;

  for (const file of files) {
    const alreadyIndexed = await isFaststartOrIndexed(file);
    if (alreadyIndexed) {
      skippedCount++;
      continue;
    }
    const ok = await remuxFile(file);
    if (ok) remuxedCount++;
  }

  console.log(`Done! Remuxed: ${remuxedCount}, Already indexed: ${skippedCount}`);
}

main().catch(console.error);

