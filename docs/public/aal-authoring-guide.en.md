# AAL Authoring Guide

## What AAL is

AAL (Auditable Application Language) is a formal application language intended for human review and deterministic execution.

AAL describes:

- data and state in the business world;
- calculations and conditions;
- explicit state changes;
- composition of business flows;
- successful outputs and explicit failures.

The confirmed AAL source is processed by a deterministic parser, semantic checker, and TypeScript/Node.js backend. The compiler does not ask an AI to infer missing business decisions.

## Rules for AI-generated AAL

1. Output AAL only. Do not output TypeScript, JavaScript, or pseudocode as AAL.
2. The user-facing language has only two top-level structures: `对象` (object) and `流程` (flow).
3. Use `的` for field relationships, for example `库存 的 数量`. Do not use dot access, brackets, `this`, or other implementation syntax.
4. Do not invent currencies, units, precision, fields, permissions, retries, concurrency, rollback, rounding, or error behavior.
5. Declare a type for every object field and flow input.
6. Use `改变` for real state changes. A calculation alone does not mutate an object.
7. Compose flows explicitly with `执行`, `使用`, and `得到`.
8. Ask the user when a requirement is ambiguous.
9. After the user confirms AAL, stop changing its business meaning. Deterministic tooling owns parsing, checking, and compilation.

## File structure

An AAL file starts with an application name. Top-level declarations are objects and flows:

```aal
应用：订单库存

对象：库存

    数量：整数

流程：检查库存

    输入：
        库存：库存
        数量：整数

    输出：
        剩余库存 = 库存 的 数量
```

Use four spaces for each indentation level. Blank lines and lines beginning with `#` are ignored.

## Objects and fields

Objects describe data and state. Fields are written directly under an object:

```aal
对象：订单

    编号：整数
```

Field relationships use `的`:

```text
订单 的 编号
订单 的 用户 的 姓名
```

## Types

P0 supports:

```text
整数
文本
布尔
人民币金额
美元金额
对象名称
```

An amount can specify its unit:

```aal
单价：人民币金额，单位为元
```

Currency, unit, and precision are business semantics. Do not write a generic `金额` and expect the compiler to guess its meaning.

## Flows

Flows describe business steps:

```aal
流程：扣减库存

    输入：
        库存：库存
        数量：整数

    如果 数量 <= 0：
        失败：数量必须大于零

    如果 库存 的 数量 < 数量：
        失败：库存不足

    改变：
        库存 的 数量 = 库存 的 数量 - 数量

    输出：
        剩余库存 = 库存 的 数量
```

`如果` must produce a Boolean condition. `失败` is an explicit flow failure. `改变` is the only P0 form that represents a real object state mutation.

## Calculations and flow composition

Name calculation results:

```aal
计算：
    总价 = 单价 * 数量
```

Compose another flow explicitly:

```aal
执行：
    计算订单总价

    使用：
        单价
        数量

    得到：
        总价
```

`使用` follows the declared input order. `得到` follows the declared output order. A failed executed flow propagates the same failure to the containing flow.

## Binding

The AAL surface uses audit names. A [Binding file](./binding-guide.en.md) maps those names to stable IDs and program-facing names such as `库存 → Inventory` and `数量 → quantity`.

Binding is a separate build input. It must not add hidden business rules.

## Complete example

The repository example is [examples/order.aal](../../examples/order.aal). It contains two objects and three flows: total calculation, inventory deduction, and order creation.

The current P0 compiler treats the last declared flow as the generated `run` entry. An explicit multi-entry protocol layer is intentionally left for a later design.

## Review checklist

- [ ] Are all top-level declarations objects or flows?
- [ ] Does every object field and flow input have a type?
- [ ] Are currency and unit explicit for every amount?
- [ ] Does every field relationship use `的`?
- [ ] Are all real state changes explicit under `改变`?
- [ ] Are all flow compositions explicit under `执行 / 使用 / 得到`?
- [ ] Are all failure conditions and messages explicit?
- [ ] Did the AI avoid inventing business decisions?
