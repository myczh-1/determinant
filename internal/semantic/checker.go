package semantic

import (
	"fmt"
	"regexp"

	"github.com/myczh-1/determinant/internal/ast"
	"github.com/myczh-1/determinant/internal/diagnostics"
)

var identifierPattern = regexp.MustCompile(`^[\p{L}_][\p{L}\p{N}_]*$`)

type Type struct {
	Kind     string
	Name     string
	Currency string
	Unit     string
	Scale    int
	Values   []string
	Fields   []ast.Field
}

type FlowSignature struct {
	Name   string
	Inputs []ast.Field
	Output Type
}

type TypeInfo struct {
	ValueTypes     map[string]Type
	ObjectTypes    map[string]Type
	FlowSignatures map[string]FlowSignature
}

func Check(program *ast.Program) (*TypeInfo, []diagnostics.Diagnostic) {
	typeInfo := createTypeInfo(program)
	checker := &checker{program: program, typeInfo: typeInfo, diagnostics: make([]diagnostics.Diagnostic, 0)}
	checker.checkDeclarations()
	checker.checkFlows()
	checker.checkHTTPEntries()
	return typeInfo, checker.diagnostics
}

func createTypeInfo(program *ast.Program) *TypeInfo {
	info := &TypeInfo{ValueTypes: map[string]Type{}, ObjectTypes: map[string]Type{}, FlowSignatures: map[string]FlowSignature{}}
	for _, valueSet := range program.ValueSets {
		values := make([]string, 0, len(valueSet.Values))
		for _, value := range valueSet.Values {
			values = append(values, value.Name)
		}
		info.ValueTypes[valueSet.Name] = Type{Kind: "value", Name: valueSet.Name, Values: values}
	}
	for _, object := range program.Objects {
		info.ObjectTypes[object.Name] = Type{Kind: "object", Name: object.Name}
	}
	for _, object := range program.Objects {
		fields := make([]ast.Field, 0, len(object.Fields))
		for _, field := range object.Fields {
			resolved := resolveTypeWithoutDiagnostics(field.Type, info)
			field.Type = toASTTypeRef(resolved)
			fields = append(fields, field)
		}
		info.ObjectTypes[object.Name] = Type{Kind: "object", Name: object.Name, Fields: fields}
	}
	for _, flow := range program.Flows {
		outputFields := make([]ast.Field, 0, len(flow.Outputs))
		for _, output := range flow.Outputs {
			outputFields = append(outputFields, ast.Field{Name: output.Name, Type: ast.TypeRef{Kind: "unknown"}, Location: output.Location})
		}
		inputs := append([]ast.Field(nil), flow.Inputs...)
		for index := range inputs {
			inputs[index].Type = toASTTypeRef(resolveTypeWithoutDiagnostics(inputs[index].Type, info))
		}
		info.FlowSignatures[flow.Name] = FlowSignature{Name: flow.Name, Inputs: inputs, Output: Type{Kind: "record", Name: flow.Name, Fields: outputFields}}
	}
	populateOutputTypes(program, info)
	return info
}

func populateOutputTypes(program *ast.Program, info *TypeInfo) {
	passes := len(program.Flows)
	if passes < 1 {
		passes = 1
	}
	for pass := 0; pass < passes; pass++ {
		for _, flow := range program.Flows {
			environment := valueEnvironment(info.ValueTypes)
			for _, input := range flow.Inputs {
				environment[input.Name] = resolveTypeWithoutDiagnostics(input.Type, info)
			}
			for _, statement := range flow.Statements {
				switch statement.Kind {
				case "calculate":
					if inferred := inferExpression(statement.Expression, environment, nil); inferred != nil {
						environment[statement.Name] = *inferred
					}
				case "execute":
					if called, ok := info.FlowSignatures[statement.FlowName]; ok {
						for index := 0; index < min(len(called.Output.Fields), len(statement.Outputs)); index++ {
							environment[statement.Outputs[index]] = typeFromAST(called.Output.Fields[index].Type)
						}
					}
				case "create", "query":
					if object, ok := info.ObjectTypes[statement.ObjectName]; ok {
						environment[statement.Name] = object
					}
				}
			}
			output := info.FlowSignatures[flow.Name].Output
			for index := range flow.Outputs {
				inferred := inferExpression(flow.Outputs[index].Expression, environment, nil)
				if inferred == nil {
					inferred = &Type{Kind: "unknown"}
				}
				if index < len(output.Fields) {
					output.Fields[index].Type = toASTTypeRef(*inferred)
				}
			}
			info.FlowSignatures[flow.Name] = FlowSignature{Name: flow.Name, Inputs: info.FlowSignatures[flow.Name].Inputs, Output: output}
		}
	}
}

