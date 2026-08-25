import type { Program } from "./ast.js";
import { error, type Diagnostic } from "./diagnostics.js";

export interface BindingEntrySpec {
  readonly id: string;
  readonly auditName: string;
  readonly programName: string;
}

export interface BindingObjectSpec extends BindingEntrySpec {
  readonly fields: readonly BindingEntrySpec[];
}

export interface BindingFlowSpec extends BindingEntrySpec {
  readonly inputs: readonly BindingEntrySpec[];
  readonly outputs: readonly BindingEntrySpec[];
}

export interface BindingSpec {
  readonly version: 1;
  readonly objects: readonly BindingObjectSpec[];
  readonly flows: readonly BindingFlowSpec[];
}

export interface ResolvedObjectBinding {
  readonly id: string;
  readonly auditName: string;
  readonly programName: string;
  readonly fields: ReadonlyMap<string, BindingEntrySpec>;
}

export interface ResolvedFlowBinding {
  readonly id: string;
  readonly auditName: string;
  readonly programName: string;
  readonly inputs: ReadonlyMap<string, BindingEntrySpec>;
  readonly outputs: ReadonlyMap<string, BindingEntrySpec>;
}

export interface ResolvedBinding {
  readonly objects: ReadonlyMap<string, ResolvedObjectBinding>;
  readonly flows: ReadonlyMap<string, ResolvedFlowBinding>;
}

export interface BindingResult {
  readonly binding: ResolvedBinding | null;
  readonly diagnostics: readonly Diagnostic[];
}

const LOCATION = { line: 1, column: 1 } as const;

export function parseBinding(source: string): { readonly spec: BindingSpec | null; readonly diagnostics: readonly Diagnostic[] } {
  let value: unknown;
  try {
    value = JSON.parse(source) as unknown;
  } catch (cause) {
    return { spec: null, diagnostics: [error(`绑定文件不是有效 JSON：${cause instanceof Error ? cause.message : String(cause)}`, LOCATION)] };
  }

  const diagnostics: Diagnostic[] = [];
  if (!isRecord(value) || value.version !== 1) {
    diagnostics.push(error("绑定文件必须包含 version: 1", LOCATION));
    return { spec: null, diagnostics };
  }
  const objects = readObjectSpecs(value.objects, diagnostics);
  const flows = readFlowSpecs(value.flows, diagnostics);
  if (!objects || !flows) return { spec: null, diagnostics };
  return { spec: { version: 1, objects, flows }, diagnostics };
}

export function resolveBinding(program: Program, spec?: BindingSpec): BindingResult {
  const diagnostics: Diagnostic[] = [];
  const actual = spec ?? createIdentityBinding(program);
  const objects = new Map<string, ResolvedObjectBinding>();
  const flows = new Map<string, ResolvedFlowBinding>();
  const ids = new Set<string>();
  const objectNames = new Set<string>();
  const flowNames = new Set<string>();

  for (const object of program.objects) {
    const entry = actual.objects.find((candidate) => candidate.auditName === object.name);
    if (!entry) {
      diagnostics.push(error(`对象缺少绑定：${object.name}`, object.loc));
      continue;
    }
    validateTopLevelEntry(entry, `对象 ${object.name}`, ids, objectNames, diagnostics);
    const fields = resolveMembers(object.fields.map((field) => field.name), entry.fields, `对象 ${object.name} 的字段`, ids, diagnostics);
    objects.set(object.name, { ...entry, fields });
  }
  for (const entry of actual.objects) {
    if (!program.objects.some((object) => object.name === entry.auditName)) diagnostics.push(error(`绑定引用了未声明的对象：${entry.auditName}`, LOCATION));
  }

  for (const flow of program.flows) {
    const entry = actual.flows.find((candidate) => candidate.auditName === flow.name);
    if (!entry) {
      diagnostics.push(error(`流程缺少绑定：${flow.name}`, flow.loc));
      continue;
    }
    validateTopLevelEntry(entry, `流程 ${flow.name}`, ids, flowNames, diagnostics);
    const inputs = resolveMembers(flow.inputs.map((input) => input.name), entry.inputs, `流程 ${flow.name} 的输入`, ids, diagnostics);
    const outputs = resolveMembers(flow.outputs.map((output) => output.name), entry.outputs, `流程 ${flow.name} 的输出`, ids, diagnostics);
    flows.set(flow.name, { ...entry, inputs, outputs });
  }
  for (const entry of actual.flows) {
    if (!program.flows.some((flow) => flow.name === entry.auditName)) diagnostics.push(error(`绑定引用了未声明的流程：${entry.auditName}`, LOCATION));
  }

  return { binding: diagnostics.length === 0 ? { objects, flows } : null, diagnostics };
}

