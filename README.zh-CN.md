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
- 可选 Binding、稳定身份和程序名称；
- TypeScript 生成，以及订单库存成功和失败测试。

HTTP 层暂不属于当前范围，后续协议层会单独设计。

## 运行

```bash
npm run test:zh
npm run compile:example:zh
```

默认方言和无后缀文件使用英文；中文源文件统一使用 `.zh-CN` 后缀，并通过 `--language zh-CN` 编译。中英文示例都提供显式 Binding。省略 `--binding` 时，编译器会为本次构建生成确定性后备绑定；如果 ID 和程序名称需要跨重命名或声明顺序变化保持稳定，应提供显式 Binding。

## 文档

- [AAL 编写指南](docs/public/aal-authoring-guide.zh-CN.md)
- [Binding 绑定指南](docs/public/binding-guide.zh-CN.md)
- [English README](README.md)
- [English public documentation](docs/public/README.md)

生成的 TypeScript 是构建产物。需要修改业务时修改 AAL，需要修改程序名称时修改 Binding，不要直接编辑生成文件。
