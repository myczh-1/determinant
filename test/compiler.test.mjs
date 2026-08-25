import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import test from "node:test";
import { compileAAL, formatDiagnostic, parseAAL, parseBinding } from "../dist/index.js";

const source = readFileSync(new URL("../examples/order.aal", import.meta.url), "utf8");
const bindingSource = readFileSync(new URL("../bindings/order.binding.json", import.meta.url), "utf8");
const binding = parseBinding(bindingSource).spec;
assert.ok(binding);

test("parses and compiles the order example", () => {
  const result = compileAAL(source);
  assert.equal(result.diagnostics.length, 0, result.diagnostics.map(formatDiagnostic).join("\n"));
  assert.ok(result.program);
  assert.equal(result.program.objects.length, 2);
  assert.equal(result.program.flows.length, 3);
  assert.ok(result.code?.includes("function flow_0"));
  assert.ok(result.code?.includes("function flow_2"));
  assert.ok(result.code?.includes("export function run"));
});

test("parsing and generation are deterministic", () => {
  assert.deepEqual(parseAAL(source), parseAAL(source));
  assert.equal(compileAAL(source).code, compileAAL(source).code);
});

test("binding maps audit names to stable program names", () => {
  const parsed = parseBinding(bindingSource);
  assert.equal(parsed.diagnostics.length, 0, parsed.diagnostics.map(formatDiagnostic).join("\n"));
  const result = compileAAL(source, { binding });
  assert.equal(result.diagnostics.length, 0, result.diagnostics.map(formatDiagnostic).join("\n"));
  assert.ok(result.code?.includes("export type Order"));
  assert.ok(result.code?.includes('"quantity": number'));
  assert.ok(result.code?.includes("function createOrder"));
  assert.ok(result.code?.includes('"orderId"'));
  assert.ok(!result.code?.includes('"订单编号"'));
});

test("rejects a binding that does not cover the AAL", () => {
  const incomplete = JSON.parse(bindingSource);
  incomplete.objects[0].fields = [];
  const result = compileAAL(source, { binding: incomplete });
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.message.includes("对象 订单 的字段缺少绑定：编号")));
  assert.equal(result.code, null);
});

test("rejects a dot-based field access", () => {
  const result = compileAAL(source.replace("订单 的 编号", "订单.编号"));
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.message.includes("无法识别的字符：.")));
  assert.equal(result.code, null);
});

test("rejects an undeclared reference with a source location", () => {
  const result = compileAAL(source.replace("单价 * 数量", "单价 * 不存在的数量"));
  const diagnostic = result.diagnostics.find((item) => item.message.includes("未定义的名称：不存在的数量"));
  assert.ok(diagnostic);
  assert.ok(diagnostic.loc.line > 0);
  assert.equal(result.code, null);
});

test("rejects implicit money and integer arithmetic", () => {
  const result = compileAAL(source.replace("单价 * 数量", "单价 + 数量"));
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.message.includes("运算 + 不支持类型")));
  assert.equal(result.code, null);
});

test("requires if conditions to be boolean", () => {
  const result = compileAAL(source.replace("数量 <= 0", "数量 + 1"));
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.message.includes("如果条件必须是布尔条件")));
  assert.equal(result.code, null);
});

test("checks flow input types and explicit state changes", () => {
  const badInput = compileAAL(source.replace("            单价\n            数量", "            单价\n            单价"));
  assert.ok(badInput.diagnostics.some((diagnostic) => diagnostic.message.includes("需要 整数")));
  assert.equal(badInput.code, null);

  const badChange = compileAAL(source.replace("库存 的 数量 = 库存 的 数量 - 数量", "数量 = 数量 - 数量"));
  assert.ok(badChange.diagnostics.some((diagnostic) => diagnostic.message.includes("改变必须明确指向对象的字段")));
  assert.equal(badChange.code, null);
});

test("executes generated TypeScript for success and failure paths", () => {
  const result = compileAAL(source, { binding });
  assert.ok(result.code);
  const root = mkdtempSync(join(tmpdir(), "determinant-test-"));
  const generatedPath = join(root, "order.ts");
  const outputDirectory = join(root, "out");
  writeFileSync(generatedPath, result.code, "utf8");
  execFileSync("tsc", ["--strict", "--target", "ES2022", "--module", "commonjs", "--moduleResolution", "node", "--skipLibCheck", "--outDir", outputDirectory, generatedPath], { stdio: "pipe" });
  const generated = createRequire(import.meta.url)(join(outputDirectory, "order.js"));
  const price = generated.money("CNY", "元", 2, "19.90");

  const inventory = { quantity: 5 };
  const success = generated.run({ order: { id: 1001 }, inventory, unitPrice: price, quantity: 2 });
  assert.equal(success.ok, true);
  assert.equal(success.value.orderId, 1001);
  assert.equal(generated.moneyValue(success.value.total), "39.80");
  assert.equal(success.value.remainingInventory, 3);
  assert.equal(inventory.quantity, 3);

  const insufficientInventory = { quantity: 1 };
  const insufficient = generated.run({ order: { id: 1001 }, inventory: insufficientInventory, unitPrice: price, quantity: 2 });
  assert.deepEqual(insufficient, { ok: false, error: "库存不足" });
  assert.equal(insufficientInventory.quantity, 1);

  const invalidQuantity = generated.run({ order: { id: 1001 }, inventory: { quantity: 5 }, unitPrice: price, quantity: 0 });
  assert.deepEqual(invalidQuantity, { ok: false, error: "数量必须大于零" });
});
