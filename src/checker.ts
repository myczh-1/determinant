import {
  BOOLEAN,
  INTEGER,
  UNKNOWN,
  type Expression,
  type FlowDeclaration,
  type FlowSignature,
  type ObjectDeclaration,
  type ObjectType,
  type OutputField,
  type Program,
  type RecordType,
  type TypeField,
  type TypeRef,
} from "./ast.js";
import { error, type Diagnostic } from "./diagnostics.js";

export type Environment = Map<string, TypeRef>;

export interface ProgramTypeInfo {
  readonly objectTypes: ReadonlyMap<string, ObjectType>;
  readonly flowSignatures: ReadonlyMap<string, FlowSignature>;
}

export function checkAAL(program: Program): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const typeInfo = createProgramTypeInfo(program);
  checkDeclarations(program.objects, typeInfo, diagnostics);
  checkFlows(program, typeInfo, diagnostics);
  return diagnostics;
}

export function createProgramTypeInfo(program: Program): ProgramTypeInfo {
  const objectTypes = new Map<string, ObjectType>();
  for (const object of program.objects) {
    objectTypes.set(object.name, { kind: "object", name: object.name, fields: [] });
  }

  for (const object of program.objects) {
    objectTypes.set(object.name, {
      kind: "object",
      name: object.name,
      fields: object.fields.map((field) => ({
        ...field,
        type: resolveTypeWithoutDiagnostics(field.type, objectTypes),
      })),
    });
  }

  const flowSignatures = new Map<string, FlowSignature>();
  for (const flow of program.flows) {
    flowSignatures.set(flow.name, {
      name: flow.name,
      inputs: flow.inputs.map((input) => ({
        ...input,
        type: resolveTypeWithoutDiagnostics(input.type, objectTypes),
      })),
      output: {
        kind: "record",
        name: flow.name,
        fields: flow.outputs.map((field) => ({
          name: field.name,
          type: UNKNOWN,
          loc: field.loc,
        })),
      },
    });
  }

  populateOutputTypes(program.flows, flowSignatures, objectTypes);

  return { objectTypes, flowSignatures };
}

function populateOutputTypes(
  flows: readonly FlowDeclaration[],
  signatures: Map<string, FlowSignature>,
  objects: ReadonlyMap<string, ObjectType>,
): void {
  for (let pass = 0; pass < Math.max(1, flows.length); pass += 1) {
    for (const flow of flows) {
      const environment: Environment = new Map();
      for (const input of flow.inputs) environment.set(input.name, resolveTypeWithoutDiagnostics(input.type, objects));
      for (const statement of flow.statements) {
        if (statement.kind === "calculate") {
          const type = inferExpressionType(statement.expression, environment);
          if (type) environment.set(statement.name, type);
        } else if (statement.kind === "execute") {
          const called = signatures.get(statement.flowName);
          if (called) {
            for (let index = 0; index < Math.min(called.output.fields.length, statement.outputs.length); index += 1) {
              environment.set(statement.outputs[index], called.output.fields[index].type);
            }
          }
        }
      }
      signatures.set(flow.name, {
        ...signatures.get(flow.name)!,
        output: {
          kind: "record",
          name: flow.name,
          fields: flow.outputs.map((field) => ({
            name: field.name,
            type: inferExpressionType(field.expression, environment) ?? UNKNOWN,
            loc: field.loc,
          })),
        },
      });
    }
  }
}

function checkDeclarations(objects: readonly ObjectDeclaration[], typeInfo: ProgramTypeInfo, diagnostics: Diagnostic[]): void {
  const objectNames = new Set<string>();
  for (const object of objects) {
    if (objectNames.has(object.name)) diagnostics.push(error(`对象重复声明：${object.name}`, object.loc));
    objectNames.add(object.name);
    checkFields(object.fields, `对象 ${object.name} 的字段`, typeInfo.objectTypes, diagnostics);
  }
}

function checkFlows(program: Program, typeInfo: ProgramTypeInfo, diagnostics: Diagnostic[]): void {
  const flowNames = new Set<string>();
  for (const flow of program.flows) {
    if (flowNames.has(flow.name)) diagnostics.push(error(`流程重复声明：${flow.name}`, flow.loc));
    flowNames.add(flow.name);
    checkFlow(flow, typeInfo, diagnostics);
  }
}

