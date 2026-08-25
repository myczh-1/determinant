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
- optional Binding files for stable IDs and program-facing names;
- TypeScript generation and executable order/inventory tests.

The HTTP layer is intentionally not part of the current scope. The next protocol layer will be designed separately.

## Run

```bash
npm test
npm run compile:example
npm run test:zh
npm run compile:example:zh
```

English is the default AAL dialect. Chinese sources use `--language zh-CN` and the `.zh-CN` filename suffix. Both examples include an explicit Binding. When `--binding` is omitted, the compiler creates a deterministic fallback for that build; use an explicit Binding when IDs and program-facing names must remain stable across source renames or reordering.

## AAL example

```aal
application: OrderInventory

object: Inventory

    quantity: integer

flow: DeductInventory

    input:
        inventory: Inventory
        quantity: integer

    if inventory's quantity < quantity:
        failure: Insufficient inventory

    change:
        inventory's quantity = inventory's quantity - quantity

    output:
        remainingInventory = inventory's quantity
```

## Documentation

- [AAL Authoring Guide](docs/public/aal-authoring-guide.md)
- [Binding Guide](docs/public/binding-guide.md)
- [中文说明](README.zh-CN.md)
- [中文公开文档](docs/public/README.zh-CN.md)

Generated files are build artifacts. Modify the AAL source or Binding file instead of editing generated TypeScript.
