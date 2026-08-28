package parser

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/myczh-1/determinant/internal/ast"
	"github.com/myczh-1/determinant/internal/diagnostics"
	"github.com/myczh-1/determinant/internal/language"
	"github.com/myczh-1/determinant/internal/lexer"
)

type sourceLine struct {
	number  int
	text    string
	indent  int
	content string
}

type ParseResult struct {
	Program     *ast.Program
	Diagnostics []diagnostics.Diagnostic
}

type Parser struct {
	lines []sourceLine
	file  string
	diags []diagnostics.Diagnostic
}

func Parse(source string, lang language.Language, file string) ParseResult {
	source = language.NormalizeSource(source, lang)
	parts := strings.Split(source, "\n")
	p := &Parser{file: file, lines: make([]sourceLine, 0, len(parts))}
	for index, text := range parts {
		p.lines = append(p.lines, makeSourceLine(text, index+1))
	}
	return p.parse()
}

func (p *Parser) parse() ParseResult {
	meaningful := p.meaningfulIndices()
	if len(meaningful) == 0 {
		p.error("AAL1001", "AAL source cannot be empty", 1, 1)
		return ParseResult{Diagnostics: p.diags}
	}
	first := p.lines[meaningful[0]]
	if first.indent != 0 || !strings.HasPrefix(first.content, "应用：") {
		p.error("AAL1002", "AAL source must start with application: Name", first.number, first.indent+1)
		return ParseResult{Diagnostics: p.diags}
	}
	name := strings.TrimSpace(strings.TrimPrefix(first.content, "应用："))
	if !isIdentifier(name) {
		p.error("AAL1003", "application name must be a non-empty identifier", first.number, 4)
	}
	program := &ast.Program{Name: name, Location: p.location(first.number, 1)}
	index := meaningful[0] + 1
	for index < len(p.lines) {
		line := p.lines[index]
		if p.ignorable(line) {
			index++
			continue
		}
		if line.indent != 0 {
			p.error("AAL1004", "top-level declarations must start in column 1", line.number, line.indent+1)
			index++
			continue
		}
		switch {
		case strings.HasPrefix(line.content, "取值："):
			value, next := p.parseValueSet(index)
			if value != nil {
				program.ValueSets = append(program.ValueSets, *value)
			}
			index = next
		case strings.HasPrefix(line.content, "对象："):
			object, next := p.parseObject(index)
			if object != nil {
				program.Objects = append(program.Objects, *object)
			}
			index = next
		case strings.HasPrefix(line.content, "流程："):
			flow, next := p.parseFlow(index)
			if flow != nil {
				program.Flows = append(program.Flows, *flow)
			}
			index = next
		case strings.HasPrefix(line.content, "HTTP 入口："):
			entry, next := p.parseHTTPEntry(index)
			if entry != nil {
				program.HTTPEntries = append(program.HTTPEntries, *entry)
			}
			index = next
		default:
			p.error("AAL1005", "unknown top-level declaration: "+line.content, line.number, 1)
			index++
		}
	}
	if len(program.Objects) == 0 {
		p.error("AAL1006", "the program must declare at least one object", first.number, 1)
	}
	if len(program.Flows) == 0 {
		p.error("AAL1007", "the program must declare at least one flow", first.number, 1)
	}
	return ParseResult{Program: program, Diagnostics: p.diags}
}

func (p *Parser) parseValueSet(start int) (*ast.ValueSet, int) {
	header := p.lines[start]
	name := strings.TrimSpace(strings.TrimPrefix(header.content, "取值："))
	if !isIdentifier(name) {
		p.error("AAL1010", "value set name must be an identifier", header.number, 4)
		return nil, start + 1
	}
	items, next := p.parseNameList(start+1, 4, "value set")
	values := make([]ast.Value, 0, len(items))
	for _, item := range items {
		if !isIdentifier(item.text) {
			p.error("AAL1011", "value member must be an identifier", item.line, item.column)
			continue
		}
		values = append(values, ast.Value{Name: item.text, Location: p.location(item.line, item.column)})
	}
	return &ast.ValueSet{Name: name, Values: values, Location: p.location(header.number, 1)}, next
}

