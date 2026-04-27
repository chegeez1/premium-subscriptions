import { useEffect, useRef, useState, useCallback } from "react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine
} from "recharts";
import {
  TrendingUp, TrendingDown, Activity, Play, Square, RefreshCw,
  DollarSign, Percent, Zap, BarChart2, Clock, AlertTriangle
} from "lucide-react";

// ── Utility math ──────────────────────────────────────────────────────────────
function calcEMA(prices: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const out: number[] = [];
  let prev = prices[0];
  for (const p of prices) {
    const ema = p * k + prev * (1 - k);
    out.push(ema);
    prev = ema;
  }
  return out;
}

function calcRSI(prices: number[], period = 14): number[] {
  if (prices.length < period + 1) return prices.map(() => 50);
  const gains: number[] = [];
  const losses: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    const diff = prices[i] - prices[i - 1];
    gains.push(Math.max(diff, 0));
    losses.push(Math.max(-diff, 0));
  }
  const out: number[] = Array(period + 1).fill(50);
  let avgG = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let avgL = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < gains.length; i++) {
    avgG = (avgG * (period - 1) + gains[i]) / period;
    avgL = (avgL * (period - 1) + losses[i]) / period;
    out.push(avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL));
  }
  return out;
}

// ── Types ─────────────────────────────────────────────────────────────────────
type Candle = { time: string; open: number; high: number; low: number; close: number; ts: number };
type Position = { entryPrice: number; entryTime: string; size: number; pair: string };
type Trade = { id: number; pair: string; side: "BUY" | "SELL"; price: number; pnl: number; time: string; reason: string };
type Signal = "BUY" | "SELL" | "HOLD";

const PAIRS = ["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT"];
const INTERVALS = ["1m", "3m", "5m", "15m"];
const RISK_OPTIONS = [1, 2, 3, 5];
const WS_BASE = "wss://stream.binance.com:9443/ws";