function checkFlow(flow: FlowDeclaration, typeInfo: ProgramTypeInfo, diagnostics: Diagnostic[]): void {
  const signature = typeInfo.flowSignatures.get(flow.name);
  if (!signature) return;

  const environment: Environment = new Map();
  const inputNames = new Set<string>();
  for (const input of flow.inputs) {
    if (inputNames.has(input.name)) diagnostics.push(error(`流程 ${flow.name} 的输入重复声明：${input.name}`, input.loc));
    inputNames.add(input.name);
    resolveType(input.type, typeInfo.objectTypes, diagnostics, input.loc);
    environment.set(input.name, resolveTypeWithoutDiagnostics(input.type, typeInfo.objectTypes));
  }

  for (const statement of flow.statements) {
    if (statement.kind === "if") {
      const conditionType = inferExpressionType(statement.condition, environment, diagnostics);
      if (conditionType && conditionType.kind !== "boolean") {
        diagnostics.push(error("如果条件必须是布尔条件，例如 数量 <= 0", statement.condition.loc));
      }
      continue;
    }

    if (statement.kind === "calculate") {
      if (!isIdentifier(statement.name)) {
        diagnostics.push(error("计算结果必须使用一个名称", statement.loc));
        continue;
      }
      if (environment.has(statement.name)) {
        diagnostics.push(error(`名称重复定义：${statement.name}`, statement.loc));
        continue;
      }
      const expressionType = inferExpressionType(statement.expression, environment, diagnostics);
      if (expressionType) environment.set(statement.name, expressionType);
      continue;
    }

    if (statement.kind === "change") {
      if (statement.target.kind !== "member") {
        diagnostics.push(error("改变必须明确指向对象的字段，例如 库存 的 数量", statement.loc));
        continue;
      }
      const root = rootExpression(statement.target);
      const rootType = inferExpressionType(root, environment, diagnostics);
      if (rootType && rootType.kind !== "object") {
        diagnostics.push(error("改变只能修改对象状态，不能修改计算结果或流程输出", statement.loc));
      }
      const targetType = inferExpressionType(statement.target, environment, diagnostics);
      const valueType = inferExpressionType(statement.expression, environment, diagnostics);
      if (targetType && valueType && !areSameType(targetType, valueType)) {
        diagnostics.push(error(`改变的类型不匹配：需要 ${describeType(targetType)}，实际是 ${describeType(valueType)}`, statement.loc));
      }
      continue;
    }

    if (statement.kind === "execute") {
      const called = typeInfo.flowSignatures.get(statement.flowName);
      if (!called) {
        diagnostics.push(error(`未找到流程：${statement.flowName}`, statement.loc));
        continue;
      }
      if (called.inputs.length !== statement.inputs.length) {
        diagnostics.push(error(`流程 ${called.name} 需要 ${called.inputs.length} 个输入，实际收到 ${statement.inputs.length} 个`, statement.loc));
      }
      for (let index = 0; index < Math.min(called.inputs.length, statement.inputs.length); index += 1) {
        const actual = inferExpressionType(statement.inputs[index], environment, diagnostics);
        const expected = resolveTypeWithoutDiagnostics(called.inputs[index].type, typeInfo.objectTypes);
        if (actual && !areSameType(actual, expected)) {
          diagnostics.push(error(`流程输入 ${called.inputs[index].name} 类型不匹配：需要 ${describeType(expected)}，实际是 ${describeType(actual)}`, statement.inputs[index].loc));
        }
      }
      if (called.output.fields.length !== statement.outputs.length) {
        diagnostics.push(error(`流程 ${called.name} 会得到 ${called.output.fields.length} 个结果，实际声明了 ${statement.outputs.length} 个名称`, statement.loc));
      }
      const names = new Set<string>();
      for (let index = 0; index < Math.min(called.output.fields.length, statement.outputs.length); index += 1) {
        const name = statement.outputs[index];
        if (names.has(name) || environment.has(name)) {
          diagnostics.push(error(`得到的名称重复定义：${name}`, statement.loc));
          continue;
        }
        names.add(name);
        environment.set(name, called.output.fields[index].type);
      }
    }
  }

  const output = checkOutputs(flow.outputs, environment, flow.name, diagnostics);
  (typeInfo.flowSignatures as Map<string, FlowSignature>).set(flow.name, { ...signature, output });
}

function checkOutputs(fields: readonly OutputField[], environment: Environment, name: string, diagnostics: Diagnostic[]): RecordType {
  const names = new Set<string>();
  const outputFields: TypeField[] = [];
  for (const field of fields) {
    if (names.has(field.name)) diagnostics.push(error(`输出名称重复：${field.name}`, field.loc));
    names.add(field.name);
    const actualType = inferExpressionType(field.expression, environment, diagnostics);
    outputFields.push({ name: field.name, type: actualType ?? UNKNOWN, loc: field.loc });
  }
  return { kind: "record", name, fields: outputFields };
}

function checkFields(fields: readonly TypeField[], label: string, objects: ReadonlyMap<string, ObjectType>, diagnostics: Diagnostic[]): void {
  const names = new Set<string>();
  for (const field of fields) {
    if (names.has(field.name)) diagnostics.push(error(`${label}中字段重复：${field.name}`, field.loc ?? { line: 1, column: 1 }));
    names.add(field.name);
    resolveType(field.type, objects, diagnostics, field.loc ?? { line: 1, column: 1 });
  }
}

