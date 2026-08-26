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

AAL keeps two primary business concepts and one explicit external entry:

```text
Object
Flow
HTTP entry
```

An object describes what exists in the application.

A flow describes what happens in the application.

An HTTP entry maps an HTTP request to a flow. Host and port remain runtime configuration rather than business behavior.

When the domain has a finite vocabulary, a `values` declaration makes its allowed terms explicit without turning them into arbitrary text or implementation codes.

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

Binding can connect these identities explicitly when they need to differ.

For example:

```text
Audit object: Order
Stable ID: object_order
Program object: Order

Audit field: number
Stable ID: field_order_number
Program field: id
```

Binding is optional auxiliary input, not a prerequisite for understanding or running an AAL application.

Without an explicit Binding, audit names are used directly as generated program names, while deterministic temporary IDs identify declarations for the current build. HTTP request fields also use the AAL input names unless the HTTP entry declares a local `as` alias.

Use an explicit Binding when names must differ, stable identities must survive source renames or declaration reordering, or an existing program-facing interface must be preserved.

Binding is not everyday business logic. Business behavior is reviewed primarily in AAL; a Binding is reviewed separately when it is created or changed.

The current P0 Binding controls generated TypeScript names. Third-party API, SDK, and database adaptation is not implemented yet.

## Current implementation

The repository contains a minimal deterministic compiler loop:

- Object declarations and typed fields
- Flow declarations
- Conditions and explicit failures
- Calculations
- Explicit state changes
- Object identity, create, single-object query, and delete
- Flow composition
- Explicit HTTP entries and request mappings
- In-memory CRUD runtime
- Deterministic parsing
- Semantic checks and diagnostics
- Explicit money types
- Closed business value sets
- UTC time, fixed durations, and trusted runtime clocks
- Conditional business-step blocks
- Explicit in-memory atomic create/change blocks
- Validated, all-or-nothing Fixture loading
- Optional Binding with stable IDs and program-facing names
- English and `zh-CN` AAL dialects using one compiler pipeline
- TypeScript code generation
- Executable success and failure tests
- Non-LLM benchmark scorer with a frozen black-box HTTP oracle

The current target runtime is:

```text
Node.js + TypeScript
```

Persistence, database transactions, authentication, list queries, and external system adapters are not part of this MVP.

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

# Frozen semantic-density order-refund oracle
npm run test:order-refund

# Run the in-memory HTTP CRUD demo
npm run demo:http

# The same CRUD semantics through the Chinese AAL dialect
npm run demo:http:zh

# Chinese order-refund and inventory-restock demo
npm run demo:order-refund
```

With the demo running:

```bash
curl -X POST http://127.0.0.1:3000/items \
  -H "Content-Type: application/json" \
  -d '{"id":1,"name":"Book"}'

curl http://127.0.0.1:3000/items/1

curl -X PUT http://127.0.0.1:3000/items/1 \
  -H "Content-Type: application/json" \
  -d '{"name":"Notebook"}'

curl -X DELETE http://127.0.0.1:3000/items/1
```

The equivalent direct command is:

```bash
node bin/determinant.mjs run examples/items/app.aal --host 127.0.0.1 --port 3000
```

The [Chinese order-refund example](examples/order-refund/README.zh-CN.md) makes 39 tracked semantics visible across AAL, the frozen Fixture, and language-level transport guarantees.

Run the direct-versus-AAL benchmark:

```bash
npm run benchmark:run
```

External implementation tools should first receive a standalone workspace created with `npm run benchmark:prepare`, then have their allowlisted output imported with `npm run benchmark:collect`. The benchmark builds and runs temporary copies of collected submissions, records canonical behavioral fingerprints and review-surface metrics, then writes `result.json`, `summary.json`, and `report.md` under `benchmark/results/`.

## Early benchmark results

A first frozen CRUD benchmark compared direct AI-generated Node.js implementations with AAL compiled through Determinant to Node.js.

Across seven valid submissions:

- 7/7 built successfully;
- 7/7 started successfully;
- all passed the frozen HTTP oracle with 14/14 cases;
- all produced the same observable behavior fingerprint;
- every completed Direct/AAL pair preserved the tested behavior while reducing the AAL review surface.

| Tool | Direct | AAL | Direct LOC | AAL LOC | LOC reduction | Byte reduction |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| codex-5.6luna | 14/14 | 14/14 | 132 | 104 | 21.21% | 46.97% |
| omp-deepseek-v4 | 14/14 | 14/14 | 116 | 104 | 10.34% | 56.03% |
| opencode-deepseek-v4 | 14/14 | 14/14 | 166 | 104 | 37.35% | 58.19% |
| opencode-glm5-2 | not completed | 14/14 | — | 104 | — | — |

Across the three completed Direct/AAL pairs in aggregate, the AAL review surface was 24.6% smaller by non-empty lines and 54.2% smaller by bytes. LOC in this table means non-empty lines in the primary review surface; generated code and operational package configuration are not counted.

This first benchmark does **not** show a behavioral reliability advantage: every valid Direct and AAL submission passed the same oracle and produced the same behavior fingerprint. What it does show is that, for this task, the same tested behavior could be reviewed through a substantially smaller AAL artifact.

See the [full benchmark report](benchmark/results/report.md).

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
- [Benchmark Scorer v1](benchmark/README.md)
- [Chinese order-refund example](examples/order-refund/README.zh-CN.md)
- [中文 README](README.zh-CN.md)
- [中文 AAL 编写指南](docs/public/aal-authoring-guide.zh-CN.md)
- [中文 Binding 指南](docs/public/binding-guide.zh-CN.md)

Generated TypeScript is a build artifact.

Change AAL to change business behavior.

Change Binding to change stable identities or program-facing names.

Do not edit generated code directly.
