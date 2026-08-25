# Project Goal

## One-sentence summary

Determinant deterministically compiles human-auditable AAL programs into executable applications.

## Background

AI can translate natural language directly into code, but business decisions can disappear into implementation details, defaults, and model inference. Determinant places AAL between natural language and a general-purpose language: users audit data, flows, state changes, and failures; the compiler generates the implementation reproducibly.

## Core value

- Review what the application does, not how code is organized.
- Never silently complete an undeclared business decision.
- Keep parsing, checking, compilation, and tests independent of LLMs after confirmation.
- Reproduce the same output with the same AAL and toolchain inputs.

## First-version goal

```text
AAL source
    ↓
deterministic AST
    ↓
object, flow, and type checks
    ↓
deterministic TypeScript
    ↓
Node.js execution
```

The end-to-end acceptance example creates an order, calculates its total, and deducts inventory. Inventory deduction must explicitly mutate inventory state.

## Language boundary

The user-facing language describes only objects and flows. It exposes explicit fields, inputs, conditions, calculations, changes, execution, results, outputs, and failures. Currency, unit, precision, and failure behavior are business semantics and cannot be inferred.

English is the default surface dialect and Chinese uses `zh-CN`. Both enter the same AST, checker, and generator. Optional Binding separates audit names from stable IDs and program names in either language.

## Non-goals

- Replacing TypeScript, Python, Go, or other general-purpose languages.
- Supporting UI and visual interaction in P0.
- Covering databases, HTTP, distributed systems, and all concurrency semantics at once.
- Letting AI participate in the confirmed deterministic compiler path.
- Filling in permissions, retries, rollback, rounding, or other decisions by default.

## Success criteria

- Multi-object and multi-flow AAL parses, checks, compiles, and runs.
- Repeated compilation produces identical code.
- Undefined names, type conflicts, illegal field access, and unclear mutations are rejected.
- English and Chinese examples express equivalent stable identities.
- The order example covers success, insufficient inventory, invalid quantity, and state mutation.
