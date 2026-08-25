import type { Diagnostic } from "./diagnostics.js";

export type AALLanguage = "en" | "zh-CN";

export const DEFAULT_LANGUAGE: AALLanguage = "en";

export function normalizeLanguage(value: string | undefined): AALLanguage | null {
  if (!value || value === "en") return "en";
  if (value === "zh-CN") return "zh-CN";
  return null;
}

export function normalizeAALSource(source: string, language: AALLanguage): string {
  if (language === "zh-CN") return source;
  return source.replaceAll("\r\n", "\n").split("\n").map(normalizeEnglishLine).join("\n");
}

export function localizeDiagnostics(diagnostics: readonly Diagnostic[], language: AALLanguage): Diagnostic[] {
  if (language === "zh-CN") return [...diagnostics];
  return diagnostics.map((diagnostic) => ({ ...diagnostic, message: localizeMessage(diagnostic.message) }));
}

export function runtimeMessages(language: AALLanguage): {
  invalidMoney: string;
  moneyPrecision: string;
  moneyRequired: string;
  moneyMismatch: string;
  incompatibleMoney: string;
  integerRequired: string;
  objectRequired: string;
} {
  return language === "zh-CN"
    ? {
        invalidMoney: "金额格式无效",
        moneyPrecision: "金额精度超过声明",
        moneyRequired: "必须是金额",
        moneyMismatch: "的币种、单位或精度不匹配",
        incompatibleMoney: "金额的币种、单位或精度不匹配",
        integerRequired: "必须是整数",
        objectRequired: "必须是对象",
      }
    : {
        invalidMoney: "Invalid amount",
        moneyPrecision: "Amount exceeds the declared precision",
        moneyRequired: " must be an amount",
        moneyMismatch: " currency, unit, or precision does not match",
        incompatibleMoney: "Money currency, unit, or precision does not match",
        integerRequired: " must be an integer",
        objectRequired: " must be an object",
      };
}

function normalizeEnglishLine(text: string): string {
  const indent = /^( *)/u.exec(text)?.[1] ?? "";
  const content = text.slice(indent.length).trim();
  if (!content || content.startsWith("#")) return text;

  const header = translateHeader(content, "application", "应用")
    ?? translateHeader(content, "object", "对象")
    ?? translateHeader(content, "flow", "流程");
  if (header) return `${indent}${header}`;

  const sections: Readonly<Record<string, string>> = {
    "input:": "输入：",
    "calculate:": "计算：",
    "change:": "改变：",
    "execute:": "执行：",
    "use:": "使用：",
    "get:": "得到：",
    "output:": "输出：",
  };
  if (sections[content]) return `${indent}${sections[content]}`;

  if (content.startsWith("if ") && content.endsWith(":")) {
    return `${indent}如果 ${normalizeEnglishExpression(content.slice(3, -1).trim())}：`;
  }
  if (content.startsWith("failure:")) {
    return `${indent}失败：${content.slice("failure:".length).trim()}`;
  }

  const typed = /^([^:]+):\s*(.+)$/u.exec(content);
  if (typed) return `${indent}${typed[1].trim()}：${translateEnglishType(typed[2].trim())}`;
  return `${indent}${normalizeEnglishExpression(content)}`;
}

function translateHeader(content: string, english: string, canonical: string): string | null {
  const prefix = `${english}:`;
  if (!content.startsWith(prefix)) return null;
  return `${canonical}：${content.slice(prefix.length).trim()}`;
}

function translateEnglishType(type: string): string {
  if (type === "integer") return "整数";
  if (type === "text") return "文本";
  if (type === "boolean") return "布尔";
  const money = /^(CNY|USD) amount(?:,\s*unit\s+(.+))?$/u.exec(type);
  if (!money) return type;
  const name = money[1] === "CNY" ? "人民币金额" : "美元金额";
  return money[2] ? `${name}，单位为${money[2].trim()}` : name;
}

function normalizeEnglishExpression(expression: string): string {
  return expression.replaceAll("'s ", " 的 ");
}

