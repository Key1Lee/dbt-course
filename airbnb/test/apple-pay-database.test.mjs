import assert from "node:assert/strict";
import test from "node:test";
import { Worker } from "node:worker_threads";
import {
  MAX_QUERY_ROWS,
  MODEL_CATALOG,
  QUERY_EXAMPLES,
  createLabDatabase,
  describeRelation,
  executeReadOnlyQuery,
  listRelations,
  normalizeQueryLimit
} from "../scripts/lib/apple-pay-database.mjs";

const WORKER_URL = new URL("../scripts/lib/query-worker.mjs", import.meta.url);

function withDatabase(callback) {
  const database = createLabDatabase();
  try {
    return callback(database);
  } finally {
    database.close();
  }
}

function runWorker(workerData) {
  return new Promise((resolvePromise, rejectPromise) => {
    const worker = new Worker(WORKER_URL, { workerData });
    let reply;
    worker.once("message", (message) => {
      reply = message;
    });
    worker.once("error", rejectPromise);
    worker.once("exit", (code) => {
      if (code !== 0) rejectPromise(new Error(`Query worker exited with code ${code}.`));
      else if (!reply) rejectPromise(new Error("Query worker exited without a response."));
      else resolvePromise(reply);
    });
  });
}

test("builds the complete Apple Pay relation catalog from checked-in seeds", () => {
  withDatabase((database) => {
    const relations = listRelations(database);
    assert.equal(MODEL_CATALOG.length, 13);
    assert.equal(relations.length, 13);
    assert.deepEqual(
      Object.fromEntries(relations.map(({ name, rows }) => [name, rows])),
      {
        seed_apple_pay_customers: 6,
        seed_apple_pay_merchants: 5,
        seed_apple_pay_devices: 7,
        seed_apple_pay_transactions: 18,
        stg_apple_pay_customers: 6,
        stg_apple_pay_merchants: 5,
        stg_apple_pay_devices: 7,
        stg_apple_pay_transactions: 18,
        dim_apple_pay_customers: 6,
        dim_apple_pay_merchants: 5,
        dim_apple_pay_devices: 7,
        fct_apple_pay_transactions: 18,
        mart_apple_pay_daily_performance: 13
      }
    );
    assert.deepEqual(
      relations.find(({ name }) => name === "fct_apple_pay_transactions").columns.slice(0, 4),
      ["transaction_id", "transaction_ts", "transaction_date", "customer_id"]
    );
  });
});

test("fact flags preserve the expected transaction grain and outcomes", () => {
  withDatabase((database) => {
    const result = executeReadOnlyQuery(database, `
      SELECT COUNT(*) AS transactions,
        COUNT(DISTINCT transaction_id) AS unique_transactions,
        SUM(is_approved) AS approved,
        SUM(is_declined) AS declined
      FROM fct_apple_pay_transactions
    `);
    assert.deepEqual(result.columns, ["transactions", "unique_transactions", "approved", "declined"]);
    assert.deepEqual(result.rows, [{
      transactions: 18,
      unique_transactions: 18,
      approved: 14,
      declined: 4
    }]);
    assert.equal(result.truncated, false);
  });
});

test("decline example keeps currency in the aggregation grain", () => {
  withDatabase((database) => {
    const result = executeReadOnlyQuery(database, QUERY_EXAMPLES.declines.sql);
    assert.deepEqual(result.columns, [
      "currency", "payment_network", "decline_reason", "declines", "requested_amount"
    ]);
    assert.equal(result.rows.length, 4);

    const insufficientFunds = result.rows.filter(
      ({ payment_network, decline_reason }) =>
        payment_network === "VISA" && decline_reason === "insufficient_funds"
    );
    assert.deepEqual(
      insufficientFunds.map(({ currency, declines, requested_amount }) => ({
        currency, declines, requested_amount
      })),
      [
        { currency: "CAD", declines: 1, requested_amount: 31.2 },
        { currency: "USD", declines: 1, requested_amount: 2.5 }
      ]
    );
  });
});

