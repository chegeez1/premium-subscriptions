import { useEffect, useRef, useState, useCallback } from "react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line,
} from "recharts";
import {
  Zap, Play, Square, RefreshCw, DollarSign, TrendingUp, TrendingDown,
  Activity, Shield, Eye, EyeOff, AlertTriangle, CheckCircle, Clock,
  BarChart2, Settings, Wifi, WifiOff, Info, Target, Cpu,
} from "lucide-react";

// ─── Constants ────────────────────────────────────────────────────────────────
const DERIV_WS = "wss://ws.binaryws.com/websockets/v3?app_id=1089";
const RECONNECT_DELAY = 3000;

const SYMBOLS: Record<string, string> = {
  R_10:    "Volatility 10",
  R_25:    "Volatility 25",
  R_50:    "Volatility 50",
  R_75:    "Volatility 75",
  R_100:   "Volatility 100",
  "1HZ10V": "Volatility 10 (1s)",
  "1HZ25V": "Volatility 25 (1s)",
  "1HZ50V": "Volatility 50 (1s)",
  BOOM500:  "Boom 500",
  CRASH500: "Crash 500",
};

const DURATIONS = [
  { label: "1 tick",   value: 1,  unit: "t" },
  { label: "5 ticks",  value: 5,  unit: "t" },
  { label: "10 ticks", value: 10, unit: "t" },
  { label: "15 ticks", value: 15, unit: "t" },
  { label: "1 min",    value: 1,  unit: "m" },
  { label: "2 min",    value: 2,  unit: "m" },
  { label: "5 min",    value: 5,  unit: "m" },
];

const STRATEGIES = [
  { id: "consensus",      label: "⚡ Consensus",      desc: "3-of-5 indicator vote: RSI + MACD + BB + Momentum + Velocity" },
  { id: "trend",          label: "📈 Trend Follow",   desc: "EMA crossover with RSI & weighted momentum filter" },
  { id: "mean_reversion", label: "↩ Mean Reversion",  desc: "Bollinger Band oversold/overbought bounce" },
  { id: "martingale",     label: "🔁 Martingale",     desc: "Double stake on loss with RSI confirmation" },
  { id: "anti_martingale",label: "🚀 Anti-Martingale",desc: "Increase stake on win streaks" },
  { id: "digit_over",     label: "🔢 Digit > 4",      desc: "Last digit over 4 — 50% base probability" },
  { id: "digit_under",    label: "🔢 Digit < 5",      desc: "Last digit under 5 — 50% base probability" },
];

// ─── Types ────────────────────────────────────────────────────────────────────
type ConnStatus = "disconnected" | "connecting" | "authorized" | "error";
type Signal = "CALL" | "PUT" | "DIGITOVER" | "DIGITUNDER";
type Trade = {
  id: number; contractId?: number; type: string; stake: number;
  symbol: string; pnl: number | null; status: "open" | "won" | "lost";
  time: string; duration: string; confidence?: number;
};
type Tick    = { epoch: number; quote: number; pip_size?: number };
type Account = { loginid: string; balance: number; currency: string; is_virtual: boolean };
type IndicatorSnapshot = { rsi: number; macd: number; bbPos: number; momentum: number; velocity: number };

// ─── Technical Indicators ─────────────────────────────────────────────────────

function calcRSI(ticks: Tick[], period = 14): number {
  if (ticks.length < period + 1) return 50;
  const changes = ticks.slice(-(period + 1)).map((t, i, a) => i === 0 ? 0 : t.quote - a[i - 1].quote).slice(1);
  const gains  = changes.filter(c => c > 0).reduce((s, c) => s + c, 0) / period;
  const losses = Math.abs(changes.filter(c => c < 0).reduce((s, c) => s + c, 0)) / period;
  if (losses === 0) return 100;
  return 100 - 100 / (1 + gains / losses);
}

function ema(prices: number[], period: number): number {
  const k = 2 / (period + 1);
  let val = prices[prices.length - period];
  for (let i = prices.length - period + 1; i < prices.length; i++) val = prices[i] * k + val * (1 - k);
  return val;
}

/** MACD line = EMA(12) - EMA(26). Positive = bullish momentum. */
function calcMACD(ticks: Tick[]): number {
  if (ticks.length < 27) return 0;
  const prices = ticks.map(t => t.quote);
  return ema(prices, 12) - ema(prices, 26);
}

/** Bollinger Band position: -1 (below lower) → 0 (mid) → +1 (above upper). */
function calcBBPosition(ticks: Tick[], period = 20, mult = 2): number {
  if (ticks.length < period) return 0;
  const slice  = ticks.slice(-period).map(t => t.quote);
  const mean   = slice.reduce((a, b) => a + b, 0) / period;
  const stdDev = Math.sqrt(slice.reduce((s, v) => s + (v - mean) ** 2, 0) / period);
  const upper  = mean + mult * stdDev;
  const lower  = mean - mult * stdDev;
  const last   = ticks[ticks.length - 1].quote;
  if (stdDev === 0) return 0;
  return (last - mean) / (mult * stdDev); // normalised: >1 above upper, <-1 below lower
}

/** Weighted price momentum over N ticks — recent ticks weighted heavier. */
function weightedMomentum(ticks: Tick[], window: number): number {
  const slice = ticks.slice(-window);
  let score = 0, totalWeight = 0;
  for (let i = 1; i < slice.length; i++) {
    const w = i;
    score += (slice[i].quote > slice[i - 1].quote ? 1 : slice[i].quote < slice[i - 1].quote ? -1 : 0) * w;
    totalWeight += w;
  }
  return totalWeight ? score / totalWeight : 0; // -1 → +1
}

/** Tick velocity: average absolute price change per tick (normalised). */
function tickVelocity(ticks: Tick[], window = 10): number {
  const slice = ticks.slice(-window);
  if (slice.length < 2) return 0;
  return slice.slice(1).reduce((s, t, i) => s + Math.abs(t.quote - slice[i].quote), 0) / (slice.length - 1);
}

/** All indicators as a snapshot. */
function getIndicators(ticks: Tick[]): IndicatorSnapshot {
  return {
    rsi:      calcRSI(ticks, 14),
    macd:     calcMACD(ticks),
    bbPos:    calcBBPosition(ticks, 20),
    momentum: weightedMomentum(ticks, 12),
    velocity: tickVelocity(ticks, 10),
  };
}

// ─── Strategy Engine ──────────────────────────────────────────────────────────

