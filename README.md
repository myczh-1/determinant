# Determinant

**Determinant explores a human-auditable deterministic boundary between probabilistic AI and the final program.**

Today, even a detailed specification can produce different code when the model, context, memory, tools, or execution time changes.

Determinant does not try to make an LLM deterministic.

It takes a different approach:

```text
Natural language
→ LLM
→ AAL
→ Human review
════════════════════
→ Deterministic compilation
→ TypeScript / Node.js
```

AAL (Auditable Application Language) is a human-readable language for application behavior.

AI may generate and modify AAL.

Once the AAL is confirmed, subsequent program generation no longer depends on an LLM.

> **Before review, AI may be probabilistic. After review, the software should not remain probabilistic.**

## AAL

AAL currently keeps two primary concepts:

```text
Object
Flow
```

An object describes what exists in the application.

A flow describes what happens in the application.

For example:

```aal
application: InventoryApp

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

The user reviews:

```text
when inventory is insufficient
whether inventory is changed
what the result is after the change
```

The user does not need to review which classes, functions, promises, or other implementation structures the generated code uses.

## Deterministic boundary

After AAL is confirmed, the build path is:

```text
AAL
↓
Parser
↓
AST
↓
Semantic check
↓
Compiler
↓
TypeScript
↓
Node.js
```

This path does not call an LLM.

The goal is:

```text
same AAL
+ same AAL language version and dialect
+ same Binding
+ same compiler version
+ same runtime and dependencies
= same program semantics
```

Determinant does not eliminate uncertainty from AI-assisted development.

It tries to **reduce the scope of uncertainty and give it an explicit endpoint.**

## Binding

AAL uses human-readable audit names, while generated programs and external systems may use different names.

Binding connects these identities explicitly.

For example:

```text
Audit object: Order
Stable ID: object_order
Program object: Order

Audit field: number
Stable ID: field_order_number
Program field: id
```

Binding is optional for experiments.

When no explicit Binding is provided, Determinant can generate a deterministic temporary Binding for the current build.

For maintained applications, use an explicit Binding whenever stable identities or program-facing names must survive source renames or declaration reordering.

Binding is not everyday business logic. Business behavior is reviewed primarily in AAL; a Binding is reviewed separately when it is created or changed.

The current P0 Binding controls generated TypeScript names. Third-party API, SDK, and database adaptation is not implemented yet.

## Current implementation

The repository contains a minimal deterministic compiler loop:

- Object declarations and typed fields
- Flow declarations
- Conditions and explicit failures
- Calculations
- Explicit state changes
- Flow composition
- Deterministic parsing
- Semantic checks and diagnostics
- Explicit money types
- Optional Binding with stable IDs and program-facing names
- English and `zh-CN` AAL dialects using one compiler pipeline
- TypeScript code generation
- Executable success and failure tests

The current target runtime is:

```text
Node.js + TypeScript
```

HTTP and CRUD are reserved for later iterations.

## Run

Requirements: Node.js and npm.

```bash
npm install

# Default English dialect
npm test
npm run compile:example

# Chinese dialect
npm run test:zh
npm run compile:example:zh

# All tests
npm run test:all
```

English is the default AAL dialect and uses filenames without a language suffix.

Chinese uses the `.zh-CN` filename suffix and is selected explicitly with:

```bash
--language zh-CN
```

## Project status

Determinant is still an early-stage experiment.

The first stage tests three questions:

1. Can AAL express application behavior with substantially less text than ordinary implementation code?
2. Can people review AAL as the primary business artifact instead of reviewing AI-generated code line by line?
3. After AAL is confirmed, can program generation leave the probabilistic LLM path completely?

The first stage focuses on Node.js backend applications.

React, Vue, and other UI description are outside the current scope.

## Documentation

- [AAL Authoring Guide](docs/public/aal-authoring-guide.md)
- [Binding Guide](docs/public/binding-guide.md)
- [中文 README](README.zh-CN.md)
- [中文 AAL 编写指南](docs/public/aal-authoring-guide.zh-CN.md)
- [中文 Binding 指南](docs/public/binding-guide.zh-CN.md)

Generated TypeScript is a build artifact.

Change AAL to change business behavior.

Change Binding to change stable identities or program-facing names.

Do not edit generated code directly.
