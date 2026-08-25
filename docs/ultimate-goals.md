# Ultimate Goals

## Dream experience

Users discuss requirements with AI without receiving an opaque body of generated code. AI organizes the requirements into AAL that the user can read, edit, and confirm line by line.

After confirmation, the compiler independently checks and builds the application. Users audit business semantics; deterministic tooling handles TypeScript, Node.js, databases, HTTP, and other implementation details. Changing behavior means changing AAL and regenerating artifacts.

Eventually, one AAL program may target multiple backends while preserving the same observable business behavior.

## Long-term product goals

- Establish a readable, executable formal language for application behavior.
- Make AI an interactive natural-language front end to AAL, not the final executor.
- Make business decisions, constraints, state changes, and failures auditable.
- Support multiple deterministic backends with shared core semantics.
- Generate programs, tests, diagnostics, and visual flow views from AAL.
- Produce semantic diffs instead of forcing users to inspect large code diffs.

## Future capabilities to preserve

- HTTP, JSON, SQLite, third-party services, and scheduled tasks.
- Explicit retry, concurrency, transactions, idempotency, and permissions.
- Python, Go, C/WASM, and other backends.
- AI-assisted natural-language-to-AAL workflows.
- Navigation among AAL, AST, flow diagrams, and generated code.
- Semantic versioning, reproducible builds, and artifact tracing.
- Multiple human-language dialects sharing one core semantic model.

## Architecture implications

Avoid:

- treating generated TypeScript as business source;
- hiding business decisions in parser or backend defaults;
- placing an LLM after AAL confirmation;
- allowing a Node.js backend to define core AAL semantics;
- designing the language around one web, database, or UI framework;
- adding compatibility layers for unconfirmed syntax.

Prefer:

- a clear AAL → AST → backend boundary;
- observable semantics before backend implementation;
- separation of business meaning and runtime detail;
- fixed examples, diagnostics, and reproducible tests;
- a small set of explicit language primitives;
- explicit errors or controlled native-module boundaries for unsupported behavior.

## Explicit non-goals

- A keyword-renamed JavaScript or TypeScript.
- A language for every software system, UI, and low-level concern.
- AI code generation as the core technical result.
- Hiding complexity that cannot be soundly abstracted.
- Multiple backends, platforms, and a complete development environment in the first stage.