func (p *Parser) parseObject(start int) (*ast.Object, int) {
	header := p.lines[start]
	name := strings.TrimSpace(strings.TrimPrefix(header.content, "对象："))
	if !isIdentifier(name) {
		p.error("AAL1020", "object name must be an identifier", header.number, 4)
		return nil, start + 1
	}
	object := &ast.Object{Name: name, Location: p.location(header.number, 1)}
	index := start + 1
	for index < len(p.lines) {
		line := p.lines[index]
		if p.ignorable(line) {
			index++
			continue
		}
		if line.indent == 0 {
			break
		}
		if line.indent != 4 {
			p.error("AAL1021", "object members must be indented by 4 spaces", line.number, line.indent+1)
			index++
			continue
		}
		if line.content == "身份：" {
			items, next := p.parseNameList(index+1, 8, "identity")
			for _, item := range items {
				if !isIdentifier(item.text) {
					p.error("AAL1022", "identity field must be an identifier", item.line, item.column)
				} else {
					object.IdentityFields = append(object.IdentityFields, item.text)
				}
			}
			index = next
			continue
		}
		separator := strings.Index(line.content, "：")
		if separator < 1 {
			p.error("AAL1023", "object field format must be 'name: type'", line.number, line.indent+1)
			index++
			continue
		}
		fieldName := strings.TrimSpace(line.content[:separator])
		typeText := strings.TrimSpace(line.content[separator+len("："):])
		typeRef := p.parseType(typeText, line, p.contentColumn(line, typeText))
		if !isIdentifier(fieldName) {
			p.error("AAL1024", "object field name must be an identifier", line.number, line.indent+1)
		} else if typeRef != nil {
			object.Fields = append(object.Fields, ast.Field{Name: fieldName, Type: *typeRef, Location: p.location(line.number, line.indent+1)})
		}
		index++
	}
	if len(object.Fields) == 0 {
		p.error("AAL1025", "an object must have at least one field", header.number, 1)
	}
	return object, index
}

func (p *Parser) parseFlow(start int) (*ast.Flow, int) {
	header := p.lines[start]
	name := strings.TrimSpace(strings.TrimPrefix(header.content, "流程："))
	if !isIdentifier(name) {
		p.error("AAL1030", "flow name must be an identifier", header.number, 4)
		return nil, start + 1
	}
	flow := &ast.Flow{Name: name, Location: p.location(header.number, 1)}
	index := start + 1
	for index < len(p.lines) {
		line := p.lines[index]
		if p.ignorable(line) {
			index++
			continue
		}
		if line.indent == 0 {
			break
		}
		if line.indent != 4 {
			p.error("AAL1031", "flow members must be indented by 4 spaces", line.number, line.indent+1)
			index++
			continue
		}
		switch line.content {
		case "输入：":
			fields, next := p.parseTypedBlock(index+1, 8, "flow input")
			flow.Inputs = append(flow.Inputs, fields...)
			index = next
		case "输出：":
			outputs, next := p.parseOutputs(index + 1)
			flow.Outputs = append(flow.Outputs, outputs...)
			index = next
		default:
			statements, next := p.parseFlowStatement(index, 4)
			flow.Statements = append(flow.Statements, statements...)
			index = next
		}
	}
	if len(flow.Outputs) == 0 {
		p.error("AAL1032", "a flow must contain an output section", header.number, 1)
	}
	return flow, index
}

func (p *Parser) parseFlowStatement(start, expectedIndent int) ([]ast.Statement, int) {
	line := p.lines[start]
	if line.indent != expectedIndent {
		p.error("AAL1040", fmt.Sprintf("flow statement must be indented by %d spaces", expectedIndent), line.number, line.indent+1)
		return nil, start + 1
	}
	if strings.HasPrefix(line.content, "如果 ") && strings.HasSuffix(line.content, "：") {
		statement, next := p.parseIf(start)
		if statement == nil {
			return nil, next
		}
		return []ast.Statement{*statement}, next
	}
	if line.content == "同时生效：" {
		statements, next := p.parseStatementBlock(start+1, expectedIndent+4)
		if len(statements) == 0 {
			p.error("AAL1041", "atomic block must contain at least one business step", line.number, line.indent+1)
			return nil, next
		}
		return []ast.Statement{{Kind: "atomic", Statements: statements, Location: p.location(line.number, line.indent+1)}}, next
	}
	if line.content == "计算：" || line.content == "改变：" {
		assignments, next := p.parseAssignments(start+1, expectedIndent+4, line.content[:len(line.content)-len("：")])
		statements := make([]ast.Statement, 0, len(assignments))
		for _, assignment := range assignments {
			if line.content == "计算：" {
				statements = append(statements, ast.Statement{Kind: "calculate", Name: assignment.Name, Expression: assignment.Expression, Location: assignment.Location})
			} else {
				statements = append(statements, ast.Statement{Kind: "change", Target: assignment.Target, Expression: assignment.Expression, Location: assignment.Location})
			}
		}
		return statements, next
	}
	if line.content == "执行：" {
		statement, next := p.parseExecute(start+1, expectedIndent+4)
		if statement == nil {
			return nil, next
		}
		return []ast.Statement{*statement}, next
	}
	if line.content == "创建：" {
		statement, next := p.parseCreate(start+1, expectedIndent+4)
		if statement == nil {
			return nil, next
		}
		return []ast.Statement{*statement}, next
	}
	if line.content == "查询：" {
		statement, next := p.parseQuery(start+1, expectedIndent+4)
		if statement == nil {
			return nil, next
		}
		return []ast.Statement{*statement}, next
	}
	if line.content == "删除：" {
		statement, next := p.parseDelete(start+1, expectedIndent+4)
		if statement == nil {
			return nil, next
		}
		return []ast.Statement{*statement}, next
	}
	p.error("AAL1042", "unknown flow statement: "+line.content, line.number, line.indent+1)
	return nil, start + 1
}

