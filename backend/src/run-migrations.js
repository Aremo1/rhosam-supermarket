// Auto-run SQL migrations on server startup
// Runs each statement individually to avoid one failure blocking others
const fs = require("fs");
const path = require("path");

function splitStatements(sql) {
  // Split on semicolons, ignoring semicolons inside strings/comments
  const statements = [];
  let current = "";
  let inSingleQuote = false;
  let inDoubleQuote = false;
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
