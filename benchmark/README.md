# Benchmark Scorer v1

> Chinese version: [Benchmark Scorer v1 中文说明](./README.zh-CN.md)

This benchmark compares direct Node.js implementations with AAL submissions by executing the same frozen black-box HTTP oracle.

The scorer does not use an LLM, inspect generated code to infer intent, or modify the submitted source directory.

## Layout

```text
benchmark/
├── contract.v1.json
├── oracle/v1/cases.json
├── scorer/
├── submissions/<mode>/<tool>/<run>/
└── results/
```

The contract, oracle, and scorer are versioned together. Their SHA-256 digests are recorded in every result.

## Isolated authoring workspaces

Do not open an implementation tool in the Determinant repository. Prepare a standalone workspace outside the repository instead:

```bash
npm run benchmark:prepare -- \
  --mode direct \
  --tool example-tool \
  --run 001 \
  --out /absolute/path/to/example-tool/direct/001
```

The prepared directory is an independent Git repository. It contains only a self-contained task, mode-specific instructions, a frozen manifest, and the AAL language reference when the selected mode is `aal`. It contains no links to the scorer, oracle, examples, reference submissions, results, or Determinant source.

Open the implementation tool at the prepared leaf directory, not at its parent. Use a fresh tool session for every mode and run. Opening a directory alone is context isolation, not a security boundary; strict isolation also requires limiting that tool's filesystem access to the prepared directory.

After the tool finishes, collect only the allowed implementation files:

```bash
npm run benchmark:collect -- \
  --mode direct \
  --tool example-tool \
  --run 001 \
  --from /absolute/path/to/example-tool/direct/001
```

Collection verifies the frozen inputs, rejects symbolic links, dependencies, unexpected files, identity changes, and existing destinations, then copies only the submission implementation into `benchmark/submissions/`. Task documents, manifests, and workspace Git data are never collected or scored.

## Submission contracts

Direct submissions use this fixed layout:

```text
direct/<tool>/<run>/
├── package.json
├── package-lock.json
└── src/
```

`package.json` must provide `build` and `start` scripts. The scorer runs:

```text
npm ci --ignore-scripts
npm run build
npm run start
```

The service must read its address from:

```text
BENCHMARK_HOST
BENCHMARK_PORT
```

AAL submissions use:

```text
aal/<tool>/<run>/
├── app.aal
└── binding.json    # optional
```

Benchmark v1 fixes the AAL dialect to English. The repository's pinned Determinant compiler compiles, type-checks, and starts the application.

## Run

Score every submission and regenerate the aggregate artifacts:

```bash
npm run benchmark:run
```

Filter the scorer when needed:

```bash
node benchmark/scorer/score.mjs --mode aal --tool reference --run 001
node benchmark/scorer/aggregate.mjs
```

Outputs are written outside the submissions:

```text
benchmark/results/<mode>/<tool>/<run>/result.json
benchmark/results/summary.json
benchmark/results/report.md
```

## Scoring

Build and service startup are gates. Functional correctness is the number of frozen oracle cases that pass. Review-surface size is reported separately and is compared only when both paired submissions pass every oracle case.

No weighted total score is produced.

The behavioral fingerprint is SHA-256 over the canonical observed response transcript. It excludes timing, temporary ports, process logs, and volatile HTTP headers.

## Review surface

For direct submissions, `src/` is the primary review surface and `package.json` is reported separately as operational configuration.

For AAL submissions, `app.aal` plus an explicit `binding.json`, when present, form the review surface. Generated TypeScript is not counted.

The scorer records file count, UTF-8 bytes, physical lines, non-blank lines, per-file digests, and a combined review-surface digest. It does not estimate readability or complexity.

## Submission integrity

The scorer hashes the original submission tree, copies it to a temporary directory, builds and runs only the copy, removes the temporary directory, and hashes the original tree again.

Symbolic links and non-UTF-8 review files are rejected.

## Security boundary

Scorer v1 runs submissions as local processes. Use it only for trusted submissions produced in a controlled local benchmark. External or untrusted submissions require a separate container boundary with network and resource restrictions.
