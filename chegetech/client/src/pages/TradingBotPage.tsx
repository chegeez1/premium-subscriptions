import { useState } from "react";
import { Zap, Play, Shield, TrendingUp, BarChart2, RefreshCw, CheckCircle, ExternalLink } from "lucide-react";

const FEATURES = [
  { icon: Zap,         color: "text-lime-400",   bg: "bg-lime-500/10 border-lime-500/20",   title: "Real Deriv Account",    desc: "Connects directly to your Deriv account via official API — demo or real money" },
  { icon: TrendingUp,  color: "text-green-400",  bg: "bg-green-500/10 border-green-500/20", title: "5 Trading Strategies",  desc: "Trend Follow, Martingale, Anti-Martingale, Digit Over/Under — switch anytime" },
  { icon: Shield,      color: "text-blue-400",   bg: "bg-blue-500/10 border-blue-500/20",   title: "Risk Management",       desc: "Stop loss, take profit, and max daily loss controls to protect your balance" },
  { icon: BarChart2,   color: "text-purple-400", bg: "bg-purple-500/10 border-purple-500/20",title: "10 Synthetic Indices",  desc: "Volatility 10/25/50/75/100, Boom & Crash 500, 1-second indices" },
  { icon: RefreshCw,   color: "text-cyan-400",   bg: "bg-cyan-500/10 border-cyan-500/20",   title: "Auto-Compounding",      desc: "Martingale doubles stake on loss to recover faster. Anti-martingale rides winning streaks" },
  { icon: CheckCircle, color: "text-emerald-400",bg: "bg-emerald-500/10 border-emerald-500/20",title: "Live Trade History",  desc: "Full trade log with contract IDs, P&L per trade, win rate, and session stats" },
];

const PLANS = [
  { label: "1 Month",  price: "KES 800",  badge: null,        highlight: false },
  { label: "3 Months", price: "KES 2,000", badge: "Popular",  highlight: true  },
  { label: "Lifetime", price: "KES 4,500", badge: "Best Value",highlight: false },
];

const BOT_URL = "https://ac66be45-965a-4b0c-a536-67f2200a17e9-00-2fbk9kaywnyiy.janeway.replit.dev/trading-bot/";

function getToken() { return localStorage.getItem("customer_token"); }

export default function TradingBotPage() {
  const [launching, setLaunching] = useState(false);

  function launch() {
    setLaunching(true);
    setTimeout(() => { window.open(BOT_URL, "_blank"); setLaunching(false); }, 400);
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white pb-24">
      <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">

        {/* Hero */}
        <div className="relative rounded-3xl border border-lime-500/20 bg-gradient-to-br from-lime-500/8 via-green-500/5 to-transparent p-6 overflow-hidden">
          <div className="absolute top-0 right-0 w-48 h-48 bg-lime-500/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2 pointer-events-none" />
          <div className="flex items-start gap-4">
            <div className="w-14 h-14 rounded-2xl bg-lime-500/15 border border-lime-500/25 flex items-center justify-center shrink-0">
              <Zap className="w-7 h-7 text-lime-400" />
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <h1 className="text-2xl font-bold">ChegeBot Pro</h1>
                <span className="text-xs px-2 py-0.5 rounded-full bg-lime-500/20 border border-lime-500/30 text-lime-300 font-medium">Trading Bot</span>
              </div>
              <p className="text-white/50 text-sm leading-relaxed">
                Automated trading bot for Deriv synthetic indices. Connects to your own Deriv account and trades 24/7 using proven strategies with built-in risk controls.
              </p>
              <div className="flex flex-wrap gap-2 mt-3">
                {["Real Deriv API", "10 Indices", "5 Strategies", "Risk Controls"].map(tag => (
                  <span key={tag} className="text-xs px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-white/40">{tag}</span>
                ))}
              </div>
            </div>
          </div>

          <button
            onClick={launch}
            disabled={launching}
            className="mt-5 w-full flex items-center justify-center gap-2 h-12 rounded-2xl bg-lime-500 hover:bg-lime-400 active:scale-[0.98] transition-all text-black font-bold text-sm shadow-lg shadow-lime-500/20 disabled:opacity-70"
          >
            {launching
              ? <><RefreshCw className="w-4 h-4 animate-spin" />Launching…</>
              : <><Play className="w-4 h-4" />Launch Trading Bot<ExternalLink className="w-3.5 h-3.5 ml-1 opacity-60" /></>
            }
          </button>
          <p className="text-center text-xs text-white/25 mt-2">Opens in a new tab · Use your own Deriv API token</p>
        </div>

        {/* Features */}
        <div>
          <h2 className="text-sm font-semibold text-white/40 uppercase tracking-wider mb-3">What's Included</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {FEATURES.map(f => (
              <div key={f.title} className={`rounded-2xl border p-4 flex gap-3 ${f.bg}`}>
                <f.icon className={`w-5 h-5 shrink-0 mt-0.5 ${f.color}`} />
                <div>
                  <p className="text-sm font-semibold text-white">{f.title}</p>
                  <p className="text-xs text-white/40 mt-0.5 leading-relaxed">{f.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* How it works */}
        <div className="bg-white/[0.03] border border-white/8 rounded-2xl p-5">
          <h2 className="text-sm font-semibold text-white/40 uppercase tracking-wider mb-4">How It Works</h2>
          <div className="space-y-4">
            {[
              { step: "1", title: "Get a Deriv API Token", desc: "Log in at app.deriv.com → Account Settings → API Token. Create one with Read + Trade permissions." },
              { step: "2", title: "Launch the Bot", desc: "Click the Launch button above, paste your token, and connect. Connect to start trading immediately." },
              { step: "3", title: "Configure & Start", desc: "Pick your symbol, strategy, stake size, and risk limits. Hit Start Bot — it trades automatically." },
              { step: "4", title: "Monitor & Profit", desc: "Watch live trades, P&L, and win rate on the dashboard. Stop anytime with one click." },
            ].map(s => (
              <div key={s.step} className="flex gap-3">
                <div className="w-7 h-7 rounded-full bg-lime-500/15 border border-lime-500/25 flex items-center justify-center text-xs font-bold text-lime-400 shrink-0">{s.step}</div>
                <div>
                  <p className="text-sm font-semibold text-white">{s.title}</p>
                  <p className="text-xs text-white/40 mt-0.5 leading-relaxed">{s.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Pricing */}
        <div>
          <h2 className="text-sm font-semibold text-white/40 uppercase tracking-wider mb-3">Pricing</h2>
          <div className="grid grid-cols-3 gap-3">
            {PLANS.map(p => (
              <div key={p.label} className={`rounded-2xl border p-4 text-center relative ${p.highlight ? "bg-lime-500/10 border-lime-500/30" : "bg-white/[0.03] border-white/8"}`}>
                {p.badge && (
                  <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 text-xs px-2 py-0.5 rounded-full bg-lime-500 text-black font-bold whitespace-nowrap">{p.badge}</span>
                )}
                <p className={`text-xs font-medium mb-1 ${p.highlight ? "text-lime-300" : "text-white/40"}`}>{p.label}</p>
                <p className="text-lg font-bold text-white">{p.price}</p>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}
