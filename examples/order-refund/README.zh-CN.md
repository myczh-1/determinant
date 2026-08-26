# 订单退款与库存回补

这是 Determinant 的第一个中文优先、语义密集型可运行示例。

当前状态：**第一里程碑已实现。**

业务状态机、金额、时间、角色、错误顺序和多对象改变都写在 AAL 中。Runtime 只提供通用的精确金额、UTC 时间、顺序求值、原子提交、Fixture 加载和 HTTP 传输语义。

## 文档

- [冻结业务规格 v1](./requirements.zh-CN.md)
- [AAL 语言能力增量规格 v1](./language-increment.zh-CN.md)
- [语义可见性与 Oracle 映射](./semantic-map.zh-CN.md)
- [真人审计测试表](./human-review-protocol.zh-CN.md)
- [中文 AAL 应用](./app.zh-CN.aal)
- [冻结 Fixture](./fixture.v1.json)

## 已确定边界

- 第一里程碑包含状态机、金额、角色、7 天边界、错误优先级、多对象联动和失败原子性。
- 退款请求同时提供退款金额和退款数量，库存只按退款数量回补。
- 订单创建发生在示例范围之外；冻结 fixture 中的订单已经占用库存。
- requestId 幂等属于第二里程碑，不进入第一版。
- 示例表层使用中文 AAL，但所有新增语义必须进入中英文共用 AST、检查器和运行时，不能成为中文特例。

## 自动验证

```bash
npm run test:order-refund
```

冻结 Oracle 包含 24 个测试组，覆盖 39 项跟踪语义，并包含一次真实 HTTP 服务启动验证。测试结果诊断会记录 Fixture 的 SHA-256 摘要和固定时钟。

## 运行服务

```bash
npm run demo:order-refund
```

服务固定使用 `fixture.v1.json` 和 `2026-01-08T00:00:00.000Z` 测试时钟。

```bash
curl http://127.0.0.1:3000/orders/102/refundable

curl -X POST http://127.0.0.1:3000/orders/102/refund \
  -H "Content-Type: application/json" \
  -d '{"userId":1,"amount":"100.00","quantity":1}'

curl -X POST http://127.0.0.1:3000/orders/101/pay \
  -H "Content-Type: application/json" \
  -d '{"amount":"200.00"}'
```

内存状态在服务重启后恢复为冻结 Fixture。

## 真人测试

第一轮只向参与者提供：

```text
app.zh-CN.aal
human-review-protocol.zh-CN.md
```

不要展示业务规格、语义映射、Oracle、生成代码或编译器实现。第二轮再提供规格和语义映射，用于定位 39 项语义。
