#!/usr/bin/env node
import { execFile } from "node:child_process";
import { lstat, mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { challengeInputs, expectedManifest, manifestText, validateIdentifier, validateMode } from "./common.mjs";

const executeFile = promisify(execFile);

export async function prepareWorkspace(options) {
  const mode = validateMode(options.mode);
  const tool = validateIdentifier("tool", options.tool);
  const run = validateIdentifier("run", options.run);
  const output = resolve(options.output);
  await requireAbsent(output);
  await mkdir(dirname(output), { recursive: true });
  const temporary = await mkdtemp(join(dirname(output), `.${basename(output)}.prepare-`));
  try {
    for (const input of await challengeInputs(mode)) {
      await writeFile(join(temporary, input.destination), input.bytes, { flag: "wx" });
    }
    const manifest = await expectedManifest({ mode, tool, run });
    await writeFile(join(temporary, "submission-manifest.json"), manifestText(manifest), { encoding: "utf8", flag: "wx" });
    await initializeGit(temporary);
    await rename(temporary, output);
    return { output, manifest };
  } catch (cause) {
    await rm(temporary, { recursive: true, force: true });
    throw cause;
  }
}

async function initializeGit(directory) {
  await executeFile("git", ["init", "--quiet", "--initial-branch=main"], { cwd: directory });
  await executeFile("git", ["add", "--all"], { cwd: directory });
  await executeFile("git", [
    "-c", "user.name=Determinant Benchmark",
    "-c", "user.email=benchmark@invalid.local",
    "commit", "--quiet", "-m", "Initialize isolated benchmark workspace",
  ], { cwd: directory });
}

async function requireAbsent(path) {
  try {
    await lstat(path);
  } catch (cause) {
    if (cause && cause.code === "ENOENT") return;
    throw cause;
  }
  throw new Error(`Workspace already exists: ${path}`);
}

function parseArguments(arguments_) {
  const values = {};
  for (let index = 0; index < arguments_.length; index += 1) {
    const option = arguments_[index];
    const value = arguments_[index + 1];
    if (!["--mode", "--tool", "--run", "--out"].includes(option) || !value) throw new Error(`Unknown or incomplete option: ${option}`);
    values[option.slice(2)] = value;
    index += 1;
  }
  for (const name of ["mode", "tool", "run", "out"]) if (!values[name]) throw new Error(`Missing --${name}`);
  return { mode: values.mode, tool: values.tool, run: values.run, output: values.out };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const prepared = await prepareWorkspace(parseArguments(process.argv.slice(2)));
  console.log(`Prepared isolated ${prepared.manifest.mode} workspace: ${prepared.output}`);
}
