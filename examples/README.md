# Examples

> Chinese version: [示例目录](./README.zh-CN.md)

Each example keeps its AAL source and optional Binding files together:

```text
examples/
├── items/
│   ├── app.aal
│   ├── app.zh-CN.aal
│   └── binding.json
├── order/
│   ├── app.aal
│   ├── app.zh-CN.aal
│   ├── binding.json
│   └── binding.zh-CN.json
└── order-refund/
    ├── app.zh-CN.aal
    ├── fixture.v1.json
    └── README.zh-CN.md
```

Generated TypeScript remains in the ignored top-level `generated/` directory.

`order-refund/` is a runnable, Chinese-first semantic-density example for payment, cancellation, refund, and inventory restock behavior. See its [Chinese guide](./order-refund/README.zh-CN.md).
