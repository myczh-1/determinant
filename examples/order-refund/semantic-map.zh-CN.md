# 订单退款示例：语义可见性与 Oracle 映射

状态：**已实现并由冻结 Oracle 覆盖**

本文件用于判断当前实现是在压缩业务语义，还是把语义转移到了编译器或 Runtime。每条冻结语义都必须在 AAL、语言标准或 Fixture 中拥有明确归属，并由对应 Oracle 覆盖。

## 1. 可见性分类

审计时使用四类来源：

1. **AAL 可见**：具体业务取值、守卫、计算、改变和顺序必须出现在应用 AAL 中；
2. **语言标准保证**：精确金额、顺序求值和原子提交等通用语义由语言标准定义，并由编译器测试证明；
3. **Fixture 数据**：具体订单、用户、库存和支付记录属于可复现测试输入，不属于应用规则；
4. **Runtime 私有决定**：目标数量为零。Runtime 不得根据名称或路径补充退款业务规则。

## 2. 冻结规则映射

下表中的“AAL 定位”是当前 `app.zh-CN.aal` 提供的审计锚点；“标准语义”不能替代 AAL 中的业务表达。

| 编号 | 冻结规则 | AAL 定位 | 标准语义 | Oracle 用例 |
|---|---|---|---|---|
| DOM-01 | 订单状态只有四个允许取值 | `取值：订单状态` | 领域取值封闭性 | `domain-invalid-status` |
| DOM-02 | 用户角色只有普通用户和管理员 | `取值：用户角色` | 领域取值封闭性 | `domain-invalid-role` |
| DATA-01 | 未支付订单没有支付记录 | Fixture 与支付流程 | Fixture 类型校验 | `pay-creates-payment` |
| DATA-02 | 订单购买数量在创建阶段已占用库存 | 规格与 Fixture | Fixture 摘要 | `cancel-restocks-full-quantity` |
| PAY-01 | 订单不存在优先失败 | `流程：支付订单`，第 1 个查询 | 顺序求值 | `pay-order-not-found` |
| PAY-02 | 只有未支付订单可支付 | `流程：支付订单`，第 1 个守卫 | 顺序求值 | `pay-wrong-state`、`pay-twice` |
| PAY-03 | 支付金额必须大于零 | `流程：支付订单`，第 2 个守卫 | 精确金额比较 | `pay-zero`、`pay-negative` |
| PAY-04 | 支付金额等于单价乘购买数量 | `流程：支付订单`，计算与守卫 | 精确金额乘法 | `pay-amount-mismatch` |
| PAY-05 | 支付时间来自可信操作时间 | 流程输入与 HTTP `系统提供` | 冻结时钟 | `pay-records-clock` |
| PAY-06 | 支付记录和订单状态同时生效 | `流程：支付订单`，`同时生效` | 原子提交 | `pay-success`；原子失败由语言标准测试覆盖 |
| PAY-07 | 支付不改变库存 | `流程：支付订单` 中没有库存改变 | 无隐式副作用 | `pay-inventory-unchanged` |
| CANCEL-01 | 订单不存在优先失败 | `流程：取消订单`，第 1 个查询 | 顺序求值 | `cancel-order-not-found` |
| CANCEL-02 | 未支付订单可以取消 | `流程：取消订单`，状态守卫 | 条件步骤 | `cancel-unpaid` |
| CANCEL-03 | 取消未支付订单回补全部购买数量 | `流程：取消订单`，`同时生效` | 原子提交 | `cancel-restocks-full-quantity` |
| CANCEL-04 | 已支付订单不能取消 | `流程：取消订单`，状态守卫 | 顺序求值 | `cancel-paid` |
| CANCEL-05 | 重复取消成功但不改变状态 | `流程：取消订单`，条件步骤 | 条件跳过 | `cancel-twice` |
| CANCEL-06 | 重复取消不再次回补库存 | `流程：取消订单` 中没有第二次改变 | 无隐式副作用 | `cancel-twice-inventory` |
| REFUND-01 | 订单不存在优先于退款输入错误 | `流程：退款`，第 1 个查询 | 顺序求值 | `refund-missing-order-negative-input` |
| REFUND-02 | 只有已支付订单可退款 | `流程：退款`，第 1 个守卫 | 顺序求值 | `refund-wrong-state`、`refund-after-full` |
| REFUND-03 | 支付和库存数据必须完整 | `流程：退款`，第 2、3 个查询 | 顺序求值 | `refund-missing-payment`、`refund-missing-inventory` |
| REFUND-04 | 用户必须存在 | `流程：退款`，用户查询 | 顺序求值 | `refund-user-not-found` |
| REFUND-05 | 普通用户在支付后 7 天内可退款 | `流程：退款`，期限守卫 | UTC 时间和持续时间 | `refund-normal-day-6`、`refund-normal-day-7` |
| REFUND-06 | 普通用户超过 7 天失败 | `流程：退款`，期限守卫 | UTC 时间比较 | `refund-normal-after-day-7` |
| REFUND-07 | 管理员不受 7 天限制 | `流程：退款`，角色与期限条件 | 逻辑运算 | `refund-admin-after-day-7` |
| REFUND-08 | 退款数量必须大于零 | `流程：退款`，数量守卫 | 整数比较 | `refund-zero-quantity`、`refund-negative-quantity` |
| REFUND-09 | 退款金额必须大于零 | `流程：退款`，金额守卫 | 精确金额比较 | `refund-zero-amount`、`refund-negative-amount` |
| REFUND-10 | 退款金额等于单价乘退款数量 | `流程：退款`，计算与守卫 | 精确金额乘法 | `refund-amount-quantity-mismatch` |
| REFUND-11 | 退款数量不得超过剩余数量 | `流程：退款`，数量上限守卫 | 整数运算 | `refund-quantity-exceeds` |
| REFUND-12 | 退款金额不得超过可退款金额 | `流程：退款`，金额上限守卫 | 精确金额运算 | `refund-amount-exceeds` |
| REFUND-13 | 部分退款累计金额和数量 | `流程：退款`，`同时生效` | 原子提交 | `refund-partial`、`refund-two-partials` |
| REFUND-14 | 库存只回补本次退款数量 | `流程：退款`，`同时生效` | 原子提交 | `refund-restocks-quantity` |
| REFUND-15 | 部分退款后状态保持已支付 | `流程：退款`，条件状态改变 | 条件步骤 | `refund-partial-state` |
| REFUND-16 | 金额和数量都全部退完才进入已全部退款 | `流程：退款`，全额条件 | 逻辑运算 | `refund-exact-full` |
| REFUND-17 | 任一退款失败不改变订单或库存 | `流程：退款`，`同时生效` | 原子提交 | `refund-failure-atomicity` |
| QUERY-01 | 可退款金额等于支付金额减已退款金额 | `流程：查询可退款金额` | 精确金额减法 | `refundable-initial`、`refundable-after-partial` |
| QUERY-02 | 可退款数量等于购买数量减已退款数量 | `流程：查询可退款金额` | 整数减法 | `refundable-after-partial` |
| QUERY-03 | 非已支付状态不可查询可退款结果 | `流程：查询可退款金额`，状态守卫 | 顺序求值 | `refundable-unpaid`、`refundable-full` |
| ERROR-01 | 业务错误按 AAL 声明顺序选择第一个 | 所有流程的守卫顺序 | 禁止重排 | `error-priority-combinations` |
| HTTP-01 | 非法 JSON、缺失字段和类型错误在流程前返回 400 | HTTP 入口 | 固定传输语义 | `transport-invalid-json`、`transport-missing-field`、`transport-wrong-type` |

