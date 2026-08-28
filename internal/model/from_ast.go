package model

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/myczh-1/determinant/internal/ast"
	"github.com/myczh-1/determinant/internal/semantic"
)

// FromAST projects the internal AST into the stable model consumed by
// backends, observers, and future plugin processes. Declaration order is
// intentional: it preserves source order and the existing entry-flow rule.
func FromAST(program *ast.Program, typeInfo *semantic.TypeInfo) Program {
	if program == nil {
		return Program{Version: 1}
	}
	result := Program{
		Version:  1,
		Name:     program.Name,
		Location: location(program.Location),
	}

	for _, valueSet := range program.ValueSets {
		values := make([]string, 0, len(valueSet.Values))
		for _, value := range valueSet.Values {
			values = append(values, value.Name)
		}
		result.Types = append(result.Types, Type{
			Name:     valueSet.Name,
			Kind:     "value",
			Values:   values,
			Location: location(valueSet.Location),
		})
	}

	for _, object := range program.Objects {
		entity := Entity{
			Name:           object.Name,
			IdentityFields: append([]string(nil), object.IdentityFields...),
			Location:       location(object.Location),
		}
		for _, field := range object.Fields {
			entity.Fields = append(entity.Fields, Field{
				Name:     field.Name,
				Type:     canonicalType(resolveType(field.Type, typeInfo)),
				Required: true,
				Location: location(field.Location),
			})
		}
		result.Entities = append(result.Entities, entity)
	}

	for _, flow := range program.Flows {
		converted := Flow{Name: flow.Name, Location: location(flow.Location)}
		for _, input := range flow.Inputs {
			converted.Inputs = append(converted.Inputs, convertField(input, typeInfo))
		}
		for _, output := range flow.Outputs {
			converted.Outputs = append(converted.Outputs, Field{
				Name:     output.Name,
				Type:     canonicalExpressionType(output.Expression, flow, typeInfo),
				Required: true,
				Location: location(output.Location),
			})
		}
		collectFlowFacts(flow, typeInfo, &converted, &result.Constraints)
		result.Flows = append(result.Flows, converted)
		result.Operations = append(result.Operations, Operation{
			Name:        flow.Name,
			Inputs:      cloneFields(converted.Inputs),
			Outputs:     cloneFields(converted.Outputs),
			StateWrites: cloneStateWrites(converted.StateWrites),
			Location:    converted.Location,
		})
	}

	for _, entry := range program.HTTPEntries {
		result.Routes = append(result.Routes, Route{
			Name:        entry.Name,
			Method:      entry.Method,
			Path:        entry.Path,
			Flow:        entry.TargetFlow,
			SuccessCode: entry.SuccessStatus,
			Location:    location(entry.Location),
		})
	}
	return result
}

// MarshalCanonical returns deterministic compact JSON for machine consumers.
// ProgramModel intentionally uses only structs and ordered slices, so the
// encoding is stable across repeated builds and independent of map iteration.
func MarshalCanonical(program Program) ([]byte, error) {
	return json.Marshal(program)
}

func convertField(field ast.Field, typeInfo *semantic.TypeInfo) Field {
	return Field{
		Name:     field.Name,
		Type:     canonicalType(resolveType(field.Type, typeInfo)),
		Required: true,
		Location: location(field.Location),
	}
}

func canonicalType(typeRef semantic.Type) string {
	switch typeRef.Kind {
	case "integer", "text", "boolean", "time", "duration":
		return typeRef.Kind
	case "money":
		return fmt.Sprintf("money(%s,%s,%d)", typeRef.Currency, typeRef.Unit, typeRef.Scale)
	case "value":
		return "value(" + typeRef.Name + ")"
	case "object":
		return "object(" + typeRef.Name + ")"
	case "record":
		return "record(" + typeRef.Name + ")"
	case "named":
		return "named(" + typeRef.Name + ")"
	default:
		return "unknown"
	}
}

func canonicalExpressionType(expression *ast.Expr, flow ast.Flow, typeInfo *semantic.TypeInfo) string {
	if expression == nil {
		return "unknown"
	}
	environment := flowEnvironment(flow, typeInfo)
	if inferred := inferModelExpression(expression, environment, typeInfo); inferred.Kind != "unknown" {
		return canonicalType(inferred)
	}
	return "unknown"
}

func flowEnvironment(flow ast.Flow, typeInfo *semantic.TypeInfo) map[string]semantic.Type {
	environment := map[string]semantic.Type{}
	if typeInfo != nil {
		for _, valueType := range typeInfo.ValueTypes {
			for _, value := range valueType.Values {
				environment[value] = valueType
			}
		}
	}
	for _, input := range flow.Inputs {
		environment[input.Name] = resolveType(input.Type, typeInfo)
	}
	populateStatementEnvironment(flow.Statements, environment, typeInfo)
	return environment
}

