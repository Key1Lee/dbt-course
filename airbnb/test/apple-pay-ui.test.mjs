import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import { after, before, test } from "node:test";

import { createLearningServer } from "../scripts/apple-pay-ui.mjs";

let server;
let baseUrl;
let allowedOrigin;

before(async () => {
  server = createLearningServer({ queryTimeoutMs: 5_000 });
  await new Promise((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", rejectPromise);
      resolvePromise();
    });
  });

  const address = server.address();
  assert.ok(address && typeof address === "object");
  baseUrl = `http://127.0.0.1:${address.port}`;
  allowedOrigin = baseUrl;
});

after(async () => {
  if (!server?.listening) return;
  await new Promise((resolvePromise, rejectPromise) => {
    server.close((error) => error ? rejectPromise(error) : resolvePromise());
    server.closeAllConnections?.();
  });
});

async function fetchJson(pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, options);
  const body = await response.json();
  return { response, body };
}

async function postJson(payload, headers = {}) {
  return fetchJson("/api/query", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: allowedOrigin,
      ...headers
    },
    body: JSON.stringify(payload)
  });
}

function rawRequest(pathname, { method = "GET", headers = {}, body = "" } = {}) {
  const url = new URL(pathname, baseUrl);
  return new Promise((resolvePromise, rejectPromise) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      callback(value);
    };
    const request = httpRequest({
      hostname: url.hostname,
      port: url.port,
      path: `${url.pathname}${url.search}`,
      method,
      headers
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        finish(resolvePromise, { response, text });
      });
      response.on("aborted", () => finish(rejectPromise, new Error("HTTP response was aborted.")));
      response.on("error", (error) => finish(rejectPromise, error));
    });
    request.on("error", (error) => finish(rejectPromise, error));
    request.setTimeout(5_000, () => request.destroy(new Error("HTTP request timed out.")));
    request.end(body);
  });
}

function assertSecurityHeaders(response) {
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.equal(response.headers.get("cross-origin-opener-policy"), "same-origin");
  assert.match(response.headers.get("content-security-policy") ?? "", /default-src 'self'/);
  assert.match(response.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'/);
}

test("health and bootstrap expose the local lab and exactly ten lessons", async () => {
  const health = await fetchJson("/api/health");
  assert.equal(health.response.status, 200);
  assert.deepEqual(health.body, {
    status: "ok",
    database: "in-memory synthetic SQLite",
    relations: 13,
    lessons: 10
  });
  assertSecurityHeaders(health.response);

  const bootstrap = await fetchJson("/api/bootstrap");
  assert.equal(bootstrap.response.status, 200);
  assert.equal(bootstrap.body.lessons.length, 10);
  assert.deepEqual(
    bootstrap.body.lessons.map((lesson) => lesson.number),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
  );
  assert.equal(new Set(bootstrap.body.lessons.map((lesson) => lesson.id)).size, 10);
  assert.equal(bootstrap.body.catalog.length, 13);
  assert.equal(bootstrap.body.maxQueryRows, 500);
  assert.match(bootstrap.body.dataNotice, /synthetic/i);
  assert.equal(bootstrap.response.headers.get("cache-control"), "no-store");
});

test("static index is served with browser security headers", async () => {
  const response = await fetch(`${baseUrl}/`);
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/);
  assert.equal(response.headers.get("cache-control"), "no-cache");
  assertSecurityHeaders(response);
  assert.match(html, /<!doctype html>/i);
  assert.match(html, /Apple Pay Analytics Learning Lab/i);

  const privateFile = await fetch(`${baseUrl}/package.json`);
  assert.equal(privateFile.status, 404);
});

test("safe read-only SQL returns bounded structured results", async () => {
  const { response, body } = await postJson({
    sql: `SELECT transaction_id, amount
      FROM fct_apple_pay_transactions
      ORDER BY transaction_id
      LIMIT 2`,
    limit: 10
  });

  assert.equal(response.status, 200);
  assert.deepEqual(body.columns, ["transaction_id", "amount"]);
  assert.deepEqual(body.rows, [
    { transaction_id: "T001", amount: 6.75 },
    { transaction_id: "T002", amount: 54.2 }
  ]);
  assert.equal(body.rowCount, 2);
  assert.equal(body.truncated, false);
  assert.equal(body.limit, 10);
  assert.equal(body.lessonCheck, null);
  assert.ok(Number.isFinite(body.durationMs) && body.durationMs >= 1);
});

test("duplicate SQL aliases stay distinct across the JSON API", async () => {
  const { response, body } = await postJson({
    sql: "SELECT 1 AS duplicate, 2 AS duplicate",
    limit: 10
  });

  assert.equal(response.status, 200);
  assert.deepEqual(body.columns, ["duplicate", "duplicate__2"]);
  assert.deepEqual(body.rows, [{ duplicate: 1, duplicate__2: 2 }]);
});

test("a lesson solution is evaluated through the query endpoint", async () => {
  const bootstrap = await fetchJson("/api/bootstrap");
  const lesson = bootstrap.body.lessons.find(({ id }) => id === "lesson-1");
  assert.ok(lesson);

  const { response, body } = await postJson({
    sql: lesson.solutionSql,
    lessonId: lesson.id,
    limit: 100
  });

  assert.equal(response.status, 200);
  assert.deepEqual(body.lessonCheck, {
    passed: true,
    message: lesson.completionMessage
  });
});