type checker struct {
	program     *ast.Program
	typeInfo    *TypeInfo
	diagnostics []diagnostics.Diagnostic
}

func (c *checker) checkDeclarations() {
	declarationNames := map[string]bool{}
	valueMembers := map[string]bool{}
	for _, valueSet := range c.program.ValueSets {
		if declarationNames[valueSet.Name] {
			c.error("AAL2001", "duplicate value set: "+valueSet.Name, valueSet.Location)
		}
		declarationNames[valueSet.Name] = true
		localMembers := map[string]bool{}
		for _, value := range valueSet.Values {
			if localMembers[value.Name] {
				c.error("AAL2002", fmt.Sprintf("value set %s has duplicate member: %s", valueSet.Name, value.Name), value.Location)
			}
			localMembers[value.Name] = true
			if valueMembers[value.Name] {
				c.error("AAL2003", "value members must be unique within an application: "+value.Name, value.Location)
			}
			valueMembers[value.Name] = true
		}
	}
	objectNames := map[string]bool{}
	for _, object := range c.program.Objects {
		if objectNames[object.Name] {
			c.error("AAL2004", "duplicate object declaration: "+object.Name, object.Location)
		}
		if declarationNames[object.Name] {
			c.error("AAL2005", "duplicate top-level type name: "+object.Name, object.Location)
		}
		declarationNames[object.Name] = true
		objectNames[object.Name] = true
		c.checkFields(object.Fields, "object "+object.Name+" fields")
		identityNames := map[string]bool{}
		resolved, ok := c.typeInfo.ObjectTypes[object.Name]
		for _, identity := range object.IdentityFields {
			if identityNames[identity] {
				c.error("AAL2006", fmt.Sprintf("object %s has duplicate identity field: %s", object.Name, identity), object.Location)
			}
			identityNames[identity] = true
			field := findField(resolved.Fields, identity)
			if !ok || field == nil {
				c.error("AAL2007", fmt.Sprintf("object %s identity references an undeclared field: %s", object.Name, identity), object.Location)
			} else if !isIdentityType(typeFromAST(field.Type)) {
				c.error("AAL2008", fmt.Sprintf("object %s identity field must be integer, text, or boolean: %s", object.Name, identity), field.Location)
			}
		}
	}
}

func (c *checker) checkFields(fields []ast.Field, label string) {
	names := map[string]bool{}
	for _, field := range fields {
		if names[field.Name] {
			c.error("AAL2009", fmt.Sprintf("%s has duplicate field: %s", label, field.Name), field.Location)
		}
		names[field.Name] = true
		c.resolveType(field.Type, field.Location)
	}
}

func (c *checker) checkFlows() {
	names := map[string]bool{}
	for _, flow := range c.program.Flows {
		if names[flow.Name] {
			c.error("AAL2010", "duplicate flow declaration: "+flow.Name, flow.Location)
		}
		names[flow.Name] = true
		c.checkFlow(flow)
	}
}

func (c *checker) checkFlow(flow ast.Flow) {
	environment := valueEnvironment(c.typeInfo.ValueTypes)
	stored := map[string]bool{}
	inputNames := map[string]bool{}
	for _, input := range flow.Inputs {
		if inputNames[input.Name] {
			c.error("AAL2011", fmt.Sprintf("flow %s has duplicate input: %s", flow.Name, input.Name), input.Location)
		}
		if environment[input.Name].Kind != "" {
			c.error("AAL2012", "flow input name conflicts with a value member: "+input.Name, input.Location)
		}
		inputNames[input.Name] = true
		c.resolveType(input.Type, input.Location)
		environment[input.Name] = resolveTypeWithoutDiagnostics(input.Type, c.typeInfo)
	}
	c.checkStatements(flow.Statements, environment, stored)
	output := c.checkOutputs(flow, environment)
	signature := c.typeInfo.FlowSignatures[flow.Name]
	signature.Output = output
	c.typeInfo.FlowSignatures[flow.Name] = signature
}

