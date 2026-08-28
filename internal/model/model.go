package model

type Location struct {
	File   string `json:"file,omitempty"`
	Line   int    `json:"line,omitempty"`
	Column int    `json:"column,omitempty"`
}

type Program struct {
	Version    int         `json:"version"`
	Name       string      `json:"name"`
	Types      []Type      `json:"types,omitempty"`
	Entities   []Entity    `json:"entities,omitempty"`
	Relations  []Relation  `json:"relations,omitempty"`
	Operations []Operation `json:"operations,omitempty"`
	Flows      []Flow      `json:"flows,omitempty"`
	Routes     []Route     `json:"routes,omitempty"`
	Resources  []Resource  `json:"resources,omitempty"`
	Location   Location    `json:"location,omitempty"`
}

type Type struct {
	Name     string   `json:"name"`
	Kind     string   `json:"kind"`
	Currency string   `json:"currency,omitempty"`
	Unit     string   `json:"unit,omitempty"`
	Scale    int      `json:"scale,omitempty"`
	Values   []string `json:"values,omitempty"`
	Location Location `json:"location,omitempty"`
}

type Entity struct {
	Name           string   `json:"name"`
	Fields         []Field  `json:"fields,omitempty"`
	IdentityFields []string `json:"identityFields,omitempty"`
	Location       Location `json:"location,omitempty"`
}

type Relation struct {
	Name        string   `json:"name"`
	FromEntity  string   `json:"fromEntity"`
	FromField   string   `json:"fromField"`
	ToEntity    string   `json:"toEntity"`
	ToField     string   `json:"toField"`
	Cardinality string   `json:"cardinality,omitempty"`
	Location    Location `json:"location,omitempty"`
}

type Field struct {
	Name     string   `json:"name"`
	Type     string   `json:"type"`
	Required bool     `json:"required,omitempty"`
	Location Location `json:"location,omitempty"`
}

type Operation struct {
	Name        string       `json:"name"`
	Inputs      []Field      `json:"inputs,omitempty"`
	Outputs     []Field      `json:"outputs,omitempty"`
	StateWrites []StateWrite `json:"stateWrites,omitempty"`
	Location    Location     `json:"location,omitempty"`
}

type Flow struct {
	Name        string       `json:"name"`
	Inputs      []Field      `json:"inputs,omitempty"`
	Outputs     []Field      `json:"outputs,omitempty"`
	Calls       []FlowCall   `json:"calls,omitempty"`
	StateWrites []StateWrite `json:"stateWrites,omitempty"`
	Location    Location     `json:"location,omitempty"`
}

type FlowCall struct {
	FlowName string   `json:"flowName"`
	Location Location `json:"location,omitempty"`
}

type StateWrite struct {
	Entity   string   `json:"entity"`
	Field    string   `json:"field"`
	Location Location `json:"location,omitempty"`
}

type Route struct {
	Name        string   `json:"name"`
	Method      string   `json:"method"`
	Path        string   `json:"path"`
	Flow        string   `json:"flow"`
	SuccessCode int      `json:"successCode,omitempty"`
	Location    Location `json:"location,omitempty"`
}

type Resource struct {
	Name     string   `json:"name"`
	Kind     string   `json:"kind"`
	Location Location `json:"location,omitempty"`
}
