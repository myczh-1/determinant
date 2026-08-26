# Benchmark Scorer v1

> 默认英文版本：[Benchmark Scorer v1](./README.md)

这个 Benchmark 使用同一个冻结的黑盒 HTTP Oracle，对比直接 Node.js 实现和 AAL submission。

评分器不会调用 LLM，不会阅读生成代码推断意图，也不会修改提交的源目录。

## 目录

```text
benchmark/
├── contract.v1.json
├── oracle/v1/cases.json
├── scorer/
├── submissions/<mode>/<tool>/<run>/
└── results/
```

Contract、Oracle 和 Scorer 一起版本化。每份结果都会记录它们的 SHA-256 摘要。

## 隔离编写工作区

不要把实现工具直接打开在 Determinant 仓库中。应当先在仓库外准备一个独立工作区：

```bash
npm run benchmark:prepare -- \
  --mode direct \
  --tool example-tool \
  --run 001 \
  --out /absolute/path/to/example-tool/direct/001
```

生成的目录是一个独立 Git 仓库，只包含自包含任务、当前模式的说明、冻结 manifest，以及 `aal` 模式需要的 AAL 语言参考。它不包含指向 Scorer、Oracle、示例、参考 submission、历史结果或 Determinant 源码的链接。

实现工具必须直接打开最底层工作区，不能打开它的父目录。每种模式和每次 run 都使用全新会话。仅打开独立目录只能实现上下文隔离；如果需要严格隔离，还必须把工具的文件系统权限限制在这个目录内。

工具完成后，只收集白名单内的实现文件：

```bash
npm run benchmark:collect -- \
  --mode direct \
  --tool example-tool \
  --run 001 \
  --from /absolute/path/to/example-tool/direct/001
```

收集器会验证冻结输入，拒绝符号链接、外部依赖、意外文件、身份变化和已存在的目标目录，然后只把实现复制到 `benchmark/submissions/`。任务文档、manifest 和工作区 Git 数据不会被收集或计入评分。

## Submission 约定

Direct submission 使用固定结构：

```text
direct/<tool>/<run>/
├── package.json
├── package-lock.json
└── src/
```

`package.json` 必须提供 `build` 和 `start` 脚本。评分器固定执行：

```text
npm ci --ignore-scripts
npm run build
npm run start
```

服务必须读取：

```text
BENCHMARK_HOST
BENCHMARK_PORT
```

AAL submission 使用：

```text
aal/<tool>/<run>/
├── app.aal
└── binding.json    # 可选
```

Benchmark v1 固定使用英文 AAL 方言，并使用仓库中锁定版本的 Determinant 编译、类型检查和启动应用。

## 运行

评分全部 submission 并重新生成聚合结果：

```bash
npm run benchmark:run
```

也可以筛选：

```bash
node benchmark/scorer/score.mjs --mode aal --tool reference --run 001
node benchmark/scorer/aggregate.mjs
```

结果写在 submission 目录之外：

```text
benchmark/results/<mode>/<tool>/<run>/result.json
benchmark/results/summary.json
benchmark/results/report.md
```

## 评分规则

构建和服务启动属于门槛。功能正确性由冻结 Oracle 的通过数量决定。审计面积单独报告，并且只有一对 submission 都通过全部 Oracle 用例时才进行比较。

v1 不生成加权总分。

行为指纹来自规范化后的真实响应记录，不包含执行时间、临时端口、进程日志和易变化的 HTTP 响应头。

## 审计面积

Direct submission 的 `src/` 是主要审计面，`package.json` 作为运行配置单独报告。

AAL submission 的审计面是 `app.aal`，以及存在时的显式 `binding.json`。生成的 TypeScript 不计入审计面。

评分器记录文件数、UTF-8 字节数、物理行数、非空行数、每个文件摘要和整体审计面摘要，不判断可读性或复杂度。

## Submission 完整性

评分器首先计算原 submission 目录摘要，然后复制到临时目录，只在副本中构建和运行。评分结束后删除临时目录，并再次计算原目录摘要。

符号链接和非 UTF-8 审计文件会被拒绝。

## 安全边界

Scorer v1 使用本地进程运行 submission，只适合受控环境中产生的可信提交。评分外部或不可信 submission 时，需要另行增加禁止外网并限制 CPU、内存和进程数量的容器边界。
