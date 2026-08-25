import {
  BOOLEAN,
  INTEGER,
  TEXT,
  type BinaryExpression,
  type CalculateStatement,
  type ChangeStatement,
  type CreateStatement,
  type DeleteStatement,
  type ExecuteStatement,
  type Expression,
  type FlowDeclaration,
  type FlowInput,
  type IfStatement,
  type HttpEntryDeclaration,
  type HttpFieldMapping,
  type ObjectDeclaration,
  type OutputField,
  type Program,
  type QueryStatement,
  type SourceLocation,
  type Statement,
  type TypeField,
  type TypeRef,
} from "./ast.js";
import { error, type Diagnostic } from "./diagnostics.js";
import { DEFAULT_LANGUAGE, localizeDiagnostics, normalizeAALSource, type AALLanguage } from "./language.js";

interface SourceLine {
  readonly number: number;
  readonly text: string;
  readonly indent: number;
  readonly content: string;
}

interface Token {
  readonly kind: "number" | "identifier" | "operator" | "left-paren" | "right-paren";
  readonly value: string;
  readonly column: number;
}

class ExpressionParser {
  private readonly tokens: Token[];
  private index = 0;

  constructor(private readonly line: number, private readonly column: number, text: string, private readonly diagnostics: Diagnostic[]) {
    this.tokens = tokenize(text, line, column, diagnostics);
  }

  parse(): Expression | null {
    if (this.tokens.length === 0) {
      this.diagnostics.push(error("表达式不能为空", location(this.line, this.column)));
      return null;
    }
    const expression = this.parseComparison();
    if (this.index < this.tokens.length) {
      const token = this.tokens[this.index];
      this.diagnostics.push(error(`表达式中出现无法识别的内容：${token.value}`, location(this.line, token.column)));
      return null;
    }
    return expression;
  }

  private parseComparison(): Expression | null {
    let left = this.parseAdditive();
    while (left && this.peek("operator", [">", ">=", "<", "<=", "==", "!="])) {
      const operator = this.consume().value as BinaryExpression["operator"];
      const right = this.parseAdditive();
      if (!right) return null;
      left = { kind: "binary", operator, left, right, loc: location(this.line, this.column) };
    }
    return left;
  }

  private parseAdditive(): Expression | null {
    let left = this.parseMultiplicative();
    while (left && this.peek("operator", ["+", "-"])) {
      const operator = this.consume().value as BinaryExpression["operator"];
      const right = this.parseMultiplicative();
      if (!right) return null;
      left = { kind: "binary", operator, left, right, loc: location(this.line, this.column) };
    }
    return left;
  }

  private parseMultiplicative(): Expression | null {
    let left = this.parsePrimary();
    while (left && this.peek("operator", ["*", "/", "%"])) {
      const operator = this.consume().value as BinaryExpression["operator"];
      const right = this.parsePrimary();
      if (!right) return null;
      left = { kind: "binary", operator, left, right, loc: location(this.line, this.column) };
    }
    return left;
  }

  private parsePrimary(): Expression | null {
    const token = this.tokens[this.index];
    if (!token) {
      this.diagnostics.push(error("表达式缺少值", location(this.line, this.column)));
      return null;
    }

    let expression: Expression;
    if (token.kind === "number") {
      this.index += 1;
      expression = { kind: "integer-literal", value: Number(token.value), loc: location(this.line, token.column) };
    } else if (token.kind === "identifier") {
      this.index += 1;
      expression = { kind: "reference", name: token.value, loc: location(this.line, token.column) };
    } else if (token.kind === "left-paren") {
      this.index += 1;
      const inner = this.parseComparison();
      if (!this.peek("right-paren", [")"])) {
        this.diagnostics.push(error("缺少右括号 )", location(this.line, token.column)));
        return null;
      }
      this.index += 1;
      if (!inner) return null;
      expression = inner;
    } else {
      this.diagnostics.push(error(`表达式不应从 ${token.value} 开始`, location(this.line, token.column)));
      return null;
    }

    while (this.peek("identifier", ["的"])) {
      this.index += 1;
      const property = this.tokens[this.index];
      if (!property || property.kind !== "identifier" || property.value === "的") {
        this.diagnostics.push(error("“的”后必须是字段名称", location(this.line, property?.column ?? token.column)));
        return null;
      }
      this.index += 1;
      expression = { kind: "member", object: expression, property: property.value, loc: location(this.line, property.column) };
    }
    return expression;
  }

  private peek(kind: Token["kind"], values: string[]): boolean {
    const token = this.tokens[this.index];
    return Boolean(token && token.kind === kind && values.includes(token.value));
  }