func (p *Parser) parseStatementBlock(start, expectedIndent int) ([]ast.Statement, int) {
	statements := make([]ast.Statement, 0)
	index := start
	for index < len(p.lines) {
		line := p.lines[index]
		if p.ignorable(line) {
			index++
			continue
		}
		if line.indent < expectedIndent {
			break
		}
		parsed, next := p.parseFlowStatement(index, expectedIndent)
		statements = append(statements, parsed...)
		index = next
	}
	return statements, index
}

func (p *Parser) parseIf(start int) (*ast.Statement, int) {
	line := p.lines[start]
	conditionText := strings.TrimSpace(strings.TrimSuffix(strings.TrimPrefix(line.content, "如果 "), "："))
	condition := p.parseExpression(conditionText, line.number, p.contentColumn(line, conditionText))
	childIndent := line.indent + 4
	childIndex := p.nextMeaningful(start + 1)
	if childIndex < 0 || p.lines[childIndex].indent != childIndent {
		p.error("AAL1043", fmt.Sprintf("if statement must contain an indented %d-space business step", childIndent), line.number, line.indent+1)
		return nil, start + 1
	}
	child := p.lines[childIndex]
	if strings.HasPrefix(child.content, "失败：") {
		message := strings.TrimSpace(strings.TrimPrefix(child.content, "失败："))
		if message == "" {
			p.error("AAL1044", "failure message cannot be empty", child.number, child.indent+1)
		}
		if condition == nil {
			return nil, childIndex + 1
		}
		return &ast.Statement{Kind: "if", Condition: condition, Failure: message, Location: p.location(line.number, line.indent+1)}, childIndex + 1
	}
	statements, next := p.parseStatementBlock(childIndex, childIndent)
	if len(statements) == 0 {
		p.error("AAL1045", "conditional business step cannot be empty", line.number, line.indent+1)
	}
	if condition == nil {
		return nil, next
	}
	return &ast.Statement{Kind: "conditional", Condition: condition, Statements: statements, Location: p.location(line.number, line.indent+1)}, next
}

func (p *Parser) parseAssignments(start, expectedIndent int, label string) ([]ast.Assignment, int) {
	assignments := make([]ast.Assignment, 0)
	index := start
	for index < len(p.lines) {
		line := p.lines[index]
		if p.ignorable(line) {
			index++
			continue
		}
		if line.indent < expectedIndent {
			break
		}
		if line.indent != expectedIndent {
			p.error("AAL1046", fmt.Sprintf("%s content must be indented by %d spaces", label, expectedIndent), line.number, line.indent+1)
			index++
			continue
		}
		separator := strings.Index(line.content, "=")
		if separator < 1 {
			p.error("AAL1047", fmt.Sprintf("%s format must be 'name = expression'", label), line.number, line.indent+1)
			index++
			continue
		}
		leftText := strings.TrimSpace(line.content[:separator])
		rightText := strings.TrimSpace(line.content[separator+1:])
		left := p.parseExpression(leftText, line.number, p.contentColumn(line, leftText))
		right := p.parseExpression(rightText, line.number, p.contentColumn(line, rightText))
		if left != nil && right != nil {
			name := ""
			if left.Kind == "reference" {
				name = left.Name
			}
			assignments = append(assignments, ast.Assignment{Name: name, Target: left, Expression: right, Location: p.location(line.number, line.indent+1)})
		}
		index++
	}
	if len(assignments) == 0 {
		line := p.lines[maxInt(0, start-1)]
		p.error("AAL1048", label+" must contain at least one item", line.number, 1)
	}
	return assignments, index
}

func (p *Parser) parseExecute(start, expectedIndent int) (*ast.Statement, int) {
	index := p.nextMeaningful(start)
	if index < 0 || p.lines[index].indent != expectedIndent || !isIdentifier(p.lines[index].content) {
		line := p.lines[maxInt(0, start-1)]
		p.error("AAL1050", "execute must first specify a flow name", line.number, 1)
		return nil, start
	}
	flowLine := p.lines[index]
	flowName := flowLine.content
	index++
	inputs := make([]*ast.Expr, 0)
	outputs := make([]string, 0)
	for index < len(p.lines) {
		line := p.lines[index]
		if p.ignorable(line) {
			index++
			continue
		}
		if line.indent < expectedIndent {
			break
		}
		if line.indent != expectedIndent {
			p.error("AAL1051", fmt.Sprintf("execute content must be indented by %d spaces", expectedIndent), line.number, line.indent+1)
			index++
			continue
		}
		if line.content == "使用：" || line.content == "得到：" {
			label := "use"
			if line.content == "得到：" {
				label = "get"
			}
			items, next := p.parseNameList(index+1, expectedIndent+4, label)
			for _, item := range items {
				if line.content == "使用：" {
					expression := p.parseExpression(item.text, item.line, item.column)
					if expression != nil {
						inputs = append(inputs, expression)
					}
				} else if !isIdentifier(item.text) {
					p.error("AAL1052", "received name must be an identifier", item.line, item.column)
				} else {
					outputs = append(outputs, item.text)
				}
			}
			index = next
			continue
		}
		p.error("AAL1053", "unknown execute content: "+line.content, line.number, line.indent+1)
		index++
	}
	if len(inputs) == 0 {
		p.error("AAL1054", "execute must contain use content", flowLine.number, flowLine.indent+1)
	}
	if len(outputs) == 0 {
		p.error("AAL1055", "execute must contain get content", flowLine.number, flowLine.indent+1)
	}
	return &ast.Statement{Kind: "execute", FlowName: flowName, Inputs: inputs, Outputs: outputs, Location: p.location(flowLine.number, flowLine.indent+1)}, index
}

