import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { beforeEach } from "node:test";
import { compileAAL, formatDiagnostic } from "../dist/index.js";

const language = "zh-CN";
const sourcePath = process.env.DETERMINANT_ORDER_REFUND_AAL ?? "examples/order-refund/app.zh-CN.aal";
const source = readFileSync(new URL(`../${sourcePath}`, import.meta.url), "utf8");
const fixtureBytes = readFileSync(new URL("../examples/order-refund/fixture.v1.json", import.meta.url));
const fixtureDigest = `sha256:${createHash("sha256").update(fixtureBytes).digest("hex")}`;
const baseFixture = JSON.parse(fixtureBytes.toString("utf8"));
const compiled = compileAAL(source, { language });
assert.equal(compiled.diagnostics.length, 0, compiled.diagnostics.map(formatDiagnostic).join("\n"));
assert.ok(compiled.code);
const application = compileGenerated(compiled.code);

const DAY_7 = "2026-01-08T00:00:00.000Z";
const AFTER_DAY_7 = "2026-01-08T00:00:00.001Z";

beforeEach(() => {
  application.loadFixture(structuredClone(baseFixture));
});

test("domain-invalid-status and domain-invalid-role", () => {
  const invalidStatus = structuredClone(baseFixture);
  invalidStatus.订单[0].状态 = "未知状态";
  assert.throws(() => application.loadFixture(invalidStatus), /Fixture 数据无效/);

  const invalidRole = structuredClone(baseFixture);
  invalidRole.用户[0].角色 = "访客";
  assert.throws(() => application.loadFixture(invalidRole), /Fixture 数据无效/);
});

test("pay-order-not-found has priority over valid negative business input", () => {
  assertResponse(pay(999, "-1.00"), 404, "订单不存在");
});

test("pay-wrong-state and pay-twice", () => {
  assertResponse(pay(102, "200.00"), 409, "订单状态不允许支付");
  assert.equal(pay(101, "200.00").status, 200);
  assertResponse(pay(101, "200.00"), 409, "订单状态不允许支付");
});

test("pay-zero, pay-negative, and pay-amount-mismatch", () => {
  assertResponse(pay(101, "0.00"), 400, "支付金额必须大于零");
  assertResponse(pay(101, "-1.00"), 400, "支付金额必须大于零");
  assertResponse(pay(101, "100.00"), 409, "支付金额与订单应付金额不一致");
});

test("pay-success records the frozen clock and creates readable payment state", () => {
  assert.deepEqual(pay(101, "200.00"), {
    status: 200,
    body: {
      订单编号: 101,
      订单状态: "已支付",
      支付金额: "200.00",
      支付时间: DAY_7,
    },
  });
  assert.deepEqual(refundable(101), {
    status: 200,
    body: { 订单编号: 101, 可退款金额: "200.00", 可退款数量: 2 },
  });
});

test("pay-atomic-failure leaves the order unpaid", () => {
  const fixture = structuredClone(baseFixture);
  fixture.支付记录.push({ 订单编号: 101, 支付金额: "200.00", 支付时间: "2026-01-01T00:00:00.000Z" });
  application.loadFixture(fixture);
  assertResponse(pay(101, "200.00"), 500, "支付数据不一致");
  assert.deepEqual(cancel(101), {
    status: 200,
    body: { 订单编号: 101, 订单状态: "已取消", 库存数量: 12 },
  });
});

test("pay-inventory-unchanged", () => {
  assert.equal(pay(101, "200.00").status, 200);
  const result = refund(101, { userId: 1, amount: "200.00", quantity: 2 });
  assert.equal(result.status, 200);
  assert.equal(result.body.库存数量, 12);
});

test("cancel-order-not-found and cancel-paid", () => {
  assertResponse(cancel(999), 404, "订单不存在");
  assertResponse(cancel(102), 409, "订单状态不允许取消");
});

test("cancel-unpaid restocks the full quantity exactly once", () => {
  assert.deepEqual(cancel(101), {
    status: 200,
    body: { 订单编号: 101, 订单状态: "已取消", 库存数量: 12 },
  });
  assert.deepEqual(cancel(101), {
    status: 200,
    body: { 订单编号: 101, 订单状态: "已取消", 库存数量: 12 },
  });
});

test("cancel detects missing inventory after state validation", () => {
  const fixture = structuredClone(baseFixture);
  fixture.商品库存 = fixture.商品库存.filter((item) => item.商品编号 !== 1001);
  application.loadFixture(fixture);
  assertResponse(cancel(101), 500, "库存数据不一致");
});

test("refund-missing-order-negative-input and refund-wrong-state", () => {
  assertResponse(refund(999, { userId: 999, amount: "-1.00", quantity: -1 }), 404, "订单不存在");
  assertResponse(refund(101, { userId: 1, amount: "-1.00", quantity: -1 }), 409, "订单状态不允许退款");
  assertResponse(refund(105, { userId: 1, amount: "100.00", quantity: 1 }), 409, "订单状态不允许退款");
});

