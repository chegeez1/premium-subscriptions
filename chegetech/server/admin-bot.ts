/**
 * Admin Monitoring Bot — rule-based, no AI API required.
 * Reads from the live database to answer commands and auto-monitor.
 */
import { getDb, dbType } from "./storage";
import { subscriptionPlans } from "./plans";
import { promoManager } from "./promo";
import { accountManager } from "./accounts";

function fmt(n: number) { return `KES ${(n || 0).toLocaleString()}`; }

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function runSql(query: string, params: any[] = []): any[] {
  try {
    if (dbType === "pg") return [];
    return getDb().prepare(query).all(...params);
  } catch { return []; }
}

function runSqlFirst(query: string, params: any[] = []): any {
  try {
    if (dbType === "pg") return null;
    return getDb().prepare(query).get(...params);
  } catch { return null; }
}

// ── Auto-status: called on open + every 30 s ─────────────────────────────────
export function getAutoStatus(): string {
  const lines: string[] = [];
  const t = today();

  // Today's orders & revenue
  const todayRow = runSqlFirst("SELECT COUNT(*) as cnt, SUM(amount) as rev FROM transactions WHERE status='paid' AND created_at LIKE ?", [`${t}%`]);
  lines.push(`📅 **Today (${t})**`);
  lines.push(`- Orders: **${todayRow?.cnt ?? 0}** — Revenue: **${fmt(todayRow?.rev ?? 0)}**`);

  // Pending transactions
  const pending = runSqlFirst("SELECT COUNT(*) as cnt FROM transactions WHERE status='pending'");
  if ((pending?.cnt ?? 0) > 0) {
    lines.push(`\n⏳ **${pending.cnt} pending payment(s)** awaiting verification`);
  }

  // Paid but no account assigned
  const unassigned = runSqlFirst("SELECT COUNT(*) as cnt FROM transactions WHERE status='paid' AND account_assigned=0");
  if ((unassigned?.cnt ?? 0) > 0) {
    lines.push(`\n🚨 **${unassigned.cnt} paid order(s) with no account assigned!** — check Accounts tab`);
  }

  // Expiring accounts within 3 days
  const soon = new Date(); soon.setDate(soon.getDate() + 3);
  const expiring = runSql(
    "SELECT customer_email, plan_name, expires_at FROM transactions WHERE status='paid' AND expires_at IS NOT NULL AND expires_at <= ? AND expires_at >= ?",
    [soon.toISOString(), new Date().toISOString()]
  );
  if (expiring.length > 0) {
    lines.push(`\n⚠️ **${expiring.length} account(s) expiring within 3 days:**`);
    expiring.slice(0, 4).forEach(r => {
      const d = new Date(r.expires_at).toLocaleDateString();
      lines.push(`- ${r.customer_email} (${r.plan_name}) — **${d}**`);
    });
    if (expiring.length > 4) lines.push(`- ...and ${expiring.length - 4} more`);
  }

  // Suspended customers
  const suspended = runSqlFirst("SELECT COUNT(*) as cnt FROM customers WHERE suspended=1");
  if ((suspended?.cnt ?? 0) > 0) {
    lines.push(`\n🔒 **${suspended.cnt} suspended customer(s)**`);
  }

  // Low stock
  const stats = accountManager.getStats();
  const lowStock: string[] = [];
  for (const [planId, s] of Object.entries(stats.byPlan)) {
    // Find plan name
    let planName = planId;
    for (const cat of Object.values(subscriptionPlans)) {
      if (cat.plans[planId]) { planName = cat.plans[planId].name; break; }
    }
    if (s.available <= 2) {
      lowStock.push(`${planName}: **${s.available} slot(s) left**`);
    }
  }
  if (lowStock.length > 0) {
    lines.push(`\n📦 **Low stock alert:**`);
    lowStock.forEach(s => lines.push(`- ${s}`));
  }

  if (lines.length <= 2) {
    lines.push(`\n✅ All systems normal — no alerts right now.`);
  }

  return lines.join("\n");
}

