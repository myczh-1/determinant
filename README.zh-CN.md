# Determinant

**Determinant 尝试在概率性的 AI 与最终程序之间建立一个人类可审计的确定性边界。**

今天，即使一份 SPEC（规格说明）写得非常详细，同一个需求仍然可能因为模型、上下文、记忆、工具或执行时间不同，而生成不同的代码。

Determinant 不试图让 LLM 变得确定。

它采用另一种方式：

```text
自然语言
→ LLM
→ 可审计的语义表达
→ 人类审计
════════════════════
→ 确定性编译 / 执行
→ 最终程序
```

这个仓库使用 **AAL（Auditable Application Language，可审计应用语言）**，作为这种语义表达的一种具体实验：

```text
自然语言
→ LLM
→ AAL
→ 人类审计
════════════════════
→ 确定性编译
→ TypeScript / Node.js
```

AI 可以负责生成和修改 AAL。

一旦 AAL 被确认，后续程序生成不再依赖 LLM。

> **审计之前，AI 可以是概率性的；审计之后，软件不应该继续是概率性的。**

## Go 工具链迁移

当前 `refactor/go-toolchain` 分支正在把工具链收敛为：

```text
AAL → Go Core → Canonical ProgramModel → Backend → 目标代码
```

该分支已经提供 Go 版本的 `check`、Go/TypeScript 代码生成、系统 Go 工具链运行，以及独立进程 Observer Plugin 协议。旧 TypeScript/Node 实现在迁移门全部通过前继续作为行为参考；Go、Node、Bun 等目标运行时不由 Determinant 内置。

这次迁移仍然聚焦编译器闭环，不把 `dev/watch`、Mermaid/ER/流程图产品体验、VS Code 插件或完整第三方语义插件提前并入核心。

## 这个仓库是一个参考实验，而不是一门要求所有项目采用的语言

Determinant 的核心并不是这个仓库当前实现的 AAL 语法。

这个仓库首先是一个实验性的参考实现和测试场，用来验证一个问题：

> 能不能让 AI 停在一个更小、更容易审计的语义层，而把最终实现重新交给传统的确定性软件？

真实项目并不需要使用这里完全相同的语法。

语义层可以是另一套文本 DSL（领域特定语言）、JSON 或其他结构化数据、AST（抽象语法树）或图结构、可视化编辑器、流程图，或者任何适合具体项目的表达方式。

真正重要的不是它长什么样。

> **当程序想做什么已经被明确表达并确认以后，实现这些语义不应该再次依赖一次概率性的 AI 生成。**

因此，Determinant 也不试图提供一个能够直接覆盖所有真实项目的“万能编译器”。

真实项目会依赖自己的第三方库、API、数据库、基础设施、框架和业务领域能力。一种通用语义语言不可能预先完整表达世界上所有第三方包的能力；如果不断把所有第三方实现细节塞进核心语言，最后它也很容易重新变成另一门通用程序语言。

因此，一个真正用于生产项目的类似系统，更可能拥有自己的语义词汇、文本语法或可视化表达、项目专属操作和类型、第三方库与外部系统绑定，以及确定性编译器或执行后端。

这个仓库提供的是其中一种实现，用来测试这个架构是否成立，而不是要求其他项目以后必须使用这里的 AAL 语法。

## 一个比较直观的类比：UI 组件库

可以把这个思路类比成前端的 UI 组件库。

例如，一个 React 项目里使用：

```tsx
<DataGrid rows={users} columns={userColumns} />
```

无论是开发者还是 AI，在需要一个数据表格时，都不需要重新实现一次完整的 DataGrid。

调用者只需要表达这里使用哪个组件、传入哪些数据和配置。`DataGrid` 内部可能非常复杂，但这些复杂度属于组件库自己的实现。

当我们审计业务代码时，通常需要确认的是这里是不是应该使用 `DataGrid`、传入的数据和配置是否正确，而不是要求每一个使用 `DataGrid` 的地方，都重新审计一份刚刚生成出来的表格内部实现。

如果不同 AI 最后都写出了：

```tsx
<DataGrid rows={users} columns={userColumns} />
```

那么它们已经收敛到了同一个被定义好的组件操作，而不是分别重新发明一个 DataGrid。

可以表示成：

```text
AI A ─┐
AI B ─┼─→ 相同的、已经确认的语义操作 ─→ 确定性实现
AI C ─┘
```

确定性后端当然仍然可能存在 bug，就像编译器、UI 框架、数据库和运行时都可能存在 bug 一样。

但这种错误属于一个可以集中修复、测试和回归验证的软件实现，它与“每一次使用时都重新让 AI 生成一份新的实现”并不是同一种问题。

## AAL

这个仓库当前实现的参考 AAL 保留两个主要业务概念和一个明确的外部入口：

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

AAL 被确认以后，当前参考实现的构建链路为：

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

在环境固定的前提下，它希望提供的合同是：

```text
相同的已确认 AAL
+ 相同 AAL 语言版本与方言
+ 相同 Binding
+ 相同编译器版本
+ 相同运行时与依赖
= 相同程序语义
```

编译器当然可能有 bug，但编译器出现 bug 并不意味着“编译”本身是一种概率行为。它意味着这个确定性软件实现存在缺陷，需要修复并加入回归测试。

LLM 直接生成最终实现则不同：即使 SPEC 已经非常严格，每一次生成仍然是一次新的概率性实现过程。

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

当前 P0 Binding 只控制生成的 TypeScript 名称。

第三方 API、SDK、数据库和框架适配，本身也不应该被理解成一种通用 AAL 核心可以提前完整定义的东西。它们更适合由具体项目自己的确定性 Binding 或后端负责。

当前参考编译器尚未实现这些适配能力。

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

当前仓库主要验证四个问题：

1. 是否能够用明显小于普通实现代码审计面积的语义表达，完整描述应用行为；
2. 人是否能够主要审计这层语义，而不是逐行审计 AI 生成的最终实现；
3. 语义被确认以后，最终程序生成是否可以完全退出概率性的 LLM 链路；
4. 当真实项目开始接入自己的第三方库、API、基础设施和领域能力以后，这条确定性边界是否仍然实用。

AAL 是这个仓库当前用于验证这些问题的一种表示方式。

这个实验并不要求 AAL 成为最终语法，也不要求它成为所有项目通用的语言。

第一阶段专注 Node.js 后端应用。

React、Vue 和其他 UI 表达暂不属于当前参考实现。

## 文档

- [AAL Authoring Guide](docs/public/aal-authoring-guide.md)
- [Binding Guide](docs/public/binding-guide.md)
- [中文 AAL 编写指南](docs/public/aal-authoring-guide.zh-CN.md)
- [中文 Binding 指南](docs/public/binding-guide.zh-CN.md)
- [Benchmark Scorer v1 中文说明](benchmark/README.zh-CN.md)
- [订单退款与库存回补示例](examples/order-refund/README.zh-CN.md)
- [English README](README.md)

生成的 TypeScript 属于当前参考实现的构建产物。

修改业务行为时修改 AAL。

修改稳定身份或程序名称时修改 Binding。

不要直接修改生成代码。
