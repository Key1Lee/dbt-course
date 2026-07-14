import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  QUERY_EXAMPLES,
  createLabDatabase,
  describeRelation,
  executeReadOnlyQuery,
  listRelations
} from "./lib/apple-pay-database.mjs";

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
      console.table(listRelations(database).map(({ name, layer, grain, rows }) => ({
        name, layer, grain, rows
      })));
      return;
    }
    if (values.examples) {
      console.table(Object.entries(QUERY_EXAMPLES).map(([name, item]) => ({
        name, description: item.description
      })));
      return;
    }
    if (values.describe) {
      const row = describeRelation(database, values.describe);
      console.log(`${row.type}: ${row.name}\n\n${row.sql}`);
      return;
    }
    let sql = values.sql ?? values.query;
    if (values.file) sql = readFileSync(resolve(values.file), "utf8");
    const exampleName = values.example ?? (!actions.length ? "daily-performance" : undefined);
    if (exampleName) {
      const example = QUERY_EXAMPLES[exampleName];
      if (!example) throw new Error(`Unknown example: ${exampleName}. Use --examples.`);
      console.log(`${example.description}\n`);
      sql = example.sql;
    }
    const result = executeReadOnlyQuery(database, sql, { limit: limitValue(values.limit) });
    if (result.rows.length) console.table(result.rows); else console.log("Query returned no rows.");
    if (!actions.length) console.log("\nTry: npm run lab -- --examples");
  } finally { database.close(); }
}

try { main(); }
catch (error) { console.error(`Apple Pay lab error: ${error.message}`); process.exitCode = 1; }
