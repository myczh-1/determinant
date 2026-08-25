# Determinant

Determinant is a deterministic compiler for AAL (Auditable Application Language).

AAL is a human-auditable application language. It describes data and business flows with `object` and `flow`; the compiler checks the result and generates executable TypeScript/Node.js code.

```text
AAL source → AST → semantic checks → TypeScript → Node.js
```

## Status

The repository currently contains the P0 language and compiler loop:

- objects and typed fields;
- flows, conditions, calculations, explicit state changes, and flow composition;
- deterministic parsing and semantic diagnostics;
- explicit money types and basic arithmetic;
- Binding files for stable IDs and program-facing names;
- TypeScript generation and executable order/inventory tests.

The HTTP layer is intentionally not part of the current scope. The next protocol layer will be designed separately.

## Run

```bash
npm test
npm run compile:example
```

The example is compiled with [bindings/order.binding.json](bindings/order.binding.json) and written to the ignored `generated/order.ts` path.

## AAL example

```aal
应用：订单库存

对象：库存

    数量：整数

流程：扣减库存

    输入：
        库存：库存
        数量：整数

    如果 库存 的 数量 < 数量：
        失败：库存不足

    改变：
        库存 的 数量 = 库存 的 数量 - 数量

    输出：
        剩余库存 = 库存 的 数量
```

## Documentation

- [AAL Authoring Guide](docs/public/aal-authoring-guide.en.md)
- [Binding Guide](docs/public/binding-guide.en.md)
- [中文说明](README.zh-CN.md)
- [中文公开文档](docs/public/README.md)

Generated files are build artifacts. Modify the AAL source or Binding file instead of editing generated TypeScript.
