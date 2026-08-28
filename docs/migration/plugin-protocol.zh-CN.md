# 插件协议最小约定

插件使用独立进程，通过 stdin/stdout 交换 JSON Lines。协议版本为 `aal-plugin/v1`，插件不能直接依赖内部 AST。

## 边界

Observer Protocol ≠ Plugin Host。

Observer Protocol 只定义独立进程之间如何交换请求、ProgramModel、诊断和 Artifact。本分支不负责插件发现、注册、启动、监督、超时、沙箱或生命周期管理。

Observer 请求示例：

```json
{"protocol":"aal-plugin/v1","kind":"observer","method":"observe","id":"1","params":{"program":{"version":1,"name":"Demo"},"diagnostics":[]}}
```

Observer 响应示例：

```json
{"protocol":"aal-plugin/v1","kind":"observer","method":"observe","id":"1","ok":true,"artifacts":[{"name":"summary.json","kind":"summary","mediaType":"application/json","content":"{}"}]}
```

Observer 只读取 ProgramModel 和 Diagnostics，不能改变程序语义。Semantic 与 Backend 的请求参数类型只在当前分支保留协议位置，完整第三方插件不属于本轮实现。
