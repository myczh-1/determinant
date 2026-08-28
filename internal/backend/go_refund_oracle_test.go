package backend

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/myczh-1/determinant/internal/language"
	"github.com/myczh-1/determinant/internal/parser"
	"github.com/myczh-1/determinant/internal/semantic"
)

const oracleClock = "2026-01-08T00:00:00.000Z"

type refundFixture struct {
	Orders    []map[string]any `json:"订单"`
	Payments  []map[string]any `json:"支付记录"`
	Inventory []map[string]any `json:"商品库存"`
	Users     []map[string]any `json:"用户"`
}

type refundRequest struct {
	method   string
	path     string
	body     any
	rawBody  string
	status   int
	expected map[string]any
}

func TestGeneratedGoOrderRefundOracle(t *testing.T) {
	binary := buildRefundBinary(t)
	root := filepath.Join("..", "..")
	data, err := os.ReadFile(filepath.Join(root, "examples", "order-refund", "fixture.v1.json"))
	if err != nil {
		t.Fatal(err)
	}
	var base refundFixture
	if err := json.Unmarshal(data, &base); err != nil {
		t.Fatal(err)
	}

	run := func(t *testing.T, clock string, mutate func(*refundFixture), requests ...refundRequest) {
		t.Helper()
		fixture := cloneRefundFixture(t, base)
		if mutate != nil {
			mutate(&fixture)
		}
		fixturePath := filepath.Join(t.TempDir(), "fixture.json")
		fixtureData, err := json.Marshal(fixture)
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(fixturePath, fixtureData, 0o600); err != nil {
			t.Fatal(err)
		}
		server := startGeneratedHTTP(t, binary, fixturePath, clock)
		defer server.stop()
		for _, request := range requests {
			assertRefundResponse(t, server.client, server.baseURL, request)
		}
	}

	errorRequest := func(method, path string, body any, status int, message string) refundRequest {
		return refundRequest{method: method, path: path, body: body, status: status, expected: map[string]any{"error": message}}
	}
	outputRequest := func(method, path string, body any, status int, output map[string]any) refundRequest {
		return refundRequest{method: method, path: path, body: body, status: status, expected: output}
	}

	t.Run("pay not found wins over invalid amount", func(t *testing.T) {
		run(t, oracleClock, nil, errorRequest("POST", "/orders/999/pay", map[string]any{"amount": "-1.00"}, http.StatusNotFound, "订单不存在"))
	})
	t.Run("pay state and duplicate payment", func(t *testing.T) {
		run(t, oracleClock, nil,
			errorRequest("POST", "/orders/102/pay", map[string]any{"amount": "200.00"}, http.StatusConflict, "订单状态不允许支付"),
			outputRequest("POST", "/orders/101/pay", map[string]any{"amount": "200.00"}, http.StatusOK, map[string]any{"订单编号": float64(101), "订单状态": "已支付", "支付金额": "200.00", "支付时间": oracleClock}),
			errorRequest("POST", "/orders/101/pay", map[string]any{"amount": "200.00"}, http.StatusConflict, "订单状态不允许支付"),
		)
	})
	t.Run("pay validation and amount mismatch", func(t *testing.T) {
		run(t, oracleClock, nil,
			errorRequest("POST", "/orders/101/pay", map[string]any{"amount": "0.00"}, http.StatusBadRequest, "支付金额必须大于零"),
			errorRequest("POST", "/orders/101/pay", map[string]any{"amount": "-1.00"}, http.StatusBadRequest, "支付金额必须大于零"),
			errorRequest("POST", "/orders/101/pay", map[string]any{"amount": "100.00"}, http.StatusConflict, "支付金额与订单应付金额不一致"),
		)
	})
	t.Run("pay atomic failure leaves order available for cancel", func(t *testing.T) {
		run(t, oracleClock, func(fixture *refundFixture) {
			fixture.Payments = append(fixture.Payments, map[string]any{"订单编号": 101, "支付金额": "200.00", "支付时间": "2026-01-01T00:00:00.000Z"})
		},
			errorRequest("POST", "/orders/101/pay", map[string]any{"amount": "200.00"}, http.StatusInternalServerError, "支付数据不一致"),
			outputRequest("POST", "/orders/101/cancel", nil, http.StatusOK, map[string]any{"订单编号": float64(101), "订单状态": "已取消", "库存数量": float64(12)}),
		)
	})
	t.Run("cancel not found, paid, and idempotent", func(t *testing.T) {
		run(t, oracleClock, nil,
			errorRequest("POST", "/orders/999/cancel", nil, http.StatusNotFound, "订单不存在"),
			errorRequest("POST", "/orders/102/cancel", nil, http.StatusConflict, "订单状态不允许取消"),
			outputRequest("POST", "/orders/101/cancel", nil, http.StatusOK, map[string]any{"订单编号": float64(101), "订单状态": "已取消", "库存数量": float64(12)}),
			outputRequest("POST", "/orders/101/cancel", nil, http.StatusOK, map[string]any{"订单编号": float64(101), "订单状态": "已取消", "库存数量": float64(12)}),
		)
	})
	t.Run("cancel reports missing inventory", func(t *testing.T) {
		run(t, oracleClock, func(fixture *refundFixture) {
			fixture.Inventory = withoutID(fixture.Inventory, "商品编号", 1001)
		}, errorRequest("POST", "/orders/101/cancel", nil, http.StatusInternalServerError, "库存数据不一致"))
	})
	t.Run("refund order and state validation", func(t *testing.T) {
		run(t, oracleClock, nil,
			errorRequest("POST", "/orders/999/refund", map[string]any{"userId": 999, "amount": "-1.00", "quantity": -1}, http.StatusNotFound, "订单不存在"),
			errorRequest("POST", "/orders/101/refund", map[string]any{"userId": 1, "amount": "-1.00", "quantity": -1}, http.StatusConflict, "订单状态不允许退款"),
			errorRequest("POST", "/orders/105/refund", map[string]any{"userId": 1, "amount": "100.00", "quantity": 1}, http.StatusConflict, "订单状态不允许退款"),
		)
	})
	t.Run("refund missing payment", func(t *testing.T) {
		run(t, oracleClock, func(fixture *refundFixture) {
			fixture.Payments = withoutID(fixture.Payments, "订单编号", 102)
		}, errorRequest("POST", "/orders/102/refund", map[string]any{"userId": 999, "amount": "-1.00", "quantity": -1}, http.StatusInternalServerError, "支付数据不一致"))
	})
	t.Run("refund missing inventory", func(t *testing.T) {
		run(t, oracleClock, func(fixture *refundFixture) {
			fixture.Inventory = withoutID(fixture.Inventory, "商品编号", 1002)
		}, errorRequest("POST", "/orders/102/refund", map[string]any{"userId": 999, "amount": "-1.00", "quantity": -1}, http.StatusInternalServerError, "库存数据不一致"))
	})
	t.Run("refund missing user", func(t *testing.T) {
		run(t, oracleClock, nil, errorRequest("POST", "/orders/102/refund", map[string]any{"userId": 999, "amount": "-1.00", "quantity": -1}, http.StatusNotFound, "用户不存在"))
	})
	t.Run("refund deadline", func(t *testing.T) {
		run(t, "2026-01-07T00:00:00.000Z", nil, outputRequest("POST", "/orders/102/refund", map[string]any{"userId": 1, "amount": "100.00", "quantity": 1}, http.StatusOK, map[string]any{"订单编号": float64(102), "订单状态": "已支付", "本次退款金额": "100.00", "累计退款金额": "100.00", "本次回补数量": float64(1), "库存数量": float64(11)}))
		run(t, oracleClock, nil, outputRequest("POST", "/orders/102/refund", map[string]any{"userId": 1, "amount": "100.00", "quantity": 1}, http.StatusOK, map[string]any{"订单编号": float64(102), "订单状态": "已支付", "本次退款金额": "100.00", "累计退款金额": "100.00", "本次回补数量": float64(1), "库存数量": float64(11)}))
		run(t, "2026-01-08T00:00:00.001Z", nil, errorRequest("POST", "/orders/102/refund", map[string]any{"userId": 1, "amount": "100.00", "quantity": 1}, http.StatusForbidden, "已超过普通用户退款期限"))
	})
	t.Run("admin can refund after deadline", func(t *testing.T) {
		run(t, "2026-02-01T00:00:00.000Z", nil, outputRequest("POST", "/orders/102/refund", map[string]any{"userId": 2, "amount": "100.00", "quantity": 1}, http.StatusOK, map[string]any{"订单编号": float64(102), "订单状态": "已支付", "本次退款金额": "100.00", "累计退款金额": "100.00", "本次回补数量": float64(1), "库存数量": float64(11)}))
	})
	t.Run("refund validation priority", func(t *testing.T) {
		run(t, oracleClock, nil,
			errorRequest("POST", "/orders/102/refund", map[string]any{"userId": 1, "amount": "-1.00", "quantity": -1}, http.StatusBadRequest, "退款数量必须大于零"),
			errorRequest("POST", "/orders/102/refund", map[string]any{"userId": 1, "amount": "0.00", "quantity": 1}, http.StatusBadRequest, "退款金额必须大于零"),
			errorRequest("POST", "/orders/102/refund", map[string]any{"userId": 1, "amount": "50.00", "quantity": 1}, http.StatusBadRequest, "退款金额与退款数量不一致"),
		)
	})
	t.Run("refund quantity and amount limits", func(t *testing.T) {
		run(t, oracleClock, nil, errorRequest("POST", "/orders/102/refund", map[string]any{"userId": 1, "amount": "300.00", "quantity": 3}, http.StatusConflict, "退款数量超过可退款数量"))
		run(t, oracleClock, func(fixture *refundFixture) {
			for _, payment := range fixture.Payments {
				if payment["订单编号"] == float64(103) {
					payment["支付金额"] = "150.00"
				}
			}
		}, errorRequest("POST", "/orders/103/refund", map[string]any{"userId": 1, "amount": "100.00", "quantity": 1}, http.StatusConflict, "退款金额超过可退款金额"))
	})
	t.Run("partial refund updates state and refundable amount", func(t *testing.T) {
		run(t, oracleClock, nil,
			outputRequest("POST", "/orders/102/refund", map[string]any{"userId": 1, "amount": "100.00", "quantity": 1}, http.StatusOK, map[string]any{"订单编号": float64(102), "订单状态": "已支付", "本次退款金额": "100.00", "累计退款金额": "100.00", "本次回补数量": float64(1), "库存数量": float64(11)}),
			outputRequest("GET", "/orders/102/refundable", nil, http.StatusOK, map[string]any{"订单编号": float64(102), "可退款金额": "100.00", "可退款数量": float64(1)}),
		)
	})
	t.Run("two partial refunds reach full refund once", func(t *testing.T) {
		run(t, oracleClock, nil,
			outputRequest("POST", "/orders/103/refund", map[string]any{"userId": 1, "amount": "100.00", "quantity": 1}, http.StatusOK, map[string]any{"订单编号": float64(103), "订单状态": "已支付", "本次退款金额": "100.00", "累计退款金额": "200.00", "本次回补数量": float64(1), "库存数量": float64(21)}),
			outputRequest("POST", "/orders/103/refund", map[string]any{"userId": 1, "amount": "100.00", "quantity": 1}, http.StatusOK, map[string]any{"订单编号": float64(103), "订单状态": "已全部退款", "本次退款金额": "100.00", "累计退款金额": "300.00", "本次回补数量": float64(1), "库存数量": float64(22)}),
			errorRequest("POST", "/orders/103/refund", map[string]any{"userId": 1, "amount": "100.00", "quantity": 1}, http.StatusConflict, "订单状态不允许退款"),
		)
	})
	t.Run("exact full refund", func(t *testing.T) {
		run(t, oracleClock, nil, outputRequest("POST", "/orders/102/refund", map[string]any{"userId": 1, "amount": "200.00", "quantity": 2}, http.StatusOK, map[string]any{"订单编号": float64(102), "订单状态": "已全部退款", "本次退款金额": "200.00", "累计退款金额": "200.00", "本次回补数量": float64(2), "库存数量": float64(12)}))
	})
	t.Run("refund failure is atomic", func(t *testing.T) {
		run(t, oracleClock, nil,
			errorRequest("POST", "/orders/107/refund", map[string]any{"userId": 1, "amount": "50.00", "quantity": 1}, http.StatusBadRequest, "退款金额与退款数量不一致"),
			outputRequest("POST", "/orders/107/refund", map[string]any{"userId": 1, "amount": "100.00", "quantity": 1}, http.StatusOK, map[string]any{"订单编号": float64(107), "订单状态": "已支付", "本次退款金额": "100.00", "累计退款金额": "100.00", "本次回补数量": float64(1), "库存数量": float64(51)}),
		)
	})
	t.Run("refundable state and missing payment", func(t *testing.T) {
		run(t, oracleClock, nil,
			outputRequest("GET", "/orders/102/refundable", nil, http.StatusOK, map[string]any{"订单编号": float64(102), "可退款金额": "200.00", "可退款数量": float64(2)}),
			errorRequest("GET", "/orders/101/refundable", nil, http.StatusConflict, "订单当前不可退款"),
			errorRequest("GET", "/orders/105/refundable", nil, http.StatusConflict, "订单当前不可退款"),
			errorRequest("GET", "/orders/999/refundable", nil, http.StatusNotFound, "订单不存在"),
		)
		run(t, oracleClock, func(fixture *refundFixture) {
			fixture.Payments = withoutID(fixture.Payments, "订单编号", 102)
		}, errorRequest("GET", "/orders/102/refundable", nil, http.StatusInternalServerError, "支付数据不一致"))
	})
	t.Run("transport validation and unknown route", func(t *testing.T) {
		run(t, oracleClock, nil,
			errorRequest("POST", "/orders/101/pay", map[string]any{}, http.StatusBadRequest, "缺少字段：amount"),
			errorRequest("POST", "/orders/101/pay", map[string]any{"amount": 200}, http.StatusBadRequest, "金额格式错误：amount"),
			errorRequest("POST", "/orders/101/refund", map[string]any{"userId": "1", "amount": "100.00", "quantity": 1}, http.StatusBadRequest, "字段类型错误：userId"),
			errorRequest("POST", "/orders/101/refund", map[string]any{"userId": 1, "amount": "100.00"}, http.StatusBadRequest, "缺少字段：quantity"),
			errorRequest("GET", "/unknown", nil, http.StatusNotFound, "Not found"),
		)
	})
}

