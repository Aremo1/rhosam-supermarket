/**
 * Check User Access Levels
 * 
 * Displays all active users with their effective access level.
 * 
 * Usage:
 *   node check-access-levels.js
 *   # Or via Render Shell:
 *   node check-access-levels.js
 */

require('dotenv').config();
const { Pool } = require('pg');

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  
  try {
    console.log('═══════════════════════════════════════════════════════════');
    console.log('  User Access Levels');
    console.log('═══════════════════════════════════════════════════════════\n');
    
    // Get all active users with their access level
    const { rows: users } = await pool.query(`
      SELECT 
        u.id,
        u.name,
        u.email,
        u.role,
        u.branch_id,
        b.name AS branch_name,
        CASE 
          WHEN u.role = 'ADMIN' AND u.branch_id IS NULL THEN 'SUPER_ADMIN'
          WHEN u.role = 'ADMIN' AND u.branch_id IS NOT NULL THEN 'BRANCH_ADMIN'
          WHEN u.role = 'MANAGER' THEN 'BRANCH_MANAGER'
          WHEN u.role = 'CASHIER' THEN 'BRANCH_CASHIER'
        END AS access_level,
        u.is_active,
        u.last_login_at
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
      console.log('  No active users found.\n');
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
      console.log(`  ${level} (${members.length}):`);
      for (const u of members) {
        const branch = u.branch_name ? ` — ${u.branch_name} [ID:${u.branch_id}]` : ' — All Branches';
        const lastLogin = u.last_login_at ? ` (last login: ${new Date(u.last_login_at).toLocaleDateString()})` : ' (never logged in)';
        console.log(`    • ${u.name} <${u.email}>${branch}${lastLogin}`);
      }
      console.log('');
    }
    
    // Branch summary
    console.log('═══════════════════════════════════════════════════════════');
    console.log('  Branch Summary');
    console.log('═══════════════════════════════════════════════════════════\n');
    
    const { rows: branches } = await pool.query(`
      SELECT 
        b.id,
        b.name,
        COUNT(CASE WHEN u.role = 'ADMIN' AND u.branch_id = b.id THEN 1 END) AS admins,
        COUNT(CASE WHEN u.role = 'MANAGER' AND u.branch_id = b.id THEN 1 END) AS managers,
        COUNT(CASE WHEN u.role = 'CASHIER' AND u.branch_id = b.id THEN 1 END) AS cashiers,
        COUNT(CASE WHEN u.branch_id = b.id AND u.is_active = TRUE THEN 1 END) AS total_users
      FROM branches b
      LEFT JOIN users u ON u.branch_id = b.id
      WHERE b.is_active = TRUE
      GROUP BY b.id, b.name
      ORDER BY b.name
    `);
    
    for (const b of branches) {
      const status = b.admins > 0 ? '✓' : '⚠ NO ADMIN';
      console.log(`  ${status} [${b.id}] ${b.name}`);
      console.log(`       Admins: ${b.admins} | Managers: ${b.managers} | Cashiers: ${b.cashiers} | Total: ${b.total_users}`);
    }
    
    // Check for branches without admins
    const noAdmin = branches.filter(b => b.admins === 0);
    if (noAdmin.length > 0) {
      console.log('\n  ⚠ Warning: The following branches have NO admin assigned:');
      noAdmin.forEach(b => console.log(`    • ${b.name}`));
    }
    
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log(`  Total: ${users.length} active user(s) across ${branches.length} branch(es)`);
    console.log('═══════════════════════════════════════════════════════════\n');
    
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
