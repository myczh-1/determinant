import {
  BOOLEAN,
  INTEGER,
  TEXT,
  type BinaryExpression,
  type CalculateStatement,
  type ChangeStatement,
  type ExecuteStatement,
  type Expression,
  type FlowDeclaration,
  type FlowInput,
  type IfStatement,
  type ObjectDeclaration,
  type OutputField,
  type Program,
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
    diagnostics.push(error(`无法识别的顶层声明：${line.content}`, location(line.number, 1)));
    index += 1;
  }
  if (objects.length === 0) diagnostics.push(error("程序必须至少声明一个对象", location(first.number, 1)));
  if (flows.length === 0) diagnostics.push(error("程序必须至少声明一个流程", location(first.number, 1)));
  return {
    program: { kind: "program", name: applicationName, objects, flows, loc: location(first.number, 1) },
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
  const parsed = parseTypedBlock(lines, start + 1, 4, "对象字段", diagnostics);
  if (parsed.fields.length === 0) diagnostics.push(error("对象至少需要一个字段", location(header.number, 1)));
  return { object: { kind: "object", name, fields: parsed.fields, loc: location(header.number, 1) }, nextIndex: parsed.nextIndex };
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
