# Go Toolchain Migration Status

## Status: PASS

`refactor/go-toolchain` passes the acceptance command for this phase:

```bash
npm run test:migration
```

The gate covers the legacy behavior baseline, deterministic builds, CLI contracts, generated Go/TypeScript validity, ProgramModel, the minimal Observer Protocol, Go static analysis, and macOS/Linux/Windows cross-builds.

## Goal

The `refactor/go-toolchain` branch establishes a complete, reproducible compiler loop:

```text
AAL source
→ Go Core
→ Canonical ProgramModel
→ Backend
→ target source
```

The existing TypeScript/Node implementation remains available as the behavioral reference during migration. Gates compare acceptance/rejection, diagnostic categories and locations, the normalized model, generated source, and observable HTTP behavior rather than internal AST structures.

## Implemented on this branch

- Go lexer, parser, semantic checker, and compiler pipeline;
- deterministic ProgramModel JSON serialization;
- `determinant check` and `check --json`;
- Go Backend generating a compilable standalone Go program and serving the HTTP Todo/Fixture examples through the system Go toolchain;
- TypeScript Backend generating TypeScript directly from the Go Core, with the migration examples compiling and HTTP CRUD calls covered;
- Binding and Fixture support for the current examples, including explicit program-name mappings, full fixture validation, and atomic store replacement;
- an out-of-process Observer Plugin Protocol over stdin/stdout JSON Lines;
- Semantic Plugin parameter placeholder and Backend interface boundary;
- macOS, Linux, and Windows cross-build verification for the Go CLI.

## Frozen scope for this phase

This branch is only the Go compiler migration. The existing Node/TypeScript
implementation remains the behavioral reference, and the repository and CLI
continue to use `determinant`; AAL is the language name.

`run` means AAL → temporary target source → the target runner already
available on the user's machine. The migration target is the system Go
toolchain; Determinant does not ship Go, Node, or Bun.

The single migration acceptance command is:

```bash
npm run test:migration
```

## Current boundary

The Observer Protocol defines data exchange between independent processes; it is not a Plugin Host. This branch does not provide plugin discovery, registration, launching, supervision, timeouts, sandboxing, or lifecycle management.

Exact legacy diagnostic wording, TypeScript target runner management,
`dev/watch`, Mermaid/ER/flow product UX, a VS Code extension, and full
third-party semantic plugins are not part of this phase. Mermaid and workbench
features belong to `feature/workbench`; third-party types, resources,
operations, validators, lowering, and runtime integration belong to
`feature/semantic-plugins`. The old Node implementation remains until the
current migration gates are green.

Target runtimes are user-provided. Determinant generates target source;
`run` invokes the system Go toolchain for this phase and does not bundle Go,
Node, or Bun.

## Verification entry points

```bash
go test ./...
npm test
go run ./cmd/determinant check --json examples/items/app.aal
go run ./cmd/determinant build examples/items/app.aal --target go --out /tmp/items.go
```
