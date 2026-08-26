import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { compileAAL, formatDiagnostic } from "../dist/index.js";

const atomicSource = `应用：转账

对象：账户
    编号：整数
    余额：整数

    身份：
        编号

对象：转账记录
    编号：整数
    金额：整数

    身份：
        编号

流程：执行转账
    输入：
        来源账户：账户
        目标账户：账户
        转账编号：整数
        金额：整数

    如果 金额 <= 0：
        失败：金额必须大于零

    同时生效：
        改变：
            来源账户 的 余额 = 来源账户 的 余额 - 金额
            目标账户 的 余额 = 目标账户 的 余额 + 金额

        创建：
            转账：转账记录

            包含：
                转账 的 编号 = 转账编号
                转账 的 金额 = 金额

            否则：
                失败：转账已存在

    输出：
        来源余额 = 来源账户 的 余额
        目标余额 = 目标账户 的 余额
`;

const fixtureSource = `应用：退款数据

取值：订单状态
    未支付
    已支付

对象：订单
    编号：整数
    状态：订单状态
    金额：人民币金额
    支付时间：时间

    身份：
        编号

流程：读取订单
    输入：
        编号：整数

    查询：
        订单：订单

        条件：
            订单 的 编号 == 编号

        否则：
            失败：订单不存在

    输出：
        订单

HTTP 入口：读取订单
    接收：
        GET /orders/{id}

    使用流程：
        读取订单

    请求路径：
        id 作为 编号

    成功：
        返回 200

    如果 订单不存在：
        返回 404
`;

test("同时生效在创建失败时放弃所有暂存改变", () => {
  const result = compileAAL(atomicSource, { language: "zh-CN" });
  assert.equal(result.diagnostics.length, 0, result.diagnostics.map(formatDiagnostic).join("\n"));
  assert.ok(result.code);
  const application = compileGenerated(result.code, "atomic");
  application.resetStore();

  const firstSource = { 编号: 1, 余额: 100 };
  const firstTarget = { 编号: 2, 余额: 0 };
  assert.deepEqual(application.run({ 来源账户: firstSource, 目标账户: firstTarget, 转账编号: 10, 金额: 25 }), {
    ok: true,
    value: { 来源余额: 75, 目标余额: 25 },
  });

  const secondSource = { 编号: 3, 余额: 100 };
  const secondTarget = { 编号: 4, 余额: 0 };
  assert.deepEqual(application.run({ 来源账户: secondSource, 目标账户: secondTarget, 转账编号: 10, 金额: 40 }), {
    ok: false,
    error: "转账已存在",
  });
  assert.deepEqual(secondSource, { 编号: 3, 余额: 100 });
  assert.deepEqual(secondTarget, { 编号: 4, 余额: 0 });
});

test("同时生效拒绝查询等非提交步骤", () => {
  const invalid = atomicSource.replace(
    "改变：\n            来源账户 的 余额 = 来源账户 的 余额 - 金额\n            目标账户 的 余额 = 目标账户 的 余额 + 金额",
    "查询：\n            已有记录：转账记录\n\n            条件：\n                已有记录 的 编号 == 转账编号\n\n            否则：\n                失败：记录不存在",
  );
  const result = compileAAL(invalid, { language: "zh-CN" });
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.message.includes("同时生效当前只允许创建和改变")));
  assert.equal(result.code, null);
});

