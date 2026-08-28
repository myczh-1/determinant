package binding

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/myczh-1/determinant/internal/language"
	"github.com/myczh-1/determinant/internal/parser"
)

func TestResolveExampleBinding(t *testing.T) {
	root := filepath.Join("..", "..")
	source, err := os.ReadFile(filepath.Join(root, "examples", "order", "app.aal"))
	if err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(root, "examples", "order", "binding.json"))
	if err != nil {
		t.Fatal(err)
	}
	parsed := parser.Parse(string(source), language.English, "examples/order/app.aal")
	if len(parsed.Diagnostics) != 0 {
		t.Fatalf("parse diagnostics: %#v", parsed.Diagnostics)
	}
	spec, diagnostics := Parse(data, "examples/order/binding.json")
	if len(diagnostics) != 0 {
		t.Fatalf("binding diagnostics: %#v", diagnostics)
	}
	resolved, diagnostics := Resolve(parsed.Program, &spec)
	if len(diagnostics) != 0 {
		t.Fatalf("resolve diagnostics: %#v", diagnostics)
	}
	if resolved.Objects["Order"].Fields["number"].ProgramName != "id" || resolved.Flows["CreateOrder"].ProgramName != "createOrder" {
		t.Fatalf("unexpected resolved binding: %#v", resolved)
	}
}
