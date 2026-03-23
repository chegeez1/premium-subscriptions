import type { Express } from "express";
import { createServer, type Server } from "http";
import crypto from "crypto";
import axios from "axios";
import bcrypt from "bcryptjs";
import { v4 as uuidv4 } from "uuid";
import multer from "multer";
import path from "path";
import fs from "fs";
import { storage, dbSettingsGet, dbSettingsSet } from "./storage";
import { accountManager } from "./accounts";
import { sendAccountEmail, sendPasswordResetEmail, sendSuspensionEmail, sendUnsuspensionEmail, sendBulkEmail } from "./email";
import { sendTelegramMessage, notifyNewOrder, notifyNewCustomer, notifyPaymentFailed, isTelegramConfigured, notifySupportEscalation } from "./telegram";
import { getWhatsAppStatus, connectWhatsApp, disconnectWhatsApp, isWhatsAppWebConnected, broadcastNewOrder, sendWhatsAppNotification } from "./whatsapp-web";
import { subscriptionPlans } from "./plans";
import { promoManager } from "./promo";
import { planOverridesManager } from "./plan-overrides";
import { vpsManager } from "./vps-manager";
import { countryRestrictions } from "./country-restrictions";
import {
  getAdminCredentials,
  isSetupComplete,
  generateSetup,
  saveSecret,
  verifyTotp,
  verifyTotpWithSecret,
  createAdminToken,
  validateAdminToken,
  adminAuthMiddleware,
  superAdminOnly,
  requirePermission,
  setStorageRef,
} from "./auth";
import { getPaystackSecretKey, getPaystackPublicKey, getSecretsStatus } from "./secrets";
import nodemailer from "nodemailer";
import { getEmailUser, getEmailPass } from "./secrets";
import { getAppConfig, saveAppConfig } from "./app-config";
import { getCredentialsOverride, saveCredentialsOverride } from "./credentials-store";
import { logAdminAction, getAdminLogs } from "./admin-logger";
import { logDelivery, getDeliveryProof, getDeliveryLogs } from "./delivery-log";
import { getAIChatResponse } from "./openai-chat";
import { processAdminCommand, getAutoStatus, runSecurityScan, banCustomerByEmail } from "./admin-bot";
import speakeasy from "speakeasy";
import PDFDocument from "pdfkit";
import QRCode from "qrcode";

function generateVerificationCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function parseDurationMs(duration: string): number {
  const d = duration.toLowerCase();
  if (d.includes("year")) return parseInt(d) * 365 * 86400000;
  if (d.includes("month")) return parseInt(d) * 30 * 86400000;
  if (d.includes("week")) return parseInt(d) * 7 * 86400000;
  if (d.includes("day")) return parseInt(d) * 86400000;
  return 30 * 86400000;
}

function getAffiliateTier(completedReferrals: number): { tier: string; multiplier: number; label: string } {
  const raw = dbSettingsGet("affiliate_tiers");
  const tiers = raw ? JSON.parse(raw) : [
    { name: "Silver", min: 5, multiplier: 1.25 },
    { name: "Gold", min: 15, multiplier: 1.5 },
    { name: "Platinum", min: 30, multiplier: 2.0 },
  ];
  tiers.sort((a: any, b: any) => b.min - a.min);
  for (const t of tiers) {
    if (completedReferrals >= t.min) {
      return { tier: t.name, multiplier: t.multiplier, label: `${t.name} Affiliate` };
    }
  }
  return { tier: "Basic", multiplier: 1.0, label: "Basic Affiliate" };
}

function getBaseUrl(req: any): string {
  const proto = req.headers["x-forwarded-proto"] || req.protocol || "https";
  const host = req.get("host") || "";
  return `${proto}://${host}`;
}

async function sendVerificationEmail(email: string, code: string, name?: string): Promise<void> {
  const user = getEmailUser();
  const pass = getEmailPass();
  if (!user || !pass) return;
  const transporter = nodemailer.createTransport({ service: "gmail", auth: { user, pass } });
  await transporter.sendMail({
    from: `"Chege Tech" <${user}>`,
    to: email,
    subject: "Your Chege Tech Verification Code",
    html: `
      <div style="background:#0b1020;color:#fff;padding:32px;font-family:sans-serif;border-radius:12px;max-width:480px;margin:0 auto">
        <h2 style="color:#818cf8;margin-bottom:8px">Email Verification</h2>
        <p>Hi ${name || "there"}, welcome to <b>Chege Tech</b>!</p>
        <p>Your verification code is:</p>
        <div style="background:#1e1b4b;border-radius:12px;padding:24px;text-align:center;margin:20px 0">
          <span style="font-size:40px;font-weight:900;letter-spacing:12px;color:#a5b4fc">${code}</span>
        </div>
        <p style="color:#9ca3af;font-size:13px">This code expires in 15 minutes. Do not share it with anyone.</p>
      </div>
    `,
  });
}

async function customerAuthMiddleware(req: any, res: any, next: any) {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ error: "Unauthorized" });
  const token = auth.replace("Bearer ", "");
  const session = await storage.getCustomerSession(token);
  if (!session) return res.status(401).json({ error: "Unauthorized" });
  if (new Date(session.expiresAt) < new Date()) {
    await storage.deleteCustomerSession(token);
    return res.status(401).json({ error: "Session expired" });
  }
  const customer = await storage.getCustomerById(session.customerId);
  if (!customer) return res.status(401).json({ error: "Unauthorized" });
  if (customer.suspended) return res.status(403).json({ error: "Account suspended. Contact support." });
  req.customer = customer;
  next();
}

function buildPlansResponse() {
  const overrides = planOverridesManager.getOverrides();
  const customPlans = planOverridesManager.getCustomPlans();

  const enriched = Object.entries(subscriptionPlans).reduce((acc, [key, cat]) => {
    const plans = Object.entries(cat.plans).reduce((pa, [planId, plan]) => {
      const override = overrides[planId] || {};
      if (override.disabled) return pa;
      const avail = accountManager.checkAvailability(planId);
      const effectivePrice = override.priceOverride ?? plan.price;
      pa[planId] = {
        ...plan,
        planId,
        categoryKey: key,
        inStock: avail.available,
        price: effectivePrice,
        originalPrice: override.priceOverride ? plan.price : undefined,
        offerLabel: override.offerLabel,
      };
      return pa;
    }, {} as Record<string, any>);

    const customForCat = customPlans.filter((cp) => cp.categoryKey === key);
    customForCat.forEach((cp) => {
      const override = overrides[cp.id] || {};
      if (!override.disabled) {
        const avail = accountManager.checkAvailability(cp.id);
        plans[cp.id] = {
          name: cp.name,
          price: override.priceOverride ?? cp.price,
          originalPrice: override.priceOverride ? cp.price : undefined,
          duration: cp.duration,
          features: cp.features,
          shared: true,
          maxUsers: cp.maxUsers,
          planId: cp.id,
          categoryKey: key,
          inStock: avail.available,
          isCustom: true,
          offerLabel: override.offerLabel,
        };
      }
    });

    if (Object.keys(plans).length > 0) {
      acc[key] = { ...cat, plans };
    }
    return acc;
  }, {} as Record<string, any>);

  const uncategorizedCustom = customPlans.filter(
    (cp) => !Object.keys(subscriptionPlans).includes(cp.categoryKey)
  );
  if (uncategorizedCustom.length > 0) {
    const customCat: Record<string, any> = {};
    uncategorizedCustom.forEach((cp) => {
      const override = overrides[cp.id] || {};
      if (!override.disabled) {
        const avail = accountManager.checkAvailability(cp.id);
        customCat[cp.id] = {
          name: cp.name,
          price: override.priceOverride ?? cp.price,
          originalPrice: override.priceOverride ? cp.price : undefined,
          duration: cp.duration,
          features: cp.features,
          shared: true,
          maxUsers: cp.maxUsers,
          planId: cp.id,
          categoryKey: "custom",
          inStock: avail.available,
          isCustom: true,
          offerLabel: override.offerLabel,
        };
      }
    });
    if (Object.keys(customCat).length > 0) {
      enriched["custom"] = {
        category: "Other Services",
        icon: "Sparkles",
        color: "#6366F1",
        plans: customCat,
      };
    }
  }

  return enriched;
}

async function verifyPaystackPayment(reference: string): Promise<{
  success: boolean;
  status?: string;
  amount?: number;
  configured: boolean;
}> {
  const secret = getPaystackSecretKey();
  if (!secret) return { success: false, status: "not_configured", configured: false };
  try {
    const res = await axios.get(
      `https://api.paystack.co/transaction/verify/${reference}`,
      { headers: { Authorization: `Bearer ${secret}` } }
    );
    const d = res.data.data;
    return { success: d.status === "success", status: d.status, amount: d.amount / 100, configured: true };
  } catch (err: any) {
    console.error("Paystack verify error:", err.message);
    return { success: false, status: "error", configured: true };
  }
}

async function deliverAccount(transaction: any): Promise<{ success: boolean; error?: string }> {
  const logBase = {
    reference: transaction.reference,
    customerEmail: transaction.customerEmail,
    customerName: transaction.customerName || "Customer",
    planName: transaction.planName,
    planId: transaction.planId,
  };

  const account = accountManager.assignAccount(
    transaction.planId,
    transaction.customerEmail,
    transaction.customerName || "Customer"
  );
  if (!account) {
    logDelivery({ ...logBase, method: "account_assignment", status: "failed", details: "No account available in stock" });
    await storage.updateTransaction(transaction.reference, { status: "failed" });
    return { success: false, error: "No account available - contact support for refund" };
  }

  // ─── Low-stock Telegram alert ─────────────────────────────────────
  try {
    const allAccounts = accountManager.getAllAccounts();
    if (allAccounts) {
      const planAccounts = allAccounts[transaction.planId] || [];
      const available = planAccounts.filter((a: any) => !a.fullyUsed && !a.disabled);
      if (available.length <= 2) {
        sendTelegramMessage(`⚠️ <b>Low Stock Alert</b>\n\nPlan: <b>${transaction.planName}</b>\nRemaining accounts: <b>${available.length}</b>\n\nPlease restock urgently!`).catch(() => {});
      }
    }
  } catch (_) {}

  logDelivery({
    ...logBase,
    method: "account_assignment",
    status: "success",
    details: `Account assigned — ID: ${account.id}`,
    metadata: { accountId: account.id, accountEmail: account.email },
  });

  const emailResult = await sendAccountEmail(
    transaction.customerEmail,
    transaction.planName,
    account,
    transaction.customerName || "Customer"
  );

  logDelivery({
    ...logBase,
    method: "email",
    status: emailResult.success ? "success" : "failed",
    details: emailResult.success
      ? `Credentials email sent to ${transaction.customerEmail}`
      : `Email delivery failed: ${emailResult.error || "unknown error"}`,
    metadata: { recipientEmail: transaction.customerEmail },
  });

  // ─── Compute expiry date from plan duration ───────────────────────
  let expiresAt: string | null = null;
  try {
    const cats = buildPlansResponse();
    for (const cat of Object.values(cats) as any[]) {
      if (cat.plans[transaction.planId]) {
        const dur = cat.plans[transaction.planId].duration || "1 Month";
        expiresAt = new Date(Date.now() + parseDurationMs(dur)).toISOString();
        break;
      }
    }
  } catch (_) {}

  await storage.updateTransaction(transaction.reference, {
    status: "success",
    accountAssigned: true,
    emailSent: emailResult.success,
    paystackReference: transaction.reference,
    ...(expiresAt ? { expiresAt } : {}),
  });

  // ─── Referral rewards: first purchase + ongoing commissions ────────
  try {
    const customerOrders = await storage.getTransactionsByEmail(transaction.customerEmail);
    const successfulOrders = customerOrders.filter((o: any) => o.status === "success" && o.reference !== transaction.reference);
    const isFirstPurchase = successfulOrders.length === 0;

    if (isFirstPurchase) {
      // First purchase: complete the referral + welcome bonus
      const pendingReferralKey = `referral_pending_${transaction.customerEmail}`;
      const pendingCode = dbSettingsGet(pendingReferralKey);
      if (pendingCode && pendingCode !== "") {
        const referral = await storage.getReferralByCode(pendingCode);
        if (referral && referral.status === "pending") {
          const BASE_REFERRER_REWARD = 100;
          const REFEREE_REWARD = 50;
          const stats = await storage.getReferralStats(referral.referrerId);
          const tierInfo = getAffiliateTier(stats.completedReferrals);
          const referrerReward = Math.round(BASE_REFERRER_REWARD * tierInfo.multiplier);

          await storage.completeReferral(pendingCode, transaction.customerEmail, referrerReward);
          await storage.creditWallet(referral.referrerId, referrerReward, `${tierInfo.label} referral reward — ${transaction.customerEmail} first purchase`, transaction.reference);
          const refereeCustomer = await storage.getCustomerByEmail(transaction.customerEmail);
          if (refereeCustomer) {
            await storage.creditWallet(refereeCustomer.id, REFEREE_REWARD, "Welcome bonus — referral credit on first purchase", transaction.reference);
          }
          dbSettingsSet(pendingReferralKey, "");
          // Store permanent referrer mapping for ongoing commissions
          dbSettingsSet(`referral_by_${transaction.customerEmail}`, String(referral.referrerId));

          // ─── 10-referral milestone ────────────────────────────────
          try {
            const updatedStats = await storage.getReferralStats(referral.referrerId);
            if (updatedStats.completedReferrals === 10) {
              const referrerCustomer = await storage.getCustomerById(referral.referrerId);
              if (referrerCustomer) {
                const milestoneKey = `referral_milestone_10_${referral.referrerId}`;
                if (!dbSettingsGet(milestoneKey)) {
                  dbSettingsSet(milestoneKey, "claimed");
                  const FREE_PLAN_IDS = ["netflix-shared-1m", "netflix-shared", "showmax-1m", "showmax-shared", "netflix", "showmax"];
                  let freeAccount: any = null;
                  let freePlanName = "";
                  for (const pid of FREE_PLAN_IDS) {
                    freeAccount = accountManager.assignAccount(pid, referrerCustomer.email, referrerCustomer.name || "Customer");
                    if (freeAccount) { freePlanName = pid.replace(/-/g, " ").toUpperCase(); break; }
                  }
                  if (freeAccount) {
                    await sendAccountEmail(referrerCustomer.email, `${freePlanName} (10-Referral Reward)`, freeAccount, referrerCustomer.name || "Customer");
                    await storage.creditWallet(referral.referrerId, 0, "🎉 10-referral milestone unlocked — free subscription sent to your email!");
                  }
                }
              }
            }
          } catch (milestoneErr: any) {
            console.error("[referral] Milestone check error:", milestoneErr.message);
          }
        }
      }
    } else {
      // Repeat purchase: give ongoing commission to referrer (50 KES × tier multiplier)
      const referrerId = dbSettingsGet(`referral_by_${transaction.customerEmail}`);
      if (referrerId && referrerId !== "") {
        const ONGOING_REWARD = 50;
        const referrerIdNum = parseInt(referrerId, 10);
        if (!isNaN(referrerIdNum)) {
        const stats = await storage.getReferralStats(referrerIdNum);
        const tierInfo = getAffiliateTier(stats.completedReferrals);
        const ongoingReward = Math.round(ONGOING_REWARD * tierInfo.multiplier);
        await storage.creditWallet(referrerIdNum, ongoingReward, `${tierInfo.label} ongoing commission — ${transaction.customerEmail} purchased ${transaction.planName}`, transaction.reference);
        }
      }
    }
  } catch (refErr: any) {
    console.error("[referral] Error processing referral reward:", refErr.message);
  }

  // ─── In-app notification for customer ────────────────────────────
  try {
    const cust = await storage.getCustomerByEmail(transaction.customerEmail);
    if (cust) {
      await storage.createNotification(
        cust.id,
        "order",
        "Order Confirmed ✅",
        `Your ${transaction.planName} subscription is ready. Check your email for credentials.`
      );
    }
  } catch (_) {}

  const orderOpts = {
    customerName: transaction.customerName || "Customer",
    customerEmail: transaction.customerEmail,
    planName: transaction.planName,
    amount: transaction.amount,
    reference: transaction.reference,
  };
  notifyNewOrder(orderOpts).then(() => {
    logDelivery({ ...logBase, method: "telegram_notification", status: "success", details: "Admin notified via Telegram" });
  }).catch(() => {
    logDelivery({ ...logBase, method: "telegram_notification", status: "failed", details: "Telegram notification failed" });
  });
  const override = getCredentialsOverride();
  if (override.whatsappAdminPhone) {
    broadcastNewOrder({ adminPhone: override.whatsappAdminPhone, ...orderOpts }).catch(() => {});
  }
  return { success: true };
}