func (p *Parser) parseCreate(start, expectedIndent int) (*ast.Statement, int) {
	declarationIndex := p.nextMeaningful(start)
	if declarationIndex < 0 || p.lines[declarationIndex].indent != expectedIndent {
		p.error("AAL1060", "create must first declare 'name: object type'", p.lines[maxInt(0, start-1)].number, 1)
		return nil, start
	}
	declaration := p.lines[declarationIndex]
	name, objectName, ok := p.parseNamedObject(declaration, "create")
	if !ok {
		return nil, declarationIndex + 1
	}
	index := declarationIndex + 1
	assignments := make([]ast.Assignment, 0)
	failure := ""
	for index < len(p.lines) {
		line := p.lines[index]
		if p.ignorable(line) {
			index++
			continue
		}
		if line.indent < expectedIndent {
			break
		}
		if line.indent != expectedIndent {
			p.error("AAL1061", fmt.Sprintf("create content must be indented by %d spaces", expectedIndent), line.number, line.indent+1)
			index++
			continue
		}
		if line.content == "包含：" {
			items, next := p.parseAssignments(index+1, expectedIndent+4, "create fields")
			assignments = append(assignments, items...)
			index = next
			continue
		}
		if line.content == "否则：" {
			failure, index = p.parseFailure(index+1, expectedIndent+4)
			continue
		}
		p.error("AAL1062", "unknown create content: "+line.content, line.number, line.indent+1)
		index++
	}
	if len(assignments) == 0 {
		p.error("AAL1063", "create must assign object fields", declaration.number, declaration.indent+1)
	}
	if failure == "" {
		p.error("AAL1064", "create must declare an otherwise failure", declaration.number, declaration.indent+1)
	}
	return &ast.Statement{Kind: "create", Name: name, ObjectName: objectName, Assignments: assignments, Failure: failure, Location: p.location(declaration.number, declaration.indent+1)}, index
}

func (p *Parser) parseQuery(start, expectedIndent int) (*ast.Statement, int) {
	declarationIndex := p.nextMeaningful(start)
	if declarationIndex < 0 || p.lines[declarationIndex].indent != expectedIndent {
		p.error("AAL1070", "query must first declare 'name: object type'", p.lines[maxInt(0, start-1)].number, 1)
		return nil, start
	}
	declaration := p.lines[declarationIndex]
	name, objectName, ok := p.parseNamedObject(declaration, "query")
	if !ok {
		return nil, declarationIndex + 1
	}
	index := declarationIndex + 1
	var condition *ast.Expr
	failure := ""
	for index < len(p.lines) {
		line := p.lines[index]
		if p.ignorable(line) {
			index++
			continue
		}
		if line.indent < expectedIndent {
			break
		}
		if line.indent != expectedIndent {
			p.error("AAL1071", fmt.Sprintf("query content must be indented by %d spaces", expectedIndent), line.number, line.indent+1)
			index++
			continue
		}
		if line.content == "条件：" {
			items, next := p.parseNameList(index+1, expectedIndent+4, "query condition")
			if len(items) != 1 {
				p.error("AAL1072", "the MVP query must contain exactly one condition", line.number, line.indent+1)
			}
			if len(items) > 0 {
				condition = p.parseExpression(items[0].text, items[0].line, items[0].column)
			}
			index = next
			continue
		}
		if line.content == "否则：" {
			failure, index = p.parseFailure(index+1, expectedIndent+4)
			continue
		}
		p.error("AAL1073", "unknown query content: "+line.content, line.number, line.indent+1)
		index++
	}
	if condition == nil {
		p.error("AAL1074", "query must contain a condition", declaration.number, declaration.indent+1)
	}
	if failure == "" {
		p.error("AAL1075", "query must declare an otherwise failure", declaration.number, declaration.indent+1)
	}
	if condition == nil {
		return nil, index
	}
	return &ast.Statement{Kind: "query", Name: name, ObjectName: objectName, Condition: condition, Failure: failure, Location: p.location(declaration.number, declaration.indent+1)}, index
}

func (p *Parser) parseDelete(start, expectedIndent int) (*ast.Statement, int) {
	items, next := p.parseNameList(start, expectedIndent, "delete")
	if len(items) != 1 {
		line := p.lines[maxInt(0, start-1)]
		p.error("AAL1080", "the MVP delete must specify exactly one object", line.number, 1)
	}
	if len(items) == 0 {
		return nil, next
	}
	expression := p.parseExpression(items[0].text, items[0].line, items[0].column)
	if expression == nil {
		return nil, next
	}
	return &ast.Statement{Kind: "delete", Expression: expression, Location: expression.Location}, next
}

