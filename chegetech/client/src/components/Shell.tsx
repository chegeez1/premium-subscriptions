import { useLocation } from "wouter";
import {
  ShoppingBag, Bot, Server, LayoutDashboard, LogOut, Zap, X
} from "lucide-react";
import { useState } from "react";

interface NavItem {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  path: string;
  color: string;
  activeBg: string;
}

const NAV_ITEMS: NavItem[] = [
  { icon: ShoppingBag, label: "Premium Accounts", path: "/", color: "text-indigo-400", activeBg: "bg-indigo-500/20 border-indigo-500/30" },
  { icon: Bot,         label: "WhatsApp Bots",    path: "/bots", color: "text-green-400", activeBg: "bg-green-500/20 border-green-500/30" },
  { icon: Server,      label: "VPS Hosting",      path: "/vps",  color: "text-cyan-400",  activeBg: "bg-cyan-500/20 border-cyan-500/30" },
  { icon: LayoutDashboard, label: "My Account",   path: "/dashboard", color: "text-purple-400", activeBg: "bg-purple-500/20 border-purple-500/30" },
];

function logout() {
  localStorage.removeItem("customer_token");
  localStorage.removeItem("customer_data");
  window.location.href = "/auth";
}

interface ShellProps {
  children: React.ReactNode;
  isAuthenticated: boolean;
}

export default function Shell({ children, isAuthenticated }: ShellProps) {
  const [location, setLocation] = useLocation();
  const [tooltip, setTooltip] = useState<string | null>(null);

  if (!isAuthenticated) return <>{children}</>;

  const activePath = location;

  function isActive(path: string) {
    if (path === "/" && activePath === "/") return true;
    if (path !== "/" && activePath.startsWith(path)) return true;
    return false;
  }

  return (
    <div className="flex min-h-screen bg-gray-950">
      {/* ── Desktop left sidebar ─────────────────────────────────────── */}
      <aside className="hidden md:flex flex-col fixed left-0 top-0 h-full w-16 z-50 bg-gray-900/95 backdrop-blur-md border-r border-white/5">
        {/* Logo */}
        <div className="flex items-center justify-center h-16 border-b border-white/5 shrink-0">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-900/40">
            <Zap className="w-5 h-5 text-white" />
          </div>
        </div>

        {/* Nav icons */}
        <nav className="flex flex-col items-center gap-1.5 px-2 py-4 flex-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.path);
            return (
              <div key={item.path} className="relative w-full">
                <button
                  onClick={() => setLocation(item.path)}
                  onMouseEnter={() => setTooltip(item.label)}
                  onMouseLeave={() => setTooltip(null)}
                  className={`w-full flex items-center justify-center h-11 rounded-xl border transition-all duration-150 ${
                    active
                      ? `${item.activeBg} ${item.color}`
                      : "border-transparent text-white/40 hover:text-white/70 hover:bg-white/5"
                  }`}
                  aria-label={item.label}
                >
                  <Icon className="w-5 h-5" />
                </button>
                {/* Tooltip */}
                {tooltip === item.label && (
                  <div className="absolute left-full ml-3 top-1/2 -translate-y-1/2 whitespace-nowrap bg-gray-800 text-white text-xs font-medium px-2.5 py-1.5 rounded-lg shadow-xl pointer-events-none z-50 border border-white/10">
                    {item.label}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        {/* Logout */}
        <div className="px-2 pb-4 shrink-0">
          <button
            onClick={logout}
            className="w-full flex items-center justify-center h-11 rounded-xl border border-transparent text-white/30 hover:text-red-400 hover:bg-red-500/10 hover:border-red-500/20 transition-all duration-150"
            aria-label="Logout"
            onMouseEnter={() => setTooltip("Logout")}
            onMouseLeave={() => setTooltip(null)}
          >
            <LogOut className="w-5 h-5" />
            {tooltip === "Logout" && (
              <div className="absolute left-full ml-3 whitespace-nowrap bg-gray-800 text-white text-xs font-medium px-2.5 py-1.5 rounded-lg shadow-xl pointer-events-none z-50 border border-white/10">
                Logout
              </div>
            )}
          </button>
        </div>
      </aside>

      {/* ── Main content area (offset by sidebar) ────────────────────── */}
      <main className="flex-1 md:pl-16 pb-16 md:pb-0 min-h-screen">
        {children}
      </main>

      {/* ── Mobile bottom nav ─────────────────────────────────────────── */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-gray-900/95 backdrop-blur-md border-t border-white/5 flex items-center justify-around h-16 px-2">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.path);
          return (
            <button
              key={item.path}
              onClick={() => setLocation(item.path)}
              className={`flex flex-col items-center gap-1 px-3 py-1 rounded-xl transition-all ${
                active ? `${item.color}` : "text-white/35 hover:text-white/60"
              }`}
            >
              <Icon className="w-5 h-5" />
              <span className="text-[9px] font-medium leading-none">
                {item.label.split(" ")[0]}
              </span>
            </button>
          );
        })}
        <button
          onClick={logout}
          className="flex flex-col items-center gap-1 px-3 py-1 rounded-xl text-white/30 hover:text-red-400 transition-all"
        >
          <LogOut className="w-5 h-5" />
          <span className="text-[9px] font-medium leading-none">Logout</span>
        </button>
      </nav>
    </div>
  );
}