func (c *checker) checkStatements(statements []ast.Statement, environment map[string]Type, stored map[string]bool) {
	for _, statement := range statements {
		switch statement.Kind {
		case "atomic":
			for _, nested := range statement.Statements {
				if nested.Kind != "create" && nested.Kind != "change" {
					c.error("AAL2013", "atomic blocks currently allow only create and change", nested.Location)
				}
			}
			c.checkStatements(statement.Statements, cloneEnvironment(environment), cloneBoolMap(stored))
		case "conditional":
			condition := c.infer(statement.Condition, environment)
			if condition != nil && condition.Kind != "boolean" {
				c.error("AAL2014", "conditional business steps require a boolean condition", statement.Condition.Location)
			}
			c.checkStatements(statement.Statements, cloneEnvironment(environment), cloneBoolMap(stored))
		case "if":
			condition := c.infer(statement.Condition, environment)
			if condition != nil && condition.Kind != "boolean" {
				c.error("AAL2015", "if conditions must be boolean", statement.Condition.Location)
			}
		case "calculate":
			if !isIdentifier(statement.Name) {
				c.error("AAL2016", "calculation result must use an identifier", statement.Location)
				continue
			}
			if _, exists := environment[statement.Name]; exists {
				c.error("AAL2017", "duplicate name definition: "+statement.Name, statement.Location)
				continue
			}
			if inferred := c.infer(statement.Expression, environment); inferred != nil {
				environment[statement.Name] = *inferred
			}
		case "create":
			c.checkCreate(statement, environment, stored)
		case "query":
			c.checkQuery(statement, environment, stored)
		case "delete":
			c.checkDelete(statement, environment, stored)
		case "change":
			c.checkChange(statement, environment, stored)
		case "execute":
			c.checkExecute(statement, environment)
		}
	}
}

func (c *checker) checkCreate(statement ast.Statement, environment map[string]Type, stored map[string]bool) {
	object, ok := c.typeInfo.ObjectTypes[statement.ObjectName]
	if !ok {
		c.error("AAL2020", "create references an undeclared object: "+statement.ObjectName, statement.Location)
		return
	}
	c.requireIdentity(statement.ObjectName, statement.Location)
	if _, exists := environment[statement.Name]; exists {
		c.error("AAL2021", "duplicate name definition: "+statement.Name, statement.Location)
	}
	assignmentEnvironment := cloneEnvironment(environment)
	assignmentEnvironment[statement.Name] = object
	assigned := map[string]bool{}
	for _, assignment := range statement.Assignments {
		if assignment.Target == nil || assignment.Target.Kind != "member" || assignment.Target.Object == nil || assignment.Target.Object.Kind != "reference" || assignment.Target.Object.Name != statement.Name {
			c.error("AAL2022", fmt.Sprintf("create can only assign fields on %s", statement.Name), assignment.Location)
			continue
		}
		fieldName := assignment.Target.Property
		if assigned[fieldName] {
			c.error("AAL2023", "duplicate create field assignment: "+fieldName, assignment.Location)
		}
		assigned[fieldName] = true
		targetType := c.infer(assignment.Target, assignmentEnvironment)
		valueType := c.infer(assignment.Expression, environment)
		if targetType != nil && valueType != nil && !sameType(*targetType, *valueType) {
			c.error("AAL2024", fmt.Sprintf("create field %s type mismatch: expected %s, got %s", fieldName, describe(*targetType), describe(*valueType)), assignment.Location)
		}
	}
	for _, field := range object.Fields {
		if !assigned[field.Name] {
			c.error("AAL2025", "create is missing field: "+field.Name, statement.Location)
		}
	}
	environment[statement.Name] = object
	stored[statement.Name] = true
}