function getSignal(
  strategy: string,
  ticks: Tick[],
  lastPnl: number | null,
): { signal: Signal | null; confidence: number } {
  if (ticks.length < 30) return { signal: null, confidence: 0 };

  if (strategy === "digit_over") return { signal: "DIGITOVER", confidence: 50 };
  if (strategy === "digit_under") return { signal: "DIGITUNDER", confidence: 50 };

  const ind = getIndicators(ticks);

  // ── Consensus: 5 independent indicator votes ──────────────────────────────
  if (strategy === "consensus") {
    if (ticks.length < 35) return { signal: null, confidence: 0 };
    let bullVotes = 0, bearVotes = 0;
    // RSI
    if (ind.rsi > 55 && ind.rsi < 75) bullVotes++;
    else if (ind.rsi < 45 && ind.rsi > 25) bearVotes++;
    // MACD
    if (ind.macd > 0) bullVotes++; else if (ind.macd < 0) bearVotes++;
    // Bollinger
    if (ind.bbPos > 0.3 && ind.bbPos < 0.9) bullVotes++;
    else if (ind.bbPos < -0.3 && ind.bbPos > -0.9) bearVotes++;
    // Momentum
    if (ind.momentum > 0.2) bullVotes++; else if (ind.momentum < -0.2) bearVotes++;
    // Velocity (market active enough)
    const avgPrice = ticks[ticks.length - 1].quote;
    const velNorm  = (ind.velocity / avgPrice) * 10000; // basis-point velocity
    const active   = velNorm > 0.5 && velNorm < 20;
    if (active) { if (bullVotes > bearVotes) bullVotes++; else if (bearVotes > bullVotes) bearVotes++; }

    const confidence = Math.round((Math.max(bullVotes, bearVotes) / 5) * 100);
    if (bullVotes >= 3) return { signal: "CALL", confidence };
    if (bearVotes >= 3) return { signal: "PUT",  confidence };
    return { signal: null, confidence };
  }

  // ── Trend Follow ─────────────────────────────────────────────────────────
  if (strategy === "trend") {
    if (ticks.length < 35) return { signal: null, confidence: 0 };
    const prices   = ticks.map(t => t.quote);
    const shortEma = ema(prices, 5);
    const longEma  = ema(prices, 25);
    const spread   = Math.abs(shortEma - longEma) / longEma;
    if (spread < 0.00005) return { signal: null, confidence: 0 };
    const bullish = shortEma > longEma && ind.rsi > 48 && ind.rsi < 70 && ind.momentum > 0.15;
    const bearish = shortEma < longEma && ind.rsi < 52 && ind.rsi > 30 && ind.momentum < -0.15;
    const conf = Math.round(Math.min(100, spread * 1_000_000 / 10 + 50));
    if (bullish) return { signal: "CALL", confidence: conf };
    if (bearish) return { signal: "PUT",  confidence: conf };
    return { signal: null, confidence: 0 };
  }

  // ── Mean Reversion ────────────────────────────────────────────────────────
  if (strategy === "mean_reversion") {
    // Enter when price is outside Bollinger Bands and RSI confirms exhaustion
    const conf = Math.round(Math.min(100, Math.abs(ind.bbPos) * 70));
    if (ind.bbPos < -1.0 && ind.rsi < 35 && ind.momentum < 0) return { signal: "CALL", confidence: conf };
    if (ind.bbPos >  1.0 && ind.rsi > 65 && ind.momentum > 0) return { signal: "PUT",  confidence: conf };
    return { signal: null, confidence: 0 };
  }

  // ── Martingale ────────────────────────────────────────────────────────────
  if (strategy === "martingale") {
    if (lastPnl !== null && lastPnl < 0) {
      // After a loss: only enter on clear reversal
      if (ind.rsi > 65 && ind.momentum > 0.1) return { signal: "PUT",  confidence: 70 };
      if (ind.rsi < 35 && ind.momentum < -0.1) return { signal: "CALL", confidence: 70 };
      return { signal: null, confidence: 0 };
    }
    if (ind.rsi > 58 && ind.momentum > 0.2) return { signal: "CALL", confidence: 60 };
    if (ind.rsi < 42 && ind.momentum < -0.2) return { signal: "PUT",  confidence: 60 };
    return { signal: null, confidence: 0 };
  }

  // ── Anti-Martingale ───────────────────────────────────────────────────────
  if (strategy === "anti_martingale") {
    if (lastPnl !== null && lastPnl > 0) {
      if (ind.rsi > 52 && ind.rsi < 72 && ind.momentum > 0.1) return { signal: "CALL", confidence: 68 };
      if (ind.rsi < 48 && ind.rsi > 28 && ind.momentum < -0.1) return { signal: "PUT",  confidence: 68 };
      return { signal: null, confidence: 0 };
    }
    if (ind.rsi > 60 && ind.momentum > 0.3) return { signal: "CALL", confidence: 60 };
    if (ind.rsi < 40 && ind.momentum < -0.3) return { signal: "PUT",  confidence: 60 };
    return { signal: null, confidence: 0 };
  }

  return { signal: null, confidence: 0 };
}

