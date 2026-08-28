#!/usr/bin/env node

import { mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL("..", import.meta.url)));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

function run(name, command, args, environment = process.env) {
  console.log(`\n== ${name} ==`);
  execFileSync(command, args, {
    cwd: root,
    env: environment,
    stdio: "inherit",
  });
}

run("frozen reference baseline", npm, ["run", "verify:baseline"]);
run("legacy Node/TypeScript suite", npm, ["test"]);
run("composed-flow reference oracle", npm, ["run", "test:order-refund:composed-flow"]);
run("toolchain acceptance gates", process.execPath, ["scripts/verify-toolchain-acceptance.mjs"]);
run("Go Core generated TypeScript differential oracle", process.execPath, ["scripts/verify-typescript-backend.mjs"]);
run("Go compiler and backend tests", "go", ["test", "./..."]);
run("Go static analysis", "go", ["vet", "./..."]);

const outputDirectory = mkdtempSync(join(tmpdir(), "determinant-migration-build-"));
try {
  for (const [name, goos, goarch, suffix] of [
    ["macOS arm64", "darwin", "arm64", ""],
    ["macOS amd64", "darwin", "amd64", ""],
    ["Linux amd64", "linux", "amd64", ""],
    ["Windows amd64", "windows", "amd64", ".exe"],
  ]) {
    const output = join(outputDirectory, `determinant-${goos}-${goarch}${suffix}`);
    run(`cross-build ${name}`, "go", ["build", "-o", output, "./cmd/determinant"], {
      ...process.env,
      GOOS: goos,
      GOARCH: goarch,
    });
  }
} finally {
  rmSync(outputDirectory, { recursive: true, force: true });
}

console.log("\nGo toolchain migration gates passed.");