func TestGeneratedGoChineseHTTPRejectsInvalidJSON(t *testing.T) {
	binary := buildRefundBinary(t)
	root := filepath.Join("..", "..")
	fixture := filepath.Join(root, "examples", "order-refund", "fixture.v1.json")
	server := startGeneratedHTTP(t, binary, fixture, oracleClock)
	defer server.stop()
	request, err := http.NewRequest(http.MethodPost, server.baseURL+"/orders/101/pay", strings.NewReader("{bad"))
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Content-Type", "application/json")
	response, err := server.client.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected HTTP 400, got %d", response.StatusCode)
	}
	var body map[string]any
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(body, map[string]any{"error": "请求 JSON 无效"}) {
		t.Fatalf("unexpected invalid JSON response: %#v", body)
	}
}

type generatedHTTPServer struct {
	command *exec.Cmd
	client  *http.Client
	baseURL string
}

func buildRefundBinary(t *testing.T) string {
	t.Helper()
	root := filepath.Join("..", "..")
	sourcePath := filepath.Join(root, "examples", "order-refund", "app.zh-CN.aal")
	source, err := os.ReadFile(sourcePath)
	if err != nil {
		t.Fatal(err)
	}
	parsed := parser.Parse(string(source), language.Chinese, "examples/order-refund/app.zh-CN.aal")
	if len(parsed.Diagnostics) != 0 {
		t.Fatalf("parse diagnostics: %#v", parsed.Diagnostics)
	}
	typeInfo, diagnostics := semantic.Check(parsed.Program)
	if len(diagnostics) != 0 {
		t.Fatalf("semantic diagnostics: %#v", diagnostics)
	}
	generated, err := (GoBackend{Language: language.Chinese}).Generate(parsed.Program, typeInfo)
	if err != nil {
		t.Fatal(err)
	}
	directory := t.TempDir()
	generatedPath := filepath.Join(directory, "main.go")
	if err := os.WriteFile(generatedPath, []byte(generated), 0o600); err != nil {
		t.Fatal(err)
	}
	binary := filepath.Join(directory, "refund-server")
	build := exec.Command("go", "build", "-o", binary, generatedPath)
	build.Dir = directory
	build.Env = append(os.Environ(), "GO111MODULE=off")
	if output, err := build.CombinedOutput(); err != nil {
		t.Fatalf("generated Go did not build: %v\n%s", err, output)
	}
	return binary
}

