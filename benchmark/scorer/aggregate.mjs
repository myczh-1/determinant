#!/usr/bin/env node
import { readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readJson, writeJson } from "./common.mjs";

const scorerDirectory = dirname(fileURLToPath(import.meta.url));
const benchmarkRoot = resolve(scorerDirectory, "..");
const defaultResultsRoot = join(benchmarkRoot, "results");

export async function aggregateResults(options = {}) {
  const resultsRoot = resolve(options.resultsRoot ?? defaultResultsRoot);
  const results = await readResults(resultsRoot);
  assertCompatibleResults(results);
  const submissions = results.map(summarizeResult);
  const summary = {
    schemaVersion: 1,
    contractDigest: results[0]?.scorer.contractDigest ?? null,
    oracleDigest: results[0]?.scorer.oracleDigest ?? null,
    scorerDigests: [...new Set(results.map((result) => result.scorer.scorerDigest))].sort(),
    totals: summarizeGroup(submissions),
    modes: Object.fromEntries(["direct", "aal"].map((mode) => [mode, summarizeGroup(submissions.filter((submission) => submission.mode === mode))])),
    pairedComparisons: buildPairedComparisons(submissions),
    submissions,
  };
  await writeJson(join(resultsRoot, "summary.json"), summary);
  await writeFile(join(resultsRoot, "report.md"), renderReport(summary), "utf8");
  return summary;
}

function summarizeResult(result) {
  const fullyPassed = result.build.status === "PASS"
    && result.service.status === "PASS"
    && result.oracle.passed === result.oracle.total
    && result.submissionIntegrity.status === "PASS";
  return {
    mode: result.submission.mode,
    tool: result.submission.tool,
    run: result.submission.run,
    resultPath: `benchmark/results/${result.submission.mode}/${result.submission.tool}/${result.submission.run}/result.json`,
    sourceDigest: result.submission.sourceDigest,
    buildStatus: result.build.status,
    serviceStatus: result.service.status,
    oraclePassed: result.oracle.passed,
    oracleTotal: result.oracle.total,
    fullyPassed,
    behavioralFingerprint: result.behavioralFingerprint,
    reviewSurface: result.reviewSurface ? {
      files: result.reviewSurface.total.fileCount,
      bytes: result.reviewSurface.total.bytes,
      lines: result.reviewSurface.total.lines,
      nonBlankLines: result.reviewSurface.total.nonBlankLines,
      digest: result.reviewSurface.total.digest,
    } : null,
    integrityStatus: result.submissionIntegrity.status,
  };
}

function summarizeGroup(submissions) {
  const fullyPassing = submissions.filter((submission) => submission.fullyPassed && submission.reviewSurface);
  return {
    submissions: submissions.length,
    buildPassed: submissions.filter((submission) => submission.buildStatus === "PASS").length,
    serviceStarted: submissions.filter((submission) => submission.serviceStatus === "PASS").length,
    fullyPassed: fullyPassing.length,
    oraclePassed: submissions.reduce((sum, submission) => sum + submission.oraclePassed, 0),
    oracleTotal: submissions.reduce((sum, submission) => sum + submission.oracleTotal, 0),
    medianReviewNonBlankLinesForPassing: median(fullyPassing.map((submission) => submission.reviewSurface.nonBlankLines)),
    medianReviewBytesForPassing: median(fullyPassing.map((submission) => submission.reviewSurface.bytes)),
  };
}

function buildPairedComparisons(submissions) {
  const groups = new Map();
  for (const submission of submissions) {
    const key = `${submission.tool}\0${submission.run}`;
    const group = groups.get(key) ?? { tool: submission.tool, run: submission.run };
    group[submission.mode] = submission;
    groups.set(key, group);
  }
  const result = [];
  for (const group of groups.values()) {
    if (!group.direct || !group.aal) continue;
    const comparable = Boolean(group.direct.fullyPassed && group.aal.fullyPassed && group.direct.reviewSurface && group.aal.reviewSurface);
    result.push({
      tool: group.tool,
      run: group.run,
      comparable,
      directNonBlankLines: group.direct.reviewSurface?.nonBlankLines ?? null,
      aalNonBlankLines: group.aal.reviewSurface?.nonBlankLines ?? null,
      lineReductionPercent: comparable ? reduction(group.direct.reviewSurface.nonBlankLines, group.aal.reviewSurface.nonBlankLines) : null,
      directBytes: group.direct.reviewSurface?.bytes ?? null,
      aalBytes: group.aal.reviewSurface?.bytes ?? null,
      byteReductionPercent: comparable ? reduction(group.direct.reviewSurface.bytes, group.aal.reviewSurface.bytes) : null,
    });
  }
  return result.sort((left, right) => `${left.tool}/${left.run}`.localeCompare(`${right.tool}/${right.run}`, "en"));
}

