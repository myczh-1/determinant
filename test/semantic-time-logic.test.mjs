import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { compileAAL, formatDiagnostic } from "../dist/index.js";

const source = `应用：时间规则

对象：计数器
    数量：整数

流程：读取操作时间
    输入：
        操作时间：时间

    计算：
        截止时间 = 操作时间 + 7 天

    输出：
        操作时间
        截止时间

流程：按条件改变
    输入：
        计数器：计数器
        普通用户：布尔
        操作时间：时间
        支付时间：时间

    如果 普通用户 并且 操作时间 > 支付时间 + 7 天：
        失败：已超过期限

    如果 非 普通用户：
        改变：
            计数器 的 数量 = 计数器 的 数量 + 1

    输出：
        数量 = 计数器 的 数量

HTTP 入口：读取操作时间
    接收：
        GET /clock

    使用流程：
        读取操作时间

    系统提供：
        当前时间 作为 操作时间

    成功：
        返回 200
`;

const englishSource = `application: TimeRules

object: Counter
    quantity: integer

flow: ApplyRule
    input:
        counter: Counter
        normalUser: boolean
        operationTime: time
        paidAt: time

    if normalUser and operationTime > paidAt + 7 days:
        failure: expired

    if not normalUser:
        change:
            counter's quantity = counter's quantity + 1

    output:
        quantity = counter's quantity

flow: ReadClock
    input:
        operationTime: time

    output:
        operationTime

HTTP entry: ReadClock
    receive:
        GET /clock

    use flow:
        ReadClock

    system provided:
        current time as operationTime

    success:
        return 200
`;

test("可信时钟由 HTTP Runtime 注入并使用 UTC 编码", () => {
  const result = compileAAL(source, { language: "zh-CN" });
  assert.equal(result.diagnostics.length, 0, result.diagnostics.map(formatDiagnostic).join("\n"));
  assert.ok(result.code);
  const application = compileGenerated(result.code, "time-context");

  assert.deepEqual(
    application.handleHttpRequest(
      { method: "GET", path: "/clock" },
      { now: () => "2026-01-08T00:00:00.000Z" },
    ),
    {
      status: 200,
      body: {
        操作时间: "2026-01-08T00:00:00.000Z",
        截止时间: "2026-01-15T00:00:00.000Z",
      },
    },
  );
});

test("逻辑守卫和条件业务步骤按声明顺序运行", () => {
  const result = compileAAL(source, { language: "zh-CN" });
  assert.ok(result.code);
  const application = compileGenerated(result.code, "conditional-change");
  const paidAt = application.time("2026-01-01T00:00:00.000Z");

  const expiredCounter = { 数量: 0 };
  assert.deepEqual(application.run({
    计数器: expiredCounter,
    普通用户: true,
    操作时间: application.time("2026-01-08T00:00:00.001Z"),
    支付时间: paidAt,
  }), { ok: false, error: "已超过期限" });
  assert.equal(expiredCounter.数量, 0);

  const boundaryCounter = { 数量: 0 };
  assert.deepEqual(application.run({
    计数器: boundaryCounter,
    普通用户: true,
    操作时间: application.time("2026-01-08T00:00:00.000Z"),
    支付时间: paidAt,
  }), { ok: true, value: { 数量: 0 } });

  const adminCounter = { 数量: 0 };
  assert.deepEqual(application.run({
    计数器: adminCounter,
    普通用户: false,
    操作时间: application.time("2026-02-01T00:00:00.000Z"),
    支付时间: paidAt,
  }), { ok: true, value: { 数量: 1 } });
  assert.equal(adminCounter.数量, 1);
});

test("英文时间、逻辑和系统输入映射到同一 AST", () => {
  const result = compileAAL(englishSource);
  assert.equal(result.diagnostics.length, 0, result.diagnostics.map(formatDiagnostic).join("\n"));
  assert.equal(result.program?.httpEntries[0].systemMappings[0].source, "current-time");
  assert.equal(result.program?.flows[0].statements[0].kind, "if");
  assert.equal(result.program?.flows[0].statements[1].kind, "conditional");
});

test("系统当前时间只能提供给时间输入", () => {
  const result = compileAAL(source.replace("操作时间：时间", "操作时间：整数"), { language: "zh-CN" });
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.message.includes("当前时间只能映射到时间输入")));
  assert.equal(result.code, null);
});

test("条件区块中的局部计算不会泄漏到流程输出", () => {
  const invalid = source.replace(
    "改变：\n            计数器 的 数量 = 计数器 的 数量 + 1",
    "计算：\n            临时数量 = 计数器 的 数量 + 1",
  ).replace("数量 = 计数器 的 数量", "数量 = 临时数量");
  const result = compileAAL(invalid, { language: "zh-CN" });
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.message.includes("引用了未定义的名称：临时数量")));
  assert.equal(result.code, null);
});

function compileGenerated(code, name) {
  const root = mkdtempSync(join(tmpdir(), `determinant-${name}-`));
  const generatedPath = join(root, "application.ts");
  const outputDirectory = join(root, "out");
  writeFileSync(generatedPath, code, "utf8");
  execFileSync("tsc", ["--strict", "--target", "ES2022", "--module", "commonjs", "--moduleResolution", "node", "--skipLibCheck", "--outDir", outputDirectory, generatedPath], { stdio: "pipe" });
  return createRequire(import.meta.url)(join(outputDirectory, "application.js"));
}
