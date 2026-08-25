export interface SourceLocation {
  readonly line: number;
  readonly column: number;
}

export type TypeRef = IntegerType | TextType | BooleanType | MoneyType | ObjectType | RecordType | UnknownType;

export interface IntegerType { readonly kind: "integer"; }
export interface TextType { readonly kind: "text"; }
export interface BooleanType { readonly kind: "boolean"; }

export interface MoneyType {
  readonly kind: "money";
  readonly currency: string;
  readonly unit: string;
  readonly scale: number;
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

export type Expression = IntegerLiteral | ReferenceExpression | MemberExpression | BinaryExpression;

export interface IntegerLiteral {
  readonly kind: "integer-literal";
  readonly value: number;
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

export interface BinaryExpression {
  readonly kind: "binary";
  readonly operator: "+" | "-" | "*" | "/" | "%" | ">" | ">=" | "<" | "<=" | "==" | "!=";
  readonly left: Expression;
  readonly right: Expression;
  readonly loc: SourceLocation;
}

export interface Program {
  readonly kind: "program";
  readonly name: string;
  readonly objects: readonly ObjectDeclaration[];
  readonly flows: readonly FlowDeclaration[];
  readonly loc: SourceLocation;
}

export interface ObjectDeclaration {
  readonly kind: "object";
  readonly name: string;
  readonly fields: readonly TypeField[];
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

export type Statement = IfStatement | CalculateStatement | ChangeStatement | ExecuteStatement;

export interface IfStatement {
  readonly kind: "if";
  readonly condition: Expression;
  readonly failureMessage: string;
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
export const UNKNOWN: UnknownType = Object.freeze({ kind: "unknown" });
