# Product Specification

## Product overview

Determinant is the deterministic compiler for AAL. AAL is a formal source language for application behavior, intended to let humans and AI review data, state, flows, and business decisions while implementation organization remains below the compiler boundary.

The audit surface has two top-level structures:

- `object`: data and state in the business world;
- `flow`: calculation, state change, composition, failure, and output.

Binding is an optional, separate layer for names and structure. It maps audit names to stable IDs and program-facing names without changing business semantics. If omitted, the compiler creates a deterministic fallback for that build; durable identity across source renames or reordering requires an explicit Binding. If supplied, Binding is part of the reviewed build input.

## Deterministic boundary

```text
Natural language → AI → AAL → parser / AST / semantic checks / compiler → TypeScript / Node.js
```

AI may prepare AAL for confirmation. After confirmation, AI leaves the semantic execution path. The same AAL, Binding, compiler version, dialect, and target configuration must produce the same result.

## Target user

Application developers who can describe business rules and want review to focus on observable behavior instead of implementation structure.

## Core user flow

1. The user writes AAL or asks AI to prepare it.
2. The user reviews data, flows, state changes, inputs, outputs, and failures.
3. The parser reports positioned syntax diagnostics.
4. The checker validates names, fields, types, composition, and explicit mutation.
5. The compiler generates TypeScript/Node.js.
6. Success and failure tests run; business changes are made in AAL.

## P0 surface syntax

```aal
application: OrderInventory

object: Inventory

    quantity: integer

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

P0 uses four-space indentation. Fields are declared directly under objects, possessive relationships replace implementation-style dot access, and `change` is the only P0 structure for real state mutation.

Flows compose with `execute / use / get`. The last declared flow is the generated `run` entry in P0; a future multi-entry protocol must be explicit rather than inferred from names.

English is the default dialect. Chinese sources select `zh-CN`; both dialects normalize into the same AST and use the same checker and generator.

## Core features

1. Text source files for applications, objects, fields, and flows.
2. Deterministic parsing and AST construction.
3. Semantic checks for declarations, fields, types, composition, outputs, and mutation.
4. Explicit integer, text, Boolean, object, CNY amount, and USD amount types.
5. Deterministic TypeScript/Node.js generation.
6. Optional Binding with stable IDs and program names; explicit files require complete coverage.
7. Reproducible order and inventory acceptance tests in English and Chinese.

## P0 scope

Included:

- one application with multiple objects and flows;
- English and `zh-CN` surface dialects;
- typed fields and possessive field relationships;
- arithmetic, comparison, conditions, failures, calculations, and explicit changes;
- explicit flow composition;
- optional name Binding;
- TypeScript generation and execution.

Excluded:

- UI and visual design;
- databases, ORM, HTTP, and distributed transactions;
- permissions, rollback, automatic retry, and implicit concurrency;
- a graphical editor or complete IDE;
- compiler or AI guesses for undeclared business rules;
- LLM participation after AAL confirmation.
