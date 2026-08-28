# R0 migration fixtures

This directory is the migration boundary for the Go toolchain.

- `valid/` records AAL programs that the legacy compiler accepts.
- `invalid/` records AAL programs that the legacy compiler rejects.
- `expected/` records normalized model, diagnostic, generated-source, and observable-behavior expectations.

The first R0 snapshot keeps the existing examples and Node tests as the authoritative reference instead of copying their contents into a second source tree. `manifest.json` names every baseline input and test entry point. As each Go migration slice is ported, its input and expected result should be promoted into these directories without changing the original AAL source.

The fixture contract is behavioral: acceptance, diagnostic location, normalized ProgramModel, generated source determinism, and HTTP results. The Go AST does not need to reproduce the legacy TypeScript AST shape.