func (c *checker) checkQuery(statement ast.Statement, environment map[string]Type, stored map[string]bool) {
	object, ok := c.typeInfo.ObjectTypes[statement.ObjectName]
	if !ok {
		c.error("AAL2030", "query references an undeclared object: "+statement.ObjectName, statement.Location)
		return
	}
	c.requireIdentity(statement.ObjectName, statement.Location)
	if _, exists := environment[statement.Name]; exists {
		c.error("AAL2031", "duplicate name definition: "+statement.Name, statement.Location)
	}
	queryEnvironment := cloneEnvironment(environment)
	queryEnvironment[statement.Name] = object
	conditionType := c.infer(statement.Condition, queryEnvironment)
	if conditionType != nil && conditionType.Kind != "boolean" {
		c.error("AAL2032", "query condition must be boolean", statement.Condition.Location)
	}
	environment[statement.Name] = object
	stored[statement.Name] = true
}

func (c *checker) checkDelete(statement ast.Statement, environment map[string]Type, stored map[string]bool) {
	if statement.Expression == nil || statement.Expression.Kind != "reference" || !stored[statement.Expression.Name] {
		c.error("AAL2040", "delete must target an object created or queried in the current flow", statement.Location)
	}
	deletedType := c.infer(statement.Expression, environment)
	if deletedType != nil && deletedType.Kind != "object" {
		c.error("AAL2041", "delete must target an object", statement.Location)
	}
	if deletedType != nil && deletedType.Kind == "object" {
		c.requireIdentity(deletedType.Name, statement.Location)
	}
}

func (c *checker) checkChange(statement ast.Statement, environment map[string]Type, stored map[string]bool) {
	if statement.Target == nil || statement.Target.Kind != "member" {
		c.error("AAL2050", "change must target an object field", statement.Location)
		return
	}
	root := rootExpression(statement.Target)
	rootType := c.infer(root, environment)
	if rootType != nil && rootType.Kind != "object" {
		c.error("AAL2051", "change can only mutate object state", statement.Location)
	}
	if statement.Target.Object != nil && statement.Target.Object.Kind == "reference" && stored[statement.Target.Object.Name] && rootType != nil && rootType.Kind == "object" {
		if object, ok := findObject(c.program.Objects, rootType.Name); ok && contains(object.IdentityFields, statement.Target.Property) {
			c.error("AAL2052", "identity fields cannot be changed: "+statement.Target.Property, statement.Location)
		}
	}
	targetType := c.infer(statement.Target, environment)
	valueType := c.infer(statement.Expression, environment)
	if targetType != nil && valueType != nil && !sameType(*targetType, *valueType) {
		c.error("AAL2053", fmt.Sprintf("change type mismatch: expected %s, got %s", describe(*targetType), describe(*valueType)), statement.Location)
	}
}

func (c *checker) checkExecute(statement ast.Statement, environment map[string]Type) {
	called, ok := c.typeInfo.FlowSignatures[statement.FlowName]
	if !ok {
		c.error("AAL2060", "flow not found: "+statement.FlowName, statement.Location)
		return
	}
	if len(called.Inputs) != len(statement.Inputs) {
		c.error("AAL2061", fmt.Sprintf("flow %s expects %d inputs, got %d", called.Name, len(called.Inputs), len(statement.Inputs)), statement.Location)
	}
	for index := 0; index < min(len(called.Inputs), len(statement.Inputs)); index++ {
		actual := c.infer(statement.Inputs[index], environment)
		expected := resolveTypeWithoutDiagnostics(called.Inputs[index].Type, c.typeInfo)
		if actual != nil && !sameType(*actual, expected) {
			c.errorAt("AAL2062", fmt.Sprintf("flow input %s type mismatch: expected %s, got %s", called.Inputs[index].Name, describe(expected), describe(*actual)), statement.Inputs[index].Location)
		}
	}
	if len(called.Output.Fields) != len(statement.Outputs) {
		c.error("AAL2063", fmt.Sprintf("flow %s produces %d results, got %d names", called.Name, len(called.Output.Fields), len(statement.Outputs)), statement.Location)
	}
	names := map[string]bool{}
	for index := 0; index < min(len(called.Output.Fields), len(statement.Outputs)); index++ {
		name := statement.Outputs[index]
		if names[name] {
			c.error("AAL2064", "duplicate received name: "+name, statement.Location)
			continue
		}
		if _, exists := environment[name]; exists {
			c.error("AAL2064", "duplicate received name: "+name, statement.Location)
			continue
		}
		names[name] = true
		environment[name] = typeFromAST(called.Output.Fields[index].Type)
	}
}