export function createIdentityBinding(program: Program): BindingSpec {
  return {
    version: 1,
    objects: program.objects.map((object, objectIndex) => ({
      id: `object_${objectIndex}`,
      auditName: object.name,
      programName: `Object_${objectIndex}`,
      fields: object.fields.map((field, fieldIndex) => ({
        id: `field_${objectIndex}_${fieldIndex}`,
        auditName: field.name,
        programName: field.name,
      })),
    })),
    flows: program.flows.map((flow, flowIndex) => ({
      id: `flow_${flowIndex}`,
      auditName: flow.name,
      programName: `flow_${flowIndex}`,
      inputs: flow.inputs.map((input, inputIndex) => ({
        id: `input_${flowIndex}_${inputIndex}`,
        auditName: input.name,
        programName: input.name,
      })),
      outputs: flow.outputs.map((output, outputIndex) => ({
        id: `output_${flowIndex}_${outputIndex}`,
        auditName: output.name,
        programName: output.name,
      })),
    })),
  };
}

export function bindingFingerprint(binding: ResolvedBinding): string {
  const canonical = {
    objects: [...binding.objects.entries()].sort(([left], [right]) => compareNames(left, right)).map(([name, object]) => ({
      name,
      id: object.id,
      programName: object.programName,
      fields: [...object.fields.entries()].sort(([left], [right]) => compareNames(left, right)).map(([fieldName, field]) => ({ name: fieldName, ...field })),
    })),
    flows: [...binding.flows.entries()].sort(([left], [right]) => compareNames(left, right)).map(([name, flow]) => ({
      name,
      id: flow.id,
      programName: flow.programName,
      inputs: [...flow.inputs.entries()].sort(([left], [right]) => compareNames(left, right)).map(([inputName, input]) => ({ name: inputName, ...input })),
      outputs: [...flow.outputs.entries()].sort(([left], [right]) => compareNames(left, right)).map(([outputName, output]) => ({ name: outputName, ...output })),
    })),
  };
  let hash = 2166136261;
  for (const character of JSON.stringify(canonical)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function compareNames(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function resolveMembers(names: readonly string[], entries: readonly BindingEntrySpec[], label: string, ids: Set<string>, diagnostics: Diagnostic[]): ReadonlyMap<string, BindingEntrySpec> {
  const expected = new Set(names);
  const resolved = new Map<string, BindingEntrySpec>();
  const programNames = new Set<string>();
  for (const entry of entries) {
    if (!expected.has(entry.auditName)) {
      diagnostics.push(error(`${label}绑定了未声明的名称：${entry.auditName}`, LOCATION));
      continue;
    }
    validateMemberEntry(entry, label, ids, programNames, diagnostics);
    if (resolved.has(entry.auditName)) diagnostics.push(error(`${label}绑定重复：${entry.auditName}`, LOCATION));
    resolved.set(entry.auditName, entry);
  }
  for (const name of names) if (!resolved.has(name)) diagnostics.push(error(`${label}缺少绑定：${name}`, LOCATION));
  return resolved;
}

function validateTopLevelEntry(entry: BindingEntrySpec, label: string, ids: Set<string>, programNames: Set<string>, diagnostics: Diagnostic[]): void {
  validateEntry(entry, label, ids, diagnostics);
  if (!isJavaScriptIdentifier(entry.programName)) diagnostics.push(error(`${label}的程序名称必须是合法标识符：${entry.programName}`, LOCATION));
  if (programNames.has(entry.programName)) diagnostics.push(error(`${label}的程序名称重复：${entry.programName}`, LOCATION));
  programNames.add(entry.programName);
}

function validateMemberEntry(entry: BindingEntrySpec, label: string, ids: Set<string>, programNames: Set<string>, diagnostics: Diagnostic[]): void {
  validateEntry(entry, label, ids, diagnostics);
  if (entry.programName.trim().length === 0) diagnostics.push(error(`${label}的程序名称不能为空`, LOCATION));
  if (programNames.has(entry.programName)) diagnostics.push(error(`${label}的程序名称重复：${entry.programName}`, LOCATION));
  programNames.add(entry.programName);
}

function validateEntry(entry: BindingEntrySpec, label: string, ids: Set<string>, diagnostics: Diagnostic[]): void {
  if (!/^[a-z][a-z0-9_-]*$/u.test(entry.id)) diagnostics.push(error(`${label}的内部身份必须是稳定的小写标识：${entry.id}`, LOCATION));
  if (ids.has(entry.id)) diagnostics.push(error(`绑定内部身份重复：${entry.id}`, LOCATION));
  ids.add(entry.id);
  if (entry.auditName.trim().length === 0) diagnostics.push(error(`${label}的审计名称不能为空`, LOCATION));
}

function readObjectSpecs(value: unknown, diagnostics: Diagnostic[]): BindingObjectSpec[] | null {
  if (!Array.isArray(value)) {
    diagnostics.push(error("绑定文件的 objects 必须是数组", LOCATION));
    return null;
  }
  const result: BindingObjectSpec[] = [];
  for (const [index, item] of value.entries()) {
    const entry = readEntry(item, `objects[${index}]`, diagnostics);
    if (!entry) continue;
    const fields = readEntries(isRecord(item) ? item.fields : undefined, `objects[${index}].fields`, diagnostics);
    if (fields) result.push({ ...entry, fields });
  }
  return result;
}

function readFlowSpecs(value: unknown, diagnostics: Diagnostic[]): BindingFlowSpec[] | null {
  if (!Array.isArray(value)) {
    diagnostics.push(error("绑定文件的 flows 必须是数组", LOCATION));
    return null;
  }
  const result: BindingFlowSpec[] = [];
  for (const [index, item] of value.entries()) {
    const entry = readEntry(item, `flows[${index}]`, diagnostics);
    if (!entry) continue;
    const inputs = readEntries(isRecord(item) ? item.inputs : undefined, `flows[${index}].inputs`, diagnostics);
    const outputs = readEntries(isRecord(item) ? item.outputs : undefined, `flows[${index}].outputs`, diagnostics);
    if (inputs && outputs) result.push({ ...entry, inputs, outputs });
  }
  return result;
}

function readEntries(value: unknown, label: string, diagnostics: Diagnostic[]): BindingEntrySpec[] | null {
  if (!Array.isArray(value)) {
    diagnostics.push(error(`${label} 必须是数组`, LOCATION));
    return null;
  }
  const result: BindingEntrySpec[] = [];
  for (const [index, item] of value.entries()) {
    const entry = readEntry(item, `${label}[${index}]`, diagnostics);
    if (entry) result.push(entry);
  }
  return result;
}

function readEntry(value: unknown, label: string, diagnostics: Diagnostic[]): BindingEntrySpec | null {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.auditName !== "string" || typeof value.programName !== "string") {
    diagnostics.push(error(`${label} 必须包含 id、auditName 和 programName`, LOCATION));
    return null;
  }
  return { id: value.id, auditName: value.auditName, programName: value.programName };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isJavaScriptIdentifier(value: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(value) && !JAVA_SCRIPT_RESERVED_WORDS.has(value);
}

const JAVA_SCRIPT_RESERVED_WORDS = new Set([
  "break", "case", "catch", "class", "const", "continue", "debugger", "default", "delete", "do", "else", "export", "extends", "finally", "for", "function", "if", "import", "in", "instanceof", "let", "new", "return", "super", "switch", "this", "throw", "try", "typeof", "var", "void", "while", "with", "yield",
]);