test("refund detects missing payment, inventory, and user in order", () => {
  const missingPayment = structuredClone(baseFixture);
  missingPayment.支付记录 = missingPayment.支付记录.filter((item) => item.订单编号 !== 102);
  application.loadFixture(missingPayment);
  assertResponse(refund(102, { userId: 999, amount: "-1.00", quantity: -1 }), 500, "支付数据不一致");

  const missingInventory = structuredClone(baseFixture);
  missingInventory.商品库存 = missingInventory.商品库存.filter((item) => item.商品编号 !== 1002);
  application.loadFixture(missingInventory);
  assertResponse(refund(102, { userId: 999, amount: "-1.00", quantity: -1 }), 500, "库存数据不一致");

  application.loadFixture(structuredClone(baseFixture));
  assertResponse(refund(102, { userId: 999, amount: "-1.00", quantity: -1 }), 404, "用户不存在");
});

test("refund-normal-day-6 and refund-normal-day-7 are allowed; one millisecond later is rejected", () => {
  assert.equal(refund(102, { userId: 1, amount: "100.00", quantity: 1 }, "2026-01-07T00:00:00.000Z").status, 200);
  application.loadFixture(structuredClone(baseFixture));
  assert.equal(refund(102, { userId: 1, amount: "100.00", quantity: 1 }, DAY_7).status, 200);
  application.loadFixture(structuredClone(baseFixture));
  assertResponse(refund(102, { userId: 1, amount: "100.00", quantity: 1 }, AFTER_DAY_7), 403, "已超过普通用户退款期限");
});

test("refund-admin-after-day-7", () => {
  assert.equal(refund(102, { userId: 2, amount: "100.00", quantity: 1 }, "2026-02-01T00:00:00.000Z").status, 200);
});

test("refund validation priority: time, quantity, amount, relation", () => {
  assertResponse(refund(102, { userId: 1, amount: "-1.00", quantity: -1 }, AFTER_DAY_7), 403, "已超过普通用户退款期限");
  assertResponse(refund(102, { userId: 1, amount: "-1.00", quantity: 0 }), 400, "退款数量必须大于零");
  assertResponse(refund(102, { userId: 1, amount: "100.00", quantity: -1 }), 400, "退款数量必须大于零");
  assertResponse(refund(102, { userId: 1, amount: "0.00", quantity: 1 }), 400, "退款金额必须大于零");
  assertResponse(refund(102, { userId: 1, amount: "-1.00", quantity: 1 }), 400, "退款金额必须大于零");
  assertResponse(refund(102, { userId: 1, amount: "50.00", quantity: 1 }), 400, "退款金额与退款数量不一致");
});

test("refund-quantity-exceeds and refund-amount-exceeds", () => {
  assertResponse(refund(102, { userId: 1, amount: "300.00", quantity: 3 }), 409, "退款数量超过可退款数量");

  const fixture = structuredClone(baseFixture);
  fixture.支付记录.find((item) => item.订单编号 === 103).支付金额 = "150.00";
  application.loadFixture(fixture);
  assertResponse(refund(103, { userId: 1, amount: "100.00", quantity: 1 }), 409, "退款金额超过可退款金额");
});

test("refund-partial updates amount, quantity, inventory, and keeps paid state", () => {
  assert.deepEqual(refund(102, { userId: 1, amount: "100.00", quantity: 1 }), {
    status: 200,
    body: {
      订单编号: 102,
      订单状态: "已支付",
      本次退款金额: "100.00",
      累计退款金额: "100.00",
      本次回补数量: 1,
      库存数量: 11,
    },
  });
  assert.deepEqual(refundable(102), {
    status: 200,
    body: { 订单编号: 102, 可退款金额: "100.00", 可退款数量: 1 },
  });
});

test("refund-two-partials reaches the full-refund state once", () => {
  assert.equal(refund(103, { userId: 1, amount: "100.00", quantity: 1 }).body.订单状态, "已支付");
  const full = refund(103, { userId: 1, amount: "100.00", quantity: 1 });
  assert.equal(full.status, 200);
  assert.equal(full.body.订单状态, "已全部退款");
  assert.equal(full.body.累计退款金额, "300.00");
  assert.equal(full.body.库存数量, 22);
  assertResponse(refund(103, { userId: 1, amount: "100.00", quantity: 1 }), 409, "订单状态不允许退款");
});

test("refund-exact-full", () => {
  const result = refund(102, { userId: 1, amount: "200.00", quantity: 2 });
  assert.equal(result.status, 200);
  assert.equal(result.body.订单状态, "已全部退款");
  assert.equal(result.body.累计退款金额, "200.00");
  assert.equal(result.body.库存数量, 12);
});