func (c *checker) checkOutputs(flow ast.Flow, environment map[string]Type) Type {
	names := map[string]bool{}
	fields := make([]ast.Field, 0, len(flow.Outputs))
	for _, output := range flow.Outputs {
		if names[output.Name] {
			c.error("AAL2070", "duplicate output name: "+output.Name, output.Location)
		}
		names[output.Name] = true
		actual := c.infer(output.Expression, environment)
		if actual == nil {
			actual = &Type{Kind: "unknown"}
		}
		fields = append(fields, ast.Field{Name: output.Name, Type: toASTTypeRef(*actual), Location: output.Location})
	}
	return Type{Kind: "record", Name: flow.Name, Fields: fields}
}

func (c *checker) checkHTTPEntries() {
	names := map[string]bool{}
	routes := map[string]bool{}
	for _, entry := range c.program.HTTPEntries {
		if names[entry.Name] {
			c.error("AAL2080", "duplicate HTTP entry: "+entry.Name, entry.Location)
		}
		names[entry.Name] = true
		routeKey := entry.Method + " " + regexp.MustCompile(`\{[\p{L}_][\p{L}\p{N}_]*\}`).ReplaceAllString(entry.Path, "{}")
		if routes[routeKey] {
			c.error("AAL2081", "duplicate HTTP route: "+routeKey, entry.Location)
		}
		routes[routeKey] = true
		if entry.SuccessStatus < 200 || entry.SuccessStatus > 299 {
			c.error("AAL2082", "HTTP success status must be 2xx", entry.Location)
		}
		for _, failure := range entry.FailureMappings {
			if failure.Status < 400 || failure.Status > 599 {
				c.error("AAL2083", "HTTP failure status must be 4xx or 5xx", failure.Location)
			}
		}
		flow, flowOK := findFlow(c.program.Flows, entry.TargetFlow)
		signature, signatureOK := c.typeInfo.FlowSignatures[entry.TargetFlow]
		if !flowOK || !signatureOK {
			c.error("AAL2084", "HTTP entry references an undeclared flow: "+entry.TargetFlow, entry.Location)
			continue
		}
		targetNames := map[string]bool{}
		sourceLocations := map[string]bool{}
		for _, mapping := range entry.PathMappings {
			c.checkHTTPMapping(mapping, signature, true, targetNames, sourceLocations)
		}
		for _, mapping := range entry.BodyMappings {
			c.checkHTTPMapping(mapping, signature, false, targetNames, sourceLocations)
		}
		systemSources := map[string]bool{}
		for _, mapping := range entry.SystemMappings {
			if targetNames[mapping.TargetName] {
				c.error("AAL2085", "duplicate HTTP input mapping: "+mapping.TargetName, mapping.Location)
			}
			targetNames[mapping.TargetName] = true
			input := findField(signature.Inputs, mapping.TargetName)
			if input == nil {
				c.error("AAL2086", "system mapping references an undeclared flow input: "+mapping.TargetName, mapping.Location)
			} else if input.Type.Kind != "time" {
				c.error("AAL2087", "current time can only map to a time input: "+mapping.TargetName, mapping.Location)
			}
			if systemSources[mapping.Source] {
				c.error("AAL2088", "an HTTP entry cannot provide current time more than once", mapping.Location)
			}
			systemSources[mapping.Source] = true
		}
		for _, input := range signature.Inputs {
			if !targetNames[input.Name] {
				c.error("AAL2089", "HTTP entry is missing a flow input mapping: "+input.Name, entry.Location)
			}
		}
		placeholders := extractPlaceholders(entry.Path)
		mappedPathNames := make([]string, 0, len(entry.PathMappings))
		for _, mapping := range entry.PathMappings {
			mappedPathNames = append(mappedPathNames, mapping.SourceName)
		}
		for _, placeholder := range placeholders {
			if !contains(mappedPathNames, placeholder) {
				c.error("AAL2090", "request path is missing a parameter mapping: "+placeholder, entry.Location)
			}
		}
		for _, source := range mappedPathNames {
			if !contains(placeholders, source) {
				c.error("AAL2091", "request path mapping does not appear in the route: "+source, entry.Location)
			}
		}
		possibleFailures := collectFailures(flow, c.program, map[string]bool{})
		mappedFailures := map[string]bool{}
		for _, mapping := range entry.FailureMappings {
			if mappedFailures[mapping.Failure] {
				c.error("AAL2092", "duplicate HTTP failure mapping: "+mapping.Failure, mapping.Location)
			}
			mappedFailures[mapping.Failure] = true
			if !possibleFailures[mapping.Failure] {
				c.error("AAL2093", "HTTP maps a failure the flow cannot produce: "+mapping.Failure, mapping.Location)
			}
		}
		for failure := range possibleFailures {
			if !mappedFailures[failure] {
				c.error("AAL2094", "HTTP entry is missing a failure mapping: "+failure, entry.Location)
			}
		}
	}
}

