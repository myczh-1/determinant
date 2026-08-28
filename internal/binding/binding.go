package binding

import (
	"encoding/json"
	"fmt"
	"regexp"

	"github.com/myczh-1/determinant/internal/ast"
	"github.com/myczh-1/determinant/internal/diagnostics"
)

type Entry struct {
	ID          string `json:"id"`
	AuditName   string `json:"auditName"`
	ProgramName string `json:"programName"`
}

type ObjectSpec struct {
	Entry
	Fields []Entry `json:"fields"`
}

type FlowSpec struct {
	Entry
	Inputs  []Entry `json:"inputs"`
	Outputs []Entry `json:"outputs"`
}

type Spec struct {
	Version int          `json:"version"`
	Objects []ObjectSpec `json:"objects"`
	Flows   []FlowSpec   `json:"flows"`
}

type Object struct {
	ID          string
	AuditName   string
	ProgramName string
	Fields      map[string]Entry
}

type Flow struct {
	ID          string
	AuditName   string
	ProgramName string
	Inputs      map[string]Entry
	Outputs     map[string]Entry
}

type Resolved struct {
	Objects map[string]Object
	Flows   map[string]Flow
}

var stableIDPattern = regexp.MustCompile(`^[a-z][a-z0-9_-]*$`)
var programNamePattern = regexp.MustCompile(`^[\p{L}_$][\p{L}\p{N}_$]*$`)

func Parse(data []byte, file string) (Spec, []diagnostics.Diagnostic) {
	var spec Spec
	if err := json.Unmarshal(data, &spec); err != nil {
		return Spec{}, []diagnostics.Diagnostic{{Severity: diagnostics.Error, Code: "AAL2200", Message: "binding file is not valid JSON: " + err.Error(), File: file, Line: 1, Column: 1}}
	}
	result := []diagnostics.Diagnostic{}
	if spec.Version != 1 {
		result = append(result, diagnostic(file, "AAL2201", "binding file must declare version: 1"))
	}
	if spec.Objects == nil {
		result = append(result, diagnostic(file, "AAL2202", "binding objects must be an array"))
	}
	if spec.Flows == nil {
		result = append(result, diagnostic(file, "AAL2203", "binding flows must be an array"))
	}
	ids := map[string]bool{}
	for _, object := range spec.Objects {
		validateEntry(object.Entry, "object "+object.AuditName, ids, &result, file)
		if object.Fields == nil {
			result = append(result, diagnostic(file, "AAL2204", "binding fields must be an array for object "+object.AuditName))
		}
		for _, field := range object.Fields {
			validateEntry(field, "field "+object.AuditName+"."+field.AuditName, ids, &result, file)
		}
		validateUniqueMemberNames(object.Fields, "field "+object.AuditName, &result, file)
	}
	for _, flow := range spec.Flows {
		validateEntry(flow.Entry, "flow "+flow.AuditName, ids, &result, file)
		for _, input := range flow.Inputs {
			validateEntry(input, "input "+flow.AuditName+"."+input.AuditName, ids, &result, file)
		}
		for _, output := range flow.Outputs {
			validateEntry(output, "output "+flow.AuditName+"."+output.AuditName, ids, &result, file)
		}
		validateUniqueMemberNames(flow.Inputs, "input "+flow.AuditName, &result, file)
		validateUniqueMemberNames(flow.Outputs, "output "+flow.AuditName, &result, file)
	}
	validateNamedEntries(spec.Objects, "object", &result, file)
	validateNamedFlows(spec.Flows, &result, file)
	return spec, result
}

