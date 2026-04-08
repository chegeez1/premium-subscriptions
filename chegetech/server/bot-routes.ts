import type { Express } from "express";
import { runQuery, runMutation, dbType } from "./storage";
import { getPaystackSecretKey, getPaystackPublicKey, getRenderApiKey } from "./secrets";

function generateReference(): string {
  return `CTB-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

function parseFeatures(f: string | null | undefined): string[] {
  try { return JSON.parse(f ?? "[]"); } catch { return []; }
}

function fmtBot(b: Record<string, any>) {
  return {
    ...b,
    features: parseFeatures(b.features),
    requiresSessionId: !!b.requires_session_id,
    requiresDbUrl: !!b.requires_db_url,
    active: !!b.active,
    repoUrl: b.repo_url ?? b.repoUrl,
    imageUrl: b.image_url ?? b.imageUrl,
    createdAt: b.created_at ?? b.createdAt,
  };
}

function fmtOrder(o: Record<string, any>) {
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
    renderServiceId: o.render_service_id ?? o.renderServiceId,
    renderServiceUrl: o.render_service_url ?? o.renderServiceUrl,
    deployedAt: o.deployed_at ?? o.deployedAt,
    createdAt: o.created_at ?? o.createdAt,
    updatedAt: o.updated_at ?? o.updatedAt,
  };
}

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

// ── Auto-deploy bot to Render ─────────────────────────────────────────────────
async function deployBotToRender(
  order: Record<string, any>,
  bot: Record<string, any>
): Promise<{ serviceId: string; serviceUrl: string } | null> {
  const apiKey = getRenderApiKey();
  if (!apiKey) {
    console.log("[Bot Deploy] RENDER_API_KEY not set — skipping auto-deploy");
    return null;
  }

  try {
    // 1. Get Render owner ID
    const ownersRes = await fetch("https://api.render.com/v1/owners?limit=1", {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
    });
    const ownersData = await ownersRes.json() as any[];
    const ownerId = ownersData?.[0]?.owner?.id;
    if (!ownerId) {
      console.error("[Bot Deploy] Could not fetch Render owner ID");
      return null;
    }

    // 2. Build environment variables
    const envVars: Array<{ key: string; value: string }> = [];
    if (order.session_id) envVars.push({ key: "SESSION_ID", value: order.session_id });
    if (order.db_url) envVars.push({ key: "DATABASE_URL", value: order.db_url });
    envVars.push({ key: "MODE", value: order.mode || "public" });
    envVars.push({ key: "TZ", value: order.timezone || "Africa/Nairobi" });
    envVars.push({ key: "BOT_NAME", value: bot.name });
    envVars.push({ key: "OWNER_NUMBER", value: order.customer_phone || "" });

    // 3. Service name: bot-gifted-md-abc123
    const slug = bot.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const suffix = Date.now().toString(36);
    const serviceName = `${slug}-${suffix}`.slice(0, 63);

    // 4. Create background_worker service on Render
    const createRes = await fetch("https://api.render.com/v1/services", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        type: "background_worker",
        name: serviceName,
        ownerId,
        repo: bot.repo_url,
        branch: "main",
        autoDeploy: "yes",
        envVars,
        serviceDetails: {
          env: "node",
          buildCommand: "npm install",
          startCommand: "npm start",
          plan: "free",
        },
      }),
    });

    const createData = await createRes.json() as any;
    const service = createData.service ?? createData;

    if (!service?.id) {
      console.error("[Bot Deploy] Service creation failed:", JSON.stringify(createData).slice(0, 300));
      return null;
    }

    const serviceUrl = service.serviceDetails?.url
      ?? `https://${serviceName}.onrender.com`;

    console.log(`[Bot Deploy] Created service: ${service.id} — ${serviceUrl}`);
    return { serviceId: service.id, serviceUrl };
  } catch (err: any) {
    console.error("[Bot Deploy] Unexpected error:", err.message);
    return null;
  }
}

