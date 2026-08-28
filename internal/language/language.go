package language

import (
	"regexp"
	"strings"
)

type Language string

const (
	English Language = "en"
	Chinese Language = "zh-CN"
)

func Normalize(value string) (Language, bool) {
	if value == "" || value == "en" {
		return English, true
	}
	if value == "zh-CN" {
		return Chinese, true
	}
	return "", false
}

func NormalizeSource(source string, lang Language) string {
	source = strings.ReplaceAll(source, "\r\n", "\n")
	if lang == Chinese {
		return source
	}
	lines := strings.Split(source, "\n")
	for i, line := range lines {
		lines[i] = normalizeEnglishLine(line)
	}
	return strings.Join(lines, "\n")
}

func normalizeEnglishLine(line string) string {
	indent := leadingSpaces(line)
	content := strings.TrimSpace(line[len(indent):])
	if content == "" || strings.HasPrefix(content, "#") {
		return line
	}

	headers := []struct{ english, chinese string }{
		{"application:", "应用："},
		{"values:", "取值："},
		{"value set:", "取值："},
		{"object:", "对象："},
		{"flow:", "流程："},
		{"HTTP entry:", "HTTP 入口："},
		{"http entry:", "HTTP 入口："},
	}
	for _, header := range headers {
		if strings.HasPrefix(content, header.english) {
			return indent + header.chinese + strings.TrimSpace(strings.TrimPrefix(content, header.english))
		}
	}

	sections := map[string]string{
		"input:": "输入：", "calculate:": "计算：", "change:": "改变：", "atomic:": "同时生效：",
		"execute:": "执行：", "use:": "使用：", "get:": "得到：", "output:": "输出：", "identity:": "身份：",
		"create:": "创建：", "with:": "包含：", "otherwise:": "否则：", "query:": "查询：", "where:": "条件：",
		"delete:": "删除：", "receive:": "接收：", "use flow:": "使用流程：", "request body:": "请求体：",
		"request path:": "请求路径：", "system provided:": "系统提供：", "success:": "成功：",
	}
	if translated, ok := sections[content]; ok {
		return indent + translated
	}
	if strings.HasPrefix(content, "if ") && strings.HasSuffix(content, ":") {
		return indent + "如果 " + normalizeEnglishExpression(strings.TrimSpace(strings.TrimSuffix(strings.TrimPrefix(content, "if "), ":"))) + "："
	}
	if strings.HasPrefix(content, "failure:") {
		return indent + "失败：" + strings.TrimSpace(strings.TrimPrefix(content, "failure:"))
	}
	if strings.HasPrefix(content, "return ") {
		return indent + "返回 " + strings.TrimSpace(strings.TrimPrefix(content, "return "))
	}
	if regexp.MustCompile(`^current time\s+as\s+[\p{L}_][\p{L}\p{N}_]*$`).MatchString(content) {
		parts := strings.SplitN(content, " as ", 2)
		return indent + parts[0] + " 作为 " + parts[1]
	}
	if regexp.MustCompile(`^[\p{L}_][\p{L}\p{N}_]*\s+as\s+[\p{L}_][\p{L}\p{N}_]*$`).MatchString(content) {
		return indent + regexp.MustCompile(`\s+as\s+`).ReplaceAllString(content, " 作为 ")
	}
	if separator := strings.Index(content, ":"); separator > 0 {
		name := strings.TrimSpace(content[:separator])
		typeText := strings.TrimSpace(content[separator+1:])
		return indent + name + "：" + translateEnglishType(typeText)
	}
	return indent + normalizeEnglishExpression(content)
}

func translateEnglishType(typeText string) string {
	switch typeText {
	case "integer":
		return "整数"
	case "text":
		return "文本"
	case "boolean":
		return "布尔"
	case "time":
		return "时间"
	case "duration":
		return "持续时间"
	}
	for _, money := range []struct{ prefix, name string }{{"CNY amount", "人民币金额"}, {"USD amount", "美元金额"}} {
		if strings.HasPrefix(typeText, money.prefix) {
			unit := strings.TrimSpace(strings.TrimPrefix(typeText, money.prefix))
			unit = strings.TrimSpace(strings.TrimPrefix(unit, ", unit"))
			unit = strings.TrimSpace(strings.TrimPrefix(unit, "为"))
			if unit == "" {
				return money.name
			}
			return money.name + "，单位为" + unit
		}
	}
	return typeText
}

func normalizeEnglishExpression(expression string) string {
	expression = regexp.MustCompile(`(\d+\.\d{2})\s+CNY\b`).ReplaceAllString(expression, "$1 元")
	expression = regexp.MustCompile(`(\d+\.\d{2})\s+USD\b`).ReplaceAllString(expression, "$1 美元")
	expression = regexp.MustCompile(`\b(\d+)\s+days?\b`).ReplaceAllString(expression, "$1 天")
	expression = strings.ReplaceAll(expression, "'s ", " 的 ")
	return expression
}

func leadingSpaces(line string) string {
	count := 0
	for count < len(line) && line[count] == ' ' {
		count++
	}
	return line[:count]
}
