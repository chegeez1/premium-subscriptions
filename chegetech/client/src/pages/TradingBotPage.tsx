import { useEffect, useRef, useState, useCallback } from "react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import {
  Zap, Play, Square, RefreshCw, DollarSign, TrendingUp, TrendingDown,
  Activity, Shield, Eye, EyeOff, AlertTriangle, CheckCircle, Clock,
  BarChart2, Settings, Wifi, WifiOff, Copy, Info,
} from "lucide-react";

// ─── Constants ────────────────────────────────────────────────────────────────
const DERIV_WS = "wss://ws.binaryws.com/websockets/v3?app_id=1089";

const SYMBOLS: Record<string, string> = {
  R_10: "Volatility 10 Index",
  R_25: "Volatility 25 Index",
  R_50: "Volatility 50 Index",
  R_75: "Volatility 75 Index",
  R_100: "Volatility 100 Index",
  "1HZ10V": "Volatility 10 (1s)",
  "1HZ25V": "Volatility 25 (1s)",
  "1HZ50V": "Volatility 50 (1s)",
  BOOM500: "Boom 500 Index",
  CRASH500: "Crash 500 Index",
};

const CONTRACT_TYPES: Record<string, string[]> = {
  R_10: ["CALL/PUT", "DIGITOVER/DIGITUNDER"],
  R_25: ["CALL/PUT", "DIGITOVER/DIGITUNDER"],
  R_50: ["CALL/PUT", "DIGITOVER/DIGITUNDER"],
  R_75: ["CALL/PUT", "DIGITOVER/DIGITUNDER"],
  R_100: ["CALL/PUT", "DIGITOVER/DIGITUNDER"],
  "1HZ10V": ["CALL/PUT", "DIGITOVER/DIGITUNDER"],
  "1HZ25V": ["CALL/PUT", "DIGITOVER/DIGITUNDER"],
  "1HZ50V": ["CALL/PUT", "DIGITOVER/DIGITUNDER"],
  BOOM500: ["CALL/PUT"],
  CRASH500: ["CALL/PUT"],
};

const DURATIONS = [
  { label: "1 tick", value: 1, unit: "t" },
  { label: "5 ticks", value: 5, unit: "t" },
  { label: "10 ticks", value: 10, unit: "t" },
  { label: "15 ticks", value: 15, unit: "t" },
  { label: "1 minute", value: 1, unit: "m" },
  { label: "2 minutes", value: 2, unit: "m" },
  { label: "5 minutes", value: 5, unit: "m" },
];

const STRATEGIES = [
  { id: "trend", label: "Trend Follow", desc: "Weighted multi-timeframe momentum + RSI filter" },
  { id: "martingale", label: "Martingale", desc: "Reversion after loss, momentum on win" },
  { id: "anti_martingale", label: "Anti-Martingale", desc: "RSI momentum ride on winning streak" },
  { id: "digit_over", label: "Digit > 4", desc: "Last digit over 4 — 50% base probability" },
  { id: "digit_under", label: "Digit < 5", desc: "Last digit under 5 — 50% base probability" },
];

// ─── Types ────────────────────────────────────────────────────────────────────
type ConnStatus = "disconnected" | "connecting" | "authorized" | "error";
type Trade = {
  id: number; contractId?: number; type: string; stake: number;
  symbol: string; pnl: number | null; status: "open" | "won" | "lost";
  time: string; duration: string;
};
type Tick = { epoch: number; quote: number; pip_size?: number };
type AccountInfo = { loginid: string; balance: number; currency: string; is_virtual: boolean };

// ─── Strategy engine ──────────────────────────────────────────────────────────

/** Weighted RSI over a tick array (0–100). Uses price changes, not just direction. */
function calcRSI(ticks: Tick[], period = 14): number {
  if (ticks.length < period + 1) return 50;
  const changes = ticks.slice(-(period + 1)).map((t, i, a) =>
    i === 0 ? 0 : t.quote - a[i - 1].quote
  ).slice(1);
  const gains = changes.filter(c => c > 0).reduce((s, c) => s + c, 0) / period;
  const losses = Math.abs(changes.filter(c => c < 0).reduce((s, c) => s + c, 0)) / period;
  if (losses === 0) return 100;
  return 100 - 100 / (1 + gains / losses);
}

/** Weighted momentum score: recent ticks count more (linear weight). Returns positive = bullish, negative = bearish. */
function weightedMomentum(ticks: Tick[], window: number): number {
  const slice = ticks.slice(-window);
  let score = 0;
  for (let i = 1; i < slice.length; i++) {
    const weight = i; // more recent = higher weight
    if (slice[i].quote > slice[i - 1].quote) score += weight;
    else if (slice[i].quote < slice[i - 1].quote) score -= weight;
  }
  return score;
}

