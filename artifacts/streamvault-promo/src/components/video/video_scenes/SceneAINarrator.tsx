import { motion, AnimatePresence } from 'framer-motion';
import { useState, useEffect, useRef } from 'react';

const SPEECH_LINES = [
  {
    text: "Welcome to ChegeTech StreamVault — your all-in-one digital premium platform.",
    duration: 3800,
  },
  {
    text: "Automate your Deriv trades 24/7 with ChegeBot Pro — earning while you sleep.",
    duration: 3600,
  },
  {
    text: "Access Netflix, Disney+, Spotify, and 20+ premium accounts — all under one plan.",
    duration: 3800,
  },
  {
    text: "Get free disposable emails and SMS numbers — private, instant, no sign-up needed.",
    duration: 3600,
  },
  {
    text: "Need cloud power? Spin up a VPS in seconds — Linux, Windows, Africa-hosted.",
    duration: 3500,
  },
  {
    text: "Unlock ChatGPT Plus, Claude Pro, Midjourney — the best AI tools, all in one place.",
    duration: 3600,
  },
  {
    text: "Starting from just KES 500 per month. Pay via M-Pesa, Card, or Paystack Wallet.",
    duration: 3800,
  },
];

const WAVEFORM_BARS = 48;

function Waveform({ speaking }: { speaking: boolean }) {
  const bars = Array.from({ length: WAVEFORM_BARS }, (_, i) => i);
  return (
    <div className="flex items-center justify-center gap-[3px]" style={{ height: 72 }}>
      {bars.map(i => {
        const center = WAVEFORM_BARS / 2;
        const dist = Math.abs(i - center) / center;
        const baseH = Math.max(4, (1 - dist * 0.6) * 48);
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
                      baseH * (0.3 + Math.random() * 0.2),
                      baseH * (0.7 + Math.random() * 0.5),
                      baseH * (0.2 + Math.random() * 0.3),
                      baseH * (0.9 + Math.random() * 0.3),
                      baseH * (0.4 + Math.random() * 0.2),
                    ],
                  }
                : { height: 4 }
            }
            transition={
              speaking
                ? {
                    duration: 0.5 + Math.random() * 0.4,
                    repeat: Infinity,
                    repeatType: 'mirror',
                    delay: (i / WAVEFORM_BARS) * 0.3,
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

function WordByWord({ text, onDone }: { text: string; onDone: () => void }) {
  const words = text.split(' ');
  const [count, setCount] = useState(0);
  const doneRef = useRef(false);

  useEffect(() => {
    doneRef.current = false;
    setCount(0);
    const interval = 110;
    const timers: ReturnType<typeof setTimeout>[] = [];
    words.forEach((_, i) => {
      timers.push(setTimeout(() => setCount(i + 1), i * interval));
    });
    timers.push(
      setTimeout(() => {
        if (!doneRef.current) { doneRef.current = true; onDone(); }
      }, words.length * interval + 300),
    );
    return () => { timers.forEach(clearTimeout); doneRef.current = true; };
  }, [text]);

  return (
    <span>
      {words.map((word, i) => (
        <motion.span
          key={`${i}-${text}`}
          className="inline-block mr-2"
          initial={{ opacity: 0, y: 4 }}
          animate={i < count ? { opacity: 1, y: 0 } : { opacity: 0, y: 4 }}
          transition={{ duration: 0.18 }}
        >
          {word}
        </motion.span>
      ))}
    </span>
  );
}

export default function SceneAINarrator() {
  const [lineIdx, setLineIdx] = useState(0);
  const [speaking, setSpeaking] = useState(true);
  const [orbPulse, setOrbPulse] = useState(true);

  const advance = () => {
    setSpeaking(false);
    setOrbPulse(false);
    setTimeout(() => {
      setLineIdx(p => (p + 1) % SPEECH_LINES.length);
      setSpeaking(true);
      setOrbPulse(true);
    }, 600);
  };

  const currentLine = SPEECH_LINES[lineIdx];

  return (
    <motion.div
      className="absolute inset-0 flex flex-col items-center justify-center px-20 py-12"
      style={{ backgroundColor: '#0a0a0a' }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.5 }}
    >
      {/* Background ambient glow */}
      <motion.div
        className="absolute rounded-full"
        style={{
          width: 500, height: 500,
          background: 'radial-gradient(circle, #22c55e0a 0%, #7c3aed06 40%, transparent 70%)',
          left: '50%', top: '50%',
          transform: 'translate(-50%, -50%)',
          pointerEvents: 'none',
        }}
        animate={{ scale: speaking ? [1, 1.08, 1] : 1 }}
        transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
      />

      {/* AI Avatar Orb */}
      <motion.div
        className="relative mb-10"
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: 0.2, duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
      >
        {/* Outer ring pulse */}
        <motion.div
          className="absolute rounded-full"
          style={{
            inset: -16,
            background: 'transparent',
            border: '2px solid #22c55e',
            opacity: 0.25,
          }}
          animate={orbPulse ? { scale: [1, 1.18, 1], opacity: [0.25, 0.08, 0.25] } : { scale: 1, opacity: 0 }}
          transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="absolute rounded-full"
          style={{
            inset: -8,
            background: 'transparent',
            border: '1.5px solid #7c3aed',
            opacity: 0.3,
          }}
          animate={orbPulse ? { scale: [1, 1.1, 1], opacity: [0.3, 0.1, 0.3] } : { scale: 1, opacity: 0 }}
          transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut', delay: 0.3 }}
        />

        {/* Main orb */}
        <div
          className="relative w-36 h-36 rounded-full flex flex-col items-center justify-center overflow-hidden"
          style={{
            background: 'linear-gradient(135deg, #0d1117 0%, #111827 100%)',
            border: '2px solid #1e1e1e',
            boxShadow: speaking
              ? '0 0 40px #22c55e22, 0 0 80px #7c3aed11'
              : '0 0 20px #00000044',
          }}
        >
          {/* Face grid lines */}
          <svg className="absolute inset-0 w-full h-full opacity-10" viewBox="0 0 144 144">
            <line x1="72" y1="0" x2="72" y2="144" stroke="#22c55e" strokeWidth="0.5"/>
            <line x1="0" y1="72" x2="144" y2="72" stroke="#22c55e" strokeWidth="0.5"/>
            <ellipse cx="72" cy="72" rx="50" ry="50" fill="none" stroke="#22c55e" strokeWidth="0.5"/>
            <ellipse cx="72" cy="72" rx="30" ry="30" fill="none" stroke="#7c3aed" strokeWidth="0.5"/>
          </svg>

          {/* Eyes */}
          <div className="flex gap-5 mb-3">
            {[0, 1].map(i => (
              <motion.div
                key={i}
                className="w-4 h-4 rounded-full"
                style={{ background: 'linear-gradient(135deg, #22c55e, #7c3aed)' }}
                animate={
                  speaking
                    ? { scaleY: [1, 0.15, 1, 1, 0.15, 1], scaleX: [1, 1, 1, 1, 1, 1] }
                    : { scaleY: 0.15 }
                }
                transition={{
                  duration: 3.5,
                  repeat: Infinity,
                  delay: i * 0.08,
                  ease: 'easeInOut',
                }}
              />
            ))}
          </div>

          {/* Mouth / speaking indicator */}
          <motion.div
            className="rounded-full overflow-hidden flex items-end justify-center"
            style={{ width: 36, height: 10, background: '#0a0a0a' }}
            animate={speaking ? { height: [10, 18, 8, 16, 10] } : { height: 10 }}
            transition={{ duration: 0.5, repeat: Infinity, repeatType: 'mirror', ease: 'easeInOut' }}
          >
            <div className="w-full h-1 rounded-full" style={{ background: 'linear-gradient(90deg, #22c55e, #7c3aed)' }} />
          </motion.div>
        </div>
      </motion.div>

      {/* Label */}
      <motion.div
        className="flex items-center gap-2 mb-6"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4 }}
      >
        <motion.div
          className="w-2.5 h-2.5 rounded-full"
          style={{ background: '#22c55e' }}
          animate={{ opacity: [1, 0.3, 1] }}
          transition={{ duration: 1.2, repeat: Infinity }}
        />
        <span className="text-sm font-mono uppercase tracking-widest" style={{ color: '#52525b' }}>
          StreamVault AI · Narrating
        </span>
      </motion.div>

      {/* Waveform */}
      <div className="w-full max-w-2xl mb-8">
        <Waveform speaking={speaking} />
      </div>

      {/* Speech text */}
      <div
        className="w-full max-w-3xl text-center min-h-[100px] flex items-center justify-center"
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={lineIdx}
            className="text-3xl font-medium leading-relaxed"
            style={{ fontFamily: 'var(--font-display)', color: '#ffffff' }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
          >
            <WordByWord text={currentLine.text} onDone={advance} />
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Progress dots */}
      <div className="flex gap-2 mt-8">
        {SPEECH_LINES.map((_, i) => (
          <motion.div
            key={i}
            className="rounded-full"
            style={{
              width: i === lineIdx ? 24 : 6,
              height: 6,
              background: i === lineIdx ? '#22c55e' : '#1e1e1e',
            }}
            animate={{ width: i === lineIdx ? 24 : 6, background: i === lineIdx ? '#22c55e' : '#1e1e1e' }}
            transition={{ duration: 0.3 }}
          />
        ))}
      </div>
    </motion.div>
  );
}
