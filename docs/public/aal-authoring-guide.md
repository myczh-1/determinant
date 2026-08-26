# AAL Authoring Guide

> Chinese version: [AAL 编写指南](./aal-authoring-guide.zh-CN.md)

## Purpose

AAL (Auditable Application Language) is a formal, human-readable language for application behavior.

It describes:

- data and state in the business world;
- calculations and conditions;
- explicit state changes;
- composition of business flows;
- successful outputs and explicit failures.

After a user confirms the AAL, a deterministic parser, semantic checker, and TypeScript generator process it without asking an LLM to infer missing decisions.

## Dialects

English is the default dialect. Files without a language suffix use English.

Chinese files use the `.zh-CN.aal` suffix and are compiled with `--language zh-CN`.

Both dialects enter the same AST, checker, Binding resolver, and code generator. They are two human-facing surfaces over one core semantic model.

## Rules for AI-generated AAL

1. Output AAL, not TypeScript, JavaScript, or pseudocode presented as AAL.
2. Use only `values`, `object`, `flow`, and `HTTP entry` as top-level declarations after the application header.
3. Use possessive field relationships such as `inventory's quantity`; do not use dot access, brackets, `this`, methods, or calls.
4. Do not invent fields, types, currencies, units, precision, permissions, retries, concurrency, rollback, rounding, or failure behavior.
5. Give every object field and flow input an explicit type.
6. Use `change` for real state mutation. A calculation alone does not change an object.
7. Prefer small, single-purpose, composable flows. A flow should usually express one business action or decision that can be named in natural language.
8. Compose flows explicitly with `execute`, `use`, and `get`.
9. Ask the user when the business requirement is ambiguous.
10. Stop changing business meaning after the user confirms the AAL.

## Source file structure

Every file starts with one application header. P0 then requires at least one object and one flow:

```aal
application: InventoryApp

object: Inventory

    quantity: integer

flow: ReadInventory

    input:
        inventory: Inventory

    output:
        quantity = inventory's quantity
```

Use four spaces for each indentation level. Blank lines and lines beginning with `#` are ignored.

English keywords are lowercase and case-sensitive, except the literal header `HTTP entry`. Application, object, flow, field, and input names must start with a letter or underscore and then contain only letters, numbers, or underscores. An HTTP entry's review label may contain spaces, such as `HTTP entry: Deduct Inventory`.

## Objects and fields

Objects describe data and state. They do not contain flows:

```aal
object: Order

    number: integer

object: Inventory

    quantity: integer
```

Use the possessive form to read nested fields:

```text
order's number
order's customer's name
```

Dot access such as `order.number` is rejected.

An object used by CRUD declares its identity explicitly:

```aal
object: Item

    id: integer
    name: text

    identity:
        id
```

The MVP does not generate IDs. Creating another object with the same identity fails, and identity fields cannot be changed after creation.

## Types

The current language supports these declarations:

```text
integer
text
boolean
time
CNY amount
USD amount
the name of a declared values set
the name of a declared object
```

For example, `Inventory` is an object type after `object: Inventory` has been declared. The literal text `object name` is not a type keyword.

The built-in amount types currently have fixed standard representations:

```text
CNY amount = currency CNY, unit yuan, scale 2
USD amount = currency USD, unit dollar, scale 2
```

A unit label can be written explicitly:

```aal
unitPrice: CNY amount, unit yuan
```

P0 still fixes the scale at two decimal places. Custom precision is not supported. A non-standard unit must come from a confirmed business requirement; neither AI nor the compiler should invent one.

Integer literals and exact two-decimal money literals are available in expressions:

```aal
if amount <= 0.00 CNY:
    failure: Amount must be positive
```

Text and Boolean literal syntax is not implemented yet. Closed business values use a declared `values` set instead of arbitrary text.

## Flows

Flows describe what happens:

```aal
flow: DeductInventory

    input:
        inventory: Inventory
        quantity: integer

    if quantity <= 0:
        failure: Quantity must be greater than zero

    if inventory's quantity < quantity:
        failure: Insufficient inventory

    change:
        inventory's quantity = inventory's quantity - quantity

    output:
        remainingInventory = inventory's quantity
```

Every flow must have an `output` section. An `if` condition must be Boolean. Its body may contain one explicit `failure` or nested business steps. A failed executed flow propagates the same failure to its containing flow.

### Atomic-flow principle

Here, “atomic” means a small audit responsibility. It does not mean transaction atomicity, and it does not mean that every flow becomes an HTTP entry.

When one flow combines several independently nameable responsibilities—such as querying context, deciding eligibility, validating an amount, calculating results, and changing state—AI should prefer small flows composed by one business-level orchestration flow. For example:

```text
RefundOrder
├── GetRefundContext
├── CheckRefundEligibility
├── CheckRefundAmount
└── ExecuteRefund
```

Each extracted flow should:

1. have a name that directly states one business action or decision;
2. use business data as inputs and outputs, never database connections, framework objects, or exception structures;
3. keep failures with the flow responsible for that decision;
4. leave the main flow focused on execution order and composition;
5. avoid mechanically wrapping a simple expression or creating a flow with no independent audit value.

The first review expands all relevant small flows. Later changes can focus primarily on the changed flow and its call relationships. HTTP entries normally target orchestration flows; internal small flows are not exposed externally.

Atomic audit responsibility and atomic state commit are different concerns. When several state changes must commit together, retain an explicit `atomic` block even after splitting the behavior into smaller flows.

## Calculations and state changes

Calculations name a derived value without mutating state:

