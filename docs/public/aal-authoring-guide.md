# AAL Authoring Guide

> Chinese version: [AAL 编写指南](./aal-authoring-guide.zh-CN.md)

## What AAL is

AAL (Auditable Application Language) is a formal application language intended for human review and deterministic execution.

AAL describes:

- data and state in the business world;
- calculations and conditions;
- explicit state changes;
- composition of business flows;
- successful outputs and explicit failures.

The confirmed AAL source is processed by a deterministic parser, semantic checker, and TypeScript/Node.js backend. The compiler does not ask an AI to infer missing business decisions.

## Rules for AI-generated AAL

1. Output AAL only. Do not output TypeScript, JavaScript, or pseudocode as AAL.
2. The user-facing language has only two top-level structures: `object` and `flow`.
3. Use possessive relationships for fields, for example `inventory's quantity`. Do not use dot access, brackets, `this`, or other implementation syntax.
4. Do not invent currencies, units, precision, fields, permissions, retries, concurrency, rollback, rounding, or error behavior.
5. Declare a type for every object field and flow input.
6. Use `change` for real state changes. A calculation alone does not mutate an object.
7. Compose flows explicitly with `execute`, `use`, and `get`.
8. Ask the user when a requirement is ambiguous.
9. After the user confirms AAL, stop changing its business meaning. Deterministic tooling owns parsing, checking, and compilation.

## File structure

An AAL file starts with an application name. Top-level declarations are objects and flows:

```aal
application: OrderInventory

object: Inventory

    quantity: integer

flow: CheckInventory

    input:
        inventory: Inventory
        quantity: integer

    output:
        remainingInventory = inventory's quantity
```

Use four spaces for each indentation level. Blank lines and lines beginning with `#` are ignored.

## Objects and fields

Objects describe data and state. Fields are written directly under an object:

```aal
object: Order

    number: integer
```

Field relationships use the possessive form:

```text
order's number
order's customer's name
```

## Types

P0 supports:

```text
integer
text
boolean
CNY amount
USD amount
object name
```

An amount can specify its unit:

```aal
unitPrice: CNY amount, unit yuan
```

Currency, unit, and precision are business semantics. Do not write a generic `amount` and expect the compiler to guess its meaning.

## Flows

Flows describe business steps:

```aal
flow: DeductInventory

    input:
        inventory: Inventory
        quantity: integer

    if quantity <= 0:
        failure: Quantity must be greater than zero

    if inventory's quantity < quantity:
        failure: Insufficient inventory

    change:
        inventory's quantity = inventory's quantity - quantity

    output:
        remainingInventory = inventory's quantity
```

`if` must produce a Boolean condition. `failure` is an explicit flow failure. `change` is the only P0 form that represents a real object state mutation.

## Calculations and flow composition

Name calculation results:

```aal
calculate:
    total = unitPrice * quantity
```

Compose another flow explicitly:

```aal
execute:
    CalculateOrderTotal

    use:
        unitPrice
        quantity

    get:
        total
```

`use` follows the declared input order. `get` follows the declared output order. A failed executed flow propagates the same failure to the containing flow.

## Binding

The AAL surface uses audit names. An optional [Binding file](./binding-guide.md) maps those names to stable IDs and program-facing names such as `Inventory → InventoryRecord` and `number → id`.

Without a Binding file, the compiler creates a deterministic fallback for that build. An explicit Binding is still valuable in English when audit names, stable identities, and program-facing names differ, and is required when IDs must survive source renames or reordering. Binding is a separate build input and must not add hidden business rules.

## Complete example

The repository example is [examples/order.aal](../../examples/order.aal). It contains two objects and three flows: total calculation, inventory deduction, and order creation.

The current P0 compiler treats the last declared flow as the generated `run` entry. An explicit multi-entry protocol layer is intentionally left for a later design.

## Review checklist

- [ ] Are all top-level declarations objects or flows?
- [ ] Does every object field and flow input have a type?
- [ ] Are currency and unit explicit for every amount?
- [ ] Does every field relationship use the possessive form (`inventory's quantity`)?
- [ ] Are all real state changes explicit under `change`?
- [ ] Are all flow compositions explicit under `execute / use / get`?
- [ ] Are all failure conditions and messages explicit?
- [ ] Did the AI avoid inventing business decisions?
