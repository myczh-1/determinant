package compiler

import (
	"github.com/myczh-1/determinant/internal/ast"
	"github.com/myczh-1/determinant/internal/binding"
	"github.com/myczh-1/determinant/internal/diagnostics"
	"github.com/myczh-1/determinant/internal/language"
	"github.com/myczh-1/determinant/internal/model"
	"github.com/myczh-1/determinant/internal/parser"
	"github.com/myczh-1/determinant/internal/semantic"
)

type Result struct {
	Program     *ast.Program
	TypeInfo    *semantic.TypeInfo
	Binding     *binding.Resolved
	Model       model.Program
	Diagnostics []diagnostics.Diagnostic
}

func Compile(source string, lang language.Language, file string) Result {
	parsed := parser.Parse(source, lang, file)
	result := Result{Program: parsed.Program, Diagnostics: append([]diagnostics.Diagnostic(nil), parsed.Diagnostics...)}
	if parsed.Program == nil || hasErrors(result.Diagnostics) {
		return result
	}
	typeInfo, semanticDiagnostics := semantic.Check(parsed.Program)
	result.TypeInfo = typeInfo
	result.Diagnostics = append(result.Diagnostics, semanticDiagnostics...)
	if !hasErrors(result.Diagnostics) {
		result.Model = model.FromAST(parsed.Program, typeInfo)
	}
	return result
}

func hasErrors(items []diagnostics.Diagnostic) bool {
	for _, item := range items {
		if item.Severity == diagnostics.Error {
			return true
		}
	}
	return false
}
