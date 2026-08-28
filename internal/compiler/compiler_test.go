package compiler

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"

	"github.com/myczh-1/determinant/internal/language"
	"github.com/myczh-1/determinant/internal/model"
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

func TestCompileAcceptsAllFrozenValidInputs(t *testing.T) {
	root := filepath.Join("..", "..")
	cases := []struct {
		name string
		path string
		lang language.Language
	}{
		{name: "items english", path: "examples/items/app.aal", lang: language.English},
		{name: "items chinese", path: "examples/items/app.zh-CN.aal", lang: language.Chinese},
		{name: "order english", path: "examples/order/app.aal", lang: language.English},
		{name: "order chinese", path: "examples/order/app.zh-CN.aal", lang: language.Chinese},
		{name: "refund stable", path: "examples/order-refund/app.zh-CN.aal", lang: language.Chinese},
		{name: "refund composed", path: "examples/order-refund/app.composed-flow.zh-CN.aal", lang: language.Chinese},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			source, err := os.ReadFile(filepath.Join(root, tc.path))
			if err != nil {
				t.Fatal(err)
			}
			first := Compile(string(source), tc.lang, tc.path)
			if len(first.Diagnostics) != 0 {
				t.Fatalf("unexpected diagnostics: %#v", first.Diagnostics)
			}
			second := Compile(string(source), tc.lang, tc.path)
			left, err := model.MarshalCanonical(first.Model)
			if err != nil {
				t.Fatal(err)
			}
			right, err := model.MarshalCanonical(second.Model)
			if err != nil {
				t.Fatal(err)
			}
			if !bytes.Equal(left, right) {
				t.Fatalf("canonical model is not deterministic:\n%s\n%s", left, right)
			}
		})
	}
}
