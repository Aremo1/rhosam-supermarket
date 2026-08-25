// Quick script to run pending SQL migrations against the database
require("dotenv").config();
const { Pool } = require("pg");
const fs = require("fs");
const path = require("path");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  const migrations = [
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

  for (const file of migrations) {
    const filePath = path.join(__dirname, "sql", file);
    if (!fs.existsSync(filePath)) {
      console.log(`⚠️  Skipping ${file} — file not found`);
      continue;
    }
    const sql = fs.readFileSync(filePath, "utf8");
    console.log(`\n▶ Running ${file}...`);
    try {
      await pool.query(sql);
      console.log(`  ✅ ${file} applied successfully`);
    } catch (e) {
      // "already exists" errors are fine for idempotent migrations
      if (e.message.includes("already exists") || e.message.includes("duplicate key")) {
        console.log(`  ⏭️  ${file} — already applied (skipping)`);
      } else {
        console.error(`  ❌ ${file} — ${e.message}`);
      }
    }
  }

  // Verify branch_inventory table exists
  const { rows } = await pool.query(
    "SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name = 'branch_inventory') AS exists"
  );
  console.log(`\n📋 branch_inventory table exists: ${rows[0].exists}`);

  // Check branch_inventory row count
  if (rows[0].exists) {
    const { rows: counts } = await pool.query("SELECT COUNT(*)::int AS count FROM branch_inventory");
    console.log(`📊 branch_inventory rows: ${counts[0].count}`);
  }

  await pool.end();
  console.log("\n✅ Done!");
}

run().catch(e => { console.error(e); process.exit(1); });
