package diagnostics

type Severity string

const (
	Info    Severity = "info"
	Warning Severity = "warning"
	Error   Severity = "error"
)

type Diagnostic struct {
	Severity Severity `json:"severity"`
	Code     string   `json:"code"`
	Message  string   `json:"message"`
	File     string   `json:"file,omitempty"`
	Line     int      `json:"line,omitempty"`
	Column   int      `json:"column,omitempty"`
	Expected []string `json:"expected,omitempty"`
	Received []string `json:"received,omitempty"`
}

type Result struct {
	Success     bool         `json:"success"`
	Status      string       `json:"status"`
	Diagnostics []Diagnostic `json:"diagnostics"`
}
