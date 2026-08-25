import type { Expression, FlowDeclaration, Program, TypeRef } from "./ast.js";
import { createProgramTypeInfo, flowKey, inferExpressionType, type Environment, type ProgramTypeInfo } from "./checker.js";
import { bindingFingerprint, resolveBinding, type BindingSpec, type ResolvedBinding, type ResolvedObjectBinding } from "./binding.js";
import { DEFAULT_LANGUAGE, runtimeMessages, type AALLanguage } from "./language.js";

export function generateTypeScript(program: Program, bindingInput?: BindingSpec | ResolvedBinding, language: AALLanguage = DEFAULT_LANGUAGE): string {
  const typeInfo = createProgramTypeInfo(program);
  const binding = resolveBindingForGeneration(program, bindingInput, language);
  const messages = runtimeMessages(language);
  const objectAliases = new Map<string, string>();
  for (const object of program.objects) objectAliases.set(object.name, binding.objects.get(object.name)!.programName);

  const flowAliases = new Map<string, string>();
  const outputAliases = new Map<string, string>();
  const storeAliases = new Map<string, string>();
  for (const [index, object] of program.objects.entries()) if (object.identityFields.length > 0) storeAliases.set(object.name, `store_${index}`);
  for (const [index, flow] of program.flows.entries()) {
    flowAliases.set(flowKey(flow.name), binding.flows.get(flow.name)!.programName);
    outputAliases.set(flow.name, `Output_${index}`);
  }

  const lines: string[] = [
    "// DO NOT EDIT: generated from an AAL source file.",
    `// Application: ${program.name}`,
    `// Binding fingerprint: ${bindingFingerprint(binding)}`,
    "",
    "export type Money = Readonly<{ kind: \"money\"; currency: string; unit: string; scale: number; minor: bigint }>;",
    "export type FlowResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string };",
    "",
    "export function money(currency: string, unit: string, scale: number, value: string | number): Money {",
    "  const text = String(value).trim();",
    `  if (!/^-?\\d+(?:\\.\\d+)?$/.test(text)) throw new Error(${JSON.stringify(messages.invalidMoney)} + ": " + text);`,
    "  const negative = text.startsWith(\"-\");",
    "  const unsigned = negative ? text.slice(1) : text;",
    "  const [whole, fraction = \"\"] = unsigned.split(\".\");",
    `  if (fraction.length > scale) throw new Error(${JSON.stringify(messages.moneyPrecision)} + ": " + text);`,
    "  const base = 10n ** BigInt(scale);",
    "  const minor = BigInt(whole) * base + BigInt((fraction + \"0\".repeat(scale)).slice(0, scale) || \"0\");",
    "  return { kind: \"money\", currency, unit, scale, minor: negative ? -minor : minor };",
    "}",
    "",
    "export function moneyValue(value: Money): string {",
    "  const negative = value.minor < 0n;",
    "  const absolute = negative ? -value.minor : value.minor;",
    "  const base = 10n ** BigInt(value.scale);",
    "  const whole = absolute / base;",
    "  const fraction = value.scale === 0 ? \"\" : (absolute % base).toString().padStart(value.scale, \"0\");",
    "  return `${negative ? \"-\" : \"\"}${whole}${value.scale === 0 ? \"\" : `.${fraction}`}`;",
    "}",
    "",
    "function assertMoney(value: unknown, name: string, currency: string, unit: string, scale: number): Money {",
    `  if (!value || typeof value !== "object" || (value as Money).kind !== "money") throw new Error(name + ${JSON.stringify(messages.moneyRequired)});`,
    "  const candidate = value as Money;",
    `  if (candidate.currency !== currency || candidate.unit !== unit || candidate.scale !== scale) throw new Error(name + ${JSON.stringify(messages.moneyMismatch)});`,
    "  const minor = typeof candidate.minor === \"bigint\" ? candidate.minor : BigInt(String((candidate as unknown as { minor: unknown }).minor));",
    "  return { ...candidate, minor };",
    "}",
    "",
    "function assertInteger(value: unknown, name: string): number {",
    `  if (!Number.isSafeInteger(value)) throw new Error(name + ${JSON.stringify(messages.integerRequired)});`,
    "  return value as number;",
    "}",
    "",
    "function assertObject(value: unknown, name: string): Record<string, unknown> {",
    `  if (!value || typeof value !== "object") throw new Error(name + ${JSON.stringify(messages.objectRequired)});`,
    "  return value as Record<string, unknown>;",
    "}",
    "",
    "function readHttpInput(value: unknown, kind: \"integer\" | \"text\" | \"boolean\", fromPath: boolean): { readonly ok: true; readonly value: unknown } | { readonly ok: false } {",
    "  if (kind === \"integer\") {",
    "    const parsed = fromPath && typeof value === \"string\" && /^-?(?:0|[1-9]\\d*)$/.test(value) ? Number(value) : value;",
    "    return Number.isSafeInteger(parsed) ? { ok: true, value: parsed } : { ok: false };",
    "  }",
    "  if (kind === \"text\") return typeof value === \"string\" ? { ok: true, value } : { ok: false };",
    "  if (fromPath && (value === \"true\" || value === \"false\")) return { ok: true, value: value === \"true\" };",
    "  return typeof value === \"boolean\" ? { ok: true, value } : { ok: false };",
    "}",
    "",
    "function moneyAdd(left: Money, right: Money): Money {",
    "  assertCompatibleMoney(left, right);",
    "  return { ...left, minor: left.minor + right.minor };",
    "}",
    "",
    "function moneySubtract(left: Money, right: Money): Money {",
    "  assertCompatibleMoney(left, right);",
    "  return { ...left, minor: left.minor - right.minor };",
    "}",
    "",
    "function moneyMultiply(value: Money, factor: number): Money {",
    "  return { ...value, minor: value.minor * BigInt(factor) };",
    "}",
    "",
    "function moneyCompare(left: Money, right: Money): number {",
    "  assertCompatibleMoney(left, right);",
    "  return left.minor < right.minor ? -1 : left.minor > right.minor ? 1 : 0;",
    "}",
    "",
    "function assertCompatibleMoney(left: Money, right: Money): void {",
    `  if (left.currency !== right.currency || left.unit !== right.unit || left.scale !== right.scale) throw new Error(${JSON.stringify(messages.incompatibleMoney)});`,
    "}",
    "",
  ];

  for (const [name, objectType] of typeInfo.objectTypes) {
    lines.push(`export type ${objectAliases.get(name)!} = {`);
    for (const field of objectType.fields) {
      const fieldName = binding.objects.get(name)!.fields.get(field.name)!.programName;
      lines.push(`  ${JSON.stringify(fieldName)}: ${typeScriptType(field.type, objectAliases, outputAliases)};`);
    }
    lines.push("};", "");
  }

  for (const object of program.objects) {
    const storeName = storeAliases.get(object.name);
    if (storeName) lines.push(`const ${storeName} = new Map<string, ${objectAliases.get(object.name)!}>();`);
  }
  if (storeAliases.size > 0) {
    lines.push("", "export function resetStore(): void {");
    for (const storeName of storeAliases.values()) lines.push(`  ${storeName}.clear();`);
    lines.push("}", "");
  }

  for (const flow of program.flows) {
    const signature = typeInfo.flowSignatures.get(flow.name)!;
    const alias = outputAliases.get(flow.name)!;
    lines.push(`export type ${alias} = {`);
    for (const field of signature.output.fields) {
      const outputName = binding.flows.get(flow.name)!.outputs.get(field.name)!.programName;
      lines.push(`  readonly ${JSON.stringify(outputName)}: ${typeScriptType(field.type, objectAliases, outputAliases)};`);
    }
    lines.push("};", "");
  }

  for (const flow of program.flows) {
    lines.push(...generateFlow(flow, program, typeInfo, binding, objectAliases, outputAliases, flowAliases, storeAliases));
    lines.push("");
  }

  const entry = program.flows.at(-1);
  if (entry) lines.push(...generateEntry(entry, typeInfo, binding, objectAliases, outputAliases, flowAliases));
  if (program.httpEntries.length > 0) {
    lines.push("");
    lines.push(...generateHttp(program, typeInfo, binding, objectAliases, outputAliases, flowAliases, language));
  }
  return `${lines.join("\n")}\n`;
}

