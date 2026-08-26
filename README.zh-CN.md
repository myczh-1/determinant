# Determinant

**Determinant 尝试在概率性的 AI 与最终程序之间建立一个人类可审计的确定性边界。**

今天，即使一份 SPEC（规格说明）写得非常详细，同一个需求仍然可能因为模型、上下文、记忆、工具或执行时间不同，而生成不同的代码。

Determinant 不试图让 LLM 变得确定。

它采用另一种方式：

```text
自然语言
→ LLM
→ AAL
→ 人类审计
════════════════════
→ 确定性编译
→ TypeScript / Node.js
```

AAL（Auditable Application Language，可审计应用语言）是一种面向应用行为的人类可读语言。

AI 可以负责生成和修改 AAL。

一旦 AAL 被确认，后续程序生成不再依赖 LLM。

> **审计之前，AI 可以是概率性的；审计之后，软件不应该继续是概率性的。**

## AAL

AAL 当前保留两个主要业务概念和一个明确的外部入口：

```text
Object（对象）
Flow（流程）
HTTP entry（HTTP 入口）
```

对象描述应用中存在什么。

流程描述应用中会发生什么。

HTTP 入口把 HTTP 请求映射到流程。Host 和 Port 属于运行配置，不属于业务行为，因此不会写入 AAL。

业务领域存在有限词汇时，`取值` 声明会明确列出所有允许项，不把它们降级为任意文本或实现代码。

例如，默认英文方言可以写成：

```aal
application: InventoryApp

object: Inventory

    quantity: integer


flow: DeductInventory

    input:
        inventory: Inventory
        quantity: integer

    if inventory's quantity < quantity:
        failure: Insufficient inventory

    change:
        inventory's quantity = inventory's quantity - quantity

    output:
        remainingInventory = inventory's quantity
```

用户需要审计的是：

```text
什么时候库存不足
库存是否会被修改
修改后的结果是什么
```

而不是生成代码最终使用什么类、函数、Promise 或其他实现结构。

## 确定性边界

AAL 被确认以后，构建链路为：

```text
AAL
↓
Parser（解析器）
↓
AST（抽象语法树）
↓
Semantic Check（语义检查）
↓
Compiler（编译器）
↓
TypeScript
↓
Node.js
```

这部分不调用 LLM。

目标是：

```text
相同 AAL
+ 相同 AAL 语言版本与方言
+ 相同 Binding
+ 相同编译器版本
+ 相同运行时与依赖
= 相同程序语义
```

Determinant 并不消灭 AI 编码的不确定性。

它尝试**缩小不确定性的范围，并给它设置一个明确的终点。**

## Binding

AAL 使用人类可读的审计名称，而生成程序和外部系统可能使用不同名称。

当这些名称需要不同时，Binding（绑定）可以明确连接这些身份。

例如：

```text
审计对象：Order
稳定 ID：object_order
程序对象：Order

审计字段：number
稳定 ID：field_order_number
程序字段：id
```

Binding 是可选辅助输入，不是理解或运行 AAL 应用的前置条件。

没有显式 Binding 时，审计名称直接作为生成程序名称，声明在当前构建中使用确定性的临时 ID。HTTP 请求字段默认也使用 AAL 输入名称，除非 HTTP 入口通过局部 `as` 映射明确指定不同名称。

名称需要不同、稳定身份需要跨重命名或声明顺序变化保持不变，或必须维持已有程序接口时，再使用显式 Binding。

Binding 不属于日常业务逻辑。业务行为主要在 AAL 中审计；当 Binding 新增或发生变化时，单独审计它的差异。

当前 P0 Binding 只控制生成的 TypeScript 名称。第三方 API、SDK 和数据库适配尚未实现。

## 当前实现

当前仓库已经包含一个最小的确定性编译闭环：

- Object（对象）及类型字段
- Flow（流程）
- 条件判断与明确失败
- 计算
- 显式状态改变
- 对象身份、创建、单对象查询与删除
- 流程组合
- 明确的 HTTP 入口与请求映射
- 内存 CRUD 运行时
- 确定性解析
- 语义检查与诊断
- 显式金额类型
- 封闭业务取值集合
- UTC 时间、固定持续时间与可信 Runtime 时钟
- 条件业务步骤区块
- 显式内存原子创建/改变区块
- 经验证、整体替换的 Fixture 加载
- 可选 Binding、稳定 ID 和程序名称
- 共用同一编译链的英文与 `zh-CN` 方言
- TypeScript 代码生成
- 可执行的成功与失败路径测试
- 不使用 LLM、由冻结黑盒 HTTP Oracle 裁决的 Benchmark Scorer

当前目标运行时：

```text
Node.js + TypeScript
```

持久化、数据库事务、鉴权、列表查询和外部系统适配不属于当前 MVP。

