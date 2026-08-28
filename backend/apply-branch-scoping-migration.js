/**
 * Apply Branch-Scoped Access Control Migration
 * 
 * This script applies the branch-scoping-v2.sql migration to update
 * existing ADMIN users who have a branch_id to understand they are
 * now branch-scoped.
 * 
 * Usage:
 *   node apply-branch-scoping-migration.js
 * 
 * What this migration does:
 *   1. Adds documentation comments to users and branches tables
 *   2. Creates a v_user_access_level view for easy access level checking
 *   3. Logs a summary of current user access levels
 *   4. Records the migration in audit_logs
 * 
 * IMPORTANT: This migration is safe to run multiple times (idempotent).
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    console.log('═══════════════════════════════════════════════════════════');
    console.log('Branch-Scoped Access Control Migration');
    console.log('═══════════════════════════════════════════════════════════');
    
    // Read the migration file
    const migrationPath = path.join(__dirname, 'sql', 'migration-branch-scoping-v2.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
    
    // Split into individual statements
    const statements = migrationSQL
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));
    
    console.log(`Found ${statements.length} SQL statements to execute`);
    
    // Execute each statement
    let successCount = 0;
    let errorCount = 0;
    
    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i];
      if (!stmt.trim()) continue;
      
      try {
        await pool.query(stmt);
        successCount++;
        console.log(`✓ Statement ${i + 1}/${statements.length} executed successfully`);
      } catch (err) {
        // Some statements might fail if they already exist (e.g., VIEW)
        if (err.code === '42710' || err.code === '42P07') {
          // Duplicate type or table already exists - this is OK
          console.log(`⚠ Statement ${i + 1}/${statements.length} skipped (already exists)`);
          successCount++;
        } else {
          console.error(`✗ Statement ${i + 1}/${statements.length} failed:`, err.message);
          errorCount++;
        }
      }
    }
    
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`Migration complete: ${successCount} succeeded, ${errorCount} failed`);
    console.log('═══════════════════════════════════════════════════════════');
    
    // Show current access levels
    console.log('\nCurrent User Access Levels:');
    console.log('─────────────────────────────');
    
    const { rows: users } = await pool.query(`
      SELECT 
        u.name,
        u.email,
        u.role,
        b.name AS branch_name,
        CASE 
          WHEN u.role = 'ADMIN' AND u.branch_id IS NULL THEN 'SUPER_ADMIN'
          WHEN u.role = 'ADMIN' AND u.branch_id IS NOT NULL THEN 'BRANCH_ADMIN'
          WHEN u.role = 'MANAGER' THEN 'BRANCH_MANAGER'
          WHEN u.role = 'CASHIER' THEN 'BRANCH_CASHIER'
        END AS access_level
      FROM users u
      LEFT JOIN branches b ON b.id = u.branch_id
      WHERE u.is_active = TRUE
      ORDER BY u.role, b.name, u.name
    `);
    
    for (const user of users) {
      const branch = user.branch_name ? ` (${user.branch_name})` : ' (All Branches)';
      console.log(`  ${user.access_level}: ${user.name} <${user.email}>${branch}`);
    }
    
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
