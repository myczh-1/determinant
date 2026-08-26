import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { aggregateResults } from "../scorer/aggregate.mjs";
import { canonicalJson, treeDigest } from "../scorer/common.mjs";
import { benchmarkRoot, scoreAll, scoreSubmission } from "../scorer/score.mjs";

test("canonical JSON ignores object key insertion order", () => {
  assert.equal(canonicalJson({ second: 2, first: { beta: 2, alpha: 1 } }), canonicalJson({ first: { alpha: 1, beta: 2 }, second: 2 }));
});

test("reference direct and AAL submissions have identical passing behavior", async () => {
  const resultsRoot = await mkdtemp(join(tmpdir(), "determinant-benchmark-results-"));
  const scored = await scoreAll({ resultsRoot, filters: { tool: "reference", run: "001" } });
  assert.equal(scored.length, 2);
  for (const { result } of scored) {
    assert.equal(result.build.status, "PASS");
    assert.equal(result.service.status, "PASS");
    assert.equal(result.oracle.passed, 14);
    assert.equal(result.oracle.total, 14);
    assert.equal(result.submissionIntegrity.status, "PASS");
  }
  assert.equal(scored[0].result.behavioralFingerprint, scored[1].result.behavioralFingerprint);

  const summary = await aggregateResults({ resultsRoot });
  assert.equal(summary.totals.fullyPassed, 2);
  assert.equal(summary.pairedComparisons.length, 1);
  assert.equal(summary.pairedComparisons[0].comparable, true);
  assert.match(await readFile(join(resultsRoot, "report.md"), "utf8"), /reference\/001/);
});

test("the frozen oracle rejects a service with the wrong behavior without modifying it", async () => {
  const submissionRoot = join(benchmarkRoot, "test/fixtures/direct-fail");
  const before = await treeDigest(submissionRoot);
  const result = await scoreSubmission({ mode: "direct", tool: "fixture", run: "fail", submissionRoot });
  const after = await treeDigest(submissionRoot);
  assert.equal(result.build.status, "PASS");
  assert.equal(result.service.status, "PASS");
  assert.ok(result.oracle.passed < result.oracle.total);
  assert.equal(result.submissionIntegrity.status, "PASS");
  assert.equal(before, after);
});