test("mutating SQL is rejected without damaging subsequent reads", async () => {
  const rejected = await postJson({
    sql: "DELETE FROM seed_apple_pay_transactions",
    limit: 10
  });
  assert.equal(rejected.response.status, 400);
  assert.match(rejected.body.error, /read-only|rejected|DELETE/i);
  assert.doesNotMatch(rejected.body.error, /\bat\s+file:|[A-Z]:\\/i);

  const followUp = await postJson({
    sql: "SELECT COUNT(*) AS transaction_count FROM seed_apple_pay_transactions",
    limit: 10
  });
  assert.equal(followUp.response.status, 200);
  assert.deepEqual(followUp.body.rows, [{ transaction_count: 18 }]);
});

test("malformed JSON, content type, method, and origin protections fail closed", async () => {
  const malformed = await fetchJson("/api/query", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: allowedOrigin },
    body: "{not-json"
  });
  assert.equal(malformed.response.status, 400);
  assert.match(malformed.body.error, /valid JSON/i);

  const wrongType = await fetchJson("/api/query", {
    method: "POST",
    headers: { "Content-Type": "text/plain", Origin: allowedOrigin },
    body: "SELECT 1"
  });
  assert.equal(wrongType.response.status, 415);

  const wrongMethod = await fetchJson("/api/query");
  assert.equal(wrongMethod.response.status, 405);
  assert.equal(wrongMethod.response.headers.get("allow"), "POST");

  const wrongOrigin = await fetchJson("/api/query", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://example.com" },
    body: JSON.stringify({ sql: "SELECT 1" })
  });
  assert.equal(wrongOrigin.response.status, 403);
  assert.match(wrongOrigin.body.error, /cross-origin/i);
});

test("a partial JSON upload does not reserve the query worker", async () => {
  const url = new URL("/api/query", baseUrl);
  const partialRequest = httpRequest({
    hostname: url.hostname,
    port: url.port,
    path: url.pathname,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": 1_000,
      Origin: allowedOrigin
    }
  });
  partialRequest.on("response", (response) => response.resume());
  partialRequest.on("error", () => {});
  partialRequest.flushHeaders();
  partialRequest.write('{"sql":"SELECT 1","padding":"');

  await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
  try {
    const parallel = await postJson({ sql: "SELECT 1 AS value", limit: 1 });
    assert.equal(parallel.response.status, 200);
    assert.deepEqual(parallel.body.rows, [{ value: 1 }]);
  } finally {
    partialRequest.destroy();
  }
});

test("row limits are enforced and truncation is reported", async () => {
  const bounded = await postJson({
    sql: "SELECT transaction_id FROM fct_apple_pay_transactions ORDER BY transaction_id",
    limit: 2
  });
  assert.equal(bounded.response.status, 200);
  assert.equal(bounded.body.rows.length, 2);
  assert.equal(bounded.body.rowCount, 2);
  assert.equal(bounded.body.truncated, true);
  assert.equal(bounded.body.limit, 2);

  const invalid = await postJson({ sql: "SELECT 1", limit: 501 });
  assert.equal(invalid.response.status, 400);
  assert.match(invalid.body.error, /1 to 500/i);
});

test("oversized SQL and JSON request bodies receive 413 responses", async () => {
  const oversizedSql = await postJson({
    sql: `SELECT '${"x".repeat(21 * 1024)}' AS oversized`,
    limit: 1
  });
  assert.equal(oversizedSql.response.status, 413);
  assert.match(oversizedSql.body.error, /20 KiB/i);

  const body = JSON.stringify({ sql: "SELECT 1", padding: "x".repeat(65 * 1024) });
  const oversizedBody = await rawRequest("/api/query", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
      Origin: allowedOrigin
    },
    body
  });
  assert.equal(oversizedBody.response.statusCode, 413);
  assert.match(oversizedBody.text, /too large/i);
});

test("overlong queries are terminated by the worker timeout", async () => {
  const timeoutServer = createLearningServer({ queryTimeoutMs: 1 });
  await new Promise((resolvePromise, rejectPromise) => {
    timeoutServer.once("error", rejectPromise);
    timeoutServer.listen(0, "127.0.0.1", () => {
      timeoutServer.off("error", rejectPromise);
      resolvePromise();
    });
  });

  try {
    const address = timeoutServer.address();
    assert.ok(address && typeof address === "object");
    const timeoutUrl = `http://127.0.0.1:${address.port}`;
    const response = await fetch(`${timeoutUrl}/api/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: timeoutUrl },
      body: JSON.stringify({ sql: "SELECT 1 AS value", limit: 1 })
    });
    const body = await response.json();
    assert.equal(response.status, 408);
    assert.match(body.error, /exceeded the 3 second learning-lab limit/i);
  } finally {
    await new Promise((resolvePromise) => {
      timeoutServer.close(() => resolvePromise());
      timeoutServer.closeAllConnections?.();
    });
  }
});
