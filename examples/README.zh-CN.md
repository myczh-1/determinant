# 示例目录

> 默认英文版本：[Examples](./README.md)

每个示例把 AAL 源文件和可选 Binding 放在同一个目录中：

```text
examples/
├── items/
│   ├── app.aal
│   ├── app.zh-CN.aal
│   └── binding.json
└── order/
    ├── app.aal
    ├── app.zh-CN.aal
    ├── binding.json
    └── binding.zh-CN.json
```

生成的 TypeScript 继续放在被忽略的顶层 `generated/` 目录中。

`order-refund/` 是一个中文优先、仍处于设计阶段的语义密集型示例。语言需求经过审阅和实现之前，它刻意保持不可运行。参见[订单退款与库存回补](./order-refund/README.zh-CN.md)。
