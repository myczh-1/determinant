import type { SourceLocation } from "./ast.js";

export type DiagnosticSeverity = "error" | "warning";

export interface Diagnostic {
  readonly severity: DiagnosticSeverity;
  readonly message: string;
  readonly loc: SourceLocation;
}

export function error(message: string, loc: SourceLocation): Diagnostic {
  return { severity: "error", message, loc };
}

export function formatDiagnostic(diagnostic: Diagnostic): string {
  return `${diagnostic.severity.toUpperCase()} ${diagnostic.loc.line}:${diagnostic.loc.column} ${diagnostic.message}`;
}
