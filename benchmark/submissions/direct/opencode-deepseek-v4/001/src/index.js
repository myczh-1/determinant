'use strict';

const http = require('http');

const MAX_BODY_BYTES = 1024 * 1024;

const store = new Map();

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function sendNoContent(res) {
  res.writeHead(204);
  res.end();
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf8'));
    });

    req.on('error', reject);
  });
}

function parseJson(raw) {
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch (err) {
    return { ok: false };
  }
}

function isValidCreatePayload(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Number.isInteger(value.id) &&
    typeof value.name === 'string'
  );
}

function parsePathId(raw) {
  if (!/^-?\d+$/.test(raw)) {
    return null;
  }
  return raw;
}

async function handleRequest(req, res) {
  const { method } = req;
  const url = new URL(req.url, 'http://localhost');
  const segments = url.pathname.split('/').filter((segment) => segment !== '');

  if (segments.length === 1 && segments[0] === 'items') {
    if (method === 'POST') {
      const raw = await readBody(req);
      const parsed = parseJson(raw);
      if (!parsed.ok) {
        sendJson(res, 400, { error: 'Invalid JSON' });
        return;
      }

      const body = parsed.value;
      if (!isValidCreatePayload(body)) {
        sendJson(res, 400, { error: 'Invalid request input' });
        return;
      }

      if (store.has(body.id)) {
        sendJson(res, 409, { error: 'Item already exists' });
        return;
      }

      const item = { id: body.id, name: body.name };
      store.set(body.id, item);
      sendJson(res, 201, { item });
      return;
    }
  }

  if (segments.length === 2 && segments[0] === 'items') {
    const id = parsePathId(segments[1]);
    if (id === null) {
      sendJson(res, 400, { error: 'Invalid request input' });
      return;
    }

    const numericId = Number(id);

    if (method === 'GET') {
      const item = store.get(numericId);
      if (item === undefined) {
        sendJson(res, 404, { error: 'Item not found' });
        return;
      }
      sendJson(res, 200, { item });
      return;
    }

    if (method === 'PUT') {
      if (!store.has(numericId)) {
        sendJson(res, 404, { error: 'Item not found' });
        return;
      }

      const raw = await readBody(req);
      const parsed = parseJson(raw);
      if (!parsed.ok) {
        sendJson(res, 400, { error: 'Invalid JSON' });
        return;
      }

      const body = parsed.value;
      if (
        body === null ||
        typeof body !== 'object' ||
        Array.isArray(body) ||
        typeof body.name !== 'string'
      ) {
        sendJson(res, 400, { error: 'Invalid request input' });
        return;
      }

      const item = { id: numericId, name: body.name };
      store.set(numericId, item);
      sendJson(res, 200, { item });
      return;
    }

    if (method === 'DELETE') {
      if (!store.has(numericId)) {
        sendJson(res, 404, { error: 'Item not found' });
        return;
      }
      store.delete(numericId);
      sendNoContent(res);
      return;
    }
  }

  sendJson(res, 404, { error: 'Not found' });
}

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch(() => {
    if (!res.headersSent) {
      sendJson(res, 500, { error: 'Internal server error' });
    } else {
      res.end();
    }
  });
});

server.on('clientError', (_err, socket) => {
  if (socket.writable) {
    socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
  }
});

server.on('error', (err) => {
  console.error(err.message);
  process.exit(1);
});

const host = process.env.BENCHMARK_HOST || '127.0.0.1';
const port = Number.parseInt(process.env.BENCHMARK_PORT, 10);

if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error('BENCHMARK_PORT must be a valid integer between 0 and 65535');
  process.exit(1);
}

server.listen(port, host, () => {
  const address = server.address();
  console.log(`listening on ${address.address}:${address.port}`);
});
