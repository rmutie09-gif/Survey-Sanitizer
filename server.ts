import express from "express";
import { createServer as createViteServer } from "vite";
import Database from "better-sqlite3";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;
const db = new Database("database.sqlite");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    email TEXT PRIMARY KEY,
    country TEXT,
    plan TEXT,
    upload_count INTEGER DEFAULT 0,
    last_active TIMESTAMP
  )
`);

async function startServer() {
  const app = express();
  app.use(express.json());

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

  app.get("/api/admin/users", (req, res) => {
    try {
      const users = db.prepare("SELECT * FROM users ORDER BY last_active DESC").all();
      res.json(users);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Database error" });
    }
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), "dist");
    
    app.use(express.static(distPath));

    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"), (err) => {
        if (err) {
          res.status(404).send("Index file not found");
        }
      });
    });
  }

  app.listen(Number(PORT), "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();
