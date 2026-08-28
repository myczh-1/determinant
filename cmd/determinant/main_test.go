package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
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

func TestCheckJSONIncludesSemanticDiagnosticLocation(t *testing.T) {
	root := filepath.Join("..", "..")
	source, err := os.ReadFile(filepath.Join(root, "examples", "order", "app.aal"))
	if err != nil {
		t.Fatal(err)
	}
	invalid := bytes.Replace(source, []byte("unitPrice * quantity"), []byte("unitPrice * missingQuantity"), 1)
	path := filepath.Join(t.TempDir(), "invalid.aal")
	if err := os.WriteFile(path, invalid, 0o600); err != nil {
		t.Fatal(err)
	}

	var output, errors bytes.Buffer
	code := execute([]string{"check", "--json", path}, &output, &errors)
	if code == 0 || errors.Len() != 0 {
		t.Fatalf("unexpected command result: code=%d output=%q errors=%q", code, output.String(), errors.String())
	}
	var payload struct {
		Success     bool   `json:"success"`
		Status      string `json:"status"`
		Diagnostics []struct {
			Code   string `json:"code"`
			File   string `json:"file"`
			Line   int    `json:"line"`
			Column int    `json:"column"`
		} `json:"diagnostics"`
	}
	if err := json.Unmarshal(output.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload.Success || payload.Status != "error" || len(payload.Diagnostics) == 0 {
		t.Fatalf("unexpected diagnostic payload: %#v", payload)
	}
	diagnostic := payload.Diagnostics[0]
	if !strings.HasPrefix(diagnostic.Code, "AAL2") || diagnostic.File != path || diagnostic.Line <= 0 || diagnostic.Column <= 0 {
		t.Fatalf("diagnostic is missing stable category/location: %#v", diagnostic)
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

func TestRunCommandStartsGeneratedGoHTTPService(t *testing.T) {
	repository := filepath.Join("..", "..")
	binary := filepath.Join(t.TempDir(), "determinant")
	build := exec.Command("go", "build", "-o", binary, "./cmd/determinant")
	build.Dir = repository
	if output, err := build.CombinedOutput(); err != nil {
		t.Fatalf("failed to build CLI: %v\n%s", err, output)
	}

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := listener.Addr().(*net.TCPAddr).Port
	_ = listener.Close()

	source := filepath.Join(repository, "examples", "items", "app.aal")
	command := exec.Command(binary, "run", source)
	command.Env = append(os.Environ(), "PORT="+strconv.Itoa(port))
	configureProcessGroup(command)
	devNull, err := os.OpenFile(os.DevNull, os.O_WRONLY, 0)
	if err != nil {
		t.Fatal(err)
	}
	defer devNull.Close()
	command.Stdout = devNull
	command.Stderr = devNull
	if err := command.Start(); err != nil {
		t.Fatal(err)
	}
	defer terminateCommand(command)

	client := &http.Client{Timeout: 500 * time.Millisecond}
	baseURL := fmt.Sprintf("http://127.0.0.1:%d", port)
	var response *http.Response
	for attempt := 0; attempt < 200; attempt++ {
		response, err = client.Get(baseURL + "/items/1")
		if err == nil {
			_ = response.Body.Close()
			break
		}
		time.Sleep(25 * time.Millisecond)
	}
	if err != nil {
		t.Fatalf("determinant run did not start: %v", err)
	}

	response = runJSONRequest(t, client, http.MethodPost, baseURL+"/items", `{"id":1,"name":"first"}`)
	if response.StatusCode != http.StatusCreated {
		response.Body.Close()
		t.Fatalf("expected create status 201, got %d", response.StatusCode)
	}
	response.Body.Close()

	response, err = client.Get(baseURL + "/items/1")
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusOK {
		response.Body.Close()
		t.Fatalf("expected read status 200, got %d", response.StatusCode)
	}
	response.Body.Close()

	request, err := http.NewRequest(http.MethodDelete, baseURL+"/items/1", nil)
	if err != nil {
		t.Fatal(err)
	}
	response, err = client.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusNoContent {
		response.Body.Close()
		t.Fatalf("expected delete status 204, got %d", response.StatusCode)
	}
	response.Body.Close()
}

func runJSONRequest(t *testing.T, client *http.Client, method, url, body string) *http.Response {
	t.Helper()
	request, err := http.NewRequest(method, url, strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Content-Type", "application/json")
	response, err := client.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	return response
}