func (c *checker) checkHTTPMapping(mapping ast.HTTPFieldMapping, signature FlowSignature, path bool, targetNames, sourceLocations map[string]bool) {
	if targetNames[mapping.TargetName] {
		c.error("AAL2085", "duplicate HTTP input mapping: "+mapping.TargetName, mapping.Location)
	}
	targetNames[mapping.TargetName] = true
	input := findField(signature.Inputs, mapping.TargetName)
	if input == nil {
		c.error("AAL2086", "HTTP mapping references an undeclared flow input: "+mapping.TargetName, mapping.Location)
	} else if path && input.Type.Kind == "money" {
		c.error("AAL2095", "HTTP path parameters cannot use a money type", mapping.Location)
	} else if !contains([]string{"integer", "text", "boolean", "money"}, input.Type.Kind) {
		c.error("AAL2096", "HTTP input type is not supported: "+describe(typeFromAST(input.Type)), mapping.Location)
	}
	locationKey := "body:"
	if path {
		locationKey = "path:"
	}
	locationKey += mapping.SourceName
	if sourceLocations[locationKey] {
		c.error("AAL2097", "duplicate HTTP request field: "+mapping.SourceName, mapping.Location)
	}
	sourceLocations[locationKey] = true
}

func (c *checker) infer(expression *ast.Expr, environment map[string]Type) *Type {
	return inferExpression(expression, environment, &c.diagnostics)
}

func (c *checker) resolveType(typeRef ast.TypeRef, location ast.Location) Type {
	if typeRef.Kind != "named" {
		return typeFromAST(typeRef)
	}
	if resolved, ok := c.typeInfo.ObjectTypes[typeRef.Name]; ok {
		return resolved
	}
	if resolved, ok := c.typeInfo.ValueTypes[typeRef.Name]; ok {
		return resolved
	}
	c.error("AAL2098", "references an undeclared type: "+typeRef.Name, location)
	return typeFromAST(typeRef)
}

func (c *checker) requireIdentity(name string, location ast.Location) {
	object, ok := findObject(c.program.Objects, name)
	if ok && len(object.IdentityFields) == 0 {
		c.error("AAL2099", fmt.Sprintf("object %s must declare identity when used by CRUD", name), location)
	}
}

func (c *checker) error(code, message string, location ast.Location) {
	c.errorAt(code, message, location)
}

func (c *checker) errorAt(code, message string, location ast.Location) {
	c.diagnostics = append(c.diagnostics, diagnostics.Diagnostic{Severity: diagnostics.Error, Code: code, Message: message, File: location.File, Line: location.Line, Column: location.Column})
}

