// Auto-run SQL migrations on server startup
const fs = require("fs");
const path = require("path");

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
  let applied = 0;
  let skipped = 0;

  for (const file of migrations) {
    const filePath = path.join(sqlDir, file);
    if (!fs.existsSync(filePath)) {
      console.log(`  ⚠️  Skipping ${file} — file not found`);
      continue;
    }
    const sql = fs.readFileSync(filePath, "utf8");
    try {
      await pool.query(sql);
      applied++;
    } catch (e) {
      if (e.message.includes("already exists") || e.message.includes("duplicate key")) {
        skipped++;
      } else {
        console.error(`  ❌ Migration ${file} failed:`, e.message);
      }
    }
  }

  console.log(`[MIGRATIONS] ✅ ${applied} applied, ${skipped} already existed`);
}

module.exports = { runMigrations };
