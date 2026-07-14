export const LESSONS = [
  {
    id: "lesson-1",
    number: 1,
    title: "Meet the Raw Payment Attempts",
    duration: "6 min",
    objective: "Read the synthetic source transactions and identify what one row represents.",
    concept: "The pipeline starts with CSV seeds. In seed_apple_pay_transactions, one row represents one current-state payment attempt.",
    task: "Return the first five payment attempts in timestamp order with their entity keys, amount, currency, and status.",
    starterSql: `SELECT
  transaction_id,
  customer_id,
  merchant_id,
  device_id,
  transaction_ts,
  amount,
  currency,
  transaction_status
FROM seed_apple_pay_transactions
ORDER BY transaction_ts;`,
    solutionSql: `SELECT
  transaction_id,
  customer_id,
  merchant_id,
  device_id,
  transaction_ts,
  amount,
  currency,
  transaction_status
FROM seed_apple_pay_transactions
ORDER BY transaction_ts
LIMIT 5;`,
    hints: [
      "ORDER BY transaction_ts makes the result chronological.",
      "Add LIMIT 5 after ORDER BY to keep only the first five rows."
    ],
    modelPath: "CSV seed → seed_apple_pay_transactions",
    completionMessage: "You found the source layer and read five payment attempts. Next, prove its grain."
  },
  {
    id: "lesson-2",
    number: 2,
    title: "Prove the Grain",
    duration: "7 min",
    objective: "Verify that transaction_id uniquely identifies each source row.",
    concept: "Grain states what one row represents. A one-row-per-transaction grain requires the row count to equal the distinct transaction ID count.",
    task: "Return the total rows, unique transaction IDs, earliest timestamp, and latest timestamp in one summary row.",
    starterSql: `SELECT
  COUNT(*) AS row_count
FROM seed_apple_pay_transactions;`,
    solutionSql: `SELECT
  COUNT(*) AS row_count,
  COUNT(DISTINCT transaction_id) AS unique_transaction_ids,
  MIN(transaction_ts) AS first_transaction_ts,
  MAX(transaction_ts) AS last_transaction_ts
FROM seed_apple_pay_transactions;`,
    hints: [
      "COUNT(DISTINCT transaction_id) checks how many different transaction keys exist.",
      "MIN and MAX find the boundaries of the transaction timeline."
    ],
    modelPath: "seed_apple_pay_transactions (one row per transaction_id)",
    completionMessage: "The 18 rows have 18 unique transaction IDs, so the declared grain holds."
  },
  {
    id: "lesson-3",
    number: 3,
    title: "See the Staging Contract",
    duration: "8 min",
    objective: "Inspect the standardized transaction fields exposed by staging.",
    concept: "Staging models perform predictable cleanup: trimmed keys, consistent casing, numeric amounts, and blank decline reasons converted to NULL.",
    task: "Compare one declined and one settled transaction, displaying a missing decline reason as none.",
    starterSql: `SELECT
  transaction_id,
  currency,
  payment_channel,
  transaction_status,
  decline_reason
FROM stg_apple_pay_transactions
ORDER BY transaction_id;`,
    solutionSql: `SELECT
  transaction_id,
  currency,
  payment_channel,
  transaction_status,
  COALESCE(decline_reason, 'none') AS decline_reason
FROM stg_apple_pay_transactions
WHERE transaction_id IN ('T003', 'T006')
ORDER BY transaction_id;`,
    hints: [
      "Use WHERE transaction_id IN (...) to keep the two requested rows.",
      "COALESCE(decline_reason, 'none') changes NULL only for display; it does not alter the model."
    ],
    modelPath: "seed_apple_pay_transactions → stg_apple_pay_transactions",
    completionMessage: "You used the staging contract: standardized categories and explicit NULL handling."
  },
  {
    id: "lesson-4",
    number: 4,
    title: "Learn Dimensions and Relationships",
    duration: "10 min",
    objective: "Use dimensions to describe customers and their devices.",
    concept: "Dimensions describe the entities around a fact. One customer can own many devices, so customer-to-device is a one-to-many relationship.",
    task: "Return every customer with their number of enrolled devices, highest count first.",
    starterSql: `SELECT
  c.customer_id,
  c.customer_name,
  d.device_id
FROM dim_apple_pay_customers AS c
LEFT JOIN dim_apple_pay_devices AS d
  ON c.customer_id = d.customer_id
ORDER BY c.customer_id, d.device_id;`,
    solutionSql: `SELECT
  c.customer_id,
  c.customer_name,
  COUNT(d.device_id) AS device_count
FROM dim_apple_pay_customers AS c
LEFT JOIN dim_apple_pay_devices AS d
  ON c.customer_id = d.customer_id
GROUP BY c.customer_id, c.customer_name
ORDER BY device_count DESC, c.customer_id;`,
    hints: [
      "Join the tables on their shared customer_id.",
      "Count device_id, then group by the customer columns you selected."
    ],
    modelPath: "stg customers/devices → dim_apple_pay_customers + dim_apple_pay_devices",
    completionMessage: "You modeled a one-to-many relationship: Maya has two devices and every other customer has one."
  },
  {
    id: "lesson-5",
    number: 5,
    title: "Understand the Transaction Fact",
    duration: "9 min",
    objective: "Translate transaction statuses into reusable approval and decline metrics.",
    concept: "The fact has one row per payment attempt. Its 1/0 flags make approved and declined rows easy to count; this learning model treats authorized, settled, and refunded as approved.",
    task: "Group the fact by status and count attempts, approvals, and declines.",
    starterSql: `SELECT
  transaction_status,
  is_approved,
  is_declined
FROM fct_apple_pay_transactions
ORDER BY transaction_status;`,
    solutionSql: `SELECT
  transaction_status,
  COUNT(*) AS attempts,
  SUM(is_approved) AS approvals,
  SUM(is_declined) AS declines
FROM fct_apple_pay_transactions
GROUP BY transaction_status
ORDER BY transaction_status;`,
    hints: [
      "SUM of a 1/0 flag counts the rows where the flag is true.",
      "Every selected non-aggregate column belongs in GROUP BY."
    ],
    modelPath: "stg_apple_pay_transactions → fct_apple_pay_transactions",
    completionMessage: "You verified the fact logic: 18 attempts become 14 approvals and 4 declines."
  },
  {
    id: "lesson-6",
    number: 6,
    title: "Build the Star-Schema Join",
    duration: "12 min",
    objective: "Enrich transaction keys with readable customer, merchant, and device attributes.",
    concept: "A star schema keeps measurable events in the central fact and descriptive attributes in dimensions joined by keys.",
    task: "Return the first five facts with customer name, merchant name, device type, amount, and currency.",
    starterSql: `SELECT
  f.transaction_id,
  f.customer_id,
  f.merchant_id,
  f.device_id,
  f.amount,
  f.currency
FROM fct_apple_pay_transactions AS f
ORDER BY f.transaction_ts
LIMIT 5;`,
    solutionSql: `SELECT
  f.transaction_id,
  c.customer_name,
  m.merchant_name,
  d.device_type,
  f.amount,
  f.currency
FROM fct_apple_pay_transactions AS f
JOIN dim_apple_pay_customers AS c
  ON f.customer_id = c.customer_id
JOIN dim_apple_pay_merchants AS m
  ON f.merchant_id = m.merchant_id
JOIN dim_apple_pay_devices AS d
  ON f.device_id = d.device_id
ORDER BY f.transaction_ts
LIMIT 5;`,
    hints: [
      "Match each fact foreign key to the dimension's same-named primary key.",
      "Keep amount and currency in the fact; select names and device type from dimensions."
    ],
    modelPath: "dimensions → fct_apple_pay_transactions ← dimensions",
    completionMessage: "You built a star join that turns compact warehouse keys into useful transaction context."
  },
  {
    id: "lesson-7",
    number: 7,
    title: "Compare Merchant Approval",
    duration: "12 min",
    objective: "Calculate and compare merchant-level authorization performance.",
    concept: "Grouped KPIs combine dimension labels with fact metrics. Multiplying by 100.0 makes the percentage calculation explicitly decimal in SQLite.",
    task: "Return attempts, approvals, and approval-rate percent for each merchant, strongest rate first.",
    starterSql: `SELECT
  m.merchant_name,
  m.merchant_category,
  f.is_approved
FROM fct_apple_pay_transactions AS f
JOIN dim_apple_pay_merchants AS m
  ON f.merchant_id = m.merchant_id
ORDER BY m.merchant_name;`,
    solutionSql: `SELECT
  m.merchant_name,
  m.merchant_category,
  COUNT(*) AS attempts,
  SUM(f.is_approved) AS approvals,
  ROUND(100.0 * SUM(f.is_approved) / COUNT(*), 1) AS approval_rate_pct
FROM fct_apple_pay_transactions AS f
JOIN dim_apple_pay_merchants AS m
  ON f.merchant_id = m.merchant_id
GROUP BY m.merchant_name, m.merchant_category
ORDER BY approval_rate_pct DESC, attempts DESC, m.merchant_name;`,
    hints: [
      "Group by merchant name and category before calculating the metrics.",
      "Approval rate is approvals divided by attempts; use 100.0 and ROUND(..., 1) for a percentage."
    ],
    modelPath: "dim_apple_pay_merchants + fct_apple_pay_transactions → merchant KPI",
    completionMessage: "You created a stakeholder KPI while preserving the fact's transaction grain underneath it."
  },
  {
    id: "lesson-8",
    number: 8,
    title: "Diagnose Declines Without Mixing Currencies",
    duration: "11 min",
    objective: "Investigate decline reasons while keeping monetary totals currency-safe.",
    concept: "Filter before aggregating, and always retain currency in the grouping when summing money. USD and CAD amounts are not directly additive.",
    task: "Summarize declined attempts and requested amount by currency, network, and decline reason.",
    starterSql: `SELECT
  currency,
  payment_network,
  decline_reason,
  amount
FROM fct_apple_pay_transactions
WHERE is_declined = 1
ORDER BY currency, amount DESC;`,
    solutionSql: `SELECT
  currency,
  payment_network,
  decline_reason,
  COUNT(*) AS decline_count,
  ROUND(SUM(amount), 2) AS requested_amount
FROM fct_apple_pay_transactions
WHERE is_declined = 1
GROUP BY currency, payment_network, decline_reason
ORDER BY currency, requested_amount DESC, payment_network;`,
    hints: [
      "WHERE is_declined = 1 prevents approved rows from entering the metrics.",
      "Include currency in both SELECT and GROUP BY before summing amount."
    ],
    modelPath: "fct_apple_pay_transactions → currency-safe decline analysis",
    completionMessage: "You diagnosed all four declines without incorrectly adding USD and CAD together."
  },
  {
    id: "lesson-9",
    number: 9,
    title: "Read the Daily Performance Mart",
    duration: "10 min",
    objective: "Use a ready-made mart at its documented reporting grain.",
    concept: "The mart pre-aggregates the fact to one row per transaction date, currency, and payment channel. All three columns are required to identify a row.",
    task: "Return the daily grain and its count, refund, amount, and approval-rate metrics in a stable order.",
    starterSql: `SELECT
  transaction_date,
  currency,
  payment_channel,
  transaction_count
FROM mart_apple_pay_daily_performance
ORDER BY transaction_date, currency, payment_channel;`,
    solutionSql: `SELECT
  transaction_date,
  currency,
  payment_channel,
  transaction_count,
  approved_transaction_count,
  declined_transaction_count,
  refunded_transaction_count,
  requested_amount,
  approval_rate
FROM mart_apple_pay_daily_performance
ORDER BY transaction_date, currency, payment_channel;`,
    hints: [
      "Keep transaction_date, currency, and payment_channel together: they define the grain.",
      "Read requested_amount within a currency; conversion would be required before combining currencies."
    ],
    modelPath: "fct_apple_pay_transactions → mart_apple_pay_daily_performance",
    completionMessage: "You read 13 mart rows that safely summarize all 18 transactions."
  },
  {
    id: "lesson-10",
    number: 10,
    title: "Reconcile Fact to Mart",
    duration: "13 min",
    objective: "Prove that the aggregation preserved transaction, approval, and decline counts.",
    concept: "Analytics engineers reconcile downstream outputs to upstream inputs. CTEs make each one-row summary clear, and zero differences are the passing condition.",
    task: "Build fact and mart summaries, then return their transaction counts and the three differences.",
    starterSql: `WITH fact_summary AS (
  SELECT
    COUNT(*) AS fact_transactions,
    SUM(is_approved) AS fact_approved,
    SUM(is_declined) AS fact_declined
  FROM fct_apple_pay_transactions
)
SELECT *
FROM fact_summary;`,
    solutionSql: `WITH fact_summary AS (
  SELECT
    COUNT(*) AS fact_transactions,
    SUM(is_approved) AS fact_approved,
    SUM(is_declined) AS fact_declined
  FROM fct_apple_pay_transactions
),
mart_summary AS (
  SELECT
    SUM(transaction_count) AS mart_transactions,
    SUM(approved_transaction_count) AS mart_approved,
    SUM(declined_transaction_count) AS mart_declined
  FROM mart_apple_pay_daily_performance
)
SELECT
  fact_transactions,
  mart_transactions,
  fact_transactions - mart_transactions AS transaction_difference,
  fact_approved - mart_approved AS approval_difference,
  fact_declined - mart_declined AS decline_difference
FROM fact_summary
CROSS JOIN mart_summary;`,
    hints: [
      "Create a second CTE that sums the mart's count columns.",
      "Each CTE returns one row, so CROSS JOIN places both summaries on one row.",
      "Subtract mart values from fact values; every difference should be zero."
    ],
    modelPath: "fact → mart → reconciliation test",
    completionMessage: "Pipeline reconciled: the mart preserves all 18 attempts, 14 approvals, and 4 declines."
  }
];

