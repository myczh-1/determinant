import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { compileAAL, formatDiagnostic, parseBinding } from "../dist/index.js";

const source = readFileSync(new URL("../examples/items/app.aal", import.meta.url), "utf8");
const bindingSource = readFileSync(new URL("../examples/items/binding.json", import.meta.url), "utf8");
const binding = parseBinding(bindingSource).spec;
assert.ok(binding);

test("HTTP CRUD works without a Binding", () => {
  const result = compileAAL(source);
  assert.equal(result.diagnostics.length, 0, result.diagnostics.map(formatDiagnostic).join("\n"));
  assert.ok(result.code);
  const application = compileGenerated(result.code, "items-implicit");
  application.resetStore();

  assert.deepEqual(request(application, "POST", "/items", { id: 1, name: "Book" }), {
    status: 201,
    body: { item: { id: 1, name: "Book" } },
  });
  assert.deepEqual(request(application, "POST", "/items", { id: 1, name: "Duplicate" }), {
    status: 409,
    body: { error: "Item already exists" },
  });
  assert.deepEqual(request(application, "GET", "/items/1"), {
    status: 200,
    body: { item: { id: 1, name: "Book" } },
  });
  assert.deepEqual(request(application, "GET", "/items/2"), {
    status: 404,
    body: { error: "Item not found" },
  });
  assert.deepEqual(request(application, "PUT", "/items/1", { name: "Notebook" }), {
    status: 200,
    body: { item: { id: 1, name: "Notebook" } },
  });
  assert.deepEqual(request(application, "PUT", "/items/2", { name: "Missing" }), {
    status: 404,
    body: { error: "Item not found" },
  });
  assert.deepEqual(request(application, "DELETE", "/items/1"), { status: 204 });
  assert.deepEqual(request(application, "GET", "/items/1"), {
    status: 404,
    body: { error: "Item not found" },
  });
});

test("HTTP input validation returns 400", () => {
  const result = compileAAL(source);
  assert.ok(result.code);
  const application = compileGenerated(result.code, "items-input");
  application.resetStore();
  assert.equal(request(application, "POST", "/items", { id: "1", name: "Book" }).status, 400);
  assert.equal(request(application, "POST", "/items", { id: 1 }).status, 400);
  assert.equal(request(application, "GET", "/items/not-an-integer").status, 400);
  assert.equal(request(application, "GET", "/unknown").status, 404);
});

test("HTTP generation is deterministic and explicit Binding only changes program-facing names", () => {
  const first = compileAAL(source);
  const second = compileAAL(source);
  assert.equal(first.code, second.code);
  assert.ok(first.code?.includes("function CreateItem"));

  const explicit = compileAAL(source, { binding });
  assert.equal(explicit.diagnostics.length, 0, explicit.diagnostics.map(formatDiagnostic).join("\n"));
  assert.ok(explicit.code?.includes("function createItemRecord"));
  assert.ok(explicit.code?.includes('"itemId"'));
  const application = compileGenerated(explicit.code, "items-explicit");
  application.resetStore();
  assert.deepEqual(request(application, "POST", "/items", { id: 1, name: "Book" }), {
    status: 201,
    body: { item: { id: 1, name: "Book" } },
  });
});

test("HTTP request fields can use local aliases", () => {
  const aliased = source.replace(
    "    request body:\n        id\n        name",
    "    request body:\n        item_id as id\n        display_name as name",
  );
  const result = compileAAL(aliased);
  assert.equal(result.diagnostics.length, 0, result.diagnostics.map(formatDiagnostic).join("\n"));
  assert.ok(result.code);
  const application = compileGenerated(result.code, "items-alias");
  application.resetStore();
  assert.equal(request(application, "POST", "/items", { item_id: 1, display_name: "Book" }).status, 201);
  assert.equal(request(application, "POST", "/items", { id: 2, name: "Wrong names" }).status, 400);
});

test("CRUD semantic checks protect identity and delete provenance", () => {
  const missingIdentity = compileAAL(source.replace("\n    identity:\n        id\n", "\n"));
  assert.ok(missingIdentity.diagnostics.some((diagnostic) => diagnostic.message.includes("must declare identity")));
  assert.equal(missingIdentity.code, null);

  const changedIdentity = compileAAL(source.replace("    change:\n        item's name = name", "    change:\n        item's id = id"));
  assert.ok(changedIdentity.diagnostics.some((diagnostic) => diagnostic.message.includes("identity fields cannot be changed")));
  assert.equal(changedIdentity.code, null);

  const deletedInput = compileAAL(source.replace("    delete:\n        item", "    delete:\n        id"));
  assert.ok(deletedInput.diagnostics.some((diagnostic) => diagnostic.message.includes("created or queried")));
  assert.equal(deletedInput.code, null);
});

test("the Node HTTP shell rejects invalid JSON", async () => {
  const child = spawn(process.execPath, ["bin/determinant.mjs", "run", "examples/items/app.aal", "--host", "127.0.0.1", "--port", "0"], {
    cwd: new URL("..", import.meta.url),
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    const port = await waitForPort(child);
    const response = await fetch(`http://127.0.0.1:${port}/items`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{bad",
    });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "Invalid JSON" });
  } finally {
    child.kill("SIGTERM");
  }
});

function request(application, method, path, body) {
  return application.handleHttpRequest({ method, path, body });
}

function compileGenerated(code, name) {
  const root = mkdtempSync(join(tmpdir(), `determinant-${name}-`));
  const generatedPath = join(root, "application.ts");
  const outputDirectory = join(root, "out");
  writeFileSync(generatedPath, code, "utf8");
  execFileSync("tsc", ["--strict", "--target", "ES2022", "--module", "commonjs", "--moduleResolution", "node", "--skipLibCheck", "--outDir", outputDirectory, generatedPath], { stdio: "pipe" });
  return createRequire(import.meta.url)(join(outputDirectory, "application.js"));
}

function waitForPort(child) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => reject(new Error(`HTTP server did not start. ${stderr}`)), 10_000);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      const match = /HTTP server listening at http:\/\/127\.0\.0\.1:(\d+)/u.exec(stdout);
      if (match) {
        clearTimeout(timeout);
        resolve(Number(match[1]));
      }
    });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("exit", (code) => {
      if (code !== null && !/HTTP server listening/u.test(stdout)) {
        clearTimeout(timeout);
        reject(new Error(`HTTP server exited with ${code}. ${stderr}`));
      }
    });
  });
}