func (p *Parser) parseNamedObject(line sourceLine, label string) (string, string, bool) {
	separator := strings.Index(line.content, "：")
	if separator <= 0 {
		p.error("AAL1081", label+" format must be 'name: object type'", line.number, line.indent+1)
		return "", "", false
	}
	name := strings.TrimSpace(line.content[:separator])
	objectName := strings.TrimSpace(line.content[separator+len("："):])
	if !isIdentifier(name) || !isIdentifier(objectName) {
		p.error("AAL1081", label+" format must be 'name: object type'", line.number, line.indent+1)
		return "", "", false
	}
	return name, objectName, true
}

func (p *Parser) parseFailure(start, expectedIndent int) (string, int) {
	index := p.nextMeaningful(start)
	if index < 0 || p.lines[index].indent != expectedIndent || !strings.HasPrefix(p.lines[index].content, "失败：") {
		p.error("AAL1082", fmt.Sprintf("otherwise must contain an indented %d-space failure message", expectedIndent), p.lines[maxInt(0, start-1)].number, 1)
		return "", start
	}
	line := p.lines[index]
	message := strings.TrimSpace(strings.TrimPrefix(line.content, "失败："))
	if message == "" {
		p.error("AAL1044", "failure message cannot be empty", line.number, line.indent+1)
	}
	return message, index + 1
}

func (p *Parser) parseHTTPEntry(start int) (*ast.HTTPEntry, int) {
	header := p.lines[start]
	name := strings.TrimSpace(strings.TrimPrefix(header.content, "HTTP 入口："))
	if name == "" {
		p.error("AAL1090", "HTTP entry name cannot be empty", header.number, header.indent+1)
	}
	method := ""
	path := ""
	targetFlow := ""
	successStatus := 0
	bodyMappings := make([]ast.HTTPFieldMapping, 0)
	pathMappings := make([]ast.HTTPFieldMapping, 0)
	systemMappings := make([]ast.HTTPSystemMapping, 0)
	failureMappings := make([]ast.HTTPFailureMapping, 0)
	index := start + 1
	for index < len(p.lines) {
		line := p.lines[index]
		if p.ignorable(line) {
			index++
			continue
		}
		if line.indent == 0 {
			break
		}
		if line.indent != 4 {
			p.error("AAL1091", "HTTP entry members must be indented by 4 spaces", line.number, line.indent+1)
			index++
			continue
		}
		switch {
		case line.content == "接收：":
			item := p.nextMeaningful(index + 1)
			if item < 0 || p.lines[item].indent != 8 {
				p.error("AAL1092", "receive format must be 'GET /path'", line.number, line.indent+1)
				index++
				continue
			}
			match := regexp.MustCompile(`^(GET|POST|PUT|DELETE)\s+(\/\S*)$`).FindStringSubmatch(p.lines[item].content)
			if len(match) != 3 {
				p.error("AAL1092", "receive format must be 'GET /path'", p.lines[item].number, p.lines[item].indent+1)
			} else {
				method, path = match[1], match[2]
			}
			index = item + 1
		case line.content == "使用流程：":
			item := p.nextMeaningful(index + 1)
			if item < 0 || p.lines[item].indent != 8 || !isIdentifier(p.lines[item].content) {
				p.error("AAL1093", "use flow must specify a flow name", line.number, line.indent+1)
			} else {
				targetFlow = p.lines[item].content
			}
			if item >= 0 {
				index = item + 1
			} else {
				index++
			}
		case line.content == "请求体：" || line.content == "请求路径：":
			items, next := p.parseNameList(index+1, 8, "HTTP mapping")
			for _, item := range items {
				mapping := p.parseHTTPMapping(item.text, item.line, item.column)
				if mapping != nil {
					if line.content == "请求体：" {
						bodyMappings = append(bodyMappings, *mapping)
					} else {
						pathMappings = append(pathMappings, *mapping)
					}
				}
			}
			index = next
		case line.content == "系统提供：":
			items, next := p.parseNameList(index+1, 8, "system mapping")
			for _, item := range items {
				mapping := p.parseHTTPSystemMapping(item.text, item.line, item.column)
				if mapping != nil {
					systemMappings = append(systemMappings, *mapping)
				}
			}
			index = next
		case line.content == "成功：":
			successStatus, index = p.parseReturnStatus(index + 1)
		case strings.HasPrefix(line.content, "如果 ") && strings.HasSuffix(line.content, "："):
			message := strings.TrimSpace(strings.TrimSuffix(strings.TrimPrefix(line.content, "如果 "), "："))
			status, next := p.parseReturnStatus(index + 1)
			if message == "" {
				p.error("AAL1094", "HTTP failure message cannot be empty", line.number, line.indent+1)
			} else {
				failureMappings = append(failureMappings, ast.HTTPFailureMapping{Failure: message, Status: status, Location: p.location(line.number, line.indent+1)})
			}
			index = next
		default:
			p.error("AAL1095", "unknown HTTP entry content: "+line.content, line.number, line.indent+1)
			index++
		}
	}
	if method == "" || path == "" {
		p.error("AAL1096", "HTTP entry must contain receive", header.number, header.indent+1)
	}
	if targetFlow == "" {
		p.error("AAL1097", "HTTP entry must contain use flow", header.number, header.indent+1)
	}
	if successStatus == 0 {
		p.error("AAL1098", "HTTP entry must contain a success status", header.number, header.indent+1)
	}
	if name == "" || method == "" || path == "" || targetFlow == "" || successStatus == 0 {
		return nil, index
	}
	return &ast.HTTPEntry{Name: name, Method: method, Path: path, TargetFlow: targetFlow, BodyMappings: bodyMappings, PathMappings: pathMappings, SystemMappings: systemMappings, SuccessStatus: successStatus, FailureMappings: failureMappings, Location: p.location(header.number, header.indent+1)}, index
}

