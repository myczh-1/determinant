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
    "export type Time = Readonly<{ kind: \"time\"; epochMilliseconds: number }>;",
    "export type Duration = Readonly<{ kind: \"duration\"; milliseconds: number }>;",
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
    "function readHttpInput(value: unknown, kind: \"integer\" | \"text\" | \"boolean\" | \"money\", fromPath: boolean, currency?: string, unit?: string, scale?: number): { readonly ok: true; readonly value: unknown } | { readonly ok: false } {",
    "  if (kind === \"integer\") {",
    "    const parsed = fromPath && typeof value === \"string\" && /^-?(?:0|[1-9]\\d*)$/.test(value) ? Number(value) : value;",
    "    return Number.isSafeInteger(parsed) ? { ok: true, value: parsed } : { ok: false };",
    "  }",
    "  if (kind === \"text\") return typeof value === \"string\" ? { ok: true, value } : { ok: false };",
    "  if (kind === \"money\") {",
    "    if (fromPath || typeof value !== \"string\" || currency === undefined || unit === undefined || scale === undefined) return { ok: false };",
    "    const pattern = new RegExp(`^-?(?:0|[1-9]\\\\d*)\\\\.\\\\d{${scale}}$`);",
    "    return pattern.test(value) ? { ok: true, value: money(currency, unit, scale, value) } : { ok: false };",
    "  }",
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
    "export function time(value: string | number | Date): Time {",
    "  const epochMilliseconds = value instanceof Date ? value.getTime() : typeof value === \"number\" ? value : Date.parse(value);",
    `  if (!Number.isSafeInteger(epochMilliseconds)) throw new Error(${JSON.stringify(messages.invalidTime)});`,
    "  return { kind: \"time\", epochMilliseconds };",
    "}",
    "",
    "export function timeValue(value: Time): string {",
    "  return new Date(value.epochMilliseconds).toISOString();",
    "}",
    "",
    "function duration(milliseconds: number): Duration {",
    "  return { kind: \"duration\", milliseconds };",
    "}",
    "",
    "function timeAdd(value: Time, durationValue: Duration): Time {",
    "  return { kind: \"time\", epochMilliseconds: value.epochMilliseconds + durationValue.milliseconds };",
    "}",
    "",
    "function timeCompare(left: Time, right: Time): number {",
    "  return left.epochMilliseconds < right.epochMilliseconds ? -1 : left.epochMilliseconds > right.epochMilliseconds ? 1 : 0;",
    "}",
    "",
    "type FixtureType = { readonly kind: \"integer\" | \"text\" | \"boolean\" | \"money\" | \"time\" | \"value\" | \"unsupported\"; readonly currency?: string; readonly unit?: string; readonly scale?: number; readonly values?: readonly string[] };",
    "",
    "function fixtureRecord(value: unknown, label: string): Record<string, unknown> {",
    `  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(${JSON.stringify(messages.invalidFixture)} + ": " + label);`,
    "  return value as Record<string, unknown>;",
    "}",
    "",
    "function fixtureKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {",
    "  const actual = Object.keys(value).sort();",
    "  const wanted = [...expected].sort();",
    `  if (JSON.stringify(actual) !== JSON.stringify(wanted)) throw new Error(${JSON.stringify(messages.invalidFixture)} + ": " + label);`,
    "}",
    "",
    "function fixtureValue(value: unknown, type: FixtureType, label: string): unknown {",
    "  if (type.kind === \"integer\") {",
    `    if (!Number.isSafeInteger(value)) throw new Error(${JSON.stringify(messages.invalidFixture)} + ": " + label);`,
    "    return value;",
    "  }",
    "  if (type.kind === \"text\") {",
    `    if (typeof value !== "string") throw new Error(${JSON.stringify(messages.invalidFixture)} + ": " + label);`,
    "    return value;",
    "  }",
    "  if (type.kind === \"boolean\") {",
    `    if (typeof value !== "boolean") throw new Error(${JSON.stringify(messages.invalidFixture)} + ": " + label);`,
    "    return value;",
    "  }",
    "  if (type.kind === \"money\") {",
    "    const scale = type.scale ?? 0;",
    "    const pattern = new RegExp(`^-?(?:0|[1-9]\\\\d*)\\\\.\\\\d{${scale}}$`);",
    `    if (typeof value !== "string" || !pattern.test(value) || !type.currency || !type.unit) throw new Error(${JSON.stringify(messages.invalidFixture)} + ": " + label);`,
    "    return money(type.currency, type.unit, scale, value);",
    "  }",
    "  if (type.kind === \"time\") {",
    `    if (typeof value !== "string") throw new Error(${JSON.stringify(messages.invalidFixture)} + ": " + label);`,
    "    const parsed = time(value);",
    `    if (timeValue(parsed) !== value) throw new Error(${JSON.stringify(messages.invalidFixture)} + ": " + label);`,
    "    return parsed;",
    "  }",
    "  if (type.kind === \"value\") {",
    `    if (typeof value !== "string" || !type.values?.includes(value)) throw new Error(${JSON.stringify(messages.invalidFixture)} + ": " + label);`,
    "    return value;",
    "  }",
    `  throw new Error(${JSON.stringify(messages.invalidFixture)} + ": " + label);`,
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
    lines.push(...generateFixtureLoader(program, typeInfo, binding, objectAliases, storeAliases, messages.invalidFixture));
    lines.push("");
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