// ── Command processor ────────────────────────────────────────────────────────
export function processAdminCommand(input: string): string {
  const cmd = input.toLowerCase().trim();

  // ── HELP / GREETING ────────────────────────────────────────────────────────
  if (/^(help|hi|hello|hey|what|commands?)/.test(cmd) || cmd.length < 4) {
    return [
      `👋 **Admin Monitor Bot — Commands:**`,
      ``,
      `📊 \`stats\` — today's orders & revenue`,
      `📋 \`orders\` / \`pending orders\` — transaction list`,
      `👥 \`customers\` / \`suspended customers\``,
      `🏷️ \`promo codes\` — list discounts`,
      `📦 \`stock\` — inventory per plan`,
      `⚠️ \`expiring\` / \`expiring 7 days\` — accounts due`,
      `💰 \`revenue breakdown\` — earnings by plan`,
      `💳 \`wallet balances\` — top wallet holders`,
      `🎯 \`referrals\` — top referrers`,
      `🔄 \`status\` — full system health check`,
      ``,
      `I also auto-refresh every 30 seconds with live alerts.`,
    ].join("\n");
  }

  // ── STATUS / HEALTH ────────────────────────────────────────────────────────
  if (/\b(status|health|monitor|check|alert|overview)\b/.test(cmd)) {
    return getAutoStatus();
  }

  // ── STATS ──────────────────────────────────────────────────────────────────
  if (/\b(stat|today|revenue|sales|summary|performance)\b/.test(cmd)) {
    const t = today();
    const row = runSqlFirst("SELECT COUNT(*) as cnt, SUM(amount) as rev, COUNT(DISTINCT customer_email) as uniq FROM transactions WHERE status='paid' AND created_at LIKE ?", [`${t}%`]);
    const week = new Date(); week.setDate(week.getDate() - 7);
    const wRow = runSqlFirst("SELECT COUNT(*) as cnt, SUM(amount) as rev FROM transactions WHERE status='paid' AND created_at >= ?", [week.toISOString()]);
    const all = runSqlFirst("SELECT COUNT(*) as cnt, SUM(amount) as rev FROM transactions WHERE status='paid'");
    const totalCust = runSqlFirst("SELECT COUNT(*) as cnt FROM customers");
    return [
      `📊 **Sales Report**`,
      ``,
      `**Today (${t})**`,
      `- Orders: ${row?.cnt ?? 0}  |  Revenue: ${fmt(row?.rev ?? 0)}`,
      `- Unique buyers: ${row?.uniq ?? 0}`,
      ``,
      `**Last 7 Days**`,
      `- Orders: ${wRow?.cnt ?? 0}  |  Revenue: ${fmt(wRow?.rev ?? 0)}`,
      ``,
      `**All Time**`,
      `- Orders: ${all?.cnt ?? 0}  |  Revenue: ${fmt(all?.rev ?? 0)}`,
      `- Total customers: ${totalCust?.cnt ?? 0}`,
    ].join("\n");
  }

  // ── ORDERS ─────────────────────────────────────────────────────────────────
  if (/\b(order|transaction|purchase)\b/.test(cmd)) {
    const isPending = cmd.includes("pending");
    const isFailed = cmd.includes("fail");
    const statusFilter = isPending ? "pending" : isFailed ? "failed" : "paid";
    const rows = runSql("SELECT reference, customer_email, plan_name, amount, created_at FROM transactions WHERE status=? ORDER BY created_at DESC LIMIT 12", [statusFilter]);
    if (rows.length === 0) return `📋 No ${statusFilter} orders found.`;
    const lines = [`📋 **${statusFilter.charAt(0).toUpperCase()+statusFilter.slice(1)} Orders (${rows.length}):**\n`];
    rows.forEach((r, i) => {
      const d = new Date(r.created_at).toLocaleDateString();
      lines.push(`${i+1}. **${r.customer_email}** — ${r.plan_name} — ${fmt(r.amount)} — ${d}`);
    });
    return lines.join("\n");
  }

  // ── CUSTOMERS ──────────────────────────────────────────────────────────────
  if (/\b(customer|user|member|buyer)\b/.test(cmd)) {
    const isSuspended = cmd.includes("suspend");
    const query = isSuspended
      ? "SELECT email, name, created_at FROM customers WHERE suspended=1 ORDER BY created_at DESC LIMIT 15"
      : "SELECT email, name, created_at, suspended FROM customers ORDER BY created_at DESC LIMIT 15";
    const rows = runSql(query);
    const total = runSqlFirst("SELECT COUNT(*) as cnt FROM customers");
    const susp = runSqlFirst("SELECT COUNT(*) as cnt FROM customers WHERE suspended=1");
    if (rows.length === 0) return isSuspended ? "✅ No suspended customers." : "👥 No customers yet.";
    const lines = [`👥 **${isSuspended ? "Suspended" : "Recent"} Customers** (${total?.cnt ?? "?"} total, ${susp?.cnt ?? 0} suspended):\n`];
    rows.forEach((r, i) => {
      const d = new Date(r.created_at).toLocaleDateString();
      const flag = r.suspended ? " 🔒" : "";
      lines.push(`${i+1}. **${r.email}**${flag} — ${r.name || "—"} — joined ${d}`);
    });
    return lines.join("\n");
  }

  // ── PROMO CODES ────────────────────────────────────────────────────────────
  if (/\b(promo|coupon|discount|code)\b/.test(cmd)) {
    const codes = promoManager.getAll();
    if (!codes || codes.length === 0) return "🏷️ No promo codes set up yet. Create them in the Promo tab.";
    const lines = [`🏷️ **Promo Codes (${codes.length}):**\n`];
    codes.forEach((c: any) => {
      const type = c.discountType === "percent" ? `${c.discountValue}% off` : `KES ${c.discountValue} off`;
      const uses = c.maxUses ? `${c.usedCount || 0}/${c.maxUses} uses` : `${c.usedCount || 0} uses`;
      const exp = c.expiresAt ? ` · expires ${new Date(c.expiresAt).toLocaleDateString()}` : "";
      const status = c.active !== false ? "✅" : "❌";
      lines.push(`${status} **${c.code}** — ${type} — ${uses}${exp}`);
    });
    return lines.join("\n");
  }

  // ── STOCK ──────────────────────────────────────────────────────────────────
  if (/\b(stock|account|inventory|available|slot|supply)\b/.test(cmd)) {
    const stats = accountManager.getStats();
    const entries = Object.entries(stats.byPlan);
    if (entries.length === 0) return "📦 No accounts uploaded yet.";
    const lines = [`📦 **Account Stock (${stats.totalAccounts} accounts, ${stats.availableSlots} slots free):**\n`];
    for (const [planId, s] of entries) {
      let planName = planId;
      for (const cat of Object.values(subscriptionPlans)) {
        if (cat.plans[planId]) { planName = cat.plans[planId].name; break; }
      }
      const bar = s.available === 0 ? "🔴" : s.available <= 2 ? "🟡" : "🟢";
      lines.push(`${bar} **${planName}** — ${s.available} available / ${s.used} used / ${s.total} total`);
    }
    return lines.join("\n");
  }

  // ── EXPIRING ───────────────────────────────────────────────────────────────
  if (/\b(expir|renew|soon|due|deadline)\b/.test(cmd)) {
    const dayMatch = cmd.match(/(\d+)\s*day/);
    const days = dayMatch ? parseInt(dayMatch[1]) : 7;
    const future = new Date(); future.setDate(future.getDate() + days);
    const rows = runSql(
      "SELECT customer_email, plan_name, expires_at FROM transactions WHERE status='paid' AND expires_at IS NOT NULL AND expires_at <= ? ORDER BY expires_at ASC LIMIT 20",
      [future.toISOString()]
    );
    if (rows.length === 0) return `✅ No accounts expiring in the next ${days} days.`;
    const lines = [`⚠️ **${rows.length} account(s) expiring within ${days} days:**\n`];
    rows.forEach(r => {
      const d = new Date(r.expires_at).toLocaleDateString();
      lines.push(`- **${r.customer_email}** — ${r.plan_name} — expires **${d}**`);
    });
    return lines.join("\n");
  }

  // ── REVENUE BREAKDOWN ──────────────────────────────────────────────────────
  if (/\b(revenue|earn|income|breakdown)\b/.test(cmd)) {
    const rows = runSql("SELECT plan_name, COUNT(*) as cnt, SUM(amount) as rev FROM transactions WHERE status='paid' GROUP BY plan_name ORDER BY rev DESC");
    if (rows.length === 0) return "💰 No completed sales yet.";
    const total = rows.reduce((s: number, r: any) => s + (r.rev || 0), 0);
    const lines = [`💰 **Revenue Breakdown** (total: ${fmt(total)}):\n`];
    rows.forEach(r => {
      const pct = total > 0 ? ((r.rev / total) * 100).toFixed(0) : 0;
      lines.push(`- **${r.plan_name}**: ${r.cnt} sales — ${fmt(r.rev)} (${pct}%)`);
    });
    return lines.join("\n");
  }

  // ── PENDING ────────────────────────────────────────────────────────────────
  if (/\b(pending|unverif|wait|queue)\b/.test(cmd)) {
    const rows = runSql("SELECT reference, customer_email, plan_name, amount, created_at FROM transactions WHERE status='pending' ORDER BY created_at DESC LIMIT 15");
    if (rows.length === 0) return "✅ No pending transactions — all payments are verified.";
    const lines = [`⏳ **${rows.length} Pending Transaction(s):**\n`];
    rows.forEach(r => {
      const d = new Date(r.created_at).toLocaleDateString();
      lines.push(`- **${r.customer_email}** — ${r.plan_name} — ${fmt(r.amount)} — ${d}`);
      lines.push(`  Ref: \`${r.reference}\``);
    });
    return lines.join("\n");
  }

  // ── REFERRALS ──────────────────────────────────────────────────────────────
  if (/\b(referral|affiliate|coin|tier|reward|refer)\b/.test(cmd)) {
    const rows = runSql("SELECT referred_by, COUNT(*) as cnt FROM referrals GROUP BY referred_by ORDER BY cnt DESC LIMIT 10");
    if (rows.length === 0) return "🎯 No referral data yet.";
    const lines = [`🎯 **Top Referrers:**\n`];
    rows.forEach((r, i) => {
      lines.push(`${i+1}. **${r.referred_by}** — ${r.cnt} referral(s)`);
    });
    return lines.join("\n");
  }

  // ── WALLET ─────────────────────────────────────────────────────────────────
  if (/\b(wallet|balance|credit|topup|top.up)\b/.test(cmd)) {
    const top = runSql("SELECT email, wallet_balance FROM customers WHERE wallet_balance > 0 ORDER BY wallet_balance DESC LIMIT 10");
    const total = runSqlFirst("SELECT SUM(wallet_balance) as total FROM customers");
    if (top.length === 0) return "💳 No wallet balances — customers haven't topped up yet.";
    const lines = [`💳 **Wallet Balances** (platform float: ${fmt(total?.total ?? 0)}):\n`];
    top.forEach(r => lines.push(`- **${r.email}** — ${fmt(r.wallet_balance)}`));
    return lines.join("\n");
  }

  // ── FALLBACK ───────────────────────────────────────────────────────────────
  return [
    `❓ Didn't catch that. Try:`,
    `- **stats** — today's performance`,
    `- **orders** — recent paid orders`,
    `- **pending orders** — awaiting payment`,
    `- **customers** — customer list`,
    `- **stock** — inventory levels`,
    `- **promo codes** — active discounts`,
    `- **expiring** — accounts expiring soon`,
    `- **revenue breakdown** — by plan`,
    `- **help** — full list`,
  ].join("\n");
}
