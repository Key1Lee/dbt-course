const MUTATING_KEYWORDS = new Set([
  "ALTER",
  "ANALYZE",
  "ATTACH",
  "BEGIN",
  "CALL",
  "COMMIT",
  "COPY",
  "CREATE",
  "DELETE",
  "DETACH",
  "DROP",
  "EXECUTE",
  "GET",
  "GRANT",
  "INSERT",
  "MERGE",
  "PRAGMA",
  "PUT",
  "REINDEX",
  "REMOVE",
  "REPLACE",
  "REVOKE",
  "ROLLBACK",
  "SET",
  "TRUNCATE",
  "UNDROP",
  "UNSET",
  "UPDATE",
  "UPSERT",
  "USE",
  "VACUUM"
]);

function dollarQuoteAt(sql, index) {
  const match = sql.slice(index).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/);
  return match?.[0] ?? null;
}

/**
 * Replace comments, string literals, quoted identifiers, and dollar-quoted
 * bodies with spaces. Keywords left behind can then be inspected safely.
 */
export function sqlCodeOnly(sql) {
  let output = "";
  let state = "normal";
  let dollarTag = null;

  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index];
    const next = sql[index + 1];

    if (state === "normal") {
      if (char === "'" || char === '"') {
        state = char === "'" ? "single" : "double";
        output += " ";
      } else if (char === "-" && next === "-") {
        state = "line-comment";
        output += "  ";
        index += 1;
      } else if (char === "/" && next === "*") {
        state = "block-comment";
        output += "  ";
        index += 1;
      } else if (char === "$") {
        const tag = dollarQuoteAt(sql, index);
        if (tag) {
          state = "dollar";
          dollarTag = tag;
          output += " ".repeat(tag.length);
          index += tag.length - 1;
        } else {
          output += char;
        }
      } else {
        output += char;
      }
      continue;
    }

    if (state === "single") {
      output += char === "\n" || char === "\r" ? char : " ";
      if (char === "'" && next === "'") {
        output += " ";
        index += 1;
      } else if (char === "'") {
        state = "normal";
      }
      continue;
    }

    if (state === "double") {
      output += char === "\n" || char === "\r" ? char : " ";
      if (char === '"' && next === '"') {
        output += " ";
        index += 1;
      } else if (char === '"') {
        state = "normal";
      }
      continue;
    }

    if (state === "line-comment") {
      if (char === "\n" || char === "\r") {
        output += char;
        state = "normal";
      } else {
        output += " ";
      }
      continue;
    }

    if (state === "block-comment") {
      output += char === "\n" || char === "\r" ? char : " ";
      if (char === "*" && next === "/") {
        output += " ";
        index += 1;
        state = "normal";
      }
      continue;
    }

    if (state === "dollar") {
      if (sql.startsWith(dollarTag, index)) {
        output += " ".repeat(dollarTag.length);
        index += dollarTag.length - 1;
        state = "normal";
        dollarTag = null;
      } else {
        output += char === "\n" || char === "\r" ? char : " ";
      }
    }
  }

  return output;
}

/** Split SQL on statement terminators that are outside literals/comments. */
export function splitSqlStatements(sql) {
  const statements = [];
  let buffer = "";
  let state = "normal";
  let dollarTag = null;

  const pushBuffer = () => {
    if (sqlCodeOnly(buffer).trim()) {
      statements.push(buffer.trim());
    }
    buffer = "";
  };

  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index];
    const next = sql[index + 1];

    if (state === "normal") {
      if (char === ";") {
        pushBuffer();
        continue;
      }

      if (char === "'" || char === '"') {
        state = char === "'" ? "single" : "double";
      } else if (char === "-" && next === "-") {
        state = "line-comment";
      } else if (char === "/" && next === "*") {
        state = "block-comment";
      } else if (char === "$") {
        const tag = dollarQuoteAt(sql, index);
        if (tag) {
          state = "dollar";
          dollarTag = tag;
        }
      }
    } else if (state === "single") {
      if (char === "'" && next === "'") {
        buffer += char + next;
        index += 1;
        continue;
      }
      if (char === "'") state = "normal";
    } else if (state === "double") {
      if (char === '"' && next === '"') {
        buffer += char + next;
        index += 1;
        continue;
      }
      if (char === '"') state = "normal";
    } else if (state === "line-comment") {
      if (char === "\n" || char === "\r") state = "normal";
    } else if (state === "block-comment") {
      if (char === "*" && next === "/") {
        buffer += char + next;
        index += 1;
        state = "normal";
        continue;
      }
    } else if (state === "dollar" && sql.startsWith(dollarTag, index)) {
      buffer += dollarTag;
      index += dollarTag.length - 1;
      state = "normal";
      dollarTag = null;
      continue;
    }

    buffer += char;
  }

  pushBuffer();
  return statements;
}

/**
 * Fail closed unless SQL is a single read-only statement. This is a helpful
 * application guard; warehouse permissions remain the real security boundary.
 */
export function assertReadOnlySql(sql, dialect = "sqlite") {
  if (typeof sql !== "string" || !sqlCodeOnly(sql).trim()) {
    throw new Error("Provide a non-empty SQL query.");
  }

  const statements = splitSqlStatements(sql);
  if (statements.length !== 1) {
    throw new Error("Only one SQL statement can be run at a time.");
  }

  const statement = statements[0];
  const code = sqlCodeOnly(statement).toUpperCase();
  const tokens = code.match(/[A-Z_][A-Z0-9_$]*/g) ?? [];
  const allowedStarts = dialect === "snowflake"
    ? new Set(["SELECT", "WITH", "SHOW", "DESCRIBE", "DESC", "EXPLAIN"])
    : new Set(["SELECT", "WITH", "EXPLAIN"]);

  if (!allowedStarts.has(tokens[0])) {
    throw new Error(
      `Read-only mode rejected a statement beginning with ${tokens[0] ?? "an unknown token"}.`
    );
  }

  const mutatingKeyword = tokens.find((token) => MUTATING_KEYWORDS.has(token));
  if (mutatingKeyword) {
    throw new Error(`Read-only mode rejected the keyword ${mutatingKeyword}.`);
  }

  // Snowflake exposes side-effecting SYSTEM$ functions through SELECT (for
  // example notification, task, pipe, and session operations). Fail closed on
  // the entire namespace instead of trying to maintain a fragile denylist.
  const systemFunction = dialect === "snowflake"
    ? tokens.find((token) => token.startsWith("SYSTEM$"))
    : undefined;
  if (systemFunction) {
    throw new Error(`Read-only mode rejected ${systemFunction}.`);
  }

  return statement;
}
