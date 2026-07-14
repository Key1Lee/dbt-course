import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { Worker } from "node:worker_threads";
import {
  MAX_QUERY_ROWS,
  QUERY_EXAMPLES,
  createLabDatabase,
  listRelations
} from "./lib/apple-pay-database.mjs";
import { LESSONS, evaluateLesson } from "./lib/apple-pay-lessons.mjs";

const DEFAULT_PORT = 4173;
const DEFAULT_QUERY_TIMEOUT_MS = 3_000;
const MAX_BODY_BYTES = 64 * 1024;
const MAX_SQL_BYTES = 20 * 1024;
const UI_ROOT = new URL("../ui/", import.meta.url);
const WORKER_URL = new URL("./lib/query-worker.mjs", import.meta.url);

const STATIC_ROUTES = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/app.mjs", ["app.mjs", "text/javascript; charset=utf-8"]],
  ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
  ["/favicon.svg", ["favicon.svg", "image/svg+xml"]]
]);

const SECURITY_HEADERS = {
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY"
};

function jsonSafe(value) {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonSafe(item)]));
  }
  return value;
}

function sendJson(response, statusCode, payload, extraHeaders = {}) {
  const body = JSON.stringify(jsonSafe(payload));
  response.writeHead(statusCode, {
    ...SECURITY_HEADERS,
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    ...extraHeaders
  });
  response.end(body);
}

function sendText(response, statusCode, message, extraHeaders = {}) {
  const body = `${message}\n`;
  response.writeHead(statusCode, {
    ...SECURITY_HEADERS,
    "Cache-Control": "no-store",
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    ...extraHeaders
  });
  response.end(body);
}

function cleanErrorMessage(error) {
  return String(error?.message ?? "The request could not be completed.")
    .replace(/[A-Z]:\\[^\n]+/gi, "a local file")
    .slice(0, 500);
}

function readJsonBody(request) {
  return new Promise((resolvePromise, rejectPromise) => {
    let totalBytes = 0;
    let tooLarge = false;
    const chunks = [];
    request.on("data", (chunk) => {
      totalBytes += chunk.length;
      if (totalBytes > MAX_BODY_BYTES) {
        tooLarge = true;
        chunks.length = 0;
        return;
      }
      if (!tooLarge) chunks.push(chunk);
    });
    request.on("end", () => {
      if (tooLarge) {
        const error = new Error("The JSON request body is too large.");
        error.statusCode = 413;
        rejectPromise(error);
        return;
      }
      try {
        const body = Buffer.concat(chunks).toString("utf8");
        resolvePromise(JSON.parse(body));
      } catch {
        const error = new Error("Request body must be valid JSON.");
        error.statusCode = 400;
        rejectPromise(error);
      }
    });
    request.on("aborted", () => {
      const error = new Error("The request was interrupted.");
      error.statusCode = 400;
      rejectPromise(error);
    });
    request.on("error", rejectPromise);
  });
}

function runQueryWorker(payload, timeoutMs) {
  return new Promise((resolvePromise, rejectPromise) => {
    const worker = new Worker(WORKER_URL, { workerData: payload });
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      callback(value);
    };
    const timer = setTimeout(() => {
      const error = new Error("The query exceeded the 3 second learning-lab limit.");
      error.statusCode = 408;
      finish(rejectPromise, error);
    }, timeoutMs);
    worker.once("message", (message) => {
      if (message?.ok) finish(resolvePromise, message.result);
      else {
        const error = new Error(message?.error?.message ?? "The query worker failed.");
        error.statusCode = 400;
        finish(rejectPromise, error);
      }
    });
    worker.once("error", (error) => finish(rejectPromise, error));
    worker.once("exit", (code) => {
      if (!settled && code !== 0) finish(rejectPromise, new Error("The query worker stopped unexpectedly."));
    });
  });
}

function buildBootstrapData() {
  const database = createLabDatabase();
  try {
    return {
      productName: "Apple Pay Analytics Learning Lab",
      dataNotice: "Synthetic merchant-analytics training data — not an Apple production system.",
      catalog: listRelations(database),
      examples: Object.entries(QUERY_EXAMPLES).map(([id, item]) => ({ id, ...item })),
      lessons: LESSONS,
      maxQueryRows: MAX_QUERY_ROWS
    };
  } finally {
    database.close();
  }
}

function parsePort(rawPort) {
  const port = Number.parseInt(String(rawPort), 10);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("--port must be an integer from 1 to 65535.");
  }
  return port;
}

