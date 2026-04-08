import type { Express } from "express";
import { getDb } from "./storage";
import { bots, botOrders } from "@shared/schema";
import { eq, desc, sql } from "drizzle-orm";
import { getPaystackSecretKey, getPaystackPublicKey } from "./secrets";

function generateReference(): string {
  return `CTB-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

function parseFeatures(f: string | null | undefined): string[] {
  try { return JSON.parse(f ?? "[]"); } catch { return []; }
}

function fmtBot(b: any) {
  return { ...b, features: parseFeatures(b.features) };
}

function fmtOrder(o: any) { return o; }

export function registerBotRoutes(app: Express, adminAuthMiddleware: any) {

  // ── Public: list bots ───────────────────────────────────────────────────────
  app.get("/api/bots", async (_req, res) => {
    try {
      const db = getDb();
      const allBots = await db.select().from(bots).where(eq(bots.active, true)).orderBy(desc(bots.createdAt));
      res.json({ success: true, bots: allBots.map(fmtBot) });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── Public: get single bot ──────────────────────────────────────────────────
  app.get("/api/bots/:id", async (req, res) => {
    try {
      const db = getDb();
      const id = parseInt(req.params.id);
      const [bot] = await db.select().from(bots).where(eq(bots.id, id));
      if (!bot) return res.status(404).json({ success: false, error: "Bot not found" });
      res.json({ success: true, bot: fmtBot(bot) });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── Public: initialize bot order + Paystack payment ────────────────────────
  app.post("/api/bots/order/initialize", async (req, res) => {
    try {
      const db = getDb();
      const { botId, customerName, customerEmail, customerPhone, sessionId, dbUrl, mode, timezone } = req.body;

      if (!botId || !customerName || !customerEmail || !customerPhone) {
        return res.status(400).json({ success: false, error: "Missing required fields" });
      }

      const [bot] = await db.select().from(bots).where(eq(bots.id, parseInt(botId)));
      if (!bot) return res.status(404).json({ success: false, error: "Bot not found" });

      const reference = generateReference();

      await db.insert(botOrders).values({
        reference,
        botId: bot.id,
        botName: bot.name,
        customerName,
        customerEmail,
        customerPhone,
        sessionId: sessionId || null,
        dbUrl: dbUrl || null,
        mode: mode || "public",
        timezone: timezone || "Africa/Nairobi",
        amount: bot.price,
        status: "pending",
      });

      const secretKey = getPaystackSecretKey();
      if (!secretKey) {
        return res.json({
          success: true,
          reference,
          amount: bot.price,
          paystackConfigured: false,
          message: "Paystack not configured — contact admin",
        });
      }

      const paystackRes = await fetch("https://api.paystack.co/transaction/initialize", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secretKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: customerEmail,
          amount: bot.price * 100,
          currency: "KES",
          reference,
          metadata: { botId: bot.id, botName: bot.name, customerName, customerPhone },
        }),
      });

      const paystackData = await paystackRes.json() as any;

      res.json({
        success: true,
        reference,
        amount: bot.price,
        authorizationUrl: paystackData.data?.authorization_url,
        paystackConfigured: true,
        paystackPublicKey: getPaystackPublicKey(),
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── Public: verify bot order payment ───────────────────────────────────────
  app.post("/api/bots/order/verify", async (req, res) => {
    try {
      const db = getDb();
      const { reference } = req.body;
      if (!reference) return res.status(400).json({ success: false, error: "Reference required" });

      const [order] = await db.select().from(botOrders).where(eq(botOrders.reference, reference));
      if (!order) return res.status(404).json({ success: false, error: "Order not found" });
      if (order.status !== "pending") return res.json({ success: true, order: fmtOrder(order) });

      const secretKey = getPaystackSecretKey();
      if (!secretKey) {
        await db.update(botOrders).set({ status: "paid", paystackReference: reference }).where(eq(botOrders.reference, reference));
        const [updated] = await db.select().from(botOrders).where(eq(botOrders.reference, reference));
        return res.json({ success: true, order: fmtOrder(updated) });
      }

      const verifyRes = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
        headers: { Authorization: `Bearer ${secretKey}` },
      });
      const data = await verifyRes.json() as any;

      if (data.data?.status === "success") {
        await db.update(botOrders)
          .set({ status: "paid", paystackReference: reference, updatedAt: sql`(datetime('now'))` })
          .where(eq(botOrders.reference, reference));
        const [updated] = await db.select().from(botOrders).where(eq(botOrders.reference, reference));
        return res.json({ success: true, order: fmtOrder(updated) });
      }

      res.status(400).json({ success: false, error: "Payment not confirmed", paystackStatus: data.data?.status });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── Public: get order by reference ─────────────────────────────────────────
  app.get("/api/bots/order/:reference", async (req, res) => {
    try {
      const db = getDb();
      const [order] = await db.select().from(botOrders).where(eq(botOrders.reference, req.params.reference));
      if (!order) return res.status(404).json({ success: false, error: "Order not found" });
      res.json({ success: true, order: fmtOrder(order) });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── Admin: list all bots ────────────────────────────────────────────────────
  app.get("/api/admin/bots", adminAuthMiddleware, async (_req, res) => {
    try {
      const db = getDb();
      const allBots = await db.select().from(bots).orderBy(desc(bots.createdAt));
      res.json({ success: true, bots: allBots.map(fmtBot) });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── Admin: create bot ───────────────────────────────────────────────────────
  app.post("/api/admin/bots", adminAuthMiddleware, async (req, res) => {
    try {
      const db = getDb();
      const { name, description, repoUrl, imageUrl, price, features, requiresSessionId, requiresDbUrl, category } = req.body;
      if (!name || !description || !repoUrl) return res.status(400).json({ success: false, error: "Missing fields" });

      await db.insert(bots).values({
        name, description, repoUrl,
        imageUrl: imageUrl || null,
        price: price || 70,
        features: JSON.stringify(features || []),
        requiresSessionId: requiresSessionId !== false,
        requiresDbUrl: !!requiresDbUrl,
        active: true,
        category: category || "general",
      });
      const allBots = await db.select().from(bots).orderBy(desc(bots.createdAt));
      res.json({ success: true, bot: fmtBot(allBots[0]) });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── Admin: update bot ───────────────────────────────────────────────────────
  app.put("/api/admin/bots/:id", adminAuthMiddleware, async (req, res) => {
    try {
      const db = getDb();
      const id = parseInt(req.params.id);
      const { name, description, repoUrl, imageUrl, price, features, requiresSessionId, requiresDbUrl, active, category } = req.body;
      const updates: any = {};
      if (name !== undefined) updates.name = name;
      if (description !== undefined) updates.description = description;
      if (repoUrl !== undefined) updates.repoUrl = repoUrl;
      if (imageUrl !== undefined) updates.imageUrl = imageUrl;
      if (price !== undefined) updates.price = price;
      if (features !== undefined) updates.features = JSON.stringify(features);
      if (requiresSessionId !== undefined) updates.requiresSessionId = requiresSessionId;
      if (requiresDbUrl !== undefined) updates.requiresDbUrl = requiresDbUrl;
      if (active !== undefined) updates.active = active;
      if (category !== undefined) updates.category = category;
      await db.update(bots).set(updates).where(eq(bots.id, id));
      const [updated] = await db.select().from(bots).where(eq(bots.id, id));
      res.json({ success: true, bot: fmtBot(updated) });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── Admin: delete bot ───────────────────────────────────────────────────────
  app.delete("/api/admin/bots/:id", adminAuthMiddleware, async (req, res) => {
    try {
      const db = getDb();
      await db.delete(bots).where(eq(bots.id, parseInt(req.params.id)));
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── Admin: list all bot orders ──────────────────────────────────────────────
  app.get("/api/admin/bot-orders", adminAuthMiddleware, async (req, res) => {
    try {
      const db = getDb();
      const { status } = req.query;
      let query = db.select().from(botOrders).orderBy(desc(botOrders.createdAt));
      if (status && typeof status === "string") {
        const orders = await db.select().from(botOrders).where(eq(botOrders.status, status)).orderBy(desc(botOrders.createdAt));
        return res.json({ success: true, orders: orders.map(fmtOrder) });
      }
      const orders = await query;
      res.json({ success: true, orders: orders.map(fmtOrder) });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── Admin: update bot order status ─────────────────────────────────────────
  app.patch("/api/admin/bot-orders/:id/status", adminAuthMiddleware, async (req, res) => {
    try {
      const db = getDb();
      const id = parseInt(req.params.id);
      const { status, deploymentNotes } = req.body;
      await db.update(botOrders).set({ status, deploymentNotes: deploymentNotes || null, updatedAt: sql`(datetime('now'))` }).where(eq(botOrders.id, id));
      const [updated] = await db.select().from(botOrders).where(eq(botOrders.id, id));
      res.json({ success: true, order: fmtOrder(updated) });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
}
