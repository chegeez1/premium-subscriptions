import { useState, useEffect, useCallback } from "react";
import { Loader2 } from "lucide-react";
import { Switch, Route, useLocation, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Store from "@/pages/Store";
import Checkout from "@/pages/Checkout";
import CartCheckout from "@/pages/CartCheckout";
import PaymentSuccess from "@/pages/PaymentSuccess";
import Admin from "@/pages/Admin";
import AdminPlanPreviews from "@/pages/AdminPlanPreviews";
import Auth from "@/pages/Auth";
import Dashboard from "@/pages/Dashboard";
import NotFound from "@/pages/not-found";
import Docs from "@/pages/Docs";
import Privacy from "@/pages/Privacy";
import Track from "@/pages/Track";
import BotStore from "@/pages/BotStore";
import BotCheckout from "@/pages/BotCheckout";
import BotOrder from "@/pages/BotOrder";
import ChatWidget from "@/components/ChatWidget";
import CookieConsent from "@/components/CookieConsent";

const NO_CHAT_PATHS = ["/admin", "/docs", "/privacy", "/track", "/bots"];
const PUBLIC_PATHS = ["/auth", "/admin", "/payment/callback", "/payment/success", "/docs", "/privacy", "/track", "/bots"];
const NO_COOKIE_PATHS = ["/admin"];

function Router() {
  const [location] = useLocation();
  const showChat = !NO_CHAT_PATHS.some((p) => location.startsWith(p));
  const showCookies = !NO_COOKIE_PATHS.some((p) => location.startsWith(p));

  // null = still verifying via server, true/false = resolved
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(() => {
    const token = localStorage.getItem("customer_token");
    const data = localStorage.getItem("customer_data");
    return (token && data) ? true : null;
  });

  // On mount: if localStorage is missing, check the persistent cookie session
  useEffect(() => {
    if (isAuthenticated !== null) return;
    const token = localStorage.getItem("customer_token");
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    fetch("/api/auth/me", { headers, credentials: "include" })
      .then((r) => r.json())
      .then((d) => {
        if (d.success) {
          if (d.token) localStorage.setItem("customer_token", d.token);
          localStorage.setItem("customer_data", JSON.stringify(d.customer));
          setIsAuthenticated(true);
        } else {
          localStorage.removeItem("customer_token");
          localStorage.removeItem("customer_data");
          setIsAuthenticated(false);
        }
      })
      .catch(() => setIsAuthenticated(false));
  }, []);

  // Keep watching localStorage so logout propagates across tabs
  useEffect(() => {
    const checkAuth = () => {
      setIsAuthenticated((prev) => {
        if (prev === null) return prev;
        return !!localStorage.getItem("customer_token");
      });
    };
    window.addEventListener("storage", checkAuth);
    const interval = setInterval(checkAuth, 1000);
    return () => {
      window.removeEventListener("storage", checkAuth);
      clearInterval(interval);
    };
  }, []);

  const isPublic = PUBLIC_PATHS.some((p) => location.startsWith(p));

  // Still verifying cookie session — don't redirect yet
  if (isAuthenticated === null && !isPublic) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-white/30" />
      </div>
    );
  }

  if (!isAuthenticated && !isPublic) {
    return <Redirect to="/auth" />;
  }

  return (
    <>
      <Switch>
        <Route path="/" component={Store} />
        <Route path="/checkout" component={Checkout} />
        <Route path="/cart-checkout" component={CartCheckout} />
        <Route path="/payment/callback" component={PaymentSuccess} />
        <Route path="/payment/success" component={PaymentSuccess} />
        <Route path="/auth" component={Auth} />
        <Route path="/dashboard" component={Dashboard} />
        <Route path="/admin/plan-previews" component={AdminPlanPreviews} />
        <Route path="/admin" component={Admin} />
        <Route path="/track" component={Track} />
        <Route path="/docs" component={Docs} />
        <Route path="/privacy" component={Privacy} />
        <Route path="/bots" component={BotStore} />
        <Route path="/bots/checkout/:botId" component={BotCheckout} />
        <Route path="/bots/order/:reference" component={BotOrder} />
        <Route component={NotFound} />
      </Switch>
      {showChat && <ChatWidget />}
      {showCookies && <CookieConsent />}
    </>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
