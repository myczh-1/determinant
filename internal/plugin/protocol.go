package plugin

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"

	"github.com/myczh-1/determinant/internal/diagnostics"
	"github.com/myczh-1/determinant/internal/model"
)

const ProtocolVersion = "aal-plugin/v1"

type Kind string

const (
	Observer Kind = "observer"
	Semantic Kind = "semantic"
	Backend  Kind = "backend"
)

type Descriptor struct {
	Protocol     string   `json:"protocol"`
	Name         string   `json:"name"`
	Kind         Kind     `json:"kind"`
	Version      string   `json:"version"`
	Capabilities []string `json:"capabilities,omitempty"`
}

type Request struct {
	Protocol string          `json:"protocol"`
	Kind     Kind            `json:"kind"`
	Method   string          `json:"method"`
	ID       string          `json:"id,omitempty"`
	Params   json.RawMessage `json:"params,omitempty"`
}

type Response struct {
	Protocol    string                   `json:"protocol"`
	Kind        Kind                     `json:"kind"`
	Method      string                   `json:"method"`
	ID          string                   `json:"id,omitempty"`
	OK          bool                     `json:"ok"`
	Error       string                   `json:"error,omitempty"`
	Artifacts   []Artifact               `json:"artifacts,omitempty"`
	Diagnostics []diagnostics.Diagnostic `json:"diagnostics,omitempty"`
	Files       []GeneratedFile          `json:"files,omitempty"`
}

type Artifact struct {
	Name      string            `json:"name"`
	Kind      string            `json:"kind"`
	MediaType string            `json:"mediaType,omitempty"`
	Content   string            `json:"content"`
	Metadata  map[string]string `json:"metadata,omitempty"`
}

type GeneratedFile struct {
	Path    string `json:"path"`
	Content string `json:"content"`
}

type ObserverParams struct {
	Program     model.Program            `json:"program"`
	Diagnostics []diagnostics.Diagnostic `json:"diagnostics,omitempty"`
}

type SemanticParams struct {
	Program model.Program `json:"program"`
}

type BackendParams struct {
	Program model.Program `json:"program"`
	Target  string        `json:"target"`
}

type ObserverHandler func(ObserverParams) ([]Artifact, error)

func ServeObserver(input io.Reader, output io.Writer, observe ObserverHandler) error {
	scanner := bufio.NewScanner(input)
	scanner.Buffer(make([]byte, 1024), 16*1024*1024)
	encoder := json.NewEncoder(output)
	for scanner.Scan() {
		if len(scanner.Bytes()) == 0 {
			continue
		}
		var request Request
		if err := json.Unmarshal(scanner.Bytes(), &request); err != nil {
			return fmt.Errorf("decode plugin request: %w", err)
		}
		response := Response{Protocol: ProtocolVersion, Kind: request.Kind, Method: request.Method, ID: request.ID}
		if request.Protocol != ProtocolVersion {
			response.Error = "unsupported plugin protocol: " + request.Protocol
		} else if request.Kind != Observer || request.Method != "observe" {
			response.Error = "unsupported observer request"
		} else {
			var params ObserverParams
			if err := json.Unmarshal(request.Params, &params); err != nil {
				response.Error = fmt.Sprintf("decode observer params: %v", err)
			} else if observe == nil {
				response.Error = "observer handler is not configured"
			} else {
				artifacts, err := observe(params)
				if err != nil {
					response.Error = err.Error()
				} else {
					response.OK = true
					response.Artifacts = artifacts
				}
			}
		}
		if err := encoder.Encode(response); err != nil {
			return fmt.Errorf("encode plugin response: %w", err)
		}
	}
	if err := scanner.Err(); err != nil {
		return fmt.Errorf("read plugin request: %w", err)
	}
	return nil
}
