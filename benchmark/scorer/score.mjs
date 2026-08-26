#!/usr/bin/env node
import { mkdtemp, mkdir, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  canonicalJson,
  collectReviewSurface,
  copySubmission,
  getFreePort,
  readJson,
  removeDirectory,
  requireSubmissionPaths,
  runCommand,
  sha256,
  startProcess,
  terminateProcess,
  treeDigest,
  waitForTcp,
  writeJson,
} from "./common.mjs";

const scorerDirectory = dirname(fileURLToPath(import.meta.url));
export const repositoryRoot = resolve(scorerDirectory, "../..");
export const benchmarkRoot = join(repositoryRoot, "benchmark");
const defaultSubmissionsRoot = join(benchmarkRoot, "submissions");
const defaultResultsRoot = join(benchmarkRoot, "results");
const contractPath = join(benchmarkRoot, "contract.v1.json");
const oraclePath = join(benchmarkRoot, "oracle/v1/cases.json");

export async function scoreSubmission(options) {
  const contract = options.contract ?? await readJson(contractPath);
  const oracle = options.oracle ?? await readJson(oraclePath);
  const contractDigest = options.contractDigest ?? sha256(await readFile(contractPath));
  const oracleDigest = options.oracleDigest ?? sha256(await readFile(oraclePath));
  const scorerDigest = options.scorerDigest ?? await calculateScorerDigest();
  const submissionRoot = resolve(options.submissionRoot);
  const modeContract = contract[options.mode];
  if (!modeContract) throw new Error(`Unsupported benchmark mode: ${options.mode}`);

  let sourceDigest;
  let reviewSurface;
  try {
    sourceDigest = await treeDigest(submissionRoot);
    reviewSurface = await collectReviewSurface(submissionRoot, modeContract.review);
  } catch (cause) {
    return invalidSubmissionResult(options, contract, oracle, contractDigest, oracleDigest, scorerDigest, cause);
  }

  const base = {
    schemaVersion: 1,
    submission: {
      mode: options.mode,
      tool: options.tool,
      run: options.run,
      path: `benchmark/submissions/${options.mode}/${options.tool}/${options.run}`,
      sourceDigest,
    },
    scorer: {
      version: 1,
      contractName: contract.name,
      contractDigest,
      oracleName: oracle.name,
      oracleDigest,
      scorerDigest,
    },
  };

  const missing = await requireSubmissionPaths(submissionRoot, modeContract.required);
  if (missing.length > 0) {
    return {
      ...base,
      build: { status: "FAIL", reason: "MISSING_REQUIRED_PATHS", missing },
      service: { status: "FAIL", reason: "BUILD_FAILED" },
      oracle: notRunOracle(oracle, "BUILD_FAILED"),
      behavioralFingerprint: null,
      reviewSurface,
      submissionIntegrity: { status: "PASS", before: sourceDigest, after: sourceDigest },
    };
  }

  const temporaryRoot = await mkdtemp(join(tmpdir(), "determinant-benchmark-"));
  const workingRoot = join(temporaryRoot, "submission");
  let build = { status: "FAIL", reason: "NOT_RUN" };
  let service = { status: "FAIL", reason: "NOT_RUN" };
  let oracleResult = notRunOracle(oracle, "NOT_RUN");
  let behavioralFingerprint = null;
  try {
    await copySubmission(submissionRoot, workingRoot);
    build = options.mode === "direct"
      ? await buildDirect(workingRoot, modeContract, contract)
      : await buildAal(workingRoot, modeContract, contract);

    if (build.status === "PASS") {
      const execution = await startAndScore({
        mode: options.mode,
        workingRoot,
        modeContract,
        contract,
        oracle,
        oracleDigest,
      });
      service = execution.service;
      oracleResult = execution.oracle;
      behavioralFingerprint = execution.behavioralFingerprint;
    } else {
      service = { status: "FAIL", reason: "BUILD_FAILED" };
      oracleResult = notRunOracle(oracle, "BUILD_FAILED");
    }
  } finally {
    await removeDirectory(temporaryRoot);
  }

  const afterDigest = await treeDigest(submissionRoot);
  const integrityStatus = afterDigest === sourceDigest ? "PASS" : "FAIL";
  return {
    ...base,
    build,
    service,
    oracle: oracleResult,
    behavioralFingerprint,
    reviewSurface,
    submissionIntegrity: { status: integrityStatus, before: sourceDigest, after: afterDigest },
  };
}

