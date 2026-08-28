package main

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/myczh-1/determinant/internal/backend"
	"github.com/myczh-1/determinant/internal/binding"
	"github.com/myczh-1/determinant/internal/compiler"
	"github.com/myczh-1/determinant/internal/diagnostics"
	"github.com/myczh-1/determinant/internal/language"
)

const version = "0.1.0"

func main() {
	os.Exit(execute(os.Args[1:], os.Stdout, os.Stderr))
}

func execute(args []string, output, errors io.Writer) int {
	if len(args) == 0 {
		printUsage(errors)
		return 2
	}
	switch args[0] {
	case "version":
		if len(args) != 1 {
			fmt.Fprintln(errors, "version does not accept options")
			return 2
		}
		fmt.Fprintf(output, "determinant %s\n", version)
		return 0
	case "help", "--help", "-h":
		printUsage(output)
		return 0
	case "check":
		return executeCheck(args[1:], output, errors)
	case "build":
		return executeBuild(args[1:], output, errors)
	case "run":
		return executeRun(args[1:], output, errors)
	default:
		return writeFailure(output, errors, args, diagnostics.Diagnostic{Severity: diagnostics.Error, Code: "AAL0001", Message: "unknown command: " + args[0]})
	}
}

type commandOptions struct {
	source   string
	language language.Language
	target   string
	out      string
	binding  string
	fixture  string
	clock    string
	json     bool
}

func parseCommandArgs(args []string, defaultTarget string) (commandOptions, error) {
	languageName := "en"
	options := commandOptions{target: defaultTarget}
	for index := 0; index < len(args); index++ {
		arg := args[index]
		switch {
		case arg == "--json":
			options.json = true
		case arg == "--language":
			if index+1 >= len(args) {
				return commandOptions{}, fmt.Errorf("--language requires a value")
			}
			index++
			languageName = args[index]
		case strings.HasPrefix(arg, "--language="):
			languageName = strings.TrimPrefix(arg, "--language=")
		case arg == "--target":
			if index+1 >= len(args) {
				return commandOptions{}, fmt.Errorf("--target requires a value")
			}
			index++
			options.target = args[index]
		case strings.HasPrefix(arg, "--target="):
			options.target = strings.TrimPrefix(arg, "--target=")
		case arg == "--out" || arg == "-o":
			if index+1 >= len(args) {
				return commandOptions{}, fmt.Errorf("%s requires a value", arg)
			}
			index++
			options.out = args[index]
		case strings.HasPrefix(arg, "--out="):
			options.out = strings.TrimPrefix(arg, "--out=")
		case arg == "--binding" || arg == "--fixture" || arg == "--clock":
			if index+1 >= len(args) {
				return commandOptions{}, fmt.Errorf("%s requires a value", arg)
			}
			index++
			switch arg {
			case "--binding":
				options.binding = args[index]
			case "--fixture":
				options.fixture = args[index]
			case "--clock":
				options.clock = args[index]
			}
		case strings.HasPrefix(arg, "--binding="):
			options.binding = strings.TrimPrefix(arg, "--binding=")
		case strings.HasPrefix(arg, "--fixture="):
			options.fixture = strings.TrimPrefix(arg, "--fixture=")
		case strings.HasPrefix(arg, "--clock="):
			options.clock = strings.TrimPrefix(arg, "--clock=")
		case strings.HasPrefix(arg, "-"):
			return commandOptions{}, fmt.Errorf("unknown option: %s", arg)
		case options.source == "":
			options.source = arg
		default:
			return commandOptions{}, fmt.Errorf("command expects exactly one source file")
		}
	}
	if options.source == "" {
		return commandOptions{}, fmt.Errorf("command expects exactly one source file")
	}
	lang, ok := language.Normalize(languageName)
	if !ok {
		return commandOptions{}, fmt.Errorf("unsupported language: %s", languageName)
	}
	options.language = lang
	if options.target != "go" && options.target != "typescript" {
		return commandOptions{}, fmt.Errorf("unsupported target: %s", options.target)
	}
	return options, nil
}

func executeCheck(args []string, output, errors io.Writer) int {
	options, parseError := parseCommandArgs(args, "go")
	if parseError != nil {
		return writeFailure(output, errors, args, diagnostics.Diagnostic{Severity: diagnostics.Error, Code: "AAL0002", Message: parseError.Error()})
	}
	result, ok := compileFile(options)
	if !ok {
		return writeDiagnostics(output, errors, options.json, result.Diagnostics, 1)
	}
	if options.json {
		return encodeJSON(output, map[string]any{"status": "ok", "success": true, "diagnostics": nonNilDiagnostics(result.Diagnostics)})
	}
	fmt.Fprintf(output, "ok: %s\n", options.source)
	return 0
}