function generateFixtureLoader(
  program: Program,
  typeInfo: ProgramTypeInfo,
  binding: ResolvedBinding,
  objectAliases: ReadonlyMap<string, string>,
  storeAliases: ReadonlyMap<string, string>,
  invalidFixtureMessage: string,
): string[] {
  const storedObjects = program.objects.filter((object) => storeAliases.has(object.name));
  const lines = [
    "export function loadFixture(input: unknown): void {",
    "  const fixture = fixtureRecord(input, \"root\");",
    `  fixtureKeys(fixture, ${JSON.stringify(storedObjects.map((object) => object.name))}, "root");`,
  ];
  for (const [objectIndex, object] of storedObjects.entries()) {
    const objectType = typeInfo.objectTypes.get(object.name)!;
    const objectBinding = binding.objects.get(object.name)!;
    const nextStore = `fixture_store_${objectIndex}`;
    const rows = `fixture_rows_${objectIndex}`;
    lines.push(`  const ${nextStore} = new Map<string, ${objectAliases.get(object.name)!}>();`);
    lines.push(`  const ${rows} = fixture[${JSON.stringify(object.name)}];`);
    lines.push(`  if (!Array.isArray(${rows})) throw new Error(${JSON.stringify(invalidFixtureMessage)} + ": " + ${JSON.stringify(object.name)});`);
    lines.push(`  for (const [fixture_index, fixture_item] of ${rows}.entries()) {`);
    lines.push(`    const fixture_row = fixtureRecord(fixture_item, ${JSON.stringify(`${object.name}[]`)});`);
    lines.push(`    fixtureKeys(fixture_row, ${JSON.stringify(object.fields.map((field) => field.name))}, ${JSON.stringify(`${object.name}[]`)});`);
    lines.push(`    const fixture_value: ${objectAliases.get(object.name)!} = {`);
    for (const field of objectType.fields) {
      const programName = objectBinding.fields.get(field.name)!.programName;
      const label = `${object.name}[${"${fixture_index}"}].${field.name}`;
      lines.push(`      ${JSON.stringify(programName)}: fixtureValue(fixture_row[${JSON.stringify(field.name)}], ${fixtureTypeDescriptor(field.type)}, \`${label}\`) as ${typeScriptType(field.type, objectAliases, new Map())},`);
    }
    lines.push("    };");
    lines.push(`    const fixture_key = ${renderIdentityKey("fixture_value", object, objectBinding)};`);
    lines.push(`    if (${nextStore}.has(fixture_key)) throw new Error(${JSON.stringify(invalidFixtureMessage)} + ": duplicate " + ${JSON.stringify(object.name)});`);
    lines.push(`    ${nextStore}.set(fixture_key, fixture_value);`);
    lines.push("  }");
  }
  for (const [objectIndex, object] of storedObjects.entries()) {
    const store = storeAliases.get(object.name)!;
    lines.push(`  ${store}.clear();`);
    lines.push(`  for (const [fixture_key, fixture_value] of fixture_store_${objectIndex}) ${store}.set(fixture_key, fixture_value);`);
  }
  lines.push("}");
  return lines;
}

