# AI Coding Guide

## Project Summary

Determinant 是 AAL（Auditable Application Language）的确定性应用编译系统。AAL 是应用程序的正式源语言，不是普通需求文档，也不是传统编程语言的中文翻译。

当前 P0 用对象和流程表达订单库存业务，经 AST 和语义检查后确定性生成 TypeScript/Node.js。

## Source Of Truth

产品和范围来源：

- `docs/project-goal.zh-CN.md`
- `docs/product-spec.zh-CN.md`
- `docs/feature-list.zh-CN.md`
- `docs/ultimate-goals.zh-CN.md`
- `docs/public/aal-authoring-guide.zh-CN.md`

生成中文 AAL 时必须额外遵守 `docs/public/aal-authoring-guide.zh-CN.md`。如果实现与这些文档冲突，先报告冲突，不要自行扩大范围。

## Engineering Principle

自然语言到 AAL 可以由 AI 协助；AAL 确认后，解析、检查、编译和测试必须是确定性的。编译器可以隐藏实现细节，但不能隐藏币种、单位、精度、权限、重试、并发、回滚、舍入或错误处理等业务决定。

## Current Priority

维护并验证 P0 最小闭环：

1. 保持用户层只有对象、流程和 HTTP 入口；
2. 保持字段关系使用“的”，状态变化使用“改变”；
3. 保持 `执行 / 使用 / 得到` 的输入输出检查；
4. 保持名称、字段、类型、金额单位和条件检查；
5. 保持 Binding 可选；提供时必须完整覆盖对象、字段、流程、输入和输出；
6. 保持 TypeScript 生成结果可复现；
7. 用订单库存样例验证成功、失败和实际状态变化；
8. HTTP 只保持当前 CRUD MVP，不扩张 SQLite、TCP、WebSocket、鉴权或 UI。

## Rules For AI Assistants

- 开始编码前阅读上述来源文档。
- 不要把 AAL 写成 TypeScript、JavaScript 或伪代码。
- 不要在用户层使用方法、行为、调用、自身、点号字段访问或隐式返回值等程序组织概念。
- 需求不明确时提问，不要猜测字段、类型、金额单位、重试、并发、权限或回滚策略。
- 业务状态修改必须通过显式 `改变` 表达。
- Binding 只能绑定名称和结构，不能偷偷加入业务规则。
- Binding 创建或变化必须作为独立审计对象处理。
- 生成代码是编译产物，不要求用户手工维护。
- 优先编写小而可验证的测试，再增加语言能力。
- 产品决策改变时先更新文档，再修改实现。

## Verification

```bash
npm test
npm run compile:example
npm run test:zh
npm run compile:example:zh
npm run demo:http
npm run benchmark:run
```

生成的 TypeScript 还应通过严格类型检查，并验证订单库存样例的成功、库存不足、数量无效和库存对象变化。
