# 示例目录

> 默认英文版本：[Examples](./README.md)

每个示例把 AAL 源文件和可选 Binding 放在同一个目录中：

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

生成的 TypeScript 继续放在被忽略的顶层 `generated/` 目录中。

`order-refund/` 是一个中文优先、可以运行的语义密集型示例，用于表达支付、取消、退款和库存回补行为。参见[订单退款与库存回补](./order-refund/README.zh-CN.md)。
