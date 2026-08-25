# Binding Guide

> Chinese version: [Binding 绑定指南](./binding-guide.zh-CN.md)

## Purpose

Binding is an optional, explicit layer between AAL audit names, stable identities, and program-world names.

```text
AAL: Inventory's number
Binding: Inventory → InventoryRecord, number → quantity
Generated code: InventoryRecord.quantity
```

AAL does not need to know the naming conventions of TypeScript, an SDK, or a database. The compiler does not guess whether two names refer to the same thing.

## File format

P0 uses JSON binding files under `bindings/`. The example is:

```text
bindings/order.binding.json
```

Each binding entry contains:

- `id`: a stable internal identity;
- `auditName`: the name used in AAL;
- `programName`: the name used by generated code.

Objects bind their fields. Flows bind their inputs and outputs.

```json
{
  "version": 1,
  "objects": [
    {
      "id": "object_inventory",
      "auditName": "Inventory",
      "programName": "InventoryRecord",
      "fields": [
        {
          "id": "field_inventory_quantity",
          "auditName": "number",
          "programName": "quantity"
        }
      ]
    }
  ],
  "flows": []
}
```

When provided, the binding must cover every object, field, flow, input, and output in the AAL source. Missing or extra entries are compilation errors. When omitted, the compiler creates a deterministic fallback for that build. That fallback is not a durable identity contract across source renames or declaration reordering.

## Audit boundary

Normal business review focuses on AAL. A Binding file must be reviewed when it is created or changed because it changes generated names and external structure.

Binding may describe names and structural relationships. It must not silently add business rules. Amount conversion, enum conversion, object reshaping, and third-party behavior belong to a later Adapter layer.

The generated file records a deterministic Binding fingerprint. A build identity should account for the AAL/AST, Binding, compiler, standard library, adapters, and runtime configuration.

## Compile

```bash
node bin/determinant.mjs \
  examples/order.aal \
  --binding bindings/order.binding.json \
  --out generated/order.ts
```

Generated TypeScript is an artifact. Change AAL to change business semantics; change Binding to change program-facing names.
