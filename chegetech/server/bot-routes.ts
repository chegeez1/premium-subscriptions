import type { Express } from "express";
import { runQuery, runMutation, dbType } from "./storage";
import { getPaystackSecretKey, getPaystackPublicKey } from "./secrets";

function generateReference(): string {
  return `CTB-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

function parseFeatures(f: string | null | undefined): string[] {
  try { return JSON.parse(f ?? "[]"); } catch { return []; }
}

function fmtBot(b: any) {
  return {
    ...b,
    features: parseFeatures(b.features),
    requiresSessionId: dbType === "pg" ? !!b.requires_session_id : !!b.requires_session_id,
    requiresDbUrl: dbType === "pg" ? !!b.requires_db_url : !!b.requires_db_url,
    repoUrl: b.repo_url ?? b.repoUrl,
    imageUrl: b.image_url ?? b.imageUrl,
    createdAt: b.created_at ?? b.createdAt,
  };
}

function fmtOrder(o: any) {
  return {
    ...o,
    botId: o.bot_id ?? o.botId,
    botName: o.bot_name ?? o.botName,
    customerName: o.customer_name ?? o.customerName,
    customerEmail: o.customer_email ?? o.customerEmail,
    customerPhone: o.customer_phone ?? o.customerPhone,
    sessionId: o.session_id ?? o.sessionId,
    dbUrl: o.db_url ?? o.dbUrl,
    paystackReference: o.paystack_reference ?? o.paystackReference,
    deploymentNotes: o.deployment_notes ?? o.deploymentNotes,
    createdAt: o.created_at ?? o.createdAt,
    updatedAt: o.updated_at ?? o.updatedAt,
  };
}

// ── Parameterized query helper (SQLite uses ?, PG uses $1, $2...) ─────────────
function buildQuery(template: string, params: any[]): { query: string; params: any[] } {
  if (dbType === "pg") {
    let i = 1;
    const query = template.replace(/\?/g, () => `$${i++}`);
    return { query, params };
  }
  return { query: template, params };
}

async function q(template: string, params: any[] = []): Promise<any[]> {
  const { query, params: p } = buildQuery(template, params);
  return runQuery(query, p);
}

async function m(template: string, params: any[] = []): Promise<void> {
  const { query, params: p } = buildQuery(template, params);
  return runMutation(query, p);
}

// ── Timestamps ────────────────────────────────────────────────────────────────
const NOW = dbType === "pg" ? "NOW()::text" : "datetime('now')";

export function registerBotRoutes(app: Express, adminAuthMiddleware: any) {

  // ── Public: list active bots ────────────────────────────────────────────────
  app.get("/api/bots", async (_req, res) => {
    try {
      const rows = await q("SELECT * FROM bots WHERE active = ? ORDER BY created_at DESC", [dbType === "pg" ? true : 1]);
      res.json({ success: true, bots: rows.map(fmtBot) });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── Public: get single bot ──────────────────────────────────────────────────
  app.get("/api/bots/:id([0-9]+)", async (req, res) => {
    try {
      const rows = await q("SELECT * FROM bots WHERE id = ?", [parseInt(req.params.id)]);
      if (!rows.length) return res.status(404).json({ success: false, error: "Bot not found" });
      res.json({ success: true, bot: fmtBot(rows[0]) });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── Public: initialize bot order + Paystack payment ────────────────────────
  app.post("/api/bots/order/initialize", async (req, res) => {
    try {
      const { botId, customerName, customerEmail, customerPhone, sessionId, dbUrl, mode, timezone } = req.body;
      if (!botId || !customerName || !customerEmail || !customerPhone) {
        return res.status(400).json({ success: false, error: "Missing required fields" });
      }
      const bots = await q("SELECT * FROM bots WHERE id = ?", [parseInt(botId)]);
      if (!bots.length) return res.status(404).json({ success: false, error: "Bot not found" });
      const bot = bots[0];
      const reference = generateReference();

      await m(
        "INSERT INTO bot_orders (reference, bot_id, bot_name, customer_name, customer_email, customer_phone, session_id, db_url, mode, timezone, amount, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')",
        [reference, bot.id, bot.name, customerName, customerEmail, customerPhone, sessionId || null, dbUrl || null, mode || "public", timezone || "Africa/Nairobi", bot.price]
      );

      const secretKey = getPaystackSecretKey();
      if (!secretKey) {
        return res.json({ success: true, reference, amount: bot.price, paystackConfigured: false });
      }

      const paystackRes = await fetch("https://api.paystack.co/transaction/initialize", {
        method: "POST",
        headers: { Authorization: `Bearer ${secretKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          email: customerEmail, amount: bot.price * 100, currency: "KES", reference,
          metadata: { botId: bot.id, botName: bot.name, customerName, customerPhone },
        }),
      });
      const paystackData = await paystackRes.json() as any;
      res.json({
        success: true, reference, amount: bot.price,
        authorizationUrl: paystackData.data?.authorization_url,
        paystackConfigured: true, paystackPublicKey: getPaystackPublicKey(),
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── Public: verify bot order payment ───────────────────────────────────────
  app.post("/api/bots/order/verify", async (req, res) => {
    try {
      const { reference } = req.body;
      if (!reference) return res.status(400).json({ success: false, error: "Reference required" });
      const orders = await q("SELECT * FROM bot_orders WHERE reference = ?", [reference]);
      if (!orders.length) return res.status(404).json({ success: false, error: "Order not found" });
      const order = orders[0];
      if (order.status !== "pending") return res.json({ success: true, order: fmtOrder(order) });

      const secretKey = getPaystackSecretKey();
      if (!secretKey) {
        const updNow = dbType === "pg" ? "NOW()::text" : "datetime('now')";
        await m("UPDATE bot_orders SET status = 'paid', paystack_reference = ?, updated_at = " + updNow + " WHERE reference = ?", [reference, reference]);
        const updated = await q("SELECT * FROM bot_orders WHERE reference = ?", [reference]);
        return res.json({ success: true, order: fmtOrder(updated[0]) });
      }

      const verifyRes = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
        headers: { Authorization: `Bearer ${secretKey}` },
      });
      const data = await verifyRes.json() as any;
      if (data.data?.status === "success") {
        const updNow = dbType === "pg" ? "NOW()::text" : "datetime('now')";
        await m("UPDATE bot_orders SET status = 'paid', paystack_reference = ?, updated_at = " + updNow + " WHERE reference = ?", [reference, reference]);
        const updated = await q("SELECT * FROM bot_orders WHERE reference = ?", [reference]);
        return res.json({ success: true, order: fmtOrder(updated[0]) });
      }
      res.status(400).json({ success: false, error: "Payment not confirmed", paystackStatus: data.data?.status });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── Public: get order by reference ─────────────────────────────────────────
  app.get("/api/bots/order/:reference", async (req, res) => {
    try {
      const rows = await q("SELECT * FROM bot_orders WHERE reference = ?", [req.params.reference]);
      if (!rows.length) return res.status(404).json({ success: false, error: "Order not found" });
      res.json({ success: true, order: fmtOrder(rows[0]) });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── Admin: list all bots ────────────────────────────────────────────────────
  app.get("/api/admin/bots", adminAuthMiddleware, async (_req, res) => {
    try {
      const rows = await q("SELECT * FROM bots ORDER BY created_at DESC", []);
      res.json({ success: true, bots: rows.map(fmtBot) });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── Admin: create bot ───────────────────────────────────────────────────────
  app.post("/api/admin/bots", adminAuthMiddleware, async (req, res) => {
    try {
      const { name, description, repoUrl, imageUrl, price, features, requiresSessionId, requiresDbUrl, category } = req.body;
      if (!name || !description || !repoUrl) return res.status(400).json({ success: false, error: "Missing fields" });

      const reqSession = dbType === "pg" ? (requiresSessionId !== false) : (requiresSessionId !== false ? 1 : 0);
      const reqDb = dbType === "pg" ? !!requiresDbUrl : (requiresDbUrl ? 1 : 0);
      const activeVal = dbType === "pg" ? true : 1;

      await m(
        "INSERT INTO bots (name, description, repo_url, image_url, price, features, requires_session_id, requires_db_url, active, category) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [name, description, repoUrl, imageUrl || null, price || 70, JSON.stringify(features || []), reqSession, reqDb, activeVal, category || "general"]
      );

      const rows = await q("SELECT * FROM bots ORDER BY id DESC LIMIT 1", []);
      res.json({ success: true, bot: fmtBot(rows[0]) });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── Admin: update bot ───────────────────────────────────────────────────────
  app.put("/api/admin/bots/:id", adminAuthMiddleware, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { name, description, repoUrl, imageUrl, price, features, requiresSessionId, requiresDbUrl, active, category } = req.body;
      const sets: string[] = [];
      const vals: any[] = [];
      if (name !== undefined) { sets.push("name = ?"); vals.push(name); }
      if (description !== undefined) { sets.push("description = ?"); vals.push(description); }
      if (repoUrl !== undefined) { sets.push("repo_url = ?"); vals.push(repoUrl); }
      if (imageUrl !== undefined) { sets.push("image_url = ?"); vals.push(imageUrl); }
      if (price !== undefined) { sets.push("price = ?"); vals.push(price); }
      if (features !== undefined) { sets.push("features = ?"); vals.push(JSON.stringify(features)); }
      if (requiresSessionId !== undefined) { sets.push("requires_session_id = ?"); vals.push(dbType === "pg" ? requiresSessionId : (requiresSessionId ? 1 : 0)); }
      if (requiresDbUrl !== undefined) { sets.push("requires_db_url = ?"); vals.push(dbType === "pg" ? requiresDbUrl : (requiresDbUrl ? 1 : 0)); }
      if (active !== undefined) { sets.push("active = ?"); vals.push(dbType === "pg" ? active : (active ? 1 : 0)); }
      if (category !== undefined) { sets.push("category = ?"); vals.push(category); }
      if (!sets.length) return res.status(400).json({ success: false, error: "No fields to update" });
      vals.push(id);
      await m(`UPDATE bots SET ${sets.join(", ")} WHERE id = ?`, vals);
      const rows = await q("SELECT * FROM bots WHERE id = ?", [id]);
      res.json({ success: true, bot: fmtBot(rows[0]) });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── Admin: delete bot ───────────────────────────────────────────────────────
  app.delete("/api/admin/bots/:id", adminAuthMiddleware, async (req, res) => {
    try {
      await m("DELETE FROM bots WHERE id = ?", [parseInt(req.params.id)]);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── Admin: list all bot orders ──────────────────────────────────────────────
  app.get("/api/admin/bot-orders", adminAuthMiddleware, async (req, res) => {
    try {
      const { status } = req.query;
      let rows: any[];
      if (status && typeof status === "string") {
        rows = await q("SELECT * FROM bot_orders WHERE status = ? ORDER BY created_at DESC", [status]);
      } else {
        rows = await q("SELECT * FROM bot_orders ORDER BY created_at DESC", []);
      }
      res.json({ success: true, orders: rows.map(fmtOrder) });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── Admin: update bot order status ─────────────────────────────────────────
  app.patch("/api/admin/bot-orders/:id/status", adminAuthMiddleware, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { status, deploymentNotes } = req.body;
      const updNow = dbType === "pg" ? "NOW()::text" : "datetime('now')";
      await m(
        `UPDATE bot_orders SET status = ?, deployment_notes = ?, updated_at = ${updNow} WHERE id = ?`,
        [status, deploymentNotes || null, id]
      );
      const rows = await q("SELECT * FROM bot_orders WHERE id = ?", [id]);
      res.json({ success: true, order: fmtOrder(rows[0]) });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
}
