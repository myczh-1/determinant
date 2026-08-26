import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { compileAAL, formatDiagnostic } from "../dist/index.js";

const chineseSource = `应用：账单服务

取值：付款状态
    待支付
    已支付

对象：账单
    编号：整数
    状态：付款状态
    金额：人民币金额

    身份：
        编号

流程：创建账单
    输入：
        编号：整数
        金额：人民币金额

    如果 金额 <= 0.00 元：
        失败：金额必须大于零

    计算：
        含手续费金额 = 金额 + 1.00 元

    创建：
        账单：账单

        包含：
            账单 的 编号 = 编号
            账单 的 状态 = 待支付
            账单 的 金额 = 金额

        否则：
            失败：账单已存在

    输出：
        账单
        含手续费金额

HTTP 入口：创建账单
    接收：
        POST /bills

    使用流程：
        创建账单

    请求体：
        id 作为 编号
        amount 作为 金额

    成功：
        返回 201

    如果 金额必须大于零：
        返回 400

    如果 账单已存在：
        返回 409
`;

const englishSource = `application: Billing

values: PaymentStatus
    Pending
    Paid

object: Bill
    id: integer
    status: PaymentStatus
    amount: CNY amount

    identity:
        id

flow: CreateBill
    input:
        id: integer
        amount: CNY amount

    if amount <= 0.00 CNY:
        failure: amount must be positive

    create:
        bill: Bill

        with:
            bill's id = id
            bill's status = Pending
            bill's amount = amount

        otherwise:
            failure: bill already exists

    output:
        bill
`;

test("中文领域取值和金额常量通过共享编译链运行", () => {
  const result = compileAAL(chineseSource, { language: "zh-CN" });
  assert.equal(result.diagnostics.length, 0, result.diagnostics.map(formatDiagnostic).join("\n"));
  assert.ok(result.program);
  assert.equal(result.program.valueSets.length, 1);
  assert.equal(result.program.valueSets[0].name, "付款状态");
  assert.ok(result.code);

  const application = compileGenerated(result.code, "values-money-zh");
  application.resetStore();
  assert.deepEqual(application.handleHttpRequest({ method: "POST", path: "/bills", body: { id: 1, amount: "10.10" } }), {
    status: 201,
    body: {
      账单: { 编号: 1, 状态: "待支付", 金额: "10.10" },
      含手续费金额: "11.10",
    },
  });
});

test("HTTP 金额只接受固定两位小数的十进制字符串", () => {
  const result = compileAAL(chineseSource, { language: "zh-CN" });
  assert.ok(result.code);
  const application = compileGenerated(result.code, "money-http-codec");

  for (const amount of [10, "10", "10.1", "10.100", "1e1", "￥10.00", "01.00"]) {
    application.resetStore();
    assert.equal(application.handleHttpRequest({ method: "POST", path: "/bills", body: { id: 1, amount } }).status, 400, String(amount));
  }

  application.resetStore();
  assert.deepEqual(application.handleHttpRequest({ method: "POST", path: "/bills", body: { id: 1, amount: "0.00" } }), {
    status: 400,
    body: { error: "金额必须大于零" },
  });
});

test("领域取值不是任意文本且不同取值类型不能比较", () => {
  const unknown = compileAAL(chineseSource.replace("账单 的 状态 = 待支付", "账单 的 状态 = 不存在的状态"), { language: "zh-CN" });
  assert.ok(unknown.diagnostics.some((diagnostic) => diagnostic.message.includes("引用了未定义的名称：不存在的状态")));
  assert.equal(unknown.code, null);

  const incompatible = compileAAL(
    chineseSource
      .replace("对象：账单", "取值：开关状态\n    开启\n    关闭\n\n对象：账单")
      .replace("金额 <= 0.00 元", "待支付 == 开启"),
    { language: "zh-CN" },
  );
  assert.ok(incompatible.diagnostics.some((diagnostic) => diagnostic.message.includes("比较两侧类型不兼容")));
  assert.equal(incompatible.code, null);
});

test("英文方言映射到相同的取值和金额 AST", () => {
  const result = compileAAL(englishSource);
  assert.equal(result.diagnostics.length, 0, result.diagnostics.map(formatDiagnostic).join("\n"));
  assert.equal(result.program?.valueSets[0].name, "PaymentStatus");
  assert.ok(result.code?.includes('"Pending" | "Paid"'));
});

test("取值与金额生成保持确定性", () => {
  assert.equal(
    compileAAL(chineseSource, { language: "zh-CN" }).code,
    compileAAL(chineseSource, { language: "zh-CN" }).code,
  );
});

function compileGenerated(code, name) {
  const root = mkdtempSync(join(tmpdir(), `determinant-${name}-`));
  const generatedPath = join(root, "application.ts");
  const outputDirectory = join(root, "out");
  writeFileSync(generatedPath, code, "utf8");
  execFileSync("tsc", ["--strict", "--target", "ES2022", "--module", "commonjs", "--moduleResolution", "node", "--skipLibCheck", "--outDir", outputDirectory, generatedPath], { stdio: "pipe" });
  return createRequire(import.meta.url)(join(outputDirectory, "application.js"));
}
