package plugin

import (
	"bytes"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/myczh-1/determinant/internal/model"
)

func TestServeObserverRoundTrip(t *testing.T) {
	params, err := json.Marshal(ObserverParams{Program: model.Program{Version: 1, Name: "Demo"}})
	if err != nil {
		t.Fatal(err)
	}
	request, err := json.Marshal(Request{Protocol: ProtocolVersion, Kind: Observer, Method: "observe", ID: "1", Params: params})
	if err != nil {
		t.Fatal(err)
	}
	var output bytes.Buffer
	err = ServeObserver(bytes.NewReader(append(request, '\n')), &output, func(input ObserverParams) ([]Artifact, error) {
		if input.Program.Name != "Demo" {
			t.Fatalf("unexpected program: %#v", input.Program)
		}
		return []Artifact{{Name: "summary", Kind: "text", Content: "Demo"}}, nil
	})
	if err != nil {
		t.Fatal(err)
	}
	var response Response
	if err := json.Unmarshal(output.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if !response.OK || response.ID != "1" || len(response.Artifacts) != 1 || response.Artifacts[0].Content != "Demo" {
		t.Fatalf("unexpected response: %#v", response)
	}
}

func TestServeObserverRejectsInvalidRequestsAndHandlerErrors(t *testing.T) {
	params, err := json.Marshal(ObserverParams{Program: model.Program{Version: 1, Name: "Demo"}})
	if err != nil {
		t.Fatal(err)
	}
	cases := []struct {
		name       string
		request    string
		handler    ObserverHandler
		serveError string
		response   string
	}{
		{
			name:     "protocol version",
			request:  `{"protocol":"aal-plugin/v0","kind":"observer","method":"observe","id":"version","params":` + string(params) + `}`,
			response: "unsupported plugin protocol: aal-plugin/v0",
		},
		{
			name:     "kind",
			request:  `{"protocol":"aal-plugin/v1","kind":"semantic","method":"observe","id":"kind","params":` + string(params) + `}`,
			response: "unsupported observer request",
		},
		{
			name:     "method",
			request:  `{"protocol":"aal-plugin/v1","kind":"observer","method":"describe","id":"method","params":` + string(params) + `}`,
			response: "unsupported observer request",
		},
		{
			name:     "invalid params",
			request:  `{"protocol":"aal-plugin/v1","kind":"observer","method":"observe","id":"params","params":[]}`,
			response: "decode observer params:",
		},
		{
			name:     "nil handler",
			request:  `{"protocol":"aal-plugin/v1","kind":"observer","method":"observe","id":"nil","params":` + string(params) + `}`,
			response: "observer handler is not configured",
		},
		{
			name:    "handler error",
			request: `{"protocol":"aal-plugin/v1","kind":"observer","method":"observe","id":"handler","params":` + string(params) + `}`,
			handler: func(ObserverParams) ([]Artifact, error) {
				return nil, errors.New("observer failed")
			},
			response: "observer failed",
		},
		{
			name:       "invalid json",
			request:    `{"protocol":"aal-plugin/v1"`,
			serveError: "decode plugin request:",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var output bytes.Buffer
			serveErr := ServeObserver(strings.NewReader(tc.request+"\n"), &output, tc.handler)
			if tc.serveError != "" {
				if serveErr == nil || !strings.Contains(serveErr.Error(), tc.serveError) {
					t.Fatalf("expected ServeObserver error containing %q, got %v", tc.serveError, serveErr)
				}
				return
			}
			if serveErr != nil {
				t.Fatal(serveErr)
			}
			var response Response
			if err := json.Unmarshal(output.Bytes(), &response); err != nil {
				t.Fatal(err)
			}
			if response.OK || !strings.Contains(response.Error, tc.response) {
				t.Fatalf("unexpected plugin response: %#v", response)
			}
		})
	}
}