export default function BotPage() {
  const [pair, setPair] = useState("BTCUSDT");
  const [interval, setInterval_] = useState("1m");
  const [riskPct, setRiskPct] = useState(2);
  const [running, setRunning] = useState(false);
  const [balance, setBalance] = useState(10000);
  const [position, setPosition] = useState<Position | null>(null);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [currentPrice, setCurrentPrice] = useState(0);
  const [signal, setSignal] = useState<Signal>("HOLD");
  const [log, setLog] = useState<string[]>([]);
  const [ema9, setEma9] = useState<number[]>([]);
  const [ema21, setEma21] = useState<number[]>([]);
  const [rsi, setRsi] = useState<number[]>([]);
  const [wsStatus, setWsStatus] = useState<"disconnected" | "connecting" | "connected">("disconnected");
  const wsRef = useRef<WebSocket | null>(null);
  const tradeIdRef = useRef(1);
  const balanceRef = useRef(balance);
  const positionRef = useRef(position);

  balanceRef.current = balance;
  positionRef.current = position;

  const addLog = useCallback((msg: string) => {
    const ts = new Date().toLocaleTimeString();
    setLog(prev => [`[${ts}] ${msg}`, ...prev].slice(0, 80));
  }, []);

  // ── Fetch historical candles ────────────────────────────────────────────────
  const fetchHistory = useCallback(async (p: string, iv: string) => {
    try {
      const res = await fetch(
        `https://api.binance.com/api/v3/klines?symbol=${p}&interval=${iv}&limit=120`
      );
      const raw: any[][] = await res.json();
      const c: Candle[] = raw.map(k => ({
        ts: k[0],
        time: new Date(k[0]).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        open: parseFloat(k[1]),
        high: parseFloat(k[2]),
        low: parseFloat(k[3]),
        close: parseFloat(k[4]),
      }));
      setCandles(c);
      if (c.length) setCurrentPrice(c[c.length - 1].close);
      addLog(`Loaded ${c.length} candles for ${p}/${iv}`);
      return c;
    } catch {
      addLog("Failed to fetch history — check network");
      return [];
    }
  }, [addLog]);

  // ── Strategy engine ─────────────────────────────────────────────────────────
  const runStrategy = useCallback((cs: Candle[]): Signal => {
    if (cs.length < 30) return "HOLD";
    const closes = cs.map(c => c.close);
    const e9 = calcEMA(closes, 9);
    const e21 = calcEMA(closes, 21);
    const rs = calcRSI(closes, 14);
    setEma9(e9);
    setEma21(e21);
    setRsi(rs);
    const n = closes.length - 1;
    const crossedUp = e9[n] > e21[n] && e9[n - 1] <= e21[n - 1];
    const crossedDown = e9[n] < e21[n] && e9[n - 1] >= e21[n - 1];
    const rsiNow = rs[n] ?? 50;
    if (crossedUp && rsiNow < 70) return "BUY";
    if (crossedDown && rsiNow > 30) return "SELL";
    return "HOLD";
  }, []);

  // ── Paper trade execution ───────────────────────────────────────────────────
  const executeTrade = useCallback((sig: Signal, price: number, candleTime: string) => {
    const bal = balanceRef.current;
    const pos = positionRef.current;

    if (sig === "BUY" && !pos) {
      const size = (bal * riskPct) / 100 / price;
      const newPos: Position = { entryPrice: price, entryTime: candleTime, size, pair };
      setPosition(newPos);
      positionRef.current = newPos;
      addLog(`🟢 BUY  ${pair} @ $${price.toFixed(2)} | size: ${size.toFixed(6)}`);
    } else if (sig === "SELL" && pos) {
      const pnl = (price - pos.entryPrice) * pos.size;
      const newBal = bal + pnl;
      setBalance(newBal);
      balanceRef.current = newBal;
      const t: Trade = {
        id: tradeIdRef.current++,
        pair,
        side: "SELL",
        price,
        pnl,
        time: candleTime,
        reason: "EMA crossdown",
      };
      setTrades(prev => [t, ...prev].slice(0, 50));
      setPosition(null);
      positionRef.current = null;
      addLog(`🔴 SELL ${pair} @ $${price.toFixed(2)} | PnL: ${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)}`);
    }
  }, [pair, riskPct, addLog]);

  // ── WebSocket ────────────────────────────────────────────────────────────────
  const connectWS = useCallback((p: string, iv: string, history: Candle[]) => {
    if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
    setWsStatus("connecting");
    const ws = new WebSocket(`${WS_BASE}/${p.toLowerCase()}@kline_${iv}`);
    wsRef.current = ws;

    ws.onopen = () => { setWsStatus("connected"); addLog(`WebSocket connected: ${p}@kline_${iv}`); };
    ws.onclose = () => { setWsStatus("disconnected"); addLog("WebSocket disconnected"); };
    ws.onerror = () => { addLog("WebSocket error"); setWsStatus("disconnected"); };

    const localCandles = [...history];

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        const k = msg.k;
        if (!k) return;
        const candle: Candle = {
          ts: k.t,
          time: new Date(k.t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          open: parseFloat(k.o),
          high: parseFloat(k.h),
          low: parseFloat(k.l),
          close: parseFloat(k.c),
        };
        setCurrentPrice(candle.close);
        const idx = localCandles.findIndex(c => c.ts === candle.ts);
        if (idx >= 0) localCandles[idx] = candle;
        else localCandles.push(candle);
        const slice = localCandles.slice(-120);
        setCandles([...slice]);

        if (k.x) {
          const sig = runStrategy(slice);
          setSignal(sig);
          if (sig !== "HOLD") executeTrade(sig, candle.close, candle.time);
        }
      } catch {}
    };

    return ws;
  }, [addLog, runStrategy, executeTrade]);

  // ── Start / Stop ─────────────────────────────────────────────────────────────
  const startBot = useCallback(async () => {
    const history = await fetchHistory(pair, interval);
    runStrategy(history);
    connectWS(pair, interval, history);
    setRunning(true);
    addLog(`Bot started — pair: ${pair}, interval: ${interval}, risk: ${riskPct}%`);
  }, [pair, interval, riskPct, fetchHistory, connectWS, runStrategy, addLog]);

  const stopBot = useCallback(() => {
    if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
    setRunning(false);
    setSignal("HOLD");
    addLog("Bot stopped");
  }, [addLog]);

  const reset = useCallback(() => {
    stopBot();
    setBalance(10000);
    setPosition(null);
    setTrades([]);
    setCandles([]);
    setCurrentPrice(0);
    setEma9([]);
    setEma21([]);
    setRsi([]);
    setLog([]);
    tradeIdRef.current = 1;
    addLog("Bot reset — balance restored to $10,000");
  }, [stopBot, addLog]);

  useEffect(() => { return () => { wsRef.current?.close(); }; }, []);

  // ── Derived stats ─────────────────────────────────────────────────────────────
  const totalPnL = trades.reduce((s, t) => s + t.pnl, 0);
  const wins = trades.filter(t => t.pnl > 0).length;
  const winRate = trades.length ? Math.round((wins / trades.length) * 100) : 0;
  const unrealizedPnL = position && currentPrice ? (currentPrice - position.entryPrice) * position.size : 0;
  const currentRSI = rsi[rsi.length - 1] ?? 0;
  const currentEMA9 = ema9[ema9.length - 1] ?? 0;
  const currentEMA21 = ema21[ema21.length - 1] ?? 0;

  // ── Chart data ────────────────────────────────────────────────────────────────
  const chartData = candles.slice(-60).map((c, i) => ({
    time: c.time,
    price: c.close,
    ema9: ema9[ema9.length - 60 + i] ?? null,
    ema21: ema21[ema21.length - 60 + i] ?? null,
  }));

  const priceMin = chartData.length ? Math.min(...chartData.map(d => d.price)) * 0.9995 : 0;
  const priceMax = chartData.length ? Math.max(...chartData.map(d => d.price)) * 1.0005 : 0;

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white font-sans">
      {/* Header */}
      <header className="border-b border-white/8 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-green-500/20 border border-green-500/30 flex items-center justify-center">
            <Zap className="w-5 h-5 text-green-400" />
          </div>
          <div>
            <h1 className="font-bold text-lg tracking-tight">ChegeBot Pro</h1>
            <p className="text-xs text-gray-500">Crypto Trading Bot · Paper Mode</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border ${
            wsStatus === "connected" ? "bg-green-500/10 border-green-500/20 text-green-400" :
            wsStatus === "connecting" ? "bg-yellow-500/10 border-yellow-500/20 text-yellow-400" :
            "bg-white/5 border-white/10 text-gray-500"
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${
              wsStatus === "connected" ? "bg-green-400 animate-pulse" :
              wsStatus === "connecting" ? "bg-yellow-400 animate-pulse" : "bg-gray-500"
            }`} />
            {wsStatus === "connected" ? "Live" : wsStatus === "connecting" ? "Connecting…" : "Offline"}
          </span>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-6 space-y-5">
        {/* Controls */}
        <div className="bg-white/[0.04] border border-white/8 rounded-2xl p-4 flex flex-wrap items-end gap-4">
          <div>
            <label className="text-xs text-gray-400 mb-1.5 block">Pair</label>
            <select
              disabled={running}
              value={pair}
              onChange={e => setPair(e.target.value)}
              className="bg-black/50 border border-white/10 rounded-lg px-3 h-9 text-sm text-white focus:outline-none focus:border-green-500/40 disabled:opacity-50"
            >
              {PAIRS.map(p => <option key={p} value={p}>{p.replace("USDT", "/USDT")}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-400 mb-1.5 block">Interval</label>
            <select
              disabled={running}
              value={interval}
              onChange={e => setInterval_(e.target.value)}
              className="bg-black/50 border border-white/10 rounded-lg px-3 h-9 text-sm text-white focus:outline-none focus:border-green-500/40 disabled:opacity-50"
            >
              {INTERVALS.map(i => <option key={i} value={i}>{i}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-400 mb-1.5 block">Risk per trade</label>
            <select
              disabled={running}
              value={riskPct}
              onChange={e => setRiskPct(Number(e.target.value))}
              className="bg-black/50 border border-white/10 rounded-lg px-3 h-9 text-sm text-white focus:outline-none focus:border-green-500/40 disabled:opacity-50"
            >
              {RISK_OPTIONS.map(r => <option key={r} value={r}>{r}%</option>)}
            </select>
          </div>
          <div className="flex gap-2 ml-auto">
            {!running ? (
              <button
                onClick={startBot}
                className="flex items-center gap-2 px-5 h-9 rounded-lg bg-green-600 hover:bg-green-500 text-sm font-semibold text-white transition-colors"
              >
                <Play className="w-3.5 h-3.5" /> Start Bot
              </button>
            ) : (
              <button
                onClick={stopBot}
                className="flex items-center gap-2 px-5 h-9 rounded-lg bg-red-600/80 hover:bg-red-600 text-sm font-semibold text-white transition-colors"
              >
                <Square className="w-3.5 h-3.5" /> Stop
              </button>
            )}
            <button
              onClick={reset}
              className="flex items-center gap-2 px-4 h-9 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-sm text-gray-400 transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Reset
            </button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            {
              label: "Balance",
              value: `$${balance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
              icon: DollarSign,
              color: "text-white",
              sub: totalPnL >= 0 ? `+$${totalPnL.toFixed(2)} total` : `-$${Math.abs(totalPnL).toFixed(2)} total`,
              subColor: totalPnL >= 0 ? "text-green-400" : "text-red-400",
            },
            {
              label: "Unrealized P&L",
              value: position ? `${unrealizedPnL >= 0 ? "+" : ""}$${unrealizedPnL.toFixed(2)}` : "—",
              icon: Activity,
              color: position ? (unrealizedPnL >= 0 ? "text-green-400" : "text-red-400") : "text-gray-500",
              sub: position ? `Entry: $${position.entryPrice.toFixed(2)}` : "No open position",
              subColor: "text-gray-500",
            },
            {
              label: "Win Rate",
              value: trades.length ? `${winRate}%` : "—",
              icon: Percent,
              color: winRate >= 50 ? "text-green-400" : "text-red-400",
              sub: `${wins}W / ${trades.length - wins}L · ${trades.length} trades`,
              subColor: "text-gray-500",
            },
            {
              label: "Signal",
              value: signal,
              icon: BarChart2,
              color: signal === "BUY" ? "text-green-400" : signal === "SELL" ? "text-red-400" : "text-gray-400",
              sub: `RSI: ${currentRSI.toFixed(1)} · EMA9 ${currentEMA9 > currentEMA21 ? ">" : "<"} EMA21`,
              subColor: "text-gray-500",
            },
          ].map(s => (
            <div key={s.label} className="bg-white/[0.04] border border-white/8 rounded-2xl p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-gray-400">{s.label}</span>
                <s.icon className="w-3.5 h-3.5 text-gray-600" />
              </div>
              <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
              <p className={`text-xs mt-1 ${s.subColor}`}>{s.sub}</p>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Chart */}
          <div className="lg:col-span-2 bg-white/[0.04] border border-white/8 rounded-2xl p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <span className="font-semibold text-sm">{pair.replace("USDT", "/USDT")}</span>
                <span className="ml-3 text-2xl font-bold text-white">
                  ${currentPrice ? currentPrice.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—"}
                </span>
              </div>
              <div className="flex gap-3 text-xs text-gray-500">
                <span className="flex items-center gap-1"><span className="w-2 h-0.5 bg-green-400 inline-block rounded" />EMA9</span>
                <span className="flex items-center gap-1"><span className="w-2 h-0.5 bg-blue-400 inline-block rounded" />EMA21</span>
                <span className="flex items-center gap-1"><span className="w-2 h-0.5 bg-yellow-400/60 inline-block rounded" />Price</span>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="priceGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#eab308" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="#eab308" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                <XAxis dataKey="time" tick={{ fill: "#6b7280", fontSize: 10 }} tickLine={false} axisLine={false} interval={9} />
                <YAxis domain={[priceMin, priceMax]} tick={{ fill: "#6b7280", fontSize: 10 }} tickLine={false} axisLine={false}
                  tickFormatter={v => `$${v >= 1000 ? (v / 1000).toFixed(1) + "k" : v.toFixed(2)}`} width={60} />
                <Tooltip
                  contentStyle={{ backgroundColor: "#111", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: "#9ca3af" }}
                  formatter={(val: any, name: string) => [`$${Number(val).toFixed(2)}`, name === "price" ? "Price" : name === "ema9" ? "EMA9" : "EMA21"]}
                />
                <Area type="monotone" dataKey="price" stroke="#eab308" strokeWidth={1.5} fill="url(#priceGrad)" dot={false} />
                <Area type="monotone" dataKey="ema9" stroke="#22c55e" strokeWidth={1.5} fill="none" dot={false} />
                <Area type="monotone" dataKey="ema21" stroke="#60a5fa" strokeWidth={1.5} fill="none" dot={false} />
              </AreaChart>
            </ResponsiveContainer>

            {/* RSI mini chart */}
            <div className="mt-3 border-t border-white/5 pt-3">
              <p className="text-xs text-gray-500 mb-2">RSI (14) — current: <span className={`font-medium ${currentRSI > 70 ? "text-red-400" : currentRSI < 30 ? "text-green-400" : "text-white"}`}>{currentRSI.toFixed(1)}</span></p>
              <ResponsiveContainer width="100%" height={60}>
                <AreaChart data={candles.slice(-60).map((c, i) => ({ time: c.time, rsi: rsi[rsi.length - 60 + i] ?? 50 }))} margin={{ top: 0, right: 4, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="rsiGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#a855f7" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#a855f7" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.03)" />
                  <XAxis dataKey="time" hide />
                  <YAxis domain={[0, 100]} tick={{ fill: "#6b7280", fontSize: 9 }} tickLine={false} axisLine={false} width={30} ticks={[30, 50, 70]} />
                  <ReferenceLine y={70} stroke="rgba(239,68,68,0.3)" strokeDasharray="3 3" />
                  <ReferenceLine y={30} stroke="rgba(34,197,94,0.3)" strokeDasharray="3 3" />
                  <Area type="monotone" dataKey="rsi" stroke="#a855f7" strokeWidth={1.5} fill="url(#rsiGrad)" dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Activity log */}
          <div className="bg-white/[0.04] border border-white/8 rounded-2xl p-5 flex flex-col">
            <div className="flex items-center gap-2 mb-3">
              <Clock className="w-4 h-4 text-gray-500" />
              <span className="text-sm font-medium text-gray-300">Activity Log</span>
            </div>
            <div className="flex-1 overflow-y-auto space-y-1 max-h-72 font-mono text-xs">
              {log.length === 0 ? (
                <p className="text-gray-600 text-center py-8">Start the bot to see activity</p>
              ) : log.map((l, i) => (
                <div key={i} className={`leading-relaxed ${
                  l.includes("🟢") ? "text-green-400" :
                  l.includes("🔴") ? "text-red-400" :
                  l.includes("started") ? "text-yellow-400" :
                  "text-gray-400"
                }`}>{l}</div>
              ))}
            </div>
          </div>
        </div>

        {/* Open position + Trade history */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Open position */}
          <div className="bg-white/[0.04] border border-white/8 rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-4">
              {position ? <TrendingUp className="w-4 h-4 text-green-400" /> : <AlertTriangle className="w-4 h-4 text-gray-600" />}
              <span className="text-sm font-medium">Open Position</span>
            </div>
            {position ? (
              <div className="space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">Pair</span>
                  <span className="font-medium">{position.pair}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">Entry</span>
                  <span className="font-medium">${position.entryPrice.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">Current</span>
                  <span className="font-medium">${currentPrice.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">Size</span>
                  <span className="font-mono text-xs">{position.size.toFixed(6)}</span>
                </div>
                <div className="flex justify-between text-sm border-t border-white/5 pt-3">
                  <span className="text-gray-400">Unrealized PnL</span>
                  <span className={`font-bold ${unrealizedPnL >= 0 ? "text-green-400" : "text-red-400"}`}>
                    {unrealizedPnL >= 0 ? "+" : ""}${unrealizedPnL.toFixed(2)}
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${unrealizedPnL >= 0 ? "bg-green-500" : "bg-red-500"}`}
                    style={{ width: `${Math.min(Math.abs(unrealizedPnL / (position.entryPrice * position.size)) * 500, 100)}%` }}
                  />
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-32 text-gray-600">
                <TrendingDown className="w-8 h-8 mb-2 opacity-30" />
                <p className="text-sm">No open position</p>
                <p className="text-xs mt-1">Waiting for BUY signal</p>
              </div>
            )}
          </div>

          {/* Trade history */}
          <div className="lg:col-span-2 bg-white/[0.04] border border-white/8 rounded-2xl p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <BarChart2 className="w-4 h-4 text-gray-500" />
                <span className="text-sm font-medium">Trade History</span>
              </div>
              <span className="text-xs text-gray-500">{trades.length} trades</span>
            </div>
            {trades.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-32 text-gray-600">
                <Activity className="w-8 h-8 mb-2 opacity-30" />
                <p className="text-sm">No trades yet</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-gray-500 border-b border-white/5">
                      <th className="text-left pb-2 font-medium">#</th>
                      <th className="text-left pb-2 font-medium">Pair</th>
                      <th className="text-left pb-2 font-medium">Side</th>
                      <th className="text-right pb-2 font-medium">Price</th>
                      <th className="text-right pb-2 font-medium">PnL</th>
                      <th className="text-right pb-2 font-medium">Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trades.slice(0, 20).map(t => (
                      <tr key={t.id} className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors">
                        <td className="py-2 text-gray-600">{t.id}</td>
                        <td className="py-2 text-gray-300">{t.pair.replace("USDT", "")}/USDT</td>
                        <td className="py-2">
                          <span className={`px-1.5 py-0.5 rounded font-bold ${t.side === "BUY" ? "bg-green-500/15 text-green-400" : "bg-red-500/15 text-red-400"}`}>
                            {t.side}
                          </span>
                        </td>
                        <td className="py-2 text-right font-mono">${t.price.toFixed(2)}</td>
                        <td className={`py-2 text-right font-bold font-mono ${t.pnl >= 0 ? "text-green-400" : "text-red-400"}`}>
                          {t.pnl >= 0 ? "+" : ""}${t.pnl.toFixed(2)}
                        </td>
                        <td className="py-2 text-right text-gray-500">{t.time}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Strategy info */}
        <div className="bg-blue-500/5 border border-blue-500/15 rounded-2xl p-4 flex flex-wrap gap-6 text-sm">
          <div><span className="text-gray-400 mr-2">Strategy:</span><span className="text-white font-medium">EMA(9/21) Crossover + RSI(14) Filter</span></div>
          <div><span className="text-gray-400 mr-2">Buy:</span><span className="text-green-400">EMA9 crosses above EMA21, RSI &lt; 70</span></div>
          <div><span className="text-gray-400 mr-2">Sell:</span><span className="text-red-400">EMA9 crosses below EMA21, RSI &gt; 30</span></div>
          <div><span className="text-gray-400 mr-2">Mode:</span><span className="text-yellow-400">Paper Trading (no real funds)</span></div>
        </div>
      </div>
    </div>
  );
}
