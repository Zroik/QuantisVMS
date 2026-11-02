#!/usr/bin/env node
/**
 * scripts/check-design-tokens.mjs
 * Gate G5.2: Enforce "SwiftUI flat" design tokens and ban generic AI-slop styles.
 *
 * Checks:
 * 1. Forbidden classes in apps/web-dashboard/src:
 *    - bg-gradient-*
 *    - from-*, to-*, via-*
 *    - shadow-2xl, shadow-xl
 *    - backdrop-blur*
 *    - colored shadow-* (e.g. shadow-blue-500, shadow-indigo-*, etc.)
 * 2. Metric element check:
 *    - Any element with class containing metric patterns or displaying numbers must have tabular-nums.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const srcDir = path.resolve(__dirname, "../apps/web-dashboard/src");

const FORBIDDEN_CLASS_PATTERNS = [
  /\bbg-gradient-[a-z0-9-]+\b/i,
  /\b(?:from|to|via)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black|current|transparent|\[#[a-f0-9]{3,6}\])(?:-[0-9]{2,3}(?:\/[0-9]+)?)?\b/i,
  /\bshadow-(?:2xl|xl)\b/i,
  /\bbackdrop-blur(?:-[a-z0-9]+)?\b/i,
  /\bshadow-(?:blue|purple|indigo|rose|emerald|amber|red|green|cyan|sky|teal)-[0-9]{2,3}(?:\/[0-9]+)?\b/i,
];

// File extensions to scan
const SCAN_EXTENSIONS = [".vue", ".ts", ".tsx", ".html", ".css"];

async function getFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await getFiles(fullPath)));
    } else if (SCAN_EXTENSIONS.includes(path.extname(entry.name))) {
      files.push(fullPath);
    }
  }
  return files;
}

async function main() {
  console.log("=== Checking Design Tokens (Gate G5.2: SwiftUI Flat / No AI Slop) ===");
  const files = await getFiles(srcDir);
  let errors = 0;

  for (const file of files) {
    const content = await fs.readFile(file, "utf-8");
    const relativePath = path.relative(path.resolve(__dirname, ".."), file).replace(/\\/g, "/");
    const lines = content.split("\n");

    for (let lineNum = 1; lineNum <= lines.length; lineNum++) {
      const line = lines[lineNum - 1];

      // Check forbidden classes
      for (const pattern of FORBIDDEN_CLASS_PATTERNS) {
        const match = line.match(pattern);
        if (match) {
          console.error(`[ERROR] Forbidden AI-slop class "${match[0]}" at ${relativePath}:${lineNum}`);
          console.error(`  > ${line.trim()}`);
          errors++;
        }
      }

      // Check metric elements for tabular-nums
      // If a line contains data-metric or metric-value or class="...metric...", it must include tabular-nums
      if (/\b(?:data-metric|metric-value|vmaf-value|bitrate-value|fps-value)\b/i.test(line)) {
        if (!/tabular-nums/.test(line)) {
          console.error(`[ERROR] Metric element missing "tabular-nums" at ${relativePath}:${lineNum}`);
          console.error(`  > ${line.trim()}`);
          errors++;
        }
      }
    }
  }

  if (errors > 0) {
    console.error(`\nDesign token check failed with ${errors} violation(s).`);
    process.exit(1);
  } else {
    console.log(`\nDesign token check PASS: All ${files.length} source files adhere to SwiftUI flat tokens.`);
    process.exit(0);
  }
}

main().catch((err) => {
  console.error("Design token check runner error:", err);
  process.exit(1);
});