export async function scoreAll(options = {}) {
  const submissionsRoot = resolve(options.submissionsRoot ?? defaultSubmissionsRoot);
  const resultsRoot = resolve(options.resultsRoot ?? defaultResultsRoot);
  const contract = await readJson(contractPath);
  const oracle = await readJson(oraclePath);
  const contractDigest = sha256(await readFile(contractPath));
  const oracleDigest = sha256(await readFile(oraclePath));
  const scorerDigest = await calculateScorerDigest();
  const submissions = await discoverSubmissions(submissionsRoot, options.filters ?? {});
  const results = [];
  for (const submission of submissions) {
    const result = await scoreSubmission({
      ...submission,
      contract,
      oracle,
      contractDigest,
      oracleDigest,
      scorerDigest,
    });
    const outputPath = join(resultsRoot, submission.mode, submission.tool, submission.run, "result.json");
    await writeJson(outputPath, result);
    results.push({ outputPath, result });
    const label = `${submission.mode}/${submission.tool}/${submission.run}`;
    console.log(`${result.oracle.passed === result.oracle.total ? "PASS" : "FAIL"} ${label} (${result.oracle.passed}/${result.oracle.total})`);
  }
  return results;
}

async function buildDirect(workingRoot, modeContract, contract) {
  const prepare = await runCommand(modeContract.prepare, commandOptions(workingRoot, contract.timeoutsMs.prepare, contract));
  if (!commandPassed(prepare)) return { status: "FAIL", stage: "prepare", ...commandSummary(prepare) };
  const compile = await runCommand(modeContract.build, commandOptions(workingRoot, contract.timeoutsMs.build, contract));
  if (!commandPassed(compile)) return { status: "FAIL", stage: "build", ...commandSummary(compile) };
  return {
    status: "PASS",
    stages: [
      { name: "prepare", exitCode: prepare.exitCode },
      { name: "build", exitCode: compile.exitCode },
    ],
  };
}

async function buildAal(workingRoot, modeContract, contract) {
  const generatedDirectory = join(workingRoot, ".benchmark-build");
  await mkdir(generatedDirectory, { recursive: true });
  const source = join(workingRoot, modeContract.source);
  const generated = join(generatedDirectory, "application.ts");
  const compileCommand = [process.execPath, join(repositoryRoot, "bin/determinant.mjs"), source, "--out", generated];
  const bindingPath = join(workingRoot, modeContract.binding);
  try {
    await readFile(bindingPath);
    compileCommand.push("--binding", bindingPath);
  } catch {
    // Binding is optional by contract.
  }
  const compile = await runCommand(compileCommand, commandOptions(workingRoot, contract.timeoutsMs.build, contract));
  if (!commandPassed(compile)) return { status: "FAIL", stage: "compile", ...commandSummary(compile) };
  const typeCheck = await runCommand([
    process.execPath,
    join(repositoryRoot, "node_modules/typescript/bin/tsc"),
    "--strict",
    "--target", "ES2022",
    "--module", "NodeNext",
    "--moduleResolution", "NodeNext",
    "--skipLibCheck",
    "--noEmit",
    generated,
  ], commandOptions(workingRoot, contract.timeoutsMs.build, contract));
  if (!commandPassed(typeCheck)) return { status: "FAIL", stage: "typecheck", ...commandSummary(typeCheck) };
  return {
    status: "PASS",
    stages: [
      { name: "compile", exitCode: compile.exitCode },
      { name: "typecheck", exitCode: typeCheck.exitCode },
    ],
  };
}

