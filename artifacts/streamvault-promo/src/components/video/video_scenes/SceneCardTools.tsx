import { motion, AnimatePresence } from 'framer-motion';
import { useState, useEffect, useCallback } from 'react';

// ─── Luhn helpers ─────────────────────────────────────────────────────────────
function luhnCheck(num: string): boolean {
  const digits = num.replace(/\D/g, '').split('').map(Number);
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits[i];
    if (alt) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
    alt = !alt;
  }
  return sum % 10 === 0;
}

function luhnComplete(partial: string): string {
  const base = partial.replace(/\D/g, '');
  for (let d = 0; d <= 9; d++) {
    const candidate = base + d;
    if (luhnCheck(candidate)) return candidate;
  }
  return base + '0';
}

function randomDigits(n: number) {
  return Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join('');
}

const BIN_PROFILES = [
  { bin: '4532', brand: 'Visa',       type: 'Debit',   bank: 'Chase Bank',       country: '🇺🇸 US', color: '#3b82f6' },
  { bin: '5412', brand: 'Mastercard', type: 'Credit',  bank: 'Barclays Bank',    country: '🇬🇧 UK', color: '#f59e0b' },
  { bin: '3782', brand: 'Amex',       type: 'Charge',  bank: 'American Express', country: '🇺🇸 US', color: '#22c55e' },
  { bin: '6011', brand: 'Discover',   type: 'Debit',   bank: 'Discover Bank',    country: '🇺🇸 US', color: '#ec4899' },
  { bin: '4716', brand: 'Visa',       type: 'Prepaid', bank: 'KCB Bank',         country: '🇰🇪 KE', color: '#3b82f6' },
  { bin: '5399', brand: 'Mastercard', type: 'Credit',  bank: 'Equity Bank',      country: '🇰🇪 KE', color: '#f59e0b' },
];

function generateCard(profile: typeof BIN_PROFILES[0]) {
  const len = profile.brand === 'Amex' ? 15 : 16;
  const partial = profile.bin + randomDigits(len - profile.bin.length - 1);
  const full = luhnComplete(partial);
  const year = new Date().getFullYear() + 1 + Math.floor(Math.random() * 4);
  const month = String(Math.floor(Math.random() * 12) + 1).padStart(2, '0');
  const cvv = randomDigits(profile.brand === 'Amex' ? 4 : 3);
  const formatted = full.match(/.{1,4}/g)!.join(' ');
  return { number: formatted, raw: full, exp: `${month}/${year}`, cvv, profile };
}

// ─── Link shortener helper ────────────────────────────────────────────────────
const LONG_URLS = [
  { long: 'https://streamvault-premium.site/tradingbot?ref=youtube&utm_source=ad', short: 'sv.pm/bot' },
  { long: 'https://streamvault-premium.site/proxies?tier=residential&plan=monthly', short: 'sv.pm/prx' },
  { long: 'https://streamvault-premium.site/giftcards?category=amazon&country=us', short: 'sv.pm/gc' },
  { long: 'https://streamvault-premium.site/smm?platform=instagram&service=followers', short: 'sv.pm/smm' },
];

