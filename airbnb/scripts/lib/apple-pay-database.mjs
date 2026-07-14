import { readFileSync } from "node:fs";
import { DatabaseSync, constants } from "node:sqlite";
import { assertReadOnlySql } from "./sql-safety.mjs";

export const DEFAULT_QUERY_ROWS = 50;
export const MAX_QUERY_ROWS = 500;

export const MODEL_CATALOG = Object.freeze([
  Object.freeze({ name: "seed_apple_pay_customers", layer: "seed", grain: "one row per customer_id" }),
  Object.freeze({ name: "seed_apple_pay_merchants", layer: "seed", grain: "one row per merchant_id" }),
  Object.freeze({ name: "seed_apple_pay_devices", layer: "seed", grain: "one row per device_id" }),
  Object.freeze({ name: "seed_apple_pay_transactions", layer: "seed", grain: "one row per transaction_id" }),
  Object.freeze({ name: "stg_apple_pay_customers", layer: "staging", grain: "one cleaned row per customer_id" }),
  Object.freeze({ name: "stg_apple_pay_merchants", layer: "staging", grain: "one cleaned row per merchant_id" }),
  Object.freeze({ name: "stg_apple_pay_devices", layer: "staging", grain: "one cleaned row per device_id" }),
  Object.freeze({ name: "stg_apple_pay_transactions", layer: "staging", grain: "one cleaned row per transaction_id" }),
  Object.freeze({ name: "dim_apple_pay_customers", layer: "dimension", grain: "one row per customer_id" }),
  Object.freeze({ name: "dim_apple_pay_merchants", layer: "dimension", grain: "one row per merchant_id" }),
  Object.freeze({ name: "dim_apple_pay_devices", layer: "dimension", grain: "one row per device_id" }),
  Object.freeze({ name: "fct_apple_pay_transactions", layer: "fact", grain: "one row per transaction_id" }),
  Object.freeze({
    name: "mart_apple_pay_daily_performance",
    layer: "mart",
    grain: "one row per transaction_date + currency + payment_channel"
  })
]);

export const QUERY_EXAMPLES = Object.freeze({
  "daily-performance": Object.freeze({
    description: "Daily approval, refund, and requested-value metrics at the mart grain.",
    sql: `SELECT * FROM mart_apple_pay_daily_performance
      ORDER BY transaction_date, currency, payment_channel`
  }),
  "merchant-approval": Object.freeze({
    description: "Compare merchant authorization performance.",
    sql: `SELECT m.merchant_name, m.merchant_category,
        COUNT(*) AS attempts, SUM(f.is_approved) AS approvals,
        ROUND(100.0 * SUM(f.is_approved) / COUNT(*), 1) AS approval_rate_pct,
        ROUND(SUM(CASE WHEN f.is_approved = 1 THEN f.amount ELSE 0 END), 2) AS approved_requested_amount
      FROM fct_apple_pay_transactions AS f
      JOIN dim_apple_pay_merchants AS m USING (merchant_id)
      GROUP BY m.merchant_name, m.merchant_category
      ORDER BY approval_rate_pct DESC, attempts DESC`
  }),
  declines: Object.freeze({
    description: "Find decline reasons by currency and payment network without mixing monetary units.",
    sql: `SELECT currency, payment_network, decline_reason, COUNT(*) AS declines,
        ROUND(SUM(amount), 2) AS requested_amount
      FROM fct_apple_pay_transactions
      WHERE is_declined = 1
      GROUP BY currency, payment_network, decline_reason
      ORDER BY declines DESC, requested_amount DESC, currency, payment_network`
  }),
  "device-channel": Object.freeze({
    description: "Compare device types and payment channels.",
    sql: `SELECT d.device_type, f.payment_channel, COUNT(*) AS attempts,
        ROUND(100.0 * SUM(f.is_approved) / COUNT(*), 1) AS approval_rate_pct
      FROM fct_apple_pay_transactions AS f
      JOIN dim_apple_pay_devices AS d USING (device_id)
      GROUP BY d.device_type, f.payment_channel
      ORDER BY attempts DESC, d.device_type`
  })
});

const MODEL_NAMES = new Set(MODEL_CATALOG.map(({ name }) => name));
const SEEDS = Object.freeze([
  ["seed_apple_pay_customers", new URL("../../seeds/seed_apple_pay_customers.csv", import.meta.url)],
  ["seed_apple_pay_merchants", new URL("../../seeds/seed_apple_pay_merchants.csv", import.meta.url)],
  ["seed_apple_pay_devices", new URL("../../seeds/seed_apple_pay_devices.csv", import.meta.url)],
  ["seed_apple_pay_transactions", new URL("../../seeds/seed_apple_pay_transactions.csv", import.meta.url)]
]);

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field.replace(/\r$/, ""));
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
      field = "";
    } else field += char;
  }

  if (field || row.length) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  if (!rows.length) throw new Error("A seed CSV is empty.");

  const [headers, ...data] = rows;
  for (const header of headers) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(header)) {
      throw new Error(`Unsafe CSV header: ${header}`);
    }
  }
  return {
    headers,
    rows: data.map((values) =>
      Object.fromEntries(headers.map((name, index) => [name, values[index] ?? ""]))
    )
  };
}

