import { motion, AnimatePresence } from 'framer-motion';
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';

const SPEECH_LINES = [
  "Welcome to ChegeTech StreamVault — your all-in-one digital premium platform.",
  "Automate your Deriv trades 24 7 with ChegeBot Pro — and earn while you sleep.",
  "Access Netflix, Disney Plus, Spotify, and over 20 premium accounts — all under one plan.",
  "Get free disposable emails and SMS numbers — private, instant, no sign-up needed.",
  "Need cloud power? Spin up a VPS in seconds — Linux, Windows, hosted right here in Africa.",
  "Unlock ChatGPT Plus, Claude Pro, and Midjourney — the best AI tools, all in one place.",
  "Starting from just KES 500 per month — pay via M-Pesa, Card, or Paystack Wallet. Join us today.",
];

const WAVEFORM_BARS = 54;
const IS_IFRAMED = typeof window !== 'undefined' && window.self !== window.top;

function pickVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis?.getVoices() ?? [];
  const PREF = [
    'Google UK English Female',
    'Microsoft Jenny Online (Natural)',
    'Microsoft Aria Online (Natural)',
    'Microsoft Zira Desktop',
    'Samantha',
    'Karen',
    'Moira',
    'Tessa',
    'Google US English',
  ];
  for (const name of PREF) {
    const v = voices.find(v => v.name.includes(name));
    if (v) return v;
  }
  // Any English voice that isn't explicitly "Male"
  return (
    voices.find(v => v.lang.startsWith('en') && !v.name.toLowerCase().includes('male')) ??
    voices.find(v => v.lang.startsWith('en')) ??
    null
  );
}

function useVoicesReady() {
  const [ready, setReady] = useState(() =>
    typeof window !== 'undefined' && (window.speechSynthesis?.getVoices().length ?? 0) > 0,
  );
  useEffect(() => {
    if (!IS_IFRAMED || !window.speechSynthesis) return;
    if (window.speechSynthesis.getVoices().length) { setReady(true); return; }
    const h = () => setReady(true);
    window.speechSynthesis.addEventListener('voiceschanged', h);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', h);
  }, []);
  return ready;
}

// Pre-computed deterministic bar params — no Math.random() in render
function useBarParams() {
  return useMemo(() =>
    Array.from({ length: WAVEFORM_BARS }, (_, i) => {
      const center = WAVEFORM_BARS / 2;
      const dist = Math.abs(i - center) / center;
      const maxH = Math.max(6, (1 - dist * 0.55) * 60);
      const s = i * 7.31 + 1.9; // deterministic seed
      const sin = (x: number) => Math.abs(Math.sin(s + x));
      return {
        maxH,
        heights: [
          maxH * (0.18 + sin(0) * 0.22),
          maxH * (0.65 + sin(1) * 0.45),
          maxH * (0.12 + sin(2) * 0.2),
          maxH * (0.85 + sin(3) * 0.25),
          maxH * (0.3 + sin(4) * 0.3),
        ],
        dur: 0.32 + sin(5) * 0.3,
        delay: (i / WAVEFORM_BARS) * 0.22,
      };
    }),
  []);
}

function Waveform({ active }: { active: boolean }) {
  const bars = useBarParams();
  return (
    <div className="flex items-center justify-center gap-[3px]" style={{ height: 84 }}>
      {bars.map((b, i) => (
        <motion.div
          key={i}
          className="rounded-full"
          style={{ width: 4, background: active ? 'linear-gradient(to top, #22c55e, #7c3aed)' : '#1e1e1e' }}
          animate={active ? { height: b.heights } : { height: 4 }}
          transition={
            active
              ? { duration: b.dur, repeat: Infinity, repeatType: 'mirror', delay: b.delay, ease: 'easeInOut' }
              : { duration: 0.45 }
          }
        />
      ))}
    </div>
  );
}

// Words are highlighted progressively — driven by speech boundary events
function SpeechText({ text, wordCount }: { text: string; wordCount: number }) {
  const words = text.split(' ');
  return (
    <span>
      {words.map((word, i) => (
        <motion.span
          key={`${i}-${text}`}
          className="inline-block"
          style={{ marginRight: '0.28em' }}
          animate={{
            opacity: i < wordCount ? 1 : 0.18,
            color: i === wordCount - 1 ? '#86efac' : '#ffffff',
            scale: i === wordCount - 1 ? 1.06 : 1,
          }}
          transition={{ duration: 0.12 }}
        >
          {word}
        </motion.span>
      ))}
    </span>
  );
}

