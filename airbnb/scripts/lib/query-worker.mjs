import { parentPort, workerData } from "node:worker_threads";
import { createLabDatabase, executeReadOnlyQuery } from "./apple-pay-database.mjs";

if (!parentPort) {
  throw new Error("query-worker.mjs must run inside a Node.js Worker.");
}

function runQuery(message) {
  const id = message?.id ?? null;
  const startedAt = performance.now();
  let database;

  try {
    database = createLabDatabase();
    const result = executeReadOnlyQuery(database, message?.sql, { limit: message?.limit });
    parentPort.postMessage({
      id,
      ok: true,
      result: {
        ...result,
        durationMs: Math.round((performance.now() - startedAt) * 100) / 100
      }
    });
  } catch (error) {
    parentPort.postMessage({
      id,
      ok: false,
      error: {
        message: error instanceof Error ? error.message : "The query could not be completed."
      }
    });
  } finally {
    database?.close();
    parentPort.close();
  }
}

// The HTTP server uses one short-lived worker per query and supplies workerData.
// Accepting a posted message as well keeps the worker independently reusable.
if (workerData !== undefined && workerData !== null) runQuery(workerData);
else parentPort.once("message", runQuery);