function insertCsv(database, tableName, url) {
  const { headers, rows } = parseCsv(readFileSync(url, "utf8"));
  const placeholders = headers.map(() => "?").join(", ");
  const statement = database.prepare(
    `INSERT INTO ${tableName} (${headers.join(", ")}) VALUES (${placeholders})`
  );

  for (const row of rows) {
    const values = headers.map((name) => {
      if (row[name] === "") return null;
      return tableName === "seed_apple_pay_transactions" && name === "amount"
        ? Number(row[name])
        : row[name];
    });
    statement.run(...values);
  }
}

function enableReadOnlyMode(database) {
  const deniedActionNames = [
    "ALTER_TABLE", "ANALYZE", "ATTACH", "COPY", "CREATE_INDEX", "CREATE_TABLE",
    "CREATE_TEMP_INDEX", "CREATE_TEMP_TABLE", "CREATE_TEMP_TRIGGER", "CREATE_TEMP_VIEW",
    "CREATE_TRIGGER", "CREATE_VIEW", "CREATE_VTABLE", "DELETE", "DETACH", "DROP_INDEX",
    "DROP_TABLE", "DROP_TEMP_INDEX", "DROP_TEMP_TABLE", "DROP_TEMP_TRIGGER", "DROP_TEMP_VIEW",
    "DROP_TRIGGER", "DROP_VIEW", "DROP_VTABLE", "INSERT", "PRAGMA", "REINDEX", "SAVEPOINT",
    "TRANSACTION", "UPDATE"
  ];
  const deniedActions = new Set(
    deniedActionNames
      .map((name) => constants[`SQLITE_${name}`])
      .filter((action) => action !== undefined)
  );
  database.setAuthorizer((action) =>
    deniedActions.has(action) ? constants.SQLITE_DENY : constants.SQLITE_OK
  );
}

export function normalizeQueryLimit(rawLimit = DEFAULT_QUERY_ROWS) {
  const value = typeof rawLimit === "number" ? rawLimit : Number(rawLimit);
  if (!Number.isInteger(value) || value < 1 || value > MAX_QUERY_ROWS) {
    throw new Error(`Row limit must be an integer from 1 through ${MAX_QUERY_ROWS}.`);
  }
  return value;
}