function columnName(column) {
  if (typeof column === "string") return column;
  return column?.name ?? column?.column ?? column?.key;
}

function availableColumns(rows, columns) {
  const supplied = Array.isArray(columns) ? columns.map(columnName).filter(Boolean) : [];
  if (supplied.length) return new Set(supplied);
  return new Set(rows.flatMap((row) => row && typeof row === "object" ? Object.keys(row) : []));
}

function hasColumns(rows, columns, required) {
  const available = availableColumns(rows, columns);
  return required.every((name) => available.has(name));
}

function isNumber(value, expected, tolerance = 1e-9) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && Math.abs(numeric - expected) <= tolerance;
}

function keyedRows(rows, keyFor) {
  return new Map(rows.map((row) => [keyFor(row), row]));
}

function exactOrderedValues(rows, column, expected) {
  return rows.length === expected.length && rows.every((row, index) => row?.[column] === expected[index]);
}

function lesson1(rows, columns) {
  const required = ["transaction_id", "customer_id", "merchant_id", "device_id", "transaction_ts", "amount", "currency", "transaction_status"];
  const passed = hasColumns(rows, columns, required)
    && exactOrderedValues(rows, "transaction_id", ["T001", "T002", "T003", "T004", "T005"])
    && rows[0]?.transaction_status === "settled"
    && isNumber(rows[0]?.amount, 6.75)
    && rows[2]?.transaction_status === "declined"
    && rows[3]?.transaction_status === "authorized";
  return [passed, "Return exactly the first five timestamp-ordered attempts (T001 through T005) with all requested columns."];
}

