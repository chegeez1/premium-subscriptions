import { useState } from "react";
import { useLocation } from "wouter";
import {
  Server, Zap, Shield, Clock, Globe, Cpu, HardDrive, Wifi,
  CheckCircle, MessageCircle, ChevronRight, Star, Package
} from "lucide-react";

const PLANS = [
  {
    name: "Starter",
    ram: "1 GB RAM",
    cpu: "1 vCPU",
    storage: "25 GB SSD",
    bandwidth: "1 TB/mo",
    price: 800,
    popular: false,
    color: "from-cyan-500 to-blue-600",
    features: ["Ubuntu / AlmaLinux", "SSH Access", "1 IP Address", "Basic Support"],
  },
  {
    name: "Standard",
    ram: "2 GB RAM",
    cpu: "2 vCPU",
    storage: "50 GB SSD",
    bandwidth: "2 TB/mo",
    price: 1500,
    popular: true,
    color: "from-indigo-500 to-purple-600",
    features: ["Ubuntu / AlmaLinux", "SSH Access", "1 IP Address", "PM2 Pre-installed", "Priority Support"],
  },
  {
    name: "Pro",
    ram: "4 GB RAM",
    cpu: "4 vCPU",
    storage: "100 GB SSD",
    bandwidth: "4 TB/mo",
    price: 2800,
    popular: false,
    color: "from-violet-500 to-pink-600",
    features: ["Ubuntu / AlmaLinux", "SSH Access", "1 IP Address", "PM2 Pre-installed", "Daily Backups", "24/7 Premium Support"],
  },
];

const FEATURES = [
  { icon: Zap,   title: "Instant Provisioning", desc: "Server ready in under 2 minutes after payment." },
  { icon: Shield, title: "DDoS Protection",      desc: "Built-in protection keeps your services online." },
  { icon: Clock,  title: "99.9% Uptime SLA",     desc: "High-availability infrastructure for your bots." },
  { icon: Globe,  title: "Nairobi Datacenter",   desc: "Low-latency access from anywhere in East Africa." },
];

function customerToken() {
  try { return localStorage.getItem("customer_token") || ""; } catch { return ""; }
}

export default function VpsPage() {
  const [, setLocation] = useLocation();
  const [hoveredPlan, setHoveredPlan] = useState<string | null>(null);

  function handleOrder(plan: typeof PLANS[0]) {
    if (!customerToken()) { setLocation("/auth"); return; }
    const msg = encodeURIComponent(`Hi, I'd like to order the ${plan.name} VPS plan (${plan.ram}, KES ${plan.price.toLocaleString()}/mo). Please guide me.`);
    window.open(`https://wa.me/254700000000?text=${msg}`, "_blank");
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950 text-white">
      {/* Hero */}
      <div className="relative border-b border-white/5">
        <div className="absolute inset-0 bg-gradient-to-br from-cyan-950/30 via-gray-900/0 to-gray-950 pointer-events-none" />
        <div className="relative max-w-5xl mx-auto px-4 py-16 text-center">
          <div className="inline-flex items-center gap-2 bg-cyan-500/10 border border-cyan-500/20 rounded-full px-4 py-1.5 text-sm text-cyan-400 mb-6">
            <Server className="w-3.5 h-3.5" />
            VPS Hosting — East Africa
          </div>
          <h1 className="text-4xl md:text-5xl font-bold mb-4 bg-gradient-to-r from-white via-cyan-100 to-cyan-400 bg-clip-text text-transparent">
            Reliable VPS Servers
          </h1>
          <p className="text-gray-400 text-lg max-w-xl mx-auto">
            Blazing-fast virtual servers for your bots, websites, and apps — billed monthly in KES.
          </p>
        </div>
      </div>

      {/* Feature highlights */}
      <div className="max-w-5xl mx-auto px-4 py-10 grid grid-cols-2 md:grid-cols-4 gap-4">
        {FEATURES.map((f) => {
          const Icon = f.icon;
          return (
            <div key={f.title} className="bg-white/3 border border-white/6 rounded-2xl p-4 text-center hover:bg-white/5 transition-colors">
              <div className="w-10 h-10 rounded-xl bg-cyan-500/10 flex items-center justify-center mx-auto mb-3">
                <Icon className="w-5 h-5 text-cyan-400" />
              </div>
              <p className="text-sm font-semibold text-white mb-1">{f.title}</p>
              <p className="text-xs text-white/40 leading-relaxed">{f.desc}</p>
            </div>
          );
        })}
      </div>

      {/* Pricing */}
      <div className="max-w-5xl mx-auto px-4 pb-16">
        <h2 className="text-2xl font-bold text-center mb-8">Choose a Plan</h2>
        <div className="grid md:grid-cols-3 gap-5">
          {PLANS.map((plan) => (
            <div
              key={plan.name}
              onMouseEnter={() => setHoveredPlan(plan.name)}
              onMouseLeave={() => setHoveredPlan(null)}
              className={`relative rounded-2xl border p-6 flex flex-col transition-all duration-200 ${
                plan.popular
                  ? "border-indigo-500/40 bg-indigo-950/30 shadow-xl shadow-indigo-900/20"
                  : "border-white/8 bg-white/3 hover:border-white/14 hover:bg-white/5"
              }`}
            >
              {plan.popular && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <span className="bg-gradient-to-r from-indigo-500 to-purple-500 text-white text-xs font-bold px-3 py-1 rounded-full">
                    Most Popular
                  </span>
                </div>
              )}

              {/* Plan header */}
              <div className={`w-12 h-12 rounded-2xl bg-gradient-to-br ${plan.color} flex items-center justify-center mb-4 shadow-lg`}>
                <Server className="w-6 h-6 text-white" />
              </div>
              <h3 className="text-lg font-bold mb-1">{plan.name}</h3>

              {/* Specs */}
              <div className="grid grid-cols-2 gap-2 my-3">
                {[
                  { icon: Cpu,      val: plan.cpu },
                  { icon: Package,  val: plan.ram },
                  { icon: HardDrive,val: plan.storage },
                  { icon: Wifi,     val: plan.bandwidth },
                ].map(({ icon: Icon, val }) => (
                  <div key={val} className="flex items-center gap-1.5 text-xs text-white/60">
                    <Icon className="w-3.5 h-3.5 text-white/30 shrink-0" />
                    {val}
                  </div>
                ))}
              </div>

              {/* Features */}
              <ul className="space-y-1.5 mb-5 flex-1">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-center gap-2 text-sm text-white/60">
                    <CheckCircle className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>

              {/* Price + CTA */}
              <div className="mt-auto">
                <div className="mb-4">
                  <span className="text-3xl font-extrabold text-white">KES {plan.price.toLocaleString()}</span>
                  <span className="text-white/40 text-sm">/month</span>
                </div>
                <button
                  onClick={() => handleOrder(plan)}
                  className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold transition-all ${
                    plan.popular
                      ? "bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white shadow-lg shadow-indigo-900/30"
                      : "bg-white/8 hover:bg-white/12 text-white border border-white/10"
                  }`}
                >
                  <MessageCircle className="w-4 h-4" />
                  Order via WhatsApp
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Bottom note */}
        <p className="text-center text-white/30 text-sm mt-8">
          Need a custom plan? <button onClick={() => window.open("https://wa.me/254700000000", "_blank")} className="text-cyan-400 hover:underline">Chat with us</button> — we'll sort you out.
        </p>
      </div>
    </div>
  );
}
