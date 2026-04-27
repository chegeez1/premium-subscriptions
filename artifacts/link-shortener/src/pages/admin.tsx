import { useState, useEffect } from "react";
import { NavBar } from "@/components/nav-bar";
import {
  CreditCard, Mail, Copy, Check, Loader2, Download,
  CheckCircle2, XCircle, AlertCircle, Zap, BarChart3,
  Link2, MousePointerClick, RefreshCw, Trash2,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface CardResult {
  card: string;
  status: "Live" | "Dead" | "Invalid" | "Error";
  message: string;
  bank: string;
  type: string;
  category: string;
  country: string;
  emoji: string;
}

interface BulkCheckResponse {
  results: CardResult[];
  live: number;
  dead: number;
  total: number;
}

interface StatsData {
  totalLinks: number;
  totalClicks: number;
}

const DOMAINS = [
  { label: "Random (mixed)", value: "random" },
  { label: "yopmail.com", value: "yopmail.com" },
  { label: "guerrillamail.com", value: "guerrillamail.com" },
  { label: "sharklasers.com", value: "sharklasers.com" },
  { label: "mailnull.com", value: "mailnull.com" },
  { label: "mailsac.com", value: "mailsac.com" },
  { label: "trashmail.com", value: "trashmail.com" },
  { label: "fakeinbox.com", value: "fakeinbox.com" },
  { label: "grr.la", value: "grr.la" },
];

const FORMATS = [
  { label: "name + number (alex1234)", value: "name_num" },
  { label: "word + word (quicktiger)", value: "word_word" },
  { label: "word + word + number", value: "word_word_num" },
  { label: "random characters", value: "random" },
];

export default function AdminDashboard() {
  const { toast } = useToast();

  // Stats
  const [stats, setStats] = useState<StatsData | null>(null);

  // CC Bulk Checker
  const [ccInput, setCcInput] = useState("");
  const [ccResults, setCcResults] = useState<CardResult[] | null>(null);
  const [ccSummary, setCcSummary] = useState<{ live: number; dead: number; total: number } | null>(null);
  const [ccLoading, setCcLoading] = useState(false);
  const [copiedCard, setCopiedCard] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"cc" | "mail">("cc");

  // Mail Generator
  const [mailCount, setMailCount] = useState("20");
  const [mailDomain, setMailDomain] = useState("random");
  const [mailFormat, setMailFormat] = useState("name_num");
  const [mailResults, setMailResults] = useState<string[] | null>(null);
  const [mailLoading, setMailLoading] = useState(false);
  const [copiedMail, setCopiedMail] = useState<string | null>(null);
  const [copiedAll, setCopiedAll] = useState(false);

  useEffect(() => {
    fetch(`${BASE}/api/links/stats`)
      .then((r) => r.json())
      .then((d) => setStats({ totalLinks: d.totalLinks ?? 0, totalClicks: d.totalClicks ?? 0 }))
      .catch(() => {});
  }, []);

  const handleBulkCheck = async () => {
    const lines = ccInput.split("\n").map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return;
    setCcLoading(true);
    setCcResults(null);
    setCcSummary(null);
    try {
      const r = await fetch(`${BASE}/api/tools/cc/bulk-check`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cards: lines }),
      });
      const d: BulkCheckResponse = await r.json();
      setCcResults(d.results);
      setCcSummary({ live: d.live, dead: d.dead, total: d.total });
    } catch {
      toast({ title: "Error", description: "Bulk check failed.", variant: "destructive" });
    }
    setCcLoading(false);
  };

  const handleMailGenerate = async () => {
    setMailLoading(true);
    setMailResults(null);
    try {
      const r = await fetch(`${BASE}/api/tools/mail/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ count: parseInt(mailCount) || 20, domain: mailDomain, format: mailFormat }),
      });
      const d = await r.json();
      setMailResults(d.emails);
    } catch {
      toast({ title: "Error", description: "Mail generation failed.", variant: "destructive" });
    }
    setMailLoading(false);
  };

  const copyText = (text: string, setter: (v: string | null) => void) => {
    navigator.clipboard.writeText(text);
    setter(text);
    setTimeout(() => setter(null), 1500);
  };

  const copyAllMails = () => {
    if (!mailResults) return;
    navigator.clipboard.writeText(mailResults.join("\n"));
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 1500);
    toast({ title: "Copied!", description: `${mailResults.length} emails copied.`, duration: 2000 });
  };

  const downloadMails = () => {
    if (!mailResults) return;
    const blob = new Blob([mailResults.join("\n")], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "generated-emails.txt";
    a.click();
  };

  const downloadLive = () => {
    if (!ccResults) return;
    const live = ccResults.filter((r) => r.status === "Live").map((r) => r.card);
    if (!live.length) return;
    const blob = new Blob([live.join("\n")], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "live-cards.txt";
    a.click();
  };

  const liveCards = ccResults?.filter((r) => r.status === "Live") ?? [];

  const statusIcon = (s: string) => {
    if (s === "Live") return <CheckCircle2 className="w-4 h-4 text-primary shrink-0" />;
    if (s === "Dead") return <XCircle className="w-4 h-4 text-destructive shrink-0" />;
    return <AlertCircle className="w-4 h-4 text-yellow-500 shrink-0" />;
  };

  const statusBadge = (s: string) => {
    if (s === "Live") return "bg-primary/15 text-primary border-primary/30";
    if (s === "Dead") return "bg-destructive/15 text-destructive border-destructive/30";
    return "bg-yellow-500/10 text-yellow-400 border-yellow-500/20";
  };

  return (
    <div className="min-h-[100dvh] w-full flex flex-col items-center bg-background text-foreground">
      <NavBar />

      <main className="w-full max-w-7xl px-4 sm:px-6 pb-16">
        {/* Header */}
        <div className="mb-8 space-y-1">
          <h1 className="text-3xl font-black tracking-tight text-white">
            Admin <span className="text-primary">Dashboard</span>
          </h1>
          <p className="text-muted-foreground text-sm">Bulk CC checker · Email generator · Stats</p>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          {[
            { icon: Link2, label: "Total Links", value: stats ? stats.totalLinks : "—", color: "text-indigo-400" },
            { icon: MousePointerClick, label: "Total Clicks", value: stats ? stats.totalClicks : "—", color: "text-sky-400" },
            { icon: CreditCard, label: "Cards Checked", value: ccSummary ? ccSummary.total : "—", color: "text-violet-400" },
            { icon: Mail, label: "Emails Generated", value: mailResults ? mailResults.length : "—", color: "text-emerald-400" },
          ].map(({ icon: Icon, label, value, color }) => (
            <div key={label} className="bg-card/50 border border-border rounded-xl p-4 flex items-center gap-3">
              <div className={`p-2 rounded-lg bg-white/5 ${color}`}>
                <Icon className="w-5 h-5" />
              </div>
              <div>
                <p className="text-2xl font-bold text-white">{value}</p>
                <p className="text-xs text-muted-foreground">{label}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Main tabs */}
        <div className="flex gap-2 mb-6 bg-card/60 p-1 rounded-xl border border-border w-fit">
          <button
            onClick={() => setActiveTab("cc")}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold transition-all ${
              activeTab === "cc" ? "bg-primary text-black" : "text-muted-foreground hover:text-white"
            }`}
          >
            <CreditCard className="w-4 h-4" /> CC Bulk Checker
          </button>
          <button
            onClick={() => setActiveTab("mail")}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold transition-all ${
              activeTab === "mail" ? "bg-primary text-black" : "text-muted-foreground hover:text-white"
            }`}
          >
            <Mail className="w-4 h-4" /> Email Generator
          </button>
        </div>

        {/* ── CC Bulk Checker ── */}
        {activeTab === "cc" && (
          <div className="grid lg:grid-cols-5 gap-6">
            {/* Input panel */}
            <div className="lg:col-span-2 space-y-4">
              <div className="bg-card/50 border border-border rounded-xl p-5">
                <h2 className="text-base font-bold text-white mb-1">Paste Cards</h2>
                <p className="text-xs text-muted-foreground mb-3">Format: <span className="font-mono text-white/60">number|mm|yy|cvv</span> · one per line · max 50</p>
                <textarea
                  value={ccInput}
                  onChange={(e) => setCcInput(e.target.value)}
                  placeholder={"4532015112830366|12|27|123\n5500005555555559|01|26|456\n..."}
                  rows={14}
                  className="w-full bg-background border border-border rounded-lg px-3 py-2.5 text-sm font-mono text-white/80 placeholder-muted-foreground resize-y focus:outline-none focus:border-primary/50"
                />
                <div className="flex items-center justify-between mt-3">
                  <span className="text-xs text-muted-foreground">
                    {ccInput.split("\n").filter((l) => l.trim()).length} card(s)
                  </span>
                  <div className="flex gap-2">
                    <button
                      onClick={() => { setCcInput(""); setCcResults(null); setCcSummary(null); }}
                      className="px-3 py-1.5 rounded-lg text-xs text-muted-foreground bg-white/5 border border-border hover:bg-white/10 flex items-center gap-1"
                    >
                      <Trash2 className="w-3 h-3" /> Clear
                    </button>
                    <button
                      onClick={handleBulkCheck}
                      disabled={ccLoading || !ccInput.trim()}
                      className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-primary text-black hover:bg-primary/90 disabled:opacity-40 flex items-center gap-1.5 transition-colors"
                    >
                      {ccLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
                      {ccLoading ? "Checking..." : "Check All"}
                    </button>
                  </div>
                </div>
              </div>

              {/* Summary */}
              {ccSummary && (
                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-primary/10 border border-primary/25 rounded-xl p-3 text-center">
                    <p className="text-2xl font-bold text-primary">{ccSummary.live}</p>
                    <p className="text-xs text-muted-foreground">Live</p>
                  </div>
                  <div className="bg-destructive/10 border border-destructive/25 rounded-xl p-3 text-center">
                    <p className="text-2xl font-bold text-destructive">{ccSummary.dead}</p>
                    <p className="text-xs text-muted-foreground">Dead</p>
                  </div>
                  <div className="bg-white/5 border border-border rounded-xl p-3 text-center">
                    <p className="text-2xl font-bold text-white">{ccSummary.total}</p>
                    <p className="text-xs text-muted-foreground">Total</p>
                  </div>
                </div>
              )}

              {liveCards.length > 0 && (
                <button
                  onClick={downloadLive}
                  className="w-full py-2.5 rounded-xl bg-primary/15 border border-primary/30 text-primary text-sm font-semibold hover:bg-primary/25 flex items-center justify-center gap-2 transition-colors"
                >
                  <Download className="w-4 h-4" /> Download {liveCards.length} live cards
                </button>
              )}
            </div>

            {/* Results table */}
            <div className="lg:col-span-3">
              <div className="bg-card/40 border border-border rounded-xl overflow-hidden min-h-[400px]">
                <div className="px-5 py-4 border-b border-border flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <BarChart3 className="w-4 h-4 text-muted-foreground" />
                    <h2 className="text-sm font-semibold text-white">Results</h2>
                    {ccResults && <span className="text-xs text-muted-foreground">({ccResults.length})</span>}
                  </div>
                  {ccResults && (
                    <button
                      onClick={() => { setCcResults(null); setCcSummary(null); setCcInput(""); }}
                      className="text-xs text-muted-foreground hover:text-white flex items-center gap-1"
                    >
                      <RefreshCw className="w-3 h-3" /> Reset
                    </button>
                  )}
                </div>

                {ccLoading ? (
                  <div className="flex flex-col items-center justify-center py-24 gap-3 text-muted-foreground">
                    <Loader2 className="w-8 h-8 animate-spin text-primary" />
                    <p className="text-sm">Checking cards via Luhn + BIN lookup…</p>
                  </div>
                ) : ccResults ? (
                  <div className="divide-y divide-border/40 overflow-auto max-h-[600px]">
                    {ccResults.map((r, i) => (
                      <div key={i} className={`flex items-center gap-3 px-4 py-3 hover:bg-white/3 transition-colors group ${r.status === "Live" ? "bg-primary/3" : ""}`}>
                        {statusIcon(r.status)}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${statusBadge(r.status)}`}>
                              {r.status.toUpperCase()}
                            </span>
                            <span className="font-mono text-xs text-white/70 truncate">{r.card}</span>
                          </div>
                          {(r.bank || r.country) && (
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {r.bank}{r.bank && r.country ? " · " : ""}{r.emoji} {r.country}
                              {r.type ? ` · ${r.type}` : ""}
                              {r.category ? ` · ${r.category}` : ""}
                            </p>
                          )}
                          {!r.bank && <p className="text-xs text-muted-foreground mt-0.5">{r.message}</p>}
                        </div>
                        <button
                          onClick={() => copyText(r.card, setCopiedCard)}
                          className="shrink-0 opacity-0 group-hover:opacity-100 p-1.5 rounded bg-white/5 hover:bg-white/15 text-muted-foreground transition-all"
                        >
                          {copiedCard === r.card ? <Check className="w-3.5 h-3.5 text-primary" /> : <Copy className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-24 gap-3 text-muted-foreground">
                    <CreditCard className="w-12 h-12 opacity-15" />
                    <p className="text-sm">Paste cards and click Check All</p>
                    <p className="text-xs text-muted-foreground/50">Results appear here with bank info</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── Email Generator ── */}
        {activeTab === "mail" && (
          <div className="grid lg:grid-cols-5 gap-6">
            {/* Controls */}
            <div className="lg:col-span-2 space-y-4">
              <div className="bg-card/50 border border-border rounded-xl p-5 space-y-4">
                <div>
                  <h2 className="text-base font-bold text-white mb-1">Mail Generator</h2>
                  <p className="text-xs text-muted-foreground">Generate bulk disposable email addresses</p>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Count (max 100)</label>
                  <input
                    type="number"
                    min="1"
                    max="100"
                    value={mailCount}
                    onChange={(e) => setMailCount(e.target.value)}
                    className="w-full bg-background border border-border rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-primary/50"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Domain</label>
                  <select
                    value={mailDomain}
                    onChange={(e) => setMailDomain(e.target.value)}
                    className="w-full bg-background border border-border rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-primary/50"
                  >
                    {DOMAINS.map((d) => (
                      <option key={d.value} value={d.value}>{d.label}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Username Format</label>
                  <select
                    value={mailFormat}
                    onChange={(e) => setMailFormat(e.target.value)}
                    className="w-full bg-background border border-border rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-primary/50"
                  >
                    {FORMATS.map((f) => (
                      <option key={f.value} value={f.value}>{f.label}</option>
                    ))}
                  </select>
                </div>

                <button
                  onClick={handleMailGenerate}
                  disabled={mailLoading}
                  className="w-full py-2.5 rounded-xl bg-primary text-black text-sm font-bold hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-2 transition-colors"
                >
                  {mailLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                  {mailLoading ? "Generating..." : "Generate Emails"}
                </button>
              </div>

              {mailResults && (
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={copyAllMails}
                    className="py-2.5 rounded-xl bg-primary/15 border border-primary/30 text-primary text-sm font-semibold hover:bg-primary/25 flex items-center justify-center gap-2 transition-colors"
                  >
                    {copiedAll ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    {copiedAll ? "Copied!" : "Copy All"}
                  </button>
                  <button
                    onClick={downloadMails}
                    className="py-2.5 rounded-xl bg-white/5 border border-border text-white/70 text-sm font-semibold hover:bg-white/10 flex items-center justify-center gap-2 transition-colors"
                  >
                    <Download className="w-4 h-4" /> Download
                  </button>
                </div>
              )}
            </div>

            {/* Results */}
            <div className="lg:col-span-3">
              <div className="bg-card/40 border border-border rounded-xl overflow-hidden min-h-[400px]">
                <div className="px-5 py-4 border-b border-border flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Mail className="w-4 h-4 text-muted-foreground" />
                    <h2 className="text-sm font-semibold text-white">Generated Emails</h2>
                    {mailResults && <span className="text-xs text-muted-foreground">({mailResults.length})</span>}
                  </div>
                </div>

                {mailLoading ? (
                  <div className="flex flex-col items-center justify-center py-24 gap-3 text-muted-foreground">
                    <Loader2 className="w-8 h-8 animate-spin text-primary" />
                    <p className="text-sm">Generating addresses…</p>
                  </div>
                ) : mailResults ? (
                  <div className="divide-y divide-border/40 overflow-auto max-h-[600px]">
                    {mailResults.map((email, i) => (
                      <div key={i} className="flex items-center gap-3 px-4 py-2.5 hover:bg-white/3 transition-colors group">
                        <span className="text-xs text-muted-foreground w-6 shrink-0 text-right">{i + 1}</span>
                        <span className="flex-1 font-mono text-sm text-white/80 truncate">{email}</span>
                        <button
                          onClick={() => copyText(email, setCopiedMail)}
                          className="shrink-0 opacity-0 group-hover:opacity-100 p-1.5 rounded bg-white/5 hover:bg-white/15 text-muted-foreground transition-all"
                        >
                          {copiedMail === email ? <Check className="w-3.5 h-3.5 text-primary" /> : <Copy className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-24 gap-3 text-muted-foreground">
                    <Mail className="w-12 h-12 opacity-15" />
                    <p className="text-sm">Configure options and click generate</p>
                    <p className="text-xs text-muted-foreground/50">Addresses appear here ready to copy</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
