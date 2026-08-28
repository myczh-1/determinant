#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const manifestPath = resolve(root, "tests/fixtures/manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const mismatches = [];
let checked = 0;

async function verify(path, expected) {
  checked += 1;
  let actual;
  try {
    actual = createHash("sha256").update(await readFile(resolve(root, path))).digest("hex");
  } catch (error) {
    mismatches.push(`${path}: ${error.message}`);
    return;
  }
  const normalizedExpected = expected.replace(/^sha256:/u, "");
  if (actual !== normalizedExpected) {
    mismatches.push(`${path}: expected ${normalizedExpected}, got ${actual}`);
  }
}

for (const group of ["validInputs", "supportingInputs", "generatedOutputs"]) {
  for (const entry of manifest[group] ?? []) await verify(entry.path, entry.sha256);
}
for (const [path, hash] of Object.entries(manifest.referenceFileHashes ?? {})) {
  await verify(path, hash);
}

if (mismatches.length > 0) {
  console.error("migration baseline mismatch:");
  for (const mismatch of mismatches) console.error(`- ${mismatch}`);
  process.exit(1);
}

console.log(`migration baseline verified: ${checked} files; reference commit ${manifest.baselineCommit}`);
