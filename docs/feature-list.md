# Feature List

## Priority legend

- P0: required for the first working version
- P1: important after P0
- P2: longer-term or optional

## P0 features

### 1. Minimal AAL syntax

- User story: describe application data and flows in stable, readable text.
- Description: support applications, objects, fields, flows, inputs, conditions, failures, calculations, changes, execution, arguments, received results, and outputs.
- Acceptance criteria:
  - [x] The order and inventory example is fully represented by two objects and three flows.
  - [x] Invalid syntax produces positioned diagnostics.
  - [x] Syntax does not depend on LLM interpretation.
  - [x] The default English dialect and `zh-CN` dialect use the same AST and compiler pipeline.

### 2. AST and deterministic parsing

- User story: the same AAL always produces the same structure.
- Acceptance criteria:
  - [x] Repeated parsing produces equivalent ASTs.
  - [x] The AST represents all P0 statements and expressions.
  - [x] Parsing performs no business action.

### 3. Objects, flows, and composition

- User story: split business behavior into auditable flows and compose them.
- Acceptance criteria:
  - [x] Flows declare inputs and outputs.
  - [x] Flows read object fields.
  - [x] Composition checks input count, input types, and result count.
  - [x] Failure propagates from an executed flow.
  - [x] State mutation requires an explicit `change` statement.

### 4. Semantic and type checks

- User story: reject undeclared or incompatible business semantics before runtime.
- Acceptance criteria:
  - [x] Undefined names are rejected.
  - [x] Incompatible values, currencies, units, or types cannot be combined.
  - [x] Dot access is rejected.
  - [x] Non-object state cannot be mutated.
  - [x] Diagnostics include cause and position.

### 5. TypeScript/Node.js backend

- User story: compile checked AAL into an executable program.
- Acceptance criteria:
  - [x] Identical input produces identical output.
  - [x] Generated code passes strict TypeScript checks.
  - [x] Generated code runs on Node.js.
  - [x] Generated files identify themselves as artifacts.

### 6. Optional Binding layer

- User story: make relationships among audit names, stable IDs, and program names explicit and reproducible.
- Description: an optional JSON file binds objects, fields, flows, inputs, and outputs. Without it, a deterministic per-build fallback is generated; durable identity across renames or reordering requires an explicit Binding.
- Acceptance criteria:
  - [x] Binding is optional for both English and Chinese AAL.
  - [x] An explicit Binding can map `Order.number` to `Order.id` while preserving stable IDs.
  - [x] Missing or extra entries in an explicit Binding are rejected.
  - [x] Binding cannot carry hidden business rules.

### 7. Order and inventory acceptance example

- Acceptance criteria:
  - [x] A valid order returns a result and changes inventory.
  - [x] Insufficient inventory fails without mutation.
  - [x] Invalid quantity fails explicitly.
  - [x] English and Chinese examples preserve the same stable identities.

### 8. Reproducible compiler tests

- Acceptance criteria:
  - [x] Tests run in one command.
  - [x] Repeated runs do not change output.
  - [x] Tests distinguish parse, semantic, and runtime failures.

## P1 features

### 1. HTTP interface

Map flow inputs and outputs to an explicit JSON HTTP contract.

### 2. SQLite persistence

Add an auditable persistence boundary for stable objects.

### 3. Retry and concurrency

Make counts, conditions, order, and concurrency explicit language semantics.

## P2 features

- Multiple deterministic backends after core semantics stabilize.
- An AI interaction layer from natural language to controlled AAL changes.
- AST visualization and, later, UI semantics.
