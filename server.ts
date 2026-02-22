import express from "express";
import { createServer as createViteServer } from "vite";
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const db = new Database("database.sqlite");

// Initialize database
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE,
    country TEXT,
    upload_count INTEGER DEFAULT 0,
    plan TEXT DEFAULT 'freemium',
    last_active DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API Routes
  
  // Register or Update User
  app.post("/api/users", (req, res) => {
    const { email, country, plan } = req.body;
    if (!email) return res.status(400).json({ error: "Email is required" });

    try {
      const stmt = db.prepare(`
        INSERT INTO users (email, country, plan, last_active) 
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(email) DO UPDATE SET 
          country = excluded.country,
          plan = excluded.plan,
          last_active = CURRENT_TIMESTAMP
      `);
      stmt.run(email, country || 'Unknown', plan || 'freemium');
      res.json({ success: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Database error" });
    }
  });

  // Update Upload Count
  app.post("/api/users/upload", (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Email is required" });

    try {
      const stmt = db.prepare(`
        UPDATE users SET upload_count = upload_count + 1, last_active = CURRENT_TIMESTAMP 
        WHERE email = ?
      `);
      stmt.run(email);
      res.json({ success: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Database error" });
    }
  });

  // Get All Users (Admin only)
  app.get("/api/admin/users", (req, res) => {
    // In a real app, we'd check admin auth here
    try {
      const users = db.prepare("SELECT * FROM users ORDER BY last_active DESC").all();
      res.json(users);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Database error" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
