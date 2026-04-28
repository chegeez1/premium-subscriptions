import { motion, AnimatePresence } from 'framer-motion';
import { useState, useEffect, useRef, useCallback } from 'react';

const SPEECH_LINES = [
  "Welcome to ChegeTech StreamVault — your all-in-one digital premium platform.",
  "Automate your Deriv trades 24/7 with ChegeBot Pro — earning while you sleep.",
  "Access Netflix, Disney Plus, Spotify, and 20 plus premium accounts — all under one plan.",
  "Get free disposable emails and SMS numbers — private, instant, no sign-up needed.",
  "Need cloud power? Spin up a VPS in seconds — Linux, Windows, Africa-hosted.",
  "Unlock ChatGPT Plus, Claude Pro, and Midjourney — the best AI tools, all in one place.",
  "Starting from just KES 500 per month. Pay via M-Pesa, Card, or Paystack Wallet.",
];

const WAVEFORM_BARS = 52;

// Gate: only speak in preview (iframed). Export must be silent.
const IS_IFRAMED = typeof window !== 'undefined' && window.self !== window.top;

function pickVoice(): SpeechSynthesisVoice | null {
  if (!window.speechSynthesis) return null;
  const voices = window.speechSynthesis.getVoices();
  const PREF = [
    'Google UK English Female',
    'Microsoft Jenny Online (Natural)',
    'Microsoft Aria Online (Natural)',
    'Microsoft Zira',
    'Samantha',
    'Karen',
    'Moira',
    'Google US English',
  ];
  for (const name of PREF) {
    const v = voices.find(v => v.name.includes(name));
    if (v) return v;
  }
  return voices.find(v => v.lang.startsWith('en') && !v.name.toLowerCase().includes('male')) || null;
}

function useSpeechVoice() {
  const [ready, setReady] = useState(() =>
    typeof window !== 'undefined' && window.speechSynthesis?.getVoices().length > 0,
  );
  useEffect(() => {
    if (!IS_IFRAMED || !window.speechSynthesis) return;
    if (window.speechSynthesis.getVoices().length > 0) { setReady(true); return; }
    const handler = () => setReady(true);
    window.speechSynthesis.addEventListener('voiceschanged', handler);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', handler);
  }, []);
  return ready;
}

function Waveform({ speaking }: { speaking: boolean }) {
  return (
    <div className="flex items-center justify-center gap-[3px]" style={{ height: 80 }}>
      {Array.from({ length: WAVEFORM_BARS }, (_, i) => {
        const center = WAVEFORM_BARS / 2;
        const dist = Math.abs(i - center) / center;
        const baseH = Math.max(4, (1 - dist * 0.55) * 56);
        return (
          <motion.div
            key={i}
            className="rounded-full"
            style={{
              width: 4,
              background: speaking
                ? `linear-gradient(to top, #22c55e, #7c3aed)`
                : '#1e1e1e',
            }}
            animate={
              speaking
                ? {
                    height: [
                      baseH * (0.25 + Math.random() * 0.2),
                      baseH * (0.8 + Math.random() * 0.4),
                      baseH * (0.15 + Math.random() * 0.25),
                      baseH * (1.0 + Math.random() * 0.2),
                      baseH * (0.35 + Math.random() * 0.2),
                    ],
                  }
                : { height: 4 }
            }
            transition={
              speaking
                ? {
                    duration: 0.35 + (i % 7) * 0.06,
                    repeat: Infinity,
                    repeatType: 'mirror',
                    delay: (i / WAVEFORM_BARS) * 0.25,
                    ease: 'easeInOut',
                  }
                : { duration: 0.4 }
            }
          />
        );
      })}
    </div>
  );
}

