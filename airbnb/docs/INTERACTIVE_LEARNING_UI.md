# Interactive Apple Pay SQL Learning UI

The Apple Pay Analytics Learning Lab is a local browser application with a
read-only SQL editor and a ten-lesson course. It uses the synthetic CSV files
in this repository, recreates the dbt model in an in-memory SQLite database,
and does not require Snowflake credentials.

## Start the UI

From the `airbnb` directory:

```powershell
node --version
npm install
npm run ui
```

Open <http://127.0.0.1:4173>. Keep the terminal open while you use the lab and
press `Ctrl+C` there when you are finished.

To use another local port:

```powershell
npm run ui -- --port 4174
```

The UI binds only to `127.0.0.1`. It does not publish a website or connect to
Snowflake.

## How to learn with it

1. Read the lesson objective, explanation, model path, and task.
2. Edit the starter SQL in the editor.
3. Select a row limit and choose **Run query**, or press `Ctrl+Enter` on Windows
   and Linux (`Command+Enter` on macOS).
4. Inspect the result table and the lesson-specific feedback.
5. A lesson is complete only when the returned columns and values satisfy its
   goal. Merely opening a hint or loading the solution does not complete it.
6. Select any lesson in the left navigation. Lessons are intentionally
   unlocked, so you can revisit concepts in any order.

Progress and SQL drafts are saved in this browser's local storage. **Reset**
clears completed lessons and drafts after confirmation. The source database
itself is rebuilt from the checked-in CSV files every time the server starts.

## The ten-lesson path

| Lesson | Topic | What you prove |
|---:|---|---|
| 1 | Meet the Raw Payment Attempts | Read the first five source transactions and understand that one row is one payment attempt. |
| 2 | Prove the Grain | Confirm that all 18 rows have 18 distinct `transaction_id` values. |
| 3 | See the Staging Contract | Inspect standardized fields and the treatment of missing decline reasons. |
| 4 | Learn Dimensions and Relationships | Join customers to devices and find the one customer with two devices. |
| 5 | Understand the Transaction Fact | Use the reusable approval/decline flags and reconcile status counts. |
| 6 | Build the Star-Schema Join | Enrich fact keys with customer, merchant, and device attributes. |
| 7 | Compare Merchant Approval | Calculate attempts, approvals, and approval rate by merchant. |
| 8 | Diagnose Declines Without Mixing Currencies | Group decline amounts by currency as well as network and reason. |
| 9 | Read the Daily Performance Mart | Verify the 13-row reporting mart and its date + currency + channel grain. |
| 10 | Reconcile Fact to Mart | Prove that fact and mart transaction, approval, and decline totals match. |

The sequence follows the actual analytics flow:

```text
synthetic CSV seeds
        |
        v
clean staging views
        |
        +------> customer / merchant / device dimensions
        |                         |
        v                         v
transaction fact <--------- descriptive joins
        |
        v
daily performance mart
        |
        v
reconciliation and business analysis
```

## Use the SQL playground

Choose **SQL playground** when you want to work outside a lesson. You can:

- load a merchant, decline, device/channel, or daily-performance example;
- browse all 13 relations and preview a selected model;
- query seeds, staging views, dimensions, the fact, or the mart;
- return up to 500 rows in a scrollable result table.

The local engine accepts SQLite `SELECT` and `WITH` queries. It does not render
dbt Jinja and does not support Snowflake-only syntax such as `::NUMBER`.

## What runs behind the page

The implementation deliberately uses the Node.js installation already on this
computer:

| Part | Responsibility |
|---|---|
| `scripts/apple-pay-ui.mjs` | Serves the local page and the small JSON API on `127.0.0.1`. |
| `ui/app.mjs` | Manages lessons, editor actions, results, catalog browsing, and saved progress. |
| `scripts/lib/apple-pay-database.mjs` | Loads CSV seeds and creates SQLite relations that mirror the dbt Apple Pay branch. |
| `scripts/lib/apple-pay-lessons.mjs` | Defines exactly ten lessons and validates query results. |
| `scripts/lib/query-worker.mjs` | Runs each query away from the web server and enforces bounded results. |
| `scripts/lib/sql-safety.mjs` | Rejects non-read-only and multi-statement SQL. |
| `test/apple-pay-*.test.mjs` | Checks model totals, lesson outcomes, API behavior, and safety controls. |

The same database module powers both the browser UI and `npm run lab`, so the
command-line and browser learning paths use identical data and transformations.

## Safety boundaries

- All rows are synthetic and are not supplied by or affiliated with Apple.
- The server accepts local host/origin requests only and sends restrictive
  browser security headers.
- SQL is checked for one read-only statement, then SQLite's authorizer provides
  a second engine-level write block.
- Each query runs in a worker with a three-second timeout.
- SQL, request-body, and returned-row sizes are capped.
- Results and errors are inserted as text, not executable HTML.

These safeguards make the repository a safer learning environment. They are
not a blueprint for exposing a SQL console to the public internet or for
handling real cardholder data.

## Verify the lab

Run the complete offline test suite:

```powershell
npm test
```

The tests cover the database model, all ten lesson solutions, currency-safe
decline analysis, read-only enforcement, request limits, static security
headers, and the UI API.

## Troubleshooting

**The page does not open**

Confirm the terminal running `npm run ui` says the lab is ready. Use the exact
`http://127.0.0.1:4173` address, not an HTTPS URL.

**Port 4173 is already in use**

Run `npm run ui -- --port 4174` and open the address printed by the server.

**A query is rejected**

Use one SQLite `SELECT` or `WITH` statement. Remove dbt Jinja, Snowflake casts,
and mutation statements. The feedback panel displays the safe error message.

**Saved progress is missing**

Progress belongs to the browser and host name. `localhost:4173` and
`127.0.0.1:4173` have separate local-storage areas; use the printed
`127.0.0.1` address consistently.

**You need the real Snowflake tables**

The UI is intentionally offline. Build the dbt project and use the optional
read-only Snowflake flow in [Node.js Query Lab](NODE_QUERY_LAB.md).
