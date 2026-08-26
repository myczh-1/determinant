import {
  BOOLEAN,
  DURATION,
  INTEGER,
  TIME,
  UNKNOWN,
  type Expression,
  type FlowDeclaration,
  type FlowSignature,
  type ObjectDeclaration,
  type ObjectType,
  type OutputField,
  type Program,
  type RecordType,
  type Statement,
  type TypeField,
  type TypeRef,
  type ValueType,
} from "./ast.js";
import { error, type Diagnostic } from "./diagnostics.js";
import { DEFAULT_LANGUAGE, localizeDiagnostics, type AALLanguage } from "./language.js";

export type Environment = Map<string, TypeRef>;

export interface ProgramTypeInfo {
  readonly valueTypes: ReadonlyMap<string, ValueType>;
  readonly objectTypes: ReadonlyMap<string, ObjectType>;
  readonly flowSignatures: ReadonlyMap<string, FlowSignature>;
}

export function checkAAL(program: Program, language: AALLanguage = DEFAULT_LANGUAGE): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const typeInfo = createProgramTypeInfo(program);
  checkDeclarations(program, typeInfo, diagnostics);
  checkFlows(program, typeInfo, diagnostics);
  checkHttpEntries(program, typeInfo, diagnostics);
  return localizeDiagnostics(diagnostics, language);
}

