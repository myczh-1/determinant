# HTTP CRUD Challenge v1

Implement an in-memory HTTP service for `Item` records.

This document is the complete behavioral specification. Do not look outside this workspace for examples, reference implementations, tests, scoring rules, or additional requirements. If something is genuinely ambiguous, report the ambiguity instead of searching outside the workspace.

## Data

An Item has exactly these business fields:

```text
id: integer
name: text
```

`id` is the stable unique identity. The service starts with no Items. State is retained only for the lifetime of the running process and resets after restart.

Do not add persistence, authentication, list endpoints, automatic IDs, PATCH, or unrelated behavior.

## Create

```http
POST /items
Content-Type: application/json
```

Request:

```json
{
  "id": 1,
  "name": "Book"
}
```

Success: status `201` with JSON:

```json
{
  "item": {
    "id": 1,
    "name": "Book"
  }
}
```

When the same identity already exists, return status `409` with:

```json
{
  "error": "Item already exists"
}
```

## Read

```http
GET /items/{id}
```

Success: status `200` with JSON:

```json
{
  "item": {
    "id": 1,
    "name": "Book"
  }
}
```

When the Item does not exist, return status `404` with:

```json
{
  "error": "Item not found"
}
```

## Update

```http
PUT /items/{id}
Content-Type: application/json
```

Request:

```json
{
  "name": "Notebook"
}
```

Success: status `200` with the updated Item:

```json
{
  "item": {
    "id": 1,
    "name": "Notebook"
  }
}
```

The change must affect later reads. When the Item does not exist, return status `404` with `{"error":"Item not found"}`.

## Delete

```http
DELETE /items/{id}
```

Success: status `204` with no response body and no `Content-Type` header.

The Item must be absent from later reads. When the Item does not exist, return status `404` with `{"error":"Item not found"}`.

## Input and general failures

An Item `id` must be an integer. A path `id` must be a valid decimal integer. `name` must be text.

Malformed JSON returns status `400` with:

```json
{
  "error": "Invalid JSON"
}
```

Missing inputs or wrong input types return status `400` with:

```json
{
  "error": "Invalid request input"
}
```

An unmatched path or HTTP method returns status `404` with:

```json
{
  "error": "Not found"
}
```

An unhandled runtime error returns status `500` with:

```json
{
  "error": "Internal server error"
}
```

Every response except a successful `204` must contain valid JSON and use the media type `application/json`. A charset parameter is allowed.

## Completion

Implement only the mode described by `AGENTS.md`. Keep the implementation clear and human-reviewable. Do not optimize for line count, minify source, hide behavior, generate implementation source, or leave a background service running.

In the final response, report only:

- files created or changed;
- validation performed;
- unresolved problems, if any.

Do not claim that the hidden benchmark passed. It is run independently after collection.
