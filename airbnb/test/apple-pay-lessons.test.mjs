import test from "node:test";
import assert from "node:assert/strict";
import { createLabDatabase, executeReadOnlyQuery } from "../scripts/lib/apple-pay-database.mjs";
import { LESSONS, evaluateLesson } from "../scripts/lib/apple-pay-lessons.mjs";

const REQUIRED_FIELDS = [
  "id", "number", "title", "duration", "objective", "concept", "task",
  "starterSql", "solutionSql", "hints", "modelPath", "completionMessage"
];

function unpack(result) {
  if (Array.isArray(result)) {
    return { rows: result, columns: Object.keys(result[0] ?? {}) };
  }
  const rows = result?.rows ?? [];
  const columns = result?.columns ?? Object.keys(rows[0] ?? {});
  return { rows, columns };
}

test("exports exactly ten ordered, unique, serializable lessons", () => {
  assert.equal(LESSONS.length, 10);
  assert.deepEqual(LESSONS.map((lesson) => lesson.number), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(new Set(LESSONS.map((lesson) => lesson.id)).size, 10);

  for (const lesson of LESSONS) {
    assert.deepEqual(Object.keys(lesson).sort(), [...REQUIRED_FIELDS].sort());
    assert.ok(lesson.hints.length >= 2);
    for (const field of REQUIRED_FIELDS.filter((name) => name !== "number" && name !== "hints")) {
      assert.equal(typeof lesson[field], "string", `${lesson.id}.${field} must be a string`);
      assert.ok(lesson[field].trim(), `${lesson.id}.${field} must not be blank`);
    }
  }

  const restored = JSON.parse(JSON.stringify(LESSONS));
  assert.deepEqual(restored, LESSONS);
});

test("every starter query is valid read-only SQLite", () => {
  const database = createLabDatabase();
  try {
    for (const lesson of LESSONS) {
      assert.doesNotThrow(
        () => executeReadOnlyQuery(database, lesson.starterSql),
        `${lesson.id} starter SQL should run`
      );
    }
  } finally {
    database.close();
  }
});

test("every solution passes its result-based validator", () => {
  const database = createLabDatabase();
  try {
    for (const lesson of LESSONS) {
      const { rows, columns } = unpack(executeReadOnlyQuery(database, lesson.solutionSql));
      assert.deepEqual(
        evaluateLesson(lesson.id, rows, columns),
        { passed: true, message: lesson.completionMessage },
        `${lesson.id} solution should pass`
      );
    }
  } finally {
    database.close();
  }
});

test("validators reject empty or malformed results", () => {
  for (const lesson of LESSONS) {
    const result = evaluateLesson(lesson.id, [], []);
    assert.equal(result.passed, false, `${lesson.id} should reject empty rows`);
    assert.ok(result.message);
  }

  assert.deepEqual(
    evaluateLesson("missing-lesson", [], []),
    { passed: false, message: "Unknown lesson: missing-lesson" }
  );
  assert.deepEqual(
    evaluateLesson("lesson-1", undefined, []),
    { passed: false, message: "Run the query before checking the lesson." }
  );
});

test("lesson 8 rejects the old cross-currency decline aggregation", () => {
  const mixedCurrencyRows = [
    {
      payment_network: "VISA",
      decline_reason: "insufficient_funds",
      decline_count: 2,
      requested_amount: 33.7
    },
    {
      payment_network: "MASTERCARD",
      decline_reason: "suspected_fraud",
      decline_count: 1,
      requested_amount: 108.3
    },
    {
      payment_network: "VISA",
      decline_reason: "do_not_honor",
      decline_count: 1,
      requested_amount: 7.1
    }
  ];

  const result = evaluateLesson("lesson-8", mixedCurrencyRows, Object.keys(mixedCurrencyRows[0]));
  assert.equal(result.passed, false);
  assert.match(result.message, /currency/i);
});
