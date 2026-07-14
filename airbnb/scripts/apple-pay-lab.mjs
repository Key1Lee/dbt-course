import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { DatabaseSync, constants } from "node:sqlite";
import { assertReadOnlySql } from "./lib/sql-safety.mjs";

const MODELS = [
  ["seed_apple_pay_customers", "seed", "one row per customer_id"],
  ["seed_apple_pay_merchants", "seed", "one row per merchant_id"],
  ["seed_apple_pay_devices", "seed", "one row per device_id"],
  ["seed_apple_pay_transactions", "seed", "one row per transaction_id"],
  ["stg_apple_pay_customers", "staging", "one cleaned row per customer_id"],
  ["stg_apple_pay_merchants", "staging", "one cleaned row per merchant_id"],
  ["stg_apple_pay_devices", "staging", "one cleaned row per device_id"],
  ["stg_apple_pay_transactions", "staging", "one cleaned row per transaction_id"],
  ["dim_apple_pay_customers", "dimension", "one row per customer_id"],
  ["dim_apple_pay_merchants", "dimension", "one row per merchant_id"],
  ["dim_apple_pay_devices", "dimension", "one row per device_id"],
  ["fct_apple_pay_transactions", "fact", "one row per transaction_id"],
  ["mart_apple_pay_daily_performance", "mart", "one row per transaction_date + currency + payment_channel"]
];

const EXAMPLES = {
  "daily-performance": {
    description: "Daily approval, refund, and requested-value metrics at the mart grain.",
    sql: `SELECT * FROM mart_apple_pay_daily_performance
      ORDER BY transaction_date, currency, payment_channel`
  },
  "merchant-approval": {
    description: "Compare merchant authorization performance.",
    sql: `SELECT m.merchant_name, m.merchant_category,
        COUNT(*) AS attempts, SUM(f.is_approved) AS approvals,
        ROUND(100.0 * SUM(f.is_approved) / COUNT(*), 1) AS approval_rate_pct,
        ROUND(SUM(CASE WHEN f.is_approved = 1 THEN f.amount ELSE 0 END), 2) AS approved_requested_amount
      FROM fct_apple_pay_transactions AS f
      JOIN dim_apple_pay_merchants AS m USING (merchant_id)
      GROUP BY m.merchant_name, m.merchant_category
      ORDER BY approval_rate_pct DESC, attempts DESC`
  },
  declines: {
    description: "Find decline reasons by payment network.",
    sql: `SELECT payment_network, decline_reason, COUNT(*) AS declines,
        ROUND(SUM(amount), 2) AS requested_amount
      FROM fct_apple_pay_transactions
      WHERE is_declined = 1
      GROUP BY payment_network, decline_reason
      ORDER BY declines DESC, requested_amount DESC`
  },
  "device-channel": {
    description: "Compare device types and payment channels.",
    sql: `SELECT d.device_type, f.payment_channel, COUNT(*) AS attempts,
        ROUND(100.0 * SUM(f.is_approved) / COUNT(*), 1) AS approval_rate_pct
      FROM fct_apple_pay_transactions AS f
      JOIN dim_apple_pay_devices AS d USING (device_id)
      GROUP BY d.device_type, f.payment_channel
      ORDER BY attempts DESC, d.device_type`
  }
};

const SEEDS = [
  ["seed_apple_pay_customers", new URL("../seeds/seed_apple_pay_customers.csv", import.meta.url)],
  ["seed_apple_pay_merchants", new URL("../seeds/seed_apple_pay_merchants.csv", import.meta.url)],
  ["seed_apple_pay_devices", new URL("../seeds/seed_apple_pay_devices.csv", import.meta.url)],
  ["seed_apple_pay_transactions", new URL("../seeds/seed_apple_pay_transactions.csv", import.meta.url)]
];

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
  return { headers, rows: data.map((values) => Object.fromEntries(headers.map((name, i) => [name, values[i] ?? ""]))) };
}

function insertCsv(database, tableName, url) {
  const { headers, rows } = parseCsv(readFileSync(url, "utf8"));
  const placeholders = headers.map(() => "?").join(", ");
  const statement = database.prepare(`INSERT INTO ${tableName} (${headers.join(", ")}) VALUES (${placeholders})`);
  for (const row of rows) {
    const values = headers.map((name) => {
      if (row[name] === "") return null;
      return tableName === "seed_apple_pay_transactions" && name === "amount" ? Number(row[name]) : row[name];
    });
    statement.run(...values);
  }
}

function createLabDatabase() {
  const database = new DatabaseSync(":memory:");
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

  // These views intentionally mirror models/apple_pay exactly, translated from Snowflake SQL to SQLite SQL.
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
  enableReadOnlyMode(database);
  return database;
}