test("refund-failure-atomicity", () => {
  assertResponse(refund(107, { userId: 1, amount: "50.00", quantity: 1 }), 400, "退款金额与退款数量不一致");
  assert.deepEqual(refund(107, { userId: 1, amount: "100.00", quantity: 1 }), {
    status: 200,
    body: {
      订单编号: 107,
      订单状态: "已支付",
      本次退款金额: "100.00",
      累计退款金额: "100.00",
      本次回补数量: 1,
      库存数量: 51,
    },
  });
});

test("refundable-initial, refundable-unpaid, and refundable-full", () => {
  assert.deepEqual(refundable(102), {
    status: 200,
    body: { 订单编号: 102, 可退款金额: "200.00", 可退款数量: 2 },
  });
  assertResponse(refundable(101), 409, "订单当前不可退款");
  assertResponse(refundable(105), 409, "订单当前不可退款");
  assertResponse(refundable(999), 404, "订单不存在");

  const missingPayment = structuredClone(baseFixture);
  missingPayment.支付记录 = missingPayment.支付记录.filter((item) => item.订单编号 !== 102);
  application.loadFixture(missingPayment);
  assertResponse(refundable(102), 500, "支付数据不一致");
});

test("transport validation is deterministic and precedes business flow", () => {
  assert.deepEqual(request("POST", "/orders/101/pay", {}), { status: 400, body: { error: "缺少字段：amount" } });
  assert.deepEqual(request("POST", "/orders/101/pay", { amount: 200 }), { status: 400, body: { error: "金额格式错误：amount" } });
  assert.deepEqual(request("POST", "/orders/101/refund", { userId: "1", amount: "100.00", quantity: 1 }), { status: 400, body: { error: "字段类型错误：userId" } });
  assert.deepEqual(request("POST", "/orders/101/refund", { userId: 1, amount: "100.00" }), { status: 400, body: { error: "缺少字段：quantity" } });
  assert.deepEqual(request("GET", "/unknown"), { status: 404, body: { error: "Not found" } });
});

test("real HTTP shell uses the frozen fixture, clock, and invalid-JSON contract", async (context) => {
  const child = spawn(process.execPath, [
    "bin/determinant.mjs",
    "run",
    sourcePath,
    "--language",
    "zh-CN",
    "--host",
    "127.0.0.1",
    "--port",
    "0",
    "--fixture",
    "examples/order-refund/fixture.v1.json",
    "--clock",
    DAY_7,
  ], {
    cwd: new URL("..", import.meta.url),
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    const port = await waitForPort(child);
    const invalid = await fetch(`http://127.0.0.1:${port}/orders/101/pay`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{bad",
    });
    assert.equal(invalid.status, 400);
    assert.deepEqual(await invalid.json(), { error: "请求 JSON 无效" });

    const readable = await fetch(`http://127.0.0.1:${port}/orders/102/refundable`);
    assert.equal(readable.status, 200);
    assert.deepEqual(await readable.json(), { 订单编号: 102, 可退款金额: "200.00", 可退款数量: 2 });
    context.diagnostic(JSON.stringify({
      fixture: {
        path: "examples/order-refund/fixture.v1.json",
        digest: fixtureDigest,
      },
      clock: DAY_7,
    }));
  } finally {
    child.kill("SIGTERM");
  }
});

test("same AAL produces the same generated program", () => {
  assert.equal(compiled.code, compileAAL(source, { language }).code);
});

function request(method, path, body, now = DAY_7) {
  return application.handleHttpRequest({ method, path, body }, { now: () => now });
}

function pay(id, amount, now = DAY_7) {
  return request("POST", `/orders/${id}/pay`, { amount }, now);
}

function cancel(id) {
  return request("POST", `/orders/${id}/cancel`);
}

function refund(id, body, now = DAY_7) {
  return request("POST", `/orders/${id}/refund`, body, now);
}

function refundable(id) {
  return request("GET", `/orders/${id}/refundable`);
}

function assertResponse(response, status, error) {
  assert.deepEqual(response, { status, body: { error } });
}

function compileGenerated(code) {
  const root = mkdtempSync(join(tmpdir(), "determinant-order-refund-oracle-"));
  const generatedPath = join(root, "application.ts");
  const outputDirectory = join(root, "out");
  writeFileSync(generatedPath, code, "utf8");
  execFileSync("tsc", ["--strict", "--target", "ES2022", "--module", "commonjs", "--moduleResolution", "node", "--skipLibCheck", "--outDir", outputDirectory, generatedPath], { stdio: "pipe" });
  return createRequire(import.meta.url)(join(outputDirectory, "application.js"));
}

function waitForPort(child) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => reject(new Error(`HTTP server did not start. ${stderr}`)), 10_000);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      const match = /127\.0\.0\.1:(\d+)/u.exec(stdout);
      if (match) {
        clearTimeout(timeout);
        resolve(Number(match[1]));
      }
    });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("exit", (code) => {
      if (code !== null && !/127\.0\.0\.1:\d+/u.test(stdout)) {
        clearTimeout(timeout);
        reject(new Error(`HTTP server exited with ${code}. ${stderr}`));
      }
    });
  });
}
