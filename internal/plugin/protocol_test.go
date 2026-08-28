package plugin

import (
	"bytes"
	"encoding/json"
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
