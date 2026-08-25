#!/usr/bin/env node
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { compileAAL, normalizeLanguage, parseBinding } from "../dist/index.js";
import { formatDiagnostic } from "../dist/diagnostics.js";

const [sourcePath, ...options] = process.argv.slice(2);
const outIndex = options.indexOf("--out");
const outputPath = outIndex >= 0 ? options[outIndex + 1] : null;
const bindingIndex = options.indexOf("--binding");
const bindingPath = bindingIndex >= 0 ? options[bindingIndex + 1] : null;
const languageIndex = options.indexOf("--language");
const languageValue = languageIndex >= 0 ? options[languageIndex + 1] : undefined;
const language = normalizeLanguage(languageValue);

if (!language) {
  console.error(`Unsupported language: ${languageValue}. Use en or zh-CN.`);
  process.exit(1);
}

if (!sourcePath || (outIndex >= 0 && !outputPath) || (bindingIndex >= 0 && !bindingPath) || (languageIndex >= 0 && !languageValue)) {
  console.error(language === "zh-CN"
    ? "用法：determinant <source.aal> [--language en|zh-CN] [--binding binding.json] [--out generated.ts]"
    : "Usage: determinant <source.aal> [--language en|zh-CN] [--binding binding.json] [--out generated.ts]");
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

if (outputPath) {
  const target = resolve(outputPath);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, result.code, "utf8");
  console.log(language === "zh-CN" ? `已生成 ${target}` : `Generated ${target}`);
} else {
  process.stdout.write(result.code);
}