export function inferExpressionType(expression: Expression, environment: Environment, diagnostics: Diagnostic[] = []): TypeRef | null {
  if (expression.kind === "integer-literal") return INTEGER;
  if (expression.kind === "reference") {
    const type = environment.get(expression.name);
    if (!type) diagnostics.push(error(`引用了未定义的名称：${expression.name}`, expression.loc));
    return type ?? null;
  }
  if (expression.kind === "member") {
    const container = inferExpressionType(expression.object, environment, diagnostics);
    if (!container || (container.kind !== "object" && container.kind !== "record")) {
      diagnostics.push(error(`不能读取类型 ${container ? describeType(container) : "未知类型"} 的字段`, expression.loc));
      return null;
    }
    const field = container.fields.find((candidate) => candidate.name === expression.property);
    if (!field) {
      diagnostics.push(error(`${describeType(container)}没有字段：${expression.property}`, expression.loc));
      return null;
    }
    return field.type;
  }

  const left = inferExpressionType(expression.left, environment, diagnostics);
  const right = inferExpressionType(expression.right, environment, diagnostics);
  if (!left || !right) return null;
  if ([">", ">=", "<", "<=", "==", "!="].includes(expression.operator)) {
    if (!areSameType(left, right)) {
      diagnostics.push(error(`比较两侧类型不兼容：${describeType(left)} 与 ${describeType(right)}`, expression.loc));
      return null;
    }
    return BOOLEAN;
  }
  if (expression.operator === "%" && isInteger(left) && isInteger(right)) return INTEGER;
  if (expression.operator === "/" && isInteger(left) && isInteger(right)) return INTEGER;
  if (expression.operator === "*" && isInteger(left) && isInteger(right)) return INTEGER;
  if (expression.operator === "*" && isMoney(left) && isInteger(right)) return left;
  if (expression.operator === "*" && isInteger(left) && isMoney(right)) return right;
  if ((expression.operator === "+" || expression.operator === "-") && areSameType(left, right) && (isInteger(left) || isMoney(left))) return left;
  diagnostics.push(error(`运算 ${expression.operator} 不支持类型 ${describeType(left)} 与 ${describeType(right)}`, expression.loc));
  return null;
}

export function areSameType(left: TypeRef, right: TypeRef): boolean {
  if (left.kind === "unknown" || right.kind === "unknown") return true;
  if (left.kind !== right.kind) return false;
  if (left.kind === "integer" && right.kind === "integer") return true;
  if (left.kind === "text" && right.kind === "text") return true;
  if (left.kind === "boolean" && right.kind === "boolean") return true;
  if (left.kind === "money" && right.kind === "money") return left.currency === right.currency && left.unit === right.unit && left.scale === right.scale;
  if (left.kind === "object" && right.kind === "object") return left.name === right.name;
  if (left.kind === "record" && right.kind === "record") return left.name === right.name;
  return false;
}

export function describeType(type: TypeRef): string {
  if (type.kind === "integer") return "整数";
  if (type.kind === "text") return "文本";
  if (type.kind === "boolean") return "布尔";
  if (type.kind === "money") return `${type.currency === "CNY" ? "人民币" : type.currency === "USD" ? "美元" : type.currency}金额（单位为${type.unit}）`;
  if (type.kind === "object") return `对象 ${type.name}`;
  if (type.kind === "record") return `流程 ${type.name} 的输出`;
  return "未知类型";
}

export function flowKey(name: string): string {
  return name;
}

function resolveType(type: TypeRef, objects: ReadonlyMap<string, ObjectType>, diagnostics: Diagnostic[], loc: { line: number; column: number }): TypeRef {
  if (type.kind !== "object") return type;
  const resolved = objects.get(type.name);
  if (!resolved) diagnostics.push(error(`引用了未声明的对象类型：${type.name}`, loc));
  return resolved ?? type;
}

function resolveTypeWithoutDiagnostics(type: TypeRef, objects: ReadonlyMap<string, ObjectType>): TypeRef {
  if (type.kind !== "object") return type;
  return objects.get(type.name) ?? type;
}

function rootExpression(expression: Expression): Expression {
  let current = expression;
  while (current.kind === "member") current = current.object;
  return current;
}

function isIdentifier(value: string): boolean {
  return /^[\p{L}_][\p{L}\p{N}_]*$/u.test(value);
}

function isInteger(type: TypeRef): type is typeof INTEGER {
  return type.kind === "integer";
}

function isMoney(type: TypeRef): type is Extract<TypeRef, { kind: "money" }> {
  return type.kind === "money";
}