async function startAndScore({ mode, workingRoot, modeContract, contract, oracle, oracleDigest }) {
  const port = await getFreePort(contract.host);
  const environment = {
    ...process.env,
    BENCHMARK_HOST: contract.host,
    BENCHMARK_PORT: String(port),
  };
  const command = mode === "direct"
    ? modeContract.start
    : await aalStartCommand(workingRoot, modeContract, contract.host, port);
  const processHandle = await startProcess(command, { cwd: workingRoot, env: environment });
  try {
    const ready = await waitForTcp(contract.host, port, processHandle.child, contract.timeoutsMs.start);
    if (!ready) {
      const output = processHandle.output.read();
      return {
        service: {
          status: "FAIL",
          reason: output.spawnError ? "SPAWN_ERROR" : processHandle.child.exitCode === null ? "START_TIMEOUT" : "PROCESS_EXITED",
          exitCode: processHandle.child.exitCode,
          ...(output.spawnError ? { detail: output.spawnError } : {}),
          ...failureOutput(output),
        },
        oracle: notRunOracle(oracle, "SERVICE_NOT_STARTED"),
        behavioralFingerprint: null,
      };
    }
    const oracleResult = await runOracle(oracle, oracleDigest, contract.host, port, contract.timeoutsMs.request);
    return {
      service: { status: "PASS" },
      oracle: oracleResult.oracle,
      behavioralFingerprint: oracleResult.fingerprint,
    };
  } finally {
    await terminateProcess(processHandle.child, contract.timeoutsMs.stop);
  }
}

async function aalStartCommand(workingRoot, modeContract, host, port) {
  const source = join(workingRoot, modeContract.source);
  const command = [process.execPath, join(repositoryRoot, "bin/determinant.mjs"), "run", source, "--host", host, "--port", String(port)];
  const binding = join(workingRoot, modeContract.binding);
  try {
    await readFile(binding);
    command.push("--binding", binding);
  } catch {
    // Binding is optional by contract.
  }
  return command;
}

async function runOracle(oracle, oracleDigest, host, port, timeoutMs) {
  const caseResults = [];
  const transcript = [];
  for (const testCase of oracle.cases) {
    const observed = await performRequest(testCase.request, host, port, timeoutMs);
    const failures = compareOutcome(observed, testCase.expect);
    caseResults.push({
      id: testCase.id,
      status: failures.length === 0 ? "PASS" : "FAIL",
      ...(failures.length > 0 ? { failures } : {}),
      observed,
    });
    transcript.push({ id: testCase.id, observed });
  }
  const passed = caseResults.filter((testCase) => testCase.status === "PASS").length;
  return {
    oracle: { passed, total: caseResults.length, cases: caseResults },
    fingerprint: sha256(canonicalJson({ oracleDigest, cases: transcript })),
  };
}

async function performRequest(request, host, port, timeoutMs) {
  const headers = { ...(request.headers ?? {}) };
  let body;
  if (Object.hasOwn(request, "json")) {
    headers["content-type"] ??= "application/json";
    body = JSON.stringify(request.json);
  } else if (Object.hasOwn(request, "rawBody")) body = request.rawBody;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`http://${host}:${port}${request.path}`, {
      method: request.method,
      headers,
      body,
      signal: controller.signal,
    });
    const text = await response.text();
    let responseBody;
    if (text.length === 0) responseBody = { kind: "absent" };
    else {
      try {
        responseBody = { kind: "json", value: JSON.parse(text) };
      } catch {
        responseBody = { kind: "text", value: text };
      }
    }
    return {
      kind: "response",
      status: response.status,
      contentType: normalizeContentType(response.headers.get("content-type")),
      body: responseBody,
    };
  } catch (cause) {
    return { kind: cause && cause.name === "AbortError" ? "timeout" : "network-error" };
  } finally {
    clearTimeout(timeout);
  }
}

function compareOutcome(observed, expected) {
  if (observed.kind !== "response") return [`EXPECTED_RESPONSE_GOT_${observed.kind.toUpperCase().replaceAll("-", "_")}`];
  const failures = [];
  if (observed.status !== expected.status) failures.push("STATUS_MISMATCH");
  if (expected.bodyAbsent === true && observed.body.kind !== "absent") failures.push("EXPECTED_ABSENT_BODY");
  if (Object.hasOwn(expected, "json")) {
    if (observed.body.kind !== "json") failures.push("EXPECTED_JSON_BODY");
    else if (canonicalJson(observed.body.value) !== canonicalJson(expected.json)) failures.push("JSON_BODY_MISMATCH");
  }
  if (expected.contentType && observed.contentType !== expected.contentType) failures.push("CONTENT_TYPE_MISMATCH");
  return failures;
}