function enableReadOnlyMode(database) {
  const names = ["ALTER_TABLE", "ANALYZE", "ATTACH", "CREATE_INDEX", "CREATE_TABLE", "CREATE_TEMP_INDEX",
    "CREATE_TEMP_TABLE", "CREATE_TEMP_TRIGGER", "CREATE_TEMP_VIEW", "CREATE_TRIGGER", "CREATE_VIEW",
    "CREATE_VTABLE", "DELETE", "DETACH", "DROP_INDEX", "DROP_TABLE", "DROP_TEMP_INDEX", "DROP_TEMP_TABLE",
    "DROP_TEMP_TRIGGER", "DROP_TEMP_VIEW", "DROP_TRIGGER", "DROP_VIEW", "DROP_VTABLE", "INSERT", "PRAGMA",
    "REINDEX", "TRANSACTION", "UPDATE"];
  const denied = new Set(names.map((name) => constants[`SQLITE_${name}`]));
  database.setAuthorizer((action) => denied.has(action) ? constants.SQLITE_DENY : constants.SQLITE_OK);
}

function printHelp() {
  console.log(`Apple Pay local query lab (checked-in CSV seeds, in-memory SQLite)

Usage:
  npm run lab
  npm run lab -- --tables
  npm run lab -- --examples
  npm run lab -- --example merchant-approval
  npm run lab -- --sql "SELECT * FROM fct_apple_pay_transactions LIMIT 5"
  npm run lab -- --file path/to/read-only-query.sql

Options:
  -s, --sql <sql>         Run one read-only SQL statement
  -q, --query <sql>       Alias for --sql
  -f, --file <path>       Run one read-only SQL statement from a file
  -e, --example <name>    Run a built-in example
      --tables            List relations, grains, and row counts
      --examples          List built-in examples
      --describe <name>   Show the SQL defining a relation
      --limit <number>    Maximum displayed rows (default 50, max 500)
  -h, --help              Show this help`);
}

function limitValue(raw) {
  const value = Number.parseInt(raw ?? "50", 10);
  if (!Number.isInteger(value) || value < 1 || value > 500) throw new Error("--limit must be 1 through 500.");
  return value;
}

function main() {
  const { values } = parseArgs({ options: {
    sql: { type: "string", short: "s" }, query: { type: "string", short: "q" },
    file: { type: "string", short: "f" }, example: { type: "string", short: "e" },
    tables: { type: "boolean" }, examples: { type: "boolean" }, describe: { type: "string" },
    limit: { type: "string", default: "50" }, help: { type: "boolean", short: "h" }
  }, strict: true });
  if (values.help) return printHelp();
  const actions = [values.sql, values.query, values.file, values.example, values.tables, values.examples, values.describe].filter(Boolean);
  if (actions.length > 1) throw new Error("Choose only one action at a time.");
  const database = createLabDatabase();
  try {
    if (values.tables) {
      console.table(MODELS.map(([name, layer, grain]) => ({ name, layer, grain,
        rows: database.prepare(`SELECT COUNT(*) AS count FROM ${name}`).get().count })));
      return;
    }
    if (values.examples) {
      console.table(Object.entries(EXAMPLES).map(([name, item]) => ({ name, description: item.description })));
      return;
    }
    if (values.describe) {
      if (!MODELS.some(([name]) => name === values.describe)) throw new Error(`Unknown relation: ${values.describe}`);
      const row = database.prepare("SELECT type, name, sql FROM sqlite_schema WHERE name = ?").get(values.describe);
      console.log(`${row.type}: ${row.name}\n\n${row.sql}`);
      return;
    }
    let sql = values.sql ?? values.query;
    if (values.file) sql = readFileSync(resolve(values.file), "utf8");
    const exampleName = values.example ?? (!actions.length ? "daily-performance" : undefined);
    if (exampleName) {
      const example = EXAMPLES[exampleName];
      if (!example) throw new Error(`Unknown example: ${exampleName}. Use --examples.`);
      console.log(`${example.description}\n`);
      sql = example.sql;
    }
    const rows = database.prepare(assertReadOnlySql(sql, "sqlite")).all();
    const visible = rows.slice(0, limitValue(values.limit)).map((row) => ({ ...row }));
    if (visible.length) console.table(visible); else console.log("Query returned no rows.");
    if (!actions.length) console.log("\nTry: npm run lab -- --examples");
  } finally { database.close(); }
}

try { main(); }
catch (error) { console.error(`Apple Pay lab error: ${error.message}`); process.exitCode = 1; }
