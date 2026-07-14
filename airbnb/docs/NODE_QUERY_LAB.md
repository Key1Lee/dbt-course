# Node.js Query Lab

This project has two Node.js learning paths:

1. **Local Apple Pay lab** — runs immediately with Node 24 and SQLite. It reads the checked-in `seed_apple_pay_*.csv` files on every run and recreates SQLite views that mirror the Apple Pay dbt staging, dimension, fact, and mart models.
2. **Snowflake query tool** — optionally connects to the real relations built by dbt. It needs the official `snowflake-sdk` package and your own Snowflake credentials.

The local lab is the right place to make mistakes safely. It is synthetic training data, contains no real Apple/customer/card data, and never stores a PAN or security code.

## Quick start: local lab

Run these commands from the `airbnb` directory:

```powershell
node --version
npm run ui
```

Open <http://127.0.0.1:4173> to use the visual SQL editor and ten interactive
lessons. See [Interactive Apple Pay SQL Learning UI](INTERACTIVE_LEARNING_UI.md)
for the full curriculum. To practice in the terminal instead:

```powershell
npm run lab:tables
npm run lab:examples
npm run lab -- --example daily-performance
```

The installed Node.js 24.18 runtime includes `node:sqlite` and its read-only authorizer. The lab requires Node 24.10 or newer, has no external local dependency, and does not need Snowflake, dbt, Python, or a password.

Run your own query:

```powershell
npm run lab -- --sql "SELECT * FROM fct_apple_pay_transactions LIMIT 5"
```

PowerShell works best with double quotes around the full SQL and single quotes inside SQL:

```powershell
npm run lab -- --sql "SELECT * FROM fct_apple_pay_transactions WHERE transaction_status = 'declined'"
```

`--query` is an alias for `--sql`. To run a query stored in a plain SQL file:

```powershell
npm run lab -- --file .\my_learning_query.sql
```

Other useful commands:

```powershell
npm run lab -- --describe fct_apple_pay_transactions
npm run lab -- --example merchant-approval
npm run lab -- --example declines
npm run lab -- --example device-channel
npm run lab -- --help
```

## What the local lab builds

The CSV files are the inputs. The in-memory SQLite views use the same names, selected columns, casing rules, approval flags, and grains as `models/apple_pay/`.

| Layer | Relations | Grain |
|---|---|---|
| Seeds | `seed_apple_pay_customers`, `seed_apple_pay_merchants`, `seed_apple_pay_devices` | One row per customer, merchant, or device |
| Transaction seed | `seed_apple_pay_transactions` | One row per `transaction_id` |
| Staging | `stg_apple_pay_customers`, `stg_apple_pay_merchants`, `stg_apple_pay_devices`, `stg_apple_pay_transactions` | One cleaned row per source key |
| Dimensions | `dim_apple_pay_customers`, `dim_apple_pay_merchants`, `dim_apple_pay_devices` | One row per dimension key |
| Fact | `fct_apple_pay_transactions` | One row per `transaction_id` |
| Mart | `mart_apple_pay_daily_performance` | One row per `transaction_date + currency + payment_channel` |

The fact treats `authorized`, `settled`, and `refunded` as approved and `declined` as declined, exactly like the dbt fact model. The mart keeps currencies and channels separate, so USD, CAD, and GBP are never incorrectly added together.

Follow one transaction through the layers:

```powershell
npm run lab -- --sql "SELECT transaction_id, transaction_status, amount FROM seed_apple_pay_transactions WHERE transaction_id = 'T007'"
npm run lab -- --sql "SELECT transaction_id, transaction_status, is_approved, is_declined FROM fct_apple_pay_transactions WHERE transaction_id = 'T007'"
```

Practice a star-schema join:

```powershell
npm run lab -- --sql "SELECT f.transaction_id, c.customer_name, m.merchant_name, d.device_type, f.amount, f.currency FROM fct_apple_pay_transactions f JOIN dim_apple_pay_customers c USING (customer_id) JOIN dim_apple_pay_merchants m USING (merchant_id) JOIN dim_apple_pay_devices d USING (device_id) ORDER BY f.transaction_ts LIMIT 10"
```

SQLite and Snowflake are different SQL dialects. The local views translate the project transformations into SQLite, but Snowflake-only syntax such as `::NUMBER`, `DATEADD`, dbt `ref()`, and Jinja blocks will not run locally.

## Optional: query actual dbt relations in Snowflake

The recommended dependency is the official driver pinned in `package.json`:

```powershell
npm install
```

