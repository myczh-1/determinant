# AAL English Reference for Challenge v1

This is the complete AAL authoring reference available for this task. AAL is indentation-sensitive. Use four spaces for each indentation level. Keywords are lowercase and case-sensitive except for the literal header `HTTP entry`.

Blank lines are allowed. Names start with a letter or underscore and then contain letters, numbers, or underscores.

## File and object

Every file starts with one application declaration:

```aal
application: ExampleApplication
```

Declare data and its identity:

```aal
object: Record

    id: integer
    label: text

    identity:
        id
```

Challenge v1 uses `integer`, `text`, and declared object names as types. Identity values are supplied by the request; IDs are not generated automatically.

## Create flow

```aal
flow: CreateRecord

    input:
        id: integer
        label: text

    create:
        record: Record

        with:
            record's id = id
            record's label = label

        otherwise:
            failure: Record already exists

    output:
        record
```

`create` must assign every field. The declared identity prevents duplicates. The failure text is externally visible and must match the business specification.

## Query flow

```aal
flow: ReadRecord

    input:
        id: integer

    query:
        record: Record

        where:
            record's id == id

        otherwise:
            failure: Record not found

    output:
        record
```

Challenge v1 queries exactly one object. Missing objects use the explicit failure message.

## Change flow

```aal
flow: RenameRecord

    input:
        id: integer
        label: text

    query:
        record: Record

        where:
            record's id == id

        otherwise:
            failure: Record not found

    change:
        record's label = label

    output:
        record
```

Only `change` mutates an existing object's field. Identity fields cannot be changed.

## Delete flow

```aal
flow: DeleteRecord

    input:
        id: integer

    query:
        record: Record

        where:
            record's id == id

        otherwise:
            failure: Record not found

    delete:
        record

    output:
        id
```

The deleted value must come from a preceding `query` or `create` in the same flow.

## HTTP entry

An HTTP entry maps one route to one flow:

```aal
HTTP entry: Rename Record

    receive:
        PUT /records/{id}

    use flow:
        RenameRecord

    request path:
        id

    request body:
        label

    success:
        return 200

    if Record not found:
        return 404
```

Rules:

- Every flow input is mapped exactly once.
- `request path` names values from `{placeholders}` in the route.
- `request body` names JSON fields.
- A successful response serializes the flow output names as a JSON object.
- `if <failure text>` maps an exact flow failure to an HTTP status.
- Invalid JSON, missing inputs, and wrong types automatically return `400`.
- Unmatched routes automatically return `404`.
- Unhandled runtime failures automatically return `500`.
- Successful status `204` has no response body.
- Host and port are runtime configuration and never appear in AAL.

## Surface restrictions

Use possessive field access such as `record's label`. Do not use dot access, classes, methods, functions, calls, `this`, `self`, JavaScript, TypeScript, or pseudocode.

Every flow must have an `output` section. CRUD behavior belongs in flows; HTTP entries only map transport data, success status, and declared failures.
