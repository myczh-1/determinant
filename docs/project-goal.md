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

The acceptance examples cover order/inventory behavior and a runnable in-memory HTTP CRUD service whose behavior is fully declared in AAL.

## Language boundary

The user-facing language describes objects, flows, and explicit HTTP entries. It exposes fields, identity, inputs, CRUD actions, conditions, calculations, changes, execution, results, outputs, failures, request mappings, and status behavior. Host and port remain outside AAL.

English is the default surface dialect and Chinese uses `zh-CN`. Both enter the same AST, checker, and generator. Optional Binding separates audit names from stable IDs and program names in either language.

## Non-goals

- Replacing TypeScript, Python, Go, or other general-purpose languages.
- Supporting UI and visual interaction in P0.
- Covering databases, persistence, distributed systems, and all concurrency semantics at once.
- Letting AI participate in the confirmed deterministic compiler path.
- Filling in permissions, retries, rollback, rounding, or other decisions by default.

## Success criteria

- Multi-object and multi-flow AAL parses, checks, compiles, and runs.
- Repeated compilation produces identical code.
- Undefined names, type conflicts, illegal field access, and unclear mutations are rejected.
- English and Chinese examples express equivalent stable identities.
- The order example covers success, insufficient inventory, invalid quantity, and state mutation.
- The CRUD example covers real HTTP create, read, update, delete, input failures, and deterministic generation without Binding.
