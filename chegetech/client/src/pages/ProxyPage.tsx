import { useState, useEffect } from "react";
import { Shield, Globe, Zap, Copy, Check, ChevronRight, Loader2, Wifi } from "lucide-react";

interface ProxyPlan {
  id: number;
  name: string;
  description: string;
  type: string;
  gb_amount: number | null;
  country: string | null;
  price_kes: number;
  bandwidth: string;
  speed: string;
  features: string;
  is_active: boolean;
}

const TYPE_COLORS: Record<string, string> = {
  residential: "bg-emerald-500/15 text-emerald-400 border-emerald-500/25",
  rotating: "bg-blue-500/15 text-blue-400 border-blue-500/25",
  datacenter: "bg-violet-500/15 text-violet-400 border-violet-500/25",
  static: "bg-amber-500/15 text-amber-400 border-amber-500/25",
};

const TYPE_LABELS: Record<string, string> = {
  residential: "Residential",
  rotating: "Rotating",
  datacenter: "Datacenter",
  static: "Static",
};

export default function ProxyPage() {
  const [plans, setPlans] = useState<ProxyPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [ordering, setOrdering] = useState<ProxyPlan | null>(null);
  const [orderLoading, setOrderLoading] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/proxy/plans")
      .then(r => r.json())
      .then(d => { if (d.success) setPlans(d.plans); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const copy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(text);
    setTimeout(() => setCopied(null), 2000);
  };

  const placeOrder = async () => {
    if (!ordering) return;
    setOrderLoading(true);
    try {
      const res = await fetch("/api/proxy/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId: ordering.id }),
      });
      const data = await res.json();
      if (data.success && data.paymentUrl) {
        window.location.href = data.paymentUrl;
      } else {
        alert(data.error || "Order failed. Please try again.");
      }
    } catch {
      alert("Network error. Please try again.");
    }
    setOrderLoading(false);
  };

  const types = ["all", ...Array.from(new Set(plans.map(p => p.type)))];
  const filtered = filter === "all" ? plans : plans.filter(p => p.type === filter);

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <div className="max-w-4xl mx-auto px-4 py-6">

        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
              <Shield className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">Proxy / Residential IPs</h1>
              <p className="text-xs text-white/40">{plans.length > 0 ? `${plans.length} plans available` : "Loading plans..."}</p>
            </div>
          </div>
          <p className="text-white/40 text-sm">High-speed residential, rotating and datacenter proxies. Bypass geo-restrictions, scrape safely, stay anonymous.</p>
        </div>

        {/* Feature badges */}
        <div className="flex flex-wrap gap-2 mb-6">
          {[
            { icon: Zap, label: "Fast delivery" },
            { icon: Globe, label: "Multiple countries" },
            { icon: Wifi, label: "99% uptime" },
            { icon: Shield, label: "Anonymous IPs" },
          ].map(({ icon: Icon, label }) => (
            <div key={label} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-xs text-white/60">
              <Icon className="w-3 h-3" />
              {label}
            </div>
          ))}
        </div>

        {/* Filter tabs */}
        <div className="flex gap-2 overflow-x-auto pb-2 mb-5">
          {types.map(t => (
            <button key={t} onClick={() => setFilter(t)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap border transition-colors shrink-0 capitalize ${
                filter === t ? "bg-emerald-500/20 border-emerald-500/30 text-emerald-300" : "bg-white/5 border-white/10 text-white/50 hover:bg-white/10"
              }`}>
              {t === "all" ? `All (${plans.length})` : TYPE_LABELS[t] || t}
            </button>
          ))}
        </div>

        {/* Plans grid */}
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="bg-white/5 rounded-2xl p-5 animate-pulse">
                <div className="h-3 w-20 bg-white/10 rounded mb-3" />
                <div className="h-5 w-32 bg-white/10 rounded mb-2" />
                <div className="h-3 w-full bg-white/10 rounded mb-4" />
                <div className="h-8 w-full bg-white/10 rounded-lg" />
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-white/30">
            <Shield className="w-10 h-10 mx-auto mb-3 opacity-40" />
            <p>No proxy plans available yet</p>
            <p className="text-xs mt-1">Check back soon</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map(plan => {
              const feats: string[] = (() => { try { return JSON.parse(plan.features || "[]"); } catch { return plan.features ? [plan.features] : []; } })();
              return (
                <div key={plan.id} className="bg-white/5 border border-white/8 rounded-2xl p-5 hover:bg-white/8 hover:border-emerald-500/25 transition-all flex flex-col">
                  <div className="mb-4 flex-1">
                    <div className="flex items-start justify-between mb-2">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium border ${TYPE_COLORS[plan.type] || "bg-white/10 text-white/50 border-white/15"}`}>
                        {TYPE_LABELS[plan.type] || plan.type}
                      </span>
                      {plan.country && (
                        <span className="text-xs text-white/40 flex items-center gap-1">
                          <Globe className="w-3 h-3" />
                          {plan.country}
                        </span>
                      )}
                    </div>
                    <h3 className="text-base font-bold text-white mb-1">{plan.name}</h3>
                    {plan.description && <p className="text-xs text-white/50 mb-3 leading-relaxed">{plan.description}</p>}

                    <div className="flex gap-3 mb-3">
                      {plan.bandwidth && (
                        <div className="text-center">
                          <p className="text-sm font-bold text-white">{plan.bandwidth}</p>
                          <p className="text-xs text-white/30">Bandwidth</p>
                        </div>
                      )}
                      {plan.speed && (
                        <div className="text-center">
                          <p className="text-sm font-bold text-white">{plan.speed}</p>
                          <p className="text-xs text-white/30">Speed</p>
                        </div>
                      )}
                      {plan.gb_amount && (
                        <div className="text-center">
                          <p className="text-sm font-bold text-white">{plan.gb_amount}GB</p>
                          <p className="text-xs text-white/30">Data</p>
                        </div>
                      )}
                    </div>

                    {feats.length > 0 && (
                      <ul className="space-y-1">
                        {feats.map((f, i) => (
                          <li key={i} className="flex items-center gap-1.5 text-xs text-white/50">
                            <ChevronRight className="w-3 h-3 text-emerald-400 shrink-0" />
                            {f}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <p className="text-2xl font-bold text-white">KES {plan.price_kes.toLocaleString()}</p>
                    </div>
                    <button onClick={() => copy(`${plan.name} - KES ${plan.price_kes}`)}
                      className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 transition-colors text-white/40 hover:text-white/70">
                      {copied === `${plan.name} - KES ${plan.price_kes}` ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </div>

                  <button onClick={() => setOrdering(plan)}
                    className="w-full py-2.5 rounded-xl bg-emerald-500/15 border border-emerald-500/25 text-emerald-400 font-medium text-sm hover:bg-emerald-500/25 transition-colors flex items-center justify-center gap-2">
                    <Zap className="w-4 h-4" />
                    Get Proxy
                  </button>
                </div>
              );
            })}
          </div>
        )}

        <div className="mt-8 p-4 rounded-2xl bg-white/3 border border-white/8 text-center">
          <p className="text-sm text-white/50 mb-1">Need a custom plan or country not listed?</p>
          <p className="text-xs text-white/30">Contact support via the chat button below</p>
        </div>
      </div>

      {/* Order Modal */}
      {ordering && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4"
          onClick={e => { if (e.target === e.currentTarget) setOrdering(null); }}>
          <div className="bg-gray-900 border border-white/10 rounded-2xl w-full max-w-sm p-6">
            <h3 className="text-lg font-bold mb-1">{ordering.name}</h3>
            <p className="text-sm text-white/50 mb-5">{ordering.description}</p>

            <div className="bg-white/5 border border-white/10 rounded-xl px-4 py-3 flex items-center justify-between mb-5">
              <span className="text-sm text-white/60">Total</span>
              <span className="text-2xl font-bold text-white">KES {ordering.price_kes.toLocaleString()}</span>
            </div>

            <p className="text-xs text-white/30 mb-4 text-center">Your proxy credentials will be delivered to your account after payment is confirmed.</p>

            <div className="flex gap-3">
              <button onClick={() => setOrdering(null)}
                className="flex-1 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white/60 text-sm hover:bg-white/10 transition-colors">
                Cancel
              </button>
              <button onClick={placeOrder} disabled={orderLoading}
                className="flex-1 py-2.5 rounded-xl bg-emerald-500 text-white font-semibold text-sm hover:bg-emerald-600 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
                {orderLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                {orderLoading ? "Processing..." : "Pay with Paystack"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