  private consume(): Token {
    return this.tokens[this.index++];
  }
}

export interface ParseResult {
  readonly program: Program | null;
  readonly diagnostics: readonly Diagnostic[];
}

export interface ParseOptions {
  readonly language?: AALLanguage;
}

export function parseAAL(source: string, options: ParseOptions = {}): ParseResult {
  const language = options.language ?? DEFAULT_LANGUAGE;
  const result = parseCanonicalAAL(normalizeAALSource(source, language));
  return { ...result, diagnostics: localizeDiagnostics(result.diagnostics, language) };
}

function parseCanonicalAAL(source: string): ParseResult {
  const diagnostics: Diagnostic[] = [];
  const lines = source.replaceAll("\r\n", "\n").split("\n").map((text, index) => toSourceLine(text, index + 1));
  const meaningful = lines.filter((line) => !isIgnorable(line));
  if (meaningful.length === 0) {
    diagnostics.push(error("AAL 源文件不能为空", location(1, 1)));
    return { program: null, diagnostics };
  }
  const first = meaningful[0];
  if (first.indent !== 0 || !first.content.startsWith("应用：")) {
    diagnostics.push(error("AAL 源文件必须以“应用：名称”开始", location(first.number, first.indent + 1)));
    return { program: null, diagnostics };
  }
  const applicationName = first.content.slice("应用：".length).trim();
  if (!isIdentifier(applicationName)) diagnostics.push(error("应用名称必须是非空标识符", location(first.number, 4)));

  const objects: ObjectDeclaration[] = [];
  const flows: FlowDeclaration[] = [];
  const httpEntries: HttpEntryDeclaration[] = [];
  let index = lines.indexOf(first) + 1;
  while (index < lines.length) {
    const line = lines[index];
    if (isIgnorable(line)) {
      index += 1;
      continue;
    }
    if (line.indent !== 0) {
      diagnostics.push(error("顶层声明必须从第 1 列开始", location(line.number, line.indent + 1)));
      index += 1;
      continue;
    }
    if (line.content.startsWith("对象：")) {
      const parsed = parseObject(lines, index, diagnostics);
      if (parsed.object) objects.push(parsed.object);
      index = parsed.nextIndex;
      continue;
    }
    if (line.content.startsWith("流程：")) {
      const parsed = parseFlow(lines, index, diagnostics);
      if (parsed.flow) flows.push(parsed.flow);
      index = parsed.nextIndex;
      continue;
    }
    if (line.content.startsWith("HTTP 入口：")) {
      const parsed = parseHttpEntry(lines, index, diagnostics);
      if (parsed.entry) httpEntries.push(parsed.entry);
      index = parsed.nextIndex;
      continue;
    }
    diagnostics.push(error(`无法识别的顶层声明：${line.content}`, location(line.number, 1)));
    index += 1;
  }
  if (objects.length === 0) diagnostics.push(error("程序必须至少声明一个对象", location(first.number, 1)));
  if (flows.length === 0) diagnostics.push(error("程序必须至少声明一个流程", location(first.number, 1)));
  return {
    program: { kind: "program", name: applicationName, objects, flows, httpEntries, loc: location(first.number, 1) },
    diagnostics,
  };
}

function parseObject(lines: SourceLine[], start: number, diagnostics: Diagnostic[]): { object: ObjectDeclaration | null; nextIndex: number } {
  const header = lines[start];
  const name = header.content.slice("对象：".length).trim();
  if (!isIdentifier(name)) {
    diagnostics.push(error("对象名称必须是标识符", location(header.number, 4)));
    return { object: null, nextIndex: start + 1 };
  }
  const fields: TypeField[] = [];
  const identityFields: string[] = [];
  let index = start + 1;
  while (index < lines.length) {
    const line = lines[index];
    if (isIgnorable(line)) { index += 1; continue; }
    if (line.indent === 0) break;
    if (line.indent !== 4) {
      diagnostics.push(error("对象成员必须缩进 4 个空格", lineLocation(line)));
      index += 1;
      continue;
    }
    if (line.content === "身份：") {
      const parsed = parseNameList(lines, index + 1, 8, "身份", diagnostics);
      for (const item of parsed.items) {
        if (!isIdentifier(item.text)) diagnostics.push(error("身份字段必须是标识符", location(item.line, item.column)));
        else identityFields.push(item.text);
      }
      index = parsed.nextIndex;
      continue;
    }
    const separator = line.content.indexOf("：");
    if (separator < 1) {
      diagnostics.push(error("对象字段格式应为“名称：类型”", lineLocation(line)));
      index += 1;
      continue;
    }
    const fieldName = line.content.slice(0, separator).trim();
    const typeText = line.content.slice(separator + 1).trim();
    const type = parseType(typeText, line, line.text.indexOf(typeText) + 1, diagnostics);
    if (!isIdentifier(fieldName)) diagnostics.push(error("对象字段名称必须是标识符", lineLocation(line)));
    else if (type) fields.push({ name: fieldName, type, loc: lineLocation(line) });
    index += 1;
  }
  if (fields.length === 0) diagnostics.push(error("对象至少需要一个字段", location(header.number, 1)));
  return { object: { kind: "object", name, fields, identityFields, loc: location(header.number, 1) }, nextIndex: index };
}

