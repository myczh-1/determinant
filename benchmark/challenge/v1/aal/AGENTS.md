# AAL Submission Instructions

You are working inside a standalone benchmark workspace. Treat this directory as the entire authorized filesystem scope for the task.

Read `TASK.md` and `AAL-REFERENCE.md`, then implement the AAL mode submission.

## Boundaries

- Work only inside this directory.
- Do not read parent directories, sibling directories, user-level memories, global project instructions, or other repositories.
- Do not search the filesystem for related projects, tests, examples, generated code, or implementation material.
- Do not use network search or external documentation to discover hidden benchmark behavior.
- Do not modify `AGENTS.md`, `TASK.md`, `AAL-REFERENCE.md`, or `submission-manifest.json`.
- Do not inspect or modify `.git`.
- Do not commit.

## Required output

Create exactly one implementation file in the current directory:

```text
app.aal
```

Requirements:

1. Use the English AAL dialect described in `AAL-REFERENCE.md`.
2. Express the Item identity, CRUD flows, state changes, failures, and HTTP entries explicitly.
3. Use the exact business failure messages from `TASK.md`.
4. Do not put host or port configuration in AAL.
5. Do not create a Binding file; all names in this challenge can use deterministic defaults.
6. Do not create JavaScript, TypeScript, package files, tests, reports, or generated code.
7. Do not represent unsupported behavior in comments or pseudocode.

The evaluator compiles, type-checks, and runs `app.aal` after collection. No compiler is exposed in this workspace. Review the source carefully before finishing.
