import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { compileAAL, formatDiagnostic, parseAAL, parseBinding } from "../dist/index.js";

const language = "zh-CN";
const source = readFileSync(new URL("../examples/order/app.zh-CN.aal", import.meta.url), "utf8");
const bindingSource = readFileSync(new URL("../examples/order/binding.zh-CN.json", import.meta.url), "utf8");
const binding = parseBinding(bindingSource, language).spec;
assert.ok(binding);
const httpSource = readFileSync(new URL("../examples/items/app.zh-CN.aal", import.meta.url), "utf8");

test("中文 AAL 使用同一套编译器完成解析和生成", () => {
  const result = compileAAL(source, { binding, language });
  assert.equal(result.diagnostics.length, 0, result.diagnostics.map(formatDiagnostic).join("\n"));
  assert.ok(result.program);
  assert.equal(result.program.name, "订单库存");
  assert.equal(result.program.objects.length, 2);
  assert.equal(result.program.flows.length, 3);
  assert.ok(result.code?.includes("export type Order"));
  assert.ok(result.code?.includes("function createOrder"));
  assert.ok(result.code?.includes('"orderId"'));
});

test("中文 Binding 可选且默认直接使用审计名称", () => {
  const result = compileAAL(source, { language });
  assert.equal(result.diagnostics.length, 0, result.diagnostics.map(formatDiagnostic).join("\n"));
  assert.ok(result.code?.includes("function 创建订单"));
});

test("中文 AAL 可以运行同一套 HTTP CRUD 语义", () => {
  const result = compileAAL(httpSource, { language });
  assert.equal(result.diagnostics.length, 0, result.diagnostics.map(formatDiagnostic).join("\n"));
  assert.ok(result.code);
  const generated = compileGenerated(result.code);
  generated.resetStore();
  assert.deepEqual(generated.handleHttpRequest({ method: "POST", path: "/items", body: { id: 1, name: "书" } }), {
    status: 201,
    body: { 项目: { 编号: 1, 名称: "书" } },
  });
  assert.deepEqual(generated.handleHttpRequest({ method: "GET", path: "/items/1" }), {
    status: 200,
    body: { 项目: { 编号: 1, 名称: "书" } },
  });
});

test("中文解析和生成保持确定性", () => {
  assert.deepEqual(parseAAL(source, { language }), parseAAL(source, { language }));
  assert.equal(compileAAL(source, { binding, language }).code, compileAAL(source, { binding, language }).code);
});

test("中文诊断保持中文", () => {
  const result = compileAAL(source.replace("单价 * 数量", "单价 * 不存在的数量"), { language });
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.message.includes("引用了未定义的名称：不存在的数量")));
});

test("中英文 Binding 使用相同稳定身份", () => {
  const english = JSON.parse(readFileSync(new URL("../examples/order/binding.json", import.meta.url), "utf8"));
  const chinese = JSON.parse(bindingSource);
  assert.deepEqual(collectIds(english).sort(), collectIds(chinese).sort());
});

test("中文 AAL 生成的 TypeScript 可以执行", () => {
  const result = compileAAL(source, { binding, language });
  assert.ok(result.code);
  const generated = compileGenerated(result.code);
  const price = generated.money("CNY", "yuan", 2, "19.90");
  const inventory = { quantity: 5 };

  const success = generated.run({ order: { id: 1001 }, inventory, unitPrice: price, quantity: 2 });
  assert.equal(success.ok, true);
  assert.equal(success.value.orderId, 1001);
  assert.equal(generated.moneyValue(success.value.total), "39.80");
  assert.equal(inventory.quantity, 3);

  const failure = generated.run({ order: { id: 1001 }, inventory: { quantity: 1 }, unitPrice: price, quantity: 2 });
  assert.deepEqual(failure, { ok: false, error: "库存不足" });
  assert.throws(
    () => generated.run({ order: { id: 1001 }, inventory: { quantity: 5 }, unitPrice: price, quantity: 1.5 }),
    /quantity必须是整数/,
  );
});

function collectIds(value) {
  return [
    ...value.objects.flatMap((object) => [object.id, ...object.fields.map((field) => field.id)]),
    ...value.flows.flatMap((flow) => [flow.id, ...flow.inputs.map((input) => input.id), ...flow.outputs.map((output) => output.id)]),
  ];
}

function compileGenerated(code) {
  const root = mkdtempSync(join(tmpdir(), "determinant-test-zh-"));
  const generatedPath = join(root, "order.ts");
  const outputDirectory = join(root, "out");
  writeFileSync(generatedPath, code, "utf8");
  execFileSync("tsc", ["--strict", "--target", "ES2022", "--module", "commonjs", "--moduleResolution", "node", "--skipLibCheck", "--outDir", outputDirectory, generatedPath], { stdio: "pipe" });
  return createRequire(import.meta.url)(join(outputDirectory, "order.js"));
}
