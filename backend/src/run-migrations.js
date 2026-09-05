// Auto-run SQL migrations on server startup
// Runs each statement individually to avoid one failure blocking others
const fs = require("fs");
const path = require("path");

function splitStatements(sql) {
  // Split on semicolons, ignoring semicolons inside strings, dollar-quotes, and comments
  const statements = [];
  let current = "";
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inDollarQuote = false;
  let dollarTag = "";
  let inComment = false;
  let lineComment = false;

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    const next = sql[i + 1];

    if (lineComment) {
      if (ch === "\n") lineComment = false;
      current += ch;
      continue;
    }
    if (inComment) {
      current += ch;
      if (ch === "*" && next === "/") {
        current += "/";
        i++;
        inComment = false;
      }
      continue;
    }

    // Handle dollar-quoted strings (e.g. $$ ... $$ or $tag$ ... $tag$)
    if (inDollarQuote) {
      current += ch;
      if (ch === dollarTag[0] && sql.substring(i, i + dollarTag.length) === dollarTag) {
        current += sql.substring(i + 1, i + dollarTag.length);
        i += dollarTag.length - 1;
        inDollarQuote = false;
      }
      continue;
    }
    if (ch === "$" && !inSingleQuote && !inDoubleQuote) {
      // Check for dollar tag opening
      let tag = "$";
      let j = i + 1;
      while (j < sql.length && sql[j] !== "$" && sql[j] !== "\n" && sql[j] !== " ") {
        tag += sql[j];
        j++;
      }
      if (j < sql.length && sql[j] === "$") {
        tag += "$";
        current += tag;
        i = j;
        inDollarQuote = true;
        dollarTag = tag;
        continue;
      }
    }

    if (ch === "\'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
    } else if (ch === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
    } else if (!inSingleQuote && !inDoubleQuote) {
      if (ch === "-" && next === "-") {
        lineComment = true;
        current += ch;
        continue;
      }
      if (ch === "/" && next === "*") {
        inComment = true;
        current += ch;
        continue;
      }
      if (ch === ";") {
        const trimmed = current.trim();
        if (trimmed) statements.push(trimmed);
        current = "";
        continue;
      }
    }
    current += ch;
  }
  const last = current.trim();
  if (last) statements.push(last);
  return statements;
}

async function runMigrations(pool) {
  const migrations = [
    "schema.sql",
    "migration-branch-scoping.sql",
    "migration-branch-comm.sql",
    "migration-branch-inventory.sql",
    "migration-valuation-snapshots.sql",
    "migration-product-expiry.sql",
    "migration-inventory-audit.sql",
    "migration-stock-alerts.sql",
    "migration-notifications.sql",
    "migration-payment-and-audit.sql",
    "migration-payment-settings.sql",
    "migration-paystack-terminal.sql",
    "migration-po-payments.sql",
    "migration-store-commerce.sql",
    "migration-priority-gaps.sql",
    "migration-final-gaps.sql",
    "migration-final-features.sql",
  ];

  const sqlDir = path.join(__dirname, "..", "sql");
  let totalStatements = 0;
  let succeeded = 0;
  let alreadyExisted = 0;
  let errors = 0;

  for (const file of migrations) {
    const filePath = path.join(sqlDir, file);
    if (!fs.existsSync(filePath)) {
      console.log(`  ⚠️  Skipping ${file} — file not found`);
      continue;
    }
    const sql = fs.readFileSync(filePath, "utf8");
    const statements = splitStatements(sql);
    for (const stmt of statements) {
      totalStatements++;
      try {
        await pool.query(stmt);
        succeeded++;
      } catch (e) {
        if (
          e.message.includes("already exists") ||
          e.message.includes("duplicate key")
        ) {
          alreadyExisted++;
        } else {
          errors++;
          // Only log real errors, not dependency ordering issues
          if (!e.message.includes("does not exist") && !e.message.includes("referenced")) {
            console.error(`  ❌ ${file}:`, e.message.substring(0, 200));
          }
        }
      }
    }
  }

  console.log(
    `[MIGRATIONS] ✅ ${succeeded} applied, ${alreadyExisted} existed, ${errors} errors (of ${totalStatements} statements)`
  );
}

module.exports = { runMigrations };
