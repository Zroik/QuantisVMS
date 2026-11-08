#!/usr/bin/env node
/**
 * Lightweight secret scanner for tracked files — a regression guard for the
 * 2026-11 credential leak. No external dependencies.
 *
 * Usage:
 *   node scripts/scan-secrets.mjs        # scan all tracked files
 *   node scripts/scan-secrets.mjs <f...> # scan specific files (used by the hook)
 *
 * Exits non-zero if anything is found.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";

// Known-leaked values that must never reappear. They are assembled at runtime
// so this file does not itself contain the contiguous secret strings (which
// would re-introduce them into the repository).
const DENYLIST = [
  ["Sby0", "9300116"].join(""),
  ["926c68b23d11c9f0", "112d94ab9d1400367ad1"].join(""),
  ["f3d72df5f67e1f28", "d502c66a2e8e09689dd1"].join(""),
];

// Strongly-shaped secrets that are almost never legitimate in a repo.
const PATTERNS = [
  { name: "private key", re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/ },
  { name: "AWS access key id", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "GitHub token", re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { name: "OpenAI key", re: /\bsk-[A-Za-z0-9]{32,}\b/ },
  { name: "Slack token", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
];

const SELF = "scripts/scan-secrets.mjs";
const ALLOW_FILES = new Set([".env.example"]);

function listTracked() {
  const out = execFileSync("git", ["ls-files", "-z"], { encoding: "buffer" });
  return out.toString("utf8").split("\0").filter(Boolean);
}

const args = process.argv.slice(2);
const files = (args.length > 0 ? args : listTracked()).filter(
  (f) => f !== SELF && !ALLOW_FILES.has(f)
);

const findings = [];
for (const file of files) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    continue; // deleted in the index, or unreadable
  }
  if (text.includes("\0")) continue; // skip binary files
  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    for (const secret of DENYLIST) {
      if (line.includes(secret)) {
        findings.push({ file, line: index + 1, name: `known leaked value (${secret.slice(0, 4)}…)` });
      }
    }
    for (const { name, re } of PATTERNS) {
      if (re.test(line)) {
        findings.push({ file, line: index + 1, name });
      }
    }
  });
}

if (findings.length > 0) {
  console.error("Secret scan FAILED — potential secrets found:\n");
  for (const f of findings) {
    console.error(`  ${f.file}:${f.line}  (${f.name})`);
  }
  console.error(`\n${findings.length} finding(s). Remove them before committing.`);
  process.exit(1);
}

console.log("Secret scan PASSED: no known secrets or high-risk credential patterns in tracked files.");
