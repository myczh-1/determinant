import { createHash } from "node:crypto";
import { cp, lstat, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { createServer, createConnection } from "node:net";
import { dirname, join, relative, resolve, sep } from "node:path";

const OUTPUT_LIMIT = 64 * 1024;

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

export function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

export async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function treeDigest(root) {
  const entries = await walkTree(root, true);
  const hash = createHash("sha256");
  for (const entry of entries) {
    hash.update(entry.kind);
    hash.update("\0");
    hash.update(entry.path);
    hash.update("\0");
    hash.update(entry.mode.toString(8));
    hash.update("\0");
    if (entry.kind === "file") hash.update(await readFile(join(root, fromPortablePath(entry.path))));
    hash.update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}

export async function copySubmission(source, target) {
  await assertNoSymlinks(source);
  await cp(source, target, { recursive: true, force: false, errorOnExist: true });
}

export async function removeDirectory(path) {
  await rm(path, { recursive: true, force: true });
}

export async function requireSubmissionPaths(root, paths) {
  const missing = [];
  for (const path of paths) {
    try {
      await stat(join(root, fromPortablePath(path)));
    } catch {
      missing.push(path);
    }
  }
  return missing;
}

export async function collectReviewSurface(root, policy) {
  const primaryFiles = await collectPolicyFiles(root, policy.primary ?? []);
  const bindingFiles = await collectPolicyFiles(root, policy.binding ?? [], true);
  const operationalFiles = await collectPolicyFiles(root, policy.operational ?? [], true);
  const primary = await measureFiles(root, primaryFiles);
  const binding = await measureFiles(root, bindingFiles);
  const operational = await measureFiles(root, operationalFiles);
  const total = await measureFiles(root, [...new Set([...primaryFiles, ...bindingFiles])].sort());
  return { primary, binding, operational, total };
}

export async function runCommand(command, options) {
  const { spawn } = await import("node:child_process");
  const child = spawn(command[0], command.slice(1), {
    cwd: options.cwd,
    env: options.env ?? process.env,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = captureOutput(child);
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    void terminateProcess(child, options.stopTimeoutMs ?? 3000);
  }, options.timeoutMs);
  const completion = await waitForExit(child);
  clearTimeout(timeout);
  return { ...completion, timedOut, ...output.read() };
}

export async function startProcess(command, options) {
  const { spawn } = await import("node:child_process");
  const child = spawn(command[0], command.slice(1), {
    cwd: options.cwd,
    env: options.env ?? process.env,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = captureOutput(child);
  return { child, output };
}

export async function terminateProcess(child, graceMs) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  signalProcess(child, "SIGTERM");
  const exited = await Promise.race([
    waitForExit(child).then(() => true),
    delay(graceMs).then(() => false),
  ]);
  if (!exited) signalProcess(child, "SIGKILL");
  await Promise.race([waitForExit(child), delay(1000)]);
}

export async function getFreePort(host) {
  const server = createServer();
  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, host, resolvePromise);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolvePromise, reject) => server.close((cause) => cause ? reject(cause) : resolvePromise()));
  return port;
}

export async function waitForTcp(host, port, child, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.benchmarkSpawnError || child.exitCode !== null || child.signalCode !== null) return false;
    if (await canConnect(host, port)) return true;
    await delay(50);
  }
  return false;
}

export function portableRelative(root, path) {
  return relative(root, path).split(sep).join("/");
}

function canonicalTextMetrics(text) {
  const normalized = text.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  const records = normalized.length === 0 ? [] : normalized.split("\n");
  if (records.at(-1) === "") records.pop();
  return {
    lines: records.length,
    nonBlankLines: records.filter((line) => line.trim().length > 0).length,
  };
}