test("Fixture 完整验证后一次替换存储并保留审计字段编码", () => {
  const result = compileAAL(fixtureSource, { language: "zh-CN" });
  assert.equal(result.diagnostics.length, 0, result.diagnostics.map(formatDiagnostic).join("\n"));
  assert.ok(result.code);
  const application = compileGenerated(result.code, "fixture");

  application.loadFixture({
    订单: [{ 编号: 101, 状态: "已支付", 金额: "200.00", 支付时间: "2026-01-01T00:00:00.000Z" }],
  });
  assert.deepEqual(application.handleHttpRequest({ method: "GET", path: "/orders/101" }), {
    status: 200,
    body: { 订单: { 编号: 101, 状态: "已支付", 金额: "200.00", 支付时间: "2026-01-01T00:00:00.000Z" } },
  });

  assert.throws(() => application.loadFixture({
    订单: [
      { 编号: 102, 状态: "未支付", 金额: "10.00", 支付时间: "2026-01-01T00:00:00.000Z" },
      { 编号: 103, 状态: "未知状态", 金额: "10.00", 支付时间: "2026-01-01T00:00:00.000Z" },
    ],
  }), /Fixture 数据无效/);

  assert.equal(application.handleHttpRequest({ method: "GET", path: "/orders/101" }).status, 200);
  assert.equal(application.handleHttpRequest({ method: "GET", path: "/orders/102" }).status, 404);
});

test("Fixture 拒绝未知字段、重复身份和非规范时间", () => {
  const result = compileAAL(fixtureSource, { language: "zh-CN" });
  assert.ok(result.code);
  const application = compileGenerated(result.code, "fixture-invalid");

  assert.throws(() => application.loadFixture({ 订单: [{ 编号: 1, 状态: "已支付", 金额: "1.00", 支付时间: "2026-01-01T00:00:00Z", 额外: true }] }), /Fixture 数据无效/);
  assert.throws(() => application.loadFixture({ 订单: [
    { 编号: 1, 状态: "已支付", 金额: "1.00", 支付时间: "2026-01-01T00:00:00.000Z" },
    { 编号: 1, 状态: "未支付", 金额: "1.00", 支付时间: "2026-01-01T00:00:00.000Z" },
  ] }), /duplicate/);
  assert.throws(() => application.loadFixture({ 订单: [{ 编号: 1, 状态: "已支付", 金额: "1.00", 支付时间: "2026-01-01T00:00:00Z" }] }), /Fixture 数据无效/);
});

test("现有英文 CRUD 应用也可以从审计名称 Fixture 启动", () => {
  const source = readFileSync(new URL("../examples/items/app.aal", import.meta.url), "utf8");
  const result = compileAAL(source);
  assert.ok(result.code);
  const application = compileGenerated(result.code, "fixture-items");
  application.loadFixture({ Item: [{ id: 7, name: "Fixture item" }] });
  assert.equal(application.handleHttpRequest({ method: "GET", path: "/items/7" }).status, 200);
});

test("CLI 可以携带 Fixture 和冻结时钟启动服务", async () => {
  const root = mkdtempSync(join(tmpdir(), "determinant-cli-fixture-"));
  const fixturePath = join(root, "fixture.json");
  writeFileSync(fixturePath, JSON.stringify({ Item: [{ id: 7, name: "CLI fixture" }] }), "utf8");
  const child = spawn(process.execPath, [
    "bin/determinant.mjs",
    "run",
    "examples/items/app.aal",
    "--host",
    "127.0.0.1",
    "--port",
    "0",
    "--fixture",
    fixturePath,
    "--clock",
    "2026-01-08T00:00:00.000Z",
  ], {
    cwd: new URL("..", import.meta.url),
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    const port = await waitForPort(child);
    const response = await fetch(`http://127.0.0.1:${port}/items/7`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { item: { id: 7, name: "CLI fixture" } });
  } finally {
    child.kill("SIGTERM");
  }
});

function compileGenerated(code, name) {
  const root = mkdtempSync(join(tmpdir(), `determinant-${name}-`));
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
      const match = /HTTP server listening at http:\/\/127\.0\.0\.1:(\d+)/u.exec(stdout);
      if (match) {
        clearTimeout(timeout);
        resolve(Number(match[1]));
      }
    });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("exit", (code) => {
      if (code !== null && !/HTTP server listening/u.test(stdout)) {
        clearTimeout(timeout);
        reject(new Error(`HTTP server exited with ${code}. ${stderr}`));
      }
    });
  });
}