func startGeneratedHTTP(t *testing.T, binary, fixture, clock string) generatedHTTPServer {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := listener.Addr().(*net.TCPAddr).Port
	_ = listener.Close()
	command := exec.Command(binary)
	command.Env = append(os.Environ(), "PORT="+strconv.Itoa(port), "DETERMINANT_FIXTURE="+fixture, "DETERMINANT_CLOCK="+clock)
	command.Stdout = io.Discard
	command.Stderr = io.Discard
	if err := command.Start(); err != nil {
		t.Fatal(err)
	}
	server := generatedHTTPServer{command: command, client: &http.Client{Timeout: 500 * time.Millisecond}, baseURL: fmt.Sprintf("http://127.0.0.1:%d", port)}
	for attempt := 0; attempt < 200; attempt++ {
		response, requestErr := server.client.Get(server.baseURL + "/orders/102/refundable")
		if requestErr == nil {
			_ = response.Body.Close()
			return server
		}
		time.Sleep(25 * time.Millisecond)
	}
	server.stop()
	t.Fatalf("generated refund server did not start")
	return generatedHTTPServer{}
}

func (server generatedHTTPServer) stop() {
	if server.command == nil || server.command.Process == nil {
		return
	}
	_ = server.command.Process.Kill()
	_, _ = server.command.Process.Wait()
}