func inferExpression(expression *ast.Expr, environment map[string]Type, output *[]diagnostics.Diagnostic) *Type {
	if expression == nil {
		return nil
	}
	if expression.Kind == "integer-literal" {
		return &Type{Kind: "integer"}
	}
	if expression.Kind == "money-literal" {
		return &Type{Kind: "money", Currency: expression.Currency, Unit: expression.Unit, Scale: expression.Scale}
	}
	if expression.Kind == "duration-literal" {
		return &Type{Kind: "duration"}
	}
	if expression.Kind == "reference" {
		if resolved, ok := environment[expression.Name]; ok {
			return &resolved
		}
		addDiagnostic(output, "AAL2100", "undefined name: "+expression.Name, expression.Location)
		return nil
	}
	if expression.Kind == "member" {
		container := inferExpression(expression.Object, environment, output)
		if container == nil || (container.Kind != "object" && container.Kind != "record") {
			kind := "unknown type"
			if container != nil {
				kind = describe(*container)
			}
			addDiagnostic(output, "AAL2101", "cannot read a field from "+kind, expression.Location)
			return nil
		}
		if field := findField(container.Fields, expression.Property); field != nil {
			resolved := typeFromAST(field.Type)
			return &resolved
		}
		addDiagnostic(output, "AAL2102", fmt.Sprintf("%s has no field: %s", describe(*container), expression.Property), expression.Location)
		return nil
	}
	if expression.Kind == "unary" {
		operand := inferExpression(expression.Expression, environment, output)
		if operand != nil && operand.Kind == "boolean" {
			return &Type{Kind: "boolean"}
		}
		if operand != nil {
			addDiagnostic(output, "AAL2103", "not only supports boolean, got "+describe(*operand), expression.Location)
		}
		return nil
	}
	left := inferExpression(expression.Left, environment, output)
	right := inferExpression(expression.Right, environment, output)
	if left == nil || right == nil {
		return nil
	}
	if expression.Operator == "and" || expression.Operator == "or" {
		if left.Kind == "boolean" && right.Kind == "boolean" {
			return &Type{Kind: "boolean"}
		}
		addDiagnostic(output, "AAL2104", fmt.Sprintf("logical operators only support boolean, got %s and %s", describe(*left), describe(*right)), expression.Location)
		return nil
	}
	if contains([]string{">", ">=", "<", "<=", "==", "!="}, expression.Operator) {
		if !sameType(*left, *right) {
			addDiagnostic(output, "AAL2105", fmt.Sprintf("incompatible comparison types: %s and %s", describe(*left), describe(*right)), expression.Location)
			return nil
		}
		return &Type{Kind: "boolean"}
	}
	if contains([]string{"%", "/", "*"}, expression.Operator) && left.Kind == "integer" && right.Kind == "integer" {
		return &Type{Kind: "integer"}
	}
	if expression.Operator == "*" && left.Kind == "money" && right.Kind == "integer" {
		return left
	}
	if expression.Operator == "*" && left.Kind == "integer" && right.Kind == "money" {
		return right
	}
	if expression.Operator == "+" && left.Kind == "time" && right.Kind == "duration" {
		return &Type{Kind: "time"}
	}
	if (expression.Operator == "+" || expression.Operator == "-") && sameType(*left, *right) && (left.Kind == "integer" || left.Kind == "money") {
		return left
	}
	addDiagnostic(output, "AAL2106", fmt.Sprintf("operator %s does not support types %s and %s", expression.Operator, describe(*left), describe(*right)), expression.Location)
	return nil
}

func addDiagnostic(output *[]diagnostics.Diagnostic, code, message string, location ast.Location) {
	if output == nil {
		return
	}
	*output = append(*output, diagnostics.Diagnostic{Severity: diagnostics.Error, Code: code, Message: message, File: location.File, Line: location.Line, Column: location.Column})
}

func sameType(left, right Type) bool {
	if left.Kind == "unknown" || right.Kind == "unknown" {
		return true
	}
	if left.Kind != right.Kind {
		return false
	}
	switch left.Kind {
	case "money":
		return left.Currency == right.Currency && left.Unit == right.Unit && left.Scale == right.Scale
	case "value", "object", "record":
		return left.Name == right.Name
	default:
		return true
	}
}

func describe(typeRef Type) string {
	switch typeRef.Kind {
	case "integer":
		return "integer"
	case "text":
		return "text"
	case "boolean":
		return "boolean"
	case "time":
		return "time"
	case "duration":
		return "duration"
	case "money":
		return fmt.Sprintf("%s amount (unit %s)", typeRef.Currency, typeRef.Unit)
	case "value":
		return "value " + typeRef.Name
	case "named":
		return "unresolved type " + typeRef.Name
	case "object":
		return "object " + typeRef.Name
	case "record":
		return "output of flow " + typeRef.Name
	default:
		return "unknown type"
	}
}

