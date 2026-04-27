import { useState, useEffect, useCallback } from "react";
import { Mail, Copy, Check, RefreshCw, Inbox, ArrowLeft, Loader2, Trash2, ExternalLink } from "lucide-react";

const SESSION_KEY = "ct_tempmail";

interface MailSession { address: string; token: string; }
interface Message { id: string; from: { address: string; name: string }; subject: string; createdAt: string; seen: boolean; }
interface FullMessage extends Message { html?: string[]; text?: string; }

function saveSession(s: MailSession) { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); }
function loadSession(): MailSession | null { try { return JSON.parse(localStorage.getItem(SESSION_KEY)||"null"); } catch { return null; } }

export default function TempMailPage() {
  const [session, setSession] = useState<MailSession|null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [selected, setSelected] = useState<FullMessage|null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date|null>(null);
  const [newCount, setNewCount] = useState(0);

  const create = useCallback(async () => {
    setCreating(true); setMessages([]); setSelected(null); setNewCount(0);
    try {
      const r = await fetch("/api/tempmail/create", { method:"POST" });
      const d = await r.json();
      if (d.success) { const s = { address: d.address, token: d.token }; saveSession(s); setSession(s); }
      else console.error("TempMail create failed:", d.error);
    } catch(e) { console.error(e); }
    setCreating(false); setLoading(false);
  }, []);

  const fetchInbox = useCallback(async (tok: string, silent=false) => {
    if (!silent) setRefreshing(true);
    try {
      const r = await fetch(`/api/tempmail/inbox?token=${encodeURIComponent(tok)}`);
      const d = await r.json();
      if (d.success) {
        setMessages(prev => {
          const ids = new Set(prev.map(m=>m.id));
          const fresh = (d.messages as Message[]).filter(m=>!ids.has(m.id));
          if (fresh.length) setNewCount(n=>n+fresh.length);
          return d.messages;
        });
        setLastRefresh(new Date());
      } else if (d.expired) { localStorage.removeItem(SESSION_KEY); setSession(null); create(); }
    } catch {}
    if (!silent) setRefreshing(false);
  }, [create]);

  const readMessage = useCallback(async (msg: Message) => {
    if (!session) return;
    setSelected(msg as FullMessage);
    setNewCount(n=>Math.max(0,n-1));
    try {
      const r = await fetch(`/api/tempmail/read/${msg.id}?token=${encodeURIComponent(session.token)}`);
      const d = await r.json();
      if (d.success) setSelected(d.message);
    } catch {}
  }, [session]);

  // Init
  useEffect(() => {
    const saved = loadSession();
    if (saved) { setSession(saved); fetchInbox(saved.token).finally(()=>setLoading(false)); }
    else create();
  }, []);

  // Poll inbox every 12s
  useEffect(() => {
    if (!session) return;
    const t = setInterval(()=>fetchInbox(session.token, true), 12000);
    return ()=>clearInterval(t);
  }, [session, fetchInbox]);

  const copy = () => { if(!session) return; navigator.clipboard.writeText(session.address); setCopied(true); setTimeout(()=>setCopied(false),2000); };
  const clear = () => { localStorage.removeItem(SESSION_KEY); create(); };

  const timeAgo = (d: string) => {
    const s = Math.floor((Date.now()-new Date(d).getTime())/1000);
    if(s<60) return `${s}s ago`; if(s<3600) return `${Math.floor(s/60)}m ago`; return `${Math.floor(s/3600)}h ago`;
  };

  if (loading || creating) return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center gap-3">
      <div className="p-3 rounded-2xl bg-sky-500/10 border border-sky-500/20 mb-2"><Mail className="w-7 h-7 text-sky-400"/></div>
      <Loader2 className="w-6 h-6 animate-spin text-sky-400"/>
      <p className="text-white/40 text-sm">{creating?"Generating your inbox...":"Loading..."}</p>
    </div>
  );

  if (selected) return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col">
      <div className="sticky top-0 bg-gray-950/95 backdrop-blur border-b border-white/10 px-4 py-3 flex items-center gap-3 z-10">
        <button onClick={()=>setSelected(null)} className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10"><ArrowLeft className="w-4 h-4"/></button>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-white truncate">{selected.subject||"(no subject)"}</p>
          <p className="text-xs text-white/40">From: {selected.from?.address}</p>
        </div>
        <span className="text-xs text-white/30">{timeAgo(selected.createdAt)}</span>
      </div>
      <div className="flex-1 p-4">
        {selected.html?.length ? (
          <iframe
            srcDoc={selected.html.join("")}
            className="w-full min-h-96 rounded-xl border border-white/10 bg-white"
            sandbox="allow-same-origin"
            title="email-content"
          />
        ) : (
          <pre className="text-sm text-white/70 whitespace-pre-wrap leading-relaxed bg-white/5 border border-white/10 rounded-xl p-4">{selected.text||"(empty message)"}</pre>
        )}
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-950 text-white pb-24">
      <div className="max-w-2xl mx-auto px-4 py-6">

        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 rounded-xl bg-sky-500/10 border border-sky-500/20">
            <Mail className="w-5 h-5 text-sky-400"/>
          </div>
          <div>
            <h1 className="text-2xl font-bold">Free TempMail</h1>
            <p className="text-xs text-white/40">Disposable email — no signup, no tracking</p>
          </div>
        </div>

        {/* Email address card */}
        <div className="bg-white/5 border border-sky-500/20 rounded-2xl p-5 mb-5">
          <p className="text-xs text-white/40 mb-2">Your temporary inbox</p>
          <div className="flex items-center gap-2">
            <div className="flex-1 bg-black/30 border border-white/10 rounded-xl px-4 py-3">
              <p className="text-base font-mono font-bold text-sky-300 break-all select-all">{session?.address}</p>
            </div>
            <button onClick={copy} className={`shrink-0 p-3 rounded-xl border transition-colors ${copied?"bg-emerald-500/10 border-emerald-500/30 text-emerald-400":"bg-white/5 border-white/10 text-white/60 hover:bg-white/10"}`}>
              {copied?<Check className="w-5 h-5"/>:<Copy className="w-5 h-5"/>}
            </button>
          </div>
          <div className="flex items-center gap-2 mt-3">
            <button onClick={()=>session&&fetchInbox(session.token)} disabled={refreshing}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white/50 text-xs hover:bg-white/10 disabled:opacity-40 transition-colors">
              <RefreshCw className={`w-3 h-3 ${refreshing?"animate-spin":""}`}/> Refresh
            </button>
            <button onClick={clear} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white/50 text-xs hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/20 transition-colors">
              <Trash2 className="w-3 h-3"/> New Address
            </button>
            {lastRefresh && <span className="ml-auto text-xs text-white/20">Updated {timeAgo(lastRefresh.toISOString())}</span>}
          </div>
        </div>

        {/* Inbox */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 mb-3">
            <Inbox className="w-4 h-4 text-white/30"/>
            <h2 className="text-sm font-medium text-white/50">Inbox</h2>
            {newCount > 0 && <span className="text-xs bg-sky-500 text-white px-2 py-0.5 rounded-full font-bold">{newCount} new</span>}
            {messages.length > 0 && <span className="ml-auto text-xs text-white/20">{messages.length} message{messages.length!==1?"s":""}</span>}
          </div>

          {messages.length === 0 ? (
            <div className="text-center py-16 text-white/20">
              <Inbox className="w-10 h-10 mx-auto mb-3 opacity-30"/>
              <p className="text-sm">No messages yet</p>
              <p className="text-xs mt-1 text-white/15">Emails sent to your address appear here automatically</p>
              <p className="text-xs mt-3 text-white/15">Inbox refreshes every 12 seconds</p>
            </div>
          ) : (
            messages.map(m => (
              <button key={m.id} onClick={()=>readMessage(m)}
                className={`w-full text-left p-4 rounded-xl border transition-colors ${!m.seen?"bg-sky-500/5 border-sky-500/20":"bg-white/3 border-white/8 hover:bg-white/5"}`}>
                <div className="flex items-start gap-3">
                  <div className={`mt-0.5 w-2 h-2 rounded-full shrink-0 ${!m.seen?"bg-sky-400":"bg-transparent"}`}/>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 mb-0.5">
                      <p className={`text-sm truncate ${!m.seen?"font-semibold text-white":"font-normal text-white/60"}`}>
                        {m.from?.name||m.from?.address||"Unknown sender"}
                      </p>
                      <span className="text-xs text-white/25 shrink-0">{timeAgo(m.createdAt)}</span>
                    </div>
                    <p className={`text-sm truncate ${!m.seen?"text-white/80":"text-white/40"}`}>{m.subject||"(no subject)"}</p>
                    <p className="text-xs text-white/25 truncate mt-0.5">{m.from?.address}</p>
                  </div>
                </div>
              </button>
            ))
          )}
        </div>

        <div className="mt-8 p-4 rounded-2xl bg-white/3 border border-white/8 text-center">
          <p className="text-xs text-white/30">Inbox is temporary — messages are deleted after 24 hours. Do not use for important accounts.</p>
        </div>
      </div>
    </div>
  );
}