function parseFlow(lines: SourceLine[], start: number, diagnostics: Diagnostic[]): { flow: FlowDeclaration | null; nextIndex: number } {
  const header = lines[start];
  const name = header.content.slice("流程：".length).trim();
  if (!isIdentifier(name)) {
    diagnostics.push(error("流程名称必须是标识符", location(header.number, 4)));
    return { flow: null, nextIndex: start + 1 };
  }
  const inputs: FlowInput[] = [];
  const statements: Statement[] = [];
  const outputs: OutputField[] = [];
  let index = start + 1;
  while (index < lines.length) {
    const line = lines[index];
    if (isIgnorable(line)) {
      index += 1;
      continue;
    }
    if (line.indent === 0) break;
    if (line.indent !== 4) {
      diagnostics.push(error("流程成员必须缩进 4 个空格", location(line.number, line.indent + 1)));
      index += 1;
      continue;
    }
    if (line.content === "输入：") {
      const parsed = parseTypedBlock(lines, index + 1, 8, "流程输入", diagnostics);
      inputs.push(...parsed.fields.map((field): FlowInput => ({ kind: "flow-input", name: field.name, type: field.type, loc: field.loc ?? lineLocation(line) })));
      index = parsed.nextIndex;
      continue;
    }
    if (line.content.startsWith("如果 ") && line.content.endsWith("：")) {
      const parsed = parseIf(lines, index, diagnostics);
      if (parsed.statement) statements.push(parsed.statement);
      index = parsed.nextIndex;
      continue;
    }
    if (line.content === "计算：") {
      const parsed = parseAssignments(lines, index + 1, 8, "计算", diagnostics);
      statements.push(...parsed.assignments.map((assignment): CalculateStatement => ({ kind: "calculate", name: assignment.name, expression: assignment.expression, loc: assignment.loc })));
      index = parsed.nextIndex;
      continue;
    }
    if (line.content === "改变：") {
      const parsed = parseAssignments(lines, index + 1, 8, "改变", diagnostics);
      for (const assignment of parsed.assignments) {
        statements.push({ kind: "change", target: assignment.target, expression: assignment.expression, loc: assignment.loc } as ChangeStatement);
      }
      index = parsed.nextIndex;
      continue;
    }
    if (line.content === "执行：") {
      const parsed = parseExecute(lines, index + 1, diagnostics);
      if (parsed.statement) statements.push(parsed.statement);
      index = parsed.nextIndex;
      continue;
    }
    if (line.content === "创建：") {
      const parsed = parseCreate(lines, index + 1, diagnostics);
      if (parsed.statement) statements.push(parsed.statement);
      index = parsed.nextIndex;
      continue;
    }
    if (line.content === "查询：") {
      const parsed = parseQuery(lines, index + 1, diagnostics);
      if (parsed.statement) statements.push(parsed.statement);
      index = parsed.nextIndex;
      continue;
    }
    if (line.content === "删除：") {
      const parsed = parseDelete(lines, index + 1, diagnostics);
      if (parsed.statement) statements.push(parsed.statement);
      index = parsed.nextIndex;
      continue;
    }
    if (line.content === "输出：") {
      const parsed = parseOutputs(lines, index + 1, diagnostics);
      outputs.push(...parsed.outputs);
      index = parsed.nextIndex;
      continue;
    }
    diagnostics.push(error(`无法识别的流程语句：${line.content}`, lineLocation(line)));
    index += 1;
  }
  if (outputs.length === 0) diagnostics.push(error("流程必须包含输出", lineLocation(header)));
  return { flow: { kind: "flow", name, inputs, statements, outputs, loc: lineLocation(header) }, nextIndex: index };
}

