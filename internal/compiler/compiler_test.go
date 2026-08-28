package compiler

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/myczh-1/determinant/internal/language"
)

func TestCompileBuildsCanonicalModel(t *testing.T) {
	root := filepath.Join("..", "..")
	source, err := os.ReadFile(filepath.Join(root, "examples", "items", "app.aal"))
	if err != nil {
		t.Fatal(err)
	}
	result := Compile(string(source), language.English, "examples/items/app.aal")
	if len(result.Diagnostics) != 0 {
		t.Fatalf("unexpected diagnostics: %#v", result.Diagnostics)
	}
	if result.TypeInfo == nil || result.Model.Name != "ItemService" || len(result.Model.Routes) != 4 {
		t.Fatalf("unexpected compile result: %#v", result)
	}
}
