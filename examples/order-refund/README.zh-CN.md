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
- [可组合流程阅读候选版](./app.composed-flow.zh-CN.aal)
- [冻结 Fixture](./fixture.v1.json)

## 可组合流程阅读候选版

`app.composed-flow.zh-CN.aal` 不覆盖稳定版本。它记录当前把语义密集流程拆成小型、单一职责、可组合流程的阅读候选方案。这里的“可组合流程”不是事务边界；真正的状态提交原子性仍由 `同时生效` 表达。候选版：

- 把获取上下文、检查资格、检查金额和执行改变拆成独立流程；
- 用支付、取消、退款和查询四个主流程展示组合顺序；
- 仍然只把四个主流程连接到 HTTP，内部流程不会成为 HTTP 接口；
- 多对象状态改变继续显式使用 `同时生效`，不把流程拆分和事务语义混为一谈。

稳定版包含 4 个流程、397 行；候选版包含 15 个流程、637 行。退款主流程从 102 行缩短到 72 行，具体规则被移动到 4 个有名称的小流程中。

这次改写没有追求减少总行数，而是验证首次完整审计之后，后续是否可以围绕较小的稳定语义单元降低局部审计和增量审计的难度。它不意味着语义密集流程整体已经变得容易阅读，也不保证总行数减少。它还暴露了一个当前尚未解决的语言设计限制：`执行 / 使用 / 得到` 的显式连接会明显增加主流程篇幅，不能把这个问题包装成已经解决。

可以使用同一套冻结 Oracle 比较当前可观察行为：

```bash
npm run test:order-refund:composed-flow
```

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
