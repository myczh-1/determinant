package model

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"

	"github.com/myczh-1/determinant/internal/language"
	"github.com/myczh-1/determinant/internal/parser"
	"github.com/myczh-1/determinant/internal/semantic"
)

func TestFromASTProducesCanonicalModel(t *testing.T) {
	root := filepath.Join("..", "..")
	source, err := os.ReadFile(filepath.Join(root, "examples", "order", "app.aal"))
	if err != nil {
		t.Fatal(err)
	}
	parsed := parser.Parse(string(source), language.English, "examples/order/app.aal")
	if len(parsed.Diagnostics) != 0 {
		t.Fatalf("parse diagnostics: %#v", parsed.Diagnostics)
	}
	typeInfo, diagnostics := semantic.Check(parsed.Program)
	if len(diagnostics) != 0 {
		t.Fatalf("semantic diagnostics: %#v", diagnostics)
	}
	first := FromAST(parsed.Program, typeInfo)
	second := FromAST(parsed.Program, typeInfo)
	if first.Name != "OrderInventory" || len(first.Entities) != 2 || len(first.Flows) != 3 {
		t.Fatalf("unexpected model shape: %#v", first)
	}
	if got := first.Flows[2].Outputs[1].Type; got != "money(CNY,yuan,2)" {
		t.Fatalf("unexpected inferred output type: %s", got)
	}
	if len(first.Flows[1].StateWrites) != 1 || first.Flows[1].StateWrites[0].Entity != "Inventory" {
		t.Fatalf("unexpected state writes: %#v", first.Flows[1].StateWrites)
	}
	left, err := MarshalCanonical(first)
	if err != nil {
		t.Fatal(err)
	}
	right, err := MarshalCanonical(second)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(left, right) {
		t.Fatalf("canonical model changed between builds:\n%s\n%s", left, right)
	}
}
