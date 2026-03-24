import cron from "node-cron";
import { storage } from "./storage";
import { sendTelegramMessage } from "./telegram";
import { getAppConfig } from "./app-config";
import { dbSettingsGet } from "./storage";
import { sendAdminEmail, sendBulkEmail, sendRawEmail } from "./email";

// ─── Daily: check expiring accounts + notify ──────────────────────────────

async function checkExpiringAccounts() {
  try {
    const txs = await storage.getAllTransactions();
    const { siteName } = getAppConfig();
    const now = new Date();
    const in3Days = new Date(now.getTime() + 3 * 86400000);

    const expiring = txs.filter((t: any) => {
      if (t.status !== "success" || !t.expiresAt) return false;
      const exp = new Date(t.expiresAt);
      return exp > now && exp <= in3Days;
    });

    for (const tx of expiring) {
      if (!tx.customerEmail) continue;
      const expDate = new Date(tx.expiresAt!).toLocaleDateString();
      const html = `
        <div style="font-family:sans-serif;max-width:560px;margin:0 auto">
          <div style="background:linear-gradient(135deg,#4F46E5,#7C3AED);padding:32px;border-radius:12px 12px 0 0;text-align:center">
            <h1 style="color:#fff;margin:0;font-size:22px">${siteName}</h1>
          </div>
          <div style="background:#fff;padding:32px;border-radius:0 0 12px 12px;border:1px solid #e5e7eb">
            <h2 style="color:#1f2937;margin-top:0">⏰ Subscription Expiring Soon</h2>
            <p style="color:#4b5563">Hi there! Your <b>${tx.planName}</b> subscription expires on <b>${expDate}</b>.</p>
            <p style="color:#4b5563">Renew now to avoid any interruption in service.</p>
            <a href="${process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : ""}"
               style="display:inline-block;background:#4F46E5;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin-top:8px">
              Renew Now →
            </a>
          </div>
        </div>`;
      await sendRawEmail(tx.customerEmail, `⏰ Your ${tx.planName} expires on ${expDate}`, html).catch(() => {});
    }

    if (expiring.length > 0) {
      await sendTelegramMessage(
        `⏰ <b>Expiry Alert</b>\n\n${expiring.length} subscription(s) expire in the next 3 days:\n` +
        expiring.slice(0, 10).map((t: any) => `• ${t.planName} — ${t.customerEmail} (${new Date(t.expiresAt).toLocaleDateString()})`).join("\n")
      );
    }
  } catch (err: any) {
    console.error("[cron] Expiry check error:", err.message);
  }
}

// ─── Weekly: revenue report ────────────────────────────────────────────────

async function weeklyReport() {
  try {
    const txs = await storage.getAllTransactions();
    const customers = await storage.getAllCustomers();
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 86400000);

    const weekDone = txs.filter((t: any) => t.status === "success" && new Date(t.createdAt || 0) >= weekAgo);
    const weekRev = weekDone.reduce((s: number, t: any) => s + (t.amount || 0), 0);
    const allDone = txs.filter((t: any) => t.status === "success");
    const allRev = allDone.reduce((s: number, t: any) => s + (t.amount || 0), 0);

    const planCounts: Record<string, number> = {};
    for (const t of weekDone) { planCounts[t.planName] = (planCounts[t.planName] || 0) + 1; }
    const topPlan = Object.entries(planCounts).sort((a, b) => b[1] - a[1])[0];

    const msg =
      `📊 <b>Weekly Report</b>\n\n` +
      `📅 <b>This week</b>\n` +
      `• Orders: ${weekDone.length}\n` +
      `• Revenue: KES ${weekRev.toLocaleString()}\n` +
      `• Top plan: ${topPlan ? `${topPlan[0]} (${topPlan[1]}×)` : "N/A"}\n\n` +
      `📈 <b>All time</b>\n` +
      `• Total orders: ${allDone.length}\n` +
      `• Total revenue: KES ${allRev.toLocaleString()}\n` +
      `• Total customers: ${customers.length}`;

    await sendTelegramMessage(msg);
    await sendAdminEmail(
      "📊 Weekly Business Report",
      `<pre style="font-family:sans-serif">${msg.replace(/<[^>]*>/g, "")}</pre>`
    );
  } catch (err: any) {
    console.error("[cron] Weekly report error:", err.message);
  }
}

// ─── Scheduled email campaigns ─────────────────────────────────────────────

export async function checkScheduledCampaigns() {
  try {
    const raw = dbSettingsGet("email_campaigns");
    if (!raw) return;
    const campaigns: any[] = JSON.parse(raw);
    const now = new Date();
    let changed = false;

    for (const c of campaigns) {
      if (c.status !== "scheduled" || !c.scheduledAt) continue;
      if (new Date(c.scheduledAt) <= now) {
        c.status = "sending";
        changed = true;
        sendScheduledCampaign(c).catch(() => {});
      }
    }

    if (changed) {
      const { dbSettingsSet } = await import("./storage");
      dbSettingsSet("email_campaigns", JSON.stringify(campaigns));
    }
  } catch {}
}

async function sendScheduledCampaign(campaign: any) {
  try {
    const { sendBulkEmail } = await import("./email");
    const customers = await storage.getAllCustomers();
    let recipients: string[] = customers.map((c: any) => c.email).filter(Boolean);

    if (campaign.segment === "active") {
      const txs = await storage.getAllTransactions();
      const activeEmails = new Set(txs.filter((t: any) => t.status === "success").map((t: any) => t.customerEmail));
      recipients = recipients.filter(e => activeEmails.has(e));
    } else if (campaign.segment === "recent") {
      const txs = await storage.getAllTransactions();
      const cutoff = new Date(Date.now() - 30 * 86400000);
      const recentEmails = new Set(txs.filter((t: any) => t.status === "success" && new Date(t.createdAt || 0) >= cutoff).map((t: any) => t.customerEmail));
      recipients = recipients.filter(e => recentEmails.has(e));
    }

    if (!recipients.length) return;
    await sendBulkEmail(recipients, campaign.subject, `<div style="font-family:sans-serif;line-height:1.6">${campaign.body.replace(/\n/g, "<br>")}</div>`);

    const raw = dbSettingsGet("email_campaigns");
    if (raw) {
      const campaigns: any[] = JSON.parse(raw);
      const idx = campaigns.findIndex((c: any) => c.id === campaign.id);
      if (idx !== -1) {
        campaigns[idx].status = "sent";
        campaigns[idx].sentAt = new Date().toISOString();
        campaigns[idx].sentCount = recipients.length;
        const { dbSettingsSet } = await import("./storage");
        dbSettingsSet("email_campaigns", JSON.stringify(campaigns));
      }
    }
  } catch (err: any) {
    console.error("[campaign] Error sending campaign:", err.message);
  }
}

// ─── Start all crons ────────────────────────────────────────────────────────

export function startCronJobs() {
  // Daily at 9am: check expiring subscriptions
  cron.schedule("0 9 * * *", checkExpiringAccounts);

  // Every Sunday at 8am: weekly report
  cron.schedule("0 8 * * 0", weeklyReport);

  // Every 5 minutes: check scheduled campaigns
  cron.schedule("*/5 * * * *", checkScheduledCampaigns);

  console.log("[cron] Jobs scheduled: expiry check (daily 9am), weekly report (Sunday 8am), campaigns (every 5min)");
}