function renderReport(summary) {
  const lines = [
    "# Benchmark Report",
    "",
    `Contract: \`${summary.contractDigest ?? "none"}\``,
    `Oracle: \`${summary.oracleDigest ?? "none"}\``,
    "",
    "## Overview",
    "",
    "| Mode | Submissions | Build | Start | Full oracle pass | Oracle cases | Median review lines |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const mode of ["direct", "aal"]) {
    const group = summary.modes[mode];
    lines.push(`| ${mode} | ${group.submissions} | ${group.buildPassed} | ${group.serviceStarted} | ${group.fullyPassed} | ${group.oraclePassed}/${group.oracleTotal} | ${formatNullable(group.medianReviewNonBlankLinesForPassing)} |`);
  }
  lines.push(
    "",
    "## Submissions",
    "",
    "| Submission | Build | Start | Oracle | Fully passed | Review files | Non-blank lines | Fingerprint |",
    "| --- | --- | --- | ---: | --- | ---: | ---: | --- |",
  );
  for (const submission of summary.submissions) {
    const name = `${submission.mode}/${submission.tool}/${submission.run}`;
    lines.push(`| ${escapeCell(name)} | ${submission.buildStatus} | ${submission.serviceStatus} | ${submission.oraclePassed}/${submission.oracleTotal} | ${submission.fullyPassed ? "YES" : "NO"} | ${formatNullable(submission.reviewSurface?.files)} | ${formatNullable(submission.reviewSurface?.nonBlankLines)} | ${submission.behavioralFingerprint ? `\`${submission.behavioralFingerprint.slice(7, 19)}\`` : "—"} |`);
  }
  lines.push("", "## Direct vs AAL", "");
  if (summary.pairedComparisons.length === 0) lines.push("No paired submissions.");
  else {
    lines.push(
      "| Tool/run | Comparable | Direct lines | AAL lines | Line reduction | Direct bytes | AAL bytes | Byte reduction |",
      "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    );
    for (const comparison of summary.pairedComparisons) {
      lines.push(`| ${escapeCell(`${comparison.tool}/${comparison.run}`)} | ${comparison.comparable ? "YES" : "NO"} | ${formatNullable(comparison.directNonBlankLines)} | ${formatNullable(comparison.aalNonBlankLines)} | ${formatPercent(comparison.lineReductionPercent)} | ${formatNullable(comparison.directBytes)} | ${formatNullable(comparison.aalBytes)} | ${formatPercent(comparison.byteReductionPercent)} |`);
    }
  }
  lines.push(
    "",
    "Review-surface comparisons are reported only when both paired submissions pass every frozen oracle case.",
    "",
  );
  return lines.join("\n");
}

async function readResults(root) {
  const paths = [];
  async function visit(directory) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (cause) {
      if (cause && cause.code === "ENOENT") return;
      throw cause;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && entry.name === "result.json") paths.push(path);
    }
  }
  await visit(root);
  const results = [];
  for (const path of paths) results.push(await readJson(path));
  return results.sort((left, right) => `${left.submission.mode}/${left.submission.tool}/${left.submission.run}`.localeCompare(`${right.submission.mode}/${right.submission.tool}/${right.submission.run}`, "en"));
}

function assertCompatibleResults(results) {
  const contractDigests = new Set(results.map((result) => result.scorer.contractDigest));
  const oracleDigests = new Set(results.map((result) => result.scorer.oracleDigest));
  if (contractDigests.size > 1) throw new Error("Cannot aggregate results produced by different benchmark contracts");
  if (oracleDigests.size > 1) throw new Error("Cannot aggregate results produced by different frozen oracles");
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function reduction(baseline, candidate) {
  if (baseline === 0) return candidate === 0 ? 0 : null;
  return Math.round(((baseline - candidate) / baseline) * 10000) / 100;
}

function formatNullable(value) {
  return value === null || value === undefined ? "—" : String(value);
}

function formatPercent(value) {
  return value === null || value === undefined ? "—" : `${value}%`;
}

function escapeCell(value) {
  return String(value).replaceAll("|", "\\|");
}

function parseArguments(arguments_) {
  let resultsRoot = defaultResultsRoot;
  for (let index = 0; index < arguments_.length; index += 1) {
    if (arguments_[index] !== "--results" || !arguments_[index + 1]) throw new Error(`Unknown or incomplete option: ${arguments_[index]}`);
    resultsRoot = resolve(arguments_[index + 1]);
    index += 1;
  }
  return { resultsRoot };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const summary = await aggregateResults(parseArguments(process.argv.slice(2)));
  console.log(`Aggregated ${summary.totals.submissions} benchmark result(s).`);
}
