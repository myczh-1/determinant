package backend

import (
	"github.com/myczh-1/determinant/internal/ast"
	"github.com/myczh-1/determinant/internal/semantic"
)

type Backend interface {
	Target() string
	Generate(program *ast.Program, typeInfo *semantic.TypeInfo) (string, error)
}