function localizeMessage(message: string): string {
  let result = message;
  const replacements: readonly [string, string][] = [
    ["AAL 源文件不能为空", "AAL source cannot be empty"],
    ["AAL 源文件必须以“应用：名称”开始", "AAL source must start with 'application: Name'"],
    ["应用名称必须是非空标识符", "Application name must be a non-empty identifier"],
    ["顶层声明必须从第 1 列开始", "Top-level declarations must start in column 1"],
    ["无法识别的顶层声明：", "Unknown top-level declaration: "],
    ["程序必须至少声明一个对象", "The program must declare at least one object"],
    ["程序必须至少声明一个流程", "The program must declare at least one flow"],
    ["对象名称必须是标识符", "Object name must be an identifier"],
    ["对象至少需要一个字段", "An object must have at least one field"],
    ["流程名称必须是标识符", "Flow name must be an identifier"],
    ["流程成员必须缩进 4 个空格", "Flow members must be indented by 4 spaces"],
    ["无法识别的流程语句：", "Unknown flow statement: "],
    ["流程必须包含输出", "A flow must contain an output section"],
    ["如果语句必须包含缩进 8 个空格的“失败：消息”", "An if statement must contain an 8-space-indented 'failure: message'"],
    ["失败消息不能为空", "Failure message cannot be empty"],
    ["表达式不能为空", "Expression cannot be empty"],
    ["表达式中出现无法识别的内容：", "Unexpected expression content: "],
    ["表达式缺少值", "Expression is missing a value"],
    ["缺少右括号 )", "Missing closing parenthesis )"],
    ["表达式不应从 ", "Expression cannot start with "],
    ["“的”后必须是字段名称", "A field name must follow the member connector"],
    ["表达式中出现无法识别的字符：", "Unrecognized character in expression: "],
    ["执行必须先指定一个流程名称", "Execute must specify a flow name first"],
    ["执行内容必须缩进 8 个空格", "Execute content must be indented by 8 spaces"],
    ["得到的名称必须是标识符", "A received name must be an identifier"],
    ["无法识别的执行内容：", "Unknown execute content: "],
    ["执行必须包含使用内容", "Execute must contain a use section"],
    ["执行必须包含得到内容", "Execute must contain a get section"],
    ["输出内容必须缩进 8 个空格", "Output content must be indented by 8 spaces"],
    ["输出名称必须是标识符", "Output name must be an identifier"],
    ["类型必须是整数、文本、布尔、人民币金额、美元金额或对象名称", "Type must be integer, text, boolean, CNY amount, USD amount, or an object name"],
    ["对象重复声明：", "Duplicate object declaration: "],
    ["流程重复声明：", "Duplicate flow declaration: "],
    ["流程输入 ", "Flow input "],
    [" 类型不匹配：需要 ", " type mismatch: expected "],
    ["流程 ", "Flow "],
    ["对象 ", "Object "],
    [" 的字段", " fields"],
    [" 的输入", " inputs"],
    [" 的输出", " outputs"],
    ["如果条件必须是布尔条件，例如 数量 <= 0", "An if condition must be Boolean, for example quantity <= 0"],
    ["计算结果必须使用一个名称", "A calculation result must have a name"],
    ["名称重复定义：", "Duplicate name: "],
    ["改变必须明确指向对象的字段，例如 库存 的 数量", "Change must target an object field, for example inventory's quantity"],
    ["改变只能修改对象状态，不能修改计算结果或流程输出", "Change can only mutate object state"],
    ["改变的类型不匹配：需要 ", "Change type mismatch: expected "],
    ["未找到流程：", "Flow not found: "],
    ["引用了未定义的名称：", "Undefined name: "],
    ["不能读取类型 ", "Cannot read a field from type "],
    ["没有字段：", " has no field: "],
    ["比较两侧类型不兼容：", "Comparison types are incompatible: "],
    ["运算 ", "Operator "],
    [" 不支持类型 ", " does not support types "],
    ["引用了未声明的对象类型：", "Undeclared object type: "],
    ["绑定文件不是有效 JSON：", "Binding file is not valid JSON: "],
    ["绑定文件必须包含 version: 1", "Binding file must contain version: 1"],
    ["对象缺少绑定：", "Object is missing a binding: "],
    ["流程缺少绑定：", "Flow is missing a binding: "],
    ["绑定引用了未声明的对象：", "Binding references an undeclared object: "],
    ["绑定引用了未声明的流程：", "Binding references an undeclared flow: "],
    ["绑定了未声明的名称：", " binds an undeclared name: "],
    ["绑定重复：", " has a duplicate binding: "],
    ["缺少绑定：", " is missing a binding: "],
    ["的程序名称必须是合法标识符：", " program name must be a valid identifier: "],
    ["的程序名称重复：", " has a duplicate program name: "],
    ["的程序名称不能为空", " program name cannot be empty"],
    ["的内部身份必须是稳定的小写标识：", " stable ID must be a lowercase identifier: "],
    ["绑定内部身份重复：", "Duplicate Binding ID: "],
    ["的审计名称不能为空", " audit name cannot be empty"],
    ["绑定文件的 objects 必须是数组", "Binding objects must be an array"],
    ["绑定文件的 flows 必须是数组", "Binding flows must be an array"],
    [" 必须是数组", " must be an array"],
    [" 必须包含 id、auditName 和 programName", " must contain id, auditName, and programName"],
    ["整数", "integer"],
    ["文本", "text"],
    ["布尔", "boolean"],
    ["未知类型", "unknown type"],
    ["人民币金额", "CNY amount"],
    ["美元金额", "USD amount"],
    ["（单位为", " (unit: "],
    ["）", ")"],
    [" 与 ", " and "],
    ["，实际是 ", ", received "],
    ["，实际收到 ", ", received "],
  ];
  for (const [from, to] of replacements) result = result.replaceAll(from, to);
  return result;
}
