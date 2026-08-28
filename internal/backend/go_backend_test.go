package backend

import (
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/myczh-1/determinant/internal/language"
	"github.com/myczh-1/determinant/internal/parser"
	"github.com/myczh-1/determinant/internal/semantic"
)

func TestGoBackendGeneratesCompilableItemsProgram(t *testing.T) {
	root := filepath.Join("..", "..")
	source, err := os.ReadFile(filepath.Join(root, "examples", "items", "app.aal"))
	if err != nil {
		t.Fatal(err)
	}
	parsed := parser.Parse(string(source), language.English, "examples/items/app.aal")
	if len(parsed.Diagnostics) != 0 {
		t.Fatalf("parse diagnostics: %#v", parsed.Diagnostics)
	}
	typeInfo, diagnostics := semantic.Check(parsed.Program)
	if len(diagnostics) != 0 {
		t.Fatalf("semantic diagnostics: %#v", diagnostics)
	}
	generated, err := (GoBackend{}).Generate(parsed.Program, typeInfo)
	if err != nil {
		t.Fatal(err)
	}
	directory := t.TempDir()
	path := filepath.Join(directory, "main.go")
	if err := os.WriteFile(path, []byte(generated), 0o600); err != nil {
		t.Fatal(err)
	}
	command := exec.Command("go", "test", path)
	command.Dir = directory
	command.Env = append(os.Environ(), "GO111MODULE=off")
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("generated Go did not compile: %v\n%s", err, output)
	}
}

func TestGoBackendGeneratesAllMigrationExamples(t *testing.T) {
	root := filepath.Join("..", "..")
	cases := []struct {
		name string
		path string
		lang language.Language
	}{
		{name: "items chinese", path: "examples/items/app.zh-CN.aal", lang: language.Chinese},
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
			typeInfo, diagnostics := semantic.Check(parsed.Program)
			if len(diagnostics) != 0 {
				t.Fatalf("semantic diagnostics: %#v", diagnostics)
			}
			first, err := (GoBackend{}).Generate(parsed.Program, typeInfo)
			if err != nil {
				t.Fatal(err)
			}
			second, err := (GoBackend{}).Generate(parsed.Program, typeInfo)
			if err != nil {
				t.Fatal(err)
			}
			if first != second {
				t.Fatal("repeated generation is not deterministic")
			}
			directory := t.TempDir()
			path := filepath.Join(directory, "main.go")
			if err := os.WriteFile(path, []byte(first), 0o600); err != nil {
				t.Fatal(err)
			}
			command := exec.Command("go", "test", path)
			command.Dir = directory
			command.Env = append(os.Environ(), "GO111MODULE=off")
			output, err := command.CombinedOutput()
			if err != nil {
				t.Fatalf("generated Go did not compile: %v\n%s", err, output)
			}
		})
	}
}

func TestGeneratedGoProgramServesItemsHTTP(t *testing.T) {
	root := filepath.Join("..", "..")
	source, err := os.ReadFile(filepath.Join(root, "examples", "items", "app.aal"))
	if err != nil {
		t.Fatal(err)
	}
	parsed := parser.Parse(string(source), language.English, "examples/items/app.aal")
	if len(parsed.Diagnostics) != 0 {
		t.Fatalf("parse diagnostics: %#v", parsed.Diagnostics)
	}
	typeInfo, diagnostics := semantic.Check(parsed.Program)
	if len(diagnostics) != 0 {
		t.Fatalf("semantic diagnostics: %#v", diagnostics)
	}
	generated, err := (GoBackend{}).Generate(parsed.Program, typeInfo)
	if err != nil {
		t.Fatal(err)
	}
	directory := t.TempDir()
	path := filepath.Join(directory, "main.go")
	if err := os.WriteFile(path, []byte(generated), 0o600); err != nil {
		t.Fatal(err)
	}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := listener.Addr().(*net.TCPAddr).Port
	_ = listener.Close()
	binary := filepath.Join(directory, "items-server")
	build := exec.Command("go", "build", "-o", binary, path)
	build.Dir = directory
	build.Env = append(os.Environ(), "GO111MODULE=off")
	if output, err := build.CombinedOutput(); err != nil {
		t.Fatalf("generated Go did not build: %v\n%s", err, output)
	}
	command := exec.Command(binary)
	command.Dir = directory
	command.Env = append(os.Environ(), "GO111MODULE=off", fmt.Sprintf("PORT=%d", port))
	command.Stdout = io.Discard
	command.Stderr = io.Discard
	if err := command.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() {
		_ = command.Process.Kill()
		_ = command.Wait()
	}()

	baseURL := fmt.Sprintf("http://127.0.0.1:%d", port)
	client := &http.Client{}
	var response *http.Response
	for attempt := 0; attempt < 100; attempt++ {
		response, err = client.Get(baseURL + "/items/1")
		if err == nil {
			_ = response.Body.Close()
			break
		}
		time.Sleep(50 * time.Millisecond)
	}
	if err != nil {
		t.Fatalf("generated server did not start: %v", err)
	}

	response = requestJSON(t, client, http.MethodPost, baseURL+"/items", `{"id":1,"name":"first"}`)
	assertStatus(t, response, http.StatusCreated)
	var created map[string]map[string]any
	decodeJSON(t, response, &created)
	if created["item"]["name"] != "first" {
		t.Fatalf("unexpected create response: %#v", created)
	}

	response = requestJSON(t, client, http.MethodGet, baseURL+"/items/1", "")
	assertStatus(t, response, http.StatusOK)
	var read map[string]map[string]any
	decodeJSON(t, response, &read)
	if read["item"]["name"] != "first" {
		t.Fatalf("unexpected read response: %#v", read)
	}

	response = requestJSON(t, client, http.MethodPut, baseURL+"/items/1", `{"name":"updated"}`)
	assertStatus(t, response, http.StatusOK)
	_ = response.Body.Close()
	response = requestJSON(t, client, http.MethodDelete, baseURL+"/items/1", "")
	assertStatus(t, response, http.StatusNoContent)
	_ = response.Body.Close()
	response = requestJSON(t, client, http.MethodGet, baseURL+"/items/1", "")
	assertStatus(t, response, http.StatusNotFound)
	_ = response.Body.Close()
}