function lesson2(rows, columns) {
  const required = ["row_count", "unique_transaction_ids", "first_transaction_ts", "last_transaction_ts"];
  const row = rows[0];
  const passed = rows.length === 1 && hasColumns(rows, columns, required)
    && isNumber(row?.row_count, 18) && isNumber(row?.unique_transaction_ids, 18)
    && row?.first_transaction_ts === "2025-06-01 08:12:00"
    && row?.last_transaction_ts === "2025-06-03 18:05:00";
  return [passed, "Return one summary row showing 18 rows, 18 distinct IDs, and the correct first and last timestamps."];
}

function lesson3(rows, columns) {
  const required = ["transaction_id", "currency", "payment_channel", "transaction_status", "decline_reason"];
  const byId = keyedRows(rows, (row) => row?.transaction_id);
  const declined = byId.get("T003");
  const settled = byId.get("T006");
  const passed = rows.length === 2 && hasColumns(rows, columns, required)
    && declined?.currency === "USD" && declined?.payment_channel === "in_app"
    && declined?.transaction_status === "declined" && declined?.decline_reason === "insufficient_funds"
    && settled?.currency === "CAD" && settled?.payment_channel === "web"
    && settled?.transaction_status === "settled" && settled?.decline_reason === "none";
  return [passed, "Return only T003 and T006, and display T006's NULL decline reason as none."];
}