const geoCache = new Map<string, { code: string | null; expires: number }>();

async function getCountryCode(ip: string): Promise<string | null> {
  if (!ip || ip === "unknown" || ip === "127.0.0.1" || ip.startsWith("::") || ip.startsWith("10.") || ip.startsWith("192.168.") || ip.startsWith("172.")) return null;
  const cached = geoCache.get(ip);
  if (cached && cached.expires > Date.now()) return cached.code;
  try {
    const res = await fetch(`http://ip-api.com/json/${ip}?fields=status,countryCode`);
    if (res.ok) {
      const data: any = await res.json();
      const code = data.status === "success" ? data.countryCode : null;
      geoCache.set(ip, { code, expires: Date.now() + 10 * 60 * 1000 });
      return code;
    }
  } catch {}
  return null;
}

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {
  setStorageRef(storage);

  // ─── Country Restriction Middleware ───────────────────────────────────────
  app.use(async (req: any, res: any, next: any) => {
    if (req.path.startsWith("/api/admin") || req.path.startsWith("/admin") || req.path.startsWith("/api/auth/login") && req.method !== "GET") {
      return next();
    }
    try {
      const { countries } = countryRestrictions.get();
      if (countries.length === 0) return next();
      const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.socket?.remoteAddress || "";
      const code = await getCountryCode(ip);
      if (code && countryRestrictions.isBlocked(code)) {
        return res.status(403).json({ success: false, error: "Access from your region is restricted.", blocked: true, countryCode: code });
      }
    } catch {}
    next();
  });

  // ─── Public: Config ───────────────────────────────────────────────────────
  app.get("/api/config", (_req, res) => {
    const pub = getPaystackPublicKey();
    const sec = getPaystackSecretKey();
    res.json({
      paystackPublicKey: pub || null,
      paystackConfigured: !!(pub && sec),
    });
  });

  // ─── Public: Plans ────────────────────────────────────────────────────────
  app.get("/api/plans", (_req, res) => {
    res.json({ success: true, categories: buildPlansResponse() });
  });

  // ─── Public: Validate promo code ─────────────────────────────────────────
  app.post("/api/payment/validate-promo", (req, res) => {
    const { code, planId, amount } = req.body;
    const result = promoManager.validate(code, planId);
    if (!result.valid) return res.status(400).json({ success: false, error: result.error });

    const promo = result.promo!;
    let discountAmount = 0;
    if (promo.discountType === "percent") {
      discountAmount = Math.round((amount * promo.discountValue) / 100);
    } else {
      discountAmount = promo.discountValue;
    }
    const finalAmount = Math.max(0, amount - discountAmount);
    res.json({ success: true, promo, discountAmount, finalAmount, originalAmount: amount });
  });

  // ─── Public: Initialize payment ──────────────────────────────────────────
  app.post("/api/payment/initialize", async (req, res) => {
    try {
      const { planId, customerName, email, promoCode } = req.body;
      if (!email || !planId) return res.status(400).json({ success: false, error: "Email and planId are required" });

      const categories = buildPlansResponse();
      let plan: any = null;
      for (const cat of Object.values(categories) as any[]) {
        if (cat.plans[planId]) { plan = cat.plans[planId]; break; }
      }
      if (!plan) return res.status(400).json({ success: false, error: "Invalid plan" });

      const avail = accountManager.checkAvailability(planId);
      if (!avail.available) {
        return res.status(400).json({ success: false, error: "This plan is currently out of stock", outOfStock: true });
      }

      let finalAmount = plan.price;
      let promoUsed: string | null = null;
      if (promoCode) {
        const promoResult = promoManager.validate(promoCode, planId);
        if (promoResult.valid && promoResult.promo) {
          const p = promoResult.promo;
          if (p.discountType === "percent") {
            finalAmount = Math.max(0, finalAmount - Math.round((finalAmount * p.discountValue) / 100));
          } else {
            finalAmount = Math.max(0, finalAmount - p.discountValue);
          }
          promoUsed = promoCode.toUpperCase();
        }
      }

      const reference = `SUB-${planId.toUpperCase()}-${Date.now()}`;
      await storage.createTransaction({
        reference,
        planId,
        planName: plan.name,
        customerEmail: email,
        customerName: customerName || "Customer",
        amount: finalAmount,
        status: "pending",
        emailSent: false,
        accountAssigned: false,
      });

      const paystackSecret = getPaystackSecretKey();
      if (!paystackSecret) {
        return res.json({
          success: true,
          reference,
          authorizationUrl: null,
          paystackConfigured: false,
          plan: plan.name,
          amount: finalAmount,
        });
      }

      const psRes = await axios.post(
        "https://api.paystack.co/transaction/initialize",
        {
          email,
          amount: finalAmount * 100,
          reference,
          metadata: { planId, planName: plan.name, customerName, promoCode: promoUsed },
          callback_url: `${getBaseUrl(req)}/payment/success?ref=${reference}`,
        },
        { headers: { Authorization: `Bearer ${paystackSecret}` } }
      );

      if (promoUsed) promoManager.use(promoUsed);

      res.json({
        success: true,
        reference,
        authorizationUrl: psRes.data.data.authorization_url,
        accessCode: psRes.data.data.access_code,
        paystackConfigured: true,
        plan: plan.name,
        amount: finalAmount,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ─── Public: Verify payment ───────────────────────────────────────────────
  app.post("/api/payment/verify", async (req, res) => {
    try {
      const { reference } = req.body;
      if (!reference) return res.status(400).json({ success: false, error: "Reference required" });

      const transaction = await storage.getTransaction(reference);
      if (!transaction) return res.status(404).json({ success: false, error: "Transaction not found" });

      if (transaction.status === "success") {
        return res.json({ success: true, status: "success", alreadyProcessed: true, planName: transaction.planName });
      }
      if (transaction.status === "failed") {
        return res.json({ success: false, status: "failed", error: "This transaction has already failed" });
      }
      if (transaction.status === "cancelled") {
        const recheck = await verifyPaystackPayment(reference);
        if (recheck.configured && recheck.success) {
          await storage.updateTransaction(reference, { status: "pending" });
          transaction.status = "pending";
        } else {
          return res.json({ success: false, status: "cancelled", error: "This transaction was cancelled due to timeout" });
        }
      }

      const verify = await verifyPaystackPayment(reference);
      if (!verify.configured) {
        return res.status(503).json({ success: false, error: "Payment gateway not configured", notConfigured: true });
      }
      if (!verify.success) {
        await storage.updateTransaction(reference, { status: "failed" });
        return res.json({ success: false, status: "failed", error: "Payment was not successful" });
      }

      const delivery = await deliverAccount(transaction);
      if (!delivery.success) return res.json({ success: false, error: delivery.error });

      res.json({ success: true, status: "success", planName: transaction.planName });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ─── Public: Initialize cart payment ──────────────────────────────────────
  app.post("/api/payment/initialize-cart", async (req, res) => {
    try {
      const { items, customerName, email } = req.body;
      if (!email || !items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ success: false, error: "Email and items are required" });
      }
      const paystackSecret = getPaystackSecretKey();
      if (!paystackSecret) {
        return res.json({ success: true, paystackConfigured: false, reference: "", authorizationUrl: "" });
      }
      const categories = buildPlansResponse();
      const expandedItems: Array<{ planId: string; planName: string; amount: number; categoryName: string }> = [];
      for (const item of items) {
        let plan: any = null;
        for (const cat of Object.values(categories) as any[]) {
          if (cat.plans[item.planId]) { plan = { ...cat.plans[item.planId], categoryName: cat.category }; break; }
        }
        if (!plan) return res.status(400).json({ success: false, error: `Invalid plan: ${item.planId}` });
        const avail = accountManager.checkAvailability(item.planId);
        const qty = Math.max(1, item.qty || 1);
        if (!avail.available) return res.status(400).json({ success: false, error: `${plan.name} is currently out of stock`, outOfStock: true, planName: plan.name });
        for (let q = 0; q < qty; q++) {
          expandedItems.push({ planId: item.planId, planName: plan.name, amount: plan.price, categoryName: plan.categoryName });
        }
      }
      const totalAmount = expandedItems.reduce((s, i) => s + i.amount, 0);
      const reference = `ct-cart-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      for (const item of expandedItems) {
        await storage.createTransaction({
          reference: `${reference}-${expandedItems.indexOf(item)}`,
          planId: item.planId, planName: item.planName, amount: item.amount,
          customerEmail: email, customerName: customerName || "Customer",
          status: "pending", accountAssigned: false, emailSent: false, paystackReference: reference,
        });
      }
      const psRes = await axios.post(
        "https://api.paystack.co/transaction/initialize",
        { email, amount: totalAmount * 100, reference, currency: "KES",
          callback_url: `${getBaseUrl(req)}/payment/cart-success?ref=${reference}`,
          metadata: { cartRef: reference, items: expandedItems.length, customerName } },
        { headers: { Authorization: `Bearer ${paystackSecret}` } }
      );
      res.json({ success: true, reference, authorizationUrl: psRes.data.data.authorization_url, accessCode: psRes.data.data.access_code, paystackConfigured: true, totalAmount, itemCount: expandedItems.length });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ─── Public: Verify cart payment ──────────────────────────────────────────
  app.post("/api/payment/verify-cart", async (req, res) => {
    try {
      const { reference } = req.body;
      if (!reference) return res.status(400).json({ success: false, error: "Reference required" });
      const verify = await verifyPaystackPayment(reference);
      if (!verify.configured) return res.status(503).json({ success: false, error: "Payment gateway not configured" });
      if (!verify.success) return res.json({ success: false, error: "Payment was not successful" });
      const allTx = await storage.getAllTransactions();
      const cartTxs = allTx.filter((t) => t.paystackReference === reference && t.status === "pending");
      if (cartTxs.length === 0) {
        const done = allTx.filter((t) => t.paystackReference === reference && t.status === "success");
        if (done.length > 0) return res.json({ success: true, alreadyProcessed: true, planNames: done.map((t) => t.planName) });
        return res.status(404).json({ success: false, error: "Cart transactions not found" });
      }
      const results: string[] = [];
      for (const tx of cartTxs) {
        const delivery = await deliverAccount(tx);
        if (delivery.success) results.push(tx.planName);
        else await storage.updateTransaction(tx.reference, { status: "failed" });
      }
      res.json({ success: true, planNames: results, delivered: results.length, total: cartTxs.length });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ─── Paystack redirect callback ───────────────────────────────────────────
  app.get("/api/payment/callback", async (req, res) => {
    const ref = ((req.query.reference || req.query.trxref) as string) || "";
    if (!ref) return res.redirect("/");
    try {
      const transaction = await storage.getTransaction(ref);
      if (!transaction || transaction.status === "success") {
        return res.redirect(`/payment/success?ref=${ref}&plan=${encodeURIComponent(transaction?.planName || "")}`);
      }
      if (transaction.status === "cancelled") {
        const recheck = await verifyPaystackPayment(ref);
        if (recheck.configured && recheck.success) {
          await storage.updateTransaction(ref, { status: "pending" });
          transaction.status = "pending";
        } else {
          return res.redirect(`/checkout?planId=${transaction.planId}&error=payment_cancelled`);
        }
      }
      const verify = await verifyPaystackPayment(ref);
      if (verify.success && verify.configured) {
        const delivery = await deliverAccount(transaction);
        if (delivery.success) {
          return res.redirect(`/payment/success?ref=${ref}&plan=${encodeURIComponent(transaction.planName)}&email=${encodeURIComponent(transaction.customerEmail)}`);
        }
      }
      res.redirect(`/checkout?planId=${transaction.planId}&error=payment_failed`);
    } catch {
      res.redirect("/");
    }
  });

  // ─── Paystack Webhook (server-to-server backup delivery) ─────────────────
  app.post("/api/paystack/webhook", async (req: any, res) => {
    try {
      const paystackSecret = getPaystackSecretKey();
      if (!paystackSecret) return res.sendStatus(200);

      const signature = req.headers["x-paystack-signature"];
      if (signature) {
        const hash = crypto.createHmac("sha512", paystackSecret)
          .update(typeof req.rawBody === "string" ? req.rawBody : (req.rawBody instanceof Buffer ? req.rawBody : JSON.stringify(req.body)))
          .digest("hex");
        if (hash !== signature) {
          console.log("[webhook] Invalid signature — ignoring");
          return res.sendStatus(200);
        }
      }

      const event = req.body;
      if (event.event !== "charge.success") return res.sendStatus(200);

      const reference = event.data?.reference;
      if (!reference) return res.sendStatus(200);

      console.log(`[webhook] charge.success for ref=${reference}`);

      if (reference.startsWith("ct-cart-")) {
        const allTx = await storage.getAllTransactions();
        const cartTxs = allTx.filter((t) => t.paystackReference === reference && (t.status === "pending" || t.status === "cancelled"));
        for (const tx of cartTxs) {
          if (tx.status === "cancelled") {
            await storage.updateTransaction(tx.reference, { status: "pending" });
            tx.status = "pending";
          }
          await deliverAccount(tx);
        }
      } else {
        const transaction = await storage.getTransaction(reference);
        if (transaction && (transaction.status === "pending" || transaction.status === "cancelled")) {
          if (transaction.status === "cancelled") {
            await storage.updateTransaction(reference, { status: "pending" });
            transaction.status = "pending";
          }
          await deliverAccount(transaction);
        }
      }

      res.sendStatus(200);
    } catch (err: any) {
      console.error("[webhook] Error:", err.message);
      res.sendStatus(200);
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ADMIN ROUTES
  // ═══════════════════════════════════════════════════════════════════════════

  // ─── Admin: 2FA Setup Status ──────────────────────────────────────────────
  app.get("/api/admin/2fa-status", (_req, res) => {
    res.json({ setupComplete: isSetupComplete() });
  });

  // ─── Admin: Generate 2FA setup QR ────────────────────────────────────────
  app.post("/api/admin/2fa-setup", async (req, res) => {
    try {
      const { email, password } = req.body;
      const creds = getAdminCredentials();
      if (email !== creds.email || password !== creds.password) {
        return res.status(401).json({ success: false, error: "Invalid credentials" });
      }
      const setup = await generateSetup();
      res.json({ success: true, ...setup });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ─── Admin: Complete 2FA Setup ────────────────────────────────────────────
  app.post("/api/admin/2fa-complete", (req, res) => {
    const { email, password, secret, totpCode } = req.body;
    const creds = getAdminCredentials();
    if (email !== creds.email || password !== creds.password) {
      return res.status(401).json({ success: false, error: "Invalid credentials" });
    }
    const valid = verifyTotpWithSecret(totpCode, secret);
    if (!valid) return res.status(400).json({ success: false, error: "Invalid authenticator code - check your app" });
    saveSecret(secret);
    const token = createAdminToken();
    res.json({ success: true, token });
  });

  // ─── Admin: Login ─────────────────────────────────────────────────────────
  app.post("/api/admin/login", async (req, res) => {
    const { email, password, totpCode } = req.body;
    const ip = req.headers["x-forwarded-for"]?.toString() || req.socket.remoteAddress || "unknown";
    const creds = getAdminCredentials();

    if (email === creds.email && password === creds.password) {
      if (isSetupComplete()) {
        if (!totpCode) {
          return res.status(403).json({ success: false, error: "2FA code required", requiresTotp: true });
        }
        if (!verifyTotp(totpCode)) {
          logAdminAction({ action: "Login failed — wrong 2FA code", category: "auth", details: `Email: ${email}`, ip, status: "error" });
          return res.status(401).json({ success: false, error: "Invalid 2FA code" });
        }
      }
      const token = createAdminToken({ role: "super" });
      logAdminAction({ action: "Super admin logged in", category: "auth", details: `Email: ${email}`, ip, status: "success" });
      return res.json({ success: true, token, role: "super" });
    }

    const subAdmin = await storage.getSubAdminByEmail(email);
    if (subAdmin && subAdmin.active) {
      const valid = await bcrypt.compare(password, subAdmin.passwordHash);
      if (valid) {
        const token = createAdminToken({ role: "subadmin", subAdminId: subAdmin.id, permissions: subAdmin.permissions });
        logAdminAction({ action: "Sub-admin logged in", category: "auth", details: `Email: ${email}`, ip, status: "success" });
        return res.json({ success: true, token, role: "subadmin" });
      }
    }

    logAdminAction({ action: "Login failed — wrong credentials", category: "auth", details: `Email: ${email}`, ip, status: "error" });
    return res.status(401).json({ success: false, error: "Invalid email or password" });
  });

  // ─── Admin: Current user info ────────────────────────────────────────────
  app.get("/api/admin/me", adminAuthMiddleware, async (req: any, res) => {
    if (req.adminRole === "super") {
      return res.json({ success: true, role: "super", permissions: "all" });
    }
    const subAdmin = await storage.getSubAdminById(req.subAdminId);
    if (!subAdmin || !subAdmin.active) return res.status(401).json({ success: false, error: "Account deactivated" });
    res.json({ success: true, role: "subadmin", permissions: subAdmin.permissions, name: subAdmin.name, email: subAdmin.email });
  });

  // ─── Admin: Profile ───────────────────────────────────────────────────────
  app.get("/api/admin/profile", adminAuthMiddleware, async (req: any, res) => {
    if (req.adminRole === "super") {
      const override = (() => { try { return JSON.parse(dbSettingsGet("credentials_override") || "{}"); } catch { return {}; } })();
      return res.json({
        success: true,
        role: "super",
        name: dbSettingsGet("admin_name") || "Super Admin",
        avatar: dbSettingsGet("admin_avatar") || "CT",
        bio: dbSettingsGet("admin_bio") || "",
        email: override.adminEmail || process.env.ADMIN_EMAIL || "",
      });
    }
    const subAdmin = await storage.getSubAdminById(req.subAdminId);
    if (!subAdmin) return res.status(404).json({ success: false, error: "Not found" });
    res.json({ success: true, role: "subadmin", name: subAdmin.name, avatar: subAdmin.name?.slice(0, 2).toUpperCase() || "SA", bio: "", email: subAdmin.email });
  });

  app.put("/api/admin/profile", adminAuthMiddleware, async (req: any, res) => {
    const { name, avatar, bio } = req.body;
    if (req.adminRole === "super") {
      if (name !== undefined) dbSettingsSet("admin_name", name.trim() || "Super Admin");
      if (avatar !== undefined) dbSettingsSet("admin_avatar", avatar.trim() || "CT");
      if (bio !== undefined) dbSettingsSet("admin_bio", bio.trim());
      return res.json({ success: true });
    }
    if (name !== undefined) await storage.updateSubAdmin(req.subAdminId, { name: name.trim() });
    res.json({ success: true });
  });

  // ─── Admin: Get secrets status ────────────────────────────────────────────
  app.get("/api/admin/secrets", adminAuthMiddleware, superAdminOnly, (_req, res) => {
    res.json({ success: true, secrets: getSecretsStatus() });
  });

  // ─── Admin: Stats ─────────────────────────────────────────────────────────
  app.get("/api/admin/stats", adminAuthMiddleware, async (_req, res) => {
    try {
      const [txStats, accStats] = await Promise.all([
        storage.getStats(),
        Promise.resolve(accountManager.getStats()),
      ]);
      res.json({ success: true, transactions: txStats, accounts: accStats });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ─── Admin: Transactions ──────────────────────────────────────────────────
  app.get("/api/admin/transactions", adminAuthMiddleware, requirePermission("dashboard", "transactions"), async (_req, res) => {
    try {
      const txs = await storage.getAllTransactions();
      res.json({ success: true, transactions: txs });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ─── Admin: Get all accounts ──────────────────────────────────────────────
  app.get("/api/admin/accounts", adminAuthMiddleware, requirePermission("accounts"), (_req, res) => {
    res.json({ success: true, accounts: accountManager.getAllAccounts() });
  });

  // ─── Admin: Add account ───────────────────────────────────────────────────
  app.post("/api/admin/accounts", adminAuthMiddleware, requirePermission("accounts"), (req, res) => {
    try {
      const { planId, email, username, password, activationCode, redeemLink, instructions, maxUsers } = req.body;
      if (!planId) return res.status(400).json({ success: false, error: "planId is required" });
      const account = accountManager.addAccount(planId, {
        email, username, password, activationCode, redeemLink, instructions,
        maxUsers: parseInt(maxUsers) || 5,
      });
      res.json({ success: true, account });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ─── Admin: Update account ────────────────────────────────────────────────
  app.put("/api/admin/accounts/:id", adminAuthMiddleware, requirePermission("accounts"), (req, res) => {
    const updated = accountManager.updateAccount(req.params.id, req.body);
    if (!updated) return res.status(404).json({ success: false, error: "Account not found" });
    res.json({ success: true, account: updated });
  });

  // ─── Admin: Toggle account disabled ──────────────────────────────────────
  app.patch("/api/admin/accounts/:id/toggle", adminAuthMiddleware, requirePermission("accounts"), (req, res) => {
    const acc = accountManager.toggleAccountDisabled(req.params.id);
    if (!acc) return res.status(404).json({ success: false, error: "Account not found" });
    res.json({ success: true, account: acc });
  });

  // ─── Admin: Delete account ────────────────────────────────────────────────
  app.delete("/api/admin/accounts/:id", adminAuthMiddleware, requirePermission("accounts"), (req, res) => {
    const result = accountManager.removeAccount(req.params.id);
    if (result.removed) res.json({ success: true });
    else res.status(404).json({ success: false, error: "Account not found" });
  });

  // ─── Admin: Bulk add accounts ─────────────────────────────────────────────
  app.post("/api/admin/accounts/bulk", adminAuthMiddleware, requirePermission("accounts"), (req, res) => {
    try {
      const { planId, accounts: rows } = req.body;
      if (!planId) return res.status(400).json({ success: false, error: "planId is required" });
      if (!Array.isArray(rows) || rows.length === 0) return res.status(400).json({ success: false, error: "accounts array is required" });
      const added: any[] = [];
      const errors: string[] = [];
      rows.forEach((row: any, i: number) => {
        try {
          if (!row.email && !row.username && !row.password) { errors.push(`Row ${i + 1}: at least email or password required`); return; }
          const acc = accountManager.addAccount(planId, {
            email: row.email || "",
            username: row.username || "",
            password: row.password || "",
            activationCode: row.activationCode || "",
            redeemLink: row.redeemLink || "",
            instructions: row.instructions || "",
            maxUsers: parseInt(row.maxUsers) || 5,
          });
          added.push(acc);
        } catch (e: any) {
          errors.push(`Row ${i + 1}: ${e.message}`);
        }
      });
      logAdminAction({ action: `Bulk upload: ${added.length} accounts added to ${planId}`, category: "accounts", details: `${added.length} added, ${errors.length} errors`, status: "success" });
      res.json({ success: true, added: added.length, errors });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ─── Admin: Resend credentials ────────────────────────────────────────────
  app.post("/api/admin/transactions/:reference/resend", adminAuthMiddleware, requirePermission("transactions"), async (req, res) => {
    try {
      const tx = await storage.getTransaction(req.params.reference);
      if (!tx) return res.status(404).json({ success: false, error: "Transaction not found" });
      if (tx.status !== "success") return res.status(400).json({ success: false, error: "Can only resend for completed transactions" });
      const account = accountManager.findAccountByCustomer(tx.planId, tx.customerEmail);
      if (!account) return res.status(404).json({ success: false, error: "No assigned account found for this order" });
      const emailResult = await sendAccountEmail(tx.customerEmail, tx.planName, account, tx.customerName || "Customer");
      logDelivery({
        reference: tx.reference,
        customerEmail: tx.customerEmail,
        customerName: tx.customerName || "Customer",
        planName: tx.planName,
        planId: tx.planId,
        method: "resend_email",
        status: emailResult.success ? "success" : "failed",
        details: emailResult.success
          ? `Credentials re-sent to ${tx.customerEmail} (admin action)`
          : `Resend failed: ${emailResult.error || "unknown error"}`,
        metadata: { recipientEmail: tx.customerEmail, triggeredBy: "admin" },
      });
      logAdminAction({ action: `Credentials resent to ${tx.customerEmail} for ${tx.planName}`, category: "transactions", details: `Transaction: ${tx.reference}`, status: "success" });
      res.json({ success: true, emailSent: emailResult.success });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ─── Admin: Manual Transaction Verification ─────────────────────────────
  app.post("/api/admin/transactions/:reference/verify", adminAuthMiddleware, requirePermission("transactions"), async (req, res) => {
    try {
      const tx = await storage.getTransaction(req.params.reference);
      if (!tx) return res.status(404).json({ success: false, error: "Transaction not found" });
      if (tx.status === "success") return res.status(400).json({ success: false, error: "Transaction already verified and delivered" });

      const freshTx = await storage.getTransaction(req.params.reference);
      if (freshTx?.status === "success") return res.status(400).json({ success: false, error: "Transaction was already delivered (concurrent action)" });

      let verificationMethod = "admin_force_override";
      const paystackCheck = await verifyPaystackPayment(tx.reference);
      if (paystackCheck.configured && paystackCheck.success) {
        verificationMethod = "admin_paystack_confirmed";
      }

      const delivery = await deliverAccount(tx);
      if (delivery.success) {
        logAdminAction({
          action: `Manually verified transaction ${tx.reference} for ${tx.customerEmail}`,
          category: "transactions",
          status: "success",
          details: `Method: ${verificationMethod}. Account delivered to ${tx.customerEmail}`,
        });
        res.json({
          success: true,
          message: "Transaction verified and credentials delivered",
          method: verificationMethod,
        });
      } else {
        logAdminAction({ action: `Manual verification attempted for ${tx.reference}`, category: "transactions", status: "error", details: delivery.error || "Failed to deliver account" });
        res.json({ success: false, error: delivery.error || "Failed to deliver account" });
      }
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ─── Admin: Delivery Proof ──────────────────────────────────────────────
  app.get("/api/admin/delivery-proof/:reference", adminAuthMiddleware, requirePermission("transactions"), (req, res) => {
    try {
      const proof = getDeliveryProof(req.params.reference);
      res.json({ success: true, proof });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.get("/api/admin/delivery-logs", adminAuthMiddleware, requirePermission("transactions"), (req, res) => {
    try {
      const email = req.query.email as string | undefined;
      const reference = req.query.reference as string | undefined;
      const logs = getDeliveryLogs(reference, email);
      res.json({ success: true, logs });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ─── Admin: Analytics ─────────────────────────────────────────────────────
  app.get("/api/admin/analytics", adminAuthMiddleware, requirePermission("dashboard"), async (_req, res) => {
    try {
      const all = await storage.getAllTransactions();
      const successful = all.filter((t) => t.status === "success");
      const now = new Date();
      const daily: Record<string, { date: string; revenue: number; orders: number }> = {};
      for (let i = 13; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        const key = d.toISOString().split("T")[0];
        daily[key] = { date: key, revenue: 0, orders: 0 };
      }
      successful.forEach((t) => {
        if (t.createdAt) {
          const key = new Date(t.createdAt).toISOString().split("T")[0];
          if (daily[key]) { daily[key].revenue += t.amount; daily[key].orders += 1; }
        }
      });
      const planRevenue: Record<string, { planName: string; revenue: number; orders: number }> = {};
      successful.forEach((t) => {
        if (!planRevenue[t.planId]) planRevenue[t.planId] = { planName: t.planName, revenue: 0, orders: 0 };
        planRevenue[t.planId].revenue += t.amount;
        planRevenue[t.planId].orders += 1;
      });
      const topPlans = Object.values(planRevenue).sort((a, b) => b.revenue - a.revenue).slice(0, 5);
      res.json({ success: true, daily: Object.values(daily), topPlans });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ─── Admin: Get plan overrides ────────────────────────────────────────────
  app.get("/api/admin/plan-overrides", adminAuthMiddleware, requirePermission("plans"), (_req, res) => {
    res.json({ success: true, overrides: planOverridesManager.getOverrides() });
  });

  // ─── Admin: Update plan override ─────────────────────────────────────────
  app.put("/api/admin/plans/:planId", adminAuthMiddleware, requirePermission("plans"), (req, res) => {
    planOverridesManager.setOverride(req.params.planId, req.body);
    res.json({ success: true });
  });

  // ─── Admin: Reset plan override ───────────────────────────────────────────
  app.delete("/api/admin/plans/:planId/override", adminAuthMiddleware, requirePermission("plans"), (req, res) => {
    planOverridesManager.deleteOverride(req.params.planId);
    res.json({ success: true });
  });

  // ─── Admin: Get custom plans ──────────────────────────────────────────────
  app.get("/api/admin/custom-plans", adminAuthMiddleware, requirePermission("plans"), (_req, res) => {
    res.json({ success: true, plans: planOverridesManager.getCustomPlans() });
  });

  // ─── Admin: Add custom plan ───────────────────────────────────────────────
  app.post("/api/admin/custom-plans", adminAuthMiddleware, requirePermission("plans"), (req, res) => {
    try {
      const plan = planOverridesManager.addCustomPlan(req.body);
      res.json({ success: true, plan });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ─── Admin: Update custom plan ────────────────────────────────────────────
  app.put("/api/admin/custom-plans/:id", adminAuthMiddleware, requirePermission("plans"), (req, res) => {
    const plan = planOverridesManager.updateCustomPlan(req.params.id, req.body);
    if (!plan) return res.status(404).json({ success: false, error: "Custom plan not found" });
    res.json({ success: true, plan });
  });

  // ─── Admin: Delete custom plan ────────────────────────────────────────────
  app.delete("/api/admin/custom-plans/:id", adminAuthMiddleware, requirePermission("plans"), (req, res) => {
    const ok = planOverridesManager.deleteCustomPlan(req.params.id);
    if (!ok) return res.status(404).json({ success: false, error: "Custom plan not found" });
    res.json({ success: true });
  });

  // ─── Admin: Get promo codes ───────────────────────────────────────────────
  app.get("/api/admin/promo-codes", adminAuthMiddleware, requirePermission("plans"), (_req, res) => {
    res.json({ success: true, codes: promoManager.getAll() });
  });

  // ─── Admin: Create promo code ─────────────────────────────────────────────
  app.post("/api/admin/promo-codes", adminAuthMiddleware, requirePermission("plans"), (req, res) => {
    try {
      const code = promoManager.create(req.body);
      res.json({ success: true, code });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  // ─── Admin: Update promo code ─────────────────────────────────────────────
  app.put("/api/admin/promo-codes/:code", adminAuthMiddleware, requirePermission("plans"), (req, res) => {
    const updated = promoManager.update(req.params.code, req.body);
    if (!updated) return res.status(404).json({ success: false, error: "Promo code not found" });
    res.json({ success: true, code: updated });
  });

  // ─── Admin: Delete promo code ─────────────────────────────────────────────
  app.delete("/api/admin/promo-codes/:code", adminAuthMiddleware, requirePermission("plans"), (req, res) => {
    const ok = promoManager.delete(req.params.code);
    if (!ok) return res.status(404).json({ success: false, error: "Promo code not found" });
    res.json({ success: true });
  });

  // ─── Admin: Get all API keys ──────────────────────────────────────────────
  app.get("/api/admin/api-keys", adminAuthMiddleware, requirePermission("api-keys"), async (_req, res) => {
    try {
      const keys = await storage.getAllApiKeys();
      res.json({ success: true, keys });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ─── Admin: Generate API key ──────────────────────────────────────────────
  app.post("/api/admin/api-keys", adminAuthMiddleware, requirePermission("api-keys"), async (req, res) => {
    try {
      const { label, customerId } = req.body;
      if (!label) return res.status(400).json({ success: false, error: "Label is required" });
      const key = `ct_${uuidv4().replace(/-/g, "")}`;
      const apiKey = await storage.createApiKey({ key, label, customerId: customerId || undefined });
      res.json({ success: true, apiKey });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ─── Admin: Delete API key ────────────────────────────────────────────────
  app.delete("/api/admin/api-keys/:id", adminAuthMiddleware, requirePermission("api-keys"), async (req, res) => {
    try {
      await storage.deleteApiKey(parseInt(req.params.id));
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ─── Admin: Revoke API key ────────────────────────────────────────────────
  app.patch("/api/admin/api-keys/:id/revoke", adminAuthMiddleware, requirePermission("api-keys"), async (req, res) => {
    try {
      await storage.revokeApiKey(parseInt(req.params.id));
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // CUSTOMER AUTH ROUTES
  // ═══════════════════════════════════════════════════════════════════════════

  // ─── Customer: Register ───────────────────────────────────────────────────
  app.post("/api/auth/register", async (req, res) => {
    try {
      const { email, name, password, referralCode } = req.body;
      if (!email || !password) return res.status(400).json({ success: false, error: "Email and password are required" });
      if (password.length < 6) return res.status(400).json({ success: false, error: "Password must be at least 6 characters" });

      const existing = await storage.getCustomerByEmail(email);
      if (existing && existing.emailVerified) {
        return res.status(409).json({ success: false, error: "An account with this email already exists" });
      }

      const passwordHash = await bcrypt.hash(password, 10);
      const verificationCode = generateVerificationCode();
      const verificationExpiresDate = new Date(Date.now() + 15 * 60 * 1000);
      const verificationExpires = verificationExpiresDate.toISOString();

      if (existing && !existing.emailVerified) {
        await storage.updateCustomer(existing.id, { passwordHash, verificationCode, verificationExpires, name });
      } else {
        await storage.createCustomer({ email, name, passwordHash, verificationCode, verificationExpires: verificationExpiresDate });
      }

      if (referralCode && typeof referralCode === "string") {
        const referral = await storage.getReferralByCode(referralCode.trim().toUpperCase());
        if (referral && referral.status === "pending") {
          dbSettingsSet(`referral_pending_${email}`, referralCode.trim().toUpperCase());
        }
      }

      res.json({ success: true, message: "Verification code sent to your email" });
      sendVerificationEmail(email, verificationCode, name).catch(() => {});
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ─── Customer: Verify email ───────────────────────────────────────────────
  app.post("/api/auth/verify-email", async (req, res) => {
    try {
      const { email, code } = req.body;
      const customer = await storage.getCustomerByEmail(email);
      if (!customer) return res.status(404).json({ success: false, error: "Account not found" });
      if (customer.emailVerified) return res.status(400).json({ success: false, error: "Email already verified" });
      if (customer.verificationCode !== code) return res.status(400).json({ success: false, error: "Invalid verification code" });
      if (customer.verificationExpires && new Date(customer.verificationExpires) < new Date()) {
        return res.status(400).json({ success: false, error: "Verification code has expired. Please register again." });
      }

      await storage.updateCustomer(customer.id, { emailVerified: true, verificationCode: null, verificationExpires: null });

      const token = uuidv4();
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      await storage.createCustomerSession(customer.id, token, expiresAt);

      notifyNewCustomer({ name: customer.name || "", email: customer.email }).catch(() => {});

      res.json({ success: true, token, customer: { id: customer.id, email: customer.email, name: customer.name, avatarUrl: customer.avatarUrl || null } });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ─── Customer: Login ──────────────────────────────────────────────────────
  app.post("/api/auth/login", async (req, res) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) return res.status(400).json({ success: false, error: "Email and password are required" });

      const customer = await storage.getCustomerByEmail(email);
      if (!customer) return res.status(401).json({ success: false, error: "Invalid email or password" });
      if (!customer.emailVerified) return res.status(403).json({ success: false, error: "Please verify your email first", needsVerification: true, email });
      if (!customer.passwordHash) return res.status(401).json({ success: false, error: "Invalid account" });
      if (customer.suspended) return res.status(403).json({ success: false, error: "Your account has been suspended. Please contact support to resolve this.", suspended: true });

      const valid = await bcrypt.compare(password, customer.passwordHash);
      if (!valid) return res.status(401).json({ success: false, error: "Invalid email or password" });

      const token = uuidv4();
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      await storage.createCustomerSession(customer.id, token, expiresAt);

      // ─── Login IP & geo detection ─────────────────────────────────────
      const rawIp =
        (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
        req.socket?.remoteAddress ||
        "unknown";
      const userAgent = req.headers["user-agent"] || "";
      (async () => {
        try {
          let geoData: any = {};
          if (rawIp && rawIp !== "unknown" && rawIp !== "127.0.0.1" && !rawIp.startsWith("::")) {
            const geoRes = await fetch(`http://ip-api.com/json/${rawIp}?fields=status,country,countryCode,city,isp`);
            if (geoRes.ok) geoData = await geoRes.json();
          }
          await storage.createLoginLog(customer.id, {
            ip: rawIp,
            country: geoData.country,
            countryCode: geoData.countryCode,
            city: geoData.city,
            isp: geoData.isp,
            userAgent,
          });
        } catch (_) {}
      })();

      res.json({ success: true, token, customer: { id: customer.id, email: customer.email, name: customer.name, avatarUrl: customer.avatarUrl || null } });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ─── Customer: Forgot Password ────────────────────────────────────────────
  app.post("/api/auth/forgot-password", async (req, res) => {
    try {
      const { email } = req.body;
      if (!email) return res.status(400).json({ success: false, error: "Email is required" });

      const customer = await storage.getCustomerByEmail(email);
      if (!customer || !customer.emailVerified) {
        return res.json({ success: true, message: "If this email exists, a reset code has been sent" });
      }

      const code = generateVerificationCode();
      const expires = new Date(Date.now() + 15 * 60 * 1000).toISOString();
      await storage.updateCustomer(customer.id, { passwordResetCode: code, passwordResetExpires: expires });
      res.json({ success: true, message: "Reset code sent to your email" });
      sendPasswordResetEmail(email, code, customer.name || undefined).catch(() => {});
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ─── Customer: Reset Password ─────────────────────────────────────────────
  app.post("/api/auth/reset-password", async (req, res) => {
    try {
      const { email, code, newPassword } = req.body;
      if (!email || !code || !newPassword) {
        return res.status(400).json({ success: false, error: "Email, code, and new password are required" });
      }
      if (newPassword.length < 6) {
        return res.status(400).json({ success: false, error: "Password must be at least 6 characters" });
      }

      const customer = await storage.getCustomerByEmail(email);
      if (!customer || !customer.passwordResetCode) {
        return res.status(400).json({ success: false, error: "Invalid or expired reset code" });
      }
      if (customer.passwordResetCode !== code) {
        return res.status(400).json({ success: false, error: "Invalid reset code" });
      }
      if (customer.passwordResetExpires && new Date(customer.passwordResetExpires) < new Date()) {
        return res.status(400).json({ success: false, error: "Reset code has expired. Please request a new one." });
      }

      const passwordHash = await bcrypt.hash(newPassword, 10);
      await storage.updateCustomer(customer.id, {
        passwordHash,
        passwordResetCode: null,
        passwordResetExpires: null,
      });
      res.json({ success: true, message: "Password reset successfully" });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ─── Customer: Logout ─────────────────────────────────────────────────────
  app.post("/api/auth/logout", async (req, res) => {
    const auth = req.headers.authorization;
    if (auth) await storage.deleteCustomerSession(auth.replace("Bearer ", "")).catch(() => {});
    res.json({ success: true });
  });

  // ─── Customer: Me ─────────────────────────────────────────────────────────
  app.get("/api/auth/me", customerAuthMiddleware, (req: any, res) => {
    const c = req.customer;
    res.json({ success: true, customer: { id: c.id, email: c.email, name: c.name, avatarUrl: c.avatarUrl || null } });
  });

  // ─── Customer: Order history ──────────────────────────────────────────────
  app.get("/api/customer/orders", customerAuthMiddleware, async (req: any, res) => {
    try {
      const orders = await storage.getTransactionsByEmail(req.customer.email);
      res.json({ success: true, orders });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ─── Customer: Get my API keys ────────────────────────────────────────────
  app.get("/api/customer/api-keys", customerAuthMiddleware, async (req: any, res) => {
    try {
      const keys = await storage.getApiKeysByCustomer(req.customer.id);
      res.json({ success: true, keys });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ─── Customer: Generate API key ───────────────────────────────────────────
  app.post("/api/customer/api-keys", customerAuthMiddleware, async (req: any, res) => {
    try {
      const { label } = req.body;
      if (!label) return res.status(400).json({ success: false, error: "Label is required" });
      const existing = await storage.getApiKeysByCustomer(req.customer.id);
      if (existing.length >= 5) return res.status(400).json({ success: false, error: "Maximum 5 API keys allowed" });
      const key = `ct_${uuidv4().replace(/-/g, "")}`;
      const apiKey = await storage.createApiKey({ key, label, customerId: req.customer.id });
      res.json({ success: true, apiKey });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ─── Customer: Delete API key ─────────────────────────────────────────────
  app.delete("/api/customer/api-keys/:id", customerAuthMiddleware, async (req: any, res) => {
    try {
      const keys = await storage.getApiKeysByCustomer(req.customer.id);
      const key = keys.find((k) => k.id === parseInt(req.params.id));
      if (!key) return res.status(404).json({ success: false, error: "API key not found" });
      await storage.deleteApiKey(key.id);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ─── Customer: Update profile ─────────────────────────────────────────────
  app.put("/api/customer/profile", customerAuthMiddleware, async (req: any, res) => {
    try {
      const { name, currentPassword, newPassword } = req.body;
      const customer = req.customer;
      const updates: any = {};
      if (name && name.trim()) updates.name = name.trim();
      if (newPassword) {
        if (!currentPassword) return res.status(400).json({ success: false, error: "Current password is required to set a new password" });
        const valid = await bcrypt.compare(currentPassword, customer.passwordHash);
        if (!valid) return res.status(400).json({ success: false, error: "Current password is incorrect" });
        if (newPassword.length < 6) return res.status(400).json({ success: false, error: "New password must be at least 6 characters" });
        updates.passwordHash = await bcrypt.hash(newPassword, 10);
      }
      if (Object.keys(updates).length === 0) return res.status(400).json({ success: false, error: "No changes provided" });
      const updated = await storage.updateCustomer(customer.id, updates);
      res.json({ success: true, customer: { id: updated?.id, email: updated?.email, name: updated?.name } });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ─── Avatar upload setup ─────────────────────────────────────────────────
  const AVATARS_DIR = path.join(process.cwd(), "uploads", "avatars");
  if (!fs.existsSync(AVATARS_DIR)) fs.mkdirSync(AVATARS_DIR, { recursive: true });

  const avatarStorage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, AVATARS_DIR),
    filename: (req: any, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || ".jpg";
      cb(null, `${req.customer?.id || "admin"}-${Date.now()}${ext}`);
    },
  });
  const avatarUpload = multer({
    storage: avatarStorage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const allowed = ["image/jpeg", "image/png", "image/gif", "image/webp"];
      cb(null, allowed.includes(file.mimetype));
    },
  });

  // ─── Customer: Upload avatar ──────────────────────────────────────────────
  app.post("/api/customer/avatar", customerAuthMiddleware, (req: any, res) => {
    avatarUpload.single("avatar")(req, res, async (err) => {
      if (err) return res.status(400).json({ success: false, error: err.message || "Upload failed" });
      if (!req.file) return res.status(400).json({ success: false, error: "No image file provided" });
      try {
        const avatarUrl = `/uploads/avatars/${req.file.filename}`;
        // Remove old avatar file if present
        const customer = req.customer;
        if (customer.avatarUrl) {
          const oldPath = path.join(process.cwd(), customer.avatarUrl.replace(/^\//, ""));
          if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
        }
        const updated = await storage.updateCustomer(customer.id, { avatarUrl });
        res.json({ success: true, avatarUrl, customer: { id: updated?.id, email: updated?.email, name: updated?.name, avatarUrl: updated?.avatarUrl } });
      } catch (e: any) {
        res.status(500).json({ success: false, error: e.message });
      }
    });
  });

  // ─── Customer: Remove avatar ──────────────────────────────────────────────
  app.delete("/api/customer/avatar", customerAuthMiddleware, async (req: any, res) => {
    try {
      const customer = req.customer;
      if (customer.avatarUrl) {
        const oldPath = path.join(process.cwd(), customer.avatarUrl.replace(/^\//, ""));
        if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
      }
      const updated = await storage.updateCustomer(customer.id, { avatarUrl: null as any });
      res.json({ success: true, customer: { id: updated?.id, email: updated?.email, name: updated?.name, avatarUrl: null } });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // ─── Admin: Upload avatar for a customer ─────────────────────────────────
  app.post("/api/admin/customers/:id/avatar", adminAuthMiddleware, (req: any, res) => {
    avatarUpload.single("avatar")(req, res, async (err) => {
      if (err) return res.status(400).json({ success: false, error: err.message || "Upload failed" });
      if (!req.file) return res.status(400).json({ success: false, error: "No image file provided" });
      try {
        const customerId = parseInt(req.params.id);
        const customer = await storage.getCustomerById(customerId);
        if (!customer) return res.status(404).json({ success: false, error: "Customer not found" });
        if (customer.avatarUrl) {
          const oldPath = path.join(process.cwd(), customer.avatarUrl.replace(/^\//, ""));
          if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
        }
        const avatarUrl = `/uploads/avatars/${req.file.filename}`;
        const updated = await storage.updateCustomer(customerId, { avatarUrl });
        res.json({ success: true, avatarUrl, customer: { id: updated?.id, email: updated?.email, avatarUrl: updated?.avatarUrl } });
      } catch (e: any) {
        res.status(500).json({ success: false, error: e.message });
      }
    });
  });

  // ─── Admin: Remove avatar for a customer ─────────────────────────────────
  app.delete("/api/admin/customers/:id/avatar", adminAuthMiddleware, async (req, res) => {
    try {
      const customerId = parseInt(req.params.id);
      const customer = await storage.getCustomerById(customerId);
      if (!customer) return res.status(404).json({ success: false, error: "Customer not found" });
      if (customer.avatarUrl) {
        const oldPath = path.join(process.cwd(), customer.avatarUrl.replace(/^\//, ""));
        if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
      }
      await storage.updateCustomer(customerId, { avatarUrl: null as any });
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // ─── Customer: View order credentials ────────────────────────────────────
  app.get("/api/customer/orders/:reference/credentials", customerAuthMiddleware, async (req: any, res) => {
    try {
      const tx = await storage.getTransaction(req.params.reference);
      if (!tx) return res.status(404).json({ success: false, error: "Order not found" });
      if (tx.customerEmail !== req.customer.email) return res.status(403).json({ success: false, error: "Access denied" });
      if (tx.status !== "success") return res.status(400).json({ success: false, error: "No credentials for this order" });
      const account = accountManager.findAccountByCustomer(tx.planId, req.customer.email);
      if (!account) return res.status(404).json({ success: false, error: "Account credentials not found. Please contact support." });
      res.json({ success: true, account: {
        email: account.email || "",
        username: account.username || "",
        password: account.password || "",
        activationCode: account.activationCode || "",
        redeemLink: account.redeemLink || "",
        instructions: account.instructions || "",
      }});
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ─── Customer: Setup TOTP (generate QR) ──────────────────────────────────
  app.post("/api/customer/setup-totp", customerAuthMiddleware, async (req: any, res) => {
    try {
      const secret = speakeasy.generateSecret({ name: `Chege Tech (${req.customer.email})`, length: 20 });
      const qrCodeDataUrl = await QRCode.toDataURL(secret.otpauth_url!);
      res.json({ success: true, secret: secret.base32, qrCodeDataUrl });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ─── Customer: Verify and save TOTP ──────────────────────────────────────
  app.post("/api/customer/verify-totp", customerAuthMiddleware, async (req: any, res) => {
    try {
      const { secret, code } = req.body;
      if (!secret || !code) return res.status(400).json({ success: false, error: "Secret and code required" });
      const valid = speakeasy.totp.verify({ secret, encoding: "base32", token: code, window: 2 });
      if (!valid) return res.status(400).json({ success: false, error: "Invalid code. Please try again." });
      await storage.updateCustomer(req.customer.id, { totpSecret: secret, totpEnabled: true });
      res.json({ success: true, message: "2FA enabled successfully" });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ─── Customer: Disable TOTP ───────────────────────────────────────────────
  app.delete("/api/customer/disable-totp", customerAuthMiddleware, async (req: any, res) => {
    try {
      await storage.updateCustomer(req.customer.id, { totpSecret: null, totpEnabled: false });
      res.json({ success: true, message: "2FA disabled" });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ─── Customer: TOTP status ────────────────────────────────────────────────
  app.get("/api/customer/totp-status", customerAuthMiddleware, async (req: any, res) => {
    res.json({ success: true, totpEnabled: req.customer.totpEnabled ?? false });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // APP CONFIG ROUTES
  // ═══════════════════════════════════════════════════════════════════════════

  // ─── Public: Get app config (non-sensitive) ───────────────────────────────
  app.get("/api/app-config", (_req, res) => {
    const config = getAppConfig();
    res.json({ success: true, config: {
      siteName: config.siteName,
      whatsappNumber: config.whatsappNumber,
      whatsappChannel: config.whatsappChannel,
      supportEmail: config.supportEmail,
      chatAssistantEnabled: config.chatAssistantEnabled,
    }});
  });

  // ─── Admin: Get full app config ───────────────────────────────────────────
  app.get("/api/admin/app-config", adminAuthMiddleware, (_req, res) => {
    res.json({ success: true, config: getAppConfig() });
  });

  // ─── Admin: Save app config ───────────────────────────────────────────────
  app.put("/api/admin/app-config", adminAuthMiddleware, (req, res) => {
    try {
      const updated = saveAppConfig(req.body);
      res.json({ success: true, config: updated });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ADMIN CUSTOMER MANAGEMENT ROUTES
  // ═══════════════════════════════════════════════════════════════════════════

  // ─── Admin: Get all customers ─────────────────────────────────────────────
  app.get("/api/admin/customers", adminAuthMiddleware, requirePermission("customers"), async (_req, res) => {
    try {
      const all = await storage.getAllCustomers();
      const safeList = all.map((c) => ({
        id: c.id,
        email: c.email,
        name: c.name,
        emailVerified: c.emailVerified,
        suspended: c.suspended,
        totpEnabled: c.totpEnabled,
        avatarUrl: c.avatarUrl || null,
        createdAt: c.createdAt,
      }));
      res.json({ success: true, customers: safeList });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ─── Admin: Suspend / unsuspend customer ──────────────────────────────────
  app.patch("/api/admin/customers/:id/suspend", adminAuthMiddleware, requirePermission("customers"), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const newSuspended = req.body.suspended === true;
      const reason = typeof req.body.reason === "string" ? req.body.reason.trim() : undefined;
      const customer = await storage.getCustomerById(id);
      if (!customer) return res.status(404).json({ success: false, error: "Customer not found" });
      if (customer.suspended === newSuspended) return res.json({ success: true, unchanged: true });
      await storage.updateCustomer(id, { suspended: newSuspended });
      if (newSuspended) {
        sendSuspensionEmail(customer.email, customer.name || undefined, reason).catch(() => {});
      } else {
        sendUnsuspensionEmail(customer.email, customer.name || undefined).catch(() => {});
      }
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ─── Admin: Manually verify customer email ──────────────────────────────
  app.patch("/api/admin/customers/:id/verify", adminAuthMiddleware, requirePermission("customers"), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const customer = await storage.getCustomerById(id);
      if (!customer) return res.status(404).json({ success: false, error: "Customer not found" });
      await storage.updateCustomer(id, {
        emailVerified: true,
        verificationCode: null,
        verificationExpires: null,
      });
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ─── Admin: Send bulk email ──────────────────────────────────────────────
  app.post("/api/admin/email-blast", adminAuthMiddleware, requirePermission("customers"), async (req, res) => {
    try {
      const { subject, content, recipients, filter } = req.body;
      if (!subject || !content) return res.status(400).json({ success: false, error: "Subject and content are required" });

      let emailList: string[] = [];

      if (recipients && Array.isArray(recipients) && recipients.length > 0) {
        emailList = recipients;
      } else {
        const allCustomers = await storage.getAllCustomers();
        if (filter === "verified") {
          emailList = allCustomers.filter((c: any) => c.emailVerified && !c.suspended).map((c: any) => c.email);
        } else if (filter === "suspended") {
          emailList = allCustomers.filter((c: any) => c.suspended).map((c: any) => c.email);
        } else {
          emailList = allCustomers.filter((c: any) => c.emailVerified).map((c: any) => c.email);
        }
      }

      if (emailList.length === 0) return res.status(400).json({ success: false, error: "No recipients found" });
      if (emailList.length > 500) return res.status(400).json({ success: false, error: "Maximum 500 recipients per blast" });

      const uniqueEmails = Array.from(new Set(emailList.map((e: string) => e.toLowerCase().trim()))).filter(Boolean);

      const htmlContent = content
        .replace(/\n/g, "<br>")
        .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");

      const result = await sendBulkEmail(uniqueEmails, subject, htmlContent);
      logAdminAction({ action: "Bulk email sent", category: "settings", details: `Subject: "${subject}" — Sent: ${result.sent}, Failed: ${result.failed}`, status: result.failed > 0 ? "warning" : "success" });
      const success = result.sent > 0;
      res.json({ success, sent: result.sent, failed: result.failed, total: uniqueEmails.length, errors: result.errors.slice(0, 5) });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ─── Admin: Delete customer ───────────────────────────────────────────────
  app.delete("/api/admin/customers/:id", adminAuthMiddleware, requirePermission("customers"), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.updateCustomer(id, { suspended: true });
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.get("/api/admin/customers/:id/login-history", adminAuthMiddleware, requirePermission("customers"), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const logs = await storage.getLoginLogs(id);
      res.json({ success: true, logs });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // CREDENTIALS OVERRIDE ROUTES
  // ═══════════════════════════════════════════════════════════════════════════

  // ─── Admin: Get credentials (masked) ─────────────────────────────────────
  app.get("/api/admin/credentials", adminAuthMiddleware, superAdminOnly, (_req, res) => {
    const override = getCredentialsOverride();
    const status = getSecretsStatus();
    res.json({
      success: true,
      credentials: {
        paystackPublicKey: override.paystackPublicKey || "",
        paystackSecretKey: override.paystackSecretKey ? "••••••••••••••••" : "",
        paystackSecretKeySet: !!override.paystackSecretKey,
        emailUser: override.emailUser || "",
        emailPass: override.emailPass ? "••••••••••••••••" : "",
        emailPassSet: !!override.emailPass,
        adminEmail: override.adminEmail || "",
        adminPassword: override.adminPassword ? "••••••••••••••••" : "",
        adminPasswordSet: !!override.adminPassword,
        telegramBotToken: override.telegramBotToken ? "••••••••••••••••" : "",
        telegramBotTokenSet: !!override.telegramBotToken,
        telegramChatId: override.telegramChatId || "",
        whatsappAccessToken: override.whatsappAccessToken ? "••••••••••••••••" : "",
        whatsappAccessTokenSet: !!override.whatsappAccessToken,
        whatsappPhoneId: override.whatsappPhoneId || "",
        whatsappVerifyToken: override.whatsappVerifyToken || "",
        whatsappAdminPhone: override.whatsappAdminPhone || "",
        openaiApiKey: override.openaiApiKey ? "••••••••••••••••" : "",
        openaiApiKeySet: !!override.openaiApiKey,
        externalDatabaseUrl: override.externalDatabaseUrl ? "••••••••••••••••" : "",
        externalDatabaseUrlSet: !!override.externalDatabaseUrl,
      },
      effective: {
        paystackPublicKey: status.paystackPublicKey,
        paystackConfigured: status.paystackConfigured,
        emailUser: status.emailUser,
        emailConfigured: status.emailConfigured,
        telegramConfigured: isTelegramConfigured(),
        whatsappConfigured: isWhatsAppWebConnected(),
        openaiApiKeySet: !!(override.openaiApiKey || process.env.OPENAI_API_KEY),
      },
      sourceOverride: {
        ...status.sourceOverride,
        telegramBotToken: !!override.telegramBotToken,
        telegramChatId: !!override.telegramChatId,
        whatsappAccessToken: !!override.whatsappAccessToken,
        whatsappPhoneId: !!override.whatsappPhoneId,
        openaiApiKey: !!override.openaiApiKey,
        externalDatabaseUrl: !!override.externalDatabaseUrl,
      },
      envVarSet: {
        paystackPublicKey: !!process.env.PAYSTACK_PUBLIC_KEY,
        paystackSecretKey: !!process.env.PAYSTACK_SECRET_KEY,
        emailUser: !!process.env.EMAIL_USER,
        emailPass: !!process.env.EMAIL_PASS,
        adminEmail: !!process.env.ADMIN_EMAIL,
        adminPassword: !!process.env.ADMIN_PASSWORD,
        telegramBotToken: !!process.env.TELEGRAM_BOT_TOKEN,
        telegramChatId: !!process.env.TELEGRAM_CHAT_ID,
        whatsappAccessToken: !!process.env.WHATSAPP_ACCESS_TOKEN,
        whatsappPhoneId: !!process.env.WHATSAPP_PHONE_ID,
        openaiApiKey: !!process.env.OPENAI_API_KEY,
        externalDatabaseUrl: !!process.env.EXTERNAL_DATABASE_URL,
      },
    });
  });

  // ─── Admin: Save credentials ──────────────────────────────────────────────
  app.put("/api/admin/credentials", adminAuthMiddleware, superAdminOnly, (req, res) => {
    try {
      const { paystackPublicKey, paystackSecretKey, emailUser, emailPass, adminEmail, adminPassword, telegramBotToken, telegramChatId,
        whatsappAccessToken, whatsappPhoneId, whatsappVerifyToken, whatsappAdminPhone, openaiApiKey, externalDatabaseUrl } = req.body;
      const toSave: Record<string, string | undefined> = {};
      if (paystackPublicKey !== undefined) toSave.paystackPublicKey = paystackPublicKey || undefined;
      if (paystackSecretKey !== undefined && paystackSecretKey !== "••••••••••••••••") toSave.paystackSecretKey = paystackSecretKey || undefined;
      if (emailUser !== undefined) toSave.emailUser = emailUser || undefined;
      if (emailPass !== undefined && emailPass !== "••••••••••••••••") toSave.emailPass = emailPass || undefined;
      if (adminEmail !== undefined) toSave.adminEmail = adminEmail || undefined;
      if (adminPassword !== undefined && adminPassword !== "••••••••••••••••") toSave.adminPassword = adminPassword || undefined;
      if (telegramBotToken !== undefined && telegramBotToken !== "••••••••••••••••") toSave.telegramBotToken = telegramBotToken || undefined;
      if (telegramChatId !== undefined) toSave.telegramChatId = telegramChatId || undefined;
      if (whatsappAccessToken !== undefined && whatsappAccessToken !== "••••••••••••••••") toSave.whatsappAccessToken = whatsappAccessToken || undefined;
      if (whatsappPhoneId !== undefined) toSave.whatsappPhoneId = whatsappPhoneId || undefined;
      if (whatsappVerifyToken !== undefined) toSave.whatsappVerifyToken = whatsappVerifyToken || undefined;
      if (whatsappAdminPhone !== undefined) toSave.whatsappAdminPhone = whatsappAdminPhone || undefined;
      if (openaiApiKey !== undefined && openaiApiKey !== "••••••••••••••••") toSave.openaiApiKey = openaiApiKey || undefined;
      if (externalDatabaseUrl !== undefined && externalDatabaseUrl !== "••••••••••••••••") toSave.externalDatabaseUrl = externalDatabaseUrl || undefined;

      saveCredentialsOverride(toSave);
      logAdminAction({ action: "Credentials updated", category: "settings", details: `Updated: ${Object.keys(toSave).join(", ")}`, status: "success" });
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ─── Admin: WhatsApp Web Status ───────────────────────────────────────────
  app.get("/api/admin/whatsapp/status", adminAuthMiddleware, (_req, res) => {
    res.json({ success: true, ...getWhatsAppStatus() });
  });

  // ─── Admin: WhatsApp Web Connect ──────────────────────────────────────────
  app.post("/api/admin/whatsapp/connect", adminAuthMiddleware, async (req, res) => {
    const { phoneNumber } = req.body;
    try {
      await connectWhatsApp(phoneNumber);
      logAdminAction({ action: "WhatsApp connection initiated", category: "settings", details: `Phone: ${phoneNumber}`, status: "success" });
      res.json({ success: true, message: "Connecting... scan the QR code or use the pairing code." });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ─── Admin: WhatsApp Web Disconnect ──────────────────────────────────────
  app.post("/api/admin/whatsapp/disconnect", adminAuthMiddleware, async (_req, res) => {
    try {
      await disconnectWhatsApp();
      logAdminAction({ action: "WhatsApp disconnected", category: "settings", details: "Admin triggered disconnect", status: "warning" });
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ─── Admin: WhatsApp Web Send Test ───────────────────────────────────────
  app.post("/api/admin/whatsapp/test", adminAuthMiddleware, async (_req, res) => {
    if (!isWhatsAppWebConnected()) {
      return res.status(400).json({ success: false, error: "WhatsApp not connected — scan QR code first" });
    }
    const override = getCredentialsOverride();
    const adminPhone = override.whatsappAdminPhone || "";
    if (!adminPhone) {
      return res.status(400).json({ success: false, error: "Set your admin WhatsApp number first" });
    }
    try {
      await sendWhatsAppNotification(adminPhone, "✅ *Chege Tech WhatsApp Bot is active!*\n\nYou will receive order notifications here.");
      logAdminAction({ action: "WhatsApp test message sent", category: "settings", details: `Sent to: ${adminPhone}`, status: "success" });
      res.json({ success: true, message: "Test message sent! Check your WhatsApp." });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ─── Admin: Test Telegram ─────────────────────────────────────────────────
  app.post("/api/admin/telegram/test", adminAuthMiddleware, async (_req, res) => {
    if (!isTelegramConfigured()) {
      return res.status(400).json({ success: false, error: "Telegram not configured — add Bot Token and Chat ID first" });
    }
    const result = await sendTelegramMessage(`✅ <b>Chege Tech Telegram Connected!</b>\n\nAdmin notifications are now active. You'll receive alerts for new orders, registrations, and low stock.`);
    if (result.success) {
      logAdminAction({ action: "Telegram test message sent", category: "settings", details: "Admin triggered test notification", status: "success" });
      res.json({ success: true, message: "Test message sent! Check your Telegram." });
    } else {
      res.status(400).json({ success: false, error: result.error });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SUB-ADMIN MANAGEMENT (super admin only)
  // ═══════════════════════════════════════════════════════════════════════════

  app.get("/api/admin/subadmins", adminAuthMiddleware, superAdminOnly, async (_req, res) => {
    try {
      const subAdmins = await storage.getAllSubAdmins();
      res.json({ success: true, subAdmins: subAdmins.map(sa => ({ ...sa, passwordHash: undefined })) });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post("/api/admin/subadmins", adminAuthMiddleware, superAdminOnly, async (req, res) => {
    try {
      const { email, name, password, permissions } = req.body;
      if (!email || !password) return res.status(400).json({ success: false, error: "Email and password are required" });
      if (password.length < 6) return res.status(400).json({ success: false, error: "Password must be at least 6 characters" });

      const existing = await storage.getSubAdminByEmail(email);
      if (existing) return res.status(409).json({ success: false, error: "A sub-admin with this email already exists" });

      const creds = getAdminCredentials();
      if (email === creds.email) return res.status(400).json({ success: false, error: "Cannot create sub-admin with the super admin email" });

      const passwordHash = await bcrypt.hash(password, 10);
      const subAdmin = await storage.createSubAdmin({ email, name, passwordHash, permissions: permissions || [] });
      logAdminAction({ action: `Sub-admin created: ${email}`, category: "settings", details: `Name: ${name || "—"}, permissions: ${(permissions || []).join(", ") || "none"}`, status: "success" });
      res.json({ success: true, subAdmin: { ...subAdmin, passwordHash: undefined } });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.put("/api/admin/subadmins/:id", adminAuthMiddleware, superAdminOnly, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { name, password, permissions, active } = req.body;
      const updateData: any = {};
      if (name !== undefined) updateData.name = name;
      if (password && password.length >= 6) updateData.passwordHash = await bcrypt.hash(password, 10);
      if (permissions !== undefined) updateData.permissions = permissions;
      if (active !== undefined) updateData.active = active;

      const updated = await storage.updateSubAdmin(id, updateData);
      if (!updated) return res.status(404).json({ success: false, error: "Sub-admin not found" });
      logAdminAction({ action: `Sub-admin updated: ${updated.email}`, category: "settings", details: `ID: ${id}`, status: "success" });
      res.json({ success: true, subAdmin: { ...updated, passwordHash: undefined } });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.delete("/api/admin/subadmins/:id", adminAuthMiddleware, superAdminOnly, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const subAdmin = await storage.getSubAdminById(id);
      if (!subAdmin) return res.status(404).json({ success: false, error: "Sub-admin not found" });
      await storage.deleteSubAdmin(id);
      logAdminAction({ action: `Sub-admin deleted: ${subAdmin.email}`, category: "settings", details: `ID: ${id}`, status: "warning" });
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ADMIN LOGS ROUTES
  // ═══════════════════════════════════════════════════════════════════════════

  // ─── Admin: Get logs ──────────────────────────────────────────────────────
  app.get("/api/admin/logs", adminAuthMiddleware, requirePermission("logs"), (req, res) => {
    const limit = parseInt(req.query.limit as string) || 100;
    const category = req.query.category as string | undefined;
    const logs = getAdminLogs(limit, category);
    res.json({ success: true, logs });
  });

  // ─── Admin: Clear logs ────────────────────────────────────────────────────
  app.delete("/api/admin/logs", adminAuthMiddleware, requirePermission("logs"), (req, res) => {
    try {
      const fs = require("fs");
      const path = require("path");
      const LOG_FILE = path.join(process.cwd(), "admin-logs.json");
      fs.writeFileSync(LOG_FILE, "[]");
      logAdminAction({ action: "Admin logs cleared", category: "settings", details: "All logs deleted", status: "warning" });
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SUPPORT TICKET ROUTES (Customer-facing)
  // ═══════════════════════════════════════════════════════════════════════════

  app.post("/api/support/ticket", async (req, res) => {
    try {
      const { customerEmail, customerName, subject } = req.body;
      if (!customerEmail) return res.status(400).json({ success: false, error: "Customer email is required" });
      const ticket = await storage.createTicket({ customerEmail, customerName, subject });
      res.json({ success: true, ticket });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post("/api/support/ticket/:id/message", async (req, res) => {
    try {
      const ticketId = parseInt(req.params.id);
      const { message, token, sender: senderHint } = req.body;
      if (!message) return res.status(400).json({ success: false, error: "Message is required" });
      if (!token) return res.status(401).json({ success: false, error: "Ticket token is required" });
      const ticket = await storage.getTicketById(ticketId);
      if (!ticket || ticket.token !== token) return res.status(403).json({ success: false, error: "Invalid ticket token" });
      const sender = senderHint === "ai" ? "ai" : "customer";
      const msg = await storage.addMessage({ ticketId, sender, message });
      res.json({ success: true, message: msg });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.get("/api/support/ticket/:id/messages", async (req, res) => {
    try {
      const ticketId = parseInt(req.params.id);
      const token = req.query.token as string;
      if (!token) return res.status(401).json({ success: false, error: "Ticket token is required" });
      const ticket = await storage.getTicketById(ticketId);
      if (!ticket || ticket.token !== token) return res.status(403).json({ success: false, error: "Invalid ticket token" });
      const messages = await storage.getMessages(ticketId);
      res.json({ success: true, messages });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post("/api/support/ticket/:id/escalate", async (req, res) => {
    try {
      const ticketId = parseInt(req.params.id);
      const { token } = req.body;
      if (!token) return res.status(401).json({ success: false, error: "Ticket token is required" });
      const ticket = await storage.getTicketById(ticketId);
      if (!ticket || ticket.token !== token) return res.status(403).json({ success: false, error: "Invalid ticket token" });
      await storage.updateTicket(ticketId, { status: "escalated" });
      const messages = await storage.getMessages(ticketId);
      notifySupportEscalation({
        ticketId,
        customerName: ticket.customerName || "Unknown",
        customerEmail: ticket.customerEmail,
        subject: ticket.subject || "Support Request",
        recentMessages: messages.map((m) => ({ sender: m.sender, message: m.message })),
      }).catch(() => {});
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ADMIN SUPPORT TICKET ROUTES
  // ═══════════════════════════════════════════════════════════════════════════

  app.get("/api/admin/support/tickets", adminAuthMiddleware, requirePermission("support"), async (_req, res) => {
    try {
      const tickets = await storage.getOpenTickets();
      res.json({ success: true, tickets });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.get("/api/admin/support/ticket/:id/messages", adminAuthMiddleware, requirePermission("support"), async (req, res) => {
    try {
      const ticketId = parseInt(req.params.id);
      const ticket = await storage.getTicketById(ticketId);
      if (!ticket) return res.status(404).json({ success: false, error: "Ticket not found" });
      const messages = await storage.getMessages(ticketId);
      res.json({ success: true, messages });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post("/api/admin/support/ticket/:id/message", adminAuthMiddleware, requirePermission("support"), async (req, res) => {
    try {
      const ticketId = parseInt(req.params.id);
      const { message } = req.body;
      if (!message) return res.status(400).json({ success: false, error: "Message is required" });
      const ticket = await storage.getTicketById(ticketId);
      if (!ticket) return res.status(404).json({ success: false, error: "Ticket not found" });
      const msg = await storage.addMessage({ ticketId, sender: "admin", message });
      // Notify customer of admin reply
      try {
        const customer = await storage.getCustomerByEmail(ticket.customerEmail);
        if (customer) {
          await storage.createNotification(customer.id, "ticket", "Support Reply 💬", `Your ticket #${ticketId} received a reply from our team.`);
        }
      } catch (_) {}
      res.json({ success: true, message: msg });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.patch("/api/admin/support/ticket/:id/close", adminAuthMiddleware, requirePermission("support"), async (req, res) => {
    try {
      const ticketId = parseInt(req.params.id);
      const ticket = await storage.getTicketById(ticketId);
      if (!ticket) return res.status(404).json({ success: false, error: "Ticket not found" });
      await storage.updateTicket(ticketId, { status: "closed" });
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // API KEY AUTHENTICATED ENDPOINTS (v1)
  // ═══════════════════════════════════════════════════════════════════════════

  async function apiKeyAuthMiddleware(req: any, res: any, next: any) {
    const key = req.headers["x-api-key"];
    if (!key) return res.status(401).json({ error: "Missing X-API-Key header" });
    const apiKey = await storage.getApiKeyByKey(key);
    if (!apiKey) return res.status(401).json({ error: "Invalid API key" });
    if (!apiKey.active) return res.status(403).json({ error: "API key has been revoked" });
    req.apiKey = apiKey;
    if (apiKey.customerId) {
      const customer = await storage.getCustomerById(apiKey.customerId);
      if (!customer) return res.status(403).json({ error: "Linked customer account not found" });
      if (customer.suspended) return res.status(403).json({ error: "Account suspended. Contact support." });
      req.customer = customer;
    }
    next();
  }

  // ─── Customer API: My Profile ──────────────────────────────────────────
  app.get("/api/v1/my-profile", apiKeyAuthMiddleware, async (req: any, res) => {
    if (!req.customer) return res.status(403).json({ error: "This API key is not linked to a customer" });
    const c = req.customer;
    res.json({ id: c.id, email: c.email, name: c.name, emailVerified: c.emailVerified, createdAt: c.createdAt });
  });

  // ─── Customer API: My Orders ──────────────────────────────────────────
  app.get("/api/v1/my-orders", apiKeyAuthMiddleware, async (req: any, res) => {
    if (!req.customer) return res.status(403).json({ error: "This API key is not linked to a customer" });
    const orders = await storage.getTransactionsByEmail(req.customer.email);
    res.json({
      count: orders.length,
      orders: orders.map((o: any) => ({
        reference: o.reference, plan: o.planName, amount: o.amount, status: o.status,
        accountAssigned: o.accountAssigned, emailSent: o.emailSent, createdAt: o.createdAt,
      })),
    });
  });

  // ─── Admin API: Transactions ──────────────────────────────────────────
  app.get("/api/v1/admin/transactions", apiKeyAuthMiddleware, async (req: any, res) => {
    if (req.apiKey.customerId) return res.status(403).json({ error: "Admin API key required (no customer linked)" });
    const all = await storage.getAllTransactions();
    res.json({
      count: all.length,
      transactions: all.map((t: any) => ({
        reference: t.reference, customerEmail: t.customerEmail, plan: t.planName,
        amount: t.amount, status: t.status, accountAssigned: t.accountAssigned,
        emailSent: t.emailSent, createdAt: t.createdAt,
      })),
    });
  });

  // ─── Admin API: Stats ─────────────────────────────────────────────────
  app.get("/api/v1/admin/stats", apiKeyAuthMiddleware, async (req: any, res) => {
    if (req.apiKey.customerId) return res.status(403).json({ error: "Admin API key required (no customer linked)" });
    const stats = await storage.getStats();
    res.json(stats);
  });

  // ─── Admin API: Customers ─────────────────────────────────────────────
  app.get("/api/v1/admin/customers", apiKeyAuthMiddleware, async (req: any, res) => {
    if (req.apiKey.customerId) return res.status(403).json({ error: "Admin API key required (no customer linked)" });
    const customers = await storage.getAllCustomers();
    res.json({
      count: customers.length,
      customers: customers.map((c: any) => ({
        id: c.id, email: c.email, name: c.name, emailVerified: c.emailVerified, createdAt: c.createdAt,
      })),
    });
  });

  // ─── Customer: Support Tickets ───────────────────────────────────────
  app.get("/api/customer/tickets", customerAuthMiddleware, async (req: any, res) => {
    try {
      const tickets = await storage.getTicketsByEmail(req.customer.email);
      res.json({ success: true, tickets });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.get("/api/customer/tickets/:id/messages", customerAuthMiddleware, async (req: any, res) => {
    try {
      const ticketId = parseInt(req.params.id);
      const ticket = await storage.getTicketById(ticketId);
      if (!ticket || ticket.customerEmail !== req.customer.email) {
        return res.status(403).json({ success: false, error: "Ticket not found" });
      }
      const messages = await storage.getMessages(ticketId);
      res.json({ success: true, ticket, messages });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post("/api/customer/tickets", customerAuthMiddleware, async (req: any, res) => {
    try {
      const { subject, message } = req.body;
      if (!message) return res.status(400).json({ success: false, error: "Message is required" });
      const ticket = await storage.createTicket({
        customerEmail: req.customer.email,
        customerName: req.customer.name || undefined,
        subject: subject || "Support Request",
      });
      await storage.addMessage({ ticketId: ticket.id, sender: "customer", message });
      res.json({ success: true, ticket });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post("/api/customer/tickets/:id/reply", customerAuthMiddleware, async (req: any, res) => {
    try {
      const ticketId = parseInt(req.params.id);
      const ticket = await storage.getTicketById(ticketId);
      if (!ticket || ticket.customerEmail !== req.customer.email) {
        return res.status(403).json({ success: false, error: "Ticket not found" });
      }
      const { message } = req.body;
      if (!message) return res.status(400).json({ success: false, error: "Message is required" });
      const msg = await storage.addMessage({ ticketId, sender: "customer", message });
      res.json({ success: true, message: msg });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // COUNTRY RESTRICTIONS ROUTES
  // ═══════════════════════════════════════════════════════════════════════════

  app.get("/api/admin/country-restrictions", adminAuthMiddleware, superAdminOnly, (_req, res) => {
    res.json({ success: true, config: countryRestrictions.get() });
  });

  app.put("/api/admin/country-restrictions", adminAuthMiddleware, superAdminOnly, (req, res) => {
    try {
      const { mode, countries } = req.body;
      if (mode) countryRestrictions.setMode(mode);
      if (Array.isArray(countries)) countryRestrictions.setCountries(countries);
      res.json({ success: true, config: countryRestrictions.get() });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post("/api/admin/country-restrictions/add", adminAuthMiddleware, superAdminOnly, (req, res) => {
    try {
      const { code } = req.body;
      if (!code) return res.status(400).json({ success: false, error: "Country code required" });
      countryRestrictions.addCountry(code);
      res.json({ success: true, config: countryRestrictions.get() });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.delete("/api/admin/country-restrictions/:code", adminAuthMiddleware, superAdminOnly, (req, res) => {
    try {
      countryRestrictions.removeCountry(req.params.code);
      res.json({ success: true, config: countryRestrictions.get() });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // VPS MANAGEMENT ROUTES
  // ═══════════════════════════════════════════════════════════════════════════

  app.get("/api/admin/vps", adminAuthMiddleware, superAdminOnly, (_req, res) => {
    const servers = vpsManager.getAll().map((s) => ({ ...s, password: s.password ? "***" : undefined, privateKey: s.privateKey ? "***" : undefined }));
    res.json({ success: true, servers });
  });

  app.post("/api/admin/vps", adminAuthMiddleware, superAdminOnly, (req, res) => {
    try {
      const { label, host, port, username, authType, password, privateKey } = req.body;
      if (!host || !username) return res.status(400).json({ success: false, error: "Host and username are required" });
      const server = vpsManager.add({ label: label || host, host, port: parseInt(port) || 22, username, authType: authType || "password", password, privateKey });
      res.json({ success: true, server: { ...server, password: server.password ? "***" : undefined, privateKey: server.privateKey ? "***" : undefined } });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.put("/api/admin/vps/:id", adminAuthMiddleware, superAdminOnly, (req, res) => {
    try {
      const server = vpsManager.update(req.params.id, req.body);
      if (!server) return res.status(404).json({ success: false, error: "Server not found" });
      res.json({ success: true, server: { ...server, password: server.password ? "***" : undefined, privateKey: server.privateKey ? "***" : undefined } });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.delete("/api/admin/vps/:id", adminAuthMiddleware, superAdminOnly, (req, res) => {
    try {
      const deleted = vpsManager.delete(req.params.id);
      if (!deleted) return res.status(404).json({ success: false, error: "Server not found" });
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post("/api/admin/vps/:id/reboot", adminAuthMiddleware, superAdminOnly, async (req, res) => {
    try {
      const result = await vpsManager.reboot(req.params.id);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  app.get("/api/admin/vps/:id/ping", adminAuthMiddleware, superAdminOnly, async (req, res) => {
    try {
      const result = await vpsManager.ping(req.params.id);
      res.json({ success: true, ping: result });
    } catch (err: any) {
      res.status(500).json({ success: false });
    }
  });

  app.post("/api/admin/vps/:id/exec", adminAuthMiddleware, superAdminOnly, async (req, res) => {
    try {
      const server = vpsManager.getById(req.params.id);
      if (!server) return res.status(404).json({ success: false, error: "Server not found" });
      const { command } = req.body;
      if (!command) return res.status(400).json({ success: false, error: "Command required" });
      const result = await vpsManager.execCommand(server, command);
      res.json({ success: true, ...result });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ─── Customer: Wallet ────────────────────────────────────────────────
  app.get("/api/customer/wallet", customerAuthMiddleware, async (req: any, res) => {
    try {
      const customerId = req.customer.id;
      const wallet = await storage.getWallet(customerId);
      const transactions = await storage.getWalletTransactions(customerId);
      res.json({ success: true, balance: wallet.balance, transactions });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ─── Customer: Notifications ─────────────────────────────────────────
  app.get("/api/customer/notifications", customerAuthMiddleware, async (req: any, res) => {
    try {
      const notifications = await storage.getNotifications(req.customer.id);
      const unread = notifications.filter((n: any) => !n.read).length;
      res.json({ success: true, notifications, unread });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.put("/api/customer/notifications/read", customerAuthMiddleware, async (req: any, res) => {
    try {
      await storage.markNotificationsRead(req.customer.id);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ─── Customer: Spending Stats ─────────────────────────────────────────
  app.get("/api/customer/stats", customerAuthMiddleware, async (req: any, res) => {
    try {
      const stats = await storage.getCustomerSpendingStats(req.customer.email);
      res.json({ success: true, ...stats });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ─── Customer: Login History ──────────────────────────────────────────
  app.get("/api/customer/login-history", customerAuthMiddleware, async (req: any, res) => {
    try {
      const logs = await storage.getLoginLogs(req.customer.id);
      res.json({ success: true, logs });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ─── Customer: Referral ───────────────────────────────────────────────
  app.get("/api/customer/referral", customerAuthMiddleware, async (req: any, res) => {
    try {
      const customerId = req.customer.id;
      let referral = await storage.getReferralByReferrer(customerId);
      if (!referral) {
        const code = `REF${customerId}${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
        await storage.createReferral(customerId, code);
        referral = await storage.getReferralByReferrer(customerId);
      }
      const stats = await storage.getReferralStats(customerId);
      const baseUrl = process.env.REPLIT_DOMAINS?.split(",")[0] || req.get("host") || "localhost";
      const referralLink = `https://${baseUrl}/auth?ref=${referral?.referralCode}`;
      res.json({ success: true, code: referral?.referralCode, link: referralLink, stats });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ─── Customer: Full Payment History ──────────────────────────────────
  app.get("/api/customer/payment-history", customerAuthMiddleware, async (req: any, res) => {
    try {
      const customer = req.customer;
      const [orders, walletTxns] = await Promise.all([
        storage.getTransactionsByEmail(customer.email),
        storage.getWalletTransactions(customer.id),
      ]);
      res.json({ success: true, orders, walletTransactions: walletTxns });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ─── Admin: Custom Domain Management ────────────────────────────────
  type CustomDomain = { id: string; domain: string; label: string; addedAt: string; primary: boolean };

  function getDomains(): CustomDomain[] {
    try { return JSON.parse(dbSettingsGet("custom_domains") || "[]"); } catch { return []; }
  }
  function saveDomains(domains: CustomDomain[]) { dbSettingsSet("custom_domains", JSON.stringify(domains)); }

  app.get("/api/admin/domains", adminAuthMiddleware, superAdminOnly, (_req, res) => {
    const replitDomain = process.env.REPLIT_DEV_DOMAIN || process.env.REPLIT_DOMAINS || null;
    res.json({ success: true, domains: getDomains(), replitDomain });
  });

  app.post("/api/admin/domains", adminAuthMiddleware, superAdminOnly, (req, res) => {
    const { domain, label } = req.body;
    if (!domain) return res.status(400).json({ success: false, error: "domain is required" });
    const clean = domain.toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").trim();
    const existing = getDomains();
    if (existing.some((d) => d.domain === clean)) return res.status(400).json({ success: false, error: "Domain already added" });
    const entry: CustomDomain = { id: uuidv4(), domain: clean, label: label || clean, addedAt: new Date().toISOString(), primary: existing.length === 0 };
    existing.push(entry);
    saveDomains(existing);
    logAdminAction({ action: `Custom domain added: ${clean}`, category: "settings", details: `Label: ${label || clean}`, status: "success" });
    res.json({ success: true, domain: entry });
  });

  app.put("/api/admin/domains/:id/primary", adminAuthMiddleware, superAdminOnly, (req, res) => {
    const domains = getDomains().map((d) => ({ ...d, primary: d.id === req.params.id }));
    saveDomains(domains);
    res.json({ success: true });
  });

  app.delete("/api/admin/domains/:id", adminAuthMiddleware, superAdminOnly, (req, res) => {
    const all = getDomains();
    const target = all.find((d) => d.id === req.params.id);
    if (!target) return res.status(404).json({ success: false, error: "Not found" });
    const filtered = all.filter((d) => d.id !== req.params.id);
    if (target.primary && filtered.length > 0) filtered[0].primary = true;
    saveDomains(filtered);
    logAdminAction({ action: `Custom domain removed: ${target.domain}`, category: "settings", details: `ID: ${target.id}`, status: "warning" });
    res.json({ success: true });
  });

  // ─── Customer: Wallet Top-Up ──────────────────────────────────────────────
  app.post("/api/customer/wallet/topup/initiate", customerAuthMiddleware, async (req: any, res) => {
    try {
      const { amount } = req.body;
      const customerId = req.customer.id;
      const customer = await storage.getCustomerById(customerId);
      if (!customer) return res.status(404).json({ success: false, error: "Customer not found" });

      const amountNum = parseInt(amount);
      if (!amountNum || amountNum < 50) return res.status(400).json({ success: false, error: "Minimum top-up is KES 50" });

      const paystackSecret = getPaystackSecretKey();
      const reference = `TOPUP-${customerId}-${Date.now()}`;

      await storage.createTransaction({
        reference,
        planId: "WALLET_TOPUP",
        planName: "Wallet Top-Up",
        customerEmail: customer.email,
        customerName: customer.name || "Customer",
        amount: amountNum,
        status: "pending",
        emailSent: false,
        accountAssigned: false,
      });

      if (!paystackSecret) {
        return res.json({ success: true, paystackConfigured: false, reference, authorizationUrl: null });
      }

      const psRes = await axios.post(
        "https://api.paystack.co/transaction/initialize",
        {
          email: customer.email,
          amount: amountNum * 100,
          reference,
          currency: "KES",
          metadata: { type: "wallet_topup", customerId, amount: amountNum },
          callback_url: `${getBaseUrl(req)}/dashboard?tab=wallet&topup=success`,
        },
        { headers: { Authorization: `Bearer ${paystackSecret}` } }
      );

      res.json({ success: true, reference, authorizationUrl: psRes.data.data.authorization_url, accessCode: psRes.data.data.access_code, paystackConfigured: true, amount: amountNum });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post("/api/customer/wallet/topup/verify", customerAuthMiddleware, async (req: any, res) => {
    try {
      const { reference } = req.body;
      const customerId = req.customer.id;

      const transaction = await storage.getTransaction(reference);
      if (!transaction || transaction.planId !== "WALLET_TOPUP") {
        return res.status(404).json({ success: false, error: "Top-up transaction not found" });
      }
      if (transaction.status === "success") {
        return res.json({ success: true, alreadyProcessed: true, amount: transaction.amount });
      }

      const verify = await verifyPaystackPayment(reference);
      if (!verify.configured) return res.status(503).json({ success: false, error: "Payment gateway not configured" });
      if (!verify.success) {
        await storage.updateTransaction(reference, { status: "failed" });
        return res.json({ success: false, error: "Payment was not successful" });
      }

      await storage.creditWallet(customerId, transaction.amount, `Wallet top-up — KES ${transaction.amount}`, reference);
      await storage.updateTransaction(reference, { status: "success", accountAssigned: true, emailSent: true });
      await storage.createNotification(customerId, "wallet", "Wallet Topped Up 💰", `KES ${transaction.amount} has been added to your wallet.`);

      res.json({ success: true, amount: transaction.amount });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ─── Customer: Pay with Wallet ────────────────────────────────────────────
  app.post("/api/customer/wallet/pay", customerAuthMiddleware, async (req: any, res) => {
    try {
      const { planId, customerName } = req.body;
      const customerId = req.customer.id;
      const customer = await storage.getCustomerById(customerId);
      if (!customer) return res.status(404).json({ success: false, error: "Customer not found" });

      const categories = buildPlansResponse();
      let plan: any = null;
      for (const cat of Object.values(categories) as any[]) {
        if (cat.plans[planId]) { plan = cat.plans[planId]; break; }
      }
      if (!plan) return res.status(400).json({ success: false, error: "Invalid plan" });

      const avail = accountManager.checkAvailability(planId);
      if (!avail.available) return res.status(400).json({ success: false, error: "This plan is currently out of stock", outOfStock: true });

      const wallet = await storage.getWallet(customerId);
      if ((wallet.balance || 0) < plan.price) {
        return res.status(400).json({ success: false, error: `Insufficient wallet balance. You need KES ${plan.price} but have KES ${wallet.balance}.`, insufficientFunds: true });
      }

      const reference = `WALLET-${planId.toUpperCase()}-${Date.now()}`;
      const transaction = await storage.createTransaction({
        reference,
        planId,
        planName: plan.name,
        customerEmail: customer.email,
        customerName: customerName || customer.name || "Customer",
        amount: plan.price,
        status: "pending",
        emailSent: false,
        accountAssigned: false,
      });

      await storage.debitWallet(customerId, plan.price, `Purchase: ${plan.name}`, reference);
      const delivery = await deliverAccount(transaction);
      if (!delivery.success) {
        await storage.creditWallet(customerId, plan.price, `Refund: ${plan.name} (delivery failed)`, reference);
        return res.json({ success: false, error: delivery.error });
      }

      res.json({ success: true, planName: plan.name, reference });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ─── Customer: PDF Receipt ────────────────────────────────────────────────
  app.get("/api/customer/orders/:reference/receipt", customerAuthMiddleware, async (req: any, res) => {
    try {
      const { reference } = req.params;
      const customer = await storage.getCustomerById(req.customer.id);
      if (!customer) return res.status(404).json({ success: false, error: "Not found" });

      const transaction = await storage.getTransaction(reference);
      if (!transaction || transaction.customerEmail !== customer.email) {
        return res.status(404).json({ success: false, error: "Order not found" });
      }
      if (transaction.status !== "success") {
        return res.status(400).json({ success: false, error: "Receipt only available for completed orders" });
      }

      const { siteName } = getAppConfig();
      const doc = new PDFDocument({ margin: 50, size: "A4" });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="receipt-${reference}.pdf"`);
      doc.pipe(res);

      doc.rect(0, 0, doc.page.width, 100).fill("#4F46E5");
      doc.fillColor("#ffffff").fontSize(24).font("Helvetica-Bold").text(siteName, 50, 35);
      doc.fontSize(11).font("Helvetica").text("Payment Receipt", 50, 65);

      doc.fillColor("#1f2937").fontSize(18).font("Helvetica-Bold").text("RECEIPT", 50, 120);
      doc.fontSize(10).font("Helvetica").fillColor("#6b7280")
        .text(`Reference: ${reference}`, 50, 145)
        .text(`Date: ${new Date(transaction.createdAt || Date.now()).toLocaleDateString("en-KE", { year: "numeric", month: "long", day: "numeric" })}`, 50, 160);

      doc.moveTo(50, 185).lineTo(545, 185).strokeColor("#e5e7eb").lineWidth(1).stroke();

      doc.fillColor("#1f2937").fontSize(13).font("Helvetica-Bold").text("Customer Details", 50, 200);
      doc.fontSize(10).font("Helvetica").fillColor("#374151")
        .text(`Name: ${transaction.customerName || customer.name || "Customer"}`, 50, 220)
        .text(`Email: ${transaction.customerEmail}`, 50, 235);

      doc.moveTo(50, 255).lineTo(545, 255).strokeColor("#e5e7eb").stroke();

      doc.fillColor("#1f2937").fontSize(13).font("Helvetica-Bold").text("Order Details", 50, 270);
      doc.rect(50, 290, 495, 36).fill("#f3f4f6");
      doc.fillColor("#374151").fontSize(10).font("Helvetica-Bold")
        .text("Description", 60, 301).text("Amount", 460, 301);
      doc.fillColor("#374151").fontSize(10).font("Helvetica")
        .text(transaction.planName, 60, 328)
        .text(`KES ${(transaction.amount || 0).toLocaleString()}`, 460, 328);

      doc.moveTo(50, 355).lineTo(545, 355).strokeColor("#e5e7eb").stroke();
      doc.rect(380, 365, 165, 40).fill("#4F46E5");
      doc.fillColor("#ffffff").fontSize(12).font("Helvetica-Bold")
        .text("TOTAL PAID", 390, 373).text(`KES ${(transaction.amount || 0).toLocaleString()}`, 460, 373);

      if (transaction.expiresAt) {
        doc.fillColor("#374151").fontSize(10).font("Helvetica")
          .text(`Subscription expires: ${new Date(transaction.expiresAt).toLocaleDateString("en-KE", { year: "numeric", month: "long", day: "numeric" })}`, 50, 420);
      }

      doc.moveTo(50, doc.page.height - 80).lineTo(545, doc.page.height - 80).strokeColor("#e5e7eb").stroke();
      doc.fillColor("#9ca3af").fontSize(9).font("Helvetica")
        .text("Thank you for your purchase! For support, contact us via WhatsApp or email.", 50, doc.page.height - 65, { align: "center" });
      doc.end();
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ─── Admin: CSV Exports ───────────────────────────────────────────────────
  function toCSV(headers: string[], rows: any[][]): string {
    const escape = (v: any) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    return [headers.map(escape).join(","), ...rows.map((r) => r.map(escape).join(","))].join("\n");
  }

  app.get("/api/admin/export/customers", adminAuthMiddleware, async (_req, res) => {
    try {
      const customers = await storage.getAllCustomers();
      const csv = toCSV(
        ["ID", "Email", "Name", "Email Verified", "Suspended", "Created At"],
        customers.map((c: any) => [c.id, c.email, c.name || "", c.emailVerified ? "Yes" : "No", c.suspended ? "Yes" : "No", c.createdAt || ""])
      );
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", "attachment; filename=customers.csv");
      res.send(csv);
    } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
  });

  app.get("/api/admin/export/orders", adminAuthMiddleware, async (_req, res) => {
    try {
      const txs = await storage.getAllTransactions();
      const csv = toCSV(
        ["Reference", "Plan", "Customer Email", "Customer Name", "Amount (KES)", "Status", "Email Sent", "Expires At", "Created At"],
        txs.map((t: any) => [t.reference, t.planName, t.customerEmail, t.customerName || "", t.amount, t.status, t.emailSent ? "Yes" : "No", t.expiresAt || "", t.createdAt || ""])
      );
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", "attachment; filename=orders.csv");
      res.send(csv);
    } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
  });

  app.get("/api/admin/export/transactions", adminAuthMiddleware, async (_req, res) => {
    try {
      const txs = await storage.getAllTransactions();
      const success = txs.filter((t: any) => t.status === "success");
      const csv = toCSV(
        ["Reference", "Plan", "Customer Email", "Amount (KES)", "Expires At", "Date"],
        success.map((t: any) => [t.reference, t.planName, t.customerEmail, t.amount, t.expiresAt || "", t.createdAt || ""])
      );
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", "attachment; filename=transactions.csv");
      res.send(csv);
    } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
  });

  // ─── Admin: Affiliate Tier Config ─────────────────────────────────────────
  app.get("/api/admin/affiliate-tiers", adminAuthMiddleware, (_req, res) => {
    const raw = dbSettingsGet("affiliate_tiers");
    const tiers = raw ? JSON.parse(raw) : [
      { name: "Silver", min: 5, multiplier: 1.25 },
      { name: "Gold", min: 15, multiplier: 1.5 },
      { name: "Platinum", min: 30, multiplier: 2.0 },
    ];
    res.json({ success: true, tiers });
  });

  app.put("/api/admin/affiliate-tiers", adminAuthMiddleware, (req, res) => {
    const { tiers } = req.body;
    if (!Array.isArray(tiers)) return res.status(400).json({ success: false, error: "tiers must be an array" });
    dbSettingsSet("affiliate_tiers", JSON.stringify(tiers));
    res.json({ success: true });
  });

  // ─── Customer: Referral Tier ───────────────────────────────────────────────
  app.get("/api/customer/referral/tier", customerAuthMiddleware, async (req: any, res) => {
    try {
      const stats = await storage.getReferralStats(req.customer.id);
      const tier = getAffiliateTier(stats.completedReferrals);
      res.json({ success: true, tier: tier.tier, multiplier: tier.multiplier, label: tier.label, completedReferrals: stats.completedReferrals });
    } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
  });

  // ─── Admin: Email Campaigns ───────────────────────────────────────────────
  type Campaign = { id: string; name: string; subject: string; body: string; segment: string; status: string; scheduledAt?: string; sentAt?: string; sentCount?: number; createdAt: string };

  function getCampaigns(): Campaign[] {
    try { return JSON.parse(dbSettingsGet("email_campaigns") || "[]"); } catch { return []; }
  }
  function saveCampaigns(c: Campaign[]) { dbSettingsSet("email_campaigns", JSON.stringify(c)); }

  app.get("/api/admin/campaigns", adminAuthMiddleware, (_req, res) => {
    res.json({ success: true, campaigns: getCampaigns() });
  });

  app.post("/api/admin/campaigns", adminAuthMiddleware, async (req, res) => {
    try {
      const { name, subject, body, segment, scheduledAt, sendNow } = req.body;
      if (!subject || !body) return res.status(400).json({ success: false, error: "Subject and body are required" });

      const campaign: Campaign = {
        id: uuidv4(),
        name: name || "Campaign",
        subject,
        body,
        segment: segment || "all",
        status: sendNow ? "sending" : scheduledAt ? "scheduled" : "draft",
        scheduledAt: scheduledAt || undefined,
        createdAt: new Date().toISOString(),
      };

      const all = getCampaigns();
      all.unshift(campaign);
      saveCampaigns(all);
      logAdminAction({ action: `Campaign created: ${campaign.name}`, category: "settings", details: `Segment: ${campaign.segment}, Send now: ${sendNow}`, status: "success" });

      if (sendNow) {
        const { checkScheduledCampaigns } = await import("./cron");
        const allWithSending = getCampaigns();
        const idx = allWithSending.findIndex((c) => c.id === campaign.id);
        if (idx !== -1) allWithSending[idx].scheduledAt = new Date().toISOString();
        saveCampaigns(allWithSending);
        checkScheduledCampaigns().catch(() => {});
      }

      res.json({ success: true, campaign });
    } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
  });

  app.post("/api/admin/campaigns/:id/send", adminAuthMiddleware, async (req, res) => {
    try {
      const campaigns = getCampaigns();
      const idx = campaigns.findIndex((c) => c.id === req.params.id);
      if (idx === -1) return res.status(404).json({ success: false, error: "Campaign not found" });
      campaigns[idx].status = "sending";
      campaigns[idx].scheduledAt = new Date().toISOString();
      saveCampaigns(campaigns);
      const { checkScheduledCampaigns } = await import("./cron");
      checkScheduledCampaigns().catch(() => {});
      res.json({ success: true });
    } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
  });

  app.delete("/api/admin/campaigns/:id", adminAuthMiddleware, (req, res) => {
    const all = getCampaigns().filter((c) => c.id !== req.params.id);
    saveCampaigns(all);
    res.json({ success: true });
  });

  // ─── Public: Reseller API ─────────────────────────────────────────────────
  async function resellerApiKeyMiddleware(req: any, res: any, next: any) {
    const apiKey = req.headers["x-api-key"] as string;
    if (!apiKey) return res.status(401).json({ success: false, error: "API key required. Include X-API-Key header." });
    const allKeys = await storage.getAllApiKeys?.() || [];
    const found = allKeys.find((k: any) => k.key === apiKey && k.active);
    if (!found) return res.status(401).json({ success: false, error: "Invalid or inactive API key" });
    const customer = await storage.getCustomerById(found.customerId!);
    if (!customer || customer.suspended) return res.status(403).json({ success: false, error: "Account suspended or not found" });
    req.resellerCustomer = customer;
    next();
  }

  app.get("/api/v1/plans", resellerApiKeyMiddleware, (_req, res) => {
    const categories = buildPlansResponse();
    const plans: any[] = [];
    for (const [catKey, cat] of Object.entries(categories) as any[]) {
      for (const [planId, plan] of Object.entries(cat.plans)) {
        plans.push({ planId, ...(plan as any), category: cat.category, categoryKey: catKey });
      }
    }
    res.json({ success: true, plans });
  });

  app.post("/api/v1/orders", resellerApiKeyMiddleware, async (req: any, res) => {
    try {
      const { planId, customerEmail, customerName } = req.body;
      if (!planId || !customerEmail) return res.status(400).json({ success: false, error: "planId and customerEmail are required" });

      const categories = buildPlansResponse();
      let plan: any = null;
      for (const cat of Object.values(categories) as any[]) {
        if (cat.plans[planId]) { plan = cat.plans[planId]; break; }
      }
      if (!plan) return res.status(400).json({ success: false, error: "Invalid planId" });

      const avail = accountManager.checkAvailability(planId);
      if (!avail.available) return res.status(400).json({ success: false, error: "Plan out of stock", outOfStock: true });

      const wallet = await storage.getWallet(req.resellerCustomer.id);
      if ((wallet.balance || 0) < plan.price) {
        return res.status(402).json({ success: false, error: `Insufficient wallet balance. Need KES ${plan.price}, have KES ${wallet.balance}.`, insufficientFunds: true });
      }

      const reference = `API-${planId.toUpperCase()}-${Date.now()}`;
      const transaction = await storage.createTransaction({
        reference,
        planId,
        planName: plan.name,
        customerEmail,
        customerName: customerName || "Customer",
        amount: plan.price,
        status: "pending",
        emailSent: false,
        accountAssigned: false,
      });

      await storage.debitWallet(req.resellerCustomer.id, plan.price, `API Order: ${plan.name} for ${customerEmail}`, reference);
      const delivery = await deliverAccount(transaction);
      if (!delivery.success) {
        await storage.creditWallet(req.resellerCustomer.id, plan.price, `Refund: ${plan.name} (delivery failed)`, reference);
        return res.status(500).json({ success: false, error: delivery.error });
      }

      res.json({ success: true, reference, planName: plan.name, amount: plan.price, customerEmail, message: "Order placed and credentials sent to customer email." });
    } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
  });

  // ─── Public: AI Support Chat ─────────────────────────────────────────
  app.post("/api/support/chat", async (req, res) => {
    try {
      const { message, sessionId } = req.body;
      if (!message || typeof message !== "string") {
        return res.status(400).json({ success: false, error: "Message is required" });
      }
      const sid = sessionId || `chat-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const result = await getAIChatResponse(sid, message);
      res.json({ success: true, response: result.response, sessionId: result.sessionId });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ─── Admin Monitor Bot ────────────────────────────────────────────────────
  app.get("/api/admin/bot/autolog", adminAuthMiddleware, (_req: any, res: any) => {
    try {
      const { getAutoFixLog, getBotStatus } = require("./admin-bot");
      res.json({ success: true, actions: getAutoFixLog(), status: getBotStatus() });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message, actions: [] });
    }
  });

  app.get("/api/admin/bot/status", adminAuthMiddleware, (_req: any, res: any) => {
    try {
      res.json({ success: true, response: getAutoStatus() });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.get("/api/admin/bot/scan", adminAuthMiddleware, (_req: any, res: any) => {
    try {
      const threats = runSecurityScan();
      res.json({ success: true, threats, scannedAt: new Date().toISOString() });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message, threats: [] });
    }
  });

  app.post("/api/admin/bot/ban", adminAuthMiddleware, async (req: any, res: any) => {
    try {
      const { email, reason } = req.body;
      if (!email) return res.status(400).json({ success: false, error: "Email required" });
      const result = await banCustomerByEmail(email, reason || "Flagged by security bot");
      if (result.success) {
        logAdminAction({ action: `Security bot banned: ${email}`, category: "customers", details: reason || "Flagged by security bot — unusual activity", status: "warning" });
      }
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post("/api/admin/ai-assistant", adminAuthMiddleware, (req: any, res: any) => {
    try {
      const { message } = req.body;
      if (!message?.trim()) return res.status(400).json({ success: false, error: "Message required" });
      const response = processAdminCommand(message.trim());
      res.json({ success: true, response });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.delete("/api/admin/ai-assistant/session/:sessionId", adminAuthMiddleware, (_req: any, res: any) => {
    res.json({ success: true });
  });

  return httpServer;
}