func Resolve(program *ast.Program, spec *Spec) (*Resolved, []diagnostics.Diagnostic) {
	if program == nil {
		return nil, []diagnostics.Diagnostic{{Severity: diagnostics.Error, Code: "AAL2205", Message: "cannot resolve binding without a parsed program"}}
	}
	actual := spec
	if actual == nil {
		identity := Identity(program)
		actual = &identity
	}
	result := []diagnostics.Diagnostic{}
	resolved := &Resolved{Objects: map[string]Object{}, Flows: map[string]Flow{}}
	for _, object := range program.Objects {
		entry, ok := findObjectSpec(actual.Objects, object.Name)
		if !ok {
			result = append(result, at(object.Location, "AAL2206", "object is missing from binding: "+object.Name))
			continue
		}
		fields := map[string]Entry{}
		for _, field := range object.Fields {
			mapped, ok := findEntry(entry.Fields, field.Name)
			if !ok {
				result = append(result, at(field.Location, "AAL2207", "object field is missing from binding: "+object.Name+"."+field.Name))
				continue
			}
			fields[field.Name] = mapped
		}
		for _, mapped := range entry.Fields {
			if !hasObjectField(object, mapped.AuditName) {
				result = append(result, at(object.Location, "AAL2222", "binding references undeclared object field: "+object.Name+"."+mapped.AuditName))
			}
		}
		resolved.Objects[object.Name] = Object{ID: entry.ID, AuditName: entry.AuditName, ProgramName: entry.ProgramName, Fields: fields}
	}
	for _, entry := range actual.Objects {
		if _, ok := find(program.Objects, entry.AuditName); !ok {
			result = append(result, diagnostic("", "AAL2208", "binding references undeclared object: "+entry.AuditName))
		}
	}
	for _, flow := range program.Flows {
		entry, ok := findFlowSpec(actual.Flows, flow.Name)
		if !ok {
			result = append(result, at(flow.Location, "AAL2209", "flow is missing from binding: "+flow.Name))
			continue
		}
		inputs, outputs := map[string]Entry{}, map[string]Entry{}
		for _, input := range flow.Inputs {
			mapped, ok := findEntry(entry.Inputs, input.Name)
			if !ok {
				result = append(result, at(input.Location, "AAL2210", "flow input is missing from binding: "+flow.Name+"."+input.Name))
				continue
			}
			inputs[input.Name] = mapped
		}
		for _, output := range flow.Outputs {
			mapped, ok := findEntry(entry.Outputs, output.Name)
			if !ok {
				result = append(result, at(output.Location, "AAL2211", "flow output is missing from binding: "+flow.Name+"."+output.Name))
				continue
			}
			outputs[output.Name] = mapped
		}
		for _, mapped := range entry.Inputs {
			if _, ok := findFlowInput(flow, mapped.AuditName); !ok {
				result = append(result, at(flow.Location, "AAL2223", "binding references undeclared flow input: "+flow.Name+"."+mapped.AuditName))
			}
		}
		for _, mapped := range entry.Outputs {
			if _, ok := findFlowOutput(flow, mapped.AuditName); !ok {
				result = append(result, at(flow.Location, "AAL2224", "binding references undeclared flow output: "+flow.Name+"."+mapped.AuditName))
			}
		}
		resolved.Flows[flow.Name] = Flow{ID: entry.ID, AuditName: entry.AuditName, ProgramName: entry.ProgramName, Inputs: inputs, Outputs: outputs}
	}
	for _, entry := range actual.Flows {
		if !hasFlow(program, entry.AuditName) {
			result = append(result, diagnostic("", "AAL2212", "binding references undeclared flow: "+entry.AuditName))
		}
	}
	if len(result) > 0 {
		return nil, result
	}
	return resolved, result
}

func Identity(program *ast.Program) Spec {
	spec := Spec{Version: 1}
	for objectIndex, object := range program.Objects {
		mapped := ObjectSpec{Entry: Entry{ID: fmt.Sprintf("object_%d", objectIndex), AuditName: object.Name, ProgramName: object.Name}}
		for fieldIndex, field := range object.Fields {
			mapped.Fields = append(mapped.Fields, Entry{ID: fmt.Sprintf("field_%d_%d", objectIndex, fieldIndex), AuditName: field.Name, ProgramName: field.Name})
		}
		spec.Objects = append(spec.Objects, mapped)
	}
	for flowIndex, flow := range program.Flows {
		mapped := FlowSpec{Entry: Entry{ID: fmt.Sprintf("flow_%d", flowIndex), AuditName: flow.Name, ProgramName: flow.Name}}
		for inputIndex, input := range flow.Inputs {
			mapped.Inputs = append(mapped.Inputs, Entry{ID: fmt.Sprintf("input_%d_%d", flowIndex, inputIndex), AuditName: input.Name, ProgramName: input.Name})
		}
		for outputIndex, output := range flow.Outputs {
			mapped.Outputs = append(mapped.Outputs, Entry{ID: fmt.Sprintf("output_%d_%d", flowIndex, outputIndex), AuditName: output.Name, ProgramName: output.Name})
		}
		spec.Flows = append(spec.Flows, mapped)
	}
	return spec
}

