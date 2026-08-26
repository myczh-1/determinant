#!/usr/bin/env node
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import ts from "typescript";
import { compileAAL, normalizeLanguage, parseBinding } from "../dist/index.js";
import { formatDiagnostic } from "../dist/diagnostics.js";

const arguments_ = process.argv.slice(2);
const runMode = arguments_[0] === "run";
const sourcePath = runMode ? arguments_[1] : arguments_[0];
const options = arguments_.slice(runMode ? 2 : 1);
const outIndex = options.indexOf("--out");
const outputPath = outIndex >= 0 ? options[outIndex + 1] : null;
const bindingIndex = options.indexOf("--binding");
const bindingPath = bindingIndex >= 0 ? options[bindingIndex + 1] : null;
const languageIndex = options.indexOf("--language");
const languageValue = languageIndex >= 0 ? options[languageIndex + 1] : undefined;
const language = normalizeLanguage(languageValue);
const hostIndex = options.indexOf("--host");
const host = hostIndex >= 0 ? options[hostIndex + 1] : "127.0.0.1";
const portIndex = options.indexOf("--port");
const port = Number(portIndex >= 0 ? options[portIndex + 1] : "3000");
const fixtureIndex = options.indexOf("--fixture");
const fixturePath = fixtureIndex >= 0 ? options[fixtureIndex + 1] : null;
const clockIndex = options.indexOf("--clock");
const clockValue = clockIndex >= 0 ? options[clockIndex + 1] : null;

if (!language) {
  console.error(`Unsupported language: ${languageValue}. Use en or zh-CN.`);
  process.exit(1);
}

if (!sourcePath || (outIndex >= 0 && !outputPath) || (bindingIndex >= 0 && !bindingPath) || (languageIndex >= 0 && !languageValue) || (fixtureIndex >= 0 && !fixturePath) || (clockIndex >= 0 && !clockValue) || (!runMode && (fixtureIndex >= 0 || clockIndex >= 0)) || (runMode && (!host || !Number.isInteger(port) || port < 0 || port > 65535))) {
  console.error(language === "zh-CN"
    ? "用法：determinant <source.aal> [--language en|zh-CN] [--binding binding.json] [--out generated.ts]\n      determinant run <source.aal> [--host 127.0.0.1] [--port 3000] [--language en|zh-CN] [--binding binding.json] [--fixture fixture.json] [--clock 2026-01-01T00:00:00.000Z]"
    : "Usage: determinant <source.aal> [--language en|zh-CN] [--binding binding.json] [--out generated.ts]\n       determinant run <source.aal> [--host 127.0.0.1] [--port 3000] [--language en|zh-CN] [--binding binding.json] [--fixture fixture.json] [--clock 2026-01-01T00:00:00.000Z]");
  process.exit(1);
}

const source = await readFile(resolve(sourcePath), "utf8");
let binding;
if (bindingPath) {
  const parsedBinding = parseBinding(await readFile(resolve(bindingPath), "utf8"), language);
  if (!parsedBinding.spec) {
    for (const diagnostic of parsedBinding.diagnostics) console.error(formatDiagnostic(diagnostic));
    process.exit(1);
  }
  binding = parsedBinding.spec;
}
const result = compileAAL(source, { binding, language });
if (result.diagnostics.length > 0) {
  for (const diagnostic of result.diagnostics) console.error(formatDiagnostic(diagnostic));
}
if (!result.code) process.exit(1);

if (runMode) {
  if (!result.program?.httpEntries.length) {
    console.error(language === "zh-CN" ? "AAL 中没有 HTTP 入口" : "The AAL source has no HTTP entries");
    process.exit(1);
  }
  const javascript = ts.transpileModule(result.code, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  }).outputText;
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`;
  const application = await import(moduleUrl);
  if (clockValue && (!Number.isFinite(Date.parse(clockValue)) || new Date(clockValue).toISOString() !== clockValue)) {
    console.error(language === "zh-CN" ? `冻结时钟必须是规范 UTC 时间：${clockValue}` : `Frozen clock must be a canonical UTC instant: ${clockValue}`);
    process.exit(1);
  }
  if (fixturePath) {
    try {
      const fixture = JSON.parse(await readFile(resolve(fixturePath), "utf8"));
      if (typeof application.loadFixture !== "function") throw new Error(language === "zh-CN" ? "应用没有可加载的对象存储" : "The application has no fixture-capable object stores");
      application.loadFixture(fixture);
    } catch (cause) {
      console.error(cause instanceof Error ? cause.message : String(cause));
      process.exit(1);
    }
  }
  const runtimeContext = clockValue ? { now: () => clockValue } : undefined;
  const server = createServer(async (request, response) => {
    try {
      const body = await readJsonBody(request);
      if (body.invalid) {
        sendJson(response, 400, { error: language === "zh-CN" ? "请求 JSON 无效" : "Invalid JSON" });
        return;
      }
      const handled = application.handleHttpRequest({ method: request.method ?? "", path: request.url ?? "/", body: body.value }, runtimeContext);
      sendJson(response, handled.status, handled.body);
    } catch {
      sendJson(response, 500, { error: "Internal server error" });
    }
  });
  server.listen(port, host, () => {
    const address = server.address();
    const actualPort = typeof address === "object" && address ? address.port : port;
    console.log(language === "zh-CN" ? `HTTP 服务已启动：http://${host}:${actualPort}` : `HTTP server listening at http://${host}:${actualPort}`);
  });
} else if (outputPath) {
  const target = resolve(outputPath);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, result.code, "utf8");
  console.log(language === "zh-CN" ? `已生成 ${target}` : `Generated ${target}`);
} else {
  process.stdout.write(result.code);
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (chunks.length === 0) return { invalid: false, value: undefined };
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text.trim()) return { invalid: false, value: undefined };
  try {
    return { invalid: false, value: JSON.parse(text) };
  } catch {
    return { invalid: true, value: undefined };
  }
}

function sendJson(response, status, body) {
  response.statusCode = status;
  if (status === 204 || body === undefined) {
    response.end();
    return;
  }
  const payload = JSON.stringify(body);
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("content-length", Buffer.byteLength(payload));
  response.end(payload);
}
