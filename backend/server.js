const express = require("express");
const cors = require("cors");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");
require("dotenv").config();

const app = express();
const port = Number(process.env.PORT || 5000);
const JWT_SECRET = process.env.JWT_SECRET;

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is missing in backend/.env");
  process.exit(1);
}
if (!JWT_SECRET) {
  console.error("JWT_SECRET is missing in backend/.env");
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
app.use(cors({ origin: process.env.FRONTEND_URL || "http://localhost:5173" }));
app.use(express.json({ limit: "1mb" }));

function authenticate(req, res, next) {
  const authorization = req.headers.authorization || "";
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice(7)
    : null;

  if (!token) {
    return res.status(401).json({ message: "Authentication required." });
  }

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    return next();
  } catch {
    return res.status(401).json({ message: "Session expired or invalid." });
  }
}

function allow(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        message: "You do not have permission for this action.",
      });
    }
    return next();
  };
}

async function audit(client, userId, action, entityType, entityId, details = {}) {
  await client.query(
    `INSERT INTO audit_logs
      (user_id, action, entity_type, entity_id, details)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, action, entityType, String(entityId || ""), JSON.stringify(details)]
  );
}

app.get("/api/health", async (_req, res, next) => {
  try {
    await pool.query("SELECT 1");
    return res.json({ status: "ok" });
  } catch (error) {
    return next(error);
  }
});

app.post("/api/auth/login", async (req, res, next) => {
  try {
    const email = String(req.body.email || "")
      .trim()
      .toLowerCase();

    const password = String(req.body.password || "");

    const { rows } = await pool.query(
      `
      SELECT
        id,
        name,
        email,
        password_hash,
        role,
        is_active
      FROM users
      WHERE LOWER(email) = $1
      `,
      [email]
    );

    const user = rows[0];

    const passwordMatches = user
      ? await bcrypt.compare(
          password,
          user.password_hash
        )
      : false;

    if (
      !user ||
      !user.is_active ||
      !passwordMatches
    ) {
      return res.status(401).json({
        message: "Invalid email or password."
      });
    }

    const token = jwt.sign(
      {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role
      },
      JWT_SECRET,
      {
        expiresIn: "8h"
      }
    );

    await pool.query(
      `
      UPDATE users
      SET last_login_at = NOW()
      WHERE id = $1
      `,
      [user.id]
    );

    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });

  } catch (error) {
    next(error);
  }
});

app.get("/api/auth/me", authenticate, (req, res) => {
  return res.json({ user: req.user });
});

app.get("/api/products", authenticate, async (_req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, barcode, name, category, price::float, stock, reorder_level
       FROM products
       ORDER BY name`
    );
    return res.json(rows);
  } catch (error) {
    return next(error);
  }
});

app.post(
  "/api/products",
  authenticate,
  allow("ADMIN", "MANAGER"),
  async (req, res, next) => {
    try {
      const { barcode, name, category, price, stock = 0, reorderLevel = 5 } =
        req.body;

      if (
        !barcode ||
        !name ||
        !category ||
        Number(price) < 0 ||
        Number(stock) < 0
      ) {
        return res.status(400).json({ message: "Enter valid product details." });
      }

      const { rows } = await pool.query(
        `INSERT INTO products
          (barcode, name, category, price, stock, reorder_level)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, barcode, name, category, price::float, stock, reorder_level`,
        [barcode, name, category, Number(price), Number(stock), Number(reorderLevel)]
      );

      await audit(pool, req.user.id, "CREATE", "PRODUCT", rows[0].id, {
        barcode,
        name,
      });
      return res.status(201).json(rows[0]);
    } catch (error) {
      if (error.code === "23505") {
        return res.status(409).json({ message: "Barcode already exists." });
      }
      return next(error);
    }
  }
);

app.get("/api/sales", authenticate, async (req, res, next) => {
  try {
    const clause = req.user.role === "CASHIER" ? "WHERE s.cashier_id = $1" : "";
    const params = req.user.role === "CASHIER" ? [req.user.id] : [];
    const { rows } = await pool.query(
      `SELECT s.id, s.receipt_number, s.customer_name, s.payment_method,
              s.total::float, s.created_at, u.name AS cashier_name,
              COALESCE(SUM(si.quantity), 0)::int AS item_count
       FROM sales s
       JOIN users u ON u.id = s.cashier_id
       LEFT JOIN sale_items si ON si.sale_id = s.id
       ${clause}
       GROUP BY s.id, u.name
       ORDER BY s.created_at DESC
       LIMIT 100`,
      params
    );
    return res.json(rows);
  } catch (error) {
    return next(error);
  }
});