func populateStatementEnvironment(statements []ast.Statement, environment map[string]semantic.Type, typeInfo *semantic.TypeInfo) {
	for _, statement := range statements {
		switch statement.Kind {
		case "calculate":
			environment[statement.Name] = inferModelExpression(statement.Expression, environment, typeInfo)
		case "create", "query":
			environment[statement.Name] = objectType(statement.ObjectName, typeInfo)
		case "execute":
			if typeInfo == nil {
				continue
			}
			if signature, ok := typeInfo.FlowSignatures[statement.FlowName]; ok {
				for index, name := range statement.Outputs {
					if index < len(signature.Output.Fields) {
						environment[name] = typeFromAST(signature.Output.Fields[index].Type, typeInfo)
					}
				}
			}
		case "conditional", "atomic":
			populateStatementEnvironment(statement.Statements, cloneTypes(environment), typeInfo)
		}
	}
}

func collectFlowFacts(sourceFlow ast.Flow, typeInfo *semantic.TypeInfo, flow *Flow, constraints *[]Constraint) {
	environment := map[string]semantic.Type{}
	for _, input := range sourceFlow.Inputs {
		environment[input.Name] = typeByName(input.Type, typeInfo)
	}
	collectStatements(sourceFlow.Statements, sourceFlow.Name, typeInfo, environment, flow, constraints)
}

func collectStatements(statements []ast.Statement, flowName string, typeInfo *semantic.TypeInfo, environment map[string]semantic.Type, flow *Flow, constraints *[]Constraint) {
	for _, statement := range statements {
		switch statement.Kind {
		case "if":
			*constraints = append(*constraints, Constraint{Flow: flowName, Kind: "failure", Expression: expressionString(statement.Condition), Failure: statement.Failure, Location: location(statement.Location)})
		case "conditional":
			collectStatements(statement.Statements, flowName, typeInfo, cloneTypes(environment), flow, constraints)
		case "atomic":
			collectStatements(statement.Statements, flowName, typeInfo, cloneTypes(environment), flow, constraints)
		case "calculate":
			if inferred := inferModelExpression(statement.Expression, environment, typeInfo); inferred.Kind != "unknown" {
				environment[statement.Name] = inferred
			}
		case "create":
			environment[statement.Name] = objectType(statement.ObjectName, typeInfo)
			for _, assignment := range statement.Assignments {
				if assignment.Target != nil && assignment.Target.Kind == "member" {
					flow.StateWrites = append(flow.StateWrites, StateWrite{Entity: statement.ObjectName, Field: assignment.Target.Property, Location: location(assignment.Location)})
				}
			}
			if statement.Failure != "" {
				*constraints = append(*constraints, Constraint{Flow: flowName, Kind: "failure", Failure: statement.Failure, Location: location(statement.Location)})
			}
		case "query":
			environment[statement.Name] = objectType(statement.ObjectName, typeInfo)
			if statement.Failure != "" {
				*constraints = append(*constraints, Constraint{Flow: flowName, Kind: "failure", Expression: expressionString(statement.Condition), Failure: statement.Failure, Location: location(statement.Location)})
			}
		case "change":
			if statement.Target != nil && statement.Target.Kind == "member" {
				entity := rootObjectName(statement.Target.Object, environment)
				flow.StateWrites = append(flow.StateWrites, StateWrite{Entity: entity, Field: statement.Target.Property, Location: location(statement.Location)})
			}
		case "execute":
			flow.Calls = append(flow.Calls, FlowCall{FlowName: statement.FlowName, Location: location(statement.Location)})
			if typeInfo != nil {
				if signature, ok := typeInfo.FlowSignatures[statement.FlowName]; ok {
					for index, name := range statement.Outputs {
						if index < len(signature.Output.Fields) {
							environment[name] = typeFromAST(signature.Output.Fields[index].Type, typeInfo)
						}
					}
				}
			}
		}
	}
}