func assertRefundResponse(t *testing.T, client *http.Client, baseURL string, request refundRequest) {
	t.Helper()
	var body io.Reader
	if request.rawBody != "" {
		body = strings.NewReader(request.rawBody)
	} else if request.body != nil {
		data, err := json.Marshal(request.body)
		if err != nil {
			t.Fatal(err)
		}
		body = bytes.NewReader(data)
	}
	httpRequest, err := http.NewRequest(request.method, baseURL+request.path, body)
	if err != nil {
		t.Fatal(err)
	}
	if request.body != nil || request.rawBody != "" {
		httpRequest.Header.Set("Content-Type", "application/json")
	}
	response, err := client.Do(httpRequest)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != request.status {
		t.Fatalf("%s %s: expected status %d, got %d", request.method, request.path, request.status, response.StatusCode)
	}
	if request.expected == nil {
		return
	}
	var actual map[string]any
	if err := json.NewDecoder(response.Body).Decode(&actual); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(actual, request.expected) {
		t.Fatalf("%s %s: expected body %#v, got %#v", request.method, request.path, request.expected, actual)
	}
}

func cloneRefundFixture(t *testing.T, fixture refundFixture) refundFixture {
	t.Helper()
	data, err := json.Marshal(fixture)
	if err != nil {
		t.Fatal(err)
	}
	var clone refundFixture
	if err := json.Unmarshal(data, &clone); err != nil {
		t.Fatal(err)
	}
	return clone
}

func withoutID(rows []map[string]any, field string, value float64) []map[string]any {
	filtered := make([]map[string]any, 0, len(rows))
	for _, row := range rows {
		if row[field] == value {
			continue
		}
		filtered = append(filtered, row)
	}
	return filtered
}