func executeBuild(args []string, output, errors io.Writer) int {
	options, parseError := parseCommandArgs(args, "go")
	if parseError != nil {
		return writeFailure(output, errors, args, diagnostics.Diagnostic{Severity: diagnostics.Error, Code: "AAL0002", Message: parseError.Error()})
	}
	result, ok := compileFile(options)
	if !ok {
		return writeDiagnostics(output, errors, options.json, result.Diagnostics, 1)
	}
	selected, err := selectBackend(options.target, result.Binding, options.language)
	if err != nil {
		return writeFailure(output, errors, args, diagnostics.Diagnostic{Severity: diagnostics.Error, Code: "AAL3001", Message: err.Error()})
	}
	code, err := selected.Generate(result.Program, result.TypeInfo)
	if err != nil {
		return writeFailure(output, errors, args, diagnostics.Diagnostic{Severity: diagnostics.Error, Code: "AAL3002", Message: "backend generation failed: " + err.Error()})
	}
	if options.out != "" {
		if err := os.MkdirAll(filepath.Dir(options.out), 0o755); err != nil {
			return writeFailure(output, errors, args, diagnostics.Diagnostic{Severity: diagnostics.Error, Code: "AAL3003", Message: "cannot create output directory: " + err.Error(), File: options.out})
		}
		if err := os.WriteFile(options.out, []byte(code), 0o644); err != nil {
			return writeFailure(output, errors, args, diagnostics.Diagnostic{Severity: diagnostics.Error, Code: "AAL3004", Message: "cannot write generated source: " + err.Error(), File: options.out})
		}
		if options.json {
			return encodeJSON(output, map[string]any{"status": "ok", "success": true, "target": options.target, "output": options.out})
		}
		fmt.Fprintf(output, "generated: %s\n", options.out)
		return 0
	}
	if options.json {
		return encodeJSON(output, map[string]any{"status": "ok", "success": true, "target": options.target, "code": code})
	}
	_, _ = io.WriteString(output, code)
	return 0
}

func executeRun(args []string, output, errors io.Writer) int {
	options, parseError := parseCommandArgs(args, "go")
	if parseError != nil {
		return writeFailure(output, errors, args, diagnostics.Diagnostic{Severity: diagnostics.Error, Code: "AAL0002", Message: parseError.Error()})
	}
	if options.target != "go" {
		return writeFailure(output, errors, args, diagnostics.Diagnostic{Severity: diagnostics.Error, Code: "AAL3005", Message: "typescript run requires an external TypeScript runner and is not enabled in this migration slice"})
	}
	result, ok := compileFile(options)
	if !ok {
		return writeDiagnostics(output, errors, options.json, result.Diagnostics, 1)
	}
	selected, err := selectBackend(options.target, result.Binding, options.language)
	if err != nil {
		return writeFailure(output, errors, args, diagnostics.Diagnostic{Severity: diagnostics.Error, Code: "AAL3001", Message: err.Error()})
	}
	code, err := selected.Generate(result.Program, result.TypeInfo)
	if err != nil {
		return writeFailure(output, errors, args, diagnostics.Diagnostic{Severity: diagnostics.Error, Code: "AAL3002", Message: "backend generation failed: " + err.Error()})
	}
	directory, err := os.MkdirTemp("", "determinant-run-")
	if err != nil {
		return writeFailure(output, errors, args, diagnostics.Diagnostic{Severity: diagnostics.Error, Code: "AAL3006", Message: "cannot create temporary run directory: " + err.Error()})
	}
	defer os.RemoveAll(directory)
	sourcePath := filepath.Join(directory, "main.go")
	if err := os.WriteFile(sourcePath, []byte(code), 0o600); err != nil {
		return writeFailure(output, errors, args, diagnostics.Diagnostic{Severity: diagnostics.Error, Code: "AAL3007", Message: "cannot write temporary generated source: " + err.Error()})
	}
	command := exec.Command("go", "run", sourcePath)
	command.Stdout = output
	command.Stderr = errors
	command.Env = os.Environ()
	if options.fixture != "" {
		fixturePath, err := filepath.Abs(options.fixture)
		if err != nil {
			return writeFailure(output, errors, args, diagnostics.Diagnostic{Severity: diagnostics.Error, Code: "AAL3008", Message: "cannot resolve fixture path: " + err.Error(), File: options.fixture})
		}
		command.Env = append(command.Env, "DETERMINANT_FIXTURE="+fixturePath)
	}
	if options.clock != "" {
		command.Env = append(command.Env, "DETERMINANT_CLOCK="+options.clock)
	}
	if err := command.Run(); err != nil {
		if exitError, ok := err.(*exec.ExitError); ok {
			return exitError.ExitCode()
		}
		fmt.Fprintln(errors, err)
		return 1
	}
	return 0
}

