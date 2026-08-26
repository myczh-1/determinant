# Direct Submission Instructions

You are working inside a standalone benchmark workspace. Treat this directory as the entire authorized filesystem scope for the task.

Read `TASK.md`, then implement the Direct mode submission.

## Boundaries

- Work only inside this directory.
- Do not read parent directories, sibling directories, user-level memories, global project instructions, or other repositories.
- Do not search the filesystem for related projects, tests, examples, or implementation material.
- Do not use network search or external documentation to discover hidden benchmark behavior.
- Do not modify `AGENTS.md`, `TASK.md`, or `submission-manifest.json`.
- Do not inspect or modify `.git`.
- Do not commit.

## Required output

Create exactly this implementation layout in the current directory:

```text
package.json
package-lock.json
src/
```

Requirements:

1. Use Node.js and npm.
2. Use only Node.js built-in modules. Do not add runtime or development dependencies.
3. `package.json` must define `build` and `start` scripts.
4. `npm run build` must perform a real syntax or build check and fail on invalid source.
5. `npm run start` must start the service in the foreground.
6. Read the address from `BENCHMARK_HOST` and `BENCHMARK_PORT`.
7. Do not make a fixed port the only supported configuration.
8. Put all implementation source under `src/`.
9. Do not add tests, reports, generated files, lockfiles from another project, or extra top-level files.

The evaluator runs:

```text
npm ci --ignore-scripts
npm run build
npm run start
```

You may run local build and HTTP smoke checks. Stop every process you start before finishing.
