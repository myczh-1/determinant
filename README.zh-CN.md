# Determinant

**让 AI 停在可审计的业务语义层；从这里开始，LLM 退场。**

今天的 AI 编码通常是：

```text
自然语言需求
→ LLM
→ 最终实现代码
→ 人审代码
```

Determinant 尝试把边界提前：

```text
自然语言需求
→ LLM
→ 可审计的业务语义
→ 人确认
════════════════════════════
      LLM 到此退场
════════════════════════════
→ 确定性检查 / 编译 / 执行
→ 最终程序
```

这个仓库使用 **AAL（Auditable Application Language，可审计应用语言）** 作为参考语义层。AAL 不是项目的核心主张；核心是：**一旦业务语义被明确表达并确认，最终实现不再经过另一轮概率性的 AI 生成。**

当前 `refactor/go-toolchain` 分支已经形成可重复的编译闭环：

```text
AAL
→ Go Core
→ Canonical ProgramModel
→ Backend
→ Go / TypeScript
```

该迁移阶段已经通过统一验收，覆盖旧行为基线、确定性构建、CLI 合同、Go/TypeScript 生成代码、ProgramModel、最小 Observer Protocol、Go 静态分析，以及 macOS/Linux/Windows 交叉构建。

## 一个最小例子

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

这里需要审计的是：

```text
什么时候库存不足
库存是否被修改
修改后的结果是什么
```

而不是生成代码最终用了哪个类、Service、Repository、Promise 或其他工程结构。

## 为什么不是“另一门万能语言”

Determinant 不试图为所有项目规定唯一的工程实现。

真实项目会有自己的框架、数据库、SDK、基础设施、异常体系、事务约定和代码组织方式。更现实的生产形态是：

```text
业务语义
   ↓
项目自己的确定性 Backend / Binding
   ↓
Spring Boot / Go / TypeScript / 内部框架
```

也就是说：

- **AAL / 语义层**描述“系统必须做什么”；
- **项目 Backend** 固化“在这个团队里，这件事应该怎么实现”；
- 这些工程选择不需要在每一个需求中重新交给 AI 决定。

如果一种需求已经落在现有语义和 Backend 能力范围内，日常开发只需要修改业务语义；只有引入新的工程能力时，才需要扩展 Backend。

## 当前实现

当前仓库已经包含：

- Object（对象）与类型字段
- Flow（流程）
- 条件、计算和明确失败
- 状态改变
- 对象身份、创建、单对象查询与删除
- 流程组合
- HTTP 入口与请求映射
- 金额、封闭取值、UTC 时间、固定持续时间
- 原子创建 / 改变区块
- Fixture 加载
- Binding、稳定 ID 与程序名称
- 英文与 `zh-CN` 方言
- Go lexer / parser / semantic checker
- Canonical ProgramModel
- Go Backend
- TypeScript Backend
- `determinant check` 与 JSON diagnostics
- 独立进程 Observer Plugin 协议
- 可执行成功 / 失败路径测试
- 冻结黑盒 HTTP Oracle Benchmark

Go 工具链迁移状态见：

- [Go 工具链迁移状态](docs/migration/go-toolchain.zh-CN.md)
- [插件协议](docs/migration/plugin-protocol.zh-CN.md)

当前仍未覆盖持久化数据库、完整事务、鉴权、列表查询和第三方系统适配。这些属于后续生产化边界，而不是当前 Go 迁移 Gate。

## 运行 Go 工具链

需要 Go；仓库中的旧 Node/TypeScript 实现仍保留为迁移行为参考和 Benchmark 工具。

```bash
# Go 单元测试
go test ./...

# 统一迁移验收
npm run test:migration

# 检查 AAL
go run ./cmd/determinant check --json examples/items/app.aal

# 生成 Go 源码
go run ./cmd/determinant build examples/items/app.aal --target go --out /tmp/items.go
```

统一迁移验收当前状态为 **PASS**。

## 已有 Benchmark

第一轮冻结 CRUD Benchmark 对比了 AI 直接生成的 Node.js 实现，以及 AI 生成 AAL 后由 Determinant 确定性生成实现。