## 3. 实现完成条件

实现不能只以“服务能启动”作为完成标准。必须同时满足：

```text
跟踪语义项：39 / 39
AAL 可见应用语义：36 / 36
Fixture 前提：2 / 2
固定 HTTP 传输语义：1 / 1
Runtime 私有业务规则：0
每条语义至少存在一个明确的 Oracle 映射
语言标准保证拥有独立的确定性单元测试
```

其中 `DOM`、`PAY`、`CANCEL`、`REFUND`、`QUERY` 和 `ERROR` 共 36 项，必须能从 AAL 审计；`DATA` 两项在 Fixture 及其说明中审计；`HTTP` 一项由公开语言标准固定。

如果某条规则只能从生成代码、编译器分支或 Runtime 路径中推断，它应计为隐藏语义，而不是 AAL 语义。

## 4. Oracle 组织方式

每个独立场景使用：

- 独立 fixture；
- 固定 UTC 时钟；
- 新启动的内存 Runtime；
- 固定请求顺序；
- 对响应和后续可观察状态同时断言。

以下行为必须使用连续请求验证，不能拆成互不相关的单次断言：

```text
支付 → 再次支付
取消 → 再次取消
部分退款 → 第二次部分退款
退款失败 → 随后合法退款
全额退款 → 再次退款
```

失败原子性不能通过响应码间接推断。失败后必须查询或继续操作，证明订单状态、累计退款金额、累计退款数量和库存均未变化。

## 5. 真人审计流程

真人测试不先展示 TypeScript、AST、编译器代码或本业务规格。

### 第一轮：只读 AAL

参与者只阅读 `app.zh-CN.aal`，回答：

1. 哪些订单可以支付？
2. 支付是否改变库存？
3. 未支付订单取消后库存如何变化？
4. 重复取消会不会再次增加库存？
5. 普通用户退款的准确时间边界是什么？
6. 管理员跳过哪些规则，仍受哪些规则约束？
7. 退款金额和退款数量如何相互约束？
8. 何时进入 `已全部退款`？
9. 退款失败后哪些数据保证不变？
10. 同时存在多个错误时，哪一个优先返回？

记录：

- 完成总时间；
- 10 个问题的正确数；
- 每个答案的主观确信度；
- 误解的规则编号；
- 参与者认为可能隐藏在 Runtime 中的规则。

### 第二轮：对照冻结规格

随后展示本业务规格、Fixture 和语言标准，让参与者按归属定位全部 39 条语义：36 条应用语义定位到 AAL，2 条数据前提定位到 Fixture，1 条传输语义定位到语言标准。

记录：

- 成功定位的规则数；
- 每条规则的定位时间；
- 找不到或认为表达含糊的规则；
- 需要查看生成代码才能确认的规则。

第二轮目标不是记忆需求，而是验证 AAL 是否提供足够清晰的审计锚点。

## 6. 语义转移检查

实现评审时逐项回答：

1. 删除业务名称后，Runtime 是否仍包含退款专用分支？
2. 编译器是否根据 `退款`、`订单`、HTTP 路径或字段名推断行为？
3. AAL 未声明的状态变化、错误优先级或默认值是否会发生？
4. 原子性、金额和时间保证是否属于通用、已测试的语言标准？
5. 更换同类型业务名称后，编译结果是否只改变名称而不改变语义？

任何一项出现业务专用隐藏逻辑，都必须在比较 review surface 之前修正或明确计入隐藏语义。
