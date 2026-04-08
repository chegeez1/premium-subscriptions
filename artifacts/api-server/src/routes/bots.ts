import { Router } from "express";
import { db, botsTable, ordersTable } from "@workspace/db";
import { eq, desc, count, sum, sql } from "drizzle-orm";
import {
  AdminCreateBotBody,
  AdminUpdateBotBody,
  AdminUpdateBotParams,
  AdminDeleteBotParams,
  GetBotParams,
  CreateOrderBody,
  GetOrderParams,
  VerifyPaymentParams,
  UpdateOrderStatusBody,
  UpdateOrderStatusParams,
  AdminListOrdersQueryParams,
  AdminLoginBody,
} from "@workspace/api-zod";

export const botsRouter = Router();
export const ordersRouter = Router();
export const adminRouter = Router();

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "chegetech2024";
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "chegetech-admin-secret";
const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY || "";
const HEROKU_API_KEY = process.env.HEROKU_API_KEY || "";

function herokuHeaders() {
  return {
    Authorization: `Bearer ${HEROKU_API_KEY}`,
    "Content-Type": "application/json",
    Accept: "application/vnd.heroku+json; version=3",
  };
}

async function deployBotToHeroku(
  order: typeof ordersTable.$inferSelect,
  bot: typeof botsTable.$inferSelect
): Promise<{ appName: string; appUrl: string } | null> {
  if (!HEROKU_API_KEY) {
    console.log("[Bot Deploy] HEROKU_API_KEY not set — skipping auto-deploy");
    return null;
  }
  try {
    const slug = bot.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const suffix = Date.now().toString(36).slice(-5);
    const appName = `${slug}-${suffix}`.slice(0, 30);

    const createRes = await fetch("https://api.heroku.com/apps", {
      method: "POST",
      headers: herokuHeaders(),
      body: JSON.stringify({ name: appName, region: "us" }),
    });
    const app = await createRes.json() as any;
    if (!app.name) {
      console.error("[Bot Deploy] App creation failed:", JSON.stringify(app).slice(0, 300));
      return null;
    }
    console.log(`[Bot Deploy] Heroku app created: ${app.name}`);

    const configVars: Record<string, string> = {
      MODE: order.mode || "public",
      TZ: order.timezone || "Africa/Nairobi",
      BOT_NAME: bot.name,
      OWNER_NUMBER: order.customerPhone || "",
    };
    if (order.sessionId) configVars["SESSION_ID"] = order.sessionId;
    if (order.dbUrl) configVars["DATABASE_URL"] = order.dbUrl;

    await fetch(`https://api.heroku.com/apps/${app.name}/config-vars`, {
      method: "PATCH",
      headers: herokuHeaders(),
      body: JSON.stringify(configVars),
    });

    const tarballUrl = `${bot.repoUrl}/archive/refs/heads/main.tar.gz`;
    const buildRes = await fetch(`https://api.heroku.com/apps/${app.name}/builds`, {
      method: "POST",
      headers: herokuHeaders(),
      body: JSON.stringify({ source_blob: { url: tarballUrl, version: "main" } }),
    });
    const build = await buildRes.json() as any;
    console.log(`[Bot Deploy] Build triggered for ${app.name}: status=${build.status ?? "queued"} id=${build.id ?? "unknown"}`);

    return { appName: app.name, appUrl: `https://${app.name}.herokuapp.com` };
  } catch (err: any) {
    console.error("[Bot Deploy] Error:", err.message);
    return null;
  }
}

function parseFeatures(f: string | null | undefined): string[] {
  try { return JSON.parse(f ?? "[]"); } catch { return []; }
}

function formatBot(bot: typeof botsTable.$inferSelect) {
  return {
    ...bot,
    features: parseFeatures(bot.features),
    imageUrl: bot.imageUrl ?? null,
    createdAt: bot.createdAt?.toISOString() ?? new Date().toISOString(),
  };
}

function formatOrder(order: typeof ordersTable.$inferSelect) {
  return {
    ...order,
    createdAt: order.createdAt?.toISOString() ?? new Date().toISOString(),
    updatedAt: order.updatedAt?.toISOString() ?? new Date().toISOString(),
    deployedAt: order.deployedAt?.toISOString() ?? null,
  };
}

