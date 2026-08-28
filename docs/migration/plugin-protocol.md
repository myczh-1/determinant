# Minimal Plugin Protocol

Plugins run as independent processes and exchange JSON Lines over stdin/stdout. The protocol version is `aal-plugin/v1`; plugins must not depend on the internal AST.

Example Observer request:

```json
{"protocol":"aal-plugin/v1","kind":"observer","method":"observe","id":"1","params":{"program":{"version":1,"name":"Demo"},"diagnostics":[]}}
```

Example Observer response:

```json
{"protocol":"aal-plugin/v1","kind":"observer","method":"observe","id":"1","ok":true,"artifacts":[{"name":"summary.json","kind":"summary","mediaType":"application/json","content":"{}"}]}
```

An Observer reads ProgramModel and Diagnostics only and cannot change program semantics. Semantic and Backend request types are protocol placeholders on this branch; full third-party plugins are follow-up work.