func compileFile(options commandOptions) (compiler.Result, bool) {
	source, err := os.ReadFile(options.source)
	if err != nil {
		return compiler.Result{Diagnostics: []diagnostics.Diagnostic{{Severity: diagnostics.Error, Code: "AAL0003", Message: "cannot read source file: " + err.Error(), File: options.source}}}, false
	}
	result := compiler.Compile(string(source), options.language, options.source)
	if len(result.Diagnostics) == 0 && options.binding != "" {
		data, err := os.ReadFile(options.binding)
		if err != nil {
			result.Diagnostics = append(result.Diagnostics, diagnostics.Diagnostic{Severity: diagnostics.Error, Code: "AAL2216", Message: "cannot read binding file: " + err.Error(), File: options.binding, Line: 1, Column: 1})
			return result, false
		}
		spec, bindingDiagnostics := binding.Parse(data, options.binding)
		result.Diagnostics = append(result.Diagnostics, bindingDiagnostics...)
		if len(result.Diagnostics) == 0 {
			resolved, resolveDiagnostics := binding.Resolve(result.Program, &spec)
			result.Binding = resolved
			result.Diagnostics = append(result.Diagnostics, resolveDiagnostics...)
		}
	}
	return result, len(result.Diagnostics) == 0
}

func selectBackend(target string, resolved *binding.Resolved, lang language.Language) (backend.Backend, error) {
	switch target {
	case "go":
		return backend.GoBackend{Binding: resolved, Language: lang}, nil
	case "typescript":
		return backend.TypeScriptBackend{Binding: resolved}, nil
	default:
		return nil, fmt.Errorf("unsupported target: %s", target)
	}
}

func writeDiagnostics(output, errors io.Writer, jsonOutput bool, items []diagnostics.Diagnostic, failureCode int) int {
	if jsonOutput {
		if encodeJSON(output, diagnostics.Result{Success: false, Status: "error", Diagnostics: nonNilDiagnostics(items)}) != 0 {
			return 1
		}
	} else {
		for _, diagnostic := range items {
			fmt.Fprintln(errors, formatDiagnostic(diagnostic))
		}
	}
	return failureCode
}

func nonNilDiagnostics(items []diagnostics.Diagnostic) []diagnostics.Diagnostic {
	if items == nil {
		return []diagnostics.Diagnostic{}
	}
	return items
}

func writeFailure(output, errors io.Writer, args []string, diagnostic diagnostics.Diagnostic) int {
	if contains(args, "--json") {
		_ = encodeJSON(output, diagnostics.Result{Success: false, Status: "error", Diagnostics: []diagnostics.Diagnostic{diagnostic}})
		return 2
	}
	fmt.Fprintln(errors, formatDiagnostic(diagnostic))
	return 2
}

func encodeJSON(output io.Writer, value any) int {
	if err := json.NewEncoder(output).Encode(value); err != nil {
		return 1
	}
	return 0
}

func formatDiagnostic(diagnostic diagnostics.Diagnostic) string {
	location := ""
	if diagnostic.File != "" {
		location = diagnostic.File
		if diagnostic.Line > 0 {
			location += fmt.Sprintf(":%d:%d", diagnostic.Line, diagnostic.Column)
		}
		location += ": "
	}
	return location + diagnostic.Code + ": " + diagnostic.Message
}

func contains(values []string, expected string) bool {
	for _, value := range values {
		if strings.TrimSpace(value) == expected {
			return true
		}
	}
	return false
}

func printUsage(output io.Writer) {
	fmt.Fprintln(output, "Usage: determinant <command> [options]")
	fmt.Fprintln(output, "Commands:")
	fmt.Fprintln(output, "  version                         Print the CLI version")
	fmt.Fprintln(output, "  check <source.aal>              Validate an AAL source file")
	fmt.Fprintln(output, "  build <source.aal>              Generate target source code")
	fmt.Fprintln(output, "  run <source.aal>                Generate and run with a target toolchain")
}