function parseIf(lines: SourceLine[], start: number, diagnostics: Diagnostic[]): { statement: IfStatement | null; nextIndex: number } {
  const line = lines[start];
  const conditionText = line.content.slice(3, -1).trim();
  const condition = parseExpression(conditionText, line.number, line.text.indexOf(conditionText) + 1, diagnostics);
  const failure = nextMeaningfulLine(lines, start + 1);
  if (!failure || failure.indent !== 8 || !failure.content.startsWith("失败：")) {
    diagnostics.push(error("如果语句必须包含缩进 8 个空格的“失败：消息”", lineLocation(line)));
    return { statement: null, nextIndex: start + 1 };
  }
  const message = failure.content.slice("失败：".length).trim();
  if (!message) diagnostics.push(error("失败消息不能为空", lineLocation(failure)));
  return {
    statement: condition ? { kind: "if", condition, failureMessage: message, loc: lineLocation(line) } : null,
    nextIndex: lines.indexOf(failure) + 1,
  };
}

function parseAssignments(lines: SourceLine[], start: number, expectedIndent: number, label: string, diagnostics: Diagnostic[]): { assignments: { name: string; target: Expression; expression: Expression; loc: SourceLocation }[]; nextIndex: number } {
  const assignments: { name: string; target: Expression; expression: Expression; loc: SourceLocation }[] = [];
  let index = start;
  while (index < lines.length) {
    const line = lines[index];
    if (isIgnorable(line)) {
      index += 1;
      continue;
    }
    if (line.indent < expectedIndent) break;
    if (line.indent !== expectedIndent) {
      diagnostics.push(error(`${label}内容必须缩进 ${expectedIndent} 个空格`, lineLocation(line)));
      index += 1;
      continue;
    }
    const separator = line.content.indexOf("=");
    if (separator < 1) {
      diagnostics.push(error(`${label}格式应为“名称 = 表达式”`, lineLocation(line)));
      index += 1;
      continue;
    }
    const leftText = line.content.slice(0, separator).trim();
    const rightText = line.content.slice(separator + 1).trim();
    const left = parseExpression(leftText, line.number, line.text.indexOf(leftText) + 1, diagnostics);
    const right = parseExpression(rightText, line.number, line.text.indexOf(rightText) + 1, diagnostics);
    if (!left || !right) {
      index += 1;
      continue;
    }
    const name = left.kind === "reference" ? left.name : "";
    assignments.push({ name, target: left, expression: right, loc: lineLocation(line) });
    index += 1;
  }
  if (assignments.length === 0) diagnostics.push(error(`${label}至少需要一条内容`, location(lines[Math.max(0, start - 1)]?.number ?? 1, 1)));
  return { assignments, nextIndex: index };
}

function parseExecute(lines: SourceLine[], start: number, diagnostics: Diagnostic[]): { statement: ExecuteStatement | null; nextIndex: number } {
  let index = start;
  while (index < lines.length && isIgnorable(lines[index])) index += 1;
  const flowLine = lines[index];
  if (!flowLine || flowLine.indent !== 8 || !isIdentifier(flowLine.content)) {
    diagnostics.push(error("执行必须先指定一个流程名称", location(flowLine?.number ?? 1, 1)));
    return { statement: null, nextIndex: start };
  }
  const flowName = flowLine.content;
  index += 1;
  const inputs: Expression[] = [];
  const outputs: string[] = [];
  while (index < lines.length) {
    const line = lines[index];
    if (isIgnorable(line)) {
      index += 1;
      continue;
    }
    if (line.indent < 8) break;
    if (line.indent !== 8) {
      diagnostics.push(error("执行内容必须缩进 8 个空格", lineLocation(line)));
      index += 1;
      continue;
    }
    if (line.content === "使用：") {
      const parsed = parseNameList(lines, index + 1, 12, "使用", diagnostics);
      for (const item of parsed.items) {
        const expression = parseExpression(item.text, item.line, item.column, diagnostics);
        if (expression) inputs.push(expression);
      }
      index = parsed.nextIndex;
      continue;
    }
    if (line.content === "得到：") {
      const parsed = parseNameList(lines, index + 1, 12, "得到", diagnostics);
      for (const item of parsed.items) {
        if (!isIdentifier(item.text)) diagnostics.push(error("得到的名称必须是标识符", location(item.line, item.column)));
        else outputs.push(item.text);
      }
      index = parsed.nextIndex;
      continue;
    }
    diagnostics.push(error(`无法识别的执行内容：${line.content}`, lineLocation(line)));
    index += 1;
  }
  if (inputs.length === 0) diagnostics.push(error("执行必须包含使用内容", lineLocation(flowLine)));
  if (outputs.length === 0) diagnostics.push(error("执行必须包含得到内容", lineLocation(flowLine)));
  return { statement: { kind: "execute", flowName, inputs, outputs, loc: lineLocation(flowLine) }, nextIndex: index };
}