function generateFlow(
  flow: FlowDeclaration,
  program: Program,
  typeInfo: ProgramTypeInfo,
  binding: ResolvedBinding,
  objectAliases: ReadonlyMap<string, string>,
  outputAliases: ReadonlyMap<string, string>,
  flowAliases: ReadonlyMap<string, string>,
  storeAliases: ReadonlyMap<string, string>,
): string[] {
  const signature = typeInfo.flowSignatures.get(flow.name)!;
  const functionName = flowAliases.get(flowKey(flow.name))!;
  const outputAlias = outputAliases.get(flow.name)!;
  const params: string[] = [];
  const symbols = new Map<string, string>();
  const environment: Environment = new Map();
  for (const [index, input] of signature.inputs.entries()) {
    const symbol = `input_${index}`;
    params.push(`${symbol}: ${typeScriptType(input.type, objectAliases, outputAliases)}`);
    symbols.set(input.name, symbol);
    environment.set(input.name, input.type);
  }

  const lines = [`function ${functionName}(${params.join(", ")}): FlowResult<${outputAlias}> {`];
  let calculationIndex = 0;
  let executeIndex = 0;
  let createIndex = 0;
  let queryIndex = 0;
  for (const statement of flow.statements) {
    if (statement.kind === "calculate") {
      const symbol = `calculation_${calculationIndex++}`;
      lines.push(`  const ${symbol} = ${renderExpression(statement.expression, symbols, environment, binding)};`);
      symbols.set(statement.name, symbol);
      const type = inferExpressionType(statement.expression, environment);
      if (type) environment.set(statement.name, type);
      continue;
    }
    if (statement.kind === "if") {
      lines.push(`  if (${renderExpression(statement.condition, symbols, environment, binding)}) return { ok: false, error: ${JSON.stringify(statement.failureMessage)} };`);
      continue;
    }
    if (statement.kind === "change") {
      lines.push(`  ${renderExpression(statement.target, symbols, environment, binding)} = ${renderExpression(statement.expression, symbols, environment, binding)};`);
      continue;
    }
    if (statement.kind === "create") {
      const object = program.objects.find((candidate) => candidate.name === statement.objectName)!;
      const objectType = typeInfo.objectTypes.get(statement.objectName)!;
      const objectBinding = binding.objects.get(statement.objectName)!;
      const symbol = `created_${createIndex++}`;
      lines.push(`  const ${symbol}: ${objectAliases.get(statement.objectName)!} = {`);
      for (const field of object.fields) {
        const assignment = statement.assignments.find((candidate) => candidate.target.kind === "member" && candidate.target.property === field.name)!;
        lines.push(`    ${JSON.stringify(objectBinding.fields.get(field.name)!.programName)}: ${renderExpression(assignment.expression, symbols, environment, binding)},`);
      }
      lines.push("  };");
      const identity = renderIdentityKey(symbol, object, objectBinding);
      const store = storeAliases.get(statement.objectName)!;
      lines.push(`  const ${symbol}_key = ${identity};`);
      lines.push(`  if (${store}.has(${symbol}_key)) return { ok: false, error: ${JSON.stringify(statement.failureMessage)} };`);
      lines.push(`  ${store}.set(${symbol}_key, ${symbol});`);
      symbols.set(statement.name, symbol);
      environment.set(statement.name, objectType);
      continue;
    }
    if (statement.kind === "query") {
      const object = program.objects.find((candidate) => candidate.name === statement.objectName)!;
      const objectType = typeInfo.objectTypes.get(statement.objectName)!;
      const candidateSymbol = `query_candidate_${queryIndex}`;
      const symbol = `query_${queryIndex++}`;
      const querySymbols = new Map(symbols);
      const queryEnvironment = new Map(environment);
      querySymbols.set(statement.name, candidateSymbol);
      queryEnvironment.set(statement.name, objectType);
      lines.push(`  const ${symbol} = [...${storeAliases.get(object.name)!}.values()].find((${candidateSymbol}) => ${renderExpression(statement.condition, querySymbols, queryEnvironment, binding)});`);
      lines.push(`  if (!${symbol}) return { ok: false, error: ${JSON.stringify(statement.failureMessage)} };`);
      symbols.set(statement.name, symbol);
      environment.set(statement.name, objectType);
      continue;
    }
    if (statement.kind === "delete") {
      const objectType = inferExpressionType(statement.expression, environment)!;
      const object = program.objects.find((candidate) => candidate.name === (objectType.kind === "object" ? objectType.name : ""))!;
      const objectBinding = binding.objects.get(object.name)!;
      const rendered = renderExpression(statement.expression, symbols, environment, binding);
      lines.push(`  ${storeAliases.get(object.name)!}.delete(${renderIdentityKey(rendered, object, objectBinding)});`);
      continue;
    }
    if (statement.kind !== "execute") continue;
    const callSymbol = `execute_${executeIndex++}`;
    const called = typeInfo.flowSignatures.get(statement.flowName)!;
    const calledFunction = flowAliases.get(flowKey(statement.flowName))!;
    const argumentsCode = statement.inputs.map((input) => renderExpression(input, symbols, environment, binding));
    lines.push(`  const ${callSymbol} = ${calledFunction}(${argumentsCode.join(", ")});`);
    lines.push(`  if (${callSymbol}.ok === false) return { ok: false, error: ${callSymbol}.error };`);
    for (let index = 0; index < Math.min(called.output.fields.length, statement.outputs.length); index += 1) {
      const name = statement.outputs[index];
      const field = called.output.fields[index];
      const outputName = binding.flows.get(statement.flowName)!.outputs.get(field.name)!.programName;
      const symbol = `${callSymbol}.value[${JSON.stringify(outputName)}]`;
      symbols.set(name, symbol);
      environment.set(name, field.type);
    }
  }
  lines.push("  return { ok: true, value: {");
  for (const field of flow.outputs) {
    const outputName = binding.flows.get(flow.name)!.outputs.get(field.name)!.programName;
    lines.push(`    ${JSON.stringify(outputName)}: ${renderExpression(field.expression, symbols, environment, binding)},`);
  }
  lines.push("  } };");
  lines.push("}");
  return lines;
}

