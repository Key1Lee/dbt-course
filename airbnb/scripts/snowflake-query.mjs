import { createPrivateKey } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { assertReadOnlySql, sqlCodeOnly } from "./lib/sql-safety.mjs";

function printHelp() {
  console.log(`Read-only Snowflake query tool for dbt relations

Usage:
  npm run query:snowflake -- --check
  npm run query:snowflake -- --list-models
  npm run query:snowflake -- --model dim_listings_cleansed --limit 10
  npm run query:snowflake -- --model dim_hosts_cleansed.v2 --limit 10
  npm run query:snowflake -- --query "SELECT * FROM AIRBNB.PROD.DIM_LISTINGS_CLEANSED LIMIT 10"
  npm run query:snowflake -- --file path/to/compiled-query.sql

Options:
  -q, --query <sql>        Run one read-only Snowflake statement
  -f, --file <path>        Run one read-only statement from a file (no dbt/Jinja compilation)
  -m, --model <selector>   Query by model name, version selector, or physical alias
      --manifest <path>    Manifest path (default target/manifest.json)
      --list-models        List dbt relations from the manifest; no connection needed
      --check              Show the connected Snowflake session context
      --limit <number>     Row limit for --model (default 20, max 1000)
      --max-rows <number>  Maximum rows requested/printed (default 50, max 1000)
  -h, --help               Show this help

The SQL guard is intentionally restrictive. The REPORTER role in .env is the
real read-only security boundary.`);
}

function parseBoundedInteger(rawValue, optionName, fallback) {
  const value = Number.parseInt(rawValue ?? String(fallback), 10);
  if (!Number.isInteger(value) || value < 1 || value > 1000) {
    throw new Error(`${optionName} must be an integer from 1 to 1000.`);
  }
  return value;
}

function boundWarehouseRows(sqlText, rowLimit) {
  const tokens = sqlCodeOnly(sqlText).toUpperCase().match(/[A-Z_][A-Z0-9_$]*/g) ?? [];
  if (!["SELECT", "WITH"].includes(tokens[0])) return sqlText;
  return `SELECT * FROM (\n${sqlText}\n) AS NODE_QUERY_RESULT LIMIT ${rowLimit}`;
}

function loadManifest(manifestPath) {
  const absolutePath = resolve(manifestPath);
  if (!existsSync(absolutePath)) {
    throw new Error(
      `dbt manifest not found at ${absolutePath}. Run dbt compile/build first, or use --query.`
    );
  }
  return JSON.parse(readFileSync(absolutePath, "utf8"));
}

function manifestRelations(manifest) {
  return Object.values(manifest.nodes ?? {})
    .filter((node) => ["model", "seed", "snapshot"].includes(node.resource_type))
    .map((node) => {
      const version = node.version ?? null;
      return {
        selector: version === null ? node.name : `${node.name}.v${version}`,
        name: node.name,
        version: version ?? "",
        alias: node.alias ?? node.name,
        type: node.resource_type,
        materialized: node.config?.materialized ?? "n/a",
        relation: node.relation_name ?? "<ephemeral>"
      };
    })
    .sort((left, right) => left.selector.localeCompare(right.selector));
}

function relationForModel(manifest, modelName) {
  const requested = modelName.toLowerCase();
  const matches = manifestRelations(manifest).filter((model) =>
    [model.selector, model.alias, model.name].some((candidate) =>
      candidate.toLowerCase() === requested
    )
  );
  if (!matches.length) throw new Error(`Model ${modelName} was not found in the manifest.`);
  if (matches.length > 1) {
    const choices = matches.map((model) => model.selector).join(", ");
    throw new Error(`Model name ${modelName} is ambiguous. Choose one of: ${choices}.`);
  }
  if (matches[0].relation === "<ephemeral>") {
    throw new Error(`${modelName} is ephemeral and has no physical relation to query.`);
  }
  return matches[0].relation;
}

function requiredEnvironment(name, fallbackName) {
  const value = process.env[name] ?? (fallbackName ? process.env[fallbackName] : undefined);
  if (!value?.trim()) {
    throw new Error(`Missing ${name}${fallbackName ? ` (or ${fallbackName})` : ""} in .env/environment.`);
  }
  return value.trim();
}

function decryptedPrivateKey(pem, passphrase) {
  try {
    const keyObject = createPrivateKey({
      key: pem.replaceAll("\\n", "\n"),
      format: "pem",
      passphrase: passphrase || undefined
    });
    return keyObject.export({ format: "pem", type: "pkcs8" }).toString();
  } catch {
    throw new Error("PRIVATE_KEY could not be parsed. Check the PEM text and passphrase.");
  }
}