export function createLabDatabase() {
  const database = new DatabaseSync(":memory:", { allowExtension: false });
  try {
    database.exec(`
      CREATE TABLE seed_apple_pay_customers (
        customer_id TEXT PRIMARY KEY, customer_name TEXT, customer_country TEXT, signup_at TEXT
      ) STRICT;
      CREATE TABLE seed_apple_pay_merchants (
        merchant_id TEXT PRIMARY KEY, merchant_name TEXT, merchant_category TEXT, merchant_country TEXT
      ) STRICT;
      CREATE TABLE seed_apple_pay_devices (
        device_id TEXT PRIMARY KEY, customer_id TEXT, device_type TEXT, os_version TEXT, wallet_enrolled_at TEXT
      ) STRICT;
      CREATE TABLE seed_apple_pay_transactions (
        transaction_id TEXT PRIMARY KEY, customer_id TEXT, merchant_id TEXT, device_id TEXT,
        transaction_ts TEXT, amount REAL, currency TEXT, payment_channel TEXT,
        transaction_status TEXT, decline_reason TEXT, payment_network TEXT, card_type TEXT, updated_at TEXT
      ) STRICT;
    `);

    database.exec("BEGIN");
    for (const [tableName, url] of SEEDS) insertCsv(database, tableName, url);
    database.exec("COMMIT");

    // These views mirror models/apple_pay, translated from Snowflake SQL to SQLite SQL.
    database.exec(`
      CREATE VIEW stg_apple_pay_customers AS
      SELECT TRIM(customer_id) AS customer_id, NULLIF(TRIM(customer_name), '') AS customer_name,
        UPPER(TRIM(customer_country)) AS customer_country, signup_at FROM seed_apple_pay_customers;
      CREATE VIEW stg_apple_pay_merchants AS
      SELECT TRIM(merchant_id) AS merchant_id, NULLIF(TRIM(merchant_name), '') AS merchant_name,
        LOWER(TRIM(merchant_category)) AS merchant_category,
        UPPER(TRIM(merchant_country)) AS merchant_country FROM seed_apple_pay_merchants;
      CREATE VIEW stg_apple_pay_devices AS
      SELECT TRIM(device_id) AS device_id, TRIM(customer_id) AS customer_id,
        LOWER(TRIM(device_type)) AS device_type, TRIM(os_version) AS os_version,
        wallet_enrolled_at FROM seed_apple_pay_devices;
      CREATE VIEW stg_apple_pay_transactions AS
      SELECT TRIM(transaction_id) AS transaction_id, TRIM(customer_id) AS customer_id,
        TRIM(merchant_id) AS merchant_id, TRIM(device_id) AS device_id, transaction_ts,
        ROUND(amount, 2) AS amount, UPPER(TRIM(currency)) AS currency,
        LOWER(TRIM(payment_channel)) AS payment_channel,
        LOWER(TRIM(transaction_status)) AS transaction_status,
        NULLIF(LOWER(TRIM(decline_reason)), '') AS decline_reason,
        UPPER(TRIM(payment_network)) AS payment_network,
        LOWER(TRIM(card_type)) AS card_type, updated_at
      FROM seed_apple_pay_transactions;
      CREATE VIEW dim_apple_pay_customers AS
        SELECT customer_id, customer_name, customer_country, signup_at FROM stg_apple_pay_customers;
      CREATE VIEW dim_apple_pay_merchants AS
        SELECT merchant_id, merchant_name, merchant_category, merchant_country FROM stg_apple_pay_merchants;
      CREATE VIEW dim_apple_pay_devices AS
        SELECT device_id, customer_id, device_type, os_version, wallet_enrolled_at FROM stg_apple_pay_devices;
      CREATE VIEW fct_apple_pay_transactions AS
      SELECT transaction_id, transaction_ts, DATE(transaction_ts) AS transaction_date,
        customer_id, merchant_id, device_id, amount, currency, payment_channel,
        transaction_status, decline_reason, payment_network, card_type,
        CASE WHEN transaction_status IN ('authorized', 'settled', 'refunded') THEN 1 ELSE 0 END AS is_approved,
        CASE WHEN transaction_status = 'declined' THEN 1 ELSE 0 END AS is_declined, updated_at
      FROM stg_apple_pay_transactions;
      CREATE VIEW mart_apple_pay_daily_performance AS
      WITH daily_metrics AS (
        SELECT transaction_date, currency, payment_channel, COUNT(*) AS transaction_count,
          SUM(CASE WHEN is_approved = 1 THEN 1 ELSE 0 END) AS approved_transaction_count,
          SUM(CASE WHEN is_declined = 1 THEN 1 ELSE 0 END) AS declined_transaction_count,
          SUM(CASE WHEN transaction_status = 'refunded' THEN 1 ELSE 0 END) AS refunded_transaction_count,
          ROUND(SUM(amount), 2) AS requested_amount,
          ROUND(SUM(CASE WHEN is_approved = 1 THEN amount ELSE 0 END), 2) AS approved_requested_amount,
          ROUND(SUM(CASE WHEN transaction_status = 'refunded' THEN amount ELSE 0 END), 2) AS refunded_requested_amount
        FROM fct_apple_pay_transactions
        GROUP BY transaction_date, currency, payment_channel
      )
      SELECT *, ROUND(1.0 * approved_transaction_count / NULLIF(transaction_count, 0), 4) AS approval_rate
      FROM daily_metrics;
    `);

    database.enableLoadExtension(false);
    database.enableDefensive(true);
    enableReadOnlyMode(database);
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}

export function listRelations(database) {
  return MODEL_CATALOG.map(({ name, layer, grain }) => {
    const columns = database.prepare(`SELECT * FROM ${name} LIMIT 0`)
      .columns()
      .map((column) => column.name);
    const { count } = database.prepare(`SELECT COUNT(*) AS count FROM ${name}`).get();
    return { name, layer, grain, columns, rows: count };
  });
}

export function describeRelation(database, name) {
  if (!MODEL_NAMES.has(name)) throw new Error(`Unknown relation: ${name}`);
  const relation = database.prepare(
    "SELECT type, name, sql FROM sqlite_schema WHERE name = ?"
  ).get(name);
  if (!relation) throw new Error(`Unknown relation: ${name}`);
  return { ...relation };
}

function disambiguateColumnNames(names) {
  const used = new Set();
  return names.map((name, index) => {
    const base = name || `column_${index + 1}`;
    let candidate = base;
    let suffix = 2;
    while (used.has(candidate)) {
      candidate = `${base}__${suffix}`;
      suffix += 1;
    }
    used.add(candidate);
    return candidate;
  });
}

export function executeReadOnlyQuery(database, sql, { limit = DEFAULT_QUERY_ROWS } = {}) {
  const rowLimit = normalizeQueryLimit(limit);
  const statement = database.prepare(assertReadOnlySql(sql, "sqlite"));
  const columns = disambiguateColumnNames(statement.columns().map((column) => column.name));
  statement.setReturnArrays(true);
  const rows = [];
  let truncated = false;

  for (const values of statement.iterate()) {
    if (rows.length >= rowLimit) {
      truncated = true;
      break;
    }
    rows.push(Object.fromEntries(columns.map((column, index) => [column, values[index]])));
  }

  return {
    columns,
    rows,
    rowCount: rows.length,
    truncated,
    limit: rowLimit
  };
}