app.post(
  "/api/sales",
  authenticate,
  allow("ADMIN", "MANAGER", "CASHIER"),
  async (req, res, next) => {
    const client = await pool.connect();
    try {
      const {
        customerName = "Walk-in Customer",
        paymentMethod,
        items,
      } = req.body;

      if (!["Cash", "Card", "Transfer"].includes(paymentMethod)) {
        return res.status(400).json({ message: "Invalid payment method." });
      }
      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ message: "Cart is empty." });
      }

      await client.query("BEGIN");
      const detailed = [];
      let total = 0;

      for (const raw of items) {
        const productId = Number(raw.productId);
        const quantity = Number(raw.quantity);
        if (!Number.isInteger(productId) || !Number.isInteger(quantity) || quantity < 1) {
          throw Object.assign(new Error("Invalid sale item."), { status: 400 });
        }

        const { rows } = await client.query(
          "SELECT id, name, price::float, stock FROM products WHERE id = $1 FOR UPDATE",
          [productId]
        );
        const product = rows[0];
        if (!product) {
          throw Object.assign(new Error("Product not found."), { status: 404 });
        }
        if (product.stock < quantity) {
          throw Object.assign(
            new Error(
              `Insufficient stock for ${product.name}. Available: ${product.stock}`
            ),
            { status: 409 }
          );
        }

        const lineTotal = Number(product.price) * quantity;
        total += lineTotal;
        detailed.push({
          productId: product.id,
          name: product.name,
          price: Number(product.price),
          quantity,
          lineTotal,
        });
      }

      const receiptNumber = `RHS-${Date.now()}-${Math.floor(
        Math.random() * 900 + 100
      )}`;
      const { rows } = await client.query(
        `INSERT INTO sales
          (receipt_number, customer_name, payment_method, total, cashier_id)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, created_at`,
        [receiptNumber, String(customerName).slice(0, 120), paymentMethod, total, req.user.id]
      );
      const sale = rows[0];

      for (const item of detailed) {
        await client.query(
          `INSERT INTO sale_items
            (sale_id, product_id, product_name, unit_price, quantity, line_total)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [sale.id, item.productId, item.name, item.price, item.quantity, item.lineTotal]
        );
        await client.query(
          "UPDATE products SET stock = stock - $1, updated_at = NOW() WHERE id = $2",
          [item.quantity, item.productId]
        );
        await client.query(
          `INSERT INTO inventory_movements
            (product_id, movement_type, quantity, reference, user_id)
           VALUES ($1, 'SALE', $2, $3, $4)`,
          [item.productId, -item.quantity, receiptNumber, req.user.id]
        );
      }

      await audit(client, req.user.id, "CREATE", "SALE", sale.id, {
        receiptNumber,
        total,
      });
      await client.query("COMMIT");

      return res.status(201).json({
        id: sale.id,
        receiptNumber,
        createdAt: sale.created_at,
        customerName,
        paymentMethod,
        cashierName: req.user.name,
        items: detailed,
        total,
      });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      return next(error);
    } finally {
      client.release();
    }
  }
);

app.get("/api/users", authenticate, allow("ADMIN"), async (_req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, email, role, is_active, last_login_at, created_at
       FROM users
       ORDER BY name`
    );
    return res.json(rows);
  } catch (error) {
    return next(error);
  }
});

app.post("/api/users", authenticate, allow("ADMIN"), async (req, res, next) => {
  try {
    const { name, email, password, role } = req.body;
    if (
      !name ||
      !email ||
      String(password).length < 8 ||
      !["ADMIN", "MANAGER", "CASHIER"].includes(role)
    ) {
      return res.status(400).json({
        message:
          "Name, valid email, role and password of at least 8 characters are required.",
      });
    }

    const hash = await bcrypt.hash(password, 12);
    const { rows } = await pool.query(
      `INSERT INTO users (name, email, password_hash, role)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, email, role, is_active, created_at`,
      [name, String(email).trim().toLowerCase(), hash, role]
    );
    await audit(pool, req.user.id, "CREATE", "USER", rows[0].id, {
      email: rows[0].email,
      role,
    });
    return res.status(201).json(rows[0]);
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({ message: "Email already exists." });
    }
    return next(error);
  }
});

app.get(
  "/api/audit-logs",
  authenticate,
  allow("ADMIN"),
  async (_req, res, next) => {
    try {
      const { rows } = await pool.query(
        `SELECT a.id, u.name AS user_name, a.action, a.entity_type,
                a.entity_id, a.details, a.created_at
         FROM audit_logs a
         LEFT JOIN users u ON u.id = a.user_id
         ORDER BY a.created_at DESC
         LIMIT 200`
      );
      return res.json(rows);
    } catch (error) {
      return next(error);
    }
  }
);

app.use((err, _req, res, _next) => {
  console.error(err);
  return res.status(err.status || 500).json({
    message: err.status ? err.message : "Unexpected server error.",
  });
});

app.listen(port, () => {
  console.log(`RHoSAM API running on http://localhost:${port}`);
});