function parseCreate(lines: SourceLine[], start: number, diagnostics: Diagnostic[]): { statement: CreateStatement | null; nextIndex: number } {
  const declaration = nextMeaningfulLine(lines, start);
  if (!declaration || declaration.indent !== 8) {
    diagnostics.push(error("创建必须先声明“名称：对象类型”", location(declaration?.number ?? 1, 1)));
    return { statement: null, nextIndex: start };
  }
  const declared = parseNamedObject(declaration, "创建", diagnostics);
  let index = lines.indexOf(declaration) + 1;
  const assignments: { target: Expression; expression: Expression; loc: SourceLocation }[] = [];
  let failureMessage = "";
  while (index < lines.length) {
    const line = lines[index];
    if (isIgnorable(line)) { index += 1; continue; }
    if (line.indent < 8) break;
    if (line.indent !== 8) {
      diagnostics.push(error("创建内容必须缩进 8 个空格", lineLocation(line)));
      index += 1;
      continue;
    }
    if (line.content === "包含：") {
      const parsed = parseAssignments(lines, index + 1, 12, "创建的包含内容", diagnostics);
      assignments.push(...parsed.assignments.map(({ target, expression, loc }) => ({ target, expression, loc })));
      index = parsed.nextIndex;
      continue;
    }
    if (line.content === "否则：") {
      const parsed = parseFailureLine(lines, index + 1, 12, diagnostics);
      failureMessage = parsed.message;
      index = parsed.nextIndex;
      continue;
    }
    diagnostics.push(error(`无法识别的创建内容：${line.content}`, lineLocation(line)));
    index += 1;
  }
  if (assignments.length === 0) diagnostics.push(error("创建必须包含字段赋值", lineLocation(declaration)));
  if (!failureMessage) diagnostics.push(error("创建必须包含否则失败", lineLocation(declaration)));
  return {
    statement: declared ? { kind: "create", ...declared, assignments, failureMessage, loc: lineLocation(declaration) } : null,
    nextIndex: index,
  };
}

function parseQuery(lines: SourceLine[], start: number, diagnostics: Diagnostic[]): { statement: QueryStatement | null; nextIndex: number } {
  const declaration = nextMeaningfulLine(lines, start);
  if (!declaration || declaration.indent !== 8) {
    diagnostics.push(error("查询必须先声明“名称：对象类型”", location(declaration?.number ?? 1, 1)));
    return { statement: null, nextIndex: start };
  }
  const declared = parseNamedObject(declaration, "查询", diagnostics);
  let index = lines.indexOf(declaration) + 1;
  let condition: Expression | null = null;
  let failureMessage = "";
  while (index < lines.length) {
    const line = lines[index];
    if (isIgnorable(line)) { index += 1; continue; }
    if (line.indent < 8) break;
    if (line.indent !== 8) {
      diagnostics.push(error("查询内容必须缩进 8 个空格", lineLocation(line)));
      index += 1;
      continue;
    }
    if (line.content === "条件：") {
      const parsed = parseNameList(lines, index + 1, 12, "查询条件", diagnostics);
      if (parsed.items.length !== 1) diagnostics.push(error("MVP 查询必须且只能包含一个条件", lineLocation(line)));
      const item = parsed.items[0];
      if (item) condition = parseExpression(item.text, item.line, item.column, diagnostics);
      index = parsed.nextIndex;
      continue;
    }
    if (line.content === "否则：") {
      const parsed = parseFailureLine(lines, index + 1, 12, diagnostics);
      failureMessage = parsed.message;
      index = parsed.nextIndex;
      continue;
    }
    diagnostics.push(error(`无法识别的查询内容：${line.content}`, lineLocation(line)));
    index += 1;
  }
  if (!condition) diagnostics.push(error("查询必须包含条件", lineLocation(declaration)));
  if (!failureMessage) diagnostics.push(error("查询必须包含否则失败", lineLocation(declaration)));
  return {
    statement: declared && condition ? { kind: "query", ...declared, condition, failureMessage, loc: lineLocation(declaration) } : null,
    nextIndex: index,
  };
}

function parseDelete(lines: SourceLine[], start: number, diagnostics: Diagnostic[]): { statement: DeleteStatement | null; nextIndex: number } {
  const parsed = parseNameList(lines, start, 8, "删除", diagnostics);
  if (parsed.items.length !== 1) diagnostics.push(error("MVP 删除必须且只能指定一个对象", location(lines[start - 1]?.number ?? 1, 1)));
  const item = parsed.items[0];
  const expression = item ? parseExpression(item.text, item.line, item.column, diagnostics) : null;
  return { statement: expression ? { kind: "delete", expression, loc: expression.loc } : null, nextIndex: parsed.nextIndex };
}