## 运行

需要 Node.js 和 npm。

```bash
npm install

# 默认英文方言
npm test
npm run compile:example

# 中文方言
npm run test:zh
npm run compile:example:zh

# 全部测试
npm run test:all

# 语义密集型订单退款冻结 Oracle
npm run test:order-refund

# 运行内存 HTTP CRUD 演示
npm run demo:http

# 中文 AAL HTTP 演示
npm run demo:http:zh

# 中文订单退款与库存回补演示
npm run demo:order-refund
```

演示启动后可以执行：

```bash
curl -X POST http://127.0.0.1:3000/items \
  -H "Content-Type: application/json" \
  -d '{"id":1,"name":"Book"}'

curl http://127.0.0.1:3000/items/1

curl -X PUT http://127.0.0.1:3000/items/1 \
  -H "Content-Type: application/json" \
  -d '{"name":"Notebook"}'

curl -X DELETE http://127.0.0.1:3000/items/1
```

等价的直接启动命令是：

```bash
node bin/determinant.mjs run examples/items/app.aal --host 127.0.0.1 --port 3000
```

[中文订单退款示例](examples/order-refund/README.zh-CN.md)把 39 项跟踪语义明确归属到 AAL、冻结 Fixture 或语言级传输保证中。

运行 Direct 与 AAL 对比 Benchmark：

```bash
npm run benchmark:run
```

外部实现工具应先使用 `npm run benchmark:prepare` 获得独立工作区，再通过 `npm run benchmark:collect` 导入白名单内的输出。Benchmark 只构建和运行已收集 submission 的临时副本，记录规范化行为指纹和审计面积指标，并在 `benchmark/results/` 下生成 `result.json`、`summary.json` 和 `report.md`。

## 早期 Benchmark 结果

第一轮冻结 CRUD Benchmark 对比了 AI 直接生成的 Node.js 实现，以及通过 AAL 经 Determinant 编译到 Node.js 的实现。

在七份有效 submission 中：

- 7/7 构建成功；
- 7/7 服务启动成功；
- 全部通过冻结 HTTP Oracle 的 14/14 个用例；
- 全部产生相同的可观察行为指纹；
- 每组已完成的 Direct/AAL 配对都在保持受测行为的同时缩小了 AAL 审计面积。

| 工具 | Direct | AAL | Direct LOC | AAL LOC | LOC 减少 | 字节减少 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| codex-5.6luna | 14/14 | 14/14 | 132 | 104 | 21.21% | 46.97% |
| omp-deepseek-v4 | 14/14 | 14/14 | 116 | 104 | 10.34% | 56.03% |
| opencode-deepseek-v4 | 14/14 | 14/14 | 166 | 104 | 37.35% | 58.19% |
| opencode-glm5-2 | 未完成 | 14/14 | — | 104 | — | — |

按三组已完成 Direct/AAL 配对的总审计面积计算，AAL 的非空行数减少了 24.6%，字节数减少了 54.2%。表中的 LOC 指主要审计面的非空行数，不包含生成代码和运行用 package 配置。

第一轮 Benchmark **没有显示行为可靠性优势**：所有有效 Direct 和 AAL submission 都通过了相同 Oracle，并产生相同的行为指纹。它目前显示的是：对于这个任务，相同的受测行为可以通过明显更小的 AAL 产物进行审计。

参见[完整 Benchmark 报告](benchmark/results/report.md)。

默认 AAL 方言为英文，无语言后缀的文件使用英文。

中文方言使用 `.zh-CN` 文件后缀，并通过：

```bash
--language zh-CN
```

显式选择。

## 项目状态

Determinant 目前仍处于早期实验阶段。

当前首先验证三个问题：

1. 是否能够用明显少于普通实现代码的 AAL 完整表达应用行为；
2. 人是否能够主要审计 AAL，而不是逐行审计 AI 生成代码；
3. AAL 被确认以后，程序生成是否可以完全退出概率性的 LLM 链路。

第一阶段专注 Node.js 后端应用。

React、Vue 和其他 UI 表达暂不属于当前范围。

## 文档

- [AAL Authoring Guide](docs/public/aal-authoring-guide.md)
- [Binding Guide](docs/public/binding-guide.md)
- [中文 AAL 编写指南](docs/public/aal-authoring-guide.zh-CN.md)
- [中文 Binding 指南](docs/public/binding-guide.zh-CN.md)
- [Benchmark Scorer v1 中文说明](benchmark/README.zh-CN.md)
- [订单退款与库存回补示例](examples/order-refund/README.zh-CN.md)
- [English README](README.md)

生成的 TypeScript 属于构建产物。

修改业务行为时修改 AAL。

修改稳定身份或程序名称时修改 Binding。

不要直接修改生成代码。