/** EMA of last N ticks. */
function ema(ticks: Tick[], period: number): number {
  const k = 2 / (period + 1);
  let val = ticks[ticks.length - period].quote;
  for (let i = ticks.length - period + 1; i < ticks.length; i++) {
    val = ticks[i].quote * k + val * (1 - k);
  }
  return val;
}

function getSignal(
  strategy: string,
  ticks: Tick[],
  lastPnl: number | null,
): "CALL" | "PUT" | "DIGITOVER" | "DIGITUNDER" | null {
  if (ticks.length < 25) return null; // need enough data for quality signals

  if (strategy === "trend") {
    // Multi-timeframe: short EMA vs long EMA crossover + RSI filter + weighted momentum confirmation
    if (ticks.length < 35) return null;
    const shortEma = ema(ticks, 5);
    const longEma  = ema(ticks, 25);
    const rsi      = calcRSI(ticks, 14);
    const momentum = weightedMomentum(ticks, 12);

    // Require EMA spread > tiny threshold to avoid flat-market trades
    const emaSpread = Math.abs(shortEma - longEma) / longEma;
    if (emaSpread < 0.00005) return null; // price too flat, skip

    // Bullish: short above long, RSI between 45-68 (not overextended), momentum positive
    if (shortEma > longEma && rsi >= 45 && rsi <= 68 && momentum > 5) return "CALL";
    // Bearish: short below long, RSI between 32-55, momentum clearly negative
    if (shortEma < longEma && rsi >= 32 && rsi <= 55 && momentum < -5) return "PUT";
    return null;
  }

  if (strategy === "martingale") {
    const rsi      = calcRSI(ticks, 10);
    const momentum = weightedMomentum(ticks, 8);

    if (lastPnl !== null && lastPnl < 0) {
      // After a loss: mean reversion — only enter when RSI is clearly at an extreme
      if (rsi > 68 && momentum > 0) return "PUT";   // strongly overbought → fade up-move
      if (rsi < 32 && momentum < 0) return "CALL";  // strongly oversold  → fade down-move
      return null; // no clear reversal setup, wait
    }
    // Normal / after win: require clearer momentum signal
    if (rsi > 60 && momentum > 3) return "CALL";
    if (rsi < 40 && momentum < -3) return "PUT";
    return null;
  }

  if (strategy === "anti_martingale") {
    // RSI + momentum: only enter when trend is clearly confirmed
    const rsi      = calcRSI(ticks, 14);
    const momentum = weightedMomentum(ticks, 12);

    if (lastPnl !== null && lastPnl > 0) {
      // On a winning streak: stay in trend only if RSI still healthy
      if (rsi > 54 && rsi < 72 && momentum > 3) return "CALL";
      if (rsi < 46 && rsi > 28 && momentum < -3) return "PUT";
      return null;
    }
    // First trade: require strong signal
    if (rsi > 60 && momentum > 5) return "CALL";
    if (rsi < 40 && momentum < -5) return "PUT";
    return null;
  }

  // Digit strategies: always fire (signal quality comes from barrier choice)
  if (strategy === "digit_over") return "DIGITOVER";
  if (strategy === "digit_under") return "DIGITUNDER";

  return null;
}

