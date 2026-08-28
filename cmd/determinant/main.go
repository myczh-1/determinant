package main

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"strings"

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
	if args[0] == "version" {
		if len(args) != 1 {
			fmt.Fprintln(errors, "version does not accept options")
			return 2
		}
		fmt.Fprintf(output, "determinant %s\n", version)
		return 0
	}
	if args[0] == "help" || args[0] == "--help" || args[0] == "-h" {
		printUsage(output)
		return 0
	}
	if args[0] != "check" {
		return writeFailure(output, errors, args, diagnostics.Diagnostic{Severity: diagnostics.Error, Code: "AAL0001", Message: "unknown command: " + args[0]})
	}

	options, parseError := parseCheckArgs(args[1:])
	if parseError != nil {
		return writeFailure(output, errors, args, diagnostics.Diagnostic{Severity: diagnostics.Error, Code: "AAL0002", Message: parseError.Error()})
	}
	source, err := os.ReadFile(options.source)
	if err != nil {
		return writeFailure(output, errors, args, diagnostics.Diagnostic{Severity: diagnostics.Error, Code: "AAL0003", Message: "cannot read source file: " + err.Error(), File: options.source})
	}
	result := compiler.Compile(string(source), options.language, options.source)
	if options.json {
		payload := diagnostics.Result{Success: len(result.Diagnostics) == 0, Status: statusFor(result.Diagnostics), Diagnostics: result.Diagnostics}
		if err := json.NewEncoder(output).Encode(payload); err != nil {
			fmt.Fprintln(errors, err)
			return 1
		}
		if len(result.Diagnostics) > 0 {
			return 1
		}
		return 0
	}
	for _, diagnostic := range result.Diagnostics {
		fmt.Fprintln(errors, formatDiagnostic(diagnostic))
	}
	if len(result.Diagnostics) > 0 {
		return 1
	}
	fmt.Fprintf(output, "ok: %s\n", options.source)
	return 0
}

type checkOptions struct {
	source   string
	language language.Language
	json     bool
}

func parseCheckArgs(args []string) (checkOptions, error) {
	languageName := "en"
	jsonOutput := false
	source := ""
	for index := 0; index < len(args); index++ {
		arg := args[index]
		switch {
		case arg == "--json":
			jsonOutput = true
		case arg == "--language":
			if index+1 >= len(args) {
				return checkOptions{}, fmt.Errorf("--language requires a value")
			}
			index++
			languageName = args[index]
		case strings.HasPrefix(arg, "--language="):
			languageName = strings.TrimPrefix(arg, "--language=")
		case strings.HasPrefix(arg, "-"):
			return checkOptions{}, fmt.Errorf("unknown option: %s", arg)
		case source == "":
			source = arg
		default:
			return checkOptions{}, fmt.Errorf("check expects exactly one source file")
		}
	}
	lang, ok := language.Normalize(languageName)
	if !ok {
		return checkOptions{}, fmt.Errorf("unsupported language: %s", languageName)
	}
	if source == "" {
		return checkOptions{}, fmt.Errorf("check expects exactly one source file")
	}
	return checkOptions{source: source, language: lang, json: jsonOutput}, nil
}

func writeFailure(output, errors io.Writer, args []string, diagnostic diagnostics.Diagnostic) int {
	if contains(args, "--json") {
		_ = json.NewEncoder(output).Encode(diagnostics.Result{Success: false, Status: "error", Diagnostics: []diagnostics.Diagnostic{diagnostic}})
	} else {
		fmt.Fprintln(errors, formatDiagnostic(diagnostic))
	}
	return 2
}

func statusFor(items []diagnostics.Diagnostic) string {
	if len(items) > 0 {
		return "error"
	}
	return "ok"
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
