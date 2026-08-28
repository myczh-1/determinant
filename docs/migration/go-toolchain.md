# Go Toolchain Migration Status

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
- Go Backend generating a compilable standalone Go program and serving the HTTP Todo example through the system Go toolchain;
- TypeScript Backend generating TypeScript directly from the Go Core, with the migration examples compiling and HTTP CRUD calls covered;
- an out-of-process Observer Plugin Protocol over stdin/stdout JSON Lines;
- Semantic Plugin parameter placeholder and Backend interface boundary;
- macOS, Linux, and Windows cross-build verification for the Go CLI.

## Current boundary

Complete Binding/Fixture compatibility, TypeScript target runner management, `dev/watch`, Mermaid/ER/flow product UX, a VS Code extension, and full third-party semantic plugins are not part of the completed slice yet. The old Node implementation must remain until the corresponding migration gates are completed or those items are explicitly moved to follow-up branches.

Target runtimes are user-provided. Determinant generates target source; `run --target go` invokes the system Go toolchain and does not bundle Go, Node, or Bun.

## Verification entry points

```bash
go test ./...
npm test
go run ./cmd/determinant check --json examples/items/app.aal
go run ./cmd/determinant build examples/items/app.aal --target go --out /tmp/items.go
```
