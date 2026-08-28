#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { compileAAL } from "../dist/index.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const sourcePath = "examples/order-refund/app.zh-CN.aal";
const source = readFileSync(join(root, sourcePath), "utf8");
const fixture = JSON.parse(readFileSync(join(root, "examples/order-refund/fixture.v1.json"), "utf8"));
const day7 = "2026-01-08T00:00:00.000Z";
const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const temporaryRoot = mkdtempSync(join(tmpdir(), "determinant-typescript-gate-"));

try {
  const legacyCode = compileAAL(source, { language: "zh-CN" }).code;
  assert.ok(legacyCode);
  const legacy = loadCommonJS(legacyCode, "legacy");

  const migratedPath = join(temporaryRoot, "migrated.ts");
  execFileSync("go", ["run", "./cmd/determinant", "build", sourcePath, "--language", "zh-CN", "--target", "typescript", "--out", migratedPath], {
    cwd: root,
    stdio: "ignore",
  });
  const migratedOutput = join(temporaryRoot, "migrated-output");
  writeFileSync(join(temporaryRoot, "package.json"), JSON.stringify({ type: "module" }), "utf8");
  execFileSync(npx, ["tsc", "--target", "ES2022", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--skipLibCheck", "--outDir", migratedOutput, migratedPath], {
    cwd: root,
    stdio: "ignore",
  });
  const migrated = await import(`${pathToFileURL(join(migratedOutput, "migrated.js")).href}?migration-gate=1`);

  const error = (method, path, body) => ({ method, path, body });
  const scenarios = [
    {
      name: "pay and duplicate payment",
      operations: [
        error("POST", "/orders/102/pay", { amount: "200.00" }),
        error("POST", "/orders/101/pay", { amount: "200.00" }),
        error("POST", "/orders/101/pay", { amount: "200.00" }),
      ],
    },
    {
      name: "pay validation priority",
      operations: [
        error("POST", "/orders/101/pay", { amount: "0.00" }),
        error("POST", "/orders/101/pay", { amount: "-1.00" }),
        error("POST", "/orders/101/pay", { amount: "100.00" }),
      ],
    },
    {
      name: "cancel idempotency",
      operations: [
        error("POST", "/orders/999/cancel"),
        error("POST", "/orders/102/cancel"),
        error("POST", "/orders/101/cancel"),
        error("POST", "/orders/101/cancel"),
      ],
    },
    {
      name: "refund state validation",
      operations: [
        error("POST", "/orders/999/refund", { userId: 999, amount: "-1.00", quantity: -1 }),
        error("POST", "/orders/101/refund", { userId: 1, amount: "-1.00", quantity: -1 }),
        error("POST", "/orders/105/refund", { userId: 1, amount: "100.00", quantity: 1 }),
      ],
    },
    {
      name: "refund deadline",
      clock: "2026-01-08T00:00:00.001Z",
      operations: [error("POST", "/orders/102/refund", { userId: 1, amount: "100.00", quantity: 1 })],
    },
    {
      name: "admin after deadline",
      clock: "2026-02-01T00:00:00.000Z",
      operations: [error("POST", "/orders/102/refund", { userId: 2, amount: "100.00", quantity: 1 })],
    },
    {
      name: "refund validation and limits",
      operations: [
        error("POST", "/orders/102/refund", { userId: 1, amount: "-1.00", quantity: -1 }),
        error("POST", "/orders/102/refund", { userId: 1, amount: "0.00", quantity: 1 }),
        error("POST", "/orders/102/refund", { userId: 1, amount: "50.00", quantity: 1 }),
        error("POST", "/orders/102/refund", { userId: 1, amount: "300.00", quantity: 3 }),
      ],
    },
    {
      name: "partial and full refund",
      operations: [
        error("POST", "/orders/102/refund", { userId: 1, amount: "100.00", quantity: 1 }),
        error("GET", "/orders/102/refundable"),
        error("POST", "/orders/102/refund", { userId: 1, amount: "100.00", quantity: 1 }),
        error("GET", "/orders/102/refundable"),
      ],
    },
    {
      name: "two partial refunds",
      operations: [
        error("POST", "/orders/103/refund", { userId: 1, amount: "100.00", quantity: 1 }),
        error("POST", "/orders/103/refund", { userId: 1, amount: "100.00", quantity: 1 }),
        error("POST", "/orders/103/refund", { userId: 1, amount: "100.00", quantity: 1 }),
      ],
    },
    {
      name: "fixture relation failures",
      mutate(value) {
        value.支付记录 = value.支付记录.filter((row) => row.订单编号 !== 102);
      },
      operations: [error("POST", "/orders/102/refund", { userId: 999, amount: "-1.00", quantity: -1 })],
    },
    {
      name: "transport and unknown route",
      operations: [
        error("POST", "/orders/101/pay", {}),
        error("POST", "/orders/101/pay", { amount: 200 }),
        error("POST", "/orders/101/refund", { userId: "1", amount: "100.00", quantity: 1 }),
        error("POST", "/orders/101/refund", { userId: 1, amount: "100.00" }),
        error("GET", "/unknown"),
      ],
    },
  ];

  for (const scenario of scenarios) {
    const scenarioFixture = structuredClone(fixture);
    scenario.mutate?.(scenarioFixture);
    legacy.loadFixture(structuredClone(scenarioFixture));
    migrated.loadFixture(structuredClone(scenarioFixture));
    for (const [index, operation] of scenario.operations.entries()) {
      const context = { now: () => scenario.clock ?? day7 };
      const expected = legacy.handleHttpRequest(operation, context);
      const actual = migrated.handleHttpRequest(operation, context);
      assert.deepEqual(actual, expected, `${scenario.name} operation ${index + 1}`);
    }
    console.log(`pass ${scenario.name}`);
  }
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}

console.log(`TypeScript backend differential oracle passed: ${10} scenarios`);

function loadCommonJS(code, name) {
  const directory = mkdtempSync(join(temporaryRoot, `${name}-`));
  const sourceFile = join(directory, `${name}.ts`);
  const outputDirectory = join(directory, "output");
  writeFileSync(sourceFile, code, "utf8");
  execFileSync(npx, ["tsc", "--strict", "--target", "ES2022", "--module", "commonjs", "--moduleResolution", "node", "--skipLibCheck", "--outDir", outputDirectory, sourceFile], {
    cwd: root,
    stdio: "ignore",
  });
  return createRequire(import.meta.url)(join(outputDirectory, `${name}.js`));
}
