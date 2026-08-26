'use strict';

const http = require('http');

// In-memory store. Keys are numeric ids; values are { id, name }.
const items = new Map();

const HOST = process.env.BENCHMARK_HOST || '127.0.0.1';
const PORT = Number(process.env.BENCHMARK_PORT) || 8080;

const DECIMAL_INTEGER = /^-?\d+$/;

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Length', Buffer.byteLength(body));
  res.end(body);
}

function sendNoContent(res) {
  res.statusCode = 204;
  res.end();
}

// Strip any query string or fragment so routing sees only the path.
function pathnameOf(rawUrl) {
  let pathname = rawUrl || '/';
  const q = pathname.indexOf('?');
  if (q !== -1) pathname = pathname.slice(0, q);
  const h = pathname.indexOf('#');
  if (h !== -1) pathname = pathname.slice(0, h);
  return pathname;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// Parses the request body as a JSON object. Returns null when the body is
// not valid JSON; returns a sentinel object otherwise so callers can
// distinguish "invalid JSON" from a valid non-object JSON value.
function parseJsonObject(raw) {
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    return { invalidJson: true };
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { invalidShape: true };
  }
  return value;
}

async function handleCreate(req, res) {
  const parsed = parseJsonObject(await readBody(req));
  if (parsed.invalidJson) return sendJson(res, 400, { error: 'Invalid JSON' });
  if (parsed.invalidShape) return sendJson(res, 400, { error: 'Invalid request input' });

  if (!Number.isInteger(parsed.id)) return sendJson(res, 400, { error: 'Invalid request input' });
  if (typeof parsed.name !== 'string') return sendJson(res, 400, { error: 'Invalid request input' });

  if (items.has(parsed.id)) return sendJson(res, 409, { error: 'Item already exists' });

  const item = { id: parsed.id, name: parsed.name };
  items.set(parsed.id, item);
  return sendJson(res, 201, { item });
}

function handleRead(res, id) {
  const item = items.get(id);
  if (!item) return sendJson(res, 404, { error: 'Item not found' });
  return sendJson(res, 200, { item });
}

async function handleUpdate(req, res, id) {
  if (!items.has(id)) return sendJson(res, 404, { error: 'Item not found' });

  const parsed = parseJsonObject(await readBody(req));
  if (parsed.invalidJson) return sendJson(res, 400, { error: 'Invalid JSON' });
  if (parsed.invalidShape) return sendJson(res, 400, { error: 'Invalid request input' });
  if (typeof parsed.name !== 'string') return sendJson(res, 400, { error: 'Invalid request input' });

  const item = { id, name: parsed.name };
  items.set(id, item);
  return sendJson(res, 200, { item });
}

function handleDelete(res, id) {
  if (!items.has(id)) return sendJson(res, 404, { error: 'Item not found' });
  items.delete(id);
  return sendNoContent(res);
}

async function handleRequest(req, res) {
  const method = req.method;
  const pathname = pathnameOf(req.url);

  if (pathname === '/items') {
    if (method === 'POST') return handleCreate(req, res);
    return sendJson(res, 404, { error: 'Not found' });
  }

  const match = /^\/items\/([^/]+)$/.exec(pathname);
  if (match) {
    const rawId = match[1];
    if (!DECIMAL_INTEGER.test(rawId)) {
      return sendJson(res, 400, { error: 'Invalid request input' });
    }
    const id = Number(rawId);

    switch (method) {
      case 'GET': return handleRead(res, id);
      case 'PUT': return handleUpdate(req, res, id);
      case 'DELETE': return handleDelete(res, id);
      default: return sendJson(res, 404, { error: 'Not found' });
    }
  }

  return sendJson(res, 404, { error: 'Not found' });
}

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch(() => {
    if (!res.headersSent) {
      sendJson(res, 500, { error: 'Internal server error' });
    } else {
      res.destroy();
    }
  });
});

server.listen(PORT, HOST, () => {
  // Service bound to the configured address.
});
