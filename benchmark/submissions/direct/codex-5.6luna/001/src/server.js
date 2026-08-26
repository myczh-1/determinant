const http = require('node:http');

const host = process.env.BENCHMARK_HOST || '127.0.0.1';
const port = Number.parseInt(process.env.BENCHMARK_PORT || '3000', 10);
const items = new Map();

function sendJson(response, statusCode, body) {
  const payload = JSON.stringify(body);
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
  });
  response.end(payload);
}

function sendNotFound(response) {
  sendJson(response, 404, { error: 'Not found' });
}

function sendItemNotFound(response) {
  sendJson(response, 404, { error: 'Item not found' });
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = '';

    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      body += chunk;
    });
    request.on('end', () => {
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    request.on('error', reject);
  });
}

function isItemInput(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Number.isInteger(value.id)
    && typeof value.name === 'string';
}

function isUpdateInput(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && typeof value.name === 'string';
}

function parsePathId(value) {
  if (!/^-?\d+$/.test(value)) {
    return null;
  }

  const id = Number(value);
  return Number.isInteger(id) ? id : null;
}

async function handleRequest(request, response) {
  const requestUrl = new URL(request.url, 'http://localhost');
  const path = requestUrl.pathname;

  if (request.method === 'POST' && path === '/items') {
    let input;
    try {
      input = await readJson(request);
    } catch (error) {
      if (error.message === 'Invalid JSON') {
        sendJson(response, 400, { error: 'Invalid JSON' });
        return;
      }
      throw error;
    }

    if (!isItemInput(input)) {
      sendJson(response, 400, { error: 'Invalid request input' });
      return;
    }

    if (items.has(input.id)) {
      sendJson(response, 409, { error: 'Item already exists' });
      return;
    }

    const item = { id: input.id, name: input.name };
    items.set(item.id, item);
    sendJson(response, 201, { item });
    return;
  }

  const match = path.match(/^\/items\/([^/]+)$/);
  if (!match || !['GET', 'PUT', 'DELETE'].includes(request.method)) {
    sendNotFound(response);
    return;
  }

  const id = parsePathId(match[1]);
  if (id === null) {
    sendNotFound(response);
    return;
  }

  if (!items.has(id)) {
    sendItemNotFound(response);
    return;
  }

  if (request.method === 'GET') {
    sendJson(response, 200, { item: items.get(id) });
    return;
  }

  if (request.method === 'DELETE') {
    items.delete(id);
    response.writeHead(204);
    response.end();
    return;
  }

  let input;
  try {
    input = await readJson(request);
  } catch (error) {
    if (error.message === 'Invalid JSON') {
      sendJson(response, 400, { error: 'Invalid JSON' });
      return;
    }
    throw error;
  }

  if (!isUpdateInput(input)) {
    sendJson(response, 400, { error: 'Invalid request input' });
    return;
  }

  const item = { id, name: input.name };
  items.set(id, item);
  sendJson(response, 200, { item });
}

const server = http.createServer((request, response) => {
  handleRequest(request, response).catch(() => {
    if (!response.headersSent) {
      sendJson(response, 500, { error: 'Internal server error' });
    }
  });
});

server.listen(port, host);