```aal
calculate:
    total = unitPrice * quantity
```

Only `change` represents a real object mutation:

```aal
change:
    inventory's quantity = inventory's quantity - quantity
```

The target of `change` must be an object field. Inputs, calculations, and flow outputs cannot be mutated directly.

## Closed values, time, and atomic changes

Declare finite business values explicitly:

```aal
values: OrderStatus
    Unpaid
    Paid
    FullyRefunded
```

Members are typed values, not arbitrary strings. Members from different value sets cannot be compared or assigned to each other.

Time is an exact UTC instant. A duration literal such as `7 days` is a fixed multiple of 24 hours. An HTTP entry can provide trusted current time without accepting it from the request:

```aal
system provided:
    current time as operationTime
```

Use `atomic` when several creates and changes must commit together:

```aal
atomic:
    change:
        order's status = Paid
        inventory's quantity = inventory's quantity + quantity
```

The in-memory runtime stages the block, validates every create, and only then commits its creates and changes. This is not a database isolation or distributed-transaction guarantee.

## Flow composition

Call another business flow explicitly:

```aal
execute:
    CalculateOrderTotal

    use:
        unitPrice
        quantity

    get:
        total
```

`use` entries follow the declared input order of the executed flow. `get` names follow its declared output order. Input count, output count, and types are checked before code generation.

## Create, query, change, and delete

CRUD behavior remains inside flows:

```aal
flow: UpdateItem

    input:
        id: integer
        name: text

    query:
        item: Item

        where:
            item's id == id

        otherwise:
            failure: Item not found

    change:
        item's name = name

    output:
        item
```

`create` must assign every field and declare its duplicate-identity failure. `query` returns one object and declares its not-found failure. `delete` removes a previously created or queried object. The current runtime stores objects in memory only.

See [examples/items/app.aal](../../examples/items/app.aal) for complete create, read, update, and delete flows.

## HTTP entries

An HTTP entry maps request data to one flow:

```aal
HTTP entry: Update Item

    receive:
        PUT /items/{id}

    use flow:
        UpdateItem

    request path:
        id

    request body:
        name

    success:
        return 200

    if Item not found:
        return 404
```

Every flow input must be mapped exactly once. The default HTTP field name equals the AAL input name. A local difference is explicit:

```aal
request body:
    item_id as id
    display_name as name
```

Trusted time inputs are mapped separately under `system provided`; they cannot also be mapped from the path or body. HTTP money inputs use fixed two-decimal strings such as `"100.00"`, and money outputs use the same representation.

The MVP fixes these transport rules: invalid JSON, missing inputs, and wrong input types return `400`; unmatched routes return `404`; declared flow failures use their mapped status; unhandled runtime errors return `500`; and a successful `204` response has no body. Host and port are supplied at runtime and never appear in AAL.

## Expressions and operators

The parser recognizes:

```text
+  -  *  /  %  >  >=  <  <=  ==  !=  and  or  not  (  )
```

`=` assigns a calculation, change, or named output. Equality comparison uses `==`.

P0 type checking allows:

- integer arithmetic;
- addition and subtraction of amounts with identical currency, unit, and scale;
- multiplication of an amount by an integer in either order;
- comparison of compatible values;
- adding a duration such as `7 days` to a time;
- UTC time comparison;
- Boolean `and`, `or`, and `not`.

Integer `/` currently follows generated TypeScript numeric division. Its long-term rounding semantics have not been formalized, so do not use it where a fractional result is possible without a separately confirmed rule.

## Binding

AAL uses audit names directly by default. An optional [Binding file](./binding-guide.md) can preserve the audit field `number` under `Order` as a stable ID while emitting the program field `id`.

Without a Binding file, audit names are also program-facing names and the compiler creates deterministic temporary IDs for that build. Use an explicit Binding only when names must differ or identities must survive source renames or declaration reordering.

Binding is a separate build input. It must not add hidden business rules.

## Complete example and compilation

The basic English example is [examples/order/app.aal](../../examples/order/app.aal). The semantic-density example is currently Chinese-first at [examples/order-refund/app.zh-CN.aal](../../examples/order-refund/app.zh-CN.aal).

```bash
npm run compile:example
```

The current P0 compiler uses the last declared flow as the generated `run` entry. A future multi-entry protocol must be explicit rather than inferred from names.

Run the HTTP CRUD example with:

```bash
npm run demo:http
```

Run the frozen order-refund oracle with:

```bash
npm run test:order-refund
```

## Current P0 limits

P0 does not yet provide:

- text or Boolean literals;
- custom amount precision;
- persistence, database transactions, automatic IDs, list queries, or filters;
- third-party API, SDK, or database adapters;
- PATCH, CORS, authentication, retries, concurrency, or permissions.

Do not simulate these capabilities with hidden conventions.

## Review checklist

- [ ] Does the file start with one application header?
- [ ] Are the remaining top-level declarations only values, objects, flows, and HTTP entries?
- [ ] Does every object field and flow input have a type?
- [ ] Does every amount declare CNY or USD, and is every non-standard unit confirmed?
- [ ] Does every field relationship use the possessive form instead of dot access?
- [ ] Are all state changes explicit under `change`?
- [ ] Are multi-object all-or-nothing changes explicit under `atomic`?
- [ ] Are all flow compositions explicit under `execute / use / get`?
- [ ] Are all failure conditions and messages explicit?
- [ ] Does every CRUD object declare its identity?
- [ ] Does every HTTP entry map all flow inputs and failures explicitly?
- [ ] Did the AI avoid inventing business decisions?