func TestTypeScriptBackendGeneratesAllMigrationExamples(t *testing.T) {
	root := filepath.Join("..", "..")
	cases := []struct {
		name string
		path string
		lang language.Language
	}{
		{name: "items english", path: "examples/items/app.aal", lang: language.English},
		{name: "items chinese", path: "examples/items/app.zh-CN.aal", lang: language.Chinese},
		{name: "order english", path: "examples/order/app.aal", lang: language.English},
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
			typeInfo, diagnostics := semantic.Check(parsed.Program)
			if len(diagnostics) != 0 {
				t.Fatalf("semantic diagnostics: %#v", diagnostics)
			}
			generated, err := (TypeScriptBackend{}).Generate(parsed.Program, typeInfo)
			if err != nil {
				t.Fatal(err)
			}
			directory := t.TempDir()
			path := filepath.Join(directory, "generated.ts")
			if err := os.WriteFile(path, []byte(generated), 0o600); err != nil {
				t.Fatal(err)
			}
			command := exec.Command("npx", "tsc", "--noEmit", "--target", "ES2022", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--skipLibCheck", path)
			command.Dir = root
			output, err := command.CombinedOutput()
			if err != nil {
				t.Fatalf("generated TypeScript did not compile: %v\n%s", err, output)
			}
		})
	}
}

func TestGeneratedTypeScriptHandlesItemsHTTP(t *testing.T) {
	root := filepath.Join("..", "..")
	source, err := os.ReadFile(filepath.Join(root, "examples", "items", "app.aal"))
	if err != nil {
		t.Fatal(err)
	}
	parsed := parser.Parse(string(source), language.English, "examples/items/app.aal")
	if len(parsed.Diagnostics) != 0 {
		t.Fatalf("parse diagnostics: %#v", parsed.Diagnostics)
	}
	typeInfo, diagnostics := semantic.Check(parsed.Program)
	if len(diagnostics) != 0 {
		t.Fatalf("semantic diagnostics: %#v", diagnostics)
	}
	generated, err := (TypeScriptBackend{}).Generate(parsed.Program, typeInfo)
	if err != nil {
		t.Fatal(err)
	}
	directory := t.TempDir()
	if err := os.WriteFile(filepath.Join(directory, "generated.ts"), []byte(generated), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(directory, "package.json"), []byte(`{"type":"module"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	compile := exec.Command("npx", "tsc", "--target", "ES2022", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--skipLibCheck", "--outDir", directory, filepath.Join(directory, "generated.ts"))
	compile.Dir = root
	if output, err := compile.CombinedOutput(); err != nil {
		t.Fatalf("generated TypeScript did not compile: %v\n%s", err, output)
	}
	script := `import { handleHttpRequest } from "./generated.js";
const created = handleHttpRequest({ method: "POST", path: "/items", body: { id: 1, name: "first" } });
if (created.status !== 201 || created.body.item.id !== 1 || created.body.item.name !== "first") process.exit(1);
const read = handleHttpRequest({ method: "GET", path: "/items/1" });
if (read.status !== 200 || read.body.item.name !== "first") process.exit(2);
const deleted = handleHttpRequest({ method: "DELETE", path: "/items/1" });
if (deleted.status !== 204) process.exit(3);
const missing = handleHttpRequest({ method: "GET", path: "/items/1" });
if (missing.status !== 404) process.exit(4);
`
	if err := os.WriteFile(filepath.Join(directory, "test.mjs"), []byte(script), 0o600); err != nil {
		t.Fatal(err)
	}
	run := exec.Command("node", filepath.Join(directory, "test.mjs"))
	run.Dir = directory
	if output, err := run.CombinedOutput(); err != nil {
		t.Fatalf("generated TypeScript HTTP behavior failed: %v\n%s", err, output)
	}
}

func requestJSON(t *testing.T, client *http.Client, method, url, body string) *http.Response {
	t.Helper()
	request, err := http.NewRequest(method, url, strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	if body != "" {
		request.Header.Set("Content-Type", "application/json")
	}
	response, err := client.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	return response
}

func assertStatus(t *testing.T, response *http.Response, expected int) {
	t.Helper()
	if response.StatusCode != expected {
		t.Fatalf("expected HTTP %d, got %d", expected, response.StatusCode)
	}
}

func decodeJSON(t *testing.T, response *http.Response, target any) {
	t.Helper()
	defer response.Body.Close()
	if err := json.NewDecoder(response.Body).Decode(target); err != nil {
		t.Fatal(err)
	}
}
