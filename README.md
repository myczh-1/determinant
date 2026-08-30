# Determinant

**Let AI stop at an auditable business-semantic layer. From that boundary onward, the LLM leaves the implementation path.**

Typical AI coding looks like this:

```text
Natural-language requirement
→ LLM
→ Final implementation code
→ Human reviews code
```

Determinant moves the boundary earlier:

```text
Natural-language requirement
→ LLM
→ Auditable business semantics
→ Human approval
════════════════════════════
       LLM stops here
════════════════════════════
→ Deterministic check / compile / execute
→ Final program
```

This repository uses **AAL (Auditable Application Language)** as one reference semantic layer. AAL itself is not the central claim. The central claim is: **once the intended behavior has been expressed and accepted, implementation should not require another probabilistic generation step.**

The current `refactor/go-toolchain` branch provides a repeatable compiler loop:

```text
AAL
→ Go Core
→ Canonical ProgramModel
→ Backend
→ Go / TypeScript
```

The migration acceptance suite currently passes and covers the legacy behavior baseline, deterministic builds, CLI contracts, Go/TypeScript source generation, ProgramModel, the minimal Observer Protocol, Go static analysis, and macOS/Linux/Windows cross-builds.

## Minimal example

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

The review target is:

```text
when inventory is insufficient
whether inventory changes
what the resulting quantity is
```

The reviewer does not need to approve which class, service, repository, promise, or other implementation structure happens to be generated.

## Not a universal implementation language

Determinant does not try to impose one engineering style on every project.

Real projects have their own frameworks, databases, SDKs, infrastructure, exception conventions, transaction rules, and code organization. A more realistic production shape is:

```text
Business semantics
      ↓
Project-specific deterministic Backend / Binding
      ↓
Spring Boot / Go / TypeScript / internal frameworks
```

In that split:

- the **semantic layer** states what the system must do;
- the **project Backend** fixes how that meaning is implemented in one organization;
- those engineering choices do not need to be re-decided by an LLM for every feature request.

If a new requirement fits the existing semantic vocabulary and backend capabilities, everyday work changes only the business semantics. Backend work is needed when the organization introduces genuinely new engineering capabilities.

## Current implementation

The repository currently includes:

- Object declarations and typed fields
- Flow declarations
- Conditions, calculations, and explicit failures
- Explicit state changes
- Object identity, create, single-object query, and delete
- Flow composition
- HTTP entries and request mappings
- Money, closed value sets, UTC time, and fixed durations
- Atomic create/change blocks
- Fixture loading
- Binding, stable IDs, and program-facing names
- English and `zh-CN` dialects
- Go lexer / parser / semantic checker
- Canonical ProgramModel
- Go Backend
- TypeScript Backend
- `determinant check` and JSON diagnostics
- Out-of-process Observer Plugin protocol
- Executable success/failure-path tests
- Frozen black-box HTTP Oracle benchmark

See:

- [Go toolchain migration status](docs/migration/go-toolchain.md)
- [Plugin protocol](docs/migration/plugin-protocol.md)

Persistence databases, full transaction support, authentication, list queries, and external-system adapters remain outside the current migration gate.

## Run the Go toolchain

Go is required. The legacy Node/TypeScript implementation remains in the repository as a migration behavior reference and benchmark tool.

```bash
# Go unit tests
go test ./...

# Unified migration acceptance
npm run test:migration

# Check AAL
go run ./cmd/determinant check --json examples/items/app.aal

# Generate Go source
go run ./cmd/determinant build examples/items/app.aal --target go --out /tmp/items.go
```

The current unified migration acceptance status is **PASS**.

## Existing benchmark

The first frozen CRUD benchmark compared direct AI-generated Node.js implementations with AAL produced by AI and then deterministically compiled by Determinant.

Across seven valid submissions:

- 7/7 built successfully;
- 7/7 started successfully;
- all passed the frozen HTTP oracle with 14/14 cases;
- all produced the same observable behavior fingerprint.

Across the three completed Direct/AAL pairs, the primary AAL review surface was smaller by:

- **24.6%** in non-empty lines;
- **54.2%** in bytes.

| Tool | Direct | AAL | Direct LOC | AAL LOC | LOC reduction | Byte reduction |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| codex-5.6luna | 14/14 | 14/14 | 132 | 104 | 21.21% | 46.97% |
| omp-deepseek-v4 | 14/14 | 14/14 | 116 | 104 | 10.34% | 56.03% |
| opencode-deepseek-v4 | 14/14 | 14/14 | 166 | 104 | 37.35% | 58.19% |
| opencode-glm5-2 | not completed | 14/14 | — | 104 | — | — |

This benchmark does **not** show a behavioral reliability advantage: every valid Direct and AAL submission passed the same oracle. What it currently shows is that, for this task, the same tested behavior could be reviewed through a smaller semantic artifact.

See the [full benchmark report](benchmark/results/report.md).

## Relationship to prior work

Determinant does not claim that “LLM produces a model or DSL, then a deterministic toolchain produces software” is a new direction.

It builds on long-standing work in Model-Driven Engineering (MDE), Model-Driven Architecture (MDA), domain-specific languages, and code generation. Since the rise of LLMs, this area has become active again:

- A 2026 systematic mapping study identified **86 LLM + MDE primary studies** from 2022 to early 2026, with Model Generation as the dominant task area: <https://link.springer.com/article/10.1007/s10664-026-10921-4>
- A 2026 BMW industrial case study uses LLMs to generate and modify a multi-file Xtext DSL whose existing generator produces downstream Java / TypeScript: <https://conf.researchr.org/details/ease-2026/ease-2026-industry-papers/1/Leveraging-LLMs-for-Multi-File-DSL-Code-Generation-An-Industrial-Case-Study>
- PlanCompiler uses a typed JSON plan as the boundary between LLM planning and deterministic validation / compilation to Python: <https://arxiv.org/abs/2604.13092>

The specific combination explored by Determinant is:

1. the intermediate representation primarily expresses business behavior rather than free-form implementation code;
2. that representation is the main human review surface;
3. once the semantics are accepted, the LLM leaves the implementation path;
4. generated implementation code is a build artifact rather than the authoritative source of business behavior;
5. organizations can encode their engineering conventions in stable Backends / Bindings instead of asking AI to rediscover them for every change.

So Determinant is best understood as **a runnable engineering experiment in placing an auditable probabilistic cutoff inside AI-assisted software development, built on top of existing MDE / DSL ideas.**

## What remains to be validated

Determinant is still an early product / engineering experiment. The important open questions are now practical rather than claims of conceptual novelty:

1. Can the semantic layer keep reducing human review surface in real cross-file, cross-module changes?
2. Can the maintenance cost of an organization-specific Backend be amortized across many later features?
3. Does the semantic vocabulary stabilize, or does it eventually expand into another general-purpose programming language?
4. Does the LLM cutoff remain practical once real projects introduce databases, third-party libraries, internal infrastructure, and legacy systems?

## Documentation

- [AAL Authoring Guide](docs/public/aal-authoring-guide.md)
- [Binding Guide](docs/public/binding-guide.md)
- [Go toolchain migration status](docs/migration/go-toolchain.md)
- [Benchmark Scorer v1](benchmark/README.md)
- [Chinese order-refund example](examples/order-refund/README.zh-CN.md)
- [中文 README](README.zh-CN.md)

The current reference implementation treats generated source as a build artifact. Change AAL to change business behavior; change Binding to change stable identities or program-facing names; do not treat generated source as the authoritative business-logic artifact.