function parseNamedObject(line: SourceLine, label: string, diagnostics: Diagnostic[]): { name: string; objectName: string } | null {
  const separator = line.content.indexOf("：");
  const name = separator > 0 ? line.content.slice(0, separator).trim() : "";
  const objectName = separator > 0 ? line.content.slice(separator + 1).trim() : "";
  if (!isIdentifier(name) || !isIdentifier(objectName)) {
    diagnostics.push(error(`${label}格式应为“名称：对象类型”`, lineLocation(line)));
    return null;
  }
  return { name, objectName };
}

function parseFailureLine(lines: SourceLine[], start: number, expectedIndent: number, diagnostics: Diagnostic[]): { message: string; nextIndex: number } {
  const line = nextMeaningfulLine(lines, start);
  if (!line || line.indent !== expectedIndent || !line.content.startsWith("失败：")) {
    diagnostics.push(error(`否则必须包含缩进 ${expectedIndent} 个空格的“失败：消息”`, location(line?.number ?? 1, 1)));
    return { message: "", nextIndex: start };
  }
  const message = line.content.slice("失败：".length).trim();
  if (!message) diagnostics.push(error("失败消息不能为空", lineLocation(line)));
  return { message, nextIndex: lines.indexOf(line) + 1 };
}

function parseHttpEntry(lines: SourceLine[], start: number, diagnostics: Diagnostic[]): { entry: HttpEntryDeclaration | null; nextIndex: number } {
  const header = lines[start];
  const name = header.content.slice("HTTP 入口：".length).trim();
  if (!name) diagnostics.push(error("HTTP 入口名称不能为空", lineLocation(header)));
  let method: HttpEntryDeclaration["method"] | null = null;
  let path = "";
  let targetFlow = "";
  let successStatus = 0;
  const bodyMappings: HttpFieldMapping[] = [];
  const pathMappings: HttpFieldMapping[] = [];
  const failureMappings: { failureMessage: string; status: number; loc: SourceLocation }[] = [];
  let index = start + 1;
  while (index < lines.length) {
    const line = lines[index];
    if (isIgnorable(line)) { index += 1; continue; }
    if (line.indent === 0) break;
    if (line.indent !== 4) {
      diagnostics.push(error("HTTP 入口成员必须缩进 4 个空格", lineLocation(line)));
      index += 1;
      continue;
    }
    if (line.content === "接收：") {
      const item = nextMeaningfulLine(lines, index + 1);
      const match = item?.indent === 8 ? /^(GET|POST|PUT|DELETE)\s+(\/\S*)$/u.exec(item.content) : null;
      if (!match) diagnostics.push(error("接收格式应为“GET /path”", lineLocation(line)));
      else { method = match[1] as HttpEntryDeclaration["method"]; path = match[2]; }
      index = item ? lines.indexOf(item) + 1 : index + 1;
      continue;
    }
    if (line.content === "使用流程：") {
      const item = nextMeaningfulLine(lines, index + 1);
      if (!item || item.indent !== 8 || !isIdentifier(item.content)) diagnostics.push(error("使用流程必须指定流程名称", lineLocation(line)));
      else targetFlow = item.content;
      index = item ? lines.indexOf(item) + 1 : index + 1;
      continue;
    }
    if (line.content === "请求体：" || line.content === "请求路径：") {
      const parsed = parseNameList(lines, index + 1, 8, line.content === "请求体：" ? "请求体" : "请求路径", diagnostics);
      const target = line.content === "请求体：" ? bodyMappings : pathMappings;
      for (const item of parsed.items) {
        const mapping = parseHttpMapping(item.text, item.line, item.column, diagnostics);
        if (mapping) target.push(mapping);
      }
      index = parsed.nextIndex;
      continue;
    }
    if (line.content === "成功：") {
      const parsed = parseReturnStatus(lines, index + 1, diagnostics);
      successStatus = parsed.status;
      index = parsed.nextIndex;
      continue;
    }
    if (line.content.startsWith("如果 ") && line.content.endsWith("：")) {
      const failureMessage = line.content.slice(3, -1).trim();
      const parsed = parseReturnStatus(lines, index + 1, diagnostics);
      if (failureMessage) failureMappings.push({ failureMessage, status: parsed.status, loc: lineLocation(line) });
      else diagnostics.push(error("HTTP 失败消息不能为空", lineLocation(line)));
      index = parsed.nextIndex;
      continue;
    }
    diagnostics.push(error(`无法识别的 HTTP 入口内容：${line.content}`, lineLocation(line)));
    index += 1;
  }
  if (!method || !path) diagnostics.push(error("HTTP 入口必须包含接收", lineLocation(header)));
  if (!targetFlow) diagnostics.push(error("HTTP 入口必须包含使用流程", lineLocation(header)));
  if (!successStatus) diagnostics.push(error("HTTP 入口必须包含成功状态", lineLocation(header)));
  return {
    entry: name && method && path && targetFlow && successStatus
      ? { kind: "http-entry", name, method, path, targetFlow, bodyMappings, pathMappings, successStatus, failureMappings, loc: lineLocation(header) }
      : null,
    nextIndex: index,
  };
}

