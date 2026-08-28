package lexer

import (
	"fmt"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/myczh-1/determinant/internal/diagnostics"
)

type Kind string

const (
	Number     Kind = "number"
	Money      Kind = "money"
	Duration   Kind = "duration"
	Identifier Kind = "identifier"
	Operator   Kind = "operator"
	LeftParen  Kind = "left-paren"
	RightParen Kind = "right-paren"
)

type Token struct {
	Kind   Kind
	Value  string
	Column int
}

var (
	durationPattern   = regexp.MustCompile(`^\d+\s*天`)
	moneyPattern      = regexp.MustCompile(`^\d+\.\d{2}\s*(?:元|美元)`)
	numberPattern     = regexp.MustCompile(`^\d+`)
	identifierPattern = regexp.MustCompile(`^[\p{L}_][\p{L}\p{N}_]*`)
)

func Tokenize(text string, line, column int, out *[]diagnostics.Diagnostic) []Token {
	tokens := make([]Token, 0)
	for index := 0; index < len(text); {
		width := 0
		r, size := utf8.DecodeRuneInString(text[index:])
		if r == utf8.RuneError && size == 1 {
			width = 1
		} else {
			width = size
		}
		if strings.TrimSpace(string(r)) == "" {
			index += width
			continue
		}
		tokenColumn := column + utf8.RuneCountInString(text[:index])
		rest := text[index:]
		if match := durationPattern.FindString(rest); match != "" {
			tokens = append(tokens, Token{Kind: Duration, Value: match, Column: tokenColumn})
			index += len(match)
			continue
		}
		if match := moneyPattern.FindString(rest); match != "" {
			tokens = append(tokens, Token{Kind: Money, Value: match, Column: tokenColumn})
			index += len(match)
			continue
		}
		if match := numberPattern.FindString(rest); match != "" {
			tokens = append(tokens, Token{Kind: Number, Value: match, Column: tokenColumn})
			index += len(match)
			continue
		}
		if match := identifierPattern.FindString(rest); match != "" {
			value := match
			switch value {
			case "and":
				value = "并且"
			case "or":
				value = "或者"
			case "not":
				value = "非"
			}
			kind := Identifier
			if value == "并且" || value == "或者" || value == "非" {
				kind = Operator
			}
			tokens = append(tokens, Token{Kind: kind, Value: value, Column: tokenColumn})
			index += len(match)
			continue
		}
		if len(rest) >= 2 {
			two := rest[:2]
			if two == ">=" || two == "<=" || two == "==" || two == "!=" {
				tokens = append(tokens, Token{Kind: Operator, Value: two, Column: tokenColumn})
				index += 2
				continue
			}
		}
		character := string(r)
		if strings.Contains("+-*/%><", character) {
			tokens = append(tokens, Token{Kind: Operator, Value: character, Column: tokenColumn})
			index += width
			continue
		}
		if r == '(' {
			tokens = append(tokens, Token{Kind: LeftParen, Value: character, Column: tokenColumn})
			index += width
			continue
		}
		if r == ')' {
			tokens = append(tokens, Token{Kind: RightParen, Value: character, Column: tokenColumn})
			index += width
			continue
		}
		*out = append(*out, diagnostics.Diagnostic{
			Severity: diagnostics.Error,
			Code:     "AAL1101",
			Message:  fmt.Sprintf("unrecognized expression character: %s", character),
			Line:     line,
			Column:   tokenColumn,
		})
		index += width
	}
	return tokens
}
