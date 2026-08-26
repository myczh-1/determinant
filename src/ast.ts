export interface SourceLocation {
  readonly line: number;
  readonly column: number;
}

export type TypeRef = IntegerType | TextType | BooleanType | MoneyType | TimeType | DurationType | ValueType | NamedType | ObjectType | RecordType | UnknownType;

export interface IntegerType { readonly kind: "integer"; }
export interface TextType { readonly kind: "text"; }
export interface BooleanType { readonly kind: "boolean"; }

export interface MoneyType {
  readonly kind: "money";
  readonly currency: string;
  readonly unit: string;
  readonly scale: number;
}

export interface TimeType { readonly kind: "time"; }
export interface DurationType { readonly kind: "duration"; }

export interface ValueType {
  readonly kind: "value";
  readonly name: string;
  readonly values: readonly string[];
}

export interface NamedType {
  readonly kind: "named";
  readonly name: string;
}

export interface ObjectType {
  readonly kind: "object";
  readonly name: string;
  readonly fields: readonly TypeField[];
}

export interface RecordType {
  readonly kind: "record";
  readonly name: string;
  readonly fields: readonly TypeField[];
}

export interface UnknownType { readonly kind: "unknown"; }

export interface TypeField {
  readonly name: string;
  readonly type: TypeRef;
  readonly loc?: SourceLocation;
}

export type Expression = IntegerLiteral | MoneyLiteral | DurationLiteral | ReferenceExpression | MemberExpression | UnaryExpression | BinaryExpression;

export interface IntegerLiteral {
  readonly kind: "integer-literal";
  readonly value: number;
  readonly loc: SourceLocation;
}

export interface MoneyLiteral {
  readonly kind: "money-literal";
  readonly value: string;
  readonly currency: string;
  readonly unit: string;
  readonly scale: number;
  readonly loc: SourceLocation;
}

export interface DurationLiteral {
  readonly kind: "duration-literal";
  readonly milliseconds: number;
  readonly loc: SourceLocation;
}

export interface ReferenceExpression {
  readonly kind: "reference";
  readonly name: string;
  readonly loc: SourceLocation;
}

export interface MemberExpression {
  readonly kind: "member";
  readonly object: Expression;
  readonly property: string;
  readonly loc: SourceLocation;
}

export interface UnaryExpression {
  readonly kind: "unary";
  readonly operator: "not";
  readonly expression: Expression;
  readonly loc: SourceLocation;
}

export interface BinaryExpression {
  readonly kind: "binary";
  readonly operator: "+" | "-" | "*" | "/" | "%" | ">" | ">=" | "<" | "<=" | "==" | "!=" | "and" | "or";
  readonly left: Expression;
  readonly right: Expression;
  readonly loc: SourceLocation;
}

export interface Program {
  readonly kind: "program";
  readonly name: string;
  readonly valueSets: readonly ValueSetDeclaration[];
  readonly objects: readonly ObjectDeclaration[];
  readonly flows: readonly FlowDeclaration[];
  readonly httpEntries: readonly HttpEntryDeclaration[];
  readonly loc: SourceLocation;
}

export interface ValueSetDeclaration {
  readonly kind: "value-set";
  readonly name: string;
  readonly values: readonly ValueMember[];
  readonly loc: SourceLocation;
}

export interface ValueMember {
  readonly name: string;
  readonly loc: SourceLocation;
}

export interface ObjectDeclaration {
  readonly kind: "object";
  readonly name: string;
  readonly fields: readonly TypeField[];
  readonly identityFields: readonly string[];
  readonly loc: SourceLocation;
}

export interface FlowDeclaration {
  readonly kind: "flow";
  readonly name: string;
  readonly inputs: readonly FlowInput[];
  readonly statements: readonly Statement[];
  readonly outputs: readonly OutputField[];
  readonly loc: SourceLocation;
}

export interface FlowInput {
  readonly kind: "flow-input";
  readonly name: string;
  readonly type: TypeRef;
  readonly loc: SourceLocation;
}

export type Statement = IfStatement | ConditionalStatement | AtomicStatement | CalculateStatement | ChangeStatement | ExecuteStatement | CreateStatement | QueryStatement | DeleteStatement;

export interface IfStatement {
  readonly kind: "if";
  readonly condition: Expression;
  readonly failureMessage: string;
  readonly loc: SourceLocation;
}

export interface ConditionalStatement {
  readonly kind: "conditional";
  readonly condition: Expression;
  readonly statements: readonly Statement[];
  readonly loc: SourceLocation;
}

export interface AtomicStatement {
  readonly kind: "atomic";
  readonly statements: readonly Statement[];
  readonly loc: SourceLocation;
}

export interface CalculateStatement {
  readonly kind: "calculate";
  readonly name: string;
  readonly expression: Expression;
  readonly loc: SourceLocation;
}

export interface ChangeStatement {
  readonly kind: "change";
  readonly target: Expression;
  readonly expression: Expression;
  readonly loc: SourceLocation;
}

export interface ExecuteStatement {
  readonly kind: "execute";
  readonly flowName: string;
  readonly inputs: readonly Expression[];
  readonly outputs: readonly string[];
  readonly loc: SourceLocation;
}

export interface CreateStatement {
  readonly kind: "create";
  readonly name: string;
  readonly objectName: string;
  readonly assignments: readonly ObjectAssignment[];
  readonly failureMessage: string;
  readonly loc: SourceLocation;
}

export interface QueryStatement {
  readonly kind: "query";
  readonly name: string;
  readonly objectName: string;
  readonly condition: Expression;
  readonly failureMessage: string;
  readonly loc: SourceLocation;
}

export interface DeleteStatement {
  readonly kind: "delete";
  readonly expression: Expression;
  readonly loc: SourceLocation;
}

export interface ObjectAssignment {
  readonly target: Expression;
  readonly expression: Expression;
  readonly loc: SourceLocation;
}

export interface HttpFieldMapping {
  readonly sourceName: string;
  readonly targetName: string;
  readonly loc: SourceLocation;
}

export interface HttpSystemMapping {
  readonly source: "current-time";
  readonly targetName: string;
  readonly loc: SourceLocation;
}

export interface HttpFailureMapping {
  readonly failureMessage: string;
  readonly status: number;
  readonly loc: SourceLocation;
}

export interface HttpEntryDeclaration {
  readonly kind: "http-entry";
  readonly name: string;
  readonly method: "GET" | "POST" | "PUT" | "DELETE";
  readonly path: string;
  readonly targetFlow: string;
  readonly bodyMappings: readonly HttpFieldMapping[];
  readonly pathMappings: readonly HttpFieldMapping[];
  readonly systemMappings: readonly HttpSystemMapping[];
  readonly successStatus: number;
  readonly failureMappings: readonly HttpFailureMapping[];
  readonly loc: SourceLocation;
}

export interface OutputField {
  readonly kind: "output-field";
  readonly name: string;
  readonly expression: Expression;
  readonly loc: SourceLocation;
}

export interface FlowSignature {
  readonly name: string;
  readonly inputs: readonly FlowInput[];
  readonly output: RecordType;
}

export const INTEGER: IntegerType = Object.freeze({ kind: "integer" });
export const TEXT: TextType = Object.freeze({ kind: "text" });
export const BOOLEAN: BooleanType = Object.freeze({ kind: "boolean" });
export const TIME: TimeType = Object.freeze({ kind: "time" });
export const DURATION: DurationType = Object.freeze({ kind: "duration" });
export const UNKNOWN: UnknownType = Object.freeze({ kind: "unknown" });
