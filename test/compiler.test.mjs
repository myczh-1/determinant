import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { compileAAL, formatDiagnostic, parseAAL, parseBinding } from "../dist/index.js";

const source = readFileSync(new URL("../examples/order.aal", import.meta.url), "utf8");
const bindingSource = readFileSync(new URL("../bindings/order.binding.json", import.meta.url), "utf8");
const binding = parseBinding(bindingSource).spec;
assert.ok(binding);

test("parses and compiles the default English example", () => {
  const result = compileAAL(source, { binding });
  assert.equal(result.diagnostics.length, 0, result.diagnostics.map(formatDiagnostic).join("\n"));
  assert.ok(result.program);
  assert.equal(result.program.name, "OrderInventory");
  assert.equal(result.program.objects.length, 2);
  assert.equal(result.program.flows.length, 3);
  assert.ok(result.code?.includes("function calculateOrderTotal"));
  assert.ok(result.code?.includes("function createOrder"));
  assert.ok(result.code?.includes("export function run"));
});

test("Binding is optional while explicit English Binding preserves durable IDs and program names", () => {
  const implicit = compileAAL(source);
  assert.equal(implicit.diagnostics.length, 0, implicit.diagnostics.map(formatDiagnostic).join("\n"));
  assert.ok(implicit.code?.includes("function flow_2"));

  const explicit = compileAAL(source, { binding });
  assert.ok(explicit.code?.includes("export type Order"));
  assert.ok(explicit.code?.includes('"id": number'));
  assert.ok(explicit.code?.includes('"orderId"'));
  assert.ok(!explicit.code?.includes('"orderNumber"'));
});

test("English parsing and generation are deterministic", () => {
  assert.deepEqual(parseAAL(source), parseAAL(source));
  assert.equal(compileAAL(source, { binding }).code, compileAAL(source, { binding }).code);
});

test("rejects incomplete Binding coverage", () => {
  const incomplete = JSON.parse(bindingSource);
  incomplete.objects[0].fields = [];
  const result = compileAAL(source, { binding: incomplete });
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.message.includes("missing a binding")));
  assert.equal(result.code, null);
});

test("rejects implementation-style field access", () => {
  const result = compileAAL(source.replace("order's number", "order.number"));
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.message.includes("Unrecognized character")));
  assert.equal(result.code, null);
});

test("reports English semantic diagnostics", () => {
  const missing = compileAAL(source.replace("unitPrice * quantity", "unitPrice * missingQuantity"));
  assert.ok(missing.diagnostics.some((diagnostic) => diagnostic.message.includes("Undefined name: missingQuantity")));

  const arithmetic = compileAAL(source.replace("unitPrice * quantity", "unitPrice + quantity"));
  assert.ok(arithmetic.diagnostics.some((diagnostic) => diagnostic.message.includes("does not support types")));

  const condition = compileAAL(source.replace("quantity <= 0", "quantity + 1"));
  assert.ok(condition.diagnostics.some((diagnostic) => diagnostic.message.includes("must be Boolean")));
});

test("checks flow inputs and explicit state changes", () => {
  const badInput = compileAAL(source.replace("            unitPrice\n            quantity", "            unitPrice\n            unitPrice"));
  assert.ok(badInput.diagnostics.some((diagnostic) => diagnostic.message.includes("expected integer")));

  const badChange = compileAAL(source.replace("inventory's quantity = inventory's quantity - quantity", "quantity = quantity - quantity"));
  assert.ok(badChange.diagnostics.some((diagnostic) => diagnostic.message.includes("Change must target an object field")));
});

test("executes generated English TypeScript", () => {
  const result = compileAAL(source, { binding });
  assert.ok(result.code);
  const generated = compileGenerated(result.code);
  const price = generated.money("CNY", "yuan", 2, "19.90");

  const inventory = { quantity: 5 };
  const success = generated.run({ order: { id: 1001 }, inventory, unitPrice: price, quantity: 2 });
  assert.equal(success.ok, true);
  assert.equal(success.value.orderId, 1001);
  assert.equal(generated.moneyValue(success.value.total), "39.80");
  assert.equal(success.value.remainingInventory, 3);
  assert.equal(inventory.quantity, 3);

  const insufficientInventory = { quantity: 1 };
  const insufficient = generated.run({ order: { id: 1001 }, inventory: insufficientInventory, unitPrice: price, quantity: 2 });
  assert.deepEqual(insufficient, { ok: false, error: "insufficient inventory" });
  assert.equal(insufficientInventory.quantity, 1);

  const invalidQuantity = generated.run({ order: { id: 1001 }, inventory: { quantity: 5 }, unitPrice: price, quantity: 0 });
  assert.deepEqual(invalidQuantity, { ok: false, error: "quantity must be greater than zero" });
});

function compileGenerated(code) {
  const root = mkdtempSync(join(tmpdir(), "determinant-test-en-"));
  const generatedPath = join(root, "order.ts");
  const outputDirectory = join(root, "out");
  writeFileSync(generatedPath, code, "utf8");
  execFileSync("tsc", ["--strict", "--target", "ES2022", "--module", "commonjs", "--moduleResolution", "node", "--skipLibCheck", "--outDir", outputDirectory, generatedPath], { stdio: "pipe" });
  return createRequire(import.meta.url)(join(outputDirectory, "order.js"));
}