在七份有效 submission 中：

- 7/7 构建成功；
- 7/7 服务启动成功；
- 全部通过冻结 HTTP Oracle 的 14/14 个用例；
- 全部产生相同的可观察行为指纹。

三组完整 Direct/AAL 配对中，AAL 的主要审计面合计：

- 非空行数减少 **24.6%**；
- 字节数减少 **54.2%**。

| 工具 | Direct | AAL | Direct LOC | AAL LOC | LOC 减少 | 字节减少 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| codex-5.6luna | 14/14 | 14/14 | 132 | 104 | 21.21% | 46.97% |
| omp-deepseek-v4 | 14/14 | 14/14 | 116 | 104 | 10.34% | 56.03% |
| opencode-deepseek-v4 | 14/14 | 14/14 | 166 | 104 | 37.35% | 58.19% |
| opencode-glm5-2 | 未完成 | 14/14 | — | 104 | — | — |

这个 Benchmark **没有证明行为可靠性优势**：所有有效 Direct 与 AAL submission 都通过了同一个 Oracle。它当前证明的是，在这个任务上，相同的受测行为可以通过更小的语义产物进行审计。

参见[完整 Benchmark 报告](benchmark/results/report.md)。

## 与已有工作的关系

Determinant 并不把“LLM 生成模型 / DSL，再由确定性工具链生成程序”声明为一个全新的方向。

它建立在长期存在的 Model-Driven Engineering（MDE）、Model-Driven Architecture（MDA）、DSL 和代码生成思想之上。LLM 出现以后，这条路线已经重新成为活跃研究方向：

- 2026 年的系统映射研究统计了 2022 到 2026 年初 **86 篇 LLM + MDE** 研究，Model Generation 是其中最集中的任务方向：<https://link.springer.com/article/10.1007/s10664-026-10921-4>
- BMW 的 2026 工业案例让 LLM 根据自然语言生成和修改多文件 Xtext DSL，再由既有生成器生成 Java / TypeScript：<https://conf.researchr.org/details/ease-2026/ease-2026-industry-papers/1/Leveraging-LLMs-for-Multi-File-DSL-Code-Generation-An-Industrial-Case-Study>
- PlanCompiler 以 typed JSON plan 作为 LLM 与确定执行之间的边界，并在验证后确定性编译成 Python：<https://arxiv.org/abs/2604.13092>

Determinant 当前探索的具体组合是：

1. 中间层主要表达业务行为，而不是自由实现代码；
2. 这层语义本身是人的主要审计对象；
3. 语义被确认以后，LLM 从实现链路中退出；
4. 最终代码是构建产物，而不是业务行为的权威来源；
5. 企业可以通过长期稳定的 Backend / Binding 固化自己的工程规范。

因此，这个项目更适合被理解为：**在已有 MDE / DSL 路线基础上，对 AI 编码中的“可审计概率截止点”做一个可运行的工程实验。**

## 当前要验证的问题

Determinant 目前仍然是早期产品 / 工程实验。接下来真正需要验证的不是“这种思想是否从未出现过”，而是：

1. 在跨文件、跨模块的真实需求中，语义层能否持续显著缩小人工审计面；
2. 企业 Backend 的维护成本能否被后续大量需求摊薄；
3. AAL / 项目语义是否会逐渐稳定，而不是不断膨胀成另一门通用编程语言；
4. 在真实项目接入第三方库、数据库和内部基础设施之后，LLM 的截止点是否仍然实用。

## 文档

- [AAL 中文编写指南](docs/public/aal-authoring-guide.zh-CN.md)
- [Binding 中文指南](docs/public/binding-guide.zh-CN.md)
- [Go 工具链迁移状态](docs/migration/go-toolchain.zh-CN.md)
- [订单退款与库存回补示例](examples/order-refund/README.zh-CN.md)
- [Benchmark Scorer v1 中文说明](benchmark/README.zh-CN.md)
- [English README](README.md)

当前参考实现把生成代码视为构建产物：修改业务行为时修改 AAL；修改稳定身份或程序名称时修改 Binding；不要把生成代码作为业务逻辑的权威来源直接维护。