func typeFromAST(typeRef ast.TypeRef) Type {
	return Type{Kind: typeRef.Kind, Name: typeRef.Name, Currency: typeRef.Currency, Unit: typeRef.Unit, Scale: typeRef.Scale, Values: append([]string(nil), typeRef.Values...)}
}

func toASTTypeRef(typeRef Type) ast.TypeRef {
	return ast.TypeRef{Kind: typeRef.Kind, Name: typeRef.Name, Currency: typeRef.Currency, Unit: typeRef.Unit, Scale: typeRef.Scale, Values: append([]string(nil), typeRef.Values...)}
}

func resolveTypeWithoutDiagnostics(typeRef ast.TypeRef, info *TypeInfo) Type {
	if typeRef.Kind != "named" {
		return typeFromAST(typeRef)
	}
	if resolved, ok := info.ObjectTypes[typeRef.Name]; ok {
		return resolved
	}
	if resolved, ok := info.ValueTypes[typeRef.Name]; ok {
		return resolved
	}
	return typeFromAST(typeRef)
}

func valueEnvironment(valueTypes map[string]Type) map[string]Type {
	environment := map[string]Type{}
	for _, valueType := range valueTypes {
		for _, value := range valueType.Values {
			if _, exists := environment[value]; !exists {
				environment[value] = valueType
			}
		}
	}
	return environment
}

func rootExpression(expression *ast.Expr) *ast.Expr {
	current := expression
	for current != nil && current.Kind == "member" {
		current = current.Object
	}
	return current
}

func findField(fields []ast.Field, name string) *ast.Field {
	for index := range fields {
		if fields[index].Name == name {
			return &fields[index]
		}
	}
	return nil
}

func findObject(objects []ast.Object, name string) (ast.Object, bool) {
	for _, object := range objects {
		if object.Name == name {
			return object, true
		}
	}
	return ast.Object{}, false
}

func findFlow(flows []ast.Flow, name string) (ast.Flow, bool) {
	for _, flow := range flows {
		if flow.Name == name {
			return flow, true
		}
	}
	return ast.Flow{}, false
}

func collectFailures(flow ast.Flow, program *ast.Program, visiting map[string]bool) map[string]bool {
	if visiting[flow.Name] {
		return map[string]bool{}
	}
	visiting[flow.Name] = true
	failures := collectStatementFailures(flow.Statements, program, visiting)
	delete(visiting, flow.Name)
	return failures
}

func collectStatementFailures(statements []ast.Statement, program *ast.Program, visiting map[string]bool) map[string]bool {
	failures := map[string]bool{}
	for _, statement := range statements {
		switch statement.Kind {
		case "if", "create", "query":
			if statement.Failure != "" {
				failures[statement.Failure] = true
			}
		case "conditional", "atomic":
			for failure := range collectStatementFailures(statement.Statements, program, visiting) {
				failures[failure] = true
			}
		case "execute":
			if called, ok := findFlow(program.Flows, statement.FlowName); ok {
				for failure := range collectFailures(called, program, visiting) {
					failures[failure] = true
				}
			}
		}
	}
	return failures
}

func extractPlaceholders(path string) []string {
	matches := regexp.MustCompile(`\{([\p{L}_][\p{L}\p{N}_]*)\}`).FindAllStringSubmatch(path, -1)
	placeholders := make([]string, 0, len(matches))
	for _, match := range matches {
		if len(match) == 2 {
			placeholders = append(placeholders, match[1])
		}
	}
	return placeholders
}

func isIdentifier(value string) bool {
	return identifierPattern.MatchString(value)
}

func cloneEnvironment(environment map[string]Type) map[string]Type {
	clone := map[string]Type{}
	for key, value := range environment {
		clone[key] = value
	}
	return clone
}

func cloneBoolMap(values map[string]bool) map[string]bool {
	clone := map[string]bool{}
	for key, value := range values {
		clone[key] = value
	}
	return clone
}

func isIdentityType(typeRef Type) bool {
	return contains([]string{"integer", "text", "boolean"}, typeRef.Kind)
}

func contains(values []string, value string) bool {
	for _, candidate := range values {
		if candidate == value {
			return true
		}
	}
	return false
}

func min(left, right int) int {
	if left < right {
		return left
	}
	return right
}
