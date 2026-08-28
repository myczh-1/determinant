package main

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestCheckCommandSupportsMachineReadableOutput(t *testing.T) {
	var output, errors bytes.Buffer
	code := execute([]string{"check", "--json", "../../examples/items/app.aal"}, &output, &errors)
	if code != 0 || errors.Len() != 0 {
		t.Fatalf("unexpected command result: code=%d output=%q errors=%q", code, output.String(), errors.String())
	}
	var payload struct {
		Status  string `json:"status"`
		Success bool   `json:"success"`
	}
	if err := json.Unmarshal(output.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload.Status != "ok" || !payload.Success {
		t.Fatalf("unexpected payload: %#v", payload)
	}
}

func TestCheckCommandReportsErrors(t *testing.T) {
	var output, errors bytes.Buffer
	code := execute([]string{"check", "--json", "examples/order/app.aal", "--language", "xx"}, &output, &errors)
	if code == 0 || errors.Len() != 0 {
		t.Fatalf("unexpected command result: code=%d output=%q errors=%q", code, output.String(), errors.String())
	}
	if !bytes.Contains(output.Bytes(), []byte(`"status":"error"`)) {
		t.Fatalf("missing machine-readable error: %s", output.String())
	}
}

func TestBuildCommandWritesGoAndTypeScriptTargets(t *testing.T) {
	for _, target := range []string{"go", "typescript"} {
		t.Run(target, func(t *testing.T) {
			outputPath := filepath.Join(t.TempDir(), "generated."+target)
			var output, errors bytes.Buffer
			code := execute([]string{"build", "../../examples/items/app.aal", "--target", target, "--out", outputPath}, &output, &errors)
			if code != 0 || errors.Len() != 0 {
				t.Fatalf("unexpected command result: code=%d output=%q errors=%q", code, output.String(), errors.String())
			}
			generated, err := os.ReadFile(outputPath)
			if err != nil {
				t.Fatal(err)
			}
			if len(generated) == 0 {
				t.Fatal("generated target is empty")
			}
		})
	}
}
