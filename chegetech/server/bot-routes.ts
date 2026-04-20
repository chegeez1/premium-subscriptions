import type { Express } from "express";
import { runQuery, runMutation, dbType } from "./storage";
import { getPaystackSecretKey, getPaystackPublicKey } from "./secrets";
import { promoManager } from "./promo";
import { customerAuthMiddleware } from "./auth";
import { vpsManager } from "./vps-manager";

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

// ── Deploy bot to VPS via SSH + PM2 ─────────────────────────────────────────
  async function deployBotToVps(
    order: Record<string, any>,
    bot: Record<string, any>,
    envVars: Record<string, string>
  ): Promise<{ pm2Name: string; vpsServerId: string } | null> {
    const servers = vpsManager.getAll();
    if (servers.length === 0) {
      console.log("[Bot Deploy] No VPS servers configured — skipping deploy");
      return null;
    }
    const server = servers[0];
    const ref = order.reference;
    const pm2Name = `bot-${ref}`;
    const botDir = `/opt/bots/${pm2Name}`;
    const repoUrl = (bot.repo_url || bot.repoUrl || "").replace(/\.git$/, "");
    if (!repoUrl) throw new Error("Bot has no repoUrl configured");

    // Build .env content line by line
    const envLines = Object.entries(envVars)
      .map(([k, v]) => `${k}=${String(v).replace(/\r?\n/g, "\\n")}`)
      .join("\n");

    console.log(`[Bot Deploy] Deploying ${pm2Name} on ${server.host}`);

    // 1. Clone or pull repo
    await vpsManager.execCommand(server,
      `mkdir -p ${botDir} && (git -C ${botDir} pull --ff-only 2>/dev/null || git clone ${repoUrl} ${botDir})`
    );
    console.log(`[Bot Deploy] ✓ Repo ready at ${botDir}`);

    // 2. Write .env file
    await vpsManager.execCommand(server,
      `printf '%s\\n' ${JSON.stringify(envLines)} > ${botDir}/.env`
    );
    console.log(`[Bot Deploy] ✓ .env written`);

    // 3. npm install
    const { stdout: installOut } = await vpsManager.execCommand(server,
      `cd ${botDir} && npm install --production 2>&1 | tail -3`
    );
    console.log(`[Bot Deploy] npm install: ${installOut.slice(0, 120)}`);

    // 4. Start with PM2
    await vpsManager.execCommand(server,
      `pm2 delete ${pm2Name} 2>/dev/null || true && cd ${botDir} && pm2 start . --name ${pm2Name} && pm2 save`
    );
    console.log(`[Bot Deploy] ✓ PM2 ${pm2Name} started`);

    return { pm2Name, vpsServerId: server.id };
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

      // Deployment triggered after customer submits configuration form

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

      // Deployment triggered after customer submits configuration form

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


      // Manual redeploy via VPS/PM2 (non-blocking)
        if (redeploy && order) {
          const bots = await q("SELECT * FROM bots WHERE id = ?", [order.bot_id]);
          if (bots.length) {
            const envVars = JSON.parse(order.env_vars || "{}");
            deployBotToVps(order, bots[0], envVars).then(async (result) => {
              if (result) {
                await m(
                  `UPDATE bot_orders SET status = 'deployed', pm2_name = ?, vps_server_id = ?, deployed_at = ${updNow}, updated_at = ${updNow} WHERE id = ?`,
                  [result.pm2Name, result.vpsServerId, id]
                );
              }
            }).catch(async (e: any) => {
              await m(
                `UPDATE bot_orders SET status = 'deploy_failed', deployment_notes = ?, updated_at = ${updNow} WHERE id = ?`,
                ["VPS redeploy failed: " + e.message.slice(0, 200), id]
              );
            });
          }
        }


      res.json({ success: true, order: fmtOrder(order) });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });



    // ── Admin: VPS bot status (PM2) ─────────────────────────────────────────────
    app.get("/api/admin/bot-orders/:orderId/vps-status", adminAuthMiddleware, async (req, res) => {
      try {
        const id = parseInt(req.params.orderId);
        const rows = await q("SELECT * FROM bot_orders WHERE id = ?", [id]);
        if (!rows.length) return res.status(404).json({ success: false, error: "Order not found" });
        const order = rows[0];
        const pm2Name = order.pm2_name;
        if (!pm2Name) return res.json({ success: true, deployed: false, message: "Not yet deployed to VPS" });
        const servers = vpsManager.getAll();
        if (!servers.length) return res.json({ success: true, deployed: true, status: order.status, message: "No VPS configured" });
        const server = servers.find((s: any) => s.id === order.vps_server_id) ?? servers[0];
        try {
          const { stdout } = await vpsManager.execCommand(server, `pm2 describe ${pm2Name} 2>&1 || echo 'NOT_FOUND'`);
          const running = stdout.includes("online");
          const stopped = stdout.includes("stopped");
          const pm2Status = running ? "online" : stopped ? "stopped" : "unknown";
          res.json({ success: true, deployed: true, status: order.status, pm2Name, pm2Status, raw: stdout.slice(0, 500) });
        } catch (e: any) {
          res.json({ success: true, deployed: true, status: order.status, pm2Name, pm2Status: "unknown", error: e.message });
        }
      } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
    });

    // Admin VPS helper: get pm2Name + server for an order
    async function getOrderVps(orderId: number) {
      const rows = await q("SELECT * FROM bot_orders WHERE id = ?", [orderId]);
      if (!rows.length) return null;
      const order = rows[0];
      const servers = vpsManager.getAll();
      if (!order.pm2_name || !servers.length) return null;
      const server = servers.find((s: any) => s.id === order.vps_server_id) ?? servers[0];
      return { order, server, pm2Name: order.pm2_name as string };
    }

    // Reboot: pm2 restart
    app.post("/api/admin/bot-orders/:orderId/vps/reboot", adminAuthMiddleware, async (req, res) => {
      try {
        const info = await getOrderVps(parseInt(req.params.orderId));
        if (!info) return res.status(404).json({ success: false, error: "No VPS process linked to this order" });
        await vpsManager.execCommand(info.server, `pm2 restart ${info.pm2Name}`);
        res.json({ success: true, message: "Bot restarted" });
      } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
    });

    // Stop: pm2 stop
    app.post("/api/admin/bot-orders/:orderId/vps/stop", adminAuthMiddleware, async (req, res) => {
      try {
        const id = parseInt(req.params.orderId);
        const info = await getOrderVps(id);
        if (!info) return res.status(404).json({ success: false, error: "No VPS process linked to this order" });
        await vpsManager.execCommand(info.server, `pm2 stop ${info.pm2Name}`);
        const updNow = dbType === "pg" ? "NOW()::text" : "datetime('now')";
        await m(`UPDATE bot_orders SET status = 'stopped', updated_at = ${updNow} WHERE id = ?`, [id]);
        res.json({ success: true, message: "Bot stopped" });
      } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
    });

    // Resume: pm2 start
    app.post("/api/admin/bot-orders/:orderId/vps/resume", adminAuthMiddleware, async (req, res) => {
      try {
        const id = parseInt(req.params.orderId);
        const info = await getOrderVps(id);
        if (!info) return res.status(404).json({ success: false, error: "No VPS process linked to this order" });
        await vpsManager.execCommand(info.server, `pm2 start ${info.pm2Name}`);
        const updNow = dbType === "pg" ? "NOW()::text" : "datetime('now')";
        await m(`UPDATE bot_orders SET status = 'deployed', updated_at = ${updNow} WHERE id = ?`, [id]);
        res.json({ success: true, message: "Bot resumed" });
      } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
    });

    // Get .env (config vars)
    app.get("/api/admin/bot-orders/:orderId/vps/config-vars", adminAuthMiddleware, async (req, res) => {
      try {
        const info = await getOrderVps(parseInt(req.params.orderId));
        if (!info) return res.status(404).json({ success: false, error: "No VPS process linked to this order" });
        const botDir = `/opt/bots/${info.pm2Name}`;
        const { stdout } = await vpsManager.execCommand(info.server, `cat ${botDir}/.env 2>/dev/null || echo ''`);
        const configVars: Record<string, string> = {};
        stdout.split("\n").forEach(line => {
          const eq = line.indexOf("=");
          if (eq > 0) configVars[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
        });
        res.json({ success: true, configVars });
      } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
    });

    // Update .env (config vars) and restart
    app.patch("/api/admin/bot-orders/:orderId/vps/config-vars", adminAuthMiddleware, async (req, res) => {
      try {
        const info = await getOrderVps(parseInt(req.params.orderId));
        if (!info) return res.status(404).json({ success: false, error: "No VPS process linked to this order" });
        const { configVars } = req.body as { configVars: Record<string, string> };
        const botDir = `/opt/bots/${info.pm2Name}`;
        const envLines = Object.entries(configVars)
          .map(([k, v]) => `${k}=${String(v).replace(/\r?\n/g, "\\n")}`)
          .join("\n");
        await vpsManager.execCommand(info.server, `printf '%s\n' ${JSON.stringify(envLines)} > ${botDir}/.env`);
        await vpsManager.execCommand(info.server, `pm2 restart ${info.pm2Name}`);
        const updNow = dbType === "pg" ? "NOW()::text" : "datetime('now')";
        await m(`UPDATE bot_orders SET env_vars = ?, updated_at = ${updNow} WHERE id = ?`, [JSON.stringify(configVars), info.order.id]);
        res.json({ success: true, message: "Config updated and bot restarted" });
      } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
    });

    // ── Public: fetch .env.example template for a bot ───────────────────────────
    app.get("/api/bots/env-template/:botId", async (req, res) => {
      try {
        const botId = parseInt(req.params.botId);
        const bots = await q("SELECT * FROM bots WHERE id = ?", [botId]);
        if (!bots.length) return res.status(404).json({ success: false, error: "Bot not found" });
        const repoUrl = (bots[0].repo_url || bots[0].repoUrl || "").replace(/\.git$/, "").replace(/\/$/, "");
        if (!repoUrl) return res.json({ success: true, vars: [] });
        const rawBase = repoUrl.replace("https://github.com/", "https://raw.githubusercontent.com/") + "/HEAD/.env.example";
        const r = await fetch(rawBase);
        if (!r.ok) return res.json({ success: true, vars: [] });
        const text = await r.text();
        const vars: Array<{ key: string; defaultValue: string; required: boolean }> = [];
        for (const line of text.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith("#")) continue;
          const eq = trimmed.indexOf("=");
          if (eq < 0) continue;
          const key = trimmed.slice(0, eq).trim();
          const defaultValue = trimmed.slice(eq + 1).trim();
          vars.push({ key, defaultValue, required: defaultValue === "" });
        }
        res.json({ success: true, vars });
      } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
    });

    // ── Public: customer submits env vars and triggers deploy ───────────────────
    app.post("/api/bots/order/:reference/configure", async (req, res) => {
      try {
        const { reference } = req.params;
        const { envVars } = req.body as { envVars: Record<string, string> };
        if (!envVars || typeof envVars !== "object") {
          return res.status(400).json({ success: false, error: "envVars object required" });
        }
        const rows = await q("SELECT * FROM bot_orders WHERE reference = ?", [reference]);
        if (!rows.length) return res.status(404).json({ success: false, error: "Order not found" });
        const order = rows[0];
        if (!["paid", "deploy_failed", "configuring"].includes(order.status)) {
          return res.status(400).json({ success: false, error: `Order status '${order.status}' cannot be configured` });
        }
        const bots = await q("SELECT * FROM bots WHERE id = ?", [order.bot_id]);
        if (!bots.length) return res.status(404).json({ success: false, error: "Bot not found" });

        const updNow = dbType === "pg" ? "NOW()::text" : "datetime('now')";
        await m(
          `UPDATE bot_orders SET status = 'configuring', env_vars = ?, updated_at = ${updNow} WHERE reference = ?`,
          [JSON.stringify(envVars), reference]
        );

        const freshOrder = (await q("SELECT * FROM bot_orders WHERE reference = ?", [reference]))[0];
        deployBotToVps(freshOrder, bots[0], envVars).then(async (result) => {
          if (result) {
            await m(
              `UPDATE bot_orders SET status = 'deployed', pm2_name = ?, vps_server_id = ?, deployed_at = ${updNow}, updated_at = ${updNow} WHERE reference = ?`,
              [result.pm2Name, result.vpsServerId, reference]
            );
            console.log(`[Bot Deploy] ✓ Order ${reference} deployed — PM2 ${result.pm2Name}`);
          } else {
            await m(
              `UPDATE bot_orders SET status = 'deploy_failed', deployment_notes = ?, updated_at = ${updNow} WHERE reference = ?`,
              ["No VPS servers configured", reference]
            );
          }
        }).catch(async (e: any) => {
          console.error("[Bot Deploy] ✗ Configure deploy failed:", e.message);
          await m(
            `UPDATE bot_orders SET status = 'deploy_failed', deployment_notes = ?, updated_at = ${updNow} WHERE reference = ?`,
            ["VPS deploy failed: " + e.message.slice(0, 200), reference]
          );
        });

        res.json({ success: true, message: "Configuration saved, deploying now" });
      } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
    });


    // ═══════════════════════════════════════════════════════════════════════
    // ── CUSTOMER bot management (own bots only, VPS/PM2) ──────────────────
    // ═══════════════════════════════════════════════════════════════════════
    async function getOwnedBotOrder(req: any, orderId: number) {
      if (!req.customer?.email) return null;
      const rows = await q("SELECT * FROM bot_orders WHERE id = ? AND customer_email = ?", [orderId, req.customer.email]);
      return rows[0] || null;
    }

    async function getCustomerVps(req: any, orderId: number) {
      const order = await getOwnedBotOrder(req, orderId);
      if (!order) return null;
      const servers = vpsManager.getAll();
      if (!order.pm2_name || !servers.length) return { order, server: null as any, pm2Name: null as string | null };
      const server = servers.find((s: any) => s.id === order.vps_server_id) ?? servers[0];
      return { order, server, pm2Name: order.pm2_name as string };
    }

    // Get PM2 status for an owned bot
    app.get("/api/customer/bots/:orderId/status", customerAuthMiddleware, async (req: any, res) => {
      try {
        const info = await getCustomerVps(req, parseInt(req.params.orderId));
        if (!info) return res.status(404).json({ success: false, error: "Bot not found or not yours" });
        if (!info.pm2Name || !info.server) {
          return res.json({ success: true, deployed: false, status: info.order.status, message: "Not yet deployed" });
        }
        try {
          const { stdout } = await vpsManager.execCommand(info.server, `pm2 describe ${info.pm2Name} 2>&1 || echo 'NOT_FOUND'`);
          const pm2Status = stdout.includes("online") ? "online" : stdout.includes("stopped") ? "stopped" : "unknown";
          res.json({ success: true, deployed: true, status: info.order.status, pm2Name: info.pm2Name, pm2Status });
        } catch (e: any) {
          res.json({ success: true, deployed: true, status: info.order.status, pm2Name: info.pm2Name, pm2Status: "unknown", error: e.message });
        }
      } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
    });

    // Tail PM2 logs for an owned bot
    app.get("/api/customer/bots/:orderId/logs", customerAuthMiddleware, async (req: any, res) => {
      try {
        const info = await getCustomerVps(req, parseInt(req.params.orderId));
        if (!info) return res.status(404).json({ success: false, error: "Bot not found or not yours" });
        if (!info.pm2Name || !info.server) {
          return res.json({ success: true, logs: "Bot is not yet deployed.", lines: [] });
        }
        try {
          const { stdout } = await vpsManager.execCommand(info.server,
            `pm2 logs ${info.pm2Name} --lines 200 --nostream --raw 2>&1 | tail -200`
          );
          const logLines = stdout.split("\n").filter(Boolean).slice(-200);
          res.json({ success: true, logs: logLines.join("\n"), lines: logLines });
        } catch (e: any) {
          res.json({ success: true, logs: `Failed to fetch logs: ${e.message}`, lines: [] });
        }
      } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
    });

    // Restart owned bot
    app.post("/api/customer/bots/:orderId/restart", customerAuthMiddleware, async (req: any, res) => {
      try {
        const info = await getCustomerVps(req, parseInt(req.params.orderId));
        if (!info) return res.status(404).json({ success: false, error: "Bot not found or not yours" });
        if (!info.pm2Name || !info.server) return res.status(400).json({ success: false, error: "Bot is not yet deployed" });
        await vpsManager.execCommand(info.server, `pm2 restart ${info.pm2Name}`);
        res.json({ success: true, message: "Bot restarted" });
      } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
    });

    // Stop owned bot
    app.post("/api/customer/bots/:orderId/stop", customerAuthMiddleware, async (req: any, res) => {
      try {
        const id = parseInt(req.params.orderId);
        const info = await getCustomerVps(req, id);
        if (!info) return res.status(404).json({ success: false, error: "Bot not found or not yours" });
        if (!info.pm2Name || !info.server) return res.status(400).json({ success: false, error: "Bot is not yet deployed" });
        await vpsManager.execCommand(info.server, `pm2 stop ${info.pm2Name}`);
        const updNow = dbType === "pg" ? "NOW()::text" : "datetime('now')";
        await m(`UPDATE bot_orders SET status = 'stopped', updated_at = ${updNow} WHERE id = ?`, [id]);
        res.json({ success: true, message: "Bot stopped" });
      } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
    });

    // Start owned bot
    app.post("/api/customer/bots/:orderId/start", customerAuthMiddleware, async (req: any, res) => {
      try {
        const id = parseInt(req.params.orderId);
        const info = await getCustomerVps(req, id);
        if (!info) return res.status(404).json({ success: false, error: "Bot not found or not yours" });
        if (!info.pm2Name || !info.server) return res.status(400).json({ success: false, error: "Bot is not yet deployed" });
        await vpsManager.execCommand(info.server, `pm2 start ${info.pm2Name}`);
        const updNow = dbType === "pg" ? "NOW()::text" : "datetime('now')";
        await m(`UPDATE bot_orders SET status = 'deployed', updated_at = ${updNow} WHERE id = ?`, [id]);
        res.json({ success: true, message: "Bot started" });
      } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
    });
  


}

