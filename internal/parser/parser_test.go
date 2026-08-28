package parser

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/myczh-1/determinant/internal/language"
)

func TestExistingAALExamplesParse(t *testing.T) {
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
			result := Parse(string(source), tc.lang, tc.path)
			if len(result.Diagnostics) != 0 {
				t.Fatalf("unexpected diagnostics: %#v", result.Diagnostics)
			}
			if result.Program == nil || result.Program.Name == "" || len(result.Program.Objects) == 0 || len(result.Program.Flows) == 0 {
				t.Fatalf("incomplete program: %#v", result.Program)
			}
		})
	}
}

func TestParserPreservesCoreShape(t *testing.T) {
	source := "应用：库存\n\n对象：库存\n    数量：整数\n\n流程：扣减\n    输入：\n        库存：库存\n        数量：整数\n    如果 数量 <= 0：\n        失败：数量必须大于零\n    改变：\n        库存 的 数量 = 库存 的 数量 - 数量\n    输出：\n        剩余 = 库存 的 数量\n"
	result := Parse(source, language.Chinese, "memory.aal")
	if len(result.Diagnostics) != 0 {
		t.Fatalf("unexpected diagnostics: %#v", result.Diagnostics)
	}
	flow := result.Program.Flows[0]
	if len(flow.Inputs) != 2 || len(flow.Statements) != 2 || flow.Statements[0].Kind != "if" || flow.Statements[1].Kind != "change" || len(flow.Outputs) != 1 {
		t.Fatalf("unexpected flow shape: %#v", flow)
	}
	if flow.Statements[1].Target.Kind != "member" || flow.Statements[1].Target.Property != "数量" {
		t.Fatalf("unexpected change target: %#v", flow.Statements[1].Target)
	}
}

func TestParserReportsSourceLocation(t *testing.T) {
	source := "应用：库存\n\n对象：库存\n    数量：\n\n流程：查看\n    输出：\n        数量 = 1\n"
	result := Parse(source, language.Chinese, "invalid.aal")
	if len(result.Diagnostics) == 0 {
		t.Fatal("expected a diagnostic")
	}
	if result.Diagnostics[0].File != "invalid.aal" || result.Diagnostics[0].Line != 4 || result.Diagnostics[0].Column != 1 {
		t.Fatalf("unexpected location: %#v", result.Diagnostics[0])
	}
}