function calcStake(
  strategy: string,
  baseStake: number,
  stakeMode: "fixed" | "percent",
  balance: number,
  lastPnl: number | null,
  lastStake: number,
): number {
  const base = stakeMode === "percent" ? Math.max(0.35, (balance * baseStake) / 100) : baseStake;
  if (strategy === "martingale"     && lastPnl !== null && lastPnl < 0) return Math.min(lastStake * 2, base * 16);
  if (strategy === "anti_martingale"&& lastPnl !== null && lastPnl > 0) return Math.min(lastStake * 2, base * 8);
  return base;
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function TradingBotPage() {
  // Connection
  const [apiToken,    setApiToken]    = useState("");
  const [showToken,   setShowToken]   = useState(false);
  const [connStatus,  setConnStatus]  = useState<ConnStatus>("disconnected");
  const [account,     setAccount]     = useState<Account | null>(null);
  const [balance,     setBalance]     = useState(0);
  const [error,       setError]       = useState("");
  const [autoReconnect, setAutoReconnect] = useState(true);

  // Config
  const [symbol,     setSymbol]     = useState("R_50");
  const [strategy,   setStrategy]   = useState("consensus");
  const [stakeMode,  setStakeMode]  = useState<"fixed" | "percent">("fixed");
  const [baseStake,  setBaseStake]  = useState(1);
  const [durIdx,     setDurIdx]     = useState(2);
  const [stopLoss,   setStopLoss]   = useState(10);
  const [takeProfit, setTakeProfit] = useState(20);
  const [maxDailyLoss, setMaxDailyLoss] = useState(50);

  // Runtime
  const [running,          setRunning]          = useState(false);
  const [ticks,            setTicks]            = useState<Tick[]>([]);
  const [trades,           setTrades]           = useState<Trade[]>([]);
  const [sessionPnl,       setSessionPnl]       = useState(0);
  const [dailyLoss,        setDailyLoss]        = useState(0);
  const [log,              setLog]              = useState<string[]>([]);
  const [lastStake,        setLastStake]        = useState(1);
  const [lastPnl,          setLastPnl]          = useState<number | null>(null);
  const [tab,              setTab]              = useState<"bot" | "history" | "settings">("bot");
  const [waitingContract,  setWaitingContract]  = useState(false);
  const [indicators,       setIndicators]       = useState<IndicatorSnapshot | null>(null);
  const [lastSignalConf,   setLastSignalConf]   = useState(0);
  const [equityHistory,    setEquityHistory]    = useState<{ t: string; pnl: number }[]>([]);
  const [openContracts,    setOpenContracts]    = useState<number[]>([]);

  // Refs
  const wsRef           = useRef<WebSocket | null>(null);
  const reqIdRef        = useRef(1);
  const runningRef      = useRef(false);
  const sessionPnlRef   = useRef(0);
  const dailyLossRef    = useRef(0);
  const lastStakeRef    = useRef(1);
  const lastPnlRef      = useRef<number | null>(null);
  const ticksRef        = useRef<Tick[]>([]);
  const waitingRef      = useRef(false);
  const tradeIdRef      = useRef(1);
  const balanceRef      = useRef(0);
  const autoReconnectRef = useRef(true);
  const apiTokenRef     = useRef("");

  runningRef.current     = running;
  sessionPnlRef.current  = sessionPnl;
  dailyLossRef.current   = dailyLoss;
  lastStakeRef.current   = lastStake;
  lastPnlRef.current     = lastPnl;
  ticksRef.current       = ticks;
  waitingRef.current     = waitingContract;
  balanceRef.current     = balance;
  autoReconnectRef.current = autoReconnect;
  apiTokenRef.current    = apiToken;

  const addLog = useCallback((msg: string) => {
    setLog(prev => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev].slice(0, 150));
  }, []);

  const send = useCallback((obj: object) => {
    if (wsRef.current?.readyState === WebSocket.OPEN)
      wsRef.current.send(JSON.stringify({ ...obj, req_id: reqIdRef.current++ }));
  }, []);

  // ── Place contract ──────────────────────────────────────────────────────────
  const placeContract = useCallback((signal: Signal, stake: number, confidence: number) => {
    if (waitingRef.current) return;
    const dur     = DURATIONS[durIdx];
    const isDigit = signal.startsWith("DIGIT");
    const barrier = isDigit ? (signal === "DIGITOVER" ? "4" : "5") : undefined;

    const params: Record<string, unknown> = {
      amount: stake, basis: "stake", contract_type: signal,
      currency: "USD", duration: dur.value, duration_unit: dur.unit, symbol,
    };
    if (barrier !== undefined) params.barrier = barrier;

    send({ buy: "1", price: stake, parameters: params });
    setWaitingContract(true);
    waitingRef.current = true;
    setLastSignalConf(confidence);
    addLog(`📤 ${signal} | $${stake.toFixed(2)} | ${dur.label} | ${confidence}% confidence`);
  }, [durIdx, symbol, send, addLog]);

  // ── Tick processor ──────────────────────────────────────────────────────────
  const processTick = useCallback((tick: Tick) => {
    setTicks(prev => {
      const next = [...prev, tick].slice(-150);
      ticksRef.current = next;

      // Update live indicators every 5 ticks
      if (next.length % 5 === 0) setIndicators(getIndicators(next));

      return next;
    });

    if (!runningRef.current || waitingRef.current) return;

    // Risk guards
    const spnl = sessionPnlRef.current;
    const dl   = dailyLossRef.current;
    if (spnl <= -stopLoss)   { addLog(`🛑 Stop loss hit — $${Math.abs(spnl).toFixed(2)} loss. Bot paused.`); setRunning(false); return; }
    if (spnl >= takeProfit)  { addLog(`✅ Take profit hit — +$${spnl.toFixed(2)}. Bot paused.`); setRunning(false); return; }
    if (dl   >= maxDailyLoss){ addLog(`🛑 Daily loss limit hit. Bot stopped.`); setRunning(false); return; }

    const { signal, confidence } = getSignal(strategy, ticksRef.current, lastPnlRef.current);
    if (!signal || confidence < 40) return; // skip low-confidence signals

    const stake = calcStake(strategy, baseStake, stakeMode, balanceRef.current, lastPnlRef.current, lastStakeRef.current);
    setLastStake(stake);
    lastStakeRef.current = stake;
    placeContract(signal, stake, confidence);
  }, [stopLoss, takeProfit, maxDailyLoss, strategy, baseStake, stakeMode, placeContract, addLog]);

  // ── WebSocket message handler ──────────────────────────────────────────────
  const handleMessage = useCallback((data: Record<string, unknown>) => {
    const type = data.msg_type as string;

    if (data.error) {
      const errMsg = (data.error as Record<string, string>).message || "Unknown error";
      addLog(`❌ Error: ${errMsg}`);
      if (type === "authorize") { setError(errMsg); setConnStatus("error"); }
      if (type === "buy")       { setWaitingContract(false); waitingRef.current = false; }
      return;
    }

    switch (type) {
      case "authorize": {
        const a = data.authorize as Record<string, unknown>;
        setAccount({ loginid: a.loginid as string, balance: a.balance as number, currency: a.currency as string, is_virtual: a.is_virtual === 1 });
        setBalance(a.balance as number);
        balanceRef.current = a.balance as number;
        setConnStatus("authorized");
        setError("");
        addLog(`✅ Authorized: ${a.loginid} | ${a.currency} ${(a.balance as number).toFixed(2)} | ${a.is_virtual === 1 ? "Demo" : "Real"}`);
        send({ balance: 1, subscribe: 1 });
        break;
      }
      case "balance": {
        const b = (data.balance as Record<string, number>).balance;
        setBalance(b);
        balanceRef.current = b;
        break;
      }
      case "tick": {
        const t = data.tick as Record<string, number>;
        processTick({ epoch: t.epoch, quote: t.quote, pip_size: t.pip_size });
        break;
      }
      case "buy": {
        const b = data.buy as Record<string, unknown>;
        const contractId = b.contract_id as number;
        setOpenContracts(prev => [...prev, contractId]);
        const dur = DURATIONS[durIdx];
        const raw = b.shortcode as string;
        const tradeType = raw?.includes("CALL") ? "CALL" : raw?.includes("PUT") ? "PUT" :
                          raw?.includes("OVER") ? "DIGITOVER" : "DIGITUNDER";
        setTrades(prev => [{
          id: tradeIdRef.current++, contractId, type: tradeType,
          stake: b.buy_price as number, symbol,
          pnl: null, status: "open",
          time: new Date().toLocaleTimeString(),
          duration: `${dur.value}${dur.unit}`,
          confidence: lastSignalConf,
        }, ...prev]);
        addLog(`📋 Contract #${contractId} | Stake $${(b.buy_price as number).toFixed(2)}`);
        send({ proposal_open_contract: 1, contract_id: contractId, subscribe: 1 });
        break;
      }
      case "proposal_open_contract": {
        const c = data.proposal_open_contract as Record<string, unknown>;
        if (!c || !c.is_sold) return;
        const profit     = (c.profit as number) ?? 0;
        const contractId = c.contract_id as number;
        const won        = profit > 0;

        setTrades(prev => prev.map(t =>
          t.contractId === contractId ? { ...t, pnl: profit, status: won ? "won" : "lost" } : t
        ));
        setOpenContracts(prev => prev.filter(id => id !== contractId));
        setSessionPnl(prev => {
          const next = +(prev + profit).toFixed(2);
          sessionPnlRef.current = next;
          setEquityHistory(h => [...h, { t: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }), pnl: next }].slice(-60));
          return next;
        });
        if (!won) {
          setDailyLoss(prev => { const next = +(prev + Math.abs(profit)).toFixed(2); dailyLossRef.current = next; return next; });
        }
        setLastPnl(profit);
        lastPnlRef.current = profit;
        setWaitingContract(false);
        waitingRef.current = false;
        addLog(won ? `✅ WON  #${contractId} | +$${profit.toFixed(2)}` : `❌ LOST #${contractId} | -$${Math.abs(profit).toFixed(2)}`);
        break;
      }
    }
  }, [send, processTick, durIdx, symbol, lastSignalConf, addLog]);

  // ── Connect / Disconnect ───────────────────────────────────────────────────
  const connect = useCallback(() => {
    const token = apiTokenRef.current.trim();
    if (!token) { setError("Enter your Deriv API token first"); return; }
    if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
    setConnStatus("connecting");
    setError("");
    addLog("Connecting to Deriv…");

    const ws = new WebSocket(DERIV_WS);
    wsRef.current = ws;
    ws.onopen    = () => { addLog("Connected — authorizing…"); ws.send(JSON.stringify({ authorize: token, req_id: reqIdRef.current++ })); };
    ws.onmessage = ev => { try { handleMessage(JSON.parse(ev.data)); } catch {} };
    ws.onerror   = () => { setError("WebSocket error"); setConnStatus("error"); };
    ws.onclose   = () => {
      setConnStatus("disconnected");
      setRunning(false);
      addLog("Disconnected from Deriv");
      if (autoReconnectRef.current && apiTokenRef.current.trim()) {
        addLog(`🔄 Auto-reconnecting in ${RECONNECT_DELAY / 1000}s…`);
        setTimeout(() => { if (autoReconnectRef.current && apiTokenRef.current.trim()) connect(); }, RECONNECT_DELAY);
      }
    };
  }, [handleMessage, addLog]);

  const disconnect = useCallback(() => {
    autoReconnectRef.current = false;
    setAutoReconnect(false);
    wsRef.current?.close();
    wsRef.current = null;
    setConnStatus("disconnected");
    setRunning(false);
    setAccount(null);
    setTicks([]);
    setIndicators(null);
  }, []);

  const startBot = useCallback(() => {
    if (connStatus !== "authorized") return;
    setRunning(true);
    setSessionPnl(0);
    setLastPnl(null);
    setLastStake(baseStake);
    setWaitingContract(false);
    waitingRef.current = false;
    setEquityHistory([]);
    send({ ticks: symbol, subscribe: 1 });
    addLog(`🚀 Bot started | ${STRATEGIES.find(s => s.id === strategy)?.label} | ${SYMBOLS[symbol]} | $${baseStake} ${stakeMode}`);
  }, [connStatus, symbol, strategy, baseStake, stakeMode, send, addLog]);

  const stopBot = useCallback(() => {
    setRunning(false);
    setWaitingContract(false);
    waitingRef.current = false;
    send({ forget_all: "ticks" });
    addLog("⏹ Bot stopped");
  }, [send, addLog]);

  useEffect(() => () => { wsRef.current?.close(); }, []);

  // ── Computed stats ─────────────────────────────────────────────────────────
  const completed   = trades.filter(t => t.status !== "open");
  const wins        = completed.filter(t => t.status === "won").length;
  const losses      = completed.filter(t => t.status === "lost").length;
  const winRate     = completed.length ? Math.round((wins / completed.length) * 100) : 0;
  const chartTicks  = ticks.slice(-60);
  const latestTick  = ticks[ticks.length - 1];

  const statusColor = connStatus === "authorized" ? "text-green-400 border-green-500/30 bg-green-500/10"
    : connStatus === "connecting" ? "text-yellow-400 border-yellow-500/30 bg-yellow-500/10"
    : connStatus === "error"      ? "text-red-400 border-red-500/30 bg-red-500/10"
    : "text-gray-500 border-white/10 bg-white/5";

  const rsiColor = (rsi: number) =>
    rsi > 70 ? "text-red-400" : rsi < 30 ? "text-green-400" : "text-gray-300";

  return (
    <div className="min-h-screen bg-[#070707] text-white font-sans">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="border-b border-white/[0.07] px-5 py-3.5 flex items-center justify-between sticky top-0 z-20 bg-[#070707]/95 backdrop-blur">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-green-500/20 to-green-600/10 border border-green-500/25 flex items-center justify-center">
            <Zap className="w-4.5 h-4.5 text-green-400" />
          </div>
          <div>
            <h1 className="font-bold text-base leading-tight">ChegeBot <span className="text-green-400">Pro</span></h1>
            <p className="text-[10px] text-gray-500 leading-tight">Deriv Automated Trading</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {account && (
            <div className="text-right hidden sm:block">
              <p className="text-[10px] text-gray-500">{account.loginid} · {account.is_virtual ? "Demo" : "Real"}</p>
              <p className="text-sm font-bold text-green-400">{account.currency} {balance.toFixed(2)}</p>
            </div>
          )}
          <span className={`flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-full border ${statusColor}`}>
            {connStatus === "authorized" ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
            {connStatus === "authorized" ? "Live" : connStatus === "connecting" ? "Connecting…" : connStatus === "error" ? "Error" : "Offline"}
          </span>
        </div>
      </header>

      {/* ── Tabs ───────────────────────────────────────────────────────────── */}
      <div className="border-b border-white/[0.07] px-5 flex gap-0.5">
        {(["bot", "history", "settings"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-3 text-sm font-medium capitalize transition-colors border-b-2 -mb-px ${tab === t ? "border-green-500 text-green-400" : "border-transparent text-gray-500 hover:text-gray-300"}`}>
            {t === "bot" ? "Dashboard" : t === "history" ? "History" : "Settings"}
          </button>
        ))}
      </div>

      <div className="max-w-7xl mx-auto px-4 py-4 space-y-4">

        {/* ── Connect panel ─────────────────────────────────────────────────── */}
        {connStatus !== "authorized" && (
          <div className="bg-white/[0.03] border border-white/[0.07] rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-4">
              <Shield className="w-4 h-4 text-green-400" />
              <span className="font-medium text-sm">Connect Your Deriv Account</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2">
                <label className="text-xs text-gray-400 mb-1.5 block">Deriv API Token</label>
                <div className="relative">
                  <input
                    type={showToken ? "text" : "password"}
                    value={apiToken}
                    onChange={e => { setApiToken(e.target.value); apiTokenRef.current = e.target.value; }}
                    placeholder="Paste your Deriv API token"
                    className="w-full bg-black/60 border border-white/10 rounded-xl px-3 pr-9 h-10 text-sm text-white focus:outline-none focus:border-green-500/50 font-mono placeholder:text-gray-600"
                  />
                  <button onClick={() => setShowToken(v => !v)} className="absolute right-2.5 top-2.5 text-gray-500 hover:text-gray-300">
                    {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {error && <p className="text-xs text-red-400 mt-1.5 flex items-center gap-1"><AlertTriangle className="w-3 h-3" />{error}</p>}
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-xs text-gray-400 mb-1.5 block invisible">x</label>
                <button
                  onClick={connStatus === "disconnected" || connStatus === "error" ? () => { autoReconnectRef.current = autoReconnect; connect(); } : disconnect}
                  disabled={connStatus === "connecting"}
                  className={`h-10 rounded-xl text-sm font-semibold transition-all flex items-center justify-center gap-2 ${
                    connStatus === "connecting" ? "bg-yellow-600/40 cursor-wait text-yellow-300" :
                    connStatus === "disconnected" || connStatus === "error" ? "bg-green-600 hover:bg-green-500 text-white shadow-lg shadow-green-900/30" :
                    "bg-red-600/60 hover:bg-red-600 text-white"}`}>
                  {connStatus === "connecting" ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" />Connecting…</> :
                   connStatus === "disconnected" || connStatus === "error" ? <><Wifi className="w-3.5 h-3.5" />Connect</> :
                   <><WifiOff className="w-3.5 h-3.5" />Disconnect</>}
                </button>
              </div>
            </div>
            <div className="mt-3 flex items-start gap-2 p-3 bg-blue-500/5 border border-blue-500/15 rounded-xl text-xs text-blue-300">
              <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>Get your API token at <a href="https://app.deriv.com/account/api-token" target="_blank" rel="noopener noreferrer" className="underline hover:text-blue-200">app.deriv.com/account/api-token</a> — enable Read, Trade & Payments. Use a Demo account to test risk-free.</span>
            </div>
          </div>
        )}

        {/* ── DASHBOARD TAB ─────────────────────────────────────────────────── */}
        {tab === "bot" && (
          <>
            {/* Stats row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: "Balance", value: account ? `${account.currency} ${balance.toFixed(2)}` : "—", icon: DollarSign, color: "text-white", sub: account ? (account.is_virtual ? "Demo" : "Real money") : "Not connected", subColor: account?.is_virtual ? "text-yellow-400" : account ? "text-green-400" : "text-gray-600" },
                { label: "Session P&L", value: completed.length ? `${sessionPnl >= 0 ? "+" : ""}$${sessionPnl.toFixed(2)}` : "—", icon: sessionPnl >= 0 ? TrendingUp : TrendingDown, color: sessionPnl > 0 ? "text-green-400" : sessionPnl < 0 ? "text-red-400" : "text-gray-400", sub: `Stop -$${stopLoss} · Target +$${takeProfit}`, subColor: "text-gray-500" },
                { label: "Win Rate", value: completed.length ? `${winRate}%` : "—", icon: Target, color: winRate >= 60 ? "text-green-400" : winRate > 0 ? "text-yellow-400" : "text-gray-400", sub: `${wins}W / ${losses}L · ${completed.length} trades`, subColor: "text-gray-500" },
                { label: "Daily Loss", value: `$${dailyLoss.toFixed(2)}`, icon: Shield, color: dailyLoss >= maxDailyLoss * 0.8 ? "text-red-400" : "text-gray-300", sub: `Limit $${maxDailyLoss}`, subColor: dailyLoss >= maxDailyLoss * 0.8 ? "text-red-400" : "text-gray-500" },
              ].map(s => (
                <div key={s.label} className="bg-white/[0.03] border border-white/[0.07] rounded-2xl p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-gray-500">{s.label}</span>
                    <s.icon className="w-3.5 h-3.5 text-gray-600" />
                  </div>
                  <p className={`text-xl font-bold tabular-nums ${s.color}`}>{s.value}</p>
                  <p className={`text-[11px] mt-1 ${s.subColor}`}>{s.sub}</p>
                </div>
              ))}
            </div>

            {/* Main grid */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

              {/* ── Config panel ─────────────────────────────────────────────── */}
              <div className="bg-white/[0.03] border border-white/[0.07] rounded-2xl p-5 space-y-4">
                <div className="flex items-center gap-2">
                  <Settings className="w-4 h-4 text-gray-400" />
                  <span className="text-sm font-medium">Configuration</span>
                </div>

                <div>
                  <label className="text-xs text-gray-400 mb-1.5 block">Symbol</label>
                  <select disabled={running} value={symbol} onChange={e => setSymbol(e.target.value)}
                    className="w-full bg-black/50 border border-white/10 rounded-lg px-3 h-9 text-sm text-white focus:outline-none focus:border-green-500/40 disabled:opacity-50">
                    {Object.entries(SYMBOLS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>

                <div>
                  <label className="text-xs text-gray-400 mb-1.5 block">Strategy</label>
                  <select disabled={running} value={strategy} onChange={e => setStrategy(e.target.value)}
                    className="w-full bg-black/50 border border-white/10 rounded-lg px-3 h-9 text-sm text-white focus:outline-none focus:border-green-500/40 disabled:opacity-50">
                    {STRATEGIES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                  </select>
                  <p className="text-[11px] text-gray-500 mt-1">{STRATEGIES.find(s => s.id === strategy)?.desc}</p>
                </div>

                {/* Stake mode toggle */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs text-gray-400">Stake Mode</label>
                    <div className="flex rounded-lg overflow-hidden border border-white/10 text-xs">
                      {(["fixed", "percent"] as const).map(m => (
                        <button key={m} disabled={running} onClick={() => setStakeMode(m)}
                          className={`px-3 py-1 transition-colors ${stakeMode === m ? "bg-green-600 text-white" : "bg-black/40 text-gray-400 hover:text-gray-200"}`}>
                          {m === "fixed" ? "Fixed $" : "% Bal"}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-xs text-gray-500 mb-1 block">{stakeMode === "fixed" ? "Stake ($)" : "Stake (%)"}</label>
                      <input type="number" min={stakeMode === "fixed" ? 0.35 : 0.1} max={stakeMode === "fixed" ? 1000 : 10} step={stakeMode === "fixed" ? 0.5 : 0.1}
                        value={baseStake} disabled={running} onChange={e => setBaseStake(Number(e.target.value))}
                        className="w-full bg-black/50 border border-white/10 rounded-lg px-3 h-9 text-sm text-white focus:outline-none focus:border-green-500/40 disabled:opacity-50" />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 mb-1 block">Duration</label>
                      <select disabled={running} value={durIdx} onChange={e => setDurIdx(Number(e.target.value))}
                        className="w-full bg-black/50 border border-white/10 rounded-lg px-3 h-9 text-sm text-white focus:outline-none focus:border-green-500/40 disabled:opacity-50">
                        {DURATIONS.map((d, i) => <option key={i} value={i}>{d.label}</option>)}
                      </select>
                    </div>
                  </div>
                  {stakeMode === "percent" && account && (
                    <p className="text-[11px] text-gray-500 mt-1">≈ ${Math.max(0.35, (balance * baseStake) / 100).toFixed(2)} per trade</p>
                  )}
                </div>

                {/* Risk management */}
                <div className="border-t border-white/5 pt-4 space-y-3">
                  <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">Risk Management</p>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { label: "Stop Loss", val: stopLoss,     set: setStopLoss,     color: "text-red-400" },
                      { label: "Take Profit", val: takeProfit, set: setTakeProfit,   color: "text-green-400" },
                      { label: "Daily Limit", val: maxDailyLoss, set: setMaxDailyLoss, color: "text-orange-400" },
                    ].map(r => (
                      <div key={r.label}>
                        <label className={`text-[11px] mb-1 block ${r.color}`}>{r.label} ($)</label>
                        <input type="number" min={1} value={r.val} disabled={running}
                          onChange={e => r.set(Number(e.target.value))}
                          className="w-full bg-black/50 border border-white/10 rounded-lg px-2 h-8 text-sm text-white focus:outline-none focus:border-green-500/40 disabled:opacity-50" />
                      </div>
                    ))}
                  </div>
                </div>

                {/* Start/Stop */}
                <div className="flex gap-2 pt-1">
                  {!running ? (
                    <button onClick={startBot} disabled={connStatus !== "authorized"}
                      className="flex-1 flex items-center justify-center gap-2 h-10 rounded-xl bg-green-600 hover:bg-green-500 disabled:opacity-40 disabled:cursor-not-allowed text-sm font-bold text-white transition-all shadow-lg shadow-green-900/20">
                      <Play className="w-4 h-4" /> Start Bot
                    </button>
                  ) : (
                    <button onClick={stopBot}
                      className="flex-1 flex items-center justify-center gap-2 h-10 rounded-xl bg-red-600/80 hover:bg-red-600 text-sm font-bold text-white transition-all">
                      <Square className="w-4 h-4" /> Stop Bot
                    </button>
                  )}
                  <button onClick={() => { setSessionPnl(0); setDailyLoss(0); setTrades([]); setLastPnl(null); setLastStake(baseStake); setEquityHistory([]); addLog("Stats reset"); }}
                    disabled={running} title="Reset stats"
                    className="px-3 h-10 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-gray-400 disabled:opacity-40 transition-colors">
                    <RefreshCw className="w-4 h-4" />
                  </button>
                </div>

                {running && (
                  <div className="flex items-center gap-2 text-xs text-green-400 bg-green-500/5 border border-green-500/15 rounded-xl px-3 py-2.5">
                    <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse shrink-0" />
                    <span>Running · {waitingContract ? "contract open…" : "scanning for signal…"}</span>
                  </div>
                )}

                {/* Live indicators */}
                {indicators && connStatus === "authorized" && (
                  <div className="border-t border-white/5 pt-3 space-y-2">
                    <div className="flex items-center gap-1.5 mb-2">
                      <Cpu className="w-3 h-3 text-gray-500" />
                      <span className="text-[11px] text-gray-500 uppercase tracking-wide font-medium">Live Indicators</span>
                    </div>
                    {[
                      { label: "RSI (14)", value: `${indicators.rsi.toFixed(1)}`, barVal: indicators.rsi, barMax: 100, color: rsiColor(indicators.rsi), barColor: indicators.rsi > 70 ? "bg-red-500" : indicators.rsi < 30 ? "bg-green-500" : "bg-gray-500" },
                      { label: "MACD", value: indicators.macd > 0 ? `+${indicators.macd.toFixed(5)}` : indicators.macd.toFixed(5), barVal: 50 + Math.min(50, Math.max(-50, indicators.macd * 1e4)), barMax: 100, color: indicators.macd > 0 ? "text-green-400" : "text-red-400", barColor: indicators.macd > 0 ? "bg-green-500" : "bg-red-500" },
                      { label: "Momentum", value: indicators.momentum.toFixed(2), barVal: (indicators.momentum + 1) * 50, barMax: 100, color: indicators.momentum > 0 ? "text-green-400" : indicators.momentum < 0 ? "text-red-400" : "text-gray-400", barColor: indicators.momentum > 0 ? "bg-green-500" : "bg-red-500" },
                      { label: "BB Position", value: indicators.bbPos.toFixed(2), barVal: (indicators.bbPos + 2) * 25, barMax: 100, color: Math.abs(indicators.bbPos) > 1 ? "text-yellow-400" : "text-gray-300", barColor: indicators.bbPos > 0 ? "bg-blue-500" : "bg-purple-500" },
                    ].map(ind => (
                      <div key={ind.label}>
                        <div className="flex justify-between text-[11px] mb-0.5">
                          <span className="text-gray-500">{ind.label}</span>
                          <span className={`font-mono ${ind.color}`}>{ind.value}</span>
                        </div>
                        <div className="h-1 bg-white/5 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full transition-all ${ind.barColor}`} style={{ width: `${Math.max(0, Math.min(100, ind.barVal))}%` }} />
                        </div>
                      </div>
                    ))}
                    {lastSignalConf > 0 && (
                      <div className="mt-1">
                        <div className="flex justify-between text-[11px] mb-0.5">
                          <span className="text-gray-500">Last Signal Confidence</span>
                          <span className={`font-mono ${lastSignalConf >= 70 ? "text-green-400" : lastSignalConf >= 50 ? "text-yellow-400" : "text-gray-400"}`}>{lastSignalConf}%</span>
                        </div>
                        <div className="h-1 bg-white/5 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${lastSignalConf >= 70 ? "bg-green-500" : "bg-yellow-500"}`} style={{ width: `${lastSignalConf}%` }} />
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* ── Charts + Log ─────────────────────────────────────────────── */}
              <div className="lg:col-span-2 space-y-4">

                {/* Price chart */}
                <div className="bg-white/[0.03] border border-white/[0.07] rounded-2xl p-5">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <span className="font-medium text-sm">{SYMBOLS[symbol]}</span>
                      <span className="text-2xl font-bold tabular-nums">
                        {latestTick ? latestTick.quote.toFixed(latestTick.pip_size ?? 2) : "—"}
                      </span>
                    </div>
                    <span className="text-[11px] text-gray-500">{ticks.length} ticks</span>
                  </div>
                  <ResponsiveContainer width="100%" height={150}>
                    <AreaChart data={chartTicks.map(t => ({ t: new Date(t.epoch * 1000).toLocaleTimeString([], { minute: "2-digit", second: "2-digit" }), q: t.quote }))}
                      margin={{ top: 2, right: 2, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="priceGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%"  stopColor="#22c55e" stopOpacity={0.2} />
                          <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.03)" />
                      <XAxis dataKey="t" tick={{ fill: "#4b5563", fontSize: 8 }} tickLine={false} axisLine={false} interval={11} />
                      <YAxis domain={["auto", "auto"]} tick={{ fill: "#4b5563", fontSize: 8 }} tickLine={false} axisLine={false} width={52} tickFormatter={v => v.toFixed(2)} />
                      <Tooltip contentStyle={{ backgroundColor: "#111", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, fontSize: 11 }}
                        labelStyle={{ color: "#6b7280" }} formatter={(v: number) => [v.toFixed(5), "Price"]} />
                      <Area type="monotone" dataKey="q" stroke="#22c55e" strokeWidth={1.5} fill="url(#priceGrad)" dot={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>

                {/* Equity curve */}
                <div className="bg-white/[0.03] border border-white/[0.07] rounded-2xl p-5">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <Activity className="w-4 h-4 text-gray-500" />
                      <span className="text-sm font-medium">Equity Curve</span>
                    </div>
                    <span className={`text-sm font-bold tabular-nums ${sessionPnl >= 0 ? "text-green-400" : "text-red-400"}`}>
                      {sessionPnl >= 0 ? "+" : ""}${sessionPnl.toFixed(2)}
                    </span>
                  </div>
                  {equityHistory.length > 1 ? (
                    <ResponsiveContainer width="100%" height={110}>
                      <LineChart data={equityHistory} margin={{ top: 2, right: 2, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.03)" />
                        <XAxis dataKey="t" tick={{ fill: "#4b5563", fontSize: 8 }} tickLine={false} axisLine={false} interval={9} />
                        <YAxis tick={{ fill: "#4b5563", fontSize: 8 }} tickLine={false} axisLine={false} width={42} tickFormatter={v => `$${v.toFixed(1)}`} />
                        <Tooltip contentStyle={{ backgroundColor: "#111", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, fontSize: 11 }}
                          labelStyle={{ color: "#6b7280" }} formatter={(v: number) => [`${v >= 0 ? "+" : ""}$${v.toFixed(2)}`, "P&L"]} />
                        <Line type="monotone" dataKey="pnl" stroke={sessionPnl >= 0 ? "#22c55e" : "#ef4444"} strokeWidth={2} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="h-[110px] flex items-center justify-center text-xs text-gray-600">
                      Equity curve appears after first settled trade
                    </div>
                  )}
                </div>

                {/* Activity log */}
                <div className="bg-white/[0.03] border border-white/[0.07] rounded-2xl p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <Clock className="w-4 h-4 text-gray-500" />
                    <span className="text-sm font-medium">Activity Log</span>
                    {log.length > 0 && <button onClick={() => setLog([])} className="ml-auto text-[11px] text-gray-600 hover:text-gray-400">Clear</button>}
                  </div>
                  <div className="space-y-0.5 max-h-44 overflow-y-auto font-mono text-[11px]">
                    {log.length === 0
                      ? <p className="text-gray-600 text-center py-6">Connect and start the bot to see activity</p>
                      : log.map((l, i) => (
                        <div key={i} className={`leading-relaxed py-0.5 ${
                          l.includes("✅") ? "text-green-400" :
                          l.includes("❌") ? "text-red-400" :
                          l.includes("🛑") ? "text-orange-400" :
                          l.includes("🚀") ? "text-yellow-300" :
                          l.includes("📤") ? "text-blue-400" :
                          l.includes("🔄") ? "text-purple-400" :
                          "text-gray-400"
                        }`}>{l}</div>
                      ))
                    }
                  </div>
                </div>
              </div>
            </div>
          </>
        )}

        {/* ── HISTORY TAB ───────────────────────────────────────────────────── */}
        {tab === "history" && (
          <div className="space-y-4">
            {/* Summary cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: "Total Trades", value: completed.length.toString(), color: "text-white" },
                { label: "Wins",  value: wins.toString(),  color: "text-green-400" },
                { label: "Losses", value: losses.toString(), color: "text-red-400" },
                { label: "Session P&L", value: `${sessionPnl >= 0 ? "+" : ""}$${sessionPnl.toFixed(2)}`, color: sessionPnl >= 0 ? "text-green-400" : "text-red-400" },
              ].map(s => (
                <div key={s.label} className="bg-white/[0.03] border border-white/[0.07] rounded-2xl p-4 text-center">
                  <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                  <p className="text-xs text-gray-500 mt-1">{s.label}</p>
                </div>
              ))}
            </div>

            <div className="bg-white/[0.03] border border-white/[0.07] rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-4">
                <BarChart2 className="w-4 h-4 text-gray-400" />
                <span className="font-medium">Trade Log</span>
              </div>
              {trades.length === 0
                ? <div className="text-center py-12 text-gray-600"><Activity className="w-10 h-10 mx-auto mb-2 opacity-20" /><p>No trades yet</p></div>
                : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-gray-500 border-b border-white/[0.05]">
                          {["#", "Contract", "Symbol", "Type", "Stake", "P&L", "Confidence", "Status", "Time"].map(h => (
                            <th key={h} className="text-left pb-2.5 font-medium pr-3">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {trades.map(t => (
                          <tr key={t.id} className="border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors">
                            <td className="py-2 text-gray-600 pr-3">{t.id}</td>
                            <td className="py-2 font-mono text-gray-400 pr-3">{t.contractId ?? "—"}</td>
                            <td className="py-2 text-gray-300 pr-3">{t.symbol}</td>
                            <td className="py-2 pr-3">
                              <span className={`px-1.5 py-0.5 rounded font-bold ${
                                t.type === "CALL" ? "bg-green-500/15 text-green-400" :
                                t.type === "PUT"  ? "bg-red-500/15 text-red-400" :
                                "bg-blue-500/15 text-blue-400"
                              }`}>{t.type}</span>
                            </td>
                            <td className="py-2 font-mono pr-3">${t.stake.toFixed(2)}</td>
                            <td className={`py-2 font-mono font-bold pr-3 ${t.pnl === null ? "text-gray-500" : t.pnl >= 0 ? "text-green-400" : "text-red-400"}`}>
                              {t.pnl === null ? "open" : `${t.pnl >= 0 ? "+" : ""}$${t.pnl.toFixed(2)}`}
                            </td>
                            <td className="py-2 pr-3">
                              {t.confidence != null ? (
                                <span className={`${t.confidence >= 70 ? "text-green-400" : t.confidence >= 50 ? "text-yellow-400" : "text-gray-500"}`}>{t.confidence}%</span>
                              ) : "—"}
                            </td>
                            <td className="py-2 pr-3">
                              <span className={`flex items-center gap-1 ${t.status === "open" ? "text-yellow-400" : t.status === "won" ? "text-green-400" : "text-red-400"}`}>
                                {t.status === "won" ? <CheckCircle className="w-3 h-3" /> : t.status === "lost" ? <AlertTriangle className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
                                {t.status}
                              </span>
                            </td>
                            <td className="py-2 text-gray-500">{t.time}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
              }
            </div>
          </div>
        )}

        {/* ── SETTINGS TAB ─────────────────────────────────────────────────── */}
        {tab === "settings" && (
          <div className="space-y-4">
            {/* Account */}
            <div className="bg-white/[0.03] border border-white/[0.07] rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-4">
                <Shield className="w-4 h-4 text-green-400" />
                <span className="font-medium">Account</span>
              </div>
              {account ? (
                <div className="space-y-1 text-sm">
                  {[["Login ID", account.loginid], ["Type", account.is_virtual ? "Demo (Virtual)" : "Real Money"], ["Currency", account.currency], ["Balance", `${account.currency} ${balance.toFixed(2)}`]].map(([k, v]) => (
                    <div key={k} className="flex justify-between py-2 border-b border-white/[0.05]">
                      <span className="text-gray-400">{k}</span>
                      <span className={`font-medium ${k === "Type" && !account.is_virtual ? "text-green-400" : ""}`}>{v}</span>
                    </div>
                  ))}
                  <button onClick={disconnect} className="w-full mt-3 h-9 rounded-lg border border-red-500/20 text-red-400 hover:bg-red-500/10 text-sm transition-colors">
                    Disconnect Account
                  </button>
                </div>
              ) : <p className="text-sm text-gray-500">Not connected</p>}
            </div>

            {/* Auto-reconnect */}
            <div className="bg-white/[0.03] border border-white/[0.07] rounded-2xl p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-sm">Auto-Reconnect</p>
                  <p className="text-xs text-gray-500 mt-0.5">Automatically reconnect if connection drops</p>
                </div>
                <button onClick={() => { setAutoReconnect(v => !v); autoReconnectRef.current = !autoReconnect; }}
                  className={`w-11 h-6 rounded-full transition-colors relative ${autoReconnect ? "bg-green-600" : "bg-white/10"}`}>
                  <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all shadow ${autoReconnect ? "left-[22px]" : "left-0.5"}`} />
                </button>
              </div>
            </div>

            {/* How to get token */}
            <div className="bg-white/[0.03] border border-white/[0.07] rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <Info className="w-4 h-4 text-blue-400" />
                <span className="font-medium">How to Get a Deriv API Token</span>
              </div>
              {[
                "1. Log in or sign up at app.deriv.com",
                "2. Go to Account Settings → API Token",
                "3. Create a token with Read, Trade, and Payments permissions",
                "4. Copy the token and paste it in the connect panel above",
                "5. Always test with a Demo account first before using real money",
              ].map((s, i) => <p key={i} className="text-sm text-gray-400 py-1">{s}</p>)}
              <a href="https://app.deriv.com/account/api-token" target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-sm text-green-400 hover:text-green-300 underline mt-2">
                Open Deriv API Token page ↗
              </a>
            </div>

            {/* Strategy guide */}
            <div className="bg-white/[0.03] border border-white/[0.07] rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <BarChart2 className="w-4 h-4 text-purple-400" />
                <span className="font-medium">Strategy Guide</span>
              </div>
              <div className="space-y-3">
                {STRATEGIES.map(s => (
                  <div key={s.id} className="border-b border-white/[0.05] pb-3 last:border-0 last:pb-0">
                    <p className="text-sm font-medium text-gray-200">{s.label}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{s.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