export function registerBotRoutes(app: Express, adminAuthMiddleware: any) {

  // ── Public: list active bots ────────────────────────────────────────────────
  app.get("/api/bots", async (_req, res) => {
    try {
      const activeVal = dbType === "pg" ? true : 1;
      const rows = await q("SELECT * FROM bots WHERE active = ? ORDER BY created_at DESC", [activeVal]);
      res.json({ success: true, bots: rows.map(fmtBot) });
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

  // ── Public: verify Paystack payment + auto-deploy ───────────────────────────
  app.post("/api/bots/order/verify", async (req, res) => {
    try {
      const { reference } = req.body;
      if (!reference) return res.status(400).json({ success: false, error: "Reference required" });

      const orders = await q("SELECT * FROM bot_orders WHERE reference = ?", [reference]);
      if (!orders.length) return res.status(404).json({ success: false, error: "Order not found" });
      const order = orders[0];

      // Already processed
      if (order.status !== "pending") return res.json({ success: true, order: fmtOrder(order) });

      const secretKey = getPaystackSecretKey();
      let paymentOk = false;

      if (!secretKey) {
        paymentOk = true; // dev mode: skip verification
      } else {
        const verifyRes = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
          headers: { Authorization: `Bearer ${secretKey}` },
        });
        const data = await verifyRes.json() as any;
        paymentOk = data.data?.status === "success";
        if (!paymentOk) {
          return res.status(400).json({ success: false, error: "Payment not confirmed", paystackStatus: data.data?.status });
        }
      }

      // Mark as paid first
      const updNow = dbType === "pg" ? "NOW()::text" : "datetime('now')";
      await m(`UPDATE bot_orders SET status = 'paid', paystack_reference = ?, updated_at = ${updNow} WHERE reference = ?`, [reference, reference]);

      // Auto-deploy to Render (non-blocking)
      const bots = await q("SELECT * FROM bots WHERE id = ?", [order.bot_id]);
      if (bots.length) {
        const updatedOrder = (await q("SELECT * FROM bot_orders WHERE reference = ?", [reference]))[0];
        deployBotToRender(updatedOrder, bots[0]).then(async (result) => {
          if (result) {
            await m(
              `UPDATE bot_orders SET status = 'deployed', render_service_id = ?, render_service_url = ?, deployed_at = ${updNow}, updated_at = ${updNow} WHERE reference = ?`,
              [result.serviceId, result.serviceUrl, reference]
            );
            console.log(`[Bot Deploy] Order ${reference} deployed — ${result.serviceUrl}`);
          }
        }).catch((e) => console.error("[Bot Deploy] Background deploy error:", e.message));
      }

      const updated = await q("SELECT * FROM bot_orders WHERE reference = ?", [reference]);
      res.json({ success: true, order: fmtOrder(updated[0]) });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── Wallet pay + auto-deploy ────────────────────────────────────────────────
  app.post("/api/bots/order/wallet-pay", async (req: any, res) => {
    try {
      const { botId, customerName, customerEmail, customerPhone, sessionId, dbUrl, mode, timezone } = req.body;
      const token = ((req.headers.authorization as string) || "").replace("Bearer ", "").trim();
      if (!token) return res.status(401).json({ success: false, error: "Not authenticated" });
      if (!botId || !customerName || !customerEmail || !customerPhone) {
        return res.status(400).json({ success: false, error: "Missing required fields" });
      }

      const now = new Date().toISOString();
      const sessions = await q(
        "SELECT customer_id FROM customer_sessions WHERE token = ? AND expires_at > ? LIMIT 1",
        [token, now]
      );
      if (!sessions.length) return res.status(401).json({ success: false, error: "Session expired or invalid" });
      const customerId = sessions[0].customer_id;

      const bots = await q("SELECT * FROM bots WHERE id = ?", [parseInt(botId)]);
      if (!bots.length) return res.status(404).json({ success: false, error: "Bot not found" });
      const bot = bots[0];

      const wallets = await q("SELECT balance FROM wallets WHERE customer_id = ?", [customerId]);
      const walletBalance = wallets.length ? Number(wallets[0].balance) : 0;

      if (walletBalance < bot.price) {
        return res.status(400).json({
          success: false,
          error: `Insufficient wallet balance. You have KES ${walletBalance}, need KES ${bot.price}.`,
        });
      }

      const reference = generateReference();
      const updNow = dbType === "pg" ? "NOW()::text" : "datetime('now')";

      await m(`UPDATE wallets SET balance = balance - ?, updated_at = ${updNow} WHERE customer_id = ?`, [bot.price, customerId]);
      await m(
        "INSERT INTO wallet_transactions (customer_id, type, amount, description, reference) VALUES (?, 'debit', ?, ?, ?)",
        [customerId, bot.price, `Bot deployment: ${bot.name}`, reference]
      );
      await m(
        "INSERT INTO bot_orders (reference, bot_id, bot_name, customer_name, customer_email, customer_phone, session_id, db_url, mode, timezone, amount, status, paystack_reference) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'paid', 'wallet')",
        [reference, bot.id, bot.name, customerName, customerEmail, customerPhone, sessionId || null, dbUrl || null, mode || "public", timezone || "Africa/Nairobi", bot.price]
      );

      // Auto-deploy to Render (non-blocking)
      const orderForDeploy = {
        bot_id: bot.id, session_id: sessionId || null, db_url: dbUrl || null,
        mode: mode || "public", timezone: timezone || "Africa/Nairobi", customer_phone: customerPhone,
      };
      deployBotToRender(orderForDeploy, bot).then(async (result) => {
        if (result) {
          await m(
            `UPDATE bot_orders SET status = 'deployed', render_service_id = ?, render_service_url = ?, deployed_at = ${updNow}, updated_at = ${updNow} WHERE reference = ?`,
            [result.serviceId, result.serviceUrl, reference]
          );
          console.log(`[Bot Deploy] Wallet order ${reference} deployed — ${result.serviceUrl}`);
        }
      }).catch((e) => console.error("[Bot Deploy] Wallet deploy error:", e.message));

      const created = await q("SELECT * FROM bot_orders WHERE reference = ?", [reference]);
      res.json({ success: true, reference, order: fmtOrder(created[0]) });
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

  // ── Public: get single bot by ID ────────────────────────────────────────────
  app.get("/api/bots/:botId", async (req, res) => {
    try {
      const id = parseInt(req.params.botId);
      if (isNaN(id)) return res.status(404).json({ success: false, error: "Bot not found" });
      const rows = await q("SELECT * FROM bots WHERE id = ?", [id]);
      if (!rows.length) return res.status(404).json({ success: false, error: "Bot not found" });
      res.json({ success: true, bot: fmtBot(rows[0]) });
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
  app.put("/api/admin/bots/:botId", adminAuthMiddleware, async (req, res) => {
    try {
      const id = parseInt(req.params.botId);
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
  app.delete("/api/admin/bots/:botId", adminAuthMiddleware, async (req, res) => {
    try {
      await m("DELETE FROM bots WHERE id = ?", [parseInt(req.params.botId)]);
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

  // ── Admin: update bot order status + manual redeploy ───────────────────────
  app.patch("/api/admin/bot-orders/:orderId/status", adminAuthMiddleware, async (req, res) => {
    try {
      const id = parseInt(req.params.orderId);
      const { status, deploymentNotes, redeploy } = req.body;
      const updNow = dbType === "pg" ? "NOW()::text" : "datetime('now')";
      await m(
        `UPDATE bot_orders SET status = ?, deployment_notes = ?, updated_at = ${updNow} WHERE id = ?`,
        [status, deploymentNotes || null, id]
      );
      const rows = await q("SELECT * FROM bot_orders WHERE id = ?", [id]);
      const order = rows[0];

      // Manual redeploy trigger (admin can force-redeploy)
      if (redeploy && order) {
        const bots = await q("SELECT * FROM bots WHERE id = ?", [order.bot_id]);
        if (bots.length) {
          deployBotToRender(order, bots[0]).then(async (result) => {
            if (result) {
              await m(
                `UPDATE bot_orders SET status = 'deployed', render_service_id = ?, render_service_url = ?, deployed_at = ${updNow}, updated_at = ${updNow} WHERE id = ?`,
                [result.serviceId, result.serviceUrl, id]
              );
            }
          }).catch((e) => console.error("[Bot Deploy] Admin redeploy error:", e.message));
        }
      }

      res.json({ success: true, order: fmtOrder(order) });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── Admin: get Render deploy status ────────────────────────────────────────
  app.get("/api/admin/bot-orders/:orderId/render-status", adminAuthMiddleware, async (req, res) => {
    try {
      const id = parseInt(req.params.orderId);
      const rows = await q("SELECT * FROM bot_orders WHERE id = ?", [id]);
      if (!rows.length) return res.status(404).json({ success: false, error: "Order not found" });
      const order = rows[0];
      if (!order.render_service_id) {
        return res.json({ success: true, renderConfigured: false, message: "Not yet deployed to Render" });
      }
      const apiKey = getRenderApiKey();
      if (!apiKey) return res.json({ success: true, renderConfigured: false, message: "RENDER_API_KEY not set" });

      const svcRes = await fetch(`https://api.render.com/v1/services/${order.render_service_id}`, {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
      });
      const svcData = await svcRes.json() as any;
      res.json({ success: true, renderConfigured: true, service: svcData });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
}