function parseHttpMapping(text: string, line: number, column: number, diagnostics: Diagnostic[]): HttpFieldMapping | null {
  const parts = text.split(/\s+作为\s+/u);
  if (parts.length > 2 || !isIdentifier(parts[0]) || (parts[1] !== undefined && !isIdentifier(parts[1]))) {
    diagnostics.push(error("HTTP 字段格式应为“字段”或“外部字段 as 输入字段”", location(line, column)));
    return null;
  }
  return { sourceName: parts[0], targetName: parts[1] ?? parts[0], loc: location(line, column) };
}

function parseReturnStatus(lines: SourceLine[], start: number, diagnostics: Diagnostic[]): { status: number; nextIndex: number } {
  const line = nextMeaningfulLine(lines, start);
  const match = line?.indent === 8 ? /^返回\s+(\d{3})$/u.exec(line.content) : null;
  if (!match) {
    diagnostics.push(error("HTTP 状态格式应为缩进 8 个空格的“return 200”", location(line?.number ?? 1, 1)));
    return { status: 0, nextIndex: start };
  }
  return { status: Number(match[1]), nextIndex: lines.indexOf(line!) + 1 };
}

function parseOutputs(lines: SourceLine[], start: number, diagnostics: Diagnostic[]): { outputs: OutputField[]; nextIndex: number } {
  const outputs: OutputField[] = [];
  let index = start;
  while (index < lines.length) {
    const line = lines[index];
    if (isIgnorable(line)) {
      index += 1;
      continue;
    }
    if (line.indent < 8) break;
    if (line.indent !== 8) {
      diagnostics.push(error("输出内容必须缩进 8 个空格", lineLocation(line)));
      index += 1;
      continue;
    }
    const separator = line.content.indexOf("=");
    const name = separator > 0 ? line.content.slice(0, separator).trim() : line.content.trim();
    const expressionText = separator > 0 ? line.content.slice(separator + 1).trim() : name;
    const expression = parseExpression(expressionText, line.number, line.text.indexOf(expressionText) + 1, diagnostics);
    if (!isIdentifier(name)) diagnostics.push(error("输出名称必须是标识符", lineLocation(line)));
    else if (expression) outputs.push({ kind: "output-field", name, expression, loc: lineLocation(line) });
    index += 1;
  }
  return { outputs, nextIndex: index };
}

function parseTypedBlock(lines: SourceLine[], start: number, expectedIndent: number, label: string, diagnostics: Diagnostic[]): { fields: TypeField[]; nextIndex: number } {
  const fields: TypeField[] = [];
  let index = start;
  while (index < lines.length) {
    const line = lines[index];
    if (isIgnorable(line)) {
      index += 1;
      continue;
    }
    if (line.indent < expectedIndent) break;
    if (line.indent !== expectedIndent) {
      diagnostics.push(error(`${label}必须缩进 ${expectedIndent} 个空格`, lineLocation(line)));
      index += 1;
      continue;
    }
    const separator = line.content.indexOf("：");
    if (separator < 1) {
      diagnostics.push(error(`${label}格式应为“名称：类型”`, lineLocation(line)));
      index += 1;
      continue;
    }
    const name = line.content.slice(0, separator).trim();
    const typeText = line.content.slice(separator + 1).trim();
    const type = parseType(typeText, line, line.text.indexOf(typeText) + 1, diagnostics);
    if (!isIdentifier(name)) diagnostics.push(error(`${label}名称必须是标识符`, lineLocation(line)));
    if (type) fields.push({ name, type, loc: lineLocation(line) });
    index += 1;
  }
  return { fields, nextIndex: index };
}

