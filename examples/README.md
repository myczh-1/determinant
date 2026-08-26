# Examples

> Chinese version: [示例目录](./README.zh-CN.md)

Each example keeps its AAL source and optional Binding files together:

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

Generated TypeScript remains in the ignored top-level `generated/` directory.

`order-refund/` contains a Chinese-first design-stage specification for a future semantic-density example. It is intentionally not runnable until its language requirements are reviewed and implemented.
