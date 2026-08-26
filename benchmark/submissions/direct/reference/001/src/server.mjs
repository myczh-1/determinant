import { createServer } from "node:http";

const host = process.env.BENCHMARK_HOST ?? "127.0.0.1";
const port = Number(process.env.BENCHMARK_PORT ?? "3000");
const items = new Map();

const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url ?? "/", `http://${host}`).pathname;
    if (request.method === "POST" && pathname === "/items") {
      const body = await readJson(request);
      if (!body.ok) return send(response, 400, { error: body.error });
      if (!isInteger(body.value.id) || typeof body.value.name !== "string") {
        return send(response, 400, { error: "Invalid request input" });
      }
      if (items.has(body.value.id)) return send(response, 409, { error: "Item already exists" });
      const item = { id: body.value.id, name: body.value.name };
      items.set(item.id, item);
      return send(response, 201, { item });
    }

    const match = /^\/items\/([^/]+)$/u.exec(pathname);
    if (match) {
      const id = parseId(match[1]);
      if (id === null) return send(response, 400, { error: "Invalid request input" });
      if (request.method === "GET") {
        const item = items.get(id);
        return item ? send(response, 200, { item }) : send(response, 404, { error: "Item not found" });
      }
      if (request.method === "PUT") {
        const body = await readJson(request);
        if (!body.ok) return send(response, 400, { error: body.error });
        if (typeof body.value.name !== "string") return send(response, 400, { error: "Invalid request input" });
        const item = items.get(id);
        if (!item) return send(response, 404, { error: "Item not found" });
        item.name = body.value.name;
        return send(response, 200, { item });
      }
      if (request.method === "DELETE") {
        if (!items.has(id)) return send(response, 404, { error: "Item not found" });
        items.delete(id);
        response.statusCode = 204;
        response.end();
        return;
      }
    }

    return send(response, 404, { error: "Not found" });
  } catch {
    return send(response, 500, { error: "Internal server error" });
  }
});

server.listen(port, host);

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text.trim()) return { ok: false, error: "Invalid request input" };
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, error: "Invalid request input" };
    return { ok: true, value };
  } catch {
    return { ok: false, error: "Invalid JSON" };
  }
}

function parseId(value) {
  if (!/^-?(?:0|[1-9]\d*)$/u.test(value)) return null;
  const parsed = Number(value);
  return isInteger(parsed) ? parsed : null;
}

function isInteger(value) {
  return Number.isSafeInteger(value);
}

function send(response, status, body) {
  const payload = JSON.stringify(body);
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("content-length", Buffer.byteLength(payload));
  response.end(payload);
}
