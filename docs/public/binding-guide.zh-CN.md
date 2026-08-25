# Binding 绑定指南

> 默认英文版本：[Binding Guide](./binding-guide.md)

## 作用

Binding 是以下三者之间可选但明确的绑定层：

```text
人类可读的审计名称
稳定内部 ID
程序名称
```

例如：

```text
审计对象：订单
稳定 ID：object_order
程序对象：Order

审计字段：编号
稳定 ID：field_order_number
程序字段：id
```

AAL 可以继续写 `订单 的 编号`，生成的 TypeScript 则使用 `order.id`。编译器不会猜测这两个名称指向同一个字段。

## 可选不等于没有价值

不提供 Binding 文件时，编译器会按照当前源文件的声明顺序，为本次构建生成确定性后备绑定。

这个后备方案适合实验，但不是持久身份契约。源文件重命名或调整声明顺序后，自动生成的 ID 或程序名称可能变化。

以下情况应使用显式 Binding：

- ID 需要跨审计名称变化保持稳定；
- 生成的 TypeScript 名称属于需要维护的接口；
- 英文审计名称和代码名称不同；
- 中文或其他人类语言需要映射到英文程序名称；
- Binding 变化需要与业务行为分开审计。

## 英文与中文

Binding 不只是翻译层。

英文和中文示例使用不同 Binding 文件，因为它们的 `auditName` 不同；两份文件有意复用相同的稳定 ID 和程序名称：

```text
英文审计名称：number
中文审计名称：编号
稳定 ID：field_order_number
程序名称：id
```

这样，两种人类方言可以指向同一个程序世界身份，而不需要强迫审计名称一致。

## 文件格式

P0 使用 JSON Binding 文件。完整示例是：

- [bindings/order.binding.json](../../bindings/order.binding.json)
- [bindings/order.binding.zh-CN.json](../../bindings/order.binding.zh-CN.json)

Binding 文件包含 `version: 1`、`objects` 数组和 `flows` 数组。

每个对象绑定其字段，每个流程绑定输入和输出。每一项包含：

- `id`：稳定内部身份；
- `auditName`：所选 AAL 方言中使用的准确声明名称；
- `programName`：生成 TypeScript 使用的名称。

中文示例中的一个对象绑定如下：

```json
{
  "id": "object_order",
  "auditName": "订单",
  "programName": "Order",
  "fields": [
    {
      "id": "field_order_number",
      "auditName": "编号",
      "programName": "id"
    }
  ]
}
```

流程使用相同的三个身份字段，并增加 `inputs` 和 `outputs`：

```json
{
  "id": "flow_create_order",
  "auditName": "创建订单",
  "programName": "createOrder",
  "inputs": [],
  "outputs": []
}
```

上面的空数组只用于说明结构。真实 Binding 必须列出这个流程声明的全部输入和输出，具体以完整示例文件为准。

## 校验规则

提供显式 Binding 时，编译器要求精确覆盖：

- 每个 AAL 对象和流程都有且只有一个绑定；
- 每个对象字段、流程输入和流程输出都有且只有一个成员绑定；
- 缺失、多余或重复的审计名称会被拒绝；
- 每个 `id` 在整个文件中唯一，并符合 `[a-z][a-z0-9_-]*`；
- 对象 `programName` 在对象之间唯一，流程 `programName` 在流程之间唯一，并且两者都是合法 JavaScript 标识符；
- 成员 `programName` 非空，并在所属对象、输入列表或输出列表中唯一。

`auditName` 用来匹配所选 AAL 源文件；`id` 用来在明确的审计名称变化中保持身份；`programName` 控制生成接口。

## 审计边界

日常业务审计主要阅读 AAL。

Binding 创建或变化时必须单独审计，因为它可以在不修改 AAL 业务文本的情况下改变生成名称和接口结构。

例如，把：

```text
编号 → id
```

改成：

```text
编号 → customerId
```

即使 AAL 不变，也会改变生成程序的接口。

## Binding 可以包含什么

P0 Binding 只能包含以下名称和身份：

- 对象与字段；
- 流程、输入与输出。

它不能增加：

- 金额或单位换算；
- 枚举或状态转换；
- 对象结构重组；
- 第三方 API 行为；
- 数据库行为；
- 隐藏业务规则。

这些能力需要未来明确的 Adapter 或协议层。当前 P0 Binding 只控制生成的 TypeScript 名称。

## 构建身份

生成的 TypeScript 会记录确定性的 Binding 指纹。可复现构建应考虑：

```text
AAL 源文件与语义
Binding（显式文件或自动后备绑定）
编译器版本
运行时与依赖版本
未来的标准库、Adapter 和协议配置
```

当前短指纹用于确定性追踪，不是密码学安全保证。

## 编译

使用显式中文 Binding：

```bash
npm run compile:example:zh
```

直接使用 CLI：

```bash
npm run build

node bin/determinant.mjs \
  examples/order.zh-CN.aal \
  --language zh-CN \
  --binding bindings/order.binding.zh-CN.json \
  --out generated/order.zh-CN.ts
```

只有在接受本次构建的后备身份时才省略 `--binding`。

生成的 TypeScript 是构建产物。修改业务行为时修改 AAL；修改稳定身份或程序名称时修改 Binding。

## 审计清单

- [ ] 每个 `auditName` 是否准确匹配所选 AAL 方言？
- [ ] 是否恰好覆盖每个对象、字段、流程、输入和输出？
- [ ] 保持同一身份的声明是否继续使用原稳定 ID？
- [ ] 程序名称变化是否明确且有意？
- [ ] Binding 是否只包含名称和身份？
- [ ] Binding 每次变化时是否单独审计差异？