function connectionOptions() {
  const account = requiredEnvironment("SNOWFLAKE_ACCOUNT");
  const username = requiredEnvironment("SNOWFLAKE_USER", "DBT_USER");
  const inlineKey = process.env.PRIVATE_KEY ?? process.env.SNOWFLAKE_PRIVATE_KEY;
  const keyPath = process.env.SNOWFLAKE_PRIVATE_KEY_PATH;
  const password = process.env.SNOWFLAKE_PASSWORD;
  const authenticator = (
    process.env.SNOWFLAKE_AUTHENTICATOR
      ?? (inlineKey || keyPath ? "SNOWFLAKE_JWT" : password ? "SNOWFLAKE" : "")
  ).toUpperCase();
  if (!authenticator) {
    throw new Error(
      "Choose authentication in .env: key pair, password, or SNOWFLAKE_AUTHENTICATOR=EXTERNALBROWSER."
    );
  }

  const options = {
    account,
    username,
    authenticator,
    role: process.env.SNOWFLAKE_ROLE ?? "REPORTER",
    warehouse: process.env.SNOWFLAKE_WAREHOUSE ?? "COMPUTE_WH",
    database: process.env.SNOWFLAKE_DATABASE ?? "AIRBNB",
    application: "DBT_NODE_QUERY_LAB"
  };
  const schema = process.env.SNOWFLAKE_SCHEMA
    ?? (process.env.DBT_ENV_NAME ? `DBT_${process.env.DBT_ENV_NAME.trim().toUpperCase()}` : undefined);
  if (schema) options.schema = schema;

  if (authenticator === "SNOWFLAKE_JWT") {
    if (inlineKey && keyPath) throw new Error("Set PRIVATE_KEY or SNOWFLAKE_PRIVATE_KEY_PATH, not both.");
    if (!inlineKey && !keyPath) throw new Error("SNOWFLAKE_JWT requires PRIVATE_KEY or SNOWFLAKE_PRIVATE_KEY_PATH.");
    if (inlineKey) {
      options.privateKey = decryptedPrivateKey(inlineKey, process.env.PRIVATE_KEY_PASSPHRASE);
    } else {
      const absoluteKeyPath = resolve(keyPath);
      if (!existsSync(absoluteKeyPath)) throw new Error(`Private key file not found: ${absoluteKeyPath}`);
      options.privateKeyPath = absoluteKeyPath;
      if (process.env.PRIVATE_KEY_PASSPHRASE) {
        options.privateKeyPass = process.env.PRIVATE_KEY_PASSPHRASE;
      }
    }
  } else if (["SNOWFLAKE", "USERNAME_PASSWORD_MFA"].includes(authenticator)) {
    if (!password) throw new Error(`${authenticator} requires SNOWFLAKE_PASSWORD.`);
    options.password = password;
  }

  return options;
}

async function loadDriver() {
  try {
    const module = await import("snowflake-sdk");
    return module.default ?? module;
  } catch (error) {
    if (error.code === "ERR_MODULE_NOT_FOUND") {
      throw new Error("snowflake-sdk is not installed. Run npm install, then try again.");
    }
    throw error;
  }
}

function connect(connection) {
  return new Promise((resolvePromise, rejectPromise) => {
    connection.connect((error, connected) =>
      error ? rejectPromise(error) : resolvePromise(connected)
    );
  });
}

function execute(connection, sqlText) {
  return new Promise((resolvePromise, rejectPromise) => {
    connection.execute({
      sqlText,
      complete(error, statement, rows) {
        if (error) rejectPromise(error);
        else resolvePromise({ statement, rows: rows ?? [] });
      }
    });
  });
}

function destroy(connection) {
  return new Promise((resolvePromise) => {
    connection.destroy((error) => {
      if (error) console.warn(`Warning while closing Snowflake connection: ${error.message}`);
      resolvePromise();
    });
  });
}

async function main() {
  const { values } = parseArgs({
    options: {
      query: { type: "string", short: "q" },
      file: { type: "string", short: "f" },
      model: { type: "string", short: "m" },
      manifest: { type: "string", default: "target/manifest.json" },
      "list-models": { type: "boolean" },
      check: { type: "boolean" },
      limit: { type: "string", default: "20" },
      "max-rows": { type: "string", default: "50" },
      help: { type: "boolean", short: "h" }
    },
    strict: true
  });

  if (values.help) {
    printHelp();
    return;
  }
  const actions = [values.query, values.file, values.model, values["list-models"], values.check]
    .filter(Boolean).length;
  if (!actions) {
    printHelp();
    return;
  }
  if (actions > 1) throw new Error("Choose only one query action at a time.");

  if (values["list-models"]) {
    console.table(manifestRelations(loadManifest(values.manifest)));
    return;
  }

  let sqlText;
  if (values.query) sqlText = values.query;
  if (values.file) sqlText = readFileSync(resolve(values.file), "utf8");
  if (values.model) {
    const relation = relationForModel(loadManifest(values.manifest), values.model);
    const limit = parseBoundedInteger(values.limit, "--limit", 20);
    sqlText = `SELECT * FROM ${relation} LIMIT ${limit}`;
  }
  if (values.check) {
    sqlText = `SELECT CURRENT_ACCOUNT() AS account, CURRENT_USER() AS user_name,
      CURRENT_ROLE() AS role_name, CURRENT_WAREHOUSE() AS warehouse_name,
      CURRENT_DATABASE() AS database_name, CURRENT_SCHEMA() AS schema_name`;
  }
  const maxRows = parseBoundedInteger(values["max-rows"], "--max-rows", 50);
  sqlText = assertReadOnlySql(sqlText, "snowflake");
  if (values.query || values.file) sqlText = boundWarehouseRows(sqlText, maxRows);

  const snowflake = await loadDriver();
  const connection = snowflake.createConnection(connectionOptions());
  let connected = false;
  try {
    await connect(connection);
    connected = true;
    const { statement, rows } = await execute(connection, sqlText);
    const visibleRows = rows.slice(0, maxRows);
    if (visibleRows.length) console.table(visibleRows);
    else console.log("Query completed and returned no rows.");
    if (rows.length > maxRows) console.log(`Showing ${maxRows} of ${rows.length} rows.`);
    if (statement?.getStatementId) console.log(`Snowflake query ID: ${statement.getStatementId()}`);
  } finally {
    if (connected) await destroy(connection);
  }
}

main().catch((error) => {
  console.error(`Snowflake query error: ${error.message}`);
  process.exitCode = 1;
});