function adminAuth(req: any, res: any, next: any) {
  const token = req.headers["x-admin-token"] || req.headers["authorization"]?.replace("Bearer ", "");
  if (token !== ADMIN_TOKEN) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

function generateReference(): string {
  return `CTB-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

// ─── Bot routes ─────────────────────────────────────────────────────────────

botsRouter.get("/", async (req, res) => {
  const bots = await db.select().from(botsTable).where(eq(botsTable.active, true)).orderBy(desc(botsTable.createdAt));
  res.json(bots.map(formatBot));
});

botsRouter.get("/:id", async (req, res) => {
  const parsed = GetBotParams.safeParse({ id: Number(req.params.id) });
  if (!parsed.success) return res.status(400).json({ error: "Invalid id" });
  const [bot] = await db.select().from(botsTable).where(eq(botsTable.id, parsed.data.id));
  if (!bot) return res.status(404).json({ error: "Bot not found" });
  res.json(formatBot(bot));
});

// ─── Order routes ───────────────────────────────────────────────────────────

ordersRouter.post("/", async (req, res) => {
  const parsed = CreateOrderBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid body", details: parsed.error });

  const { botId, customerName, customerEmail, customerPhone, sessionId, dbUrl, mode, timezone } = parsed.data;

  const [bot] = await db.select().from(botsTable).where(eq(botsTable.id, botId));
  if (!bot) return res.status(404).json({ error: "Bot not found" });

  const reference = generateReference();
  const [order] = await db.insert(ordersTable).values({
    reference,
    botId,
    botName: bot.name,
    customerName,
    customerEmail,
    customerPhone,
    sessionId: sessionId ?? null,
    dbUrl: dbUrl ?? null,
    mode: mode ?? "public",
    timezone: timezone ?? "Africa/Nairobi",
    amount: bot.price,
    status: "pending",
  }).returning();

  res.status(201).json(formatOrder(order));
});

ordersRouter.get("/:reference", async (req, res) => {
  const parsed = GetOrderParams.safeParse({ reference: req.params.reference });
  if (!parsed.success) return res.status(400).json({ error: "Invalid reference" });
  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.reference, parsed.data.reference));
  if (!order) return res.status(404).json({ error: "Order not found" });
  res.json(formatOrder(order));
});

ordersRouter.post("/verify/:reference", async (req, res) => {
  const parsed = VerifyPaymentParams.safeParse({ reference: req.params.reference });
  if (!parsed.success) return res.status(400).json({ error: "Invalid reference" });

  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.reference, parsed.data.reference));
  if (!order) return res.status(404).json({ error: "Order not found" });

  // Already processed — return current state
  if (order.status !== "pending") return res.json(formatOrder(order));

  let paid: typeof ordersTable.$inferSelect;

  if (PAYSTACK_SECRET) {
    const paystackRef = (req.body as any)?.paystackReference || parsed.data.reference;
    try {
      const resp = await fetch(`https://api.paystack.co/transaction/verify/${paystackRef}`, {
        headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` },
      });
      const data = await resp.json() as any;
      if (data.data?.status !== "success") {
        return res.status(400).json({ error: "Payment not confirmed", paystackStatus: data.data?.status });
      }
      const [updated] = await db.update(ordersTable)
        .set({ status: "paid", paystackReference: paystackRef, updatedAt: new Date() })
        .where(eq(ordersTable.reference, parsed.data.reference))
        .returning();
      paid = updated;
    } catch {
      return res.status(500).json({ error: "Failed to verify payment with Paystack" });
    }
  } else {
    // Dev mode — mark paid without Paystack check
    const [updated] = await db.update(ordersTable)
      .set({ status: "paid", paystackReference: parsed.data.reference, updatedAt: new Date() })
      .where(eq(ordersTable.reference, parsed.data.reference))
      .returning();
    paid = updated;
  }

  // Respond immediately so the client isn't blocked
  res.json(formatOrder(paid));

  // Auto-deploy to Heroku in background (non-blocking)
  const [bot] = await db.select().from(botsTable).where(eq(botsTable.id, order.botId));
  if (bot) {
    deployBotToHeroku(paid, bot)
      .then(async (result) => {
        if (result) {
          await db.update(ordersTable).set({
            status: "deployed",
            herokuAppName: result.appName,
            herokuAppUrl: result.appUrl,
            deployedAt: new Date(),
            updatedAt: new Date(),
          }).where(eq(ordersTable.reference, parsed.data.reference));
          console.log(`[Bot Deploy] ✓ Order ${parsed.data.reference} → ${result.appUrl}`);
        }
      })
      .catch((e: any) => console.error("[Bot Deploy] Background error:", e.message));
  }
});

// ─── Admin routes ────────────────────────────────────────────────────────────

adminRouter.post("/login", async (req, res) => {
  const parsed = AdminLoginBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid body" });
  if (parsed.data.password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Invalid password" });
  }
  res.json({ token: ADMIN_TOKEN, success: true });
});

adminRouter.get("/stats", adminAuth, async (req, res) => {
  const [totals] = await db.select({
    totalOrders: count(ordersTable.id),
    totalRevenue: sum(ordersTable.amount),
  }).from(ordersTable).where(eq(ordersTable.status, "paid"));

  const [pendingCount] = await db.select({ count: count() }).from(ordersTable)
    .where(sql`${ordersTable.status} IN ('paid', 'deploying')`);

  const [deployedCount] = await db.select({ count: count() }).from(ordersTable)
    .where(eq(ordersTable.status, "deployed"));

  const [botCount] = await db.select({ count: count() }).from(botsTable);

  const recentOrders = await db.select().from(ordersTable)
    .orderBy(desc(ordersTable.createdAt)).limit(10);

  res.json({
    totalOrders: Number(totals.totalOrders ?? 0),
    totalRevenue: Number(totals.totalRevenue ?? 0),
    pendingDeployments: Number(pendingCount.count ?? 0),
    deployedBots: Number(deployedCount.count ?? 0),
    totalBots: Number(botCount.count ?? 0),
    recentOrders: recentOrders.map(formatOrder),
  });
});

adminRouter.get("/orders", adminAuth, async (req, res) => {
  const parsed = AdminListOrdersQueryParams.safeParse(req.query);
  let query = db.select().from(ordersTable).orderBy(desc(ordersTable.createdAt));
  if (parsed.success && parsed.data.status) {
    const orders = await db.select().from(ordersTable)
      .where(eq(ordersTable.status, parsed.data.status))
      .orderBy(desc(ordersTable.createdAt));
    return res.json(orders.map(formatOrder));
  }
  const orders = await query;
  res.json(orders.map(formatOrder));
});

adminRouter.patch("/orders/:id/status", adminAuth, async (req, res) => {
  const params = UpdateOrderStatusParams.safeParse({ id: Number(req.params.id) });
  if (!params.success) return res.status(400).json({ error: "Invalid id" });
  const body = UpdateOrderStatusBody.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "Invalid body" });

  const [updated] = await db.update(ordersTable)
    .set({ status: body.data.status, deploymentNotes: body.data.deploymentNotes ?? null, updatedAt: new Date() })
    .where(eq(ordersTable.id, params.data.id))
    .returning();

  if (!updated) return res.status(404).json({ error: "Order not found" });
  res.json(formatOrder(updated));
});

adminRouter.get("/bots", adminAuth, async (req, res) => {
  const bots = await db.select().from(botsTable).orderBy(desc(botsTable.createdAt));
  res.json(bots.map(formatBot));
});

adminRouter.post("/bots", adminAuth, async (req, res) => {
  const parsed = AdminCreateBotBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid body", details: parsed.error });

  const [bot] = await db.insert(botsTable).values({
    name: parsed.data.name,
    description: parsed.data.description,
    repoUrl: parsed.data.repoUrl,
    imageUrl: parsed.data.imageUrl ?? null,
    price: parsed.data.price,
    features: JSON.stringify(parsed.data.features ?? []),
    requiresSessionId: parsed.data.requiresSessionId,
    requiresDbUrl: parsed.data.requiresDbUrl,
    category: parsed.data.category,
    active: true,
  }).returning();

  res.status(201).json(formatBot(bot));
});

adminRouter.patch("/bots/:id", adminAuth, async (req, res) => {
  const params = AdminUpdateBotParams.safeParse({ id: Number(req.params.id) });
  if (!params.success) return res.status(400).json({ error: "Invalid id" });
  const body = AdminUpdateBotBody.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "Invalid body" });

  const updates: Partial<typeof botsTable.$inferInsert> = {};
  if (body.data.name !== undefined) updates.name = body.data.name;
  if (body.data.description !== undefined) updates.description = body.data.description;
  if (body.data.repoUrl !== undefined) updates.repoUrl = body.data.repoUrl;
  if (body.data.imageUrl !== undefined) updates.imageUrl = body.data.imageUrl;
  if (body.data.price !== undefined) updates.price = body.data.price;
  if (body.data.features !== undefined) updates.features = JSON.stringify(body.data.features);
  if (body.data.requiresSessionId !== undefined) updates.requiresSessionId = body.data.requiresSessionId;
  if (body.data.requiresDbUrl !== undefined) updates.requiresDbUrl = body.data.requiresDbUrl;
  if (body.data.active !== undefined) updates.active = body.data.active;
  if (body.data.category !== undefined) updates.category = body.data.category;

  const [updated] = await db.update(botsTable).set(updates).where(eq(botsTable.id, params.data.id)).returning();
  if (!updated) return res.status(404).json({ error: "Bot not found" });
  res.json(formatBot(updated));
});

adminRouter.delete("/bots/:id", adminAuth, async (req, res) => {
  const params = AdminDeleteBotParams.safeParse({ id: Number(req.params.id) });
  if (!params.success) return res.status(400).json({ error: "Invalid id" });
  await db.delete(botsTable).where(eq(botsTable.id, params.data.id));
  res.status(204).send();
});

// ── Heroku management admin endpoints ────────────────────────────────────────

adminRouter.post("/orders/:id/heroku/reboot", adminAuth, async (req, res) => {
  const id = Number(req.params.id);
  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, id));
  if (!order?.herokuAppName) return res.status(404).json({ error: "No Heroku app linked to this order" });
  if (!HEROKU_API_KEY) return res.status(500).json({ error: "HEROKU_API_KEY not configured on server" });
  const r = await fetch(`https://api.heroku.com/apps/${order.herokuAppName}/dynos`, { method: "DELETE", headers: herokuHeaders() });
  res.json({ success: r.ok, message: r.ok ? "Bot rebooted" : "Reboot failed" });
});