func (p *Parser) parseHTTPSystemMapping(text string, line, column int) *ast.HTTPSystemMapping {
	match := regexp.MustCompile(`^当前时间\s+作为\s+([\p{L}_][\p{L}\p{N}_]*)$`).FindStringSubmatch(text)
	if len(match) != 2 {
		p.error("AAL1099", "system mapping format must be 'current time as input name'", line, column)
		return nil
	}
	return &ast.HTTPSystemMapping{Source: "current-time", TargetName: match[1], Location: p.location(line, column)}
}

func (p *Parser) parseHTTPMapping(text string, line, column int) *ast.HTTPFieldMapping {
	parts := regexp.MustCompile(`\s+作为\s+`).Split(text, -1)
	if len(parts) > 2 || len(parts) == 0 || !isIdentifier(parts[0]) || (len(parts) == 2 && !isIdentifier(parts[1])) {
		p.error("AAL1100", "HTTP mapping format must be 'field' or 'external field as input field'", line, column)
		return nil
	}
	target := parts[0]
	if len(parts) == 2 {
		target = parts[1]
	}
	return &ast.HTTPFieldMapping{SourceName: parts[0], TargetName: target, Location: p.location(line, column)}
}

func (p *Parser) parseReturnStatus(start int) (int, int) {
	index := p.nextMeaningful(start)
	if index < 0 || p.lines[index].indent != 8 {
		p.error("AAL1102", "HTTP status must be an indented 'return 200'", p.lines[maxInt(0, start-1)].number, 1)
		return 0, start
	}
	match := regexp.MustCompile(`^返回\s+(\d{3})$`).FindStringSubmatch(p.lines[index].content)
	if len(match) != 2 {
		p.error("AAL1102", "HTTP status must be an indented 'return 200'", p.lines[index].number, p.lines[index].indent+1)
		return 0, start
	}
	status, _ := strconv.Atoi(match[1])
	return status, index + 1
}

func (p *Parser) parseOutputs(start int) ([]ast.Output, int) {
	outputs := make([]ast.Output, 0)
	index := start
	for index < len(p.lines) {
		line := p.lines[index]
		if p.ignorable(line) {
			index++
			continue
		}
		if line.indent < 8 {
			break
		}
		if line.indent != 8 {
			p.error("AAL1110", "output content must be indented by 8 spaces", line.number, line.indent+1)
			index++
			continue
		}
		separator := strings.Index(line.content, "=")
		name := strings.TrimSpace(line.content)
		expressionText := name
		if separator > 0 {
			name = strings.TrimSpace(line.content[:separator])
			expressionText = strings.TrimSpace(line.content[separator+1:])
		}
		expression := p.parseExpression(expressionText, line.number, p.contentColumn(line, expressionText))
		if !isIdentifier(name) {
			p.error("AAL1111", "output name must be an identifier", line.number, line.indent+1)
		} else if expression != nil {
			outputs = append(outputs, ast.Output{Name: name, Expression: expression, Location: p.location(line.number, line.indent+1)})
		}
		index++
	}
	return outputs, index
}

func (p *Parser) parseTypedBlock(start, expectedIndent int, label string) ([]ast.Field, int) {
	fields := make([]ast.Field, 0)
	index := start
	for index < len(p.lines) {
		line := p.lines[index]
		if p.ignorable(line) {
			index++
			continue
		}
		if line.indent < expectedIndent {
			break
		}
		if line.indent != expectedIndent {
			p.error("AAL1112", fmt.Sprintf("%s must be indented by %d spaces", label, expectedIndent), line.number, line.indent+1)
			index++
			continue
		}
		separator := strings.Index(line.content, "：")
		if separator < 1 {
			p.error("AAL1113", fmt.Sprintf("%s format must be 'name: type'", label), line.number, line.indent+1)
			index++
			continue
		}
		name := strings.TrimSpace(line.content[:separator])
		typeText := strings.TrimSpace(line.content[separator+len("："):])
		typeRef := p.parseType(typeText, line, p.contentColumn(line, typeText))
		if !isIdentifier(name) {
			p.error("AAL1114", fmt.Sprintf("%s name must be an identifier", label), line.number, line.indent+1)
		} else if typeRef != nil {
			fields = append(fields, ast.Field{Name: name, Type: *typeRef, Location: p.location(line.number, line.indent+1)})
		}
		index++
	}
	return fields, index
}

type nameItem struct {
	text   string
	line   int
	column int
}

