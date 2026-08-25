import type { Expression, FlowDeclaration, FlowSignature, Program, TypeRef } from "./ast.js";
import { createProgramTypeInfo, flowKey, inferExpressionType, type Environment, type ProgramTypeInfo } from "./checker.js";
import { bindingFingerprint, resolveBinding, type BindingSpec, type ResolvedBinding } from "./binding.js";

export function generateTypeScript(program: Program, bindingInput?: BindingSpec | ResolvedBinding): string {
  const typeInfo = createProgramTypeInfo(program);
  const binding = resolveBindingForGeneration(program, bindingInput);
  const objectAliases = new Map<string, string>();
  for (const object of program.objects) objectAliases.set(object.name, binding.objects.get(object.name)!.programName);

  const flowAliases = new Map<string, string>();
  const outputAliases = new Map<string, string>();
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
    "  if (!/^-?\\d+(?:\\.\\d+)?$/.test(text)) throw new Error(`金额格式无效：${text}`);",
    "  const negative = text.startsWith(\"-\");",
    "  const unsigned = negative ? text.slice(1) : text;",
    "  const [whole, fraction = \"\"] = unsigned.split(\".\");",
    "  if (fraction.length > scale) throw new Error(`金额精度超过声明：${text}`);",
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
    "  if (!value || typeof value !== \"object\" || (value as Money).kind !== \"money\") throw new Error(`${name} 必须是金额`);",
    "  const candidate = value as Money;",
    "  if (candidate.currency !== currency || candidate.unit !== unit || candidate.scale !== scale) throw new Error(`${name} 的币种、单位或精度不匹配`);",
    "  const minor = typeof candidate.minor === \"bigint\" ? candidate.minor : BigInt(String((candidate as unknown as { minor: unknown }).minor));",
    "  return { ...candidate, minor };",
    "}",
    "",
    "function assertInteger(value: unknown, name: string): number {",
    "  if (!Number.isSafeInteger(value)) throw new Error(`${name} 必须是整数`);",
    "  return value as number;",
    "}",
    "",
    "function assertObject(value: unknown, name: string): Record<string, unknown> {",
    "  if (!value || typeof value !== \"object\") throw new Error(`${name} 必须是对象`);",
    "  return value as Record<string, unknown>;",
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
    "  if (left.currency !== right.currency || left.unit !== right.unit || left.scale !== right.scale) throw new Error(\"金额的币种、单位或精度不匹配\");",
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
    lines.push(...generateFlow(flow, typeInfo, binding, objectAliases, outputAliases, flowAliases));
    lines.push("");
  }

  const entry = program.flows.at(-1);
  if (entry) lines.push(...generateEntry(entry, typeInfo, binding, objectAliases, outputAliases, flowAliases));
  return `${lines.join("\n")}\n`;
}

function generateFlow(
  flow: FlowDeclaration,
  typeInfo: ProgramTypeInfo,
  binding: ResolvedBinding,
  objectAliases: ReadonlyMap<string, string>,
  outputAliases: ReadonlyMap<string, string>,
  flowAliases: ReadonlyMap<string, string>,
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

function resolveBindingForGeneration(program: Program, input?: BindingSpec | ResolvedBinding): ResolvedBinding {
  const result = input && isResolvedBinding(input) ? { binding: input, diagnostics: [] } : resolveBinding(program, input);
  if (!result.binding) throw new Error(result.diagnostics.map((diagnostic) => diagnostic.message).join("；"));
  return result.binding;
}

function isResolvedBinding(value: BindingSpec | ResolvedBinding): value is ResolvedBinding {
  return value.objects instanceof Map && value.flows instanceof Map;
}
