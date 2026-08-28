# R0：Go 工具链迁移基线

## 目的

`refactor/go-toolchain` 从 `main@c05b619` 开始。旧 TypeScript/Node 实现继续保留在原位置，作为行为参考；本阶段不改变 AAL 语言语义。

R0 的验收对象不是旧实现的内部 AST 结构，而是：

```text
AAL 源文件
→ 接受或拒绝
→ 诊断位置与类别
→ 规范化 ProgramModel
→ 生成源码
→ HTTP 可观察行为
```

基线索引位于 `tests/fixtures/manifest.json`。`tests/fixtures/valid`、`invalid` 和 `expected` 是后续迁移切片的落点；在转换完成前，现有示例和 Node 测试保持唯一参考来源，避免复制出两套可能漂移的 AAL 源文件。

## 已验证基线

在 `c05b6194b89715540666428fb3ded25ae40e5b20` 上：

```bash
npm test
npm run test:order-refund:composed-flow
npm run compile:example
npm run compile:example:zh
```

结果：

- 全量测试 69/69 通过；
- 可组合订单退款 Oracle 24/24 通过；
- 英文和中文订单示例均成功生成 TypeScript；
- 订单退款 Fixture 摘要为 `sha256:e0e942f474af7f7f0a5b0df85ae41d3404420e507993eb4f97ab9f280cc092b2`；
- 测试时钟为 `2026-01-08T00:00:00.000Z`。

## 语义覆盖

迁移必须覆盖当前已经实现的能力，而不是只覆盖最小库存示例：

- 英文和 `zh-CN` 方言；
- 对象、身份、创建、单对象查询、改变和删除；
- 流程组合、条件步骤和失败传播；
- 整数、文本、布尔、金额、时间、持续时间和封闭取值；
- 原子创建/改变和 Fixture 加载；
- HTTP 路径、请求体、系统时间、成功状态和失败映射；
- 可选 Binding、稳定身份和程序名称；
- 订单退款稳定版与可组合流程版；
- 确定性生成和冻结 HTTP Oracle 行为。

## 迁移 Gate

Go 版本逐步满足：

1. 接受/拒绝结果一致；
2. 诊断类别和源位置正确，文案不要求逐字一致；
3. ProgramModel 规范化结果稳定；
4. Go Backend 生成结果可复现；
5. TypeScript Backend 保持既有行为；
6. HTTP 外部行为一致；
7. 同一输入重复构建得到相同结果；
8. `determinant run` 可将 AAL 生成临时 Go 源码并调用系统 Go 工具链；
9. Windows、macOS、Linux CLI 可以构建；
10. Observer Plugin 协议可以读取 ProgramModel 且不改变程序行为。

在全部 Gate 通过前，不删除旧 Node 实现。

本阶段的 Gate 不包含 Mermaid、完整 Semantic Plugin、内置 Go/Node/Bun
运行时或 CLI 改名。它们分别属于后续 `feature/workbench`、
`feature/semantic-plugins` 或发布阶段的独立决策。

## 当前分支进度

截至 `refactor/go-toolchain` 当前 HEAD，已用现有 English/`zh-CN` 样例覆盖并验证：

- G1/G2：解析接受/拒绝、主要语义错误类别和源位置；
- G3：ProgramModel 稳定序列化；
- G4/G7：Go 和 TypeScript 生成可重复，Go 示例可构建；
- G5/G6：当前 Todo/订单退款样例的生成与 HTTP 运行路径；
- G8：`determinant run` 通过系统 Go 工具链启动、加载 Fixture 和使用冻结时钟；
- G9：Go CLI 的 macOS、Linux、Windows 交叉构建；
- G10：Observer JSON Lines 协议往返测试。

参考实现文件、冻结输入、Fixture、生成物和参考测试的摘要由
`npm run verify:baseline` 复核；Go 迁移阶段的统一验收入口是
`npm run test:migration`。

诊断 Gate 对齐接受/拒绝结果、诊断类别和源位置，不要求旧实现的错误文案逐字一致。
TypeScript 目标在本阶段通过 `build` 生成并验证行为；`run` 的迁移目标是 Go。