// ─── Link Shortener Panel ─────────────────────────────────────────────────────
function LinkPanel({ delay }: { delay: number }) {
  const [idx, setIdx] = useState(0);
  const [phase, setPhase] = useState<'typing' | 'done'>('typing');
  const [typed, setTyped] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const url = LONG_URLS[idx];
    let i = 0;
    setTyped('');
    setPhase('typing');
    setCopied(false);
    const ti = setInterval(() => {
      i++;
      setTyped(url.long.slice(0, i));
      if (i >= url.long.length) {
        clearInterval(ti);
        setTimeout(() => setPhase('done'), 300);
        setTimeout(() => setCopied(true), 700);
        setTimeout(() => {
          setCopied(false);
          setIdx(p => (p + 1) % LONG_URLS.length);
        }, 2800);
      }
    }, 28);
    return () => clearInterval(ti);
  }, [idx]);

  const current = LONG_URLS[idx];

  return (
    <motion.div
      className="rounded-2xl p-5 flex flex-col"
      style={{ background: '#111111', border: '1px solid #22c55e22', minHeight: 0 }}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="flex items-center gap-3 mb-4">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center text-lg" style={{ background: '#22c55e18' }}>🔗</div>
        <div>
          <div className="font-bold text-sm" style={{ fontFamily: 'var(--font-display)', color: '#ffffff' }}>Link Shortener</div>
          <div className="text-xs" style={{ color: '#52525b' }}>Custom slug · Click analytics · QR code</div>
        </div>
        <div className="ml-auto text-xs px-2 py-0.5 rounded-full font-bold" style={{ background: '#22c55e18', color: '#22c55e', fontFamily: 'var(--font-mono)' }}>FREE</div>
      </div>

      <div className="flex flex-col gap-3 flex-1">
        {/* Long URL input */}
        <div className="rounded-xl px-4 py-3" style={{ background: '#0d0d0d', border: '1px solid #1a1a1a' }}>
          <div className="text-xs font-mono uppercase tracking-wider mb-1.5" style={{ color: '#3f3f46' }}>Long URL</div>
          <div className="text-xs font-mono truncate" style={{ color: '#71717a' }}>
            {typed}<span className="animate-pulse" style={{ color: '#22c55e' }}>|</span>
          </div>
        </div>

        {/* Arrow + short URL */}
        <AnimatePresence mode="wait">
          {phase === 'done' && (
            <motion.div key="result" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}>
              <div className="flex items-center gap-2 mb-2">
                <div className="flex-1 h-px" style={{ background: '#22c55e44' }} />
                <span className="text-xs" style={{ color: '#22c55e' }}>✓ Shortened</span>
                <div className="flex-1 h-px" style={{ background: '#22c55e44' }} />
              </div>
              <div className="rounded-xl px-4 py-3 flex items-center justify-between" style={{ background: '#0d0d0d', border: '1px solid #22c55e44' }}>
                <span className="text-sm font-mono font-bold" style={{ color: '#22c55e' }}>https://{current.short}</span>
                <motion.div
                  className="text-xs px-3 py-1 rounded-lg font-bold"
                  style={{ background: copied ? '#22c55e22' : '#1a1a1a', color: copied ? '#22c55e' : '#3f3f46', fontFamily: 'var(--font-mono)' }}
                  animate={{ scale: copied ? [1, 1.1, 1] : 1 }}
                >
                  {copied ? '✓ Copied' : 'Copy'}
                </motion.div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Stats strip */}
        <div className="mt-auto grid grid-cols-3 gap-2">
          {[
            { label: 'Links created', val: '48.2K' },
            { label: 'Total clicks', val: '1.3M' },
            { label: 'Avg shortening', val: '0.3s' },
          ].map(s => (
            <div key={s.label} className="rounded-xl p-3 text-center" style={{ background: '#0d0d0d', border: '1px solid #1a1a1a' }}>
              <div className="text-lg font-bold" style={{ color: '#22c55e', fontFamily: 'var(--font-mono)' }}>{s.val}</div>
              <div className="text-xs" style={{ color: '#3f3f46' }}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}

// ─── CC Generator Panel ───────────────────────────────────────────────────────
function CCGenPanel({ delay }: { delay: number }) {
  const [profileIdx, setProfileIdx] = useState(0);
  const [cards, setCards] = useState<ReturnType<typeof generateCard>[]>([]);
  const [generating, setGenerating] = useState(false);

  const generate = useCallback(() => {
    setGenerating(true);
    const profile = BIN_PROFILES[profileIdx];
    setTimeout(() => {
      setCards(Array.from({ length: 5 }, () => generateCard(profile)));
      setGenerating(false);
    }, 380);
  }, [profileIdx]);

  // Auto-cycle and regenerate
  useEffect(() => {
    generate();
    const t = setInterval(() => {
      setProfileIdx(p => (p + 1) % BIN_PROFILES.length);
    }, 2800);
    return () => clearInterval(t);
  }, []);

  useEffect(() => { generate(); }, [profileIdx]);

  const profile = BIN_PROFILES[profileIdx];

  return (
    <motion.div
      className="rounded-2xl p-5 flex flex-col"
      style={{ background: '#111111', border: `1px solid ${profile.color}22` }}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="flex items-center gap-3 mb-4">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center text-lg" style={{ background: `${profile.color}18` }}>💳</div>
        <div>
          <div className="font-bold text-sm" style={{ fontFamily: 'var(--font-display)', color: '#ffffff' }}>CC Generator</div>
          <div className="text-xs" style={{ color: '#52525b' }}>Luhn-valid · BIN-accurate · Dev testing</div>
        </div>
        <div className="ml-auto text-xs px-2 py-0.5 rounded-full font-bold" style={{ background: `${profile.color}18`, color: profile.color, fontFamily: 'var(--font-mono)' }}>
          {profile.brand}
        </div>
      </div>

      {/* BIN profile tabs */}
      <div className="flex gap-1 mb-3 overflow-hidden">
        {BIN_PROFILES.map((p, i) => (
          <button key={p.bin}
            className="flex-1 text-xs py-1 rounded-lg font-bold transition-all"
            style={{
              background: i === profileIdx ? `${p.color}22` : '#0d0d0d',
              color: i === profileIdx ? p.color : '#3f3f46',
              border: `1px solid ${i === profileIdx ? p.color + '44' : '#1a1a1a'}`,
              fontFamily: 'var(--font-mono)',
              fontSize: '0.55rem',
            }}
          >
            {p.brand}
          </button>
        ))}
      </div>

      {/* BIN info */}
      <div className="rounded-xl px-3 py-2 mb-3 grid grid-cols-3 gap-2" style={{ background: '#0d0d0d', border: `1px solid ${profile.color}22` }}>
        {[
          { l: 'BIN', v: profile.bin + 'xxxxxxxxxx' },
          { l: 'Bank', v: profile.bank },
          { l: 'Country', v: profile.country },
        ].map(row => (
          <div key={row.l}>
            <div className="text-xs" style={{ color: '#3f3f46' }}>{row.l}</div>
            <div className="text-xs font-mono" style={{ color: '#a1a1aa' }}>{row.v}</div>
          </div>
        ))}
      </div>

      {/* Generated cards */}
      <div className="flex flex-col gap-1.5 flex-1">
        <AnimatePresence mode="popLayout">
          {generating ? (
            <motion.div key="spin" className="flex-1 flex items-center justify-center"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <motion.div className="w-5 h-5 rounded-full border-2 border-t-transparent"
                style={{ borderColor: profile.color, borderTopColor: 'transparent' }}
                animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 0.6, ease: 'linear' }} />
            </motion.div>
          ) : cards.map((card, i) => (
            <motion.div key={`${card.number}-${i}`}
              className="flex items-center gap-3 rounded-xl px-3 py-2"
              style={{ background: '#0d0d0d', border: '1px solid #141414' }}
              initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.04 }}
            >
              <span className="font-mono text-xs flex-1" style={{ color: '#a1a1aa', letterSpacing: '0.04em' }}>{card.number}</span>
              <span className="font-mono text-xs" style={{ color: '#52525b' }}>{card.exp}</span>
              <span className="font-mono text-xs" style={{ color: '#52525b' }}>{card.cvv}</span>
              <span className="text-xs w-1.5 h-1.5 rounded-full" style={{ background: '#22c55e', flexShrink: 0 }} title="Luhn valid" />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
      <div className="mt-2 text-xs text-center" style={{ color: '#3f3f46' }}>All numbers pass Luhn algorithm · For dev/testing only</div>
    </motion.div>
  );
}

// ─── CC Checker Panel ─────────────────────────────────────────────────────────
const CHECK_QUEUE = [
  { number: '4532 7153 3790 1241', exp: '09/2026', cvv: '382' },
  { number: '5412 7543 8821 0034', exp: '03/2027', cvv: '541' },
  { number: '4716 2241 9983 0072', exp: '12/2025', cvv: '207' },
  { number: '6011 0009 9013 9424', exp: '06/2028', cvv: '819' },
  { number: '5399 1122 3344 5566', exp: '11/2026', cvv: '334' },
];

type CheckResult = { status: 'valid' | 'invalid' | 'expired'; brand: string; bank: string };

function checkCard(c: typeof CHECK_QUEUE[0]): CheckResult {
  const raw = c.number.replace(/\s/g, '');
  const luhn = luhnCheck(raw);
  const [m, y] = c.exp.split('/');
  const expDate = new Date(2000 + parseInt(y), parseInt(m) - 1);
  const expired = expDate < new Date();
  const brands: Record<string, string> = { '4': 'Visa', '5': 'Mastercard', '6': 'Discover', '3': 'Amex' };
  const brand = brands[raw[0]] ?? 'Unknown';
  const banks = ['Chase', 'Equity Bank', 'KCB', 'Barclays', 'Discover'];
  const bank = banks[parseInt(raw[0]) % banks.length];
  if (expired) return { status: 'expired', brand, bank };
  if (!luhn) return { status: 'invalid', brand, bank };
  return { status: 'valid', brand, bank };
}

function CCCheckerPanel({ delay }: { delay: number }) {
  const [results, setResults] = useState<(CheckResult & typeof CHECK_QUEUE[0] & { checking?: boolean })[]>([]);
  const [qIdx, setQIdx] = useState(0);

  useEffect(() => {
    const t = setInterval(() => {
      const card = CHECK_QUEUE[qIdx % CHECK_QUEUE.length];
      const placeholder = { ...card, status: 'valid' as const, brand: '...', bank: '...', checking: true };
      setResults(prev => [...prev.slice(-4), placeholder]);
      setTimeout(() => {
        const result = checkCard(card);
        setResults(prev => [...prev.slice(0, -1), { ...card, ...result, checking: false }]);
      }, 600);
      setQIdx(p => p + 1);
    }, 1300);
    return () => clearInterval(t);
  }, [qIdx]);

  const statusStyle = (s: string) => ({
    valid:   { color: '#22c55e', bg: '#22c55e18', label: '✓ VALID' },
    invalid: { color: '#ef4444', bg: '#ef444418', label: '✗ INVALID' },
    expired: { color: '#f59e0b', bg: '#f59e0b18', label: '⚠ EXPIRED' },
  }[s] ?? { color: '#52525b', bg: '#1a1a1a', label: '...' });

  return (
    <motion.div
      className="rounded-2xl p-5 flex flex-col"
      style={{ background: '#111111', border: '1px solid #7c3aed22' }}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="flex items-center gap-3 mb-4">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center text-lg" style={{ background: '#7c3aed18' }}>🔍</div>
        <div>
          <div className="font-bold text-sm" style={{ fontFamily: 'var(--font-display)', color: '#ffffff' }}>CC Checker</div>
          <div className="text-xs" style={{ color: '#52525b' }}>Luhn · BIN lookup · Expiry check</div>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <motion.div className="w-1.5 h-1.5 rounded-full" style={{ background: '#22c55e' }}
            animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 0.8, repeat: Infinity }} />
          <span className="text-xs font-mono" style={{ color: '#22c55e' }}>Live</span>
        </div>
      </div>

      <div className="flex flex-col gap-2 flex-1">
        {/* Header row */}
        <div className="grid gap-2 px-2 text-xs font-bold uppercase tracking-wider" style={{ gridTemplateColumns: '2fr 1fr 1fr 1fr', color: '#3f3f46', fontFamily: 'var(--font-mono)', borderBottom: '1px solid #1a1a1a', paddingBottom: 6 }}>
          <span>Number</span><span>Exp</span><span>Brand</span><span>Status</span>
        </div>

        <AnimatePresence mode="popLayout">
          {results.map((r, i) => {
            const st = statusStyle(r.status);
            return (
              <motion.div key={`${r.number}-${i}`}
                className="grid gap-2 px-2 py-2 rounded-xl items-center"
                style={{ gridTemplateColumns: '2fr 1fr 1fr 1fr', background: '#0d0d0d' }}
                initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }}
                transition={{ duration: 0.3 }}
              >
                <span className="font-mono text-xs" style={{ color: '#71717a' }}>{r.number}</span>
                <span className="font-mono text-xs" style={{ color: '#52525b' }}>{r.exp}</span>
                <span className="text-xs" style={{ color: '#a1a1aa' }}>{r.brand}</span>
                {r.checking ? (
                  <motion.div className="w-4 h-4 rounded-full border-2 border-t-transparent"
                    style={{ borderColor: '#7c3aed', borderTopColor: 'transparent' }}
                    animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 0.5, ease: 'linear' }} />
                ) : (
                  <span className="text-xs font-bold px-2 py-0.5 rounded" style={{ background: st.bg, color: st.color, fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap', fontSize: '0.6rem' }}>
                    {st.label}
                  </span>
                )}
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
      <div className="mt-2 text-xs text-center" style={{ color: '#3f3f46' }}>Luhn algorithm · BIN database · Format validation</div>
    </motion.div>
  );
}

// ─── Main Scene ───────────────────────────────────────────────────────────────
export default function SceneCardTools() {
  return (
    <motion.div
      className="absolute inset-0 flex flex-col px-10 py-7"
      style={{ backgroundColor: '#0a0a0a' }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.5 }}
    >
      {/* Header */}
      <motion.div
        className="mb-5"
        initial={{ opacity: 0, y: -18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15, duration: 0.7 }}
      >
        <span className="text-sm font-mono uppercase tracking-widest" style={{ color: '#7c3aed' }}>Dev Tools</span>
        <h2 className="text-5xl font-bold mt-1" style={{ fontFamily: 'var(--font-display)', color: '#ffffff' }}>
          Link Shortener &amp; Card Tools
        </h2>
        <p className="mt-1 text-sm" style={{ color: '#52525b' }}>
          URL shortening with analytics · CC Generator · CC Checker — all in one place
        </p>
      </motion.div>

      {/* 3-column grid */}
      <div className="grid grid-cols-3 gap-5 flex-1 min-h-0">
        <LinkPanel delay={0.3} />
        <CCGenPanel delay={0.42} />
        <CCCheckerPanel delay={0.54} />
      </div>
    </motion.div>
  );
}
