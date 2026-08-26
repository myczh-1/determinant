#!/usr/bin/env node
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import {
  challengeInputs,
  defaultSubmissionsRoot,
  expectedManifest,
  manifestText,
  validateIdentifier,
  validateMode,
} from "./common.mjs";

export async function collectWorkspace(options) {
  const source = resolve(options.source);
  const sourceStat = await lstat(source);
  if (!sourceStat.isDirectory() || sourceStat.isSymbolicLink()) throw new Error(`Workspace must be a real directory: ${source}`);
  const mode = validateMode(options.mode);
  const tool = validateIdentifier("tool", options.tool);
  const run = validateIdentifier("run", options.run);
  const expected = await expectedManifest({ mode, tool, run });
  const actualManifestText = await readFile(join(source, "submission-manifest.json"), "utf8");
  if (actualManifestText !== manifestText(expected)) throw new Error("submission-manifest.json was modified");
  await verifyChallengeInputs(source, mode);
  const outputPaths = await verifyWorkspaceLayout(source, mode);
  await verifyOutputContents(source, mode, outputPaths);

  const submissionsRoot = resolve(options.submissionsRoot ?? defaultSubmissionsRoot);
  const destination = join(submissionsRoot, mode, tool, run);
  await requireAbsent(destination, "Submission already exists");
  await mkdir(dirname(destination), { recursive: true });
  const temporary = await mkdtemp(join(dirname(destination), `.${basename(destination)}.collect-`));
  try {
    for (const path of topLevelOutputs(mode)) {
      await cp(join(source, path), join(temporary, path), { recursive: true, force: false, errorOnExist: true });
    }
    await rename(temporary, destination);
  } catch (cause) {
    await rm(temporary, { recursive: true, force: true });
    throw cause;
  }
  return { source, destination, mode, tool, run };
}

async function verifyChallengeInputs(workspace, mode) {
  for (const input of await challengeInputs(mode)) {
    const actual = await readFile(join(workspace, input.destination));
    if (!actual.equals(input.bytes)) throw new Error(`${input.destination} was modified`);
  }
}

async function verifyWorkspaceLayout(workspace, mode) {
  const outputs = [];
  const frozenNames = new Set([
    ...(await challengeInputs(mode)).map((input) => input.destination),
    "submission-manifest.json",
  ]);
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const entry of entries) {
      const absolute = join(directory, entry.name);
      const path = portableRelative(workspace, absolute);
      if (path === ".git") {
        if (!entry.isDirectory()) throw new Error(".git must remain a directory");
        continue;
      }
      const entryStat = await lstat(absolute);
      if (entryStat.isSymbolicLink()) throw new Error(`Symbolic links are not allowed: ${path}`);
      if (frozenNames.has(path)) {
        if (!entryStat.isFile()) throw new Error(`Frozen input must remain a file: ${path}`);
        continue;
      }
      if (!isAllowedOutput(mode, path, entryStat.isDirectory(), entryStat.isFile())) throw new Error(`Unexpected workspace entry: ${path}`);
      if (entryStat.isDirectory()) await visit(absolute);
      else outputs.push(path);
    }
  }
  await visit(workspace);
  for (const required of requiredOutputs(mode)) {
    const path = join(workspace, required.path);
    let entryStat;
    try {
      entryStat = await lstat(path);
    } catch (cause) {
      if (cause && cause.code === "ENOENT") throw new Error(`Missing required output: ${required.path}`);
      throw cause;
    }
    if (required.kind === "file" && !entryStat.isFile()) throw new Error(`Required output must be a file: ${required.path}`);
    if (required.kind === "directory" && !entryStat.isDirectory()) throw new Error(`Required output must be a directory: ${required.path}`);
  }
  if (mode === "direct" && !outputs.some((path) => path.startsWith("src/"))) throw new Error("src must contain at least one source file");
  return outputs;
}

async function verifyOutputContents(workspace, mode, outputPaths) {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  for (const path of outputPaths) decoder.decode(await readFile(join(workspace, path)));
  if (mode !== "direct") return;
  const packageJson = JSON.parse(await readFile(join(workspace, "package.json"), "utf8"));
  if (typeof packageJson.scripts?.build !== "string" || typeof packageJson.scripts?.start !== "string") {
    throw new Error("package.json must define build and start scripts");
  }
  for (const field of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
    if (packageJson[field] && Object.keys(packageJson[field]).length > 0) throw new Error(`Direct challenge does not allow ${field}`);
  }
  const packageLock = JSON.parse(await readFile(join(workspace, "package-lock.json"), "utf8"));
  if (packageLock.packages && Object.keys(packageLock.packages).some((path) => path !== "")) {
    throw new Error("Direct challenge package-lock.json contains external packages");
  }
  if (packageLock.dependencies && Object.keys(packageLock.dependencies).length > 0) {
    throw new Error("Direct challenge package-lock.json contains external dependencies");
  }
}

function isAllowedOutput(mode, path, isDirectory, isFile) {
  if (path.split("/").some((part) => part.startsWith("."))) return false;
  if (mode === "aal") return path === "app.aal" && isFile;
  if (path === "package.json" || path === "package-lock.json") return isFile;
  if (path === "src") return isDirectory;
  return path.startsWith("src/") && (isDirectory || isFile);
}

function requiredOutputs(mode) {
  return mode === "direct"
    ? [
      { path: "package.json", kind: "file" },
      { path: "package-lock.json", kind: "file" },
      { path: "src", kind: "directory" },
    ]
    : [{ path: "app.aal", kind: "file" }];
}

function topLevelOutputs(mode) {
  return mode === "direct" ? ["package.json", "package-lock.json", "src"] : ["app.aal"];
}

async function requireAbsent(path, prefix) {
  try {
    await lstat(path);
  } catch (cause) {
    if (cause && cause.code === "ENOENT") return;
    throw cause;
  }
  throw new Error(`${prefix}: ${path}`);
}

function portableRelative(root, path) {
  return relative(root, path).split(sep).join("/");
}

function parseArguments(arguments_) {
  const values = { submissions: defaultSubmissionsRoot };
  for (let index = 0; index < arguments_.length; index += 1) {
    const option = arguments_[index];
    const value = arguments_[index + 1];
    if (!["--from", "--mode", "--tool", "--run", "--submissions"].includes(option) || !value) throw new Error(`Unknown or incomplete option: ${option}`);
    values[option.slice(2)] = value;
    index += 1;
  }
  for (const name of ["from", "mode", "tool", "run"]) if (!values[name]) throw new Error(`Missing --${name}`);
  return {
    source: values.from,
    mode: values.mode,
    tool: values.tool,
    run: values.run,
    submissionsRoot: values.submissions,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const collected = await collectWorkspace(parseArguments(process.argv.slice(2)));
  console.log(`Collected ${collected.mode}/${collected.tool}/${collected.run}: ${collected.destination}`);
}