export function createProgramTypeInfo(program: Program): ProgramTypeInfo {
  const valueTypes = new Map<string, ValueType>();
  for (const valueSet of program.valueSets) {
    valueTypes.set(valueSet.name, { kind: "value", name: valueSet.name, values: valueSet.values.map((value) => value.name) });
  }
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
        type: resolveTypeWithoutDiagnostics(field.type, objectTypes, valueTypes),
      })),
    });
  }

  const flowSignatures = new Map<string, FlowSignature>();
  for (const flow of program.flows) {
    flowSignatures.set(flow.name, {
      name: flow.name,
      inputs: flow.inputs.map((input) => ({
        ...input,
        type: resolveTypeWithoutDiagnostics(input.type, objectTypes, valueTypes),
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

  populateOutputTypes(program.flows, flowSignatures, objectTypes, valueTypes);

  return { valueTypes, objectTypes, flowSignatures };
}

function populateOutputTypes(
  flows: readonly FlowDeclaration[],
  signatures: Map<string, FlowSignature>,
  objects: ReadonlyMap<string, ObjectType>,
  valueTypes: ReadonlyMap<string, ValueType>,
): void {
  for (let pass = 0; pass < Math.max(1, flows.length); pass += 1) {
    for (const flow of flows) {
      const environment = createValueEnvironment(valueTypes);
      for (const input of flow.inputs) environment.set(input.name, resolveTypeWithoutDiagnostics(input.type, objects, valueTypes));
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
        } else if (statement.kind === "create" || statement.kind === "query") {
          const objectType = objects.get(statement.objectName);
          if (objectType) environment.set(statement.name, objectType);
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

function checkDeclarations(program: Program, typeInfo: ProgramTypeInfo, diagnostics: Diagnostic[]): void {
  const declarationNames = new Set<string>();
  const valueMembers = new Set<string>();
  for (const valueSet of program.valueSets) {
    if (declarationNames.has(valueSet.name)) diagnostics.push(error(`取值重复声明：${valueSet.name}`, valueSet.loc));
    declarationNames.add(valueSet.name);
    const localMembers = new Set<string>();
    for (const value of valueSet.values) {
      if (localMembers.has(value.name)) diagnostics.push(error(`取值 ${valueSet.name} 的成员重复：${value.name}`, value.loc));
      localMembers.add(value.name);
      if (valueMembers.has(value.name)) diagnostics.push(error(`取值成员必须在应用内唯一：${value.name}`, value.loc));
      valueMembers.add(value.name);
    }
  }
  const objectNames = new Set<string>();
  for (const object of program.objects) {
    if (objectNames.has(object.name)) diagnostics.push(error(`对象重复声明：${object.name}`, object.loc));
    if (declarationNames.has(object.name)) diagnostics.push(error(`顶层类型名称重复：${object.name}`, object.loc));
    declarationNames.add(object.name);
    objectNames.add(object.name);
    checkFields(object.fields, `对象 ${object.name} 的字段`, typeInfo, diagnostics);
    const identityNames = new Set<string>();
    const resolvedObject = typeInfo.objectTypes.get(object.name);
    for (const identity of object.identityFields) {
      if (identityNames.has(identity)) diagnostics.push(error(`对象 ${object.name} 的身份字段重复：${identity}`, object.loc));
      identityNames.add(identity);
      const field = resolvedObject?.fields.find((candidate) => candidate.name === identity);
      if (!field) diagnostics.push(error(`对象 ${object.name} 的身份引用了未声明字段：${identity}`, object.loc));
      else if (!["integer", "text", "boolean"].includes(field.type.kind)) diagnostics.push(error(`对象 ${object.name} 的身份字段必须是整数、文本或布尔：${identity}`, field.loc ?? object.loc));
    }
  }
}

function checkFlows(program: Program, typeInfo: ProgramTypeInfo, diagnostics: Diagnostic[]): void {
  const flowNames = new Set<string>();
  for (const flow of program.flows) {
    if (flowNames.has(flow.name)) diagnostics.push(error(`流程重复声明：${flow.name}`, flow.loc));
    flowNames.add(flow.name);
    checkFlow(flow, program, typeInfo, diagnostics);
  }
}

function checkFlow(flow: FlowDeclaration, program: Program, typeInfo: ProgramTypeInfo, diagnostics: Diagnostic[]): void {
  const signature = typeInfo.flowSignatures.get(flow.name);
  if (!signature) return;

  const environment = createValueEnvironment(typeInfo.valueTypes);
  const storedObjectNames = new Set<string>();
  const inputNames = new Set<string>();
  for (const input of flow.inputs) {
    if (inputNames.has(input.name)) diagnostics.push(error(`流程 ${flow.name} 的输入重复声明：${input.name}`, input.loc));
    if (environment.has(input.name)) diagnostics.push(error(`流程输入名称不能与取值成员相同：${input.name}`, input.loc));
    inputNames.add(input.name);
    resolveType(input.type, typeInfo.objectTypes, typeInfo.valueTypes, diagnostics, input.loc);
    environment.set(input.name, resolveTypeWithoutDiagnostics(input.type, typeInfo.objectTypes, typeInfo.valueTypes));
  }

  const checkStatements = (statements: readonly Statement[], environment: Environment, storedObjectNames: Set<string>): void => {
    for (const statement of statements) {
    if (statement.kind === "atomic") {
      for (const nested of statement.statements) {
        if (nested.kind !== "create" && nested.kind !== "change") diagnostics.push(error("同时生效当前只允许创建和改变", nested.loc));
      }
      checkStatements(statement.statements, new Map(environment), new Set(storedObjectNames));
      continue;
    }
    if (statement.kind === "conditional") {
      const conditionType = inferExpressionType(statement.condition, environment, diagnostics);
      if (conditionType && conditionType.kind !== "boolean") diagnostics.push(error("条件业务步骤必须使用布尔条件", statement.condition.loc));
      checkStatements(statement.statements, new Map(environment), new Set(storedObjectNames));
      continue;
    }
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

    if (statement.kind === "create") {
      const objectType = typeInfo.objectTypes.get(statement.objectName);
      if (!objectType) {
        diagnostics.push(error(`创建引用了未声明的对象：${statement.objectName}`, statement.loc));
        continue;
      }
      requireIdentity(program.objects.find((object) => object.name === statement.objectName) ?? null, statement.loc, diagnostics);
      if (environment.has(statement.name)) diagnostics.push(error(`名称重复定义：${statement.name}`, statement.loc));
      const assignmentEnvironment = new Map(environment);
      assignmentEnvironment.set(statement.name, objectType);
      const assigned = new Set<string>();
      for (const assignment of statement.assignments) {
        if (assignment.target.kind !== "member" || assignment.target.object.kind !== "reference" || assignment.target.object.name !== statement.name) {
          diagnostics.push(error(`创建只能给 ${statement.name} 的字段赋值`, assignment.loc));
          continue;
        }
        const fieldName = assignment.target.property;
        if (assigned.has(fieldName)) diagnostics.push(error(`创建字段重复赋值：${fieldName}`, assignment.loc));
        assigned.add(fieldName);
        const targetType = inferExpressionType(assignment.target, assignmentEnvironment, diagnostics);
        const valueType = inferExpressionType(assignment.expression, environment, diagnostics);
        if (targetType && valueType && !areSameType(targetType, valueType)) {
          diagnostics.push(error(`创建字段 ${fieldName} 类型不匹配：需要 ${describeType(targetType)}，实际是 ${describeType(valueType)}`, assignment.loc));
        }
      }
      for (const field of objectType.fields) if (!assigned.has(field.name)) diagnostics.push(error(`创建缺少字段：${field.name}`, statement.loc));
      environment.set(statement.name, objectType);
      storedObjectNames.add(statement.name);
      continue;
    }

    if (statement.kind === "query") {
      const objectType = typeInfo.objectTypes.get(statement.objectName);
      if (!objectType) {
        diagnostics.push(error(`查询引用了未声明的对象：${statement.objectName}`, statement.loc));
        continue;
      }
      requireIdentity(program.objects.find((object) => object.name === statement.objectName) ?? null, statement.loc, diagnostics);
      if (environment.has(statement.name)) diagnostics.push(error(`名称重复定义：${statement.name}`, statement.loc));
      const queryEnvironment = new Map(environment);
      queryEnvironment.set(statement.name, objectType);
      const conditionType = inferExpressionType(statement.condition, queryEnvironment, diagnostics);
      if (conditionType && conditionType.kind !== "boolean") diagnostics.push(error("查询条件必须是布尔条件", statement.condition.loc));
      environment.set(statement.name, objectType);
      storedObjectNames.add(statement.name);
      continue;
    }

    if (statement.kind === "delete") {
      if (statement.expression.kind !== "reference" || !storedObjectNames.has(statement.expression.name)) {
        diagnostics.push(error("删除必须指定当前流程中创建或查询到的对象", statement.loc));
      }
      const deletedType = inferExpressionType(statement.expression, environment, diagnostics);
      if (deletedType && deletedType.kind !== "object") diagnostics.push(error("删除必须指定一个对象", statement.loc));
      if (deletedType?.kind === "object") requireIdentity(program.objects.find((object) => object.name === deletedType.name) ?? null, statement.loc, diagnostics);
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
      if (statement.target.object.kind === "reference" && storedObjectNames.has(statement.target.object.name) && rootType?.kind === "object") {
        const declaration = program.objects.find((object) => object.name === rootType.name);
        if (declaration?.identityFields.includes(statement.target.property)) diagnostics.push(error(`不能改变对象身份字段：${statement.target.property}`, statement.loc));
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
        const expected = resolveTypeWithoutDiagnostics(called.inputs[index].type, typeInfo.objectTypes, typeInfo.valueTypes);
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
  };

  checkStatements(flow.statements, environment, storedObjectNames);

  const output = checkOutputs(flow.outputs, environment, flow.name, diagnostics);
  (typeInfo.flowSignatures as Map<string, FlowSignature>).set(flow.name, { ...signature, output });
}

function checkHttpEntries(program: Program, typeInfo: ProgramTypeInfo, diagnostics: Diagnostic[]): void {
  const names = new Set<string>();
  const routes = new Set<string>();
  for (const entry of program.httpEntries) {
    if (names.has(entry.name)) diagnostics.push(error(`HTTP 入口重复声明：${entry.name}`, entry.loc));
    names.add(entry.name);
    const routeKey = `${entry.method} ${entry.path.replace(/\{[\p{L}_][\p{L}\p{N}_]*\}/gu, "{}")}`;
    if (routes.has(routeKey)) diagnostics.push(error(`HTTP 路由重复声明：${routeKey}`, entry.loc));
    routes.add(routeKey);
    if (entry.successStatus < 200 || entry.successStatus > 299) diagnostics.push(error("HTTP 成功状态必须是 2xx", entry.loc));
    for (const failure of entry.failureMappings) {
      if (failure.status < 400 || failure.status > 599) diagnostics.push(error("HTTP 失败状态必须是 4xx 或 5xx", failure.loc));
    }

    const flow = program.flows.find((candidate) => candidate.name === entry.targetFlow);
    const signature = typeInfo.flowSignatures.get(entry.targetFlow);
    if (!flow || !signature) {
      diagnostics.push(error(`HTTP 入口引用了未声明的流程：${entry.targetFlow}`, entry.loc));
      continue;
    }
    const mappings = [...entry.pathMappings, ...entry.bodyMappings];
    const targetNames = new Set<string>();
    const sourceByLocation = new Set<string>();
    for (const mapping of mappings) {
      if (targetNames.has(mapping.targetName)) diagnostics.push(error(`HTTP 输入重复映射：${mapping.targetName}`, mapping.loc));
      targetNames.add(mapping.targetName);
      const input = signature.inputs.find((candidate) => candidate.name === mapping.targetName);
      if (!input) diagnostics.push(error(`HTTP 映射引用了未声明的流程输入：${mapping.targetName}`, mapping.loc));
      else if (input.type.kind === "money" && entry.pathMappings.includes(mapping)) diagnostics.push(error("HTTP 路径参数不能使用金额类型", mapping.loc));
      else if (!["integer", "text", "boolean", "money"].includes(input.type.kind)) diagnostics.push(error(`HTTP 输入暂不支持类型：${describeType(input.type)}`, mapping.loc));
      const locationKey = `${entry.pathMappings.includes(mapping) ? "path" : "body"}:${mapping.sourceName}`;
      if (sourceByLocation.has(locationKey)) diagnostics.push(error(`HTTP 请求字段重复：${mapping.sourceName}`, mapping.loc));
      sourceByLocation.add(locationKey);
    }
    const systemSources = new Set<string>();
    for (const mapping of entry.systemMappings) {
      if (targetNames.has(mapping.targetName)) diagnostics.push(error(`HTTP 输入重复映射：${mapping.targetName}`, mapping.loc));
      targetNames.add(mapping.targetName);
      const input = signature.inputs.find((candidate) => candidate.name === mapping.targetName);
      if (!input) diagnostics.push(error(`系统提供映射引用了未声明的流程输入：${mapping.targetName}`, mapping.loc));
      else if (input.type.kind !== "time") diagnostics.push(error(`当前时间只能映射到时间输入：${mapping.targetName}`, mapping.loc));
      if (systemSources.has(mapping.source)) diagnostics.push(error("同一 HTTP 入口不能重复提供当前时间", mapping.loc));
      systemSources.add(mapping.source);
    }
    for (const input of signature.inputs) if (!targetNames.has(input.name)) diagnostics.push(error(`HTTP 入口缺少流程输入映射：${input.name}`, entry.loc));

    const placeholders = [...entry.path.matchAll(/\{([\p{L}_][\p{L}\p{N}_]*)\}/gu)].map((match) => match[1]);
    const mappedPathNames = entry.pathMappings.map((mapping) => mapping.sourceName);
    for (const placeholder of placeholders) if (!mappedPathNames.includes(placeholder)) diagnostics.push(error(`请求路径缺少参数映射：${placeholder}`, entry.loc));
    for (const source of mappedPathNames) if (!placeholders.includes(source)) diagnostics.push(error(`请求路径映射未出现在路由中：${source}`, entry.loc));

    const possibleFailures = collectFlowFailures(flow, program, new Set());
    const mappedFailures = new Set<string>();
    for (const mapping of entry.failureMappings) {
      if (mappedFailures.has(mapping.failureMessage)) diagnostics.push(error(`HTTP 失败重复映射：${mapping.failureMessage}`, mapping.loc));
      mappedFailures.add(mapping.failureMessage);
      if (!possibleFailures.has(mapping.failureMessage)) diagnostics.push(error(`HTTP 映射了流程不会产生的失败：${mapping.failureMessage}`, mapping.loc));
    }
    for (const failure of possibleFailures) if (!mappedFailures.has(failure)) diagnostics.push(error(`HTTP 入口缺少失败映射：${failure}`, entry.loc));
  }
}

function collectFlowFailures(flow: FlowDeclaration, program: Program, visiting: Set<string>): Set<string> {
  if (visiting.has(flow.name)) return new Set();
  visiting.add(flow.name);
  const failures = collectStatementFailures(flow.statements, program, visiting);
  visiting.delete(flow.name);
  return failures;
}

function collectStatementFailures(statements: readonly Statement[], program: Program, visiting: Set<string>): Set<string> {
  const failures = new Set<string>();
  for (const statement of statements) {
    if (statement.kind === "if" || statement.kind === "create" || statement.kind === "query") failures.add(statement.failureMessage);
    if (statement.kind === "conditional") for (const message of collectStatementFailures(statement.statements, program, visiting)) failures.add(message);
    if (statement.kind === "atomic") for (const message of collectStatementFailures(statement.statements, program, visiting)) failures.add(message);
    if (statement.kind === "execute") {
      const called = program.flows.find((candidate) => candidate.name === statement.flowName);
      if (called) for (const message of collectFlowFailures(called, program, visiting)) failures.add(message);
    }
  }
  return failures;
}

function requireIdentity(object: ObjectDeclaration | null, loc: { line: number; column: number }, diagnostics: Diagnostic[]): void {
  if (object && object.identityFields.length === 0) diagnostics.push(error(`对象 ${object.name} 用于 CRUD 时必须声明身份`, loc));
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

function checkFields(fields: readonly TypeField[], label: string, typeInfo: ProgramTypeInfo, diagnostics: Diagnostic[]): void {
  const names = new Set<string>();
  for (const field of fields) {
    if (names.has(field.name)) diagnostics.push(error(`${label}中字段重复：${field.name}`, field.loc ?? { line: 1, column: 1 }));
    names.add(field.name);
    resolveType(field.type, typeInfo.objectTypes, typeInfo.valueTypes, diagnostics, field.loc ?? { line: 1, column: 1 });
  }
}

export function inferExpressionType(expression: Expression, environment: Environment, diagnostics: Diagnostic[] = []): TypeRef | null {
  if (expression.kind === "integer-literal") return INTEGER;
  if (expression.kind === "money-literal") return { kind: "money", currency: expression.currency, unit: expression.unit, scale: expression.scale };
  if (expression.kind === "duration-literal") return DURATION;
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
  if (expression.kind === "unary") {
    const operand = inferExpressionType(expression.expression, environment, diagnostics);
    if (operand?.kind === "boolean") return BOOLEAN;
    if (operand) diagnostics.push(error(`运算 非 只支持布尔，实际是 ${describeType(operand)}`, expression.loc));
    return null;
  }

  const left = inferExpressionType(expression.left, environment, diagnostics);
  const right = inferExpressionType(expression.right, environment, diagnostics);
  if (!left || !right) return null;
  if (expression.operator === "and" || expression.operator === "or") {
    if (left.kind === "boolean" && right.kind === "boolean") return BOOLEAN;
    diagnostics.push(error(`逻辑运算只支持布尔，实际是 ${describeType(left)} 与 ${describeType(right)}`, expression.loc));
    return null;
  }
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
  if (expression.operator === "+" && left.kind === "time" && right.kind === "duration") return TIME;
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
  if (left.kind === "time" && right.kind === "time") return true;
  if (left.kind === "duration" && right.kind === "duration") return true;
  if (left.kind === "money" && right.kind === "money") return left.currency === right.currency && left.unit === right.unit && left.scale === right.scale;
  if (left.kind === "value" && right.kind === "value") return left.name === right.name;
  if (left.kind === "object" && right.kind === "object") return left.name === right.name;
  if (left.kind === "record" && right.kind === "record") return left.name === right.name;
  return false;
}

export function describeType(type: TypeRef): string {
  if (type.kind === "integer") return "整数";
  if (type.kind === "text") return "文本";
  if (type.kind === "boolean") return "布尔";
  if (type.kind === "time") return "时间";
  if (type.kind === "duration") return "持续时间";
  if (type.kind === "money") return `${type.currency === "CNY" ? "人民币" : type.currency === "USD" ? "美元" : type.currency}金额（单位为${type.unit}）`;
  if (type.kind === "value") return `取值 ${type.name}`;
  if (type.kind === "named") return `未解析类型 ${type.name}`;
  if (type.kind === "object") return `对象 ${type.name}`;
  if (type.kind === "record") return `流程 ${type.name} 的输出`;
  return "未知类型";
}

export function flowKey(name: string): string {
  return name;
}

function resolveType(
  type: TypeRef,
  objects: ReadonlyMap<string, ObjectType>,
  valueTypes: ReadonlyMap<string, ValueType>,
  diagnostics: Diagnostic[],
  loc: { line: number; column: number },
): TypeRef {
  if (type.kind !== "named") return type;
  const resolved = objects.get(type.name) ?? valueTypes.get(type.name);
  if (!resolved) diagnostics.push(error(`引用了未声明的类型：${type.name}`, loc));
  return resolved ?? type;
}

function resolveTypeWithoutDiagnostics(type: TypeRef, objects: ReadonlyMap<string, ObjectType>, valueTypes: ReadonlyMap<string, ValueType>): TypeRef {
  if (type.kind !== "named") return type;
  return objects.get(type.name) ?? valueTypes.get(type.name) ?? type;
}

function createValueEnvironment(valueTypes: ReadonlyMap<string, ValueType>): Environment {
  const environment: Environment = new Map();
  for (const valueType of valueTypes.values()) {
    for (const value of valueType.values) if (!environment.has(value)) environment.set(value, valueType);
  }
  return environment;
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
