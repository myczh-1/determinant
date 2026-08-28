#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const temporaryRoot = mkdtempSync(join(tmpdir(), "determinant-acceptance-"));
const cliPath = join(temporaryRoot, process.platform === "win32" ? "determinant.exe" : "determinant");
const emptyPath = join(temporaryRoot, "empty-path");
const sourceCases = [
  { name: "items english", source: "examples/items/app.aal", language: "en" },
  { name: "items chinese", source: "examples/items/app.zh-CN.aal", language: "zh-CN" },
  { name: "order english", source: "examples/order/app.aal", language: "en" },
  { name: "order chinese", source: "examples/order/app.zh-CN.aal", language: "zh-CN" },
  { name: "refund stable", source: "examples/order-refund/app.zh-CN.aal", language: "zh-CN" },
  { name: "refund composed", source: "examples/order-refund/app.composed-flow.zh-CN.aal", language: "zh-CN" },
];
const cleanEnvironment = { ...process.env, PATH: emptyPath, Path: emptyPath };

try {
  mkdirSync(emptyPath);
  execFileSync("go", ["build", "-o", cliPath, "./cmd/determinant"], { cwd: root, stdio: "pipe" });
  verifyDeterministicBuilds();
  verifyCLIContract();
  verifyGeneratedSources();
  verifyToolchainFreeBuilds();
  console.log("Toolchain acceptance gates passed.");
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}

function verifyDeterministicBuilds() {
  for (const target of ["go", "typescript"]) {
    let expectedDigest = "";
    for (let iteration = 0; iteration < 20; iteration += 1) {
      const output = join(temporaryRoot, `deterministic-${target}.source`);
      const result = invoke(cliPath, [
        "build",
        "examples/order-refund/app.zh-CN.aal",
        "--language",
        "zh-CN",
        "--target",
        target,
        "--out",
        output,
      ]);
      assert.equal(result.code, 0, `${target} deterministic build failed: ${result.stderr}`);
      const generated = readFileSync(output);
      const digest = sha256(generated);
      if (iteration === 0) expectedDigest = digest;
      assert.equal(digest, expectedDigest, `${target} output drifted at iteration ${iteration + 1}`);
      assert.ok(!generated.includes(temporaryRoot), `${target} output contains a temporary path`);
    }
    console.log(`pass deterministic ${target}: 20/20; ${expectedDigest}`);
  }
}

function verifyCLIContract() {
  const valid = join(root, "examples/items/app.aal");
  const missing = join(temporaryRoot, "missing.aal");
  const empty = join(temporaryRoot, "empty.aal");
  const syntax = join(temporaryRoot, "syntax.aal");
  const semantic = join(temporaryRoot, "semantic.aal");
  const multiple = join(temporaryRoot, "multiple.aal");
  const invalidEncoding = join(temporaryRoot, "invalid-encoding.aal");
  writeFileSync(empty, "", "utf8");
  writeFileSync(syntax, "application: Broken\nthis is not AAL\n", "utf8");
  const orderSource = readFileSync(join(root, "examples/order/app.aal"), "utf8");
  writeFileSync(semantic, orderSource.replace("unitPrice * quantity", "unitPrice * missingQuantity"), "utf8");
  const itemsSource = readFileSync(valid, "utf8");
  writeFileSync(
    multiple,
    itemsSource.replace("    name: text", "    name: missingType") + "\nobject: Item\n\n    id: integer\n    name: text\n",
    "utf8",
  );
  writeFileSync(invalidEncoding, Buffer.from([0xff, 0xfe, 0x0a]));

  const success = invoke(cliPath, ["check", valid]);
  assert.equal(success.code, 0);
  assert.match(success.stdout, /^ok: /);
  assert.equal(success.stderr, "");

  const missingResult = assertJSONFailure(["check", "--json", missing], "missing source");
  assert.equal(missingResult.diagnostics[0].code, "AAL0003");
  assert.equal(missingResult.diagnostics[0].file, missing);

  const emptyResult = assertJSONFailure(["check", "--json", empty], "empty source");
  assert.ok(emptyResult.diagnostics.length > 0);

  const syntaxResult = assertJSONFailure(["check", "--json", syntax], "syntax error");
  assert.ok(syntaxResult.diagnostics.some((item) => item.code.startsWith("AAL1")));

  const semanticResult = assertJSONFailure(["check", "--json", semantic], "semantic error");
  assert.ok(semanticResult.diagnostics.some((item) => item.code.startsWith("AAL2")));
  assert.ok(semanticResult.diagnostics.every((item) => item.line > 0 && item.column > 0));

  const multipleResult = assertJSONFailure(["check", "--json", multiple], "multiple errors");
  assert.ok(multipleResult.diagnostics.length >= 2, JSON.stringify(multipleResult));

  const encodingResult = assertJSONFailure(["check", "--json", invalidEncoding], "invalid encoding");
  assert.ok(encodingResult.diagnostics.length > 0);

  const repeatOne = invoke(cliPath, ["check", "--json", semantic]);
  const repeatTwo = invoke(cliPath, ["check", "--json", semantic]);
  assert.equal(repeatOne.code, repeatTwo.code);
  assert.equal(repeatOne.stdout, repeatTwo.stdout, "JSON diagnostics drifted between repeated checks");
  JSON.parse(repeatOne.stdout);

  const output = join(temporaryRoot, "stale-output.go");
  const firstBuild = invoke(cliPath, [
    "build",
    "examples/order-refund/app.zh-CN.aal",
    "--language",
    "zh-CN",
    "--target",
    "go",
    "--out",
    output,
  ]);
  assert.equal(firstBuild.code, 0, firstBuild.stderr);
  const secondBuild = invoke(cliPath, ["build", valid, "--target", "go", "--out", output]);
  assert.equal(secondBuild.code, 0, secondBuild.stderr);
  const freshOutput = readFileSync(output, "utf8");
  assert.match(freshOutput, /ItemService/);
  assert.doesNotMatch(freshOutput, /订单不存在/);
  console.log("pass CLI check/build contract: success, missing, empty, syntax, semantic, multi-error, encoding, JSON stability");
}

