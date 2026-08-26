import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { collectWorkspace } from "../workspace/collect.mjs";
import { prepareWorkspace } from "../workspace/prepare.mjs";

const executeFile = promisify(execFile);

test("prepare creates a standalone Direct workspace and collect imports only implementation files", async (context) => {
  const root = await temporaryRoot(context);
  const workspace = join(root, "workspace");
  const submissions = join(root, "submissions");
  const prepared = await prepareWorkspace({ mode: "direct", tool: "example-tool", run: "001", output: workspace });
  assert.equal(prepared.manifest.mode, "direct");
  assert.equal(
    await realpath((await executeFile("git", ["rev-parse", "--show-toplevel"], { cwd: workspace })).stdout.trim()),
    await realpath(workspace),
  );
  assert.deepEqual((await visibleEntries(workspace)).sort(), ["AGENTS.md", "TASK.md", "submission-manifest.json"]);
  assert.doesNotMatch(await readFile(join(workspace, "TASK.md"), "utf8"), /benchmark\/oracle|benchmark\/scorer|examples\/items/u);

  await writeDirectOutput(workspace);
  const collected = await collectWorkspace({
    source: workspace,
    mode: "direct",
    tool: "example-tool",
    run: "001",
    submissionsRoot: submissions,
  });
  assert.deepEqual(await visibleEntries(collected.destination), ["package-lock.json", "package.json", "src"]);
  await assert.rejects(readFile(join(collected.destination, "TASK.md")), /ENOENT/u);
  assert.equal(await readFile(join(collected.destination, "src/server.mjs"), "utf8"), "export {};\n");
});

test("prepare gives AAL mode only its local language reference", async (context) => {
  const root = await temporaryRoot(context);
  const workspace = join(root, "workspace");
  const submissions = join(root, "submissions");
  await prepareWorkspace({ mode: "aal", tool: "codex-5.6luna", run: "001", output: workspace });
  assert.deepEqual((await visibleEntries(workspace)).sort(), ["AAL-REFERENCE.md", "AGENTS.md", "TASK.md", "submission-manifest.json"]);
  await writeFile(join(workspace, "app.aal"), "application: Example\n\nobject: Item\n\n    id: integer\n\n    identity:\n        id\n\nflow: Read\n\n    input:\n        item: Item\n\n    output:\n        item\n", "utf8");
  const collected = await collectWorkspace({
    source: workspace,
    mode: "aal",
    tool: "codex-5.6luna",
    run: "001",
    submissionsRoot: submissions,
  });
  assert.deepEqual(await visibleEntries(collected.destination), ["app.aal"]);
});

test("collect rejects modified frozen inputs and a changed identity", async (context) => {
  const root = await temporaryRoot(context);
  const workspace = join(root, "workspace");
  await prepareWorkspace({ mode: "aal", tool: "example-tool", run: "001", output: workspace });
  await writeFile(join(workspace, "app.aal"), "application: Example\n", "utf8");
  await writeFile(join(workspace, "TASK.md"), "modified\n", "utf8");
  await assert.rejects(
    collectWorkspace({ source: workspace, mode: "aal", tool: "example-tool", run: "001", submissionsRoot: join(root, "submissions") }),
    /TASK\.md was modified/u,
  );
  await assert.rejects(
    collectWorkspace({ source: workspace, mode: "aal", tool: "another-tool", run: "001", submissionsRoot: join(root, "submissions") }),
    /submission-manifest\.json was modified/u,
  );
});

test("collect rejects unexpected files, symbolic links, and dependencies", async (context) => {
  const unexpectedRoot = await temporaryRoot(context);
  const unexpectedWorkspace = join(unexpectedRoot, "workspace");
  await prepareWorkspace({ mode: "direct", tool: "example-tool", run: "001", output: unexpectedWorkspace });
  await writeDirectOutput(unexpectedWorkspace);
  await writeFile(join(unexpectedWorkspace, "NOTES.md"), "extra\n", "utf8");
  await assert.rejects(
    collectWorkspace({ source: unexpectedWorkspace, mode: "direct", tool: "example-tool", run: "001", submissionsRoot: join(unexpectedRoot, "submissions") }),
    /Unexpected workspace entry: NOTES\.md/u,
  );

  const linkRoot = await temporaryRoot(context);
  const linkWorkspace = join(linkRoot, "workspace");
  await prepareWorkspace({ mode: "direct", tool: "example-tool", run: "001", output: linkWorkspace });
  await writeDirectOutput(linkWorkspace);
  await symlink("server.mjs", join(linkWorkspace, "src/link.mjs"));
  await assert.rejects(
    collectWorkspace({ source: linkWorkspace, mode: "direct", tool: "example-tool", run: "001", submissionsRoot: join(linkRoot, "submissions") }),
    /Symbolic links are not allowed/u,
  );

  const dependencyRoot = await temporaryRoot(context);
  const dependencyWorkspace = join(dependencyRoot, "workspace");
  await prepareWorkspace({ mode: "direct", tool: "example-tool", run: "001", output: dependencyWorkspace });
  await writeDirectOutput(dependencyWorkspace, { dependencies: { express: "1.0.0" } });
  await assert.rejects(
    collectWorkspace({ source: dependencyWorkspace, mode: "direct", tool: "example-tool", run: "001", submissionsRoot: join(dependencyRoot, "submissions") }),
    /does not allow dependencies/u,
  );
});

test("prepare and collect never overwrite an existing target", async (context) => {
  const root = await temporaryRoot(context);
  const workspace = join(root, "workspace");
  const submissions = join(root, "submissions");
  await prepareWorkspace({ mode: "direct", tool: "example-tool", run: "001", output: workspace });
  await assert.rejects(
    prepareWorkspace({ mode: "direct", tool: "example-tool", run: "001", output: workspace }),
    /Workspace already exists/u,
  );
  await writeDirectOutput(workspace);
  const options = { source: workspace, mode: "direct", tool: "example-tool", run: "001", submissionsRoot: submissions };
  await collectWorkspace(options);
  await assert.rejects(collectWorkspace(options), /Submission already exists/u);
});

async function temporaryRoot(context) {
  const root = await mkdtemp(join(tmpdir(), "determinant-workspace-test-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function visibleEntries(directory) {
  return (await readdir(directory)).filter((name) => name !== ".git").sort();
}

async function writeDirectOutput(workspace, extraPackageFields = {}) {
  const packageJson = {
    name: "benchmark-submission",
    version: "1.0.0",
    private: true,
    type: "module",
    scripts: {
      build: "node --check src/server.mjs",
      start: "node src/server.mjs",
    },
    ...extraPackageFields,
  };
  await mkdir(join(workspace, "src"));
  await writeFile(join(workspace, "src/server.mjs"), "export {};\n", "utf8");
  await writeFile(join(workspace, "package.json"), `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");
  await writeFile(join(workspace, "package-lock.json"), `${JSON.stringify({
    name: packageJson.name,
    version: packageJson.version,
    lockfileVersion: 3,
    requires: true,
    packages: {
      "": {
        name: packageJson.name,
        version: packageJson.version,
        ...(packageJson.dependencies ? { dependencies: packageJson.dependencies } : {}),
      },
      ...(packageJson.dependencies ? { "node_modules/express": { version: "1.0.0" } } : {}),
    },
  }, null, 2)}\n`, "utf8");
}