function generateEntry(
  entry: FlowDeclaration,
  typeInfo: ProgramTypeInfo,
  binding: ResolvedBinding,
  objectAliases: ReadonlyMap<string, string>,
  outputAliases: ReadonlyMap<string, string>,
  flowAliases: ReadonlyMap<string, string>,
): string[] {
  const signature = typeInfo.flowSignatures.get(entry.name)!;
  const outputAlias = outputAliases.get(entry.name)!;
  const functionName = flowAliases.get(flowKey(entry.name))!;
  const lines: string[] = ["export type Input = {"];
  for (const input of signature.inputs) {
    const inputName = binding.flows.get(entry.name)!.inputs.get(input.name)!.programName;
    lines.push(`  readonly ${JSON.stringify(inputName)}: ${typeScriptType(input.type, objectAliases, outputAliases)};`);
  }
  lines.push("};", "", `export type Output = ${outputAlias};`, "export type Result = FlowResult<Output>;", "", "export function run(input: Input): Result {");
  const args = signature.inputs.map((input) => {
    const inputName = binding.flows.get(entry.name)!.inputs.get(input.name)!.programName;
    const expression = `input[${JSON.stringify(inputName)}]`;
    if (input.type.kind === "integer") return `assertInteger(${expression}, ${JSON.stringify(inputName)})`;
    if (input.type.kind === "money") return `assertMoney(${expression}, ${JSON.stringify(inputName)}, ${JSON.stringify(input.type.currency)}, ${JSON.stringify(input.type.unit)}, ${input.type.scale})`;
    if (input.type.kind === "object") return `assertObject(${expression}, ${JSON.stringify(inputName)}) as ${typeScriptType(input.type, objectAliases, outputAliases)}`;
    return expression;
  });
  lines.push(`  return ${functionName}(${args.join(", ")});`, "}");
  return lines;
}