function lesson4(rows, columns) {
  const required = ["customer_id", "customer_name", "device_count"];
  const byId = keyedRows(rows, (row) => row?.customer_id);
  const expectedNames = new Map([
    ["C001", "Maya Chen"], ["C002", "Jordan Brooks"], ["C003", "Priya Shah"],
    ["C004", "Mateo Rivera"], ["C005", "Amina Yusuf"], ["C006", "Noah Williams"]
  ]);
  const passed = rows.length === 6 && hasColumns(rows, columns, required)
    && [...expectedNames].every(([id, name]) => byId.get(id)?.customer_name === name)
    && isNumber(byId.get("C001")?.device_count, 2)
    && ["C002", "C003", "C004", "C005", "C006"].every((id) => isNumber(byId.get(id)?.device_count, 1));
  return [passed, "Return all six customers with Maya at 2 devices and every other customer at 1."];
}

function lesson5(rows, columns) {
  const required = ["transaction_status", "attempts", "approvals", "declines"];
  const byStatus = keyedRows(rows, (row) => row?.transaction_status);
  const expected = new Map([
    ["authorized", [3, 3, 0]], ["declined", [4, 0, 4]],
    ["refunded", [2, 2, 0]], ["settled", [9, 9, 0]]
  ]);
  const passed = rows.length === 4 && hasColumns(rows, columns, required)
    && [...expected].every(([status, values]) => {
      const row = byStatus.get(status);
      return isNumber(row?.attempts, values[0])
        && isNumber(row?.approvals, values[1])
        && isNumber(row?.declines, values[2]);
    });
  return [passed, "Group all 18 fact rows into the four expected statuses and sum both 1/0 flags."];
}