func (p *Parser) parseNameList(start, expectedIndent int, label string) ([]nameItem, int) {
	items := make([]nameItem, 0)
	index := start
	for index < len(p.lines) {
		line := p.lines[index]
		if p.ignorable(line) {
			index++
			continue
		}
		if line.indent < expectedIndent {
			break
		}
		if line.indent != expectedIndent {
			p.error("AAL1115", fmt.Sprintf("%s content must be indented by %d spaces", label, expectedIndent), line.number, line.indent+1)
			index++
			continue
		}
		items = append(items, nameItem{text: line.content, line: line.number, column: line.indent + 1})
		index++
	}
	if len(items) == 0 {
		line := p.lines[maxInt(0, start-1)]
		p.error("AAL1116", label+" must contain at least one item", line.number, 1)
	}
	return items, index
}

func (p *Parser) parseType(text string, line sourceLine, column int) *ast.TypeRef {
	switch text {
	case "整数":
		return &ast.TypeRef{Kind: "integer"}
	case "文本":
		return &ast.TypeRef{Kind: "text"}
	case "布尔":
		return &ast.TypeRef{Kind: "boolean"}
	case "时间":
		return &ast.TypeRef{Kind: "time"}
	case "持续时间":
		return &ast.TypeRef{Kind: "duration"}
	}
	money := regexp.MustCompile(`^(人民币|美元)金额(?:，单位为(.+))?$`).FindStringSubmatch(text)
	if len(money) > 0 {
		currency, unit := "CNY", "yuan"
		if money[1] == "美元" {
			currency, unit = "USD", "dollar"
		}
		if len(money) > 2 && strings.TrimSpace(money[2]) != "" {
			unit = strings.TrimSpace(money[2])
			if unit == "元" {
				unit = "yuan"
			} else if unit == "美元" {
				unit = "dollar"
			}
		}
		return &ast.TypeRef{Kind: "money", Currency: currency, Unit: unit, Scale: 2}
	}
	if isIdentifier(text) {
		return &ast.TypeRef{Kind: "named", Name: text}
	}
	p.error("AAL1117", "type must be integer, text, boolean, time, duration, money, value set, or object name", line.number, column)
	return nil
}

func (p *Parser) parseExpression(text string, line, column int) *ast.Expr {
	lexerDiags := make([]diagnostics.Diagnostic, 0)
	tokens := lexer.Tokenize(text, line, column, &lexerDiags)
	for _, diag := range lexerDiags {
		diag.File = p.file
		p.diags = append(p.diags, diag)
	}
	expressionParser := &expressionParser{tokens: tokens, line: line, column: column, parser: p}
	return expressionParser.parse()
}

type expressionParser struct {
	tokens []lexer.Token
	index  int
	line   int
	column int
	parser *Parser
}

func (e *expressionParser) parse() *ast.Expr {
	if len(e.tokens) == 0 {
		e.parser.error("AAL1120", "expression cannot be empty", e.line, e.column)
		return nil
	}
	expression := e.parseOr()
	if e.index < len(e.tokens) {
		token := e.tokens[e.index]
		e.parser.error("AAL1121", "unexpected expression content: "+token.Value, e.line, token.Column)
		return nil
	}
	return expression
}

func (e *expressionParser) parseOr() *ast.Expr {
	left := e.parseAnd()
	for left != nil && e.peek(lexer.Operator, "或者") {
		e.index++
		right := e.parseAnd()
		if right == nil {
			return nil
		}
		left = &ast.Expr{Kind: "binary", Operator: "or", Left: left, Right: right, Location: e.parser.location(e.line, e.column)}
	}
	return left
}

func (e *expressionParser) parseAnd() *ast.Expr {
	left := e.parseComparison()
	for left != nil && e.peek(lexer.Operator, "并且") {
		e.index++
		right := e.parseComparison()
		if right == nil {
			return nil
		}
		left = &ast.Expr{Kind: "binary", Operator: "and", Left: left, Right: right, Location: e.parser.location(e.line, e.column)}
	}
	return left
}

func (e *expressionParser) parseComparison() *ast.Expr {
	left := e.parseAdditive()
	for left != nil && e.peekAny(lexer.Operator, ">", ">=", "<", "<=", "==", "!=") {
		op := e.tokens[e.index].Value
		e.index++
		right := e.parseAdditive()
		if right == nil {
			return nil
		}
		left = &ast.Expr{Kind: "binary", Operator: op, Left: left, Right: right, Location: e.parser.location(e.line, e.column)}
	}
	return left
}

func (e *expressionParser) parseAdditive() *ast.Expr {
	left := e.parseMultiplicative()
	for left != nil && e.peekAny(lexer.Operator, "+", "-") {
		op := e.tokens[e.index].Value
		e.index++
		right := e.parseMultiplicative()
		if right == nil {
			return nil
		}
		left = &ast.Expr{Kind: "binary", Operator: op, Left: left, Right: right, Location: e.parser.location(e.line, e.column)}
	}
	return left
}

func (e *expressionParser) parseMultiplicative() *ast.Expr {
	left := e.parseUnary()
	for left != nil && e.peekAny(lexer.Operator, "*", "/", "%") {
		op := e.tokens[e.index].Value
		e.index++
		right := e.parseUnary()
		if right == nil {
			return nil
		}
		left = &ast.Expr{Kind: "binary", Operator: op, Left: left, Right: right, Location: e.parser.location(e.line, e.column)}
	}
	return left
}