function generateHttp(
  program: Program,
  typeInfo: ProgramTypeInfo,
  binding: ResolvedBinding,
  objectAliases: ReadonlyMap<string, string>,
  outputAliases: ReadonlyMap<string, string>,
  flowAliases: ReadonlyMap<string, string>,
  language: AALLanguage,
): string[] {
  const messages = runtimeMessages(language);
  const lines: string[] = [
    "export interface HttpRequest { readonly method: string; readonly path: string; readonly body?: unknown; }",
    "export interface HttpResponse { readonly status: number; readonly body?: unknown; }",
    "",
    "export function handleHttpRequest(request: HttpRequest): HttpResponse {",
    "  const method = request.method.toUpperCase();",
    "  const pathname = request.path.split(\"?\", 1)[0] || \"/\";",
  ];
  for (const [entryIndex, entry] of program.httpEntries.entries()) {
    const flow = program.flows.find((candidate) => candidate.name === entry.targetFlow)!;
    const signature = typeInfo.flowSignatures.get(entry.targetFlow)!;
    const route = compileRoute(entry.path);
    const match = `route_${entryIndex}`;
    lines.push(`  const ${match} = method === ${JSON.stringify(entry.method)} ? new RegExp(${JSON.stringify(route.pattern)}).exec(pathname) : null;`);
    lines.push(`  if (${match}) {`);
    if (entry.bodyMappings.length > 0) {
      lines.push("    const requestBody = request.body && typeof request.body === \"object\" && !Array.isArray(request.body) ? request.body as Record<string, unknown> : {};");
    }
    const parsedSymbols = new Map<string, string>();
    for (const [inputIndex, input] of signature.inputs.entries()) {
      const pathMapping = entry.pathMappings.find((mapping) => mapping.targetName === input.name);
      const bodyMapping = entry.bodyMappings.find((mapping) => mapping.targetName === input.name);
      const raw = pathMapping
        ? `${match}[${route.parameters.indexOf(pathMapping.sourceName) + 1}]`
        : `requestBody[${JSON.stringify(bodyMapping!.sourceName)}]`;
      const parsed = `http_input_${entryIndex}_${inputIndex}`;
      lines.push(`    const ${parsed} = readHttpInput(${raw}, ${JSON.stringify(input.type.kind)}, ${pathMapping ? "true" : "false"});`);
      lines.push(`    if (!${parsed}.ok) return { status: 400, body: { error: ${JSON.stringify(messages.invalidRequest)} } };`);
      parsedSymbols.set(input.name, `${parsed}.value as ${typeScriptType(input.type, objectAliases, outputAliases)}`);
    }
    const result = `http_result_${entryIndex}`;
    const args = signature.inputs.map((input) => parsedSymbols.get(input.name)!);
    lines.push(`    const ${result} = ${flowAliases.get(flowKey(flow.name))!}(${args.join(", ")});`);
    lines.push(`    if (${result}.ok === false) {`);
    for (const failure of entry.failureMappings) {
      lines.push(`      if (${result}.error === ${JSON.stringify(failure.failureMessage)}) return { status: ${failure.status}, body: { error: ${result}.error } };`);
    }
    lines.push(`      return { status: 500, body: { error: ${result}.error } };`);
    lines.push("    }");
    if (entry.successStatus === 204) {
      lines.push(`    return { status: ${entry.successStatus} };`);
    } else {
      lines.push(`    return { status: ${entry.successStatus}, body: {`);
      for (const output of signature.output.fields) {
        const internalName = binding.flows.get(flow.name)!.outputs.get(output.name)!.programName;
        const value = `${result}.value[${JSON.stringify(internalName)}]`;
        lines.push(`      ${JSON.stringify(output.name)}: ${serializeAuditValue(value, output.type, binding)},`);
      }
      lines.push("    } };");
    }
    lines.push("  }");
  }
  lines.push(`  return { status: 404, body: { error: ${JSON.stringify(messages.routeNotFound)} } };`, "}");
  return lines;
}