function fixtureTypeDescriptor(type: TypeRef): string {
  if (type.kind === "integer" || type.kind === "text" || type.kind === "boolean" || type.kind === "time") return `{ kind: ${JSON.stringify(type.kind)} }`;
  if (type.kind === "money") return `{ kind: "money", currency: ${JSON.stringify(type.currency)}, unit: ${JSON.stringify(type.unit)}, scale: ${type.scale} }`;
  if (type.kind === "value") return `{ kind: "value", values: ${JSON.stringify(type.values)} }`;
  return "{ kind: \"unsupported\" }";
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
  for (const valueType of typeInfo.valueTypes.values()) {
    for (const value of valueType.values) {
      symbols.set(value, JSON.stringify(value));
      environment.set(value, valueType);
    }
  }
  for (const [index, input] of signature.inputs.entries()) {
    const symbol = `input_${index}`;
    params.push(`${symbol}: ${typeScriptType(input.type, objectAliases, outputAliases)}`);
    symbols.set(input.name, symbol);
    environment.set(input.name, input.type);
  }

  const lines = [`function ${functionName}(${params.join(", ")}): FlowResult<${outputAlias}> {`];
  const counters = { calculation: 0, execute: 0, create: 0, query: 0, atomic: 0 };
  const emitStatements = (statements: FlowDeclaration["statements"], localSymbols: Map<string, string>, localEnvironment: Environment, indent: string): string[] => {
    const generated: string[] = [];
    for (const statement of statements) {
      if (statement.kind === "atomic") {
        const atomicIndex = counters.atomic++;
        const atomicSymbols = new Map(localSymbols);
        const atomicEnvironment = new Map(localEnvironment);
        const stagedRoots = new Map<string, { original: string; staged: string }>();
        for (const nested of statement.statements) {
          if (nested.kind !== "change") continue;
          const rootName = rootReferenceName(nested.target);
          const original = rootName ? localSymbols.get(rootName) : undefined;
          if (!rootName || !original || stagedRoots.has(rootName)) continue;
          const staged = `atomic_${atomicIndex}_object_${stagedRoots.size}`;
          generated.push(`${indent}const ${staged} = { ...${original} };`);
          stagedRoots.set(rootName, { original, staged });
          atomicSymbols.set(rootName, staged);
        }

        const pendingCreates: { store: string; key: string; symbol: string; objectName: string }[] = [];
        for (const nested of statement.statements) {
          if (nested.kind === "change") {
            generated.push(`${indent}${renderExpression(nested.target, atomicSymbols, atomicEnvironment, binding)} = ${renderExpression(nested.expression, atomicSymbols, atomicEnvironment, binding)};`);
            continue;
          }
          if (nested.kind !== "create") continue;
          const object = program.objects.find((candidate) => candidate.name === nested.objectName)!;
          const objectType = typeInfo.objectTypes.get(nested.objectName)!;
          const objectBinding = binding.objects.get(nested.objectName)!;
          const symbol = `created_${counters.create++}`;
          generated.push(`${indent}const ${symbol}: ${objectAliases.get(nested.objectName)!} = {`);
          for (const field of object.fields) {
            const assignment = nested.assignments.find((candidate) => candidate.target.kind === "member" && candidate.target.property === field.name)!;
            generated.push(`${indent}  ${JSON.stringify(objectBinding.fields.get(field.name)!.programName)}: ${renderExpression(assignment.expression, atomicSymbols, atomicEnvironment, binding)},`);
          }
          generated.push(`${indent}};`);
          const store = storeAliases.get(nested.objectName)!;
          const key = `${symbol}_key`;
          generated.push(`${indent}const ${key} = ${renderIdentityKey(symbol, object, objectBinding)};`);
          const priorKeys = pendingCreates.filter((pending) => pending.objectName === nested.objectName).map((pending) => `${pending.key} === ${key}`);
          const pendingConflict = priorKeys.length > 0 ? ` || ${priorKeys.join(" || ")}` : "";
          generated.push(`${indent}if (${store}.has(${key})${pendingConflict}) return { ok: false, error: ${JSON.stringify(nested.failureMessage)} };`);
          pendingCreates.push({ store, key, symbol, objectName: nested.objectName });
          atomicSymbols.set(nested.name, symbol);
          atomicEnvironment.set(nested.name, objectType);
        }
        for (const { original, staged } of stagedRoots.values()) generated.push(`${indent}Object.assign(${original}, ${staged});`);
        for (const pending of pendingCreates) generated.push(`${indent}${pending.store}.set(${pending.key}, ${pending.symbol});`);
        continue;
      }
      if (statement.kind === "conditional") {
        generated.push(`${indent}if (${renderExpression(statement.condition, localSymbols, localEnvironment, binding)}) {`);
        generated.push(...emitStatements(statement.statements, new Map(localSymbols), new Map(localEnvironment), `${indent}  `));
        generated.push(`${indent}}`);
        continue;
      }
      if (statement.kind === "calculate") {
        const symbol = `calculation_${counters.calculation++}`;
        generated.push(`${indent}const ${symbol} = ${renderExpression(statement.expression, localSymbols, localEnvironment, binding)};`);
        localSymbols.set(statement.name, symbol);
        const type = inferExpressionType(statement.expression, localEnvironment);
        if (type) localEnvironment.set(statement.name, type);
        continue;
      }
      if (statement.kind === "if") {
        generated.push(`${indent}if (${renderExpression(statement.condition, localSymbols, localEnvironment, binding)}) return { ok: false, error: ${JSON.stringify(statement.failureMessage)} };`);
        continue;
      }
      if (statement.kind === "change") {
        generated.push(`${indent}${renderExpression(statement.target, localSymbols, localEnvironment, binding)} = ${renderExpression(statement.expression, localSymbols, localEnvironment, binding)};`);
        continue;
      }
      if (statement.kind === "create") {
        const object = program.objects.find((candidate) => candidate.name === statement.objectName)!;
        const objectType = typeInfo.objectTypes.get(statement.objectName)!;
        const objectBinding = binding.objects.get(statement.objectName)!;
        const symbol = `created_${counters.create++}`;
        generated.push(`${indent}const ${symbol}: ${objectAliases.get(statement.objectName)!} = {`);
        for (const field of object.fields) {
          const assignment = statement.assignments.find((candidate) => candidate.target.kind === "member" && candidate.target.property === field.name)!;
          generated.push(`${indent}  ${JSON.stringify(objectBinding.fields.get(field.name)!.programName)}: ${renderExpression(assignment.expression, localSymbols, localEnvironment, binding)},`);
        }
        generated.push(`${indent}};`);
        const identity = renderIdentityKey(symbol, object, objectBinding);
        const store = storeAliases.get(statement.objectName)!;
        generated.push(`${indent}const ${symbol}_key = ${identity};`);
        generated.push(`${indent}if (${store}.has(${symbol}_key)) return { ok: false, error: ${JSON.stringify(statement.failureMessage)} };`);
        generated.push(`${indent}${store}.set(${symbol}_key, ${symbol});`);
        localSymbols.set(statement.name, symbol);
        localEnvironment.set(statement.name, objectType);
        continue;
      }
      if (statement.kind === "query") {
        const object = program.objects.find((candidate) => candidate.name === statement.objectName)!;
        const objectType = typeInfo.objectTypes.get(statement.objectName)!;
        const candidateSymbol = `query_candidate_${counters.query}`;
        const symbol = `query_${counters.query++}`;
        const querySymbols = new Map(localSymbols);
        const queryEnvironment = new Map(localEnvironment);
        querySymbols.set(statement.name, candidateSymbol);
        queryEnvironment.set(statement.name, objectType);
        generated.push(`${indent}const ${symbol} = [...${storeAliases.get(object.name)!}.values()].find((${candidateSymbol}) => ${renderExpression(statement.condition, querySymbols, queryEnvironment, binding)});`);
        generated.push(`${indent}if (!${symbol}) return { ok: false, error: ${JSON.stringify(statement.failureMessage)} };`);
        localSymbols.set(statement.name, symbol);
        localEnvironment.set(statement.name, objectType);
        continue;
      }
      if (statement.kind === "delete") {
        const objectType = inferExpressionType(statement.expression, localEnvironment)!;
        const object = program.objects.find((candidate) => candidate.name === (objectType.kind === "object" ? objectType.name : ""))!;
        const objectBinding = binding.objects.get(object.name)!;
        const rendered = renderExpression(statement.expression, localSymbols, localEnvironment, binding);
        generated.push(`${indent}${storeAliases.get(object.name)!}.delete(${renderIdentityKey(rendered, object, objectBinding)});`);
        continue;
      }
      const callSymbol = `execute_${counters.execute++}`;
      const called = typeInfo.flowSignatures.get(statement.flowName)!;
      const calledFunction = flowAliases.get(flowKey(statement.flowName))!;
      const argumentsCode = statement.inputs.map((input) => renderExpression(input, localSymbols, localEnvironment, binding));
      generated.push(`${indent}const ${callSymbol} = ${calledFunction}(${argumentsCode.join(", ")});`);
      generated.push(`${indent}if (${callSymbol}.ok === false) return { ok: false, error: ${callSymbol}.error };`);
      for (let index = 0; index < Math.min(called.output.fields.length, statement.outputs.length); index += 1) {
        const name = statement.outputs[index];
        const field = called.output.fields[index];
        const outputName = binding.flows.get(statement.flowName)!.outputs.get(field.name)!.programName;
        const symbol = `${callSymbol}.value[${JSON.stringify(outputName)}]`;
        localSymbols.set(name, symbol);
        localEnvironment.set(name, field.type);
      }
    }
    return generated;
  };
  lines.push(...emitStatements(flow.statements, symbols, environment, "  "));
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
    "export interface HttpRuntimeContext { readonly now?: () => string | number | Date; }",
    "",
    "function currentTime(context: HttpRuntimeContext): Time {",
    "  return time(context.now ? context.now() : Date.now());",
    "}",
    "",
    "export function handleHttpRequest(request: HttpRequest, context: HttpRuntimeContext = {}): HttpResponse {",
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
      const systemMapping = entry.systemMappings.find((mapping) => mapping.targetName === input.name);
      if (systemMapping) {
        parsedSymbols.set(input.name, "currentTime(context)");
        continue;
      }
      const pathMapping = entry.pathMappings.find((mapping) => mapping.targetName === input.name);
      const bodyMapping = entry.bodyMappings.find((mapping) => mapping.targetName === input.name);
      const raw = pathMapping
        ? `${match}[${route.parameters.indexOf(pathMapping.sourceName) + 1}]`
        : `requestBody[${JSON.stringify(bodyMapping!.sourceName)}]`;
      const parsed = `http_input_${entryIndex}_${inputIndex}`;
      const moneyArguments = input.type.kind === "money"
        ? `, ${JSON.stringify(input.type.currency)}, ${JSON.stringify(input.type.unit)}, ${input.type.scale}`
        : "";
      lines.push(`    const ${parsed} = readHttpInput(${raw}, ${JSON.stringify(input.type.kind)}, ${pathMapping ? "true" : "false"}${moneyArguments});`);
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
  if (type.kind === "money") return `moneyValue(${expression})`;
  if (type.kind === "time") return `timeValue(${expression})`;
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

function rootReferenceName(expression: Expression): string | null {
  let current = expression;
  while (current.kind === "member") current = current.object;
  return current.kind === "reference" ? current.name : null;
}

function renderExpression(expression: Expression, symbols: ReadonlyMap<string, string>, environment: Environment, binding: ResolvedBinding): string {
  if (expression.kind === "integer-literal") return String(expression.value);
  if (expression.kind === "money-literal") return `money(${JSON.stringify(expression.currency)}, ${JSON.stringify(expression.unit)}, ${expression.scale}, ${JSON.stringify(expression.value)})`;
  if (expression.kind === "duration-literal") return `duration(${expression.milliseconds})`;
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
  if (expression.kind === "unary") return `(!${renderExpression(expression.expression, symbols, environment, binding)})`;

  const left = renderExpression(expression.left, symbols, environment, binding);
  const right = renderExpression(expression.right, symbols, environment, binding);
  const leftType = inferExpressionType(expression.left, environment);
  const rightType = inferExpressionType(expression.right, environment);
  if (expression.operator === "and") return `(${left} && ${right})`;
  if (expression.operator === "or") return `(${left} || ${right})`;
  if (expression.operator === "+" && leftType?.kind === "money" && rightType?.kind === "money") return `moneyAdd(${left}, ${right})`;
  if (expression.operator === "-" && leftType?.kind === "money" && rightType?.kind === "money") return `moneySubtract(${left}, ${right})`;
  if (expression.operator === "*" && leftType?.kind === "money" && rightType?.kind === "integer") return `moneyMultiply(${left}, ${right})`;
  if (expression.operator === "*" && leftType?.kind === "integer" && rightType?.kind === "money") return `moneyMultiply(${right}, ${left})`;
  if (expression.operator === "+" && leftType?.kind === "time" && rightType?.kind === "duration") return `timeAdd(${left}, ${right})`;
  if ([">", ">=", "<", "<=", "==", "!="].includes(expression.operator) && leftType?.kind === "money" && rightType?.kind === "money") {
    const comparison = ({ ">": ">", ">=": ">=", "<": "<", "<=": "<=", "==": "===", "!=": "!==" } as Record<string, string>)[expression.operator];
    return `moneyCompare(${left}, ${right}) ${comparison} 0`;
  }
  if ([">", ">=", "<", "<=", "==", "!="].includes(expression.operator) && leftType?.kind === "time" && rightType?.kind === "time") {
    const comparison = ({ ">": ">", ">=": ">=", "<": "<", "<=": "<=", "==": "===", "!=": "!==" } as Record<string, string>)[expression.operator];
    return `timeCompare(${left}, ${right}) ${comparison} 0`;
  }
  const operator = expression.operator === "==" ? "===" : expression.operator === "!=" ? "!==" : expression.operator;
  return `(${left} ${operator} ${right})`;
}

function typeScriptType(type: TypeRef, objectAliases: ReadonlyMap<string, string>, outputAliases: ReadonlyMap<string, string>): string {
  if (type.kind === "integer") return "number";
  if (type.kind === "text") return "string";
  if (type.kind === "boolean") return "boolean";
  if (type.kind === "money") return "Money";
  if (type.kind === "time") return "Time";
  if (type.kind === "duration") return "Duration";
  if (type.kind === "value") return type.values.map((value) => JSON.stringify(value)).join(" | ") || "never";
  if (type.kind === "named") return "unknown";
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