adminRouter.post("/orders/:id/heroku/stop", adminAuth, async (req, res) => {
  const id = Number(req.params.id);
  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, id));
  if (!order?.herokuAppName) return res.status(404).json({ error: "No Heroku app linked to this order" });
  if (!HEROKU_API_KEY) return res.status(500).json({ error: "HEROKU_API_KEY not configured on server" });
  const fRes = await fetch(`https://api.heroku.com/apps/${order.herokuAppName}/formation`, { headers: herokuHeaders() });
  const formations = (await fRes.json()) as any[];
  const updates = (Array.isArray(formations) ? formations : []).map((f: any) => ({ type: f.type, quantity: 0 }));
  await fetch(`https://api.heroku.com/apps/${order.herokuAppName}/formation`, {
    method: "PATCH",
    headers: herokuHeaders(),
    body: JSON.stringify({ updates: updates.length ? updates : [{ type: "worker", quantity: 0 }] }),
  });
  await db.update(ordersTable).set({ status: "stopped", updatedAt: new Date() }).where(eq(ordersTable.id, id));
  res.json({ success: true, message: "Bot stopped" });
});

adminRouter.post("/orders/:id/heroku/resume", adminAuth, async (req, res) => {
  const id = Number(req.params.id);
  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, id));
  if (!order?.herokuAppName) return res.status(404).json({ error: "No Heroku app linked to this order" });
  if (!HEROKU_API_KEY) return res.status(500).json({ error: "HEROKU_API_KEY not configured on server" });
  const fRes = await fetch(`https://api.heroku.com/apps/${order.herokuAppName}/formation`, { headers: herokuHeaders() });
  const formations = (await fRes.json()) as any[];
  const updates = (Array.isArray(formations) ? formations : []).map((f: any) => ({ type: f.type, quantity: 1 }));
  await fetch(`https://api.heroku.com/apps/${order.herokuAppName}/formation`, {
    method: "PATCH",
    headers: herokuHeaders(),
    body: JSON.stringify({ updates: updates.length ? updates : [{ type: "worker", quantity: 1 }] }),
  });
  await db.update(ordersTable).set({ status: "deployed", updatedAt: new Date() }).where(eq(ordersTable.id, id));
  res.json({ success: true, message: "Bot resumed" });
});

