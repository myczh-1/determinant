# Go 工具链迁移状态

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
- Go Backend：生成可编译的独立 Go 程序，并通过系统 Go 工具链运行 HTTP Todo 示例；
- TypeScript Backend：由 Go Core 直接生成 TypeScript，当前迁移样例可编译并可调用 HTTP CRUD；
- Observer Plugin Protocol：独立进程、stdin/stdout、JSON Lines；
- Semantic Plugin 参数占位和 Backend 接口边界；
- Go CLI 的 macOS、Linux、Windows 交叉构建验证。

## 当前边界

本分支暂不包含 Binding/Fixture 的完整兼容、TypeScript 目标的运行器管理、`dev/watch`、Mermaid/ER/流程图产品体验、VS Code 插件和完整第三方语义插件。这些能力必须在对应迁移门补齐或明确拆到后续分支后，才能删除旧 Node 实现。

目标运行时由用户提供。Determinant 只生成目标源代码，`run --target go` 调用系统 Go 工具链，不内置 Go、Node 或 Bun。

## 验证入口

```bash
go test ./...
npm test
go run ./cmd/determinant check --json examples/items/app.aal
go run ./cmd/determinant build examples/items/app.aal --target go --out /tmp/items.go
```