function parseNameList(lines: SourceLine[], start: number, expectedIndent: number, label: string, diagnostics: Diagnostic[]): { items: { text: string; line: number; column: number }[]; nextIndex: number } {
  const items: { text: string; line: number; column: number }[] = [];
  let index = start;
  while (index < lines.length) {
    const line = lines[index];
    if (isIgnorable(line)) {
      index += 1;
      continue;
    }
    if (line.indent < expectedIndent) break;
    if (line.indent !== expectedIndent) {
      diagnostics.push(error(`${label}内容必须缩进 ${expectedIndent} 个空格`, lineLocation(line)));
      index += 1;
      continue;
    }
    items.push({ text: line.content.trim(), line: line.number, column: line.text.indexOf(line.content) + 1 });
    index += 1;
  }
  if (items.length === 0) diagnostics.push(error(`${label}至少需要一项`, location(lines[Math.max(0, start - 1)]?.number ?? 1, 1)));
  return { items, nextIndex: index };
}

function parseType(text: string, line: SourceLine, column: number, diagnostics: Diagnostic[]): TypeRef | null {
  if (text === "整数") return INTEGER;
  if (text === "文本") return TEXT;
  if (text === "布尔") return BOOLEAN;
  const money = /^(人民币|美元)金额(?:，单位为(.+))?$/.exec(text);
  if (money) {
    const currency = money[1] === "人民币" ? "CNY" : "USD";
    const defaultUnit = money[1] === "人民币" ? "yuan" : "dollar";
    const declaredUnit = money[2]?.trim();
    const unit = declaredUnit === "元" ? "yuan" : declaredUnit === "美元" ? "dollar" : declaredUnit || defaultUnit;
    return { kind: "money", currency, unit, scale: 2 };
  }
  if (isIdentifier(text)) return { kind: "object", name: text, fields: [] };
  diagnostics.push(error("类型必须是整数、文本、布尔、人民币金额、美元金额或对象名称", location(line.number, column)));
  return null;
}

function parseExpression(text: string, line: number, column: number, diagnostics: Diagnostic[]): Expression | null {
  return new ExpressionParser(line, column, text, diagnostics).parse();
}

function tokenize(text: string, line: number, column: number, diagnostics: Diagnostic[]): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < text.length) {
    const character = text[index];
    if (/\s/u.test(character)) {
      index += 1;
      continue;
    }
    const tokenColumn = column + index;
    const number = /^\d+/.exec(text.slice(index));
    if (number) {
      tokens.push({ kind: "number", value: number[0], column: tokenColumn });
      index += number[0].length;
      continue;
    }
    const identifier = /^[\p{L}_][\p{L}\p{N}_]*/u.exec(text.slice(index));
    if (identifier) {
      tokens.push({ kind: "identifier", value: identifier[0], column: tokenColumn });
      index += identifier[0].length;
      continue;
    }
    const twoCharacterOperator = text.slice(index, index + 2);
    if ([">=", "<=", "==", "!="].includes(twoCharacterOperator)) {
      tokens.push({ kind: "operator", value: twoCharacterOperator, column: tokenColumn });
      index += 2;
      continue;
    }
    if (["+", "-", "*", "/", "%", ">", "<"].includes(character)) {
      tokens.push({ kind: "operator", value: character, column: tokenColumn });
      index += 1;
      continue;
    }
    if (character === "(") {
      tokens.push({ kind: "left-paren", value: character, column: tokenColumn });
      index += 1;
      continue;
    }
    if (character === ")") {
      tokens.push({ kind: "right-paren", value: character, column: tokenColumn });
      index += 1;
      continue;
    }
    diagnostics.push(error(`表达式中出现无法识别的字符：${character}`, location(line, tokenColumn)));
    index += 1;
  }
  return tokens;
}

function toSourceLine(text: string, number: number): SourceLine {
  const match = /^( *)/.exec(text);
  const indent = match?.[1].length ?? 0;
  return { number, text, indent, content: text.slice(indent).trim() };
}

function nextMeaningfulLine(lines: SourceLine[], start: number): SourceLine | null {
  for (let index = start; index < lines.length; index += 1) if (!isIgnorable(lines[index])) return lines[index];
  return null;
}

function isIgnorable(line: SourceLine): boolean {
  return line.content.length === 0 || line.content.startsWith("#");
}

function isIdentifier(value: string): boolean {
  return /^[\p{L}_][\p{L}\p{N}_]*$/u.test(value);
}

function lineLocation(line: SourceLine): SourceLocation {
  return location(line.number, line.indent + 1);
}

function location(line: number, column: number): SourceLocation {
  return { line, column: Math.max(1, column) };
}
