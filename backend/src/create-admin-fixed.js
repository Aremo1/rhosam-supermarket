const bcrypt = require("bcrypt");
const { Pool } = require("pg");
require("dotenv").config();

(async () => {
  const name = String(process.env.ADMIN_NAME || "SAMSON").trim();
  const email = String(process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  const password = String(process.env.ADMIN_PASSWORD || "");

  if (!email) throw new Error("ADMIN_EMAIL is missing in backend/.env");
  if (password.length < 12) {
    throw new Error("ADMIN_PASSWORD must contain at least 12 characters.");
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const passwordHash = await bcrypt.hash(password, 12);
    const { rows } = await pool.query(
      `INSERT INTO users (name, email, password_hash, role, is_active)
       VALUES ($1, $2, $3, 'ADMIN', TRUE)
       ON CONFLICT (email)
       DO UPDATE SET
         name = EXCLUDED.name,
         password_hash = EXCLUDED.password_hash,
         role = 'ADMIN',
         is_active = TRUE
       RETURNING id, name, email, role, is_active`,
      [name, email, passwordHash]
    );

    const verified = await bcrypt.compare(password, passwordHash);
    console.log("Administrator created or reset successfully.");
    console.log({ ...rows[0], passwordHashVerified: verified });
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
