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
