# Go 工具链迁移状态

## 状态：PASS

`refactor/go-toolchain` 已通过当前阶段统一验收：

```bash
npm run test:migration
```

该验收包含旧行为基线、确定性构建、CLI 合同、Go/TypeScript 生成代码、ProgramModel、最小 Observer Protocol、Go 静态分析和 macOS/Linux/Windows 交叉构建。

## 目标

`refactor/go-toolchain` 的目标是建立一条完整、可重复的编译器闭环：

```text
AAL 源文件
→ Go Core
→ Canonical ProgramModel
→ Backend
→ 目标代码
```

旧 TypeScript/Node 实现继续保留，作为迁移期间的行为参考。迁移判断关注接受/拒绝结果、诊断类别和位置、规范化模型、生成源码与 HTTP 可观察行为，不比较内部 AST。

## 当前已完成

- Go lexer、parser、semantic checker 和统一 compiler pipeline；
- 稳定的 ProgramModel JSON 序列化；
- `determinant check` 与 `check --json`；
- Go Backend：生成可编译的独立 Go 程序，并通过系统 Go 工具链运行 HTTP Todo/Fixture 示例；
- TypeScript Backend：由 Go Core 直接生成 TypeScript，当前迁移样例可编译并可调用 HTTP CRUD；
- Binding 与 Fixture：支持当前样例所需的显式程序名称映射、完整 Fixture 校验和一次性存储替换；
- Observer Plugin Protocol：独立进程、stdin/stdout、JSON Lines；
- Semantic Plugin 参数占位和 Backend 接口边界；
- Go CLI 的 macOS、Linux、Windows 交叉构建验证。

## 当前阶段冻结范围

本分支只负责 Go 编译器迁移：旧 Node/TypeScript 实现保留为行为参考，
CLI 名称继续使用 `determinant`，AAL 只是语言名称。

`run` 的定义是：AAL → 临时目标源码 → 调用用户已有的目标运行器。
当前迁移目标是系统 Go 工具链；Determinant 不携带 Go、Node 或 Bun。

当前阶段的统一验收命令是：

```bash
npm run test:migration
```

## 当前边界

Observer Protocol 只定义独立进程之间的数据交换，不等于 Plugin Host。本分支不提供插件发现、注册、启动、监督、超时、沙箱或生命周期管理。

本分支不包含错误文案逐字兼容、TypeScript 目标运行器管理、`dev/watch`、
Mermaid/ER/流程图产品体验、VS Code 插件和完整第三方语义插件。
完整 Mermaid 与工作台能力进入 `feature/workbench`；第三方类型、资源、
操作、validator、lowering 和 runtime integration 进入
`feature/semantic-plugins`。旧 Node 实现必须在本阶段 Gate 全绿前保留。

## 验证入口

```bash
go test ./...
npm test
go run ./cmd/determinant check --json examples/items/app.aal
go run ./cmd/determinant build examples/items/app.aal --target go --out /tmp/items.go
```