func validateEntry(entry Entry, label string, ids map[string]bool, output *[]diagnostics.Diagnostic, file string) {
	if !stableIDPattern.MatchString(entry.ID) {
		*output = append(*output, diagnostic(file, "AAL2213", label+" has invalid stable id: "+entry.ID))
	}
	if ids[entry.ID] {
		*output = append(*output, diagnostic(file, "AAL2214", "binding id is duplicated: "+entry.ID))
	}
	ids[entry.ID] = true
	if entry.AuditName == "" || entry.ProgramName == "" {
		*output = append(*output, diagnostic(file, "AAL2215", label+" must have auditName and programName"))
	}
	if entry.ProgramName != "" && !programNamePattern.MatchString(entry.ProgramName) {
		*output = append(*output, diagnostic(file, "AAL2217", label+" has invalid programName: "+entry.ProgramName))
	}
}

func validateNamedEntries(entries []ObjectSpec, label string, output *[]diagnostics.Diagnostic, file string) {
	auditNames, programNames := map[string]bool{}, map[string]bool{}
	for _, entry := range entries {
		if auditNames[entry.AuditName] {
			*output = append(*output, diagnostic(file, "AAL2218", label+" auditName is duplicated: "+entry.AuditName))
		}
		if programNames[entry.ProgramName] {
			*output = append(*output, diagnostic(file, "AAL2219", label+" programName is duplicated: "+entry.ProgramName))
		}
		auditNames[entry.AuditName], programNames[entry.ProgramName] = true, true
	}
}

func validateNamedFlows(entries []FlowSpec, output *[]diagnostics.Diagnostic, file string) {
	auditNames, programNames := map[string]bool{}, map[string]bool{}
	for _, entry := range entries {
		if auditNames[entry.AuditName] {
			*output = append(*output, diagnostic(file, "AAL2218", "flow auditName is duplicated: "+entry.AuditName))
		}
		if programNames[entry.ProgramName] {
			*output = append(*output, diagnostic(file, "AAL2219", "flow programName is duplicated: "+entry.ProgramName))
		}
		auditNames[entry.AuditName], programNames[entry.ProgramName] = true, true
	}
}

func validateUniqueMemberNames(entries []Entry, label string, output *[]diagnostics.Diagnostic, file string) {
	names, programs := map[string]bool{}, map[string]bool{}
	for _, entry := range entries {
		if names[entry.AuditName] {
			*output = append(*output, diagnostic(file, "AAL2220", label+" auditName is duplicated: "+entry.AuditName))
		}
		if programs[entry.ProgramName] {
			*output = append(*output, diagnostic(file, "AAL2221", label+" programName is duplicated: "+entry.ProgramName))
		}
		names[entry.AuditName], programs[entry.ProgramName] = true, true
	}
}

func findObjectSpec(entries []ObjectSpec, name string) (ObjectSpec, bool) {
	for _, entry := range entries {
		if entry.AuditName == name {
			return entry, true
		}
	}
	return ObjectSpec{}, false
}

func findFlowSpec(entries []FlowSpec, name string) (FlowSpec, bool) {
	for _, entry := range entries {
		if entry.AuditName == name {
			return entry, true
		}
	}
	return FlowSpec{}, false
}

func findEntry(entries []Entry, name string) (Entry, bool) {
	for _, entry := range entries {
		if entry.AuditName == name {
			return entry, true
		}
	}
	return Entry{}, false
}

func find(objects []ast.Object, name string) (ast.Object, bool) {
	for _, object := range objects {
		if object.Name == name {
			return object, true
		}
	}
	return ast.Object{}, false
}

func hasFlow(program *ast.Program, name string) bool {
	for _, flow := range program.Flows {
		if flow.Name == name {
			return true
		}
	}
	return false
}

func findFlowInput(flow ast.Flow, name string) (ast.Field, bool) {
	for _, input := range flow.Inputs {
		if input.Name == name {
			return input, true
		}
	}
	return ast.Field{}, false
}

func hasObjectField(object ast.Object, name string) bool {
	for _, field := range object.Fields {
		if field.Name == name {
			return true
		}
	}
	return false
}

func findFlowOutput(flow ast.Flow, name string) (ast.Output, bool) {
	for _, output := range flow.Outputs {
		if output.Name == name {
			return output, true
		}
	}
	return ast.Output{}, false
}

func diagnostic(file, code, message string) diagnostics.Diagnostic {
	return diagnostics.Diagnostic{Severity: diagnostics.Error, Code: code, Message: message, File: file, Line: 1, Column: 1}
}

func at(location ast.Location, code, message string) diagnostics.Diagnostic {
	return diagnostics.Diagnostic{Severity: diagnostics.Error, Code: code, Message: message, File: location.File, Line: location.Line, Column: location.Column}
}
