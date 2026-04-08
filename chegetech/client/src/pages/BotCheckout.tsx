import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Bot, ArrowLeft, CheckCircle, Loader2, CreditCard, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

declare global { interface Window { PaystackPop: any; } }

interface BotItem {
  id: number; name: string; description: string; repoUrl: string; price: number;
  features: string[]; requiresSessionId: boolean; requiresDbUrl: boolean;
}

function apiRequest(method: string, url: string, body?: any) {
  return fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  }).then((r) => r.json());
}

function getCustomerData() {
  try { return JSON.parse(localStorage.getItem("customer_data") || "null"); } catch { return null; }
}

const TIMEZONES = [
  "Africa/Nairobi", "Africa/Lagos", "Africa/Johannesburg", "Africa/Accra",
  "America/New_York", "America/Los_Angeles", "Europe/London", "Europe/Berlin",
  "Asia/Dubai", "Asia/Kolkata", "Asia/Singapore",
];

export default function BotCheckout() {
  const { botId } = useParams();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const customer = getCustomerData();

  const [form, setForm] = useState({
    customerName: customer?.name || "",
    customerEmail: customer?.email || "",
    customerPhone: "",
    sessionId: "",
    dbUrl: "",
    mode: "public",
    timezone: "Africa/Nairobi",
  });
  const [step, setStep] = useState<"form" | "processing" | "done">("form");
  const [orderRef, setOrderRef] = useState("");

  const { data, isLoading } = useQuery<{ success: boolean; bot: BotItem }>({
    queryKey: [`/api/bots/${botId}`],
  });

  const bot = data?.bot;

  const initMutation = useMutation({
    mutationFn: (payload: any) => apiRequest("POST", "/api/bots/order/initialize", payload),
    onSuccess: (data) => {
      if (!data.success) {
        toast({ title: "Error", description: data.error, variant: "destructive" });
        setStep("form");
        return;
      }
      setOrderRef(data.reference);
      if (data.paystackConfigured && data.authorizationUrl) {
        openPaystackPopup(data.authorizationUrl, data.reference, data.paystackPublicKey, data.amount);
      } else {
        toast({ title: "Order Created", description: "Your order has been submitted. Admin will contact you for payment." });
        setStep("done");
        setLocation(`/bots/order/${data.reference}`);
      }
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to initialize order", variant: "destructive" });
      setStep("form");
    },
  });

  const verifyMutation = useMutation({
    mutationFn: (ref: string) => apiRequest("POST", "/api/bots/order/verify", { reference: ref }),
    onSuccess: (data, ref) => {
      if (data.success) {
        toast({ title: "Payment Confirmed!", description: "Your bot will be deployed shortly." });
        setLocation(`/bots/order/${ref}`);
      } else {
        toast({ title: "Payment pending", description: "Please wait while we confirm your payment.", variant: "destructive" });
      }
    },
    onError: () => {
      toast({ title: "Verification failed", description: "Please check your order status.", variant: "destructive" });
    },
  });

  function openPaystackPopup(authUrl: string, reference: string, pubKey: string, amount: number) {
    if (!pubKey || !window.PaystackPop) {
      window.open(authUrl, "_blank");
      toast({ title: "Redirecting to Paystack", description: "Complete payment and return here." });
      return;
    }
    const handler = window.PaystackPop.setup({
      key: pubKey,
      email: form.customerEmail,
      amount: amount * 100,
      currency: "KES",
      ref: reference,
      onSuccess: (response: any) => {
        setStep("processing");
        verifyMutation.mutate(response.reference);
      },
      onClose: () => {
        toast({ title: "Payment cancelled", description: "You closed the payment window." });
        setStep("form");
      },
    });
    handler.openIframe();
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.customerName || !form.customerEmail || !form.customerPhone) {
      toast({ title: "Missing fields", description: "Please fill in all required fields.", variant: "destructive" });
      return;
    }
    if (bot?.requiresSessionId && !form.sessionId) {
      toast({ title: "Session ID required", description: "Please provide your WhatsApp session ID.", variant: "destructive" });
      return;
    }
    setStep("processing");
    initMutation.mutate({ botId, ...form });
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-green-400" />
      </div>
    );
  }

  if (!bot) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center text-white">
        <div className="text-center">
          <p className="text-gray-400 mb-4">Bot not found</p>
          <Button onClick={() => setLocation("/bots")} className="bg-green-500 hover:bg-green-600">Back to Bots</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950 text-white py-8 px-4">
      <div className="max-w-2xl mx-auto">
        <button onClick={() => setLocation("/bots")} className="flex items-center gap-2 text-gray-400 hover:text-white mb-6 transition-colors">
          <ArrowLeft className="w-4 h-4" /> Back to Bots
        </button>

        {/* Order summary */}
        <div className="bg-white/[0.03] border border-white/5 rounded-2xl p-5 mb-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center">
              <Bot className="w-5 h-5 text-white" />
            </div>
            <div>
              <p className="text-xs text-gray-400">Deploying</p>
              <h2 className="font-semibold text-white">{bot.name}</h2>
            </div>
            <div className="ml-auto">
              <span className="text-2xl font-bold text-green-400">KES {bot.price}</span>
              <p className="text-xs text-gray-500 text-right">One-time</p>
            </div>
          </div>
          <ul className="grid grid-cols-2 gap-1.5">
            {bot.features.map((f) => (
              <li key={f} className="flex items-center gap-1.5 text-xs text-gray-400">
                <CheckCircle className="w-3 h-3 text-green-500 shrink-0" />{f}
              </li>
            ))}
          </ul>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="bg-white/[0.03] border border-white/5 rounded-2xl p-6 space-y-5">
          <h3 className="font-semibold text-white text-lg">Your Details</h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-gray-300 text-sm">Full Name *</Label>
              <Input value={form.customerName} onChange={(e) => setForm({ ...form, customerName: e.target.value })}
                placeholder="John Doe" className="bg-white/5 border-white/10 text-white" required />
            </div>
            <div className="space-y-1.5">
              <Label className="text-gray-300 text-sm">Email *</Label>
              <Input type="email" value={form.customerEmail} onChange={(e) => setForm({ ...form, customerEmail: e.target.value })}
                placeholder="john@example.com" className="bg-white/5 border-white/10 text-white" required />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-gray-300 text-sm">Phone Number *</Label>
            <Input value={form.customerPhone} onChange={(e) => setForm({ ...form, customerPhone: e.target.value })}
              placeholder="+254 7XX XXX XXX" className="bg-white/5 border-white/10 text-white" required />
          </div>

          {bot.requiresSessionId && (
            <div className="space-y-1.5">
              <Label className="text-gray-300 text-sm">Session ID *</Label>
              <div className="flex items-start gap-2">
                <Input value={form.sessionId} onChange={(e) => setForm({ ...form, sessionId: e.target.value })}
                  placeholder='Gifted~xxxxxx...' className="bg-white/5 border-white/10 text-white font-mono text-xs" required />
              </div>
              <p className="text-xs text-gray-500 flex items-start gap-1">
                <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                Get your session ID by running the bot locally and scanning the QR code. It starts with "Gifted~".
              </p>
            </div>
          )}

          {bot.requiresDbUrl && (
            <div className="space-y-1.5">
              <Label className="text-gray-300 text-sm">Database URL (optional)</Label>
              <Input value={form.dbUrl} onChange={(e) => setForm({ ...form, dbUrl: e.target.value })}
                placeholder="postgresql://..." className="bg-white/5 border-white/10 text-white font-mono text-xs" />
              <p className="text-xs text-gray-500">Leave blank to use a shared database.</p>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-gray-300 text-sm">Mode</Label>
              <Select value={form.mode} onValueChange={(v) => setForm({ ...form, mode: v })}>
                <SelectTrigger className="bg-white/5 border-white/10 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="public">Public (everyone can use)</SelectItem>
                  <SelectItem value="private">Private (only you)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-gray-300 text-sm">Timezone</Label>
              <Select value={form.timezone} onValueChange={(v) => setForm({ ...form, timezone: v })}>
                <SelectTrigger className="bg-white/5 border-white/10 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIMEZONES.map((tz) => <SelectItem key={tz} value={tz}>{tz}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <Button
            type="submit"
            disabled={step === "processing" || initMutation.isPending || verifyMutation.isPending}
            className="w-full bg-green-500 hover:bg-green-600 text-white font-semibold py-5 text-base"
          >
            {step === "processing" || initMutation.isPending || verifyMutation.isPending ? (
              <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Processing...</>
            ) : (
              <><CreditCard className="w-4 h-4 mr-2" /> Pay KES {bot.price} & Deploy</>
            )}
          </Button>

          <p className="text-xs text-gray-500 text-center">
            Secured by Paystack · One-time payment · No recurring charges
          </p>
        </form>
      </div>
    </div>
  );
}
