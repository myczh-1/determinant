# Binding 绑定指南

> 默认英文版本：[Binding Guide](./binding-guide.md)

## 作用

Binding 是 AAL 审计名称、稳定身份和程序世界名称之间可选的明确绑定层。

```text
AAL：对象“库存”的“数量”
Binding：库存 → Inventory，数量 → quantity
生成代码：Inventory.quantity
```

AAL 不需要知道 TypeScript、SDK 或数据库使用什么名称；编译器也不会猜测两个名称是否对应。

## 文件位置

项目可以在 `bindings/` 下保存绑定文件。当前 P0 使用 JSON，示例是：

```text
bindings/order.binding.zh-CN.json
```

绑定文件提供时必须包含 `version: 1`、对象绑定和流程绑定。每个绑定都有：

- `id`：稳定的内部身份；
- `auditName`：AAL 中的人类名称；
- `programName`：生成程序使用的名称。

对象还要绑定字段，流程还要绑定输入和输出。

Binding 必须完整覆盖 AAL 的对象、字段、流程、输入和输出；缺少或多出项目都会导致编译失败。不提供 Binding 时，编译器会为本次构建生成确定性后备绑定；这个后备绑定不保证 ID 在源文件重命名或声明顺序变化后保持稳定。

```json
{
  "version": 1,
  "objects": [
    {
      "id": "object_inventory",
      "auditName": "库存",
      "programName": "Inventory",
      "fields": [
        {
          "id": "field_inventory_quantity",
          "auditName": "数量",
          "programName": "quantity"
        }
      ]
    }
  ],
  "flows": []
}
```

## 审计边界

日常业务审计主要阅读 AAL。Binding 创建或变化时必须单独确认，因为它会影响生成程序的结构和外部接口名称。

Binding 只能表达名称和结构绑定，不能增加隐含的业务规则。金额换算、状态转换、外部对象拆分等能力属于后续 Adapter，不放进 P0 Binding。

构建需要同时记录：

```text
AAL / AST
Binding
Compiler
标准库、Adapter 和 Runtime 配置
```

其中任一部分变化，都应产生新的构建身份。

## 编译

```bash
node bin/determinant.mjs \
  examples/order.zh-CN.aal \
  --language zh-CN \
  --binding bindings/order.binding.zh-CN.json \
  --out generated/order.zh-CN.ts
```

如果绑定缺少对象、字段、流程、输入或输出，编译器会拒绝生成代码。
