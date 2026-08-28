package main

import (
	"encoding/json"
	"fmt"
	"os"

	"github.com/myczh-1/determinant/internal/diagnostics"
)

const version = "0.1.0"

func main() {
	if len(os.Args) < 2 {
		printUsage(os.Stderr)
		os.Exit(2)
	}

	switch os.Args[1] {
	case "version":
		fmt.Printf("determinant %s\n", version)
	case "help", "--help", "-h":
		printUsage(os.Stdout)
	default:
		result := diagnostics.Result{
			Success: false,
			Diagnostics: []diagnostics.Diagnostic{{
				Severity: diagnostics.Error,
				Code:     "AAL0001",
				Message:  fmt.Sprintf("unknown command: %s", os.Args[1]),
			}},
		}
		if len(os.Args) > 2 && os.Args[2] == "--json" {
			_ = json.NewEncoder(os.Stdout).Encode(result)
		} else {
			fmt.Fprintln(os.Stderr, result.Diagnostics[0].Message)
		}
		os.Exit(2)
	}
}

func printUsage(output *os.File) {
	fmt.Fprintln(output, "Usage: determinant <command> [options]")
	fmt.Fprintln(output, "Commands:")
	fmt.Fprintln(output, "  version                         Print the CLI version")
	fmt.Fprintln(output, "  check <source.aal>              Validate an AAL source file")
	fmt.Fprintln(output, "  build <source.aal>              Generate target source code")
	fmt.Fprintln(output, "  run <source.aal>                Generate and run with a target toolchain")
}
