# AI Coding Guide

## Project summary

Determinant is the deterministic compiler for AAL (Auditable Application Language). AAL is the formal application source, not an ordinary requirements document or a renamed general-purpose programming language.

The P0 implementation expresses an order and inventory domain with objects and flows, then deterministically produces TypeScript/Node.js through one AST and semantic checker. English is the default surface dialect; Chinese uses the `zh-CN` dialect.

## Sources of truth

- `docs/project-goal.md`
- `docs/product-spec.md`
- `docs/feature-list.md`
- `docs/ultimate-goals.md`
- `docs/public/aal-authoring-guide.md`

Use `docs/public/aal-authoring-guide.zh-CN.md` when generating Chinese AAL. If implementation and documentation conflict, report the conflict before expanding scope.

## Engineering principle

AI may assist from natural language to AAL. After the user confirms the AAL, parsing, checking, compilation, and tests must be deterministic. The compiler may hide implementation details, but it must not hide business decisions such as currency, unit, precision, permissions, retries, concurrency, rollback, rounding, or failure behavior.

## Current priority

1. Keep only objects, flows, and HTTP entries at the user-facing top level.
2. Keep possessive field relationships and explicit `change` statements.
3. Check `execute / use / get` composition.
4. Check names, fields, types, amount units, and conditions.
5. Keep Binding optional; when present it must completely cover objects, fields, flows, inputs, and outputs.
6. Keep English and `zh-CN` on the same AST, checker, and generator.
7. Keep TypeScript generation reproducible and verify success, failure, and real state mutation.
8. Keep HTTP limited to the implemented CRUD MVP; do not expand into SQLite, TCP, WebSocket, authentication, or UI.

## Rules for AI assistants

- Read the sources of truth before changing the language or compiler.
- Do not write TypeScript, JavaScript, or pseudocode as AAL.
- Do not expose methods, calls, `this`, dot access, or implicit return values in the audit surface.
- Ask when requirements do not define fields, types, money units, retries, concurrency, permissions, or rollback behavior.
- Express every business state mutation with `change`.
- Binding may bind names and structure only; it must not add hidden business rules.
- Review a Binding when it is created or changed.
- Treat generated code as a build artifact.
- Prefer small, verifiable tests before adding language capabilities.
- Update product documents before implementing a changed product decision.

## Verification

```bash
npm test
npm run compile:example
npm run test:zh
npm run compile:example:zh
npm run demo:http
```

Generated TypeScript must also pass strict type checking. The order and inventory example must verify success, insufficient inventory, invalid quantity, and mutation of the inventory object.