This installs `snowflake-sdk@3.1.0` and creates `package-lock.json`. Version 3.1.0 supports Node 20 and newer, including the installed Node 24 runtime. The local lab still works if the package has not been installed; only Snowflake mode needs it.

Copy the environment template and replace the placeholders with your own values:

```powershell
Copy-Item .env.example .env
notepad .env
```

Never commit `.env`, a private key, or a passphrase. This repository already ignores `airbnb/.env`.

The key-pair variable names deliberately overlap with `_prod_profiles/profiles.yml`:

- `SNOWFLAKE_ACCOUNT`
- `DBT_USER` (or `SNOWFLAKE_USER`)
- `PRIVATE_KEY` or `SNOWFLAKE_PRIVATE_KEY_PATH`
- `PRIVATE_KEY_PASSPHRASE`
- `DBT_ENV_NAME`

The file template defaults to the read-only `REPORTER` role. The dbt project grants that role `SELECT` on built models. Keep that role for the learning query tool; warehouse permissions are the strongest protection against accidental writes.

Test the connection:

```powershell
npm run query:snowflake -- --check
```

After `dbt compile` or `dbt build` creates `target/manifest.json`, list/query relations by dbt model name:

```powershell
npm run query:snowflake -- --list-models
npm run query:snowflake -- --model dim_listings_cleansed --limit 10
npm run query:snowflake -- --model dim_hosts_cleansed.v2 --limit 10
npm run query:snowflake -- --model fct_apple_pay_transactions --limit 10
```

Using the manifest is safer than guessing a schema: dbt records each model's exact fully qualified `relation_name`. For a versioned model, use a selector such as `dim_hosts_cleansed.v2`; the physical alias `dim_hosts_cleansed_v2` also works. Ephemeral models, such as this project's `src_*` Airbnb models, have no physical relation and cannot be queried directly.

You can also supply one fully qualified, read-only query:

```powershell
npm run query:snowflake -- --query "SELECT room_type, COUNT(*) AS listings FROM AIRBNB.DBT_YOUR_NAME.DIM_LISTINGS_CLEANSED GROUP BY room_type ORDER BY listings DESC LIMIT 100"
```

Schema rules in this project are:

- Dev regular models: `AIRBNB.DBT_<DBT_ENV_NAME>.<MODEL>`
- Dev custom `mart` schema: `AIRBNB.DBT_<DBT_ENV_NAME>_MART.<MODEL>`
- Production regular models: `AIRBNB.PROD.<MODEL>`
- Production custom mart models: `AIRBNB.MART.<MODEL>`

A file passed to `--file` must contain plain compiled Snowflake SQL. The Node tool does not render dbt Jinja. Run `dbt compile` first and use the compiled file under `target/compiled/`, or use `--model`.

## Read-only behavior

Both tools accept only one statement. They allow read-oriented statements and reject mutation keywords such as `INSERT`, `UPDATE`, `DELETE`, `MERGE`, `CREATE`, `ALTER`, and `DROP`. Snowflake `SELECT`/`WITH` queries supplied through `--query` or `--file` are wrapped in an outer `LIMIT` controlled by `--max-rows` (default 50, maximum 1,000).

The local lab also enables SQLite's authorizer after setup, which blocks writes at the database engine. Snowflake mode adds an application guard, but the `REPORTER` role is the real security boundary. An outer row limit bounds the returned result; it does not guarantee that Snowflake scans less data for joins or aggregations.

## Troubleshooting

**`snowflake-sdk is not installed`**

Run `npm install` in `airbnb`. Local `npm run lab` does not require the package.

**`dbt manifest not found`**

Run `dbt compile`/`dbt build`, or use `--query` with a fully qualified relation. `--list-models` and `--model` need `target/manifest.json`.

**`relation does not exist`**

Confirm dbt has built the model and that `.env` uses the correct `DBT_ENV_NAME`/`SNOWFLAKE_SCHEMA`. Dev mart relations use the `_MART` suffix.

**Authentication fails**

Check the account identifier, user, selected authentication option, and key passphrase. Do not paste secrets into terminal output or documentation. Browser SSO only works when your Snowflake account is configured for it.

## Official references

- [Snowflake: install the Node.js driver](https://docs.snowflake.com/en/developer-guide/node-js/nodejs-driver-install)
- [Snowflake: authenticate Node.js connections](https://docs.snowflake.com/en/developer-guide/node-js/nodejs-driver-authenticate)
- [Node.js: built-in SQLite API](https://nodejs.org/api/sqlite.html)