func (e *expressionParser) parseUnary() *ast.Expr {
	if e.peek(lexer.Operator, "非") {
		token := e.tokens[e.index]
		e.index++
		expression := e.parseUnary()
		if expression == nil {
			return nil
		}
		return &ast.Expr{Kind: "unary", Operator: "not", Expression: expression, Location: e.parser.location(e.line, token.Column)}
	}
	return e.parsePrimary()
}

func (e *expressionParser) parsePrimary() *ast.Expr {
	if e.index >= len(e.tokens) {
		e.parser.error("AAL1122", "expression is missing a value", e.line, e.column)
		return nil
	}
	token := e.tokens[e.index]
	var expression *ast.Expr
	switch token.Kind {
	case lexer.Money:
		e.index++
		parts := strings.Fields(token.Value)
		value := parts[0]
		currency, unit := "CNY", "yuan"
		if len(parts) > 1 && parts[1] == "美元" {
			currency, unit = "USD", "dollar"
		}
		expression = &ast.Expr{Kind: "money-literal", Value: value, Currency: currency, Unit: unit, Scale: 2, Location: e.parser.location(e.line, token.Column)}
	case lexer.Duration:
		e.index++
		days, _ := strconv.ParseInt(strings.TrimSpace(strings.TrimSuffix(token.Value, "天")), 10, 64)
		expression = &ast.Expr{Kind: "duration-literal", Milliseconds: days * 24 * 60 * 60 * 1000, Location: e.parser.location(e.line, token.Column)}
	case lexer.Number:
		e.index++
		value, _ := strconv.Atoi(token.Value)
		expression = &ast.Expr{Kind: "integer-literal", Number: value, Location: e.parser.location(e.line, token.Column)}
	case lexer.Identifier:
		e.index++
		expression = &ast.Expr{Kind: "reference", Name: token.Value, Location: e.parser.location(e.line, token.Column)}
	case lexer.LeftParen:
		e.index++
		expression = e.parseOr()
		if !e.peek(lexer.RightParen, ")") {
			e.parser.error("AAL1123", "missing closing parenthesis )", e.line, token.Column)
			return nil
		}
		e.index++
	default:
		e.parser.error("AAL1124", "expression cannot start with "+token.Value, e.line, token.Column)
		return nil
	}
	for e.peek(lexer.Identifier, "的") {
		e.index++
		if e.index >= len(e.tokens) || e.tokens[e.index].Kind != lexer.Identifier || e.tokens[e.index].Value == "的" {
			e.parser.error("AAL1125", "a field name must follow the member connector", e.line, token.Column)
			return nil
		}
		property := e.tokens[e.index]
		e.index++
		expression = &ast.Expr{Kind: "member", Object: expression, Property: property.Value, Location: e.parser.location(e.line, property.Column)}
	}
	return expression
}

func (e *expressionParser) peek(kind lexer.Kind, value string) bool {
	return e.index < len(e.tokens) && e.tokens[e.index].Kind == kind && e.tokens[e.index].Value == value
}

func (e *expressionParser) peekAny(kind lexer.Kind, values ...string) bool {
	if e.index >= len(e.tokens) || e.tokens[e.index].Kind != kind {
		return false
	}
	for _, value := range values {
		if e.tokens[e.index].Value == value {
			return true
		}
	}
	return false
}

func (p *Parser) error(code, message string, line, column int) {
	p.diags = append(p.diags, diagnostics.Diagnostic{Severity: diagnostics.Error, Code: code, Message: message, File: p.file, Line: line, Column: maxInt(1, column)})
}

func (p *Parser) location(line, column int) ast.Location {
	return ast.Location{File: p.file, Line: line, Column: maxInt(1, column)}
}

func (p *Parser) nextMeaningful(start int) int {
	for index := start; index < len(p.lines); index++ {
		if !p.ignorable(p.lines[index]) {
			return index
		}
	}
	return -1
}

func (p *Parser) meaningfulIndices() []int {
	indices := make([]int, 0)
	for index, line := range p.lines {
		if !p.ignorable(line) {
			indices = append(indices, index)
		}
	}
	return indices
}

func (p *Parser) ignorable(line sourceLine) bool {
	return line.content == "" || strings.HasPrefix(line.content, "#")
}

func (p *Parser) contentColumn(line sourceLine, content string) int {
	index := strings.Index(line.text, content)
	if index < 0 {
		return line.indent + 1
	}
	return utf8.RuneCountInString(line.text[:index]) + 1
}

func makeSourceLine(text string, number int) sourceLine {
	indent := 0
	for indent < len(text) && text[indent] == ' ' {
		indent++
	}
	content := strings.TrimSpace(text[indent:])
	return sourceLine{number: number, text: text, indent: indent, content: content}
}

func isIdentifier(value string) bool {
	return regexp.MustCompile(`^[\p{L}_][\p{L}\p{N}_]*$`).MatchString(value)
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}
