package diagnostics

import "testing"

func TestResultShape(t *testing.T) {
	result := Result{
		Success: false,
		Diagnostics: []Diagnostic{{
			Severity: Error,
			Code:     "AAL1003",
			Message:  "unknown entity: User",
			File:     "app.aal",
			Line:     12,
			Column:   8,
		}},
	}
	if result.Diagnostics[0].Code != "AAL1003" || result.Diagnostics[0].Line != 12 {
		t.Fatalf("unexpected diagnostic: %#v", result.Diagnostics[0])
	}
}
