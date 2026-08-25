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

AAL 当前只保留两个主要概念：

```text
Object（对象）
Flow（流程）
```

对象描述应用中存在什么。

流程描述应用中会发生什么。

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

Binding（绑定）负责明确连接这些身份。

例如：

```text
审计对象：Order
稳定 ID：object_order
程序对象：Order

审计字段：number
稳定 ID：field_order_number
程序字段：id
```

Binding 在实验中是可选的。

未提供显式 Binding 时，Determinant 可以为当前构建生成确定性的临时 Binding。

对于持续维护的应用，如果稳定身份或程序名称需要在源文件重命名或声明顺序变化后保持不变，应使用显式 Binding。

Binding 不属于日常业务逻辑。业务行为主要在 AAL 中审计；当 Binding 新增或发生变化时，单独审计它的差异。

当前 P0 Binding 只控制生成的 TypeScript 名称。第三方 API、SDK 和数据库适配尚未实现。

## 当前实现

当前仓库已经包含一个最小的确定性编译闭环：

- Object（对象）及类型字段
- Flow（流程）
- 条件判断与明确失败
- 计算
- 显式状态改变
- 流程组合
- 确定性解析
- 语义检查与诊断
- 显式金额类型
- 可选 Binding、稳定 ID 和程序名称
- 共用同一编译链的英文与 `zh-CN` 方言
- TypeScript 代码生成
- 可执行的成功与失败路径测试

当前目标运行时：

```text
Node.js + TypeScript
```

HTTP 与 CRUD 支持留待后续迭代。

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
```

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
- [English README](README.md)

生成的 TypeScript 属于构建产物。

修改业务行为时修改 AAL。

修改稳定身份或程序名称时修改 Binding。

不要直接修改生成代码。