function verifyGeneratedSources() {
  for (const sourceCase of sourceCases) {
    const safeName = sourceCase.name.replaceAll(" ", "-");
    const goPath = join(temporaryRoot, `${safeName}.go`);
    const goBuild = invoke(cliPath, [
      "build",
      sourceCase.source,
      "--language",
      sourceCase.language,
      "--target",
      "go",
      "--out",
      goPath,
    ]);
    assert.equal(goBuild.code, 0, `${sourceCase.name} Go generation failed: ${goBuild.stderr}`);
    const gofmt = invoke("gofmt", ["-w", goPath]);
    assert.equal(gofmt.code, 0, `${sourceCase.name} gofmt failed: ${gofmt.stderr}`);
    const gofmtCheck = invoke("gofmt", ["-d", goPath]);
    assert.equal(gofmtCheck.code, 0, `${sourceCase.name} formatted Go could not be checked: ${gofmtCheck.stderr}`);
    assert.equal(gofmtCheck.stdout, "", `${sourceCase.name} could not be stabilized by gofmt`);
    const goVet = invoke("go", ["vet", goPath], { env: { ...process.env, GO111MODULE: "off" } });
    assert.equal(goVet.code, 0, `${sourceCase.name} generated Go failed go vet: ${goVet.stderr}`);
    const binary = join(temporaryRoot, `${safeName}-server${process.platform === "win32" ? ".exe" : ""}`);
    const goBuildResult = invoke("go", ["build", "-o", binary, goPath], { env: { ...process.env, GO111MODULE: "off" } });
    assert.equal(goBuildResult.code, 0, `${sourceCase.name} generated Go failed build: ${goBuildResult.stderr}`);

    const tsPath = join(temporaryRoot, `${safeName}.ts`);
    const tsBuild = invoke(cliPath, [
      "build",
      sourceCase.source,
      "--language",
      sourceCase.language,
      "--target",
      "typescript",
      "--out",
      tsPath,
    ]);
    assert.equal(tsBuild.code, 0, `${sourceCase.name} TypeScript generation failed: ${tsBuild.stderr}`);
    const tsCheck = invoke("npx", [
      "tsc",
      "--noEmit",
      "--target",
      "ES2022",
      "--module",
      "NodeNext",
      "--moduleResolution",
      "NodeNext",
      "--skipLibCheck",
      tsPath,
    ]);
    assert.equal(tsCheck.code, 0, `${sourceCase.name} generated TypeScript failed typecheck: ${tsCheck.stderr}`);
    console.log(`pass generated source validity: ${sourceCase.name}`);
  }
}

function verifyToolchainFreeBuilds() {
  const valid = join(root, "examples/items/app.aal");
  const version = invoke(cliPath, ["version"], { env: cleanEnvironment });
  assert.equal(version.code, 0, version.stderr);
  assert.match(version.stdout, /^determinant /);

  for (const target of ["go", "typescript"]) {
    const output = join(temporaryRoot, `toolchain-free-${target}.source`);
    const result = invoke(cliPath, ["build", valid, "--target", target, "--out", output], { env: cleanEnvironment });
    assert.equal(result.code, 0, `${target} build unexpectedly needs a toolchain: ${result.stderr}`);
    assert.ok(readFileSync(output).length > 0);
  }

  const check = invoke(cliPath, ["check", valid], { env: cleanEnvironment });
  assert.equal(check.code, 0, `check unexpectedly needs a toolchain: ${check.stderr}`);

  const run = invoke(cliPath, ["run", valid], { env: cleanEnvironment });
  assert.notEqual(run.code, 0, "run unexpectedly succeeded without Go");
  assert.match(`${run.stdout}\n${run.stderr}`, /go/i);
  console.log("pass clean-environment contract: version/check/build work; run clearly reports missing Go");
}

function assertJSONFailure(args, label) {
  const result = invoke(cliPath, args);
  assert.notEqual(result.code, 0, `${label} unexpectedly succeeded`);
  assert.equal(result.stderr, "", `${label} wrote non-JSON diagnostics to stderr: ${result.stderr}`);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.status, "error", `${label} has unexpected status`);
  assert.equal(payload.success, false, `${label} has unexpected success flag`);
  assert.ok(Array.isArray(payload.diagnostics), `${label} has no diagnostics array`);
  return payload;
}

function invoke(command, args, options = {}) {
  try {
    return {
      code: 0,
      stdout: execFileSync(command, args, { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024, ...options }),
      stderr: "",
    };
  } catch (error) {
    return {
      code: typeof error.status === "number" ? error.status : 1,
      stdout: normalizeOutput(error.stdout),
      stderr: normalizeOutput(error.stderr),
    };
  }
}

function normalizeOutput(value) {
  return value ? (Buffer.isBuffer(value) ? value.toString("utf8") : String(value)) : "";
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
