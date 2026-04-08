import type { Express } from "express";
import { runQuery, runMutation, dbType } from "./storage";
import { getPaystackSecretKey, getPaystackPublicKey, getHerokuApiKey } from "./secrets";
import { promoManager } from "./promo";

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
    herokuAppName: o.render_service_id ?? o.herokuAppName,
    herokuAppUrl: o.render_service_url ?? o.herokuAppUrl,
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

// ── Heroku headers helper ─────────────────────────────────────────────────────
function herokuHeaders(apiKey: string) {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    Accept: "application/vnd.heroku+json; version=3",
  };
}

// ── Auto-deploy bot to Heroku ─────────────────────────────────────────────────
async function deployBotToHeroku(
  order: Record<string, any>,
  bot: Record<string, any>
): Promise<{ appName: string; appUrl: string } | null> {
  const apiKey = getHerokuApiKey();
  if (!apiKey) {
    console.log("[Bot Deploy] HEROKU_API_KEY not set — skipping auto-deploy");
    return null;
  }

  try {
    // 1. Build app name: gifted-md-abc123 (Heroku max 30 chars, lowercase, no underscores)
    const slug = bot.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const suffix = Date.now().toString(36).slice(-5);
    const appName = `${slug}-${suffix}`.slice(0, 30);

    // 2. Create Heroku app
    const createRes = await fetch("https://api.heroku.com/apps", {
      method: "POST",
      headers: herokuHeaders(apiKey),
      body: JSON.stringify({ name: appName, region: "us" }),
    });
    const app = await createRes.json() as any;
    if (!app.name) {
      console.error("[Bot Deploy] App creation failed:", JSON.stringify(app).slice(0, 300));
      return null;
    }
    console.log(`[Bot Deploy] Heroku app created: ${app.name}`);

    // 3. Set config vars (env variables)
    const configVars: Record<string, string> = {};
    if (order.session_id) configVars["SESSION_ID"] = order.session_id;
    if (order.db_url) configVars["DATABASE_URL"] = order.db_url;
    configVars["MODE"] = order.mode || "public";
    configVars["TZ"] = order.timezone || "Africa/Nairobi";
    configVars["BOT_NAME"] = bot.name;
    configVars["OWNER_NUMBER"] = order.customer_phone || "";

    await fetch(`https://api.heroku.com/apps/${app.name}/config-vars`, {
      method: "PATCH",
      headers: herokuHeaders(apiKey),
      body: JSON.stringify(configVars),
    });

    // 4. Trigger build from GitHub tarball (works for public repos)
    // Try main branch first, fall back to master
    const repoBase = bot.repo_url.replace(/\.git$/, "").replace(/\/$/, "");
    let tarballUrl = `${repoBase}/archive/refs/heads/main.tar.gz`;
    // Try main branch, fall back to master if build fails
    let buildRes = await fetch(`https://api.heroku.com/apps/${app.name}/builds`, {
      method: "POST",
      headers: herokuHeaders(apiKey),
      body: JSON.stringify({ source_blob: { url: tarballUrl, version: "main" } }),
    });
    let build = await buildRes.json() as any;

    // If main branch failed (404 tarball), try master
    if (build.id && build.status === "failed") {
      console.log("[Bot Deploy] main branch build failed, trying master...");
      tarballUrl = `${repoBase}/archive/refs/heads/master.tar.gz`;
      buildRes = await fetch(`https://api.heroku.com/apps/${app.name}/builds`, {
        method: "POST",
        headers: herokuHeaders(apiKey),
        body: JSON.stringify({ source_blob: { url: tarballUrl, version: "master" } }),
      });
      build = await buildRes.json() as any;
    }

    if (build.id) {
      console.log(`[Bot Deploy] ✓ Build triggered: ${build.id} status=${build.status ?? "pending"} app=${app.name}`);
    } else {
      const errMsg = JSON.stringify(build).slice(0, 300);
      console.error(`[Bot Deploy] Build trigger failed: ${errMsg}`);
      throw new Error("Build trigger failed: " + errMsg);
    }

    return {
      appName: app.name,
      appUrl: `https://${app.name}.herokuapp.com`,
    };
  } catch (err: any) {
    console.error("[Bot Deploy] ✗ Heroku error:", err.message);
    throw err; // Re-throw so callers can set deploy_failed status
  }
}