async function measureFiles(root, files) {
  const measured = [];
  for (const path of files) {
    const bytes = await readFile(join(root, fromPortablePath(path)));
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const metrics = canonicalTextMetrics(text);
    measured.push({ path, bytes: bytes.length, ...metrics, digest: sha256(bytes) });
  }
  return {
    fileCount: measured.length,
    bytes: measured.reduce((sum, file) => sum + file.bytes, 0),
    lines: measured.reduce((sum, file) => sum + file.lines, 0),
    nonBlankLines: measured.reduce((sum, file) => sum + file.nonBlankLines, 0),
    digest: sha256(canonicalJson(measured.map(({ path, digest }) => ({ path, digest })))),
    files: measured,
  };
}

async function collectPolicyFiles(root, targets, optional = false) {
  const files = new Set();
  for (const target of targets) {
    const absolute = join(root, fromPortablePath(target));
    let targetStat;
    try {
      targetStat = await lstat(absolute);
    } catch (cause) {
      if (optional && cause && cause.code === "ENOENT") continue;
      throw cause;
    }
    if (targetStat.isSymbolicLink()) throw new Error(`Symbolic links are not allowed: ${target}`);
    if (targetStat.isFile()) files.add(target);
    else if (targetStat.isDirectory()) {
      for (const entry of await walkTree(absolute, false)) if (entry.kind === "file") files.add(`${target}/${entry.path}`);
    } else throw new Error(`Unsupported review-surface entry: ${target}`);
  }
  return [...files].sort();
}

async function assertNoSymlinks(root) {
  await walkTree(root, true);
}

async function walkTree(root, includeDirectories) {
  const result = [];
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const entry of entries) {
      const absolute = join(directory, entry.name);
      const path = portableRelative(root, absolute);
      const entryStat = await lstat(absolute);
      if (entryStat.isSymbolicLink()) throw new Error(`Symbolic links are not allowed: ${path}`);
      if (entryStat.isDirectory()) {
        if (includeDirectories) result.push({ kind: "directory", path, mode: entryStat.mode & 0o777 });
        await visit(absolute);
      } else if (entryStat.isFile()) {
        result.push({ kind: "file", path, mode: entryStat.mode & 0o777 });
      } else throw new Error(`Unsupported submission entry: ${path}`);
    }
  }
  await visit(resolve(root));
  return result;
}

function fromPortablePath(path) {
  return path.split("/").join(sep);
}

function captureOutput(child) {
  let stdout = "";
  let stderr = "";
  let spawnError = null;
  child.stdout?.on("data", (chunk) => { stdout = appendLimited(stdout, chunk.toString()); });
  child.stderr?.on("data", (chunk) => { stderr = appendLimited(stderr, chunk.toString()); });
  child.once("error", (cause) => {
    spawnError = cause instanceof Error ? cause.message : String(cause);
    child.benchmarkSpawnError = spawnError;
  });
  return { read: () => ({ stdout, stderr, spawnError }) };
}

function appendLimited(current, addition) {
  const combined = current + addition;
  return combined.length <= OUTPUT_LIMIT ? combined : combined.slice(-OUTPUT_LIMIT);
}

function waitForExit(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ exitCode: child.exitCode, signal: child.signalCode, spawnError: null });
  }
  return new Promise((resolvePromise) => {
    let spawnError = null;
    child.once("error", (cause) => { spawnError = cause instanceof Error ? cause.message : String(cause); });
    child.once("close", (exitCode, signal) => resolvePromise({ exitCode, signal, spawnError }));
  });
}

function signalProcess(child, signal) {
  try {
    if (!child.pid || process.platform === "win32") child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch (cause) {
    if (!cause || cause.code !== "ESRCH") throw cause;
  }
}

function canConnect(host, port) {
  return new Promise((resolvePromise) => {
    const socket = createConnection({ host, port });
    socket.setTimeout(250);
    socket.once("connect", () => { socket.destroy(); resolvePromise(true); });
    socket.once("timeout", () => { socket.destroy(); resolvePromise(false); });
    socket.once("error", () => resolvePromise(false));
  });
}

function delay(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}