function WordByWord({
  text,
  onDone,
}: {
  text: string;
  onDone: () => void;
}) {
  const words = text.split(' ');
  const [count, setCount] = useState(0);
  const firedRef = useRef(false);

  useEffect(() => {
    firedRef.current = false;
    setCount(0);
    const PER_WORD = 115;
    const timers: ReturnType<typeof setTimeout>[] = [];
    words.forEach((_, i) => timers.push(setTimeout(() => setCount(i + 1), i * PER_WORD)));
    // Visual fallback: fire onDone if speech hasn't done it already
    timers.push(
      setTimeout(() => {
        if (!firedRef.current) { firedRef.current = true; onDone(); }
      }, words.length * PER_WORD + 1200),
    );
    return () => { timers.forEach(clearTimeout); firedRef.current = true; };
  }, [text]);

  return (
    <span>
      {words.map((word, i) => (
        <motion.span
          key={`${i}-${text}`}
          className="inline-block mr-[0.3em]"
          initial={{ opacity: 0, y: 5 }}
          animate={i < count ? { opacity: 1, y: 0 } : { opacity: 0, y: 5 }}
          transition={{ duration: 0.15 }}
        >
          {word}
        </motion.span>
      ))}
    </span>
  );
}

export default function SceneAINarrator() {
  const voiceReady = useSpeechVoice();
  const [lineIdx, setLineIdx] = useState(0);
  const [speaking, setSpeaking] = useState(true);
  const [orbPulse, setOrbPulse] = useState(true);
  const [voiceActive, setVoiceActive] = useState(false);
  const advancedRef = useRef(false);

  // Advance to next line — guarded against double-fire
  const doAdvance = useCallback(() => {
    if (advancedRef.current) return;
    advancedRef.current = true;
    setSpeaking(false);
    setOrbPulse(false);
    setVoiceActive(false);
    if (IS_IFRAMED && window.speechSynthesis) window.speechSynthesis.cancel();
    setTimeout(() => {
      advancedRef.current = false;
      setLineIdx(p => (p + 1) % SPEECH_LINES.length);
      setSpeaking(true);
      setOrbPulse(true);
    }, 550);
  }, []);

  // Speak each line via Web Speech API
  useEffect(() => {
    if (!IS_IFRAMED || !window.speechSynthesis || !voiceReady) return;

    window.speechSynthesis.cancel();
    setVoiceActive(false);

    const utt = new SpeechSynthesisUtterance(SPEECH_LINES[lineIdx]);
    utt.rate = 0.92;
    utt.pitch = 1.08;
    utt.volume = 1.0;
    const voice = pickVoice();
    if (voice) utt.voice = voice;

    utt.onstart = () => setVoiceActive(true);
    utt.onend = () => { setVoiceActive(false); doAdvance(); };
    utt.onerror = () => setVoiceActive(false);

    // Small delay so cancel() settles before next speak()
    const t = setTimeout(() => {
      window.speechSynthesis.speak(utt);
    }, 180);

    return () => {
      clearTimeout(t);
      window.speechSynthesis.cancel();
    };
  }, [lineIdx, voiceReady, doAdvance]);

  const currentText = SPEECH_LINES[lineIdx];

  return (
    <motion.div
      className="absolute inset-0 flex flex-col items-center justify-center px-20 py-12"
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
          width: 520, height: 520,
          background: 'radial-gradient(circle, #22c55e09 0%, #7c3aed06 45%, transparent 72%)',
          left: '50%', top: '50%',
          transform: 'translate(-50%, -50%)',
        }}
        animate={{ scale: speaking ? [1, 1.1, 1] : 1 }}
        transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
      />

      {/* AI Avatar */}
      <motion.div
        className="relative mb-8"
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: 0.2, duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
      >
        <motion.div
          className="absolute rounded-full"
          style={{ inset: -18, border: '2px solid #22c55e', opacity: 0.2 }}
          animate={orbPulse ? { scale: [1, 1.2, 1], opacity: [0.2, 0.05, 0.2] } : { scale: 1, opacity: 0 }}
          transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="absolute rounded-full"
          style={{ inset: -9, border: '1.5px solid #7c3aed', opacity: 0.28 }}
          animate={orbPulse ? { scale: [1, 1.12, 1], opacity: [0.28, 0.08, 0.28] } : { scale: 1, opacity: 0 }}
          transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut', delay: 0.35 }}
        />

        <div
          className="relative w-40 h-40 rounded-full flex flex-col items-center justify-center overflow-hidden"
          style={{
            background: 'linear-gradient(135deg, #0d1117, #111827)',
            border: '2px solid #1e1e1e',
            boxShadow: voiceActive
              ? '0 0 50px #22c55e33, 0 0 100px #7c3aed18'
              : speaking
              ? '0 0 30px #22c55e18'
              : '0 0 15px #00000055',
          }}
        >
          <svg className="absolute inset-0 w-full h-full opacity-10" viewBox="0 0 160 160">
            <line x1="80" y1="0" x2="80" y2="160" stroke="#22c55e" strokeWidth="0.5"/>
            <line x1="0" y1="80" x2="160" y2="80" stroke="#22c55e" strokeWidth="0.5"/>
            <ellipse cx="80" cy="80" rx="56" ry="56" fill="none" stroke="#22c55e" strokeWidth="0.5"/>
            <ellipse cx="80" cy="80" rx="32" ry="32" fill="none" stroke="#7c3aed" strokeWidth="0.5"/>
          </svg>

          <div className="flex gap-6 mb-4">
            {[0, 1].map(i => (
              <motion.div
                key={i}
                className="w-5 h-5 rounded-full"
                style={{ background: 'linear-gradient(135deg, #22c55e, #7c3aed)' }}
                animate={
                  voiceActive
                    ? { scaleY: [1, 0.12, 1, 0.9, 0.1, 1], scaleX: [1, 1.05, 1] }
                    : speaking
                    ? { scaleY: [1, 0.18, 1], scaleX: 1 }
                    : { scaleY: 0.15 }
                }
                transition={{ duration: voiceActive ? 2.8 : 3.5, repeat: Infinity, delay: i * 0.1, ease: 'easeInOut' }}
              />
            ))}
          </div>

          <motion.div
            className="rounded-full overflow-hidden flex items-end justify-center"
            style={{ width: 42, background: '#0a0a0a' }}
            animate={
              voiceActive
                ? { height: [12, 22, 8, 20, 14, 24, 10, 18, 12] }
                : speaking
                ? { height: [10, 16, 8, 14, 10] }
                : { height: 8 }
            }
            transition={{ duration: voiceActive ? 0.38 : 0.55, repeat: Infinity, repeatType: 'mirror', ease: 'easeInOut' }}
          >
            <div className="w-full h-1.5 rounded-full" style={{ background: 'linear-gradient(90deg, #22c55e, #7c3aed)' }} />
          </motion.div>
        </div>
      </motion.div>

      {/* Status bar */}
      <motion.div
        className="flex items-center gap-3 mb-5"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4 }}
      >
        <motion.div
          className="w-2.5 h-2.5 rounded-full"
          style={{ background: voiceActive ? '#22c55e' : '#3f3f46' }}
          animate={voiceActive ? { opacity: [1, 0.3, 1] } : { opacity: 1 }}
          transition={{ duration: 0.9, repeat: Infinity }}
        />
        <span className="text-sm font-mono uppercase tracking-widest" style={{ color: '#52525b' }}>
          StreamVault AI
        </span>
        {IS_IFRAMED && (
          <span
            className="text-xs px-2.5 py-1 rounded-full font-mono font-bold"
            style={{
              background: voiceActive ? '#22c55e18' : '#1a1a1a',
              color: voiceActive ? '#22c55e' : '#3f3f46',
              border: `1px solid ${voiceActive ? '#22c55e44' : '#252525'}`,
              transition: 'all 0.3s',
            }}
          >
            {voiceActive ? '🔊 Speaking' : '◦ Ready'}
          </span>
        )}
      </motion.div>

      {/* Waveform */}
      <div className="w-full max-w-2xl mb-8">
        <Waveform speaking={voiceActive || speaking} />
      </div>

      {/* Speech text */}
      <div className="w-full max-w-3xl text-center min-h-[110px] flex items-center justify-center">
        <AnimatePresence mode="wait">
          <motion.div
            key={lineIdx}
            className="text-3xl font-medium leading-relaxed"
            style={{ fontFamily: 'var(--font-display)', color: '#ffffff' }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
          >
            <WordByWord text={currentText} onDone={doAdvance} />
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Progress pills */}
      <div className="flex gap-2 mt-8">
        {SPEECH_LINES.map((_, i) => (
          <motion.div
            key={i}
            className="rounded-full"
            style={{ height: 6 }}
            animate={{
              width: i === lineIdx ? 28 : 6,
              background: i === lineIdx ? '#22c55e' : i < lineIdx ? '#22c55e44' : '#1e1e1e',
            }}
            transition={{ duration: 0.35 }}
          />
        ))}
      </div>
    </motion.div>
  );
}