adminRouter.patch("/orders/:id/heroku/maintenance", adminAuth, async (req, res) => {
  const id = Number(req.params.id);
  const enabled = !!(req.body as any).enabled;
  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, id));
  if (!order?.herokuAppName) return res.status(404).json({ error: "No Heroku app linked to this order" });
  if (!HEROKU_API_KEY) return res.status(500).json({ error: "HEROKU_API_KEY not configured on server" });
  await fetch(`https://api.heroku.com/apps/${order.herokuAppName}`, {
    method: "PATCH",
    headers: herokuHeaders(),
    body: JSON.stringify({ maintenance: enabled }),
  });
  await db.update(ordersTable).set({ status: enabled ? "suspended" : "deployed", updatedAt: new Date() }).where(eq(ordersTable.id, id));
  res.json({ success: true, message: enabled ? "Bot suspended (maintenance on)" : "Bot unsuspended (maintenance off)" });
});

adminRouter.get("/orders/:id/heroku/config-vars", adminAuth, async (req, res) => {
  const id = Number(req.params.id);
  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, id));
  if (!order?.herokuAppName) return res.status(404).json({ error: "No Heroku app linked to this order" });
  if (!HEROKU_API_KEY) return res.status(500).json({ error: "HEROKU_API_KEY not configured on server" });
  const r = await fetch(`https://api.heroku.com/apps/${order.herokuAppName}/config-vars`, { headers: herokuHeaders() });
  const data = await r.json();
  res.json({ success: r.ok, configVars: data });
});

