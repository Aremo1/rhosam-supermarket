/**
 * Production RBAC Migration Runner
 * 
 * Applies both branch-scoping and RBAC documentation migrations
 * to the production database.
 * 
 * Usage (via Render Shell or locally with DATABASE_URL set):
 *   node run-production-migration.js
 * 
 * This migration is idempotent — safe to run multiple times.
 * 
 * What it does:
 *   1. Adds documentation comments to users, branches, sales, branch_inventory tables
 *   2. Creates get_user_access_level() function
 *   3. Creates v_user_access_levels view
 *   4. Creates v_permissions_matrix view
 *   5. Creates v_branch_user_summary view
 *   6. Creates v_branches_without_admin view
 *   7. Logs a summary of current user access levels
 *   8. Records the migration in audit_logs
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

async function runMigration(pool, filePath, label) {
  console.log(`\n── Applying: ${label} ──`);
  
  const sql = fs.readFileSync(filePath, 'utf8');
  
  // Split into individual statements, handling $$ delimiters for functions
  const statements = [];
  let current = '';
  let inDollarQuote = false;
  
  for (const line of sql.split('\n')) {
    // Skip pure comment lines
    const trimmed = line.trim();
    if (trimmed.startsWith('--') && !trimmed.includes('$$')) {
      current += line + '\n';
      continue;
    }
    
    // Track $$ delimiters (function bodies)
    if (line.includes('$$')) {
      inDollarQuote = !inDollarQuote;
    }
    
    current += line + '\n';
    
    // Split on semicolons only when not inside a $$ block
    if (!inDollarQuote && line.trim().endsWith(';')) {
      const stmt = current.trim();
      if (stmt.length > 0 && !stmt.startsWith('--')) {
        statements.push(stmt);
      }
      current = '';
    }
  }
  
  // Don't forget the last statement
  const lastStmt = current.trim();
  if (lastStmt.length > 0 && !lastStmt.startsWith('--')) {
    statements.push(lastStmt);
  }
  
  console.log(`  Found ${statements.length} SQL statements`);
  
  let success = 0;
  let skipped = 0;
  let failed = 0;
  
  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    // Skip empty or comment-only statements
    if (!stmt || stmt.split('\n').every(l => l.trim().startsWith('--') || !l.trim())) {
      skipped++;
      continue;
    }
    
    try {
      await pool.query(stmt);
      success++;
    } catch (err) {
      // Idempotent: skip if object already exists
      if (['42710', '42P07', '42P16'].includes(err.code) || 
          err.message.includes('already exists') ||
          err.message.includes('does not exist')) {
        skipped++;
      } else {
        console.error(`  ✗ Statement ${i + 1} failed: ${err.message}`);
        failed++;
      }
    }
  }
  
  console.log(`  ✓ ${success} applied, ${skipped} skipped (already exist), ${failed} failed`);
  return { success, skipped, failed };
}

async function showAccessLevels(pool) {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  Current User Access Levels');
  console.log('═══════════════════════════════════════════════════════════');
  
  try {
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
      ORDER BY 
        CASE 
          WHEN u.role = 'ADMIN' AND u.branch_id IS NULL THEN 1
          WHEN u.role = 'ADMIN' AND u.branch_id IS NOT NULL THEN 2
          WHEN u.role = 'MANAGER' THEN 3
          WHEN u.role = 'CASHIER' THEN 4
        END,
        b.name, u.name
    `);
    
    if (users.length === 0) {
      console.log('  No active users found.');
      return;
    }
    
    // Group by access level
    const groups = {};
    for (const u of users) {
      const level = u.access_level || 'UNKNOWN';
      if (!groups[level]) groups[level] = [];
      groups[level].push(u);
    }
    
    for (const [level, members] of Object.entries(groups)) {
      console.log(`\n  ${level} (${members.length}):`);
      for (const u of members) {
        const branch = u.branch_name ? ` — ${u.branch_name}` : ' — All Branches';
        console.log(`    • ${u.name} <${u.email}>${branch}`);
      }
    }
    
    // Show branch summary
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('  Branch Admin Summary');
    console.log('═══════════════════════════════════════════════════════════');
    
    try {
      const { rows: branches } = await pool.query(`
        SELECT b.name,
          COUNT(CASE WHEN u.role = 'ADMIN' AND u.branch_id = b.id THEN 1 END) AS admins,
          COUNT(CASE WHEN u.role = 'MANAGER' AND u.branch_id = b.id THEN 1 END) AS managers,
          COUNT(CASE WHEN u.role = 'CASHIER' AND u.branch_id = b.id THEN 1 END) AS cashiers
        FROM branches b
        LEFT JOIN users u ON u.branch_id = b.id AND u.is_active = TRUE
        WHERE b.is_active = TRUE
        GROUP BY b.id, b.name
        ORDER BY b.name
      `);
      
      for (const b of branches) {
        const status = b.admins > 0 ? '✓' : '⚠ No admin';
        console.log(`  ${status} ${b.name}: ${b.admins} admin(s), ${b.managers} manager(s), ${b.cashiers} cashier(es)`);
      }
    } catch {
      console.log('  (Branch summary not available)');
    }
    
  } catch (err) {
    console.log(`  Could not load user access levels: ${err.message}`);
  }
}

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('Error: DATABASE_URL environment variable is not set.');
    console.error('');
    console.error('Usage:');
    console.error('  # Via Render Shell:');
    console.error('  DATABASE_URL=<your-db-url> node run-production-migration.js');
    console.error('');
    console.error('  # Or set DATABASE_URL first:');
    console.error('  export DATABASE_URL="postgresql://..."');
    console.error('  node run-production-migration.js');
    process.exit(1);
  }
  
  // Mask the password in logs
  const maskedUrl = dbUrl.replace(/:([^@]+)@/, ':****@');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  RHoSAM Production RBAC Migration');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  Database: ${maskedUrl}`);
  console.log('');
  
  const pool = new Pool({ connectionString: dbUrl });
  
  try {
    // Test connection
    const start = Date.now();
    await pool.query('SELECT 1');
    console.log(`  ✓ Database connected (${Date.now() - start}ms)\n`);
    
    // Migration 1: Branch Scoping v2
    const m1 = await runMigration(
      pool,
      path.join(__dirname, 'sql', 'migration-branch-scoping-v2.sql'),
      'Branch Scoping v2'
    );
    
    // Migration 2: RBAC Documentation
    const m2 = await runMigration(
      pool,
      path.join(__dirname, 'sql', 'migration-rbac-documentation.sql'),
      'RBAC Documentation'
    );
    
    // Summary
    const totalSuccess = m1.success + m2.success;
    const totalSkipped = m1.skipped + m2.skipped;
    const totalFailed = m1.failed + m2.failed;
    
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('  Migration Summary');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`  Total: ${totalSuccess} applied, ${totalSkipped} skipped, ${totalFailed} failed`);
    
    if (totalFailed > 0) {
      console.log('\n  ⚠ Some statements failed. Review errors above.');
    } else {
      console.log('\n  ✓ All migrations applied successfully!');
    }
    
    // Show current access levels
    await showAccessLevels(pool);
    
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('  Migration complete!');
    console.log('═══════════════════════════════════════════════════════════');
    
  } catch (err) {
    console.error('\nMigration failed:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