function lesson6(rows, columns) {
  const required = ["transaction_id", "customer_name", "merchant_name", "device_type", "amount", "currency"];
  const byId = keyedRows(rows, (row) => row?.transaction_id);
  const t1 = byId.get("T001");
  const t4 = byId.get("T004");
  const passed = hasColumns(rows, columns, required)
    && exactOrderedValues(rows, "transaction_id", ["T001", "T002", "T003", "T004", "T005"])
    && t1?.customer_name === "Maya Chen" && t1?.merchant_name === "Lakeview Coffee"
    && t1?.device_type === "iphone" && isNumber(t1?.amount, 6.75) && t1?.currency === "USD"
    && t4?.customer_name === "Maya Chen" && t4?.merchant_name === "Northstar Market"
    && t4?.device_type === "apple_watch" && isNumber(t4?.amount, 81.4);
  return [passed, "Join all three dimensions and return the timestamp-ordered T001 through T005 context rows."];
}

function lesson7(rows, columns) {
  const required = ["merchant_name", "merchant_category", "attempts", "approvals", "approval_rate_pct"];
  const byMerchant = keyedRows(rows, (row) => row?.merchant_name);
  const expected = new Map([
    ["Harbor Fitness", ["fitness", 2, 2, 100]],
    ["Lakeview Coffee", ["cafe", 5, 4, 80]],
    ["Northstar Market", ["grocery", 5, 4, 80]],
    ["Maple Books", ["bookstore", 3, 2, 66.7]],
    ["Skyline Transit", ["transportation", 3, 2, 66.7]]
  ]);
  const passed = rows.length === 5 && hasColumns(rows, columns, required)
    && [...expected].every(([merchant, values]) => {
      const row = byMerchant.get(merchant);
      return row?.merchant_category === values[0]
        && isNumber(row?.attempts, values[1])
        && isNumber(row?.approvals, values[2])
        && isNumber(row?.approval_rate_pct, values[3], 1e-6);
    })
    && rows[0]?.merchant_name === "Harbor Fitness";
  return [passed, "Return all five merchant KPIs with Harbor Fitness first at a 100% approval rate."];
}