function invalidSubmissionResult(options, contract, oracle, contractDigest, oracleDigest, scorerDigest, cause) {
  const reason = cause instanceof Error ? cause.message : String(cause);
  return {
    schemaVersion: 1,
    submission: {
      mode: options.mode,
      tool: options.tool,
      run: options.run,
      path: `benchmark/submissions/${options.mode}/${options.tool}/${options.run}`,
      sourceDigest: null,
    },
    scorer: {
      version: 1,
      contractName: contract.name,
      contractDigest,
      oracleName: oracle.name,
      oracleDigest,
      scorerDigest,
    },
    build: { status: "FAIL", reason: "INVALID_SUBMISSION", detail: reason },
    service: { status: "FAIL", reason: "BUILD_FAILED" },
    oracle: notRunOracle(oracle, "BUILD_FAILED"),
    behavioralFingerprint: null,
    reviewSurface: null,
    submissionIntegrity: { status: "FAIL", reason: "SOURCE_NOT_AUDITABLE" },
  };
}

function notRunOracle(oracle, reason) {
  return {
    passed: 0,
    total: oracle.cases.length,
    cases: oracle.cases.map((testCase) => ({ id: testCase.id, status: "FAIL", failures: [reason] })),
  };
}

function commandOptions(cwd, timeoutMs, contract) {
  return { cwd, timeoutMs, stopTimeoutMs: contract.timeoutsMs.stop, env: process.env };
}

function commandPassed(result) {
  return !result.timedOut && !result.spawnError && result.exitCode === 0;
}

function commandSummary(result) {
  return {
    exitCode: result.exitCode,
    ...(result.signal ? { signal: result.signal } : {}),
    ...(result.timedOut ? { reason: "TIMEOUT" } : {}),
    ...(result.spawnError ? { reason: "SPAWN_ERROR", detail: result.spawnError } : {}),
    ...failureOutput(result),
  };
}

function failureOutput(output) {
  return {
    ...(output.stdout?.trim() ? { stdout: output.stdout.trim().slice(-4000) } : {}),
    ...(output.stderr?.trim() ? { stderr: output.stderr.trim().slice(-4000) } : {}),
  };
}

function normalizeContentType(value) {
  return value ? value.split(";", 1)[0].trim().toLowerCase() : null;
}

async function discoverSubmissions(root, filters) {
  const result = [];
  for (const mode of await childDirectories(root)) {
    if (filters.mode && filters.mode !== mode) continue;
    for (const tool of await childDirectories(join(root, mode))) {
      if (filters.tool && filters.tool !== tool) continue;
      for (const run of await childDirectories(join(root, mode, tool))) {
        if (filters.run && filters.run !== run) continue;
        result.push({ mode, tool, run, submissionRoot: join(root, mode, tool, run) });
      }
    }
  }
  return result.sort((left, right) => `${left.mode}/${left.tool}/${left.run}`.localeCompare(`${right.mode}/${right.tool}/${right.run}`, "en"));
}

async function childDirectories(root) {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith(".")).map((entry) => entry.name).sort((left, right) => left.localeCompare(right, "en"));
  } catch (cause) {
    if (cause && cause.code === "ENOENT") return [];
    throw cause;
  }
}

async function calculateScorerDigest() {
  const hashInput = [];
  for (const name of ["common.mjs", "score.mjs"]) {
    hashInput.push(name, "\0", await readFile(join(scorerDirectory, name)), "\0");
  }
  return sha256(Buffer.concat(hashInput.map((value) => Buffer.isBuffer(value) ? value : Buffer.from(value))));
}

function parseArguments(arguments_) {
  const filters = {};
  let submissionsRoot = defaultSubmissionsRoot;
  let resultsRoot = defaultResultsRoot;
  for (let index = 0; index < arguments_.length; index += 1) {
    const option = arguments_[index];
    const value = arguments_[index + 1];
    if (["--mode", "--tool", "--run", "--submissions", "--results"].includes(option) && !value) throw new Error(`Missing value for ${option}`);
    if (option === "--mode") { filters.mode = value; index += 1; }
    else if (option === "--tool") { filters.tool = value; index += 1; }
    else if (option === "--run") { filters.run = value; index += 1; }
    else if (option === "--submissions") { submissionsRoot = resolve(value); index += 1; }
    else if (option === "--results") { resultsRoot = resolve(value); index += 1; }
    else throw new Error(`Unknown option: ${option}`);
  }
  return { filters, submissionsRoot, resultsRoot };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const options = parseArguments(process.argv.slice(2));
  const results = await scoreAll(options);
  if (results.length === 0) console.log("No benchmark submissions found.");
}
