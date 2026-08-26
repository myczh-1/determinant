import { createServer } from "node:http";

const host = process.env.BENCHMARK_HOST ?? "127.0.0.1";
const port = Number(process.env.BENCHMARK_PORT ?? "3000");

createServer((_request, response) => {
  response.statusCode = 404;
  response.end();
}).listen(port, host);