test("query iteration applies a hard row cap and reports truncation", () => {
  withDatabase((database) => {
    const result = executeReadOnlyQuery(database, `
      WITH RECURSIVE numbers(value) AS (
        SELECT 1 UNION ALL SELECT value + 1 FROM numbers WHERE value < 20
      )
      SELECT value FROM numbers ORDER BY value
    `, { limit: 3 });
    assert.deepEqual(result.rows, [{ value: 1 }, { value: 2 }, { value: 3 }]);
    assert.equal(result.rowCount, 3);
    assert.equal(result.limit, 3);
    assert.equal(result.truncated, true);
  });

  assert.equal(normalizeQueryLimit(MAX_QUERY_ROWS), MAX_QUERY_ROWS);
  for (const invalid of [0, -1, MAX_QUERY_ROWS + 1, 1.5, "3x", null]) {
    assert.throws(() => normalizeQueryLimit(invalid), /Row limit must be an integer/);
  }
});

test("returns column metadata when a query has no rows", () => {
  withDatabase((database) => {
    const result = executeReadOnlyQuery(
      database,
      "SELECT transaction_id, amount FROM fct_apple_pay_transactions WHERE 1 = 0"
    );
    assert.deepEqual(result.columns, ["transaction_id", "amount"]);
    assert.deepEqual(result.rows, []);
    assert.equal(result.truncated, false);
  });
});

test("duplicate output names preserve positional values with safe aliases", () => {
  withDatabase((database) => {
    const result = executeReadOnlyQuery(
      database,
      "SELECT 1 AS duplicate, 2 AS duplicate, 3 AS duplicate__2"
    );
    assert.deepEqual(result.columns, ["duplicate", "duplicate__2", "duplicate__2__2"]);
    assert.deepEqual(result.rows, [{ duplicate: 1, duplicate__2: 2, duplicate__2__2: 3 }]);
  });
});

test("SQLite itself stays defensive and read-only after initialization", () => {
  withDatabase((database) => {
    assert.throws(
      () => database.prepare("DELETE FROM seed_apple_pay_transactions").run(),
      /not authorized/i
    );
    assert.throws(() => database.exec("CREATE TABLE unexpected (id INTEGER)"), /not authorized/i);
    assert.throws(() => database.exec("PRAGMA writable_schema = ON"), /not authorized/i);
    assert.throws(() => database.enableLoadExtension(true), /disabled at database creation/i);

    const count = database.prepare(
      "SELECT COUNT(*) AS count FROM seed_apple_pay_transactions"
    ).get().count;
    assert.equal(count, 18);
  });
});

test("relation descriptions are allowlisted", () => {
  withDatabase((database) => {
    const relation = describeRelation(database, "fct_apple_pay_transactions");
    assert.equal(relation.type, "view");
    assert.equal(relation.name, "fct_apple_pay_transactions");
    assert.match(relation.sql, /CREATE VIEW fct_apple_pay_transactions/i);
    assert.throws(() => describeRelation(database, "sqlite_schema"), /Unknown relation/);
  });
});

test("workerData protocol returns bounded results and sanitized query errors", async () => {
  const reply = await runWorker({
    id: "query-1",
    sql: "SELECT transaction_id FROM fct_apple_pay_transactions ORDER BY transaction_id",
    limit: 2
  });
  assert.equal(reply.id, "query-1");
  assert.equal(reply.ok, true);
  assert.deepEqual(reply.result.columns, ["transaction_id"]);
  assert.deepEqual(reply.result.rows, [{ transaction_id: "T001" }, { transaction_id: "T002" }]);
  assert.equal(reply.result.truncated, true);
  assert.ok(reply.result.durationMs >= 0);

  const rejected = await runWorker({
    id: "query-2",
    sql: "DELETE FROM seed_apple_pay_transactions",
    limit: 10
  });
  assert.deepEqual(rejected, {
    id: "query-2",
    ok: false,
    error: { message: "Read-only mode rejected a statement beginning with DELETE." }
  });
  assert.equal("stack" in rejected.error, false);
});
