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
  invalidRequest: string;
  routeNotFound: string;
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
        invalidRequest: "请求输入无效",
        routeNotFound: "未找到路由",
      }
    : {
        invalidMoney: "Invalid amount",
        moneyPrecision: "Amount exceeds the declared precision",
        moneyRequired: " must be an amount",
        moneyMismatch: " currency, unit, or precision does not match",
        incompatibleMoney: "Money currency, unit, or precision does not match",
        integerRequired: " must be an integer",
        objectRequired: " must be an object",
        invalidRequest: "Invalid request input",
        routeNotFound: "Not found",
      };
}

function normalizeEnglishLine(text: string): string {
  const indent = /^( *)/u.exec(text)?.[1] ?? "";
  const content = text.slice(indent.length).trim();
  if (!content || content.startsWith("#")) return text;

  const header = translateHeader(content, "application", "应用")
    ?? translateHeader(content, "object", "对象")
    ?? translateHeader(content, "flow", "流程")
    ?? translateHeader(content, "HTTP entry", "HTTP 入口")
    ?? translateHeader(content, "http entry", "HTTP 入口");
  if (header) return `${indent}${header}`;

  const sections: Readonly<Record<string, string>> = {
    "input:": "输入：",
    "calculate:": "计算：",
    "change:": "改变：",
    "execute:": "执行：",
    "use:": "使用：",
    "get:": "得到：",
    "output:": "输出：",
    "identity:": "身份：",
    "create:": "创建：",
    "with:": "包含：",
    "otherwise:": "否则：",
    "query:": "查询：",
    "where:": "条件：",
    "delete:": "删除：",
    "receive:": "接收：",
    "use flow:": "使用流程：",
    "request body:": "请求体：",
    "request path:": "请求路径：",
    "success:": "成功：",
  };
  if (sections[content]) return `${indent}${sections[content]}`;

  if (content.startsWith("if ") && content.endsWith(":")) {
    return `${indent}如果 ${normalizeEnglishExpression(content.slice(3, -1).trim())}：`;
  }
  if (content.startsWith("failure:")) {
    return `${indent}失败：${content.slice("failure:".length).trim()}`;
  }
  if (content.startsWith("return ")) return `${indent}返回 ${content.slice("return ".length).trim()}`;
  if (/^[\p{L}_][\p{L}\p{N}_]*\s+as\s+[\p{L}_][\p{L}\p{N}_]*$/u.test(content)) {
    return `${indent}${content.replace(/\s+as\s+/u, " 作为 ")}`;
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
    ["对象成员必须缩进 4 个空格", "Object members must be indented by 4 spaces"],
    ["对象字段格式应为“名称：类型”", "Object field format must be 'name: type'"],
    ["对象字段名称必须是标识符", "Object field name must be an identifier"],
    ["身份字段必须是标识符", "Identity field must be an identifier"],
    ["流程名称必须是标识符", "Flow name must be an identifier"],
    ["流程成员必须缩进 4 个空格", "Flow members must be indented by 4 spaces"],
    ["无法识别的流程语句：", "Unknown flow statement: "],
    ["流程必须包含输出", "A flow must contain an output section"],
    ["创建必须先声明“名称：对象类型”", "Create must first declare 'name: object type'"],
    ["创建内容必须缩进 8 个空格", "Create content must be indented by 8 spaces"],
    ["创建必须包含字段赋值", "Create must assign object fields"],
    ["创建必须包含否则失败", "Create must declare an otherwise failure"],
    ["无法识别的创建内容：", "Unknown create content: "],
    ["查询必须先声明“名称：对象类型”", "Query must first declare 'name: object type'"],
    ["查询内容必须缩进 8 个空格", "Query content must be indented by 8 spaces"],
    ["MVP 查询必须且只能包含一个条件", "An MVP query must contain exactly one condition"],
    ["查询必须包含条件", "Query must contain a condition"],
    ["查询必须包含否则失败", "Query must declare an otherwise failure"],
    ["无法识别的查询内容：", "Unknown query content: "],
    ["MVP 删除必须且只能指定一个对象", "MVP delete must specify exactly one object"],
    ["否则必须包含缩进 ", "Otherwise must contain an indented "],
    ["创建格式应为“名称：对象类型”", "Create format must be 'name: object type'"],
    ["查询格式应为“名称：对象类型”", "Query format must be 'name: object type'"],
    ["HTTP 入口名称不能为空", "HTTP entry name cannot be empty"],
    ["HTTP 入口成员必须缩进 4 个空格", "HTTP entry members must be indented by 4 spaces"],
    ["接收格式应为“GET /path”", "Receive format must be 'GET /path'"],
    ["使用流程必须指定流程名称", "Use flow must specify a flow name"],
    ["HTTP 失败消息不能为空", "HTTP failure message cannot be empty"],
    ["无法识别的 HTTP 入口内容：", "Unknown HTTP entry content: "],
    ["HTTP 入口必须包含接收", "HTTP entry must contain receive"],
    ["HTTP 入口必须包含使用流程", "HTTP entry must contain use flow"],
    ["HTTP 入口必须包含成功状态", "HTTP entry must contain a success status"],
    ["HTTP 字段格式应为“字段”或“外部字段 as 输入字段”", "HTTP field format must be 'field' or 'external_field as input_field'"],
    ["HTTP 状态格式应为缩进 8 个空格的“return 200”", "HTTP status format must be an 8-space-indented 'return 200'"],
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
    ["的身份字段重复：", " has a duplicate identity field: "],
    ["的身份引用了未声明字段：", " identity references an undeclared field: "],
    ["的身份字段必须是整数、文本或布尔：", " identity field must be integer, text, or boolean: "],
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
    ["不能改变对象身份字段：", "Object identity fields cannot be changed: "],
    ["创建引用了未声明的对象：", "Create references an undeclared object: "],
    ["创建只能给 ", "Create can only assign fields on "],
    ["创建字段重复赋值：", "Duplicate create field assignment: "],
    ["创建字段 ", "Create field "],
    ["创建缺少字段：", "Create is missing field: "],
    ["查询引用了未声明的对象：", "Query references an undeclared object: "],
    ["查询条件必须是布尔条件", "Query condition must be Boolean"],
    ["删除必须指定当前流程中创建或查询到的对象", "Delete must target an object created or queried in the current flow"],
    ["删除必须指定一个对象", "Delete must target an object"],
    ["用于 CRUD 时必须声明身份", " must declare identity when used by CRUD"],
    ["HTTP 入口重复声明：", "Duplicate HTTP entry: "],
    ["HTTP 路由重复声明：", "Duplicate HTTP route: "],
    ["HTTP 成功状态必须是 2xx", "HTTP success status must be 2xx"],
    ["HTTP 失败状态必须是 4xx 或 5xx", "HTTP failure status must be 4xx or 5xx"],
    ["HTTP 入口引用了未声明的流程：", "HTTP entry references an undeclared flow: "],
    ["HTTP 输入重复映射：", "Duplicate HTTP input mapping: "],
    ["HTTP 映射引用了未声明的流程输入：", "HTTP mapping references an undeclared flow input: "],
    ["HTTP MVP 输入暂不支持类型：", "HTTP MVP does not support input type: "],
    ["HTTP 请求字段重复：", "Duplicate HTTP request field: "],
    ["HTTP 入口缺少流程输入映射：", "HTTP entry is missing a flow input mapping: "],
    ["请求路径缺少参数映射：", "Request path is missing a parameter mapping: "],
    ["请求路径映射未出现在路由中：", "Request path mapping does not appear in the route: "],
    ["HTTP 失败重复映射：", "Duplicate HTTP failure mapping: "],
    ["HTTP 映射了流程不会产生的失败：", "HTTP maps a failure the flow cannot produce: "],
    ["HTTP 入口缺少失败映射：", "HTTP entry is missing a failure mapping: "],
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
