import type { Express } from "express";
import { runQuery, runMutation, dbType } from "./storage";
import { getPaystackSecretKey, getPaystackPublicKey } from "./secrets";
import { customerAuthMiddleware } from "./auth";
import axios from "axios";

function buildQuery(template: string, params: any[]): { query: string; params: any[] } {
  if (dbType === "pg") {
    let i = 1;
    return { query: template.replace(/\?/g, () => `$${i++}`), params };
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

function generateReference(): string {
  return `CTBOT-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

export const TRADING_BOT_PLANS = [
  { id: "monthly",   label: "Monthly",   price: 500,  durationDays: 30,  popular: false },
  { id: "quarterly", label: "Quarterly", price: 1200, durationDays: 90,  popular: true  },
  { id: "lifetime",  label: "Lifetime",  price: 5000, durationDays: null, popular: false },
];

let tableReady = false;
async function ensureTable() {
  if (tableReady) return;
  await m(`
    CREATE TABLE IF NOT EXISTS trading_bot_subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER,
      customer_email TEXT NOT NULL,
      customer_name TEXT,
      plan TEXT NOT NULL,
      amount INTEGER NOT NULL,
      paystack_reference TEXT UNIQUE,
      status TEXT DEFAULT 'pending',
      expires_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
  tableReady = true;
}

export function registerTradingBotRoutes(app: Express) {
  ensureTable().catch(console.error);

  // ── Get plans ──────────────────────────────────────────────────────────────
  app.get("/api/tradingbot/plans", (_req, res) => {
    res.json({ success: true, plans: TRADING_BOT_PLANS });
  });

  // ── Check access ───────────────────────────────────────────────────────────
  app.get("/api/tradingbot/access", customerAuthMiddleware, async (req: any, res) => {
    try {
      await ensureTable();
      const email = req.customer.email;
      const now = new Date().toISOString();
      const rows = await q(
        `SELECT * FROM trading_bot_subscriptions WHERE customer_email = ? AND status = 'active' AND (expires_at IS NULL OR expires_at > ?) ORDER BY created_at DESC LIMIT 1`,
        [email, now]
      );
      res.json({ success: true, hasAccess: rows.length > 0, subscription: rows[0] || null });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── Get my subscription ────────────────────────────────────────────────────
  app.get("/api/tradingbot/subscription", customerAuthMiddleware, async (req: any, res) => {
    try {
      await ensureTable();
      const rows = await q(
        `SELECT * FROM trading_bot_subscriptions WHERE customer_email = ? ORDER BY created_at DESC LIMIT 1`,
        [req.customer.email]
      );
      res.json({ success: true, subscription: rows[0] || null });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── Create checkout ────────────────────────────────────────────────────────
  app.post("/api/tradingbot/checkout", customerAuthMiddleware, async (req: any, res) => {
    try {
      await ensureTable();
      const { planId, payMode } = req.body;
      const plan = TRADING_BOT_PLANS.find(p => p.id === planId);
      if (!plan) return res.status(400).json({ success: false, error: "Invalid plan" });

      const customer = req.customer;
      const reference = generateReference();
      const expiresAt = plan.durationDays
        ? new Date(Date.now() + plan.durationDays * 86400000).toISOString()
        : null;

      // Wallet payment
      if (payMode === "wallet") {
        const [wallet] = await q(`SELECT * FROM wallets WHERE customer_id = ?`, [customer.id]);
        if (!wallet || wallet.balance < plan.price) {
          return res.status(400).json({ success: false, error: "Insufficient wallet balance" });
        }
        await m(`UPDATE wallets SET balance = balance - ?, updated_at = datetime('now') WHERE customer_id = ?`, [plan.price, customer.id]);
        await m(
          `INSERT INTO wallet_transactions (customer_id, type, amount, description, reference) VALUES (?, 'debit', ?, ?, ?)`,
          [customer.id, plan.price, `ChegeBot Pro ${plan.label} subscription`, reference]
        );
        await m(
          `INSERT INTO trading_bot_subscriptions (customer_id, customer_email, customer_name, plan, amount, paystack_reference, status, expires_at) VALUES (?, ?, ?, ?, ?, ?, 'active', ?)`,
          [customer.id, customer.email, customer.name || "", plan.id, plan.price, reference, expiresAt]
        );
        return res.json({ success: true, method: "wallet", activated: true });
      }

      // Paystack
      const secretKey = getPaystackSecretKey();
      if (!secretKey) return res.status(500).json({ success: false, error: "Payment not configured" });

      await m(
        `INSERT INTO trading_bot_subscriptions (customer_id, customer_email, customer_name, plan, amount, paystack_reference, status, expires_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
        [customer.id, customer.email, customer.name || "", plan.id, plan.price, reference, expiresAt]
      );

      const publicKey = getPaystackPublicKey();
      res.json({ success: true, method: "paystack", reference, publicKey, amount: plan.price * 100, email: customer.email });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── Verify Paystack payment ────────────────────────────────────────────────
  app.post("/api/tradingbot/verify", customerAuthMiddleware, async (req: any, res) => {
    try {
      const { reference } = req.body;
      const secretKey = getPaystackSecretKey();
      if (!secretKey) return res.status(500).json({ success: false, error: "Payment not configured" });

      const { data } = await axios.get(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
        headers: { Authorization: `Bearer ${secretKey}` },
      });

      if (data.data?.status !== "success") {
        return res.status(400).json({ success: false, error: "Payment not confirmed by Paystack" });
      }

      await m(
        `UPDATE trading_bot_subscriptions SET status = 'active', updated_at = datetime('now') WHERE paystack_reference = ?`,
        [reference]
      );
      res.json({ success: true, activated: true });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
}