function lesson8(rows, columns) {
  const required = ["currency", "payment_network", "decline_reason", "decline_count", "requested_amount"];
  const byGroup = keyedRows(rows, (row) => `${row?.currency}|${row?.payment_network}|${row?.decline_reason}`);
  const expected = new Map([
    ["CAD|VISA|insufficient_funds", [1, 31.2]],
    ["USD|MASTERCARD|suspected_fraud", [1, 108.3]],
    ["USD|VISA|do_not_honor", [1, 7.1]],
    ["USD|VISA|insufficient_funds", [1, 2.5]]
  ]);
  const passed = rows.length === 4 && hasColumns(rows, columns, required)
    && [...expected].every(([group, values]) => {
      const row = byGroup.get(group);
      return isNumber(row?.decline_count, values[0]) && isNumber(row?.requested_amount, values[1]);
    })
    && rows.reduce((total, row) => total + Number(row.decline_count || 0), 0) === 4;
  return [passed, "Keep currency in the grouping and return the four separate currency/network/reason decline groups."];
}

function lesson9(rows, columns) {
  const required = ["transaction_date", "currency", "payment_channel", "transaction_count",
    "approved_transaction_count", "declined_transaction_count", "refunded_transaction_count",
    "requested_amount", "approval_rate"];
  const keyFor = (row) => `${row?.transaction_date}|${row?.currency}|${row?.payment_channel}`;
  const byGrain = keyedRows(rows, keyFor);
  const june1Store = byGrain.get("2025-06-01|USD|in_store");
  const june2Web = byGrain.get("2025-06-02|USD|web");
  const represented = rows.reduce((total, row) => total + Number(row.transaction_count || 0), 0);
  const passed = rows.length === 13 && byGrain.size === 13 && hasColumns(rows, columns, required)
    && represented === 18
    && isNumber(june1Store?.transaction_count, 3)
    && isNumber(june1Store?.approved_transaction_count, 3)
    && isNumber(june1Store?.declined_transaction_count, 0)
    && isNumber(june1Store?.requested_amount, 70.2)
    && isNumber(june1Store?.approval_rate, 1)
    && isNumber(june2Web?.transaction_count, 1)
    && isNumber(june2Web?.declined_transaction_count, 1)
    && isNumber(june2Web?.requested_amount, 108.3)
    && isNumber(june2Web?.approval_rate, 0);
  return [passed, "Return all 13 unique date/currency/channel mart rows representing all 18 transactions."];
}

function lesson10(rows, columns) {
  const required = ["fact_transactions", "mart_transactions", "transaction_difference", "approval_difference", "decline_difference"];
  const row = rows[0];
  const passed = rows.length === 1 && hasColumns(rows, columns, required)
    && isNumber(row?.fact_transactions, 18) && isNumber(row?.mart_transactions, 18)
    && isNumber(row?.transaction_difference, 0)
    && isNumber(row?.approval_difference, 0)
    && isNumber(row?.decline_difference, 0);
  return [passed, "Return one reconciliation row with 18 fact and mart transactions and three zero differences."];
}

const VALIDATORS = new Map([
  ["lesson-1", lesson1], ["lesson-2", lesson2], ["lesson-3", lesson3], ["lesson-4", lesson4],
  ["lesson-5", lesson5], ["lesson-6", lesson6], ["lesson-7", lesson7], ["lesson-8", lesson8],
  ["lesson-9", lesson9], ["lesson-10", lesson10]
]);

export function evaluateLesson(lessonId, rows, columns) {
  const lesson = LESSONS.find((item) => item.id === lessonId || item.number === Number(lessonId));
  if (!lesson) return { passed: false, message: `Unknown lesson: ${lessonId}` };
  if (!Array.isArray(rows)) return { passed: false, message: "Run the query before checking the lesson." };

  const validator = VALIDATORS.get(lesson.id);
  const [passed, retryMessage] = validator(rows, columns);
  return {
    passed,
    message: passed ? lesson.completionMessage : retryMessage
  };
}
