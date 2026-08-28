package compiler

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
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

func TestProgramModelCoversSemanticSurfaceAndLocalPerturbation(t *testing.T) {
	root := filepath.Join("..", "..")
	refundPath := filepath.Join(root, "examples", "order-refund", "app.composed-flow.zh-CN.aal")
	refundSource, err := os.ReadFile(refundPath)
	if err != nil {
		t.Fatal(err)
	}
	refund := Compile(string(refundSource), language.Chinese, "examples/order-refund/app.composed-flow.zh-CN.aal")
	if len(refund.Diagnostics) != 0 {
		t.Fatalf("unexpected refund diagnostics: %#v", refund.Diagnostics)
	}
	if refund.Model.Name == "" || len(refund.Model.Types) < 2 || len(refund.Model.Entities) < 4 || len(refund.Model.Flows) < 5 || len(refund.Model.Routes) < 4 || len(refund.Model.Constraints) == 0 {
		t.Fatalf("ProgramModel does not cover the expected semantic surface: %#v", refund.Model)
	}
	if len(refund.Model.Operations) != len(refund.Model.Flows) {
		t.Fatalf("expected one operation projection per flow: %#v", refund.Model.Operations)
	}
	var hasCall, hasStateWrite bool
	for _, flow := range refund.Model.Flows {
		hasCall = hasCall || len(flow.Calls) > 0
		hasStateWrite = hasStateWrite || len(flow.StateWrites) > 0
	}
	if !hasCall || !hasStateWrite {
		t.Fatalf("ProgramModel lost flow calls or state writes: %#v", refund.Model.Flows)
	}

	orderPath := filepath.Join(root, "examples", "order", "app.aal")
	orderSource, err := os.ReadFile(orderPath)
	if err != nil {
		t.Fatal(err)
	}
	baseline := Compile(string(orderSource), language.English, "examples/order/app.aal")
	if len(baseline.Diagnostics) != 0 {
		t.Fatalf("unexpected baseline diagnostics: %#v", baseline.Diagnostics)
	}
	perturbedSource := strings.Replace(string(orderSource), "    number: integer", "    number: text", 1)
	if perturbedSource == string(orderSource) {
		t.Fatal("test perturbation did not change the source")
	}
	perturbed := Compile(perturbedSource, language.English, "examples/order/app.aal")
	if len(perturbed.Diagnostics) != 0 {
		t.Fatalf("unexpected perturbed diagnostics: %#v", perturbed.Diagnostics)
	}
	if len(perturbed.Model.Entities) != len(baseline.Model.Entities) || len(perturbed.Model.Flows) != len(baseline.Model.Flows) || len(perturbed.Model.Routes) != len(baseline.Model.Routes) || len(perturbed.Model.Constraints) != len(baseline.Model.Constraints) {
		t.Fatalf("one field change caused unrelated ProgramModel shape changes: baseline=%#v perturbed=%#v", baseline.Model, perturbed.Model)
	}
	if baseline.Model.Entities[0].Fields[0].Type != "integer" || perturbed.Model.Entities[0].Fields[0].Type != "text" {
		t.Fatalf("ProgramModel did not record the local type change: baseline=%#v perturbed=%#v", baseline.Model.Entities[0], perturbed.Model.Entities[0])
	}
	left, err := model.MarshalCanonical(baseline.Model)
	if err != nil {
		t.Fatal(err)
	}
	right, err := model.MarshalCanonical(perturbed.Model)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Equal(left, right) {
		t.Fatal("ProgramModel digest did not change after a semantic field change")
	}
}