function getMartingaleStake(
  strategy: string,
  baseStake: number,
  lastPnl: number | null,
  lastStake: number,
): number {
  if (strategy === "martingale" && lastPnl !== null && lastPnl < 0) {
    return Math.min(lastStake * 2, baseStake * 16);
  }
  if (strategy === "anti_martingale" && lastPnl !== null && lastPnl > 0) {
    return Math.min(lastStake * 2, baseStake * 8); // cap at 8x (less aggressive)
  }
  return baseStake;
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function TradingBotPage() {
  // Connection & auth
  const [apiToken, setApiToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [connStatus, setConnStatus] = useState<ConnStatus>("disconnected");
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [balance, setBalance] = useState(0);
  const [error, setError] = useState("");

  // Bot config
  const [symbol, setSymbol] = useState("R_50");
  const [strategy, setStrategy] = useState("trend");
  const [baseStake, setBaseStake] = useState(1);
  const [durIdx, setDurIdx] = useState(2); // 10 ticks default
  const [stopLoss, setStopLoss] = useState(10);
  const [takeProfit, setTakeProfit] = useState(20);
  const [maxDailyLoss, setMaxDailyLoss] = useState(50);

  // Runtime
  const [running, setRunning] = useState(false);
  const [ticks, setTicks] = useState<Tick[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [sessionPnl, setSessionPnl] = useState(0);
  const [dailyLoss, setDailyLoss] = useState(0);
  const [log, setLog] = useState<string[]>([]);
  const [openContracts, setOpenContracts] = useState<number[]>([]);
  const [lastStake, setLastStake] = useState(1);
  const [lastPnl, setLastPnl] = useState<number | null>(null);
  const [tab, setTab] = useState<"bot" | "history" | "settings">("bot");
  const [waitingContract, setWaitingContract] = useState(false);

  // Refs
  const wsRef = useRef<WebSocket | null>(null);
  const reqIdRef = useRef(1);
  const runningRef = useRef(false);
  const sessionPnlRef = useRef(0);
  const dailyLossRef = useRef(0);
  const lastStakeRef = useRef(1);
  const lastPnlRef = useRef<number | null>(null);
  const ticksRef = useRef<Tick[]>([]);
  const waitingRef = useRef(false);
  const tradeIdRef = useRef(1);
  const consecutiveLossRef = useRef(0);   // count of consecutive losses
  const cooldownTicksRef = useRef(0);     // ticks remaining in post-trade cooldown

  runningRef.current = running;
  sessionPnlRef.current = sessionPnl;
  dailyLossRef.current = dailyLoss;
  lastStakeRef.current = lastStake;
  lastPnlRef.current = lastPnl;
  ticksRef.current = ticks;
  waitingRef.current = waitingContract;

  const addLog = useCallback((msg: string, type: "info" | "win" | "loss" | "warn" = "info") => {
    const ts = new Date().toLocaleTimeString();
    setLog(prev => [`[${ts}] ${msg}`, ...prev].slice(0, 100));
  }, []);

  // ── Send message ─────────────────────────────────────────────────────────────
  const send = useCallback((obj: object) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ ...obj, req_id: reqIdRef.current++ }));
    }
  }, []);

  // ── Place contract ────────────────────────────────────────────────────────────
  const placeContract = useCallback((signal: "CALL" | "PUT" | "DIGITOVER" | "DIGITUNDER", stake: number) => {
    if (waitingRef.current) return;
    const dur = DURATIONS[durIdx];
    const contractType = signal;
    const isDigit = signal.startsWith("DIGIT");
    // DIGITOVER "4" → win if last digit is 5-9 (50%). DIGITUNDER "5" → win if digit 0-4 (50%).
    const barrier = isDigit ? (signal === "DIGITOVER" ? "4" : "5") : undefined;

    const params: any = {
      amount: stake,
      basis: "stake",
      contract_type: contractType,
      currency: "USD",
      duration: dur.value,
      duration_unit: dur.unit,
      symbol,
    };
    if (barrier !== undefined) params.barrier = barrier;

    send({ buy: "1", price: stake, parameters: params });
    setWaitingContract(true);
    addLog(`📤 Placing ${signal} | Stake: $${stake.toFixed(2)} | ${dur.label}`, "info");
  }, [durIdx, symbol, send, addLog]);

  // ── Process ticks & fire strategy ────────────────────────────────────────────
  const processTick = useCallback((tick: Tick) => {
    setTicks(prev => {
      const next = [...prev, tick].slice(-100);
      ticksRef.current = next;
      return next;
    });

    if (!runningRef.current || waitingRef.current) return;

    // Post-trade cooldown: count down, skip until it hits 0
    if (cooldownTicksRef.current > 0) {
      cooldownTicksRef.current -= 1;
      return;
    }

    // Risk checks
    const spnl = sessionPnlRef.current;
    const dl = dailyLossRef.current;
    if (spnl <= -stopLoss) { addLog(`🛑 Stop loss hit ($${Math.abs(spnl).toFixed(2)}). Bot paused.`, "warn"); setRunning(false); return; }
    if (spnl >= takeProfit) { addLog(`✅ Take profit hit (+$${spnl.toFixed(2)}). Bot paused.`, "win"); setRunning(false); return; }
    if (dl >= maxDailyLoss) { addLog(`🛑 Max daily loss hit. Bot stopped.`, "warn"); setRunning(false); return; }

    const currentTicks = ticksRef.current;
    const signal = getSignal(strategy, currentTicks, lastPnlRef.current);
    if (!signal) return;

    const stake = getMartingaleStake(strategy, baseStake, lastPnlRef.current, lastStakeRef.current);
    setLastStake(stake);
    lastStakeRef.current = stake;
    placeContract(signal, stake);
  }, [stopLoss, takeProfit, maxDailyLoss, strategy, baseStake, placeContract, addLog]);

  // ── Handle Deriv messages ─────────────────────────────────────────────────────
  const handleMessage = useCallback((data: any) => {
    const type = data.msg_type;

    if (data.error) {
      const errMsg = data.error.message || "Unknown error";
      addLog(`❌ Error: ${errMsg}`, "warn");
      if (type === "authorize") { setError(errMsg); setConnStatus("error"); }
      if (type === "buy") { setWaitingContract(false); }
      return;
    }

    switch (type) {
      case "authorize": {
        const a = data.authorize;
        setAccount({ loginid: a.loginid, balance: a.balance, currency: a.currency, is_virtual: a.is_virtual === 1 });
        setBalance(a.balance);
        setConnStatus("authorized");
        setError("");
        addLog(`✅ Authorized: ${a.loginid} | Balance: ${a.currency} ${a.balance.toFixed(2)} | ${a.is_virtual ? "Demo" : "Real"} account`);
        send({ balance: 1, subscribe: 1 });
        break;
      }

      case "balance": {
        const b = data.balance;
        setBalance(b.balance);
        break;
      }

      case "tick": {
        const t = data.tick;
        processTick({ epoch: t.epoch, quote: t.quote, pip_size: t.pip_size });
        break;
      }

      case "buy": {
        // Keep waitingContract=true — do NOT release the lock here.
        // The lock is only released when the contract settles (proposal_open_contract with is_sold).
        const b = data.buy;
        const contractId = b.contract_id;
        setOpenContracts(prev => [...prev, contractId]);
        const dur = DURATIONS[durIdx];
        const newTrade: Trade = {
          id: tradeIdRef.current++,
          contractId,
          type: b.shortcode?.includes("CALL") ? "CALL" : b.shortcode?.includes("PUT") ? "PUT" :
                b.shortcode?.includes("OVER") ? "DIGITOVER" : "DIGITUNDER",
          stake: b.buy_price,
          symbol,
          pnl: null,
          status: "open",
          time: new Date().toLocaleTimeString(),
          duration: `${dur.value}${dur.unit}`,
        };
        setTrades(prev => [newTrade, ...prev]);
        addLog(`📋 Contract #${contractId} opened | Stake: $${b.buy_price.toFixed(2)}`);
        send({ proposal_open_contract: 1, contract_id: contractId, subscribe: 1 });
        break;
      }

      case "proposal_open_contract": {
        const c = data.proposal_open_contract;
        if (!c || !c.is_sold) return;
        const contractId = c.contract_id;
        const profit = c.profit ?? 0;
        const won = profit > 0;

        setTrades(prev => prev.map(t =>
          t.contractId === contractId
            ? { ...t, pnl: profit, status: won ? "won" : "lost" }
            : t
        ));
        setOpenContracts(prev => prev.filter(id => id !== contractId));
        setSessionPnl(prev => {
          const next = prev + profit;
          sessionPnlRef.current = next;
          return next;
        });
        if (profit < 0) {
          setDailyLoss(prev => {
            const next = prev + Math.abs(profit);
            dailyLossRef.current = next;
            return next;
          });
          consecutiveLossRef.current += 1;
        } else {
          consecutiveLossRef.current = 0;
        }
        setLastPnl(profit);
        lastPnlRef.current = profit;

        // After 3 consecutive losses, enforce a 30-tick cooldown before next trade
        if (consecutiveLossRef.current >= 3) {
          cooldownTicksRef.current = 30;
          addLog(`⏸ 3 consecutive losses — cooling down 30 ticks`, "warn");
          consecutiveLossRef.current = 0;
        } else {
          // Normal cooldown: wait at least 10 ticks after every settled trade
          cooldownTicksRef.current = 10;
        }

        // Release the lock — next trade can fire after cooldown
        setWaitingContract(false);
        waitingRef.current = false;

        addLog(
          won
            ? `✅ WON  #${contractId} | +$${profit.toFixed(2)}`
            : `❌ LOST #${contractId} | -$${Math.abs(profit).toFixed(2)}`,
          won ? "win" : "loss"
        );
        break;
      }
    }
  }, [send, processTick, durIdx, symbol, addLog]);

  // ── Connect ────────────────────────────────────────────────────────────────
  const connect = useCallback(() => {
    if (!apiToken.trim()) { setError("Enter your Deriv API token first"); return; }
    if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
    setConnStatus("connecting");
    setError("");
    addLog("Connecting to Deriv WebSocket...");
    const ws = new WebSocket(DERIV_WS);
    wsRef.current = ws;
    ws.onopen = () => {
      addLog("Connected — authorizing...");
      ws.send(JSON.stringify({ authorize: apiToken.trim(), req_id: reqIdRef.current++ }));
    };
    ws.onmessage = ev => { try { handleMessage(JSON.parse(ev.data)); } catch {} };
    ws.onclose = () => {
      setConnStatus("disconnected");
      setRunning(false);
      addLog("Disconnected from Deriv");
    };
    ws.onerror = () => { setError("WebSocket connection failed"); setConnStatus("error"); };
  }, [apiToken, handleMessage, addLog]);

  const disconnect = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
    setConnStatus("disconnected");
    setRunning(false);
    setAccount(null);
    setTicks([]);
  }, []);

  // ── Start / stop bot ─────────────────────────────────────────────────────────
  const startBot = useCallback(() => {
    if (connStatus !== "authorized") return;
    setRunning(true);
    setSessionPnl(0);
    setLastPnl(null);
    setLastStake(baseStake);
    setWaitingContract(false);
    consecutiveLossRef.current = 0;
    cooldownTicksRef.current = 0;
    waitingRef.current = false;
    send({ ticks: symbol, subscribe: 1 });
    addLog(`🚀 Bot started | Strategy: ${strategy} | Symbol: ${SYMBOLS[symbol]} | Base stake: $${baseStake}`);
  }, [connStatus, symbol, strategy, baseStake, send, addLog]);

  const stopBot = useCallback(() => {
    setRunning(false);
    setWaitingContract(false);
    send({ forget_all: "ticks" });
    addLog("⏹ Bot stopped");
  }, [send, addLog]);

  useEffect(() => () => { wsRef.current?.close(); }, []);

  // ── Computed stats ────────────────────────────────────────────────────────────
  const completedTrades = trades.filter(t => t.status !== "open");
  const wins = completedTrades.filter(t => t.status === "won").length;
  const losses = completedTrades.filter(t => t.status === "lost").length;
  const winRate = completedTrades.length ? Math.round((wins / completedTrades.length) * 100) : 0;
  const chartTicks = ticks.slice(-50);
  const recentPriceMin = chartTicks.length ? Math.min(...chartTicks.map(t => t.quote)) * 0.9998 : 0;
  const recentPriceMax = chartTicks.length ? Math.max(...chartTicks.map(t => t.quote)) * 1.0002 : 0;
  const latestTick = ticks[ticks.length - 1];

  const stColor = connStatus === "authorized" ? "text-green-400 border-green-500/30 bg-green-500/10"
    : connStatus === "connecting" ? "text-yellow-400 border-yellow-500/30 bg-yellow-500/10"
    : connStatus === "error" ? "text-red-400 border-red-500/30 bg-red-500/10"
    : "text-gray-500 border-white/10 bg-white/5";

  return (
    <div className="min-h-screen bg-[#080808] text-white font-sans">
      {/* Header */}
      <header className="border-b border-white/8 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-green-500/15 border border-green-500/25 flex items-center justify-center">
            <Zap className="w-5 h-5 text-green-400" />
          </div>
          <div>
            <h1 className="font-bold text-lg">ChegeBot Pro</h1>
            <p className="text-xs text-gray-500">Deriv Trading Bot · Real Account Support</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {account && (
            <div className="text-right hidden sm:block">
              <p className="text-xs text-gray-500">{account.loginid} · {account.is_virtual ? "Demo" : "Real"}</p>
              <p className="text-sm font-bold text-green-400">{account.currency} {balance.toFixed(2)}</p>
            </div>
          )}
          <span className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border ${stColor}`}>
            {connStatus === "authorized" ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
            {connStatus === "authorized" ? "Connected" : connStatus === "connecting" ? "Connecting…" : connStatus === "error" ? "Error" : "Offline"}
          </span>
        </div>
      </header>

      {/* Tabs */}
      <div className="border-b border-white/8 px-6 flex gap-1">
        {(["bot", "history", "settings"] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-3 text-sm font-medium capitalize transition-colors border-b-2 -mb-px ${tab === t ? "border-green-500 text-green-400" : "border-transparent text-gray-500 hover:text-gray-300"}`}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="max-w-7xl mx-auto px-4 py-5 space-y-4">
        {/* ── Connect panel ─────────────────────────────────────────────────── */}
        {connStatus !== "authorized" && (
          <div className="bg-white/[0.04] border border-white/8 rounded-2xl p-5">
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
                    onChange={e => setApiToken(e.target.value)}
                    placeholder="Paste your Deriv API token here"
                    className="w-full bg-black/50 border border-white/10 rounded-lg px-3 pr-9 h-10 text-sm text-white focus:outline-none focus:border-green-500/40 font-mono"
                  />
                  <button onClick={() => setShowToken(v => !v)} className="absolute right-2.5 top-2.5 text-gray-500 hover:text-white">
                    {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {error && <p className="text-xs text-red-400 mt-1.5 flex items-center gap-1"><AlertTriangle className="w-3 h-3" />{error}</p>}
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-xs text-gray-400 mb-1.5 block invisible">Connect</label>
                <button
                  onClick={connStatus === "disconnected" || connStatus === "error" ? connect : disconnect}
                  disabled={connStatus === "connecting"}
                  className={`h-10 rounded-lg text-sm font-semibold transition-colors flex items-center justify-center gap-2 ${
                    connStatus === "connecting" ? "bg-yellow-600/50 cursor-wait text-yellow-300" :
                    connStatus === "disconnected" || connStatus === "error" ? "bg-green-600 hover:bg-green-500 text-white" :
                    "bg-red-600/70 hover:bg-red-600 text-white"
                  }`}
                >
                  {connStatus === "connecting" ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" />Connecting…</> :
                   connStatus === "disconnected" || connStatus === "error" ? <><Wifi className="w-3.5 h-3.5" />Connect</> :
                   <><WifiOff className="w-3.5 h-3.5" />Disconnect</>}
                </button>
              </div>
            </div>
            <div className="mt-3 p-3 bg-blue-500/5 border border-blue-500/15 rounded-xl flex gap-2 text-xs text-blue-300">
              <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>Get your API token at <a href="https://app.deriv.com/account/api-token" target="_blank" rel="noopener noreferrer" className="underline hover:text-blue-200">app.deriv.com/account/api-token</a> — use a Demo account to test risk-free first.</span>
            </div>
          </div>
        )}

        {tab === "bot" && (
          <>
            {/* Stats row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                {
                  label: "Balance",
                  value: account ? `${account.currency} ${balance.toFixed(2)}` : "—",
                  icon: DollarSign,
                  color: "text-white",
                  sub: account ? (account.is_virtual ? "Demo account" : "Real account") : "Not connected",
                  subColor: account?.is_virtual ? "text-yellow-500" : account ? "text-green-400" : "text-gray-600",
                },
                {
                  label: "Session P&L",
                  value: completedTrades.length ? `${sessionPnl >= 0 ? "+" : ""}$${sessionPnl.toFixed(2)}` : "—",
                  icon: sessionPnl >= 0 ? TrendingUp : TrendingDown,
                  color: sessionPnl > 0 ? "text-green-400" : sessionPnl < 0 ? "text-red-400" : "text-gray-400",
                  sub: `Stop: -$${stopLoss} · Target: +$${takeProfit}`,
                  subColor: "text-gray-500",
                },
                {
                  label: "Win Rate",
                  value: completedTrades.length ? `${winRate}%` : "—",
                  icon: Activity,
                  color: winRate >= 55 ? "text-green-400" : winRate > 0 ? "text-yellow-400" : "text-gray-400",
                  sub: `${wins}W / ${losses}L · ${completedTrades.length} trades`,
                  subColor: "text-gray-500",
                },
                {
                  label: "Daily Loss",
                  value: `$${dailyLoss.toFixed(2)}`,
                  icon: Shield,
                  color: dailyLoss >= maxDailyLoss * 0.8 ? "text-red-400" : "text-gray-300",
                  sub: `Limit: $${maxDailyLoss}`,
                  subColor: dailyLoss >= maxDailyLoss * 0.8 ? "text-red-400" : "text-gray-500",
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

            {/* Controls + Chart */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* Bot config */}
              <div className="bg-white/[0.04] border border-white/8 rounded-2xl p-5 space-y-4">
                <div className="flex items-center gap-2">
                  <Settings className="w-4 h-4 text-gray-400" />
                  <span className="text-sm font-medium">Bot Configuration</span>
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
                  <p className="text-xs text-gray-500 mt-1">{STRATEGIES.find(s => s.id === strategy)?.desc}</p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-gray-400 mb-1.5 block">Base Stake ($)</label>
                    <input type="number" min={0.35} max={100} step={0.5} value={baseStake} disabled={running}
                      onChange={e => setBaseStake(Number(e.target.value))}
                      className="w-full bg-black/50 border border-white/10 rounded-lg px-3 h-9 text-sm text-white focus:outline-none focus:border-green-500/40 disabled:opacity-50" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 mb-1.5 block">Duration</label>
                    <select disabled={running} value={durIdx} onChange={e => setDurIdx(Number(e.target.value))}
                      className="w-full bg-black/50 border border-white/10 rounded-lg px-3 h-9 text-sm text-white focus:outline-none focus:border-green-500/40 disabled:opacity-50">
                      {DURATIONS.map((d, i) => <option key={i} value={i}>{d.label}</option>)}
                    </select>
                  </div>
                </div>

                <div className="border-t border-white/5 pt-4 space-y-3">
                  <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">Risk Management</p>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { label: "Stop Loss", val: stopLoss, set: setStopLoss, color: "text-red-400" },
                      { label: "Take Profit", val: takeProfit, set: setTakeProfit, color: "text-green-400" },
                      { label: "Max Daily Loss", val: maxDailyLoss, set: setMaxDailyLoss, color: "text-orange-400" },
                    ].map(r => (
                      <div key={r.label}>
                        <label className={`text-xs mb-1 block ${r.color}`}>{r.label} ($)</label>
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
                      className="flex-1 flex items-center justify-center gap-2 h-10 rounded-xl bg-green-600 hover:bg-green-500 disabled:opacity-40 disabled:cursor-not-allowed text-sm font-bold text-white transition-colors">
                      <Play className="w-4 h-4" /> Start Bot
                    </button>
                  ) : (
                    <button onClick={stopBot}
                      className="flex-1 flex items-center justify-center gap-2 h-10 rounded-xl bg-red-600/80 hover:bg-red-600 text-sm font-bold text-white transition-colors">
                      <Square className="w-4 h-4" /> Stop Bot
                    </button>
                  )}
                  <button onClick={() => { setSessionPnl(0); setDailyLoss(0); setTrades([]); setLastPnl(null); setLastStake(baseStake); addLog("Stats reset"); }}
                    disabled={running}
                    className="px-3 h-10 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-gray-400 disabled:opacity-40 transition-colors">
                    <RefreshCw className="w-4 h-4" />
                  </button>
                </div>

                {running && (
                  <div className="flex items-center gap-2 text-xs text-green-400 bg-green-500/5 border border-green-500/15 rounded-lg px-3 py-2">
                    <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                    Bot running · waiting for signal…
                    {waitingContract && " · contract open"}
                  </div>
                )}
              </div>

              {/* Live chart + log */}
              <div className="lg:col-span-2 space-y-4">
                {/* Tick chart */}
                <div className="bg-white/[0.04] border border-white/8 rounded-2xl p-5">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <span className="font-medium text-sm">{SYMBOLS[symbol]}</span>
                      <span className="ml-3 text-2xl font-bold tabular-nums">
                        {latestTick ? latestTick.quote.toFixed(latestTick.pip_size ?? 2) : "—"}
                      </span>
                    </div>
                    <span className="text-xs text-gray-500">{ticks.length} ticks</span>
                  </div>
                  <ResponsiveContainer width="100%" height={180}>
                    <AreaChart data={chartTicks.map(t => ({ t: new Date(t.epoch * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }), q: t.quote }))}
                      margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="tg" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#22c55e" stopOpacity={0.2} />
                          <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                      <XAxis dataKey="t" tick={{ fill: "#6b7280", fontSize: 9 }} tickLine={false} axisLine={false} interval={9} />
                      <YAxis domain={[recentPriceMin, recentPriceMax]} tick={{ fill: "#6b7280", fontSize: 9 }} tickLine={false} axisLine={false} width={55}
                        tickFormatter={v => v.toFixed(2)} />
                      <Tooltip contentStyle={{ backgroundColor: "#111", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 }}
                        labelStyle={{ color: "#9ca3af" }} formatter={(v: any) => [v.toFixed(5), "Price"]} />
                      <Area type="monotone" dataKey="q" stroke="#22c55e" strokeWidth={1.5} fill="url(#tg)" dot={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>

                {/* Activity log */}
                <div className="bg-white/[0.04] border border-white/8 rounded-2xl p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <Clock className="w-4 h-4 text-gray-500" />
                    <span className="text-sm font-medium">Activity Log</span>
                  </div>
                  <div className="space-y-1 max-h-40 overflow-y-auto font-mono text-xs">
                    {log.length === 0
                      ? <p className="text-gray-600 text-center py-4">Connect and start the bot to see activity</p>
                      : log.map((l, i) => (
                        <div key={i} className={`leading-relaxed ${
                          l.includes("✅") ? "text-green-400" :
                          l.includes("❌") ? "text-red-400" :
                          l.includes("🛑") ? "text-orange-400" :
                          l.includes("🚀") ? "text-yellow-400" :
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

        {/* ── Trade History tab ───────────────────────────────────────────────── */}
        {tab === "history" && (
          <div className="bg-white/[0.04] border border-white/8 rounded-2xl p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <BarChart2 className="w-4 h-4 text-gray-400" />
                <span className="font-medium">Trade History</span>
              </div>
              <div className="flex gap-4 text-sm">
                <span className="text-green-400">{wins} wins</span>
                <span className="text-red-400">{losses} losses</span>
                <span className={`font-bold ${sessionPnl >= 0 ? "text-green-400" : "text-red-400"}`}>
                  {sessionPnl >= 0 ? "+" : ""}${sessionPnl.toFixed(2)}
                </span>
              </div>
            </div>
            {trades.length === 0
              ? <div className="text-center py-12 text-gray-600"><Activity className="w-10 h-10 mx-auto mb-2 opacity-20" /><p>No trades yet</p></div>
              : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-gray-500 border-b border-white/5">
                        {["#", "Contract ID", "Symbol", "Type", "Stake", "P&L", "Status", "Time", "Duration"].map(h => (
                          <th key={h} className="text-left pb-2 font-medium pr-4">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {trades.map(t => (
                        <tr key={t.id} className="border-b border-white/[0.04] hover:bg-white/[0.02]">
                          <td className="py-2 text-gray-600 pr-4">{t.id}</td>
                          <td className="py-2 font-mono text-gray-400 pr-4">{t.contractId ?? "—"}</td>
                          <td className="py-2 text-gray-300 pr-4">{t.symbol}</td>
                          <td className="py-2 pr-4">
                            <span className={`px-1.5 py-0.5 rounded text-xs font-bold ${
                              t.type === "CALL" ? "bg-green-500/15 text-green-400" :
                              t.type === "PUT" ? "bg-red-500/15 text-red-400" :
                              "bg-blue-500/15 text-blue-400"
                            }`}>{t.type}</span>
                          </td>
                          <td className="py-2 font-mono pr-4">${t.stake.toFixed(2)}</td>
                          <td className={`py-2 font-mono font-bold pr-4 ${t.pnl === null ? "text-gray-500" : t.pnl >= 0 ? "text-green-400" : "text-red-400"}`}>
                            {t.pnl === null ? "open" : `${t.pnl >= 0 ? "+" : ""}$${t.pnl.toFixed(2)}`}
                          </td>
                          <td className="py-2 pr-4">
                            <span className={`flex items-center gap-1 text-xs ${
                              t.status === "open" ? "text-yellow-400" :
                              t.status === "won" ? "text-green-400" : "text-red-400"
                            }`}>
                              {t.status === "won" ? <CheckCircle className="w-3 h-3" /> :
                               t.status === "lost" ? <AlertTriangle className="w-3 h-3" /> :
                               <Clock className="w-3 h-3" />}
                              {t.status}
                            </span>
                          </td>
                          <td className="py-2 text-gray-500 pr-4">{t.time}</td>
                          <td className="py-2 text-gray-500">{t.duration}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            }
          </div>
        )}

        {/* ── Settings tab ──────────────────────────────────────────────────────── */}
        {tab === "settings" && (
          <div className="space-y-4">
            <div className="bg-white/[0.04] border border-white/8 rounded-2xl p-5 space-y-4">
              <div className="flex items-center gap-2 mb-2">
                <Shield className="w-4 h-4 text-green-400" />
                <span className="font-medium">Account</span>
              </div>
              {account ? (
                <div className="space-y-2 text-sm">
                  {[["Login ID", account.loginid], ["Account Type", account.is_virtual ? "Demo (Virtual)" : "Real"], ["Currency", account.currency], ["Balance", `${account.currency} ${balance.toFixed(2)}`]].map(([k, v]) => (
                    <div key={k} className="flex justify-between py-2 border-b border-white/5">
                      <span className="text-gray-400">{k}</span>
                      <span className={`font-medium ${k === "Account Type" && !account.is_virtual ? "text-green-400" : ""}`}>{v}</span>
                    </div>
                  ))}
                  <button onClick={disconnect} className="w-full mt-2 h-9 rounded-lg border border-red-500/20 text-red-400 hover:bg-red-500/10 text-sm transition-colors">
                    Disconnect Account
                  </button>
                </div>
              ) : <p className="text-sm text-gray-500">Not connected</p>}
            </div>

            <div className="bg-white/[0.04] border border-white/8 rounded-2xl p-5 space-y-3">
              <div className="flex items-center gap-2 mb-2">
                <Info className="w-4 h-4 text-blue-400" />
                <span className="font-medium">How to Get a Deriv API Token</span>
              </div>
              {[
                "1. Log in or sign up at app.deriv.com",
                "2. Go to Account Settings → API Token",
                "3. Create a token with Read, Trade, and Payments permissions",
                "4. Copy the token and paste it in the Connect panel",
                "5. Use a Demo account first to test without risking real money",
              ].map((s, i) => <p key={i} className="text-sm text-gray-400">{s}</p>)}
              <a href="https://app.deriv.com/account/api-token" target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-sm text-green-400 hover:text-green-300 underline mt-1">
                Open Deriv API Token page
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