export default function SceneAINarrator() {
  const voicesReady = useVoicesReady();
  const [lineIdx, setLineIdx] = useState(0);
  const [wordCount, setWordCount] = useState(0);
  const [voiceActive, setVoiceActive] = useState(false);

  const mountedRef = useRef(true);
  const lineIdxRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const speakLine = useCallback((idx: number) => {
    if (!mountedRef.current || !IS_IFRAMED || !window.speechSynthesis) return;

    const line = SPEECH_LINES[idx];
    const utt = new SpeechSynthesisUtterance(line);
    utt.rate = 0.88;
    utt.pitch = 1.06;
    utt.volume = 1.0;
    const voice = pickVoice();
    if (voice) utt.voice = voice;

    utt.onstart = () => {
      if (!mountedRef.current) return;
      setVoiceActive(true);
      setWordCount(0);
    };

    // Sync word highlights to actual speech boundaries
    utt.onboundary = (evt) => {
      if (!mountedRef.current || evt.name !== 'word') return;
      const before = line.substring(0, evt.charIndex).trimEnd();
      const wIdx = before === '' ? 0 : before.split(/\s+/).length;
      setWordCount(wIdx + 1);
    };

    utt.onend = () => {
      if (!mountedRef.current) return;
      // Show all words fully visible when line ends
      setWordCount(line.split(' ').length + 1);
      setVoiceActive(false);
      // Chain next line with a natural breath pause
      setTimeout(() => {
        if (!mountedRef.current) return;
        const next = (idx + 1) % SPEECH_LINES.length;
        lineIdxRef.current = next;
        setLineIdx(next);
        setWordCount(0);
        // Small gap between lines then speak next
        setTimeout(() => {
          if (!mountedRef.current) return;
          speakLine(next);
        }, 120);
      }, 250);
    };

    utt.onerror = () => {
      if (!mountedRef.current) return;
      setVoiceActive(false);
    };

    window.speechSynthesis.speak(utt);
  }, []);

  // Fallback visual timer for browsers without speech synthesis
  const fallbackRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!IS_IFRAMED || !window.speechSynthesis) {
      // Drive with a simple timer
      const words = SPEECH_LINES[lineIdx].split(' ');
      let w = 0;
      const iv = setInterval(() => {
        if (w < words.length) { w++; setWordCount(w); } else {
          clearInterval(iv);
          fallbackRef.current = setTimeout(() => {
            const next = (lineIdx + 1) % SPEECH_LINES.length;
            setLineIdx(next); setWordCount(0);
          }, 600);
        }
      }, 180);
      return () => { clearInterval(iv); if (fallbackRef.current) clearTimeout(fallbackRef.current); };
    }
  }, [lineIdx]);

  // Start speech chain when voices load
  useEffect(() => {
    if (!IS_IFRAMED || !voicesReady) return;
    window.speechSynthesis.cancel();
    const t = setTimeout(() => speakLine(0), 220);
    return () => {
      clearTimeout(t);
      window.speechSynthesis.cancel();
    };
  }, [voicesReady, speakLine]);

  const currentText = SPEECH_LINES[lineIdx];

  return (
    <motion.div
      className="absolute inset-0 flex flex-col items-center justify-center px-16 py-10"
      style={{ backgroundColor: '#0a0a0a' }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.5 }}
    >
      {/* Ambient glow */}
      <motion.div
        className="absolute rounded-full pointer-events-none"
        style={{
          width: 540, height: 540,
          background: 'radial-gradient(circle, #22c55e08 0%, #7c3aed05 45%, transparent 72%)',
          left: '50%', top: '50%', transform: 'translate(-50%,-50%)',
        }}
        animate={{ scale: voiceActive ? [1, 1.1, 1] : 1 }}
        transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
      />

      {/* Orb */}
      <motion.div
        className="relative mb-8"
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: 0.2, duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
      >
        {/* Rings */}
        {[{ inset: -18, color: '#22c55e', opacity: 0.18, delay: 0 }, { inset: -9, color: '#7c3aed', opacity: 0.26, delay: 0.4 }].map((r, i) => (
          <motion.div
            key={i}
            className="absolute rounded-full"
            style={{ inset: r.inset, border: `${i === 0 ? 2 : 1.5}px solid ${r.color}`, opacity: r.opacity }}
            animate={voiceActive ? { scale: [1, 1.18 - i * 0.06, 1], opacity: [r.opacity, r.opacity * 0.25, r.opacity] } : { scale: 1, opacity: r.opacity * 0.4 }}
            transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut', delay: r.delay }}
          />
        ))}

        {/* Face */}
        <div
          className="relative w-40 h-40 rounded-full flex flex-col items-center justify-center overflow-hidden"
          style={{
            background: 'linear-gradient(135deg, #0d1117, #111827)',
            border: '2px solid #1e1e1e',
            boxShadow: voiceActive
              ? '0 0 60px #22c55e30, 0 0 120px #7c3aed18'
              : '0 0 20px #00000060',
            transition: 'box-shadow 0.4s',
          }}
        >
          <svg className="absolute inset-0 w-full h-full opacity-10" viewBox="0 0 160 160">
            <line x1="80" y1="0" x2="80" y2="160" stroke="#22c55e" strokeWidth="0.5"/>
            <line x1="0" y1="80" x2="160" y2="80" stroke="#22c55e" strokeWidth="0.5"/>
            <ellipse cx="80" cy="80" rx="56" ry="56" fill="none" stroke="#22c55e" strokeWidth="0.5"/>
            <ellipse cx="80" cy="80" rx="32" ry="32" fill="none" stroke="#7c3aed" strokeWidth="0.5"/>
          </svg>

          {/* Eyes */}
          <div className="flex gap-6 mb-4">
            {[0, 1].map(i => (
              <motion.div
                key={i}
                className="w-5 h-5 rounded-full"
                style={{ background: 'linear-gradient(135deg, #22c55e, #7c3aed)' }}
                animate={
                  voiceActive
                    ? { scaleY: [1, 0.1, 1, 0.9, 0.1, 1], scaleX: [1, 1.08, 1] }
                    : { scaleY: [1, 0.2, 1] }
                }
                transition={{ duration: voiceActive ? 2.4 : 4.0, repeat: Infinity, delay: i * 0.12, ease: 'easeInOut' }}
              />
            ))}
          </div>

          {/* Mouth */}
          <motion.div
            style={{ width: 44, background: '#0a0a0a', borderRadius: 99, overflow: 'hidden', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
            animate={voiceActive ? { height: [10, 24, 6, 22, 14, 26, 8, 20, 10] } : { height: 8 }}
            transition={{ duration: voiceActive ? 0.32 : 0.6, repeat: Infinity, repeatType: 'mirror', ease: 'easeInOut' }}
          >
            <div style={{ width: '100%', height: 6, borderRadius: 99, background: 'linear-gradient(90deg, #22c55e, #7c3aed)' }} />
          </motion.div>
        </div>
      </motion.div>

      {/* Status */}
      <div className="flex items-center gap-3 mb-5">
        <motion.div
          className="w-2.5 h-2.5 rounded-full"
          style={{ background: voiceActive ? '#22c55e' : '#3f3f46' }}
          animate={voiceActive ? { opacity: [1, 0.25, 1] } : { opacity: 0.5 }}
          transition={{ duration: 0.8, repeat: Infinity }}
        />
        <span className="text-sm font-mono uppercase tracking-widest" style={{ color: '#52525b' }}>
          StreamVault AI
        </span>
        {IS_IFRAMED && (
          <motion.span
            className="text-xs px-3 py-1 rounded-full font-mono font-bold"
            animate={{
              background: voiceActive ? '#22c55e18' : '#1a1a1a',
              color: voiceActive ? '#22c55e' : '#3f3f46',
            }}
            style={{ border: '1px solid', borderColor: voiceActive ? '#22c55e44' : '#252525' }}
            transition={{ duration: 0.3 }}
          >
            {voiceActive ? '🔊 Speaking' : '○ Ready'}
          </motion.span>
        )}
      </div>

      {/* Waveform */}
      <div className="w-full max-w-2xl mb-7">
        <Waveform active={voiceActive} />
      </div>

      {/* Text */}
      <div className="w-full max-w-3xl text-center min-h-[120px] flex items-center justify-center">
        <AnimatePresence mode="wait">
          <motion.div
            key={lineIdx}
            className="text-[2rem] font-medium leading-relaxed"
            style={{ fontFamily: 'var(--font-display)', color: '#ffffff' }}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.28 }}
          >
            <SpeechText text={currentText} wordCount={wordCount} />
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Progress pills */}
      <div className="flex gap-2 mt-7">
        {SPEECH_LINES.map((_, i) => (
          <motion.div
            key={i}
            className="rounded-full"
            style={{ height: 5 }}
            animate={{
              width: i === lineIdx ? 30 : 5,
              background: i === lineIdx ? '#22c55e' : i < lineIdx ? '#22c55e50' : '#1e1e1e',
            }}
            transition={{ duration: 0.3 }}
          />
        ))}
      </div>
    </motion.div>
  );
}
