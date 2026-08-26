# Binding Guide

> Chinese version: [Binding 绑定指南](./binding-guide.zh-CN.md)

## Purpose

Binding is the optional, explicit layer among:

```text
human-readable audit name
stable internal ID
program-facing name
```

For example:

```text
Audit object: Order
Stable ID: object_order
Program object: Order

Audit field: number
Stable ID: field_order_number
Program field: id
```

The AAL source can continue to say `order's number`, while generated TypeScript exposes the field as `order.id`. The compiler does not guess that these names refer to the same field.

## Optional does not mean unnecessary

When no Binding file is provided, the compiler uses each AAL audit name directly as its generated program name and creates deterministic temporary IDs from the source declaration order for that build. HTTP field names also default to the AAL flow input names and are not controlled by Binding.

This direct mode is the normal way to start and run an application. It is not a durable identity contract: a source rename changes the program-facing name, and declaration reordering can change temporary IDs.

Use an explicit Binding when:

- IDs must remain stable across audit-name changes;
- generated TypeScript names form a maintained interface;
- English audit names and code names differ;
- Chinese or another human-language dialect maps to English code names;
- a Binding change must be reviewed separately from business behavior.

Do not add a Binding merely because an application uses English names. If the audit names are already suitable program names and durable IDs are unnecessary, the direct mode is complete.

## English and Chinese

Binding is not only a translation layer.

The English and Chinese examples use separate files because their `auditName` values differ. They intentionally reuse the same IDs and program-facing names:

```text
English audit name: number
Chinese audit name: 编号
Stable ID: field_order_number
Program name: id
```

This lets the two human-facing dialects refer to the same program-world identity without forcing their audit names to match.

## File format

P0 uses JSON Binding files. The complete examples are:

- [examples/order/binding.json](../../examples/order/binding.json)
- [examples/order/binding.zh-CN.json](../../examples/order/binding.zh-CN.json)

A Binding file contains `version: 1`, an `objects` array, and a `flows` array.

Every object binds its fields. Every flow binds its inputs and outputs. Each entry contains:

- `id`: a stable internal identity;
- `auditName`: the exact declaration name used by the selected AAL dialect;
- `programName`: the name emitted in generated TypeScript.

An object entry from the English example looks like this:

```json
{
  "id": "object_order",
  "auditName": "Order",
  "programName": "Order",
  "fields": [
    {
      "id": "field_order_number",
      "auditName": "number",
      "programName": "id"
    }
  ]
}
```

A flow entry has the same three identity fields plus `inputs` and `outputs`:

```json
{
  "id": "flow_create_order",
  "auditName": "CreateOrder",
  "programName": "createOrder",
  "inputs": [],
  "outputs": []
}
```

The empty arrays above illustrate structure only. A real Binding must list every input and output declared by that flow; see the complete example file.

## Validation rules

When an explicit Binding is supplied, the compiler requires exact coverage:

- every AAL object and flow has one Binding entry;
- every object field, flow input, and flow output has one member entry;
- missing, extra, or duplicate audit names are rejected;
- every `id` is globally unique and matches `[a-z][a-z0-9_-]*`;
- object `programName` values are unique among objects, flow `programName` values are unique among flows, and both are valid JavaScript identifiers;
- member `programName` values are non-empty and unique within their object, input list, or output list.

`auditName` is used to match the Binding to the selected AAL source. `id` preserves identity across deliberate audit-name changes. `programName` controls generated TypeScript names. It does not silently rename HTTP request or response fields; HTTP request differences are declared locally in the AAL HTTP entry with `as`.

## Audit boundary

Routine business review focuses on AAL.

A Binding must be reviewed when it is created or changed because it can change generated names and interface structure without changing the AAL business text.

For example, changing:

```text
number → id
```

to:

```text
number → customerId
```

changes the generated program interface even if the AAL source is unchanged.

## What Binding may contain

P0 Binding may contain only identities and names for:

- objects and fields;
- flows, inputs, and outputs.

It must not add:

- amount or unit conversion;
- enum or status conversion;
- object reshaping;
- third-party API behavior;
- database behavior;
- hidden business rules.

Those capabilities require a future explicit Adapter or protocol layer. Current P0 Binding controls generated TypeScript names only.

## Build identity

Generated TypeScript records a deterministic Binding fingerprint. A reproducible build should account for:

```text
AAL source and semantics
Binding, when an explicit Binding is used
compiler version
runtime and dependency versions
future standard library, Adapter, and protocol configuration
```

The current short fingerprint is for deterministic traceability, not a cryptographic security guarantee.

## Compile

With the explicit English Binding:

```bash
npm run compile:example
```

Direct CLI usage:

```bash
npm run build

node bin/determinant.mjs \
  examples/order/app.aal \
  --binding examples/order/binding.json \
  --out generated/order.ts
```

Omit `--binding` when AAL names can be used directly and durable identities are not required.

Generated TypeScript is an artifact. Change AAL to change business behavior; change Binding to change stable identities or program-facing names.

## Review checklist

- [ ] Does every `auditName` exactly match the selected AAL dialect?
- [ ] Does the file cover every object, field, flow, input, and output exactly once?
- [ ] Are stable IDs preserved for declarations that retain the same identity?
- [ ] Are program-facing name changes intentional?
- [ ] Does the Binding contain names and identities only?
- [ ] Is the Binding diff reviewed whenever it changes?
