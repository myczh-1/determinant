# Determinant

Determinant 是 AAL（Auditable Application Language，可审计应用语言）的确定性编译系统。

AAL 用 `对象` 和 `流程` 描述数据与业务流程；编译器负责确定性解析、语义检查，并生成可运行的 TypeScript/Node.js 程序。

```text
AAL 源文件 → AST → 语义检查 → TypeScript → Node.js
```

## 当前范围

当前仓库包含 P0 语言和编译闭环：

- 对象、类型字段；
- 流程、条件、计算、显式状态改变和流程组合；
- 确定性解析与语义诊断；
- 显式金额类型和基础运算；
- 绑定文件、稳定身份和程序名称；
- TypeScript 生成，以及订单库存成功和失败测试。

HTTP 层暂不属于当前范围，后续协议层会单独设计。

## 运行

```bash
npm test
npm run compile:example
```

示例会使用 [bindings/order.binding.json](bindings/order.binding.json)，并生成到被忽略的 `generated/order.ts`。

## 文档

- [AAL 编写指南](docs/public/aal-authoring-guide.md)
- [Binding 绑定指南](docs/public/binding-guide.md)
- [English README](README.md)
- [English public documentation](docs/public/README.en.md)

生成的 TypeScript 是构建产物。需要修改业务时修改 AAL，需要修改程序名称时修改 Binding，不要直接编辑生成文件。
