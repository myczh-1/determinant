package ast

type Location struct {
	File   string `json:"file,omitempty"`
	Line   int    `json:"line,omitempty"`
	Column int    `json:"column,omitempty"`
}

type TypeRef struct {
	Kind     string   `json:"kind"`
	Name     string   `json:"name,omitempty"`
	Currency string   `json:"currency,omitempty"`
	Unit     string   `json:"unit,omitempty"`
	Scale    int      `json:"scale,omitempty"`
	Values   []string `json:"values,omitempty"`
}

type Field struct {
	Name     string   `json:"name"`
	Type     TypeRef  `json:"type"`
	Location Location `json:"location,omitempty"`
}

type Expr struct {
	Kind         string   `json:"kind"`
	Operator     string   `json:"operator,omitempty"`
	Name         string   `json:"name,omitempty"`
	Value        string   `json:"value,omitempty"`
	Number       int      `json:"number,omitempty"`
	Milliseconds int64    `json:"milliseconds,omitempty"`
	Currency     string   `json:"currency,omitempty"`
	Unit         string   `json:"unit,omitempty"`
	Scale        int      `json:"scale,omitempty"`
	Object       *Expr    `json:"object,omitempty"`
	Property     string   `json:"property,omitempty"`
	Left         *Expr    `json:"left,omitempty"`
	Right        *Expr    `json:"right,omitempty"`
	Expression   *Expr    `json:"expression,omitempty"`
	Location     Location `json:"location,omitempty"`
}

type Assignment struct {
	Name       string   `json:"name,omitempty"`
	Target     *Expr    `json:"target"`
	Expression *Expr    `json:"expression"`
	Location   Location `json:"location,omitempty"`
}

type Statement struct {
	Kind        string       `json:"kind"`
	Condition   *Expr        `json:"condition,omitempty"`
	Failure     string       `json:"failure,omitempty"`
	Statements  []Statement  `json:"statements,omitempty"`
	Name        string       `json:"name,omitempty"`
	ObjectName  string       `json:"objectName,omitempty"`
	Assignments []Assignment `json:"assignments,omitempty"`
	Target      *Expr        `json:"target,omitempty"`
	Expression  *Expr        `json:"expression,omitempty"`
	FlowName    string       `json:"flowName,omitempty"`
	Inputs      []*Expr      `json:"inputs,omitempty"`
	Outputs     []string     `json:"outputs,omitempty"`
	Location    Location     `json:"location,omitempty"`
}

type Output struct {
	Name       string   `json:"name"`
	Expression *Expr    `json:"expression"`
	Location   Location `json:"location,omitempty"`
}

type ValueSet struct {
	Name     string   `json:"name"`
	Values   []Value  `json:"values"`
	Location Location `json:"location,omitempty"`
}

type Value struct {
	Name     string   `json:"name"`
	Location Location `json:"location,omitempty"`
}

type Object struct {
	Name           string   `json:"name"`
	Fields         []Field  `json:"fields"`
	IdentityFields []string `json:"identityFields,omitempty"`
	Location       Location `json:"location,omitempty"`
}

type Flow struct {
	Name       string      `json:"name"`
	Inputs     []Field     `json:"inputs,omitempty"`
	Statements []Statement `json:"statements,omitempty"`
	Outputs    []Output    `json:"outputs,omitempty"`
	Location   Location    `json:"location,omitempty"`
}

type HTTPFieldMapping struct {
	SourceName string   `json:"sourceName"`
	TargetName string   `json:"targetName"`
	Location   Location `json:"location,omitempty"`
}

type HTTPSystemMapping struct {
	Source     string   `json:"source"`
	TargetName string   `json:"targetName"`
	Location   Location `json:"location,omitempty"`
}

type HTTPFailureMapping struct {
	Failure  string   `json:"failure"`
	Status   int      `json:"status"`
	Location Location `json:"location,omitempty"`
}

type HTTPEntry struct {
	Name            string               `json:"name"`
	Method          string               `json:"method"`
	Path            string               `json:"path"`
	TargetFlow      string               `json:"targetFlow"`
	BodyMappings    []HTTPFieldMapping   `json:"bodyMappings,omitempty"`
	PathMappings    []HTTPFieldMapping   `json:"pathMappings,omitempty"`
	SystemMappings  []HTTPSystemMapping  `json:"systemMappings,omitempty"`
	SuccessStatus   int                  `json:"successStatus"`
	FailureMappings []HTTPFailureMapping `json:"failureMappings,omitempty"`
	Location        Location             `json:"location,omitempty"`
}

type Program struct {
	Name        string      `json:"name"`
	ValueSets   []ValueSet  `json:"valueSets,omitempty"`
	Objects     []Object    `json:"objects"`
	Flows       []Flow      `json:"flows"`
	HTTPEntries []HTTPEntry `json:"httpEntries,omitempty"`
	Location    Location    `json:"location,omitempty"`
}