adminRouter.patch("/orders/:id/heroku/config-vars", adminAuth, async (req, res) => {
  const id = Number(req.params.id);
  const { configVars } = req.body as { configVars: Record<string, string> };
  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, id));
  if (!order?.herokuAppName) return res.status(404).json({ error: "No Heroku app linked to this order" });
  if (!HEROKU_API_KEY) return res.status(500).json({ error: "HEROKU_API_KEY not configured on server" });
  const r = await fetch(`https://api.heroku.com/apps/${order.herokuAppName}/config-vars`, {
    method: "PATCH",
    headers: herokuHeaders(),
    body: JSON.stringify(configVars),
  });
  const data = await r.json();
  res.json({ success: r.ok, configVars: data });
});

adminRouter.get("/orders/:id/heroku/status", adminAuth, async (req, res) => {
  const id = Number(req.params.id);
  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, id));
  if (!order?.herokuAppName) return res.json({ deployed: false, message: "No Heroku app linked" });
  if (!HEROKU_API_KEY) return res.json({ deployed: false, message: "HEROKU_API_KEY not set on server" });
  const [appRes, buildRes] = await Promise.all([
    fetch(`https://api.heroku.com/apps/${order.herokuAppName}`, { headers: herokuHeaders() }),
    fetch(`https://api.heroku.com/apps/${order.herokuAppName}/builds?limit=1`, { headers: herokuHeaders() }),
  ]);
  const [appData, buildsData] = (await Promise.all([appRes.json(), buildRes.json()])) as [any, any];
  res.json({
    deployed: true,
    app: appData,
    latestBuild: Array.isArray(buildsData) ? buildsData[0] : buildsData,
    appUrl: order.herokuAppUrl,
  });
});

adminRouter.post("/orders/:id/heroku/redeploy", adminAuth, async (req, res) => {
  const id = Number(req.params.id);
  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, id));
  if (!order) return res.status(404).json({ error: "Order not found" });
  if (!HEROKU_API_KEY) return res.status(500).json({ error: "HEROKU_API_KEY not configured on server" });
  const [bot] = await db.select().from(botsTable).where(eq(botsTable.id, order.botId));
  if (!bot) return res.status(404).json({ error: "Bot not found" });

  res.json({ success: true, message: "Redeploy started in background" });

  deployBotToHeroku(order, bot)
    .then(async (result) => {
      if (result) {
        await db.update(ordersTable).set({
          status: "deployed",
          herokuAppName: result.appName,
          herokuAppUrl: result.appUrl,
          deployedAt: new Date(),
          updatedAt: new Date(),
        }).where(eq(ordersTable.id, id));
        console.log(`[Bot Deploy] Admin redeploy ✓ order ${id} → ${result.appUrl}`);
      }
    })
    .catch((e: any) => console.error("[Bot Deploy] Admin redeploy error:", e.message));
});