function compileRoute(path: string): { pattern: string; parameters: string[] } {
  const parameters: string[] = [];
  let pattern = "^";
  let index = 0;
  for (const match of path.matchAll(/\{([\p{L}_][\p{L}\p{N}_]*)\}/gu)) {
    pattern += escapeRegExp(path.slice(index, match.index));
    pattern += "([^/]+)";
    parameters.push(match[1]);
    index = (match.index ?? 0) + match[0].length;
  }
  pattern += `${escapeRegExp(path.slice(index))}$`;
  return { pattern, parameters };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function serializeAuditValue(expression: string, type: TypeRef, binding: ResolvedBinding): string {
  if (type.kind === "money") return `{ currency: ${expression}.currency, unit: ${expression}.unit, scale: ${expression}.scale, value: moneyValue(${expression}) }`;
  if (type.kind === "object") {
    const objectBinding = binding.objects.get(type.name)!;
    const fields = type.fields.map((field) => {
      const internalName = objectBinding.fields.get(field.name)!.programName;
      return `${JSON.stringify(field.name)}: ${serializeAuditValue(`${expression}[${JSON.stringify(internalName)}]`, field.type, binding)}`;
    });
    return `{ ${fields.join(", ")} }`;
  }
  return expression;
}

function renderIdentityKey(
  expression: string,
  object: Program["objects"][number],
  objectBinding: ResolvedObjectBinding,
): string {
  const values = object.identityFields.map((field) => `${expression}[${JSON.stringify(objectBinding.fields.get(field)!.programName)}]`);
  return `JSON.stringify([${values.join(", ")}])`;
}

function renderExpression(expression: Expression, symbols: ReadonlyMap<string, string>, environment: Environment, binding: ResolvedBinding): string {
  if (expression.kind === "integer-literal") return String(expression.value);
  if (expression.kind === "reference") return symbols.get(expression.name) ?? "undefined";
  if (expression.kind === "member") {
    const containerType = inferExpressionType(expression.object, environment);
    const programName = containerType?.kind === "object"
      ? binding.objects.get(containerType.name)?.fields.get(expression.property)?.programName
      : containerType?.kind === "record"
        ? binding.flows.get(containerType.name)?.outputs.get(expression.property)?.programName
        : undefined;
    return `${renderExpression(expression.object, symbols, environment, binding)}[${JSON.stringify(programName ?? expression.property)}]`;
  }

  const left = renderExpression(expression.left, symbols, environment, binding);
  const right = renderExpression(expression.right, symbols, environment, binding);
  const leftType = inferExpressionType(expression.left, environment);
  const rightType = inferExpressionType(expression.right, environment);
  if (expression.operator === "+" && leftType?.kind === "money" && rightType?.kind === "money") return `moneyAdd(${left}, ${right})`;
  if (expression.operator === "-" && leftType?.kind === "money" && rightType?.kind === "money") return `moneySubtract(${left}, ${right})`;
  if (expression.operator === "*" && leftType?.kind === "money" && rightType?.kind === "integer") return `moneyMultiply(${left}, ${right})`;
  if (expression.operator === "*" && leftType?.kind === "integer" && rightType?.kind === "money") return `moneyMultiply(${right}, ${left})`;
  if ([">", ">=", "<", "<=", "==", "!="].includes(expression.operator) && leftType?.kind === "money" && rightType?.kind === "money") {
    const comparison = ({ ">": ">", ">=": ">=", "<": "<", "<=": "<=", "==": "===", "!=": "!==" } as Record<string, string>)[expression.operator];
    return `moneyCompare(${left}, ${right}) ${comparison} 0`;
  }
  const operator = expression.operator === "==" ? "===" : expression.operator === "!=" ? "!==" : expression.operator;
  return `(${left} ${operator} ${right})`;
}

function typeScriptType(type: TypeRef, objectAliases: ReadonlyMap<string, string>, outputAliases: ReadonlyMap<string, string>): string {
  if (type.kind === "integer") return "number";
  if (type.kind === "text") return "string";
  if (type.kind === "boolean") return "boolean";
  if (type.kind === "money") return "Money";
  if (type.kind === "object") return objectAliases.get(type.name) ?? "Record<string, unknown>";
  if (type.kind === "record") return outputAliases.get(type.name) ?? "Record<string, unknown>";
  return "unknown";
}

function resolveBindingForGeneration(program: Program, input: BindingSpec | ResolvedBinding | undefined, language: AALLanguage): ResolvedBinding {
  const result = input && isResolvedBinding(input) ? { binding: input, diagnostics: [] } : resolveBinding(program, input, language);
  if (!result.binding) throw new Error(result.diagnostics.map((diagnostic) => diagnostic.message).join(language === "zh-CN" ? "；" : "; "));
  return result.binding;
}

function isResolvedBinding(value: BindingSpec | ResolvedBinding): value is ResolvedBinding {
  return value.objects instanceof Map && value.flows instanceof Map;
}