func inferModelExpression(expression *ast.Expr, environment map[string]semantic.Type, typeInfo *semantic.TypeInfo) semantic.Type {
	if expression == nil {
		return semantic.Type{Kind: "unknown"}
	}
	switch expression.Kind {
	case "integer-literal":
		return semantic.Type{Kind: "integer"}
	case "money-literal":
		return semantic.Type{Kind: "money", Currency: expression.Currency, Unit: expression.Unit, Scale: expression.Scale}
	case "duration-literal":
		return semantic.Type{Kind: "duration"}
	case "reference":
		if resolved, ok := environment[expression.Name]; ok {
			return resolved
		}
		if typeInfo != nil {
			for _, valueType := range typeInfo.ValueTypes {
				for _, value := range valueType.Values {
					if value == expression.Name {
						return valueType
					}
				}
			}
		}
	case "member":
		container := inferModelExpression(expression.Object, environment, typeInfo)
		for _, field := range container.Fields {
			if field.Name == expression.Property {
				return typeFromAST(field.Type, typeInfo)
			}
		}
	case "unary":
		return semantic.Type{Kind: "boolean"}
	default:
		left := inferModelExpression(expression.Left, environment, typeInfo)
		right := inferModelExpression(expression.Right, environment, typeInfo)
		if expression.Operator == "and" || expression.Operator == "or" || strings.Contains("== != > >= < <=", expression.Operator) {
			return semantic.Type{Kind: "boolean"}
		}
		if expression.Operator == "*" && left.Kind == "money" && right.Kind == "integer" {
			return left
		}
		if expression.Operator == "*" && left.Kind == "integer" && right.Kind == "money" {
			return right
		}
		if left.Kind != "unknown" && left.Kind == right.Kind {
			return left
		}
	}
	return semantic.Type{Kind: "unknown"}
}

func expressionString(expression *ast.Expr) string {
	if expression == nil {
		return ""
	}
	switch expression.Kind {
	case "reference":
		return expression.Name
	case "integer-literal":
		return fmt.Sprintf("%d", expression.Number)
	case "money-literal":
		return expression.Value + " " + expression.Unit
	case "duration-literal":
		return fmt.Sprintf("%dms", expression.Milliseconds)
	case "member":
		return expressionString(expression.Object) + "." + expression.Property
	case "unary":
		return expression.Operator + " " + expressionString(expression.Expression)
	default:
		return "(" + expressionString(expression.Left) + " " + expression.Operator + " " + expressionString(expression.Right) + ")"
	}
}

func resolveType(typeRef ast.TypeRef, typeInfo *semantic.TypeInfo) semantic.Type {
	if typeInfo == nil {
		return typeFromAST(typeRef, typeInfo)
	}
	if typeRef.Kind == "named" {
		if resolved, ok := typeInfo.ObjectTypes[typeRef.Name]; ok {
			return resolved
		}
		if resolved, ok := typeInfo.ValueTypes[typeRef.Name]; ok {
			return resolved
		}
	}
	return typeFromAST(typeRef, typeInfo)
}

func typeByName(typeRef ast.TypeRef, typeInfo *semantic.TypeInfo) semantic.Type {
	return resolveType(typeRef, typeInfo)
}

func typeFromAST(typeRef ast.TypeRef, typeInfo *semantic.TypeInfo) semantic.Type {
	result := semantic.Type{Kind: typeRef.Kind, Name: typeRef.Name, Currency: typeRef.Currency, Unit: typeRef.Unit, Scale: typeRef.Scale, Values: append([]string(nil), typeRef.Values...)}
	if typeInfo != nil && typeRef.Kind == "named" {
		if resolved, ok := typeInfo.ObjectTypes[typeRef.Name]; ok {
			return resolved
		}
		if resolved, ok := typeInfo.ValueTypes[typeRef.Name]; ok {
			return resolved
		}
	}
	return result
}

func objectType(name string, typeInfo *semantic.TypeInfo) semantic.Type {
	if typeInfo != nil {
		if resolved, ok := typeInfo.ObjectTypes[name]; ok {
			return resolved
		}
	}
	return semantic.Type{Kind: "object", Name: name}
}

func rootObjectName(expression *ast.Expr, environment map[string]semantic.Type) string {
	for expression != nil && expression.Kind == "member" {
		expression = expression.Object
	}
	if expression != nil && expression.Kind == "reference" {
		if resolved, ok := environment[expression.Name]; ok && resolved.Kind == "object" {
			return resolved.Name
		}
	}
	return ""
}

func cloneTypes(environment map[string]semantic.Type) map[string]semantic.Type {
	clone := make(map[string]semantic.Type, len(environment))
	for name, typeRef := range environment {
		clone[name] = typeRef
	}
	return clone
}

func cloneFields(fields []Field) []Field {
	return append([]Field(nil), fields...)
}

func cloneStateWrites(writes []StateWrite) []StateWrite {
	return append([]StateWrite(nil), writes...)
}

func location(value ast.Location) Location {
	return Location{File: value.File, Line: value.Line, Column: value.Column}
}
