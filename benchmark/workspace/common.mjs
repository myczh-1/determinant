import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const workspaceDirectory = dirname(fileURLToPath(import.meta.url));
export const benchmarkRoot = resolve(workspaceDirectory, "..");
export const challengeRoot = join(benchmarkRoot, "challenge/v1");
export const defaultSubmissionsRoot = join(benchmarkRoot, "submissions");

const modeInputs = {
  direct: [
    { source: "TASK.md", destination: "TASK.md" },
    { source: "direct/AGENTS.md", destination: "AGENTS.md" },
  ],
  aal: [
    { source: "TASK.md", destination: "TASK.md" },
    { source: "aal/AGENTS.md", destination: "AGENTS.md" },
    { source: "aal/AAL-REFERENCE.md", destination: "AAL-REFERENCE.md" },
  ],
};

const allowedOutputs = {
  direct: ["package.json", "package-lock.json", "src/**"],
  aal: ["app.aal"],
};

export function validateMode(mode) {
  if (!Object.hasOwn(modeInputs, mode)) throw new Error(`Unsupported mode: ${mode}`);
  return mode;
}

export function validateIdentifier(label, value) {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9.-]*$/u.test(value) || value.includes("..")) {
    throw new Error(`${label} must use lowercase letters, numbers, dots, and hyphens without '..': ${value ?? ""}`);
  }
  return value;
}

export async function challengeInputs(mode) {
  validateMode(mode);
  const inputs = [];
  for (const descriptor of modeInputs[mode]) {
    const bytes = await readFile(join(challengeRoot, descriptor.source));
    inputs.push({
      ...descriptor,
      bytes,
      digest: sha256(bytes),
    });
  }
  return inputs;
}

export async function expectedManifest({ mode, tool, run }) {
  validateMode(mode);
  validateIdentifier("tool", tool);
  validateIdentifier("run", run);
  const inputs = await challengeInputs(mode);
  const inputRecords = inputs.map(({ destination, digest }) => ({ path: destination, digest }));
  return {
    schemaVersion: 1,
    challenge: "http-crud-v1",
    mode,
    tool,
    run,
    challengeDigest: sha256(canonicalJson(inputRecords)),
    inputs: inputRecords,
    allowedOutputs: allowedOutputs[mode],
  };
}

export function manifestText(manifest) {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}