export function createLearningServer({ queryTimeoutMs = DEFAULT_QUERY_TIMEOUT_MS } = {}) {
  const bootstrap = buildBootstrapData();
  let queryRunning = false;

  const server = createServer(async (request, response) => {
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : DEFAULT_PORT;
    const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
    const allowedOrigins = new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`]);

    if (!allowedHosts.has(request.headers.host ?? "")) {
      sendJson(response, 403, { error: "This learning lab only accepts local requests." });
      return;
    }
    const origin = request.headers.origin;
    if (origin && !allowedOrigins.has(origin)) {
      sendJson(response, 403, { error: "Cross-origin requests are not allowed." });
      return;
    }

    let pathname;
    try {
      pathname = new URL(request.url ?? "/", `http://${request.headers.host}`).pathname;
    } catch {
      sendJson(response, 400, { error: "The request URL is invalid." });
      return;
    }

    if (pathname === "/api/health") {
      if (!new Set(["GET", "HEAD"]).has(request.method)) {
        sendJson(response, 405, { error: "Method not allowed." }, { Allow: "GET, HEAD" });
        return;
      }
      sendJson(response, 200, {
        status: "ok",
        database: "in-memory synthetic SQLite",
        relations: bootstrap.catalog.length,
        lessons: bootstrap.lessons.length
      });
      return;
    }

    if (pathname === "/api/bootstrap") {
      if (!new Set(["GET", "HEAD"]).has(request.method)) {
        sendJson(response, 405, { error: "Method not allowed." }, { Allow: "GET, HEAD" });
        return;
      }
      sendJson(response, 200, bootstrap);
      return;
    }

    if (pathname === "/api/query") {
      if (request.method !== "POST") {
        sendJson(response, 405, { error: "Method not allowed." }, { Allow: "POST" });
        return;
      }
      if (!(request.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) {
        sendJson(response, 415, { error: "Content-Type must be application/json." });
        return;
      }
      if (queryRunning) {
        sendJson(response, 429, { error: "Another query is running. Wait for it to finish." }, { "Retry-After": "1" });
        return;
      }

      queryRunning = true;
      try {
        const body = await readJsonBody(request);
        if (typeof body?.sql !== "string" || !body.sql.trim()) {
          const error = new Error("Provide a non-empty SQL query.");
          error.statusCode = 400;
          throw error;
        }
        if (Buffer.byteLength(body.sql, "utf8") > MAX_SQL_BYTES) {
          const error = new Error("SQL is limited to 20 KiB in the learning lab.");
          error.statusCode = 413;
          throw error;
        }
        const limit = Number(body.limit ?? 100);
        if (!Number.isInteger(limit) || limit < 1 || limit > MAX_QUERY_ROWS) {
          const error = new Error(`limit must be an integer from 1 to ${MAX_QUERY_ROWS}.`);
          error.statusCode = 400;
          throw error;
        }
        const lessonId = body.lessonId == null ? null : String(body.lessonId);
        if (lessonId && !LESSONS.some((lesson) => lesson.id === lessonId)) {
          const error = new Error("Unknown lesson identifier.");
          error.statusCode = 400;
          throw error;
        }

        const startedAt = performance.now();
        const result = await runQueryWorker({ id: randomUUID(), sql: body.sql, limit }, queryTimeoutMs);
        const durationMs = Math.max(1, Math.round(performance.now() - startedAt));
        const lessonCheck = lessonId ? evaluateLesson(lessonId, result.rows, result.columns) : null;
        sendJson(response, 200, { ...result, durationMs, lessonCheck });
      } catch (error) {
        if (!response.writableEnded) {
          sendJson(response, error.statusCode ?? 400, { error: cleanErrorMessage(error) });
        }
      } finally {
        queryRunning = false;
      }
      return;
    }

    const staticFile = STATIC_ROUTES.get(pathname);
    if (staticFile) {
      if (!new Set(["GET", "HEAD"]).has(request.method)) {
        sendText(response, 405, "Method not allowed.", { Allow: "GET, HEAD" });
        return;
      }
      const [fileName, contentType] = staticFile;
      const body = readFileSync(new URL(fileName, UI_ROOT));
      response.writeHead(200, {
        ...SECURITY_HEADERS,
        "Cache-Control": "no-cache",
        "Content-Type": contentType,
        "Content-Length": body.length
      });
      response.end(request.method === "HEAD" ? undefined : body);
      return;
    }

    sendText(response, 404, "Not found.");
  });

  server.on("clientError", (_error, socket) => {
    socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
  });
  return server;
}

export async function startLearningServer({ port = DEFAULT_PORT, queryTimeoutMs } = {}) {
  const server = createLearningServer({ queryTimeoutMs });
  await new Promise((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", rejectPromise);
      resolvePromise();
    });
  });
  return server;
}

async function main() {
  const { values } = parseArgs({
    options: {
      port: { type: "string", short: "p", default: String(DEFAULT_PORT) },
      help: { type: "boolean", short: "h" }
    },
    strict: true
  });
  if (values.help) {
    console.log(`Apple Pay Analytics Learning Lab\n\nUsage:\n  npm run ui\n  npm run ui -- --port 4174`);
    return;
  }
  const port = parsePort(values.port);
  const server = await startLearningServer({ port });
  console.log(`\nApple Pay Analytics Learning Lab is ready:\n  http://127.0.0.1:${port}\n\nPress Ctrl+C to stop.\n`);
  const stop = () => server.close(() => process.exit(0));
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error(`Learning UI error: ${cleanErrorMessage(error)}`);
    process.exitCode = 1;
  });
}
