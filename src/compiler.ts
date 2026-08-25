import type { Program } from "./ast.js";
import { resolveBinding, type BindingSpec } from "./binding.js";
import { checkAAL } from "./checker.js";
import type { Diagnostic } from "./diagnostics.js";
import { generateTypeScript } from "./codegen.js";
import { parseAAL } from "./parser.js";

export interface CompileResult {
  readonly program: Program | null;
  readonly diagnostics: readonly Diagnostic[];
  readonly code: string | null;
}

export interface CompileOptions {
  readonly binding?: BindingSpec;
}

export function compileAAL(source: string, options: CompileOptions = {}): CompileResult {
  const parsed = parseAAL(source);
  if (!parsed.program || parsed.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return { program: parsed.program, diagnostics: parsed.diagnostics, code: null };
  }

  const semanticDiagnostics = checkAAL(parsed.program);
  if (semanticDiagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return { program: parsed.program, diagnostics: semanticDiagnostics, code: null };
  }

  const bindingResult = resolveBinding(parsed.program, options.binding);
  const diagnostics = [...semanticDiagnostics, ...bindingResult.diagnostics];
  if (!bindingResult.binding || diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return { program: parsed.program, diagnostics, code: null };
  }

  return { program: parsed.program, diagnostics, code: generateTypeScript(parsed.program, bindingResult.binding) };
}
