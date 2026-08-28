package main

import (
	"encoding/json"
	"fmt"
	"os"

	"github.com/myczh-1/determinant/internal/plugin"
)

func main() {
	err := plugin.ServeObserver(os.Stdin, os.Stdout, func(input plugin.ObserverParams) ([]plugin.Artifact, error) {
		content, err := json.Marshal(map[string]any{
			"application": len(input.Program.Name) > 0,
			"name":        input.Program.Name,
			"entities":    len(input.Program.Entities),
			"flows":       len(input.Program.Flows),
			"routes":      len(input.Program.Routes),
		})
		if err != nil {
			return nil, err
		}
		return []plugin.Artifact{{Name: "summary.json", Kind: "summary", MediaType: "application/json", Content: string(content)}}, nil
	})
	if err != nil {
		_, _ = fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
