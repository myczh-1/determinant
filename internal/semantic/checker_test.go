package semantic

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/myczh-1/determinant/internal/language"
	"github.com/myczh-1/determinant/internal/parser"
)

func TestExistingAALExamplesPassSemanticCheck(t *testing.T) {
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
			parsed := parser.Parse(string(source), tc.lang, tc.path)
			if len(parsed.Diagnostics) != 0 {
				t.Fatalf("parse diagnostics: %#v", parsed.Diagnostics)
			}
			_, diagnostics := Check(parsed.Program)
			if len(diagnostics) != 0 {
				t.Fatalf("semantic diagnostics: %#v", diagnostics)
			}
		})
	}
}

func TestSemanticCheckReportsInvalidIdentity(t *testing.T) {
	source := "应用：库存\n\n对象：库存\n    名称：文本\n\n    身份：\n        不存在\n\n流程：查看\n    输出：\n        结果 = 1\n"
	parsed := parser.Parse(source, language.Chinese, "invalid.aal")
	if len(parsed.Diagnostics) != 0 {
		t.Fatalf("unexpected parse diagnostics: %#v", parsed.Diagnostics)
	}
	_, diagnostics := Check(parsed.Program)
	if len(diagnostics) == 0 {
		t.Fatal("expected semantic diagnostic")
	}
	if diagnostics[0].Code != "AAL2007" || diagnostics[0].Line != 3 {
		t.Fatalf("unexpected diagnostic: %#v", diagnostics[0])
	}
}

func TestSemanticCheckReportsTypeMismatch(t *testing.T) {
	source := "应用：库存\n\n对象：库存\n    编号：整数\n\n流程：计算\n    输入：\n        数量：整数\n    计算：\n        结果 = 数量 + 1.00 元\n    输出：\n        结果\n"
	parsed := parser.Parse(source, language.Chinese, "invalid.aal")
	if len(parsed.Diagnostics) != 0 {
		t.Fatalf("unexpected parse diagnostics: %#v", parsed.Diagnostics)
	}
	_, diagnostics := Check(parsed.Program)
	if len(diagnostics) == 0 {
		t.Fatal("expected semantic diagnostic")
	}
	if diagnostics[0].Code != "AAL2106" {
		t.Fatalf("unexpected diagnostic: %#v", diagnostics[0])
	}
}