export function registerBotRoutes(app: Express, adminAuthMiddleware: any) {

  // ── Public: validate promo code for bots ───────────────────────────────────
  app.post("/api/bots/promo/validate", async (req, res) => {
    try {
      const { code } = req.body;
      if (!code) return res.status(400).json({ valid: false, error: "Code required" });
      const result = promoManager.validate(code, undefined, "bot");
      if (!result.valid) return res.json({ valid: false, error: result.error });
      const promo = result.promo!;
      res.json({
        valid: true,
        discountType: promo.discountType,
        discountValue: promo.discountValue,
        label: promo.label,
        code: promo.code,
      });
    } catch (err: any) {
      res.status(500).json({ valid: false, error: err.message });
    }
  });

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
      const { botId, customerName, customerEmail, customerPhone, sessionId, dbUrl, mode, timezone, promoCode } = req.body;
      if (!botId || !customerName || !customerEmail || !customerPhone) {
        return res.status(400).json({ success: false, error: "Missing required fields" });
      }
      const bots = await q("SELECT * FROM bots WHERE id = ?", [parseInt(botId)]);
      if (!bots.length) return res.status(404).json({ success: false, error: "Bot not found" });
      const bot = bots[0];
      const reference = generateReference();

      // Apply promo discount
      let finalAmount = bot.price;
      let promoUsed: string | null = null;
      if (promoCode) {
        const pr = promoManager.validate(promoCode, undefined, "bot");
        if (pr.valid && pr.promo) {
          if (pr.promo.discountType === "percent") {
            finalAmount = Math.max(0, Math.round(bot.price * (1 - pr.promo.discountValue / 100)));
          } else {
            finalAmount = Math.max(0, bot.price - pr.promo.discountValue);
          }
          promoUsed = pr.promo.code;
        }
      }

      await m(
        "INSERT INTO bot_orders (reference, bot_id, bot_name, customer_name, customer_email, customer_phone, session_id, db_url, mode, timezone, amount, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')",
        [reference, bot.id, bot.name, customerName, customerEmail, customerPhone, sessionId || null, dbUrl || null, mode || "public", timezone || "Africa/Nairobi", finalAmount]
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
      if (promoUsed) promoManager.use(promoUsed);
      res.json({
        success: true, reference, amount: finalAmount, originalAmount: bot.price,
        promoApplied: promoUsed,
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

      if (order.status !== "pending") return res.json({ success: true, order: fmtOrder(order) });

      const secretKey = getPaystackSecretKey();
      let paymentOk = false;

      if (!secretKey) {
        paymentOk = true;
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

      const updNow = dbType === "pg" ? "NOW()::text" : "datetime('now')";
      await m(`UPDATE bot_orders SET status = 'paid', paystack_reference = ?, updated_at = ${updNow} WHERE reference = ?`, [reference, reference]);

      // Auto-deploy to Heroku (non-blocking)
      const bots = await q("SELECT * FROM bots WHERE id = ?", [order.bot_id]);
      if (bots.length) {
        const updatedOrder = (await q("SELECT * FROM bot_orders WHERE reference = ?", [reference]))[0];
        deployBotToHeroku(updatedOrder, bots[0]).then(async (result) => {
          await m(
            `UPDATE bot_orders SET status = 'deployed', render_service_id = ?, render_service_url = ?, deployed_at = ${updNow}, updated_at = ${updNow} WHERE reference = ?`,
            [result.appName, result.appUrl, reference]
          );
          console.log(`[Bot Deploy] ✓ Order ${reference} deployed — ${result.appUrl}`);
        }).catch(async (e: any) => {
          console.error("[Bot Deploy] ✗ Deploy failed for order", reference, ":", e.message);
          await m(
            `UPDATE bot_orders SET status = 'deploy_failed', deployment_notes = ?, updated_at = ${updNow} WHERE reference = ?`,
            ["Heroku deploy failed: " + e.message.slice(0, 200), reference]
          );
        });
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
      const { botId, customerName, customerEmail, customerPhone, sessionId, dbUrl, mode, timezone, promoCode: walletPromoCode } = req.body;
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

      // Apply promo discount for wallet pay
      let walletFinalAmount = bot.price;
      let walletPromoUsed: string | null = null;
      if (walletPromoCode) {
        const pr = promoManager.validate(walletPromoCode, undefined, "bot");
        if (pr.valid && pr.promo) {
          if (pr.promo.discountType === "percent") {
            walletFinalAmount = Math.max(0, Math.round(bot.price * (1 - pr.promo.discountValue / 100)));
          } else {
            walletFinalAmount = Math.max(0, bot.price - pr.promo.discountValue);
          }
          walletPromoUsed = pr.promo.code;
        }
      }

      if (walletBalance < walletFinalAmount) {
        return res.status(400).json({
          success: false,
          error: `Insufficient wallet balance. You have KES ${walletBalance}, need KES ${walletFinalAmount}.`,
        });
      }

      const reference = generateReference();
      const updNow = dbType === "pg" ? "NOW()::text" : "datetime('now')";

      await m(`UPDATE wallets SET balance = balance - ?, updated_at = ${updNow} WHERE customer_id = ?`, [walletFinalAmount, customerId]);
      await m(
        "INSERT INTO wallet_transactions (customer_id, type, amount, description, reference) VALUES (?, 'debit', ?, ?, ?)",
        [customerId, walletFinalAmount, `Bot deployment: ${bot.name}${walletPromoUsed ? ` [${walletPromoUsed}]` : ""}`, reference]
      );
      if (walletPromoUsed) promoManager.use(walletPromoUsed);
      await m(
        "INSERT INTO bot_orders (reference, bot_id, bot_name, customer_name, customer_email, customer_phone, session_id, db_url, mode, timezone, amount, status, paystack_reference) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'paid', 'wallet')",
        [reference, bot.id, bot.name, customerName, customerEmail, customerPhone, sessionId || null, dbUrl || null, mode || "public", timezone || "Africa/Nairobi", walletFinalAmount]
      );

      // Auto-deploy to Heroku (non-blocking)
      const orderForDeploy = {
        session_id: sessionId || null, db_url: dbUrl || null,
        mode: mode || "public", timezone: timezone || "Africa/Nairobi", customer_phone: customerPhone,
      };
      deployBotToHeroku(orderForDeploy, bot).then(async (result) => {
        await m(
          `UPDATE bot_orders SET status = 'deployed', render_service_id = ?, render_service_url = ?, deployed_at = ${updNow}, updated_at = ${updNow} WHERE reference = ?`,
          [result.appName, result.appUrl, reference]
        );
        console.log(`[Bot Deploy] ✓ Wallet order ${reference} deployed — ${result.appUrl}`);
      }).catch(async (e: any) => {
        console.error("[Bot Deploy] ✗ Wallet deploy failed for order", reference, ":", e.message);
        await m(
          `UPDATE bot_orders SET status = 'deploy_failed', deployment_notes = ?, updated_at = ${updNow} WHERE reference = ?`,
          ["Heroku deploy failed: " + e.message.slice(0, 200), reference]
        );
      });

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

      // Manual redeploy trigger
      if (redeploy && order) {
        const bots = await q("SELECT * FROM bots WHERE id = ?", [order.bot_id]);
        if (bots.length) {
          deployBotToHeroku(order, bots[0]).then(async (result) => {
            await m(
              `UPDATE bot_orders SET status = 'deployed', render_service_id = ?, render_service_url = ?, deployed_at = ${updNow}, updated_at = ${updNow} WHERE id = ?`,
              [result.appName, result.appUrl, id]
            );
            console.log(`[Bot Deploy] ✓ Admin redeploy id=${id} — ${result.appUrl}`);
          }).catch(async (e: any) => {
            console.error("[Bot Deploy] ✗ Admin redeploy failed id=", id, ":", e.message);
            await m(
              `UPDATE bot_orders SET status = 'deploy_failed', deployment_notes = ?, updated_at = ${updNow} WHERE id = ?`,
              ["Heroku redeploy failed: " + e.message.slice(0, 200), id]
            );
          });
        }
      }

      res.json({ success: true, order: fmtOrder(order) });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── Admin: check Heroku app status ──────────────────────────────────────────
  app.get("/api/admin/bot-orders/:orderId/heroku-status", adminAuthMiddleware, async (req, res) => {
    try {
      const id = parseInt(req.params.orderId);
      const rows = await q("SELECT * FROM bot_orders WHERE id = ?", [id]);
      if (!rows.length) return res.status(404).json({ success: false, error: "Order not found" });
      const order = rows[0];
      const appName = order.render_service_id;
      if (!appName) return res.json({ success: true, deployed: false, message: "Not yet deployed to Heroku" });

      const apiKey = getHerokuApiKey();
      if (!apiKey) return res.json({ success: true, deployed: false, message: "HEROKU_API_KEY not set" });

      const [appRes, buildRes] = await Promise.all([
        fetch(`https://api.heroku.com/apps/${appName}`, { headers: herokuHeaders(apiKey) }),
        fetch(`https://api.heroku.com/apps/${appName}/builds?limit=1`, { headers: herokuHeaders(apiKey) }),
      ]);
      const [appData, buildsData] = await Promise.all([appRes.json(), buildRes.json()]) as [any, any];
      res.json({
        success: true, deployed: true,
        app: appData,
        latestBuild: Array.isArray(buildsData) ? buildsData[0] : buildsData,
        appUrl: order.render_service_url,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
  // ── Admin: Heroku bot management ────────────────────────────────────────────

  async function getHerokuAppName(orderId: number): Promise<string | null> {
    const rows = await q("SELECT render_service_id FROM bot_orders WHERE id = ?", [orderId]);
    return rows[0]?.render_service_id ?? null;
  }

  // Reboot: restart all running dynos
  app.post("/api/admin/bot-orders/:orderId/heroku/reboot", adminAuthMiddleware, async (req, res) => {
    try {
      const id = parseInt(req.params.orderId);
      const apiKey = getHerokuApiKey();
      const appName = await getHerokuAppName(id);
      if (!appName) return res.status(404).json({ success: false, error: "No Heroku app linked to this order" });
      if (!apiKey) return res.status(500).json({ success: false, error: "HEROKU_API_KEY not set" });
      const r = await fetch(`https://api.heroku.com/apps/${appName}/dynos`, {
        method: "DELETE",
        headers: herokuHeaders(apiKey),
      });
      const data = await r.json().catch(() => ({})) as any;
      console.log(`[Heroku] Rebooted ${appName}`);
      res.json({ success: r.ok, message: r.ok ? "Bot rebooted" : data?.message });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Stop: scale all formations to 0
  app.post("/api/admin/bot-orders/:orderId/heroku/stop", adminAuthMiddleware, async (req, res) => {
    try {
      const id = parseInt(req.params.orderId);
      const apiKey = getHerokuApiKey();
      const appName = await getHerokuAppName(id);
      if (!appName) return res.status(404).json({ success: false, error: "No Heroku app linked" });
      if (!apiKey) return res.status(500).json({ success: false, error: "HEROKU_API_KEY not set" });
      const fRes = await fetch(`https://api.heroku.com/apps/${appName}/formation`, { headers: herokuHeaders(apiKey) });
      const formations = await fRes.json() as any[];
      const updates = formations.map((f: any) => ({ type: f.type, quantity: 0 }));
      if (updates.length) {
        await fetch(`https://api.heroku.com/apps/${appName}/formation`, {
          method: "PATCH", headers: herokuHeaders(apiKey),
          body: JSON.stringify({ updates }),
        });
      }
      const updNow = dbType === "pg" ? "NOW()::text" : "datetime('now')";
      await m(`UPDATE bot_orders SET status = 'stopped', updated_at = ${updNow} WHERE id = ?`, [id]);
      console.log(`[Heroku] Stopped ${appName}`);
      res.json({ success: true, message: "Bot stopped" });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Resume: scale all formations back to 1
  app.post("/api/admin/bot-orders/:orderId/heroku/resume", adminAuthMiddleware, async (req, res) => {
    try {
      const id = parseInt(req.params.orderId);
      const apiKey = getHerokuApiKey();
      const appName = await getHerokuAppName(id);
      if (!appName) return res.status(404).json({ success: false, error: "No Heroku app linked" });
      if (!apiKey) return res.status(500).json({ success: false, error: "HEROKU_API_KEY not set" });
      const fRes = await fetch(`https://api.heroku.com/apps/${appName}/formation`, { headers: herokuHeaders(apiKey) });
      const formations = await fRes.json() as any[];
      const updates = formations.length
        ? formations.map((f: any) => ({ type: f.type, quantity: 1 }))
        : [{ type: "worker", quantity: 1 }];
      await fetch(`https://api.heroku.com/apps/${appName}/formation`, {
        method: "PATCH", headers: herokuHeaders(apiKey),
        body: JSON.stringify({ updates }),
      });
      const updNow = dbType === "pg" ? "NOW()::text" : "datetime('now')";
      await m(`UPDATE bot_orders SET status = 'deployed', updated_at = ${updNow} WHERE id = ?`, [id]);
      console.log(`[Heroku] Resumed ${appName}`);
      res.json({ success: true, message: "Bot resumed" });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Maintenance mode toggle
  app.patch("/api/admin/bot-orders/:orderId/heroku/maintenance", adminAuthMiddleware, async (req, res) => {
    try {
      const id = parseInt(req.params.orderId);
      const { enabled } = req.body;
      const apiKey = getHerokuApiKey();
      const appName = await getHerokuAppName(id);
      if (!appName) return res.status(404).json({ success: false, error: "No Heroku app linked" });
      if (!apiKey) return res.status(500).json({ success: false, error: "HEROKU_API_KEY not set" });
      const r = await fetch(`https://api.heroku.com/apps/${appName}`, {
        method: "PATCH", headers: herokuHeaders(apiKey),
        body: JSON.stringify({ maintenance: !!enabled }),
      });
      const updNow = dbType === "pg" ? "NOW()::text" : "datetime('now')";
      if (enabled) {
        await m(`UPDATE bot_orders SET status = 'suspended', updated_at = ${updNow} WHERE id = ?`, [id]);
      } else {
        await m(`UPDATE bot_orders SET status = 'deployed', updated_at = ${updNow} WHERE id = ?`, [id]);
      }
      console.log(`[Heroku] Maintenance ${enabled ? "ON" : "OFF"} for ${appName}`);
      res.json({ success: r.ok, message: enabled ? "Bot suspended (maintenance on)" : "Bot unsuspended" });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Get config vars
  app.get("/api/admin/bot-orders/:orderId/heroku/config-vars", adminAuthMiddleware, async (req, res) => {
    try {
      const id = parseInt(req.params.orderId);
      const apiKey = getHerokuApiKey();
      const appName = await getHerokuAppName(id);
      if (!appName) return res.status(404).json({ success: false, error: "No Heroku app linked" });
      if (!apiKey) return res.status(500).json({ success: false, error: "HEROKU_API_KEY not set" });
      const r = await fetch(`https://api.heroku.com/apps/${appName}/config-vars`, { headers: herokuHeaders(apiKey) });
      const data = await r.json() as any;
      res.json({ success: r.ok, configVars: data });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Update config vars
  app.patch("/api/admin/bot-orders/:orderId/heroku/config-vars", adminAuthMiddleware, async (req, res) => {
    try {
      const id = parseInt(req.params.orderId);
      const { configVars } = req.body;
      const apiKey = getHerokuApiKey();
      const appName = await getHerokuAppName(id);
      if (!appName) return res.status(404).json({ success: false, error: "No Heroku app linked" });
      if (!apiKey) return res.status(500).json({ success: false, error: "HEROKU_API_KEY not set" });
      const r = await fetch(`https://api.heroku.com/apps/${appName}/config-vars`, {
        method: "PATCH", headers: herokuHeaders(apiKey),
        body: JSON.stringify(configVars),
      });
      const data = await r.json() as any;
      res.json({ success: r.ok, configVars: data });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });


}
