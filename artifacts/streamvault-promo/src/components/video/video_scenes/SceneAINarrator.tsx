import { motion, AnimatePresence } from 'framer-motion';
import { useState, useEffect, useRef, useMemo } from 'react';
import { fetchNarrationAudio, DEFAULT_VOICE, VOICE_KEY, type AIVoice } from '@/hooks/useAINarration';

const SPEECH_LINES = [
  "Welcome to ChegeTech StreamVault — your all-in-one digital premium platform.",
  "Automate your Deriv trades 24/7 with ChegeBot Pro — and earn while you sleep.",
  "Access Netflix, Disney Plus, Spotify, and over 20 premium accounts — all under one plan.",
  "Get free disposable emails and SMS numbers — private, instant, no sign-up needed.",
  "Need cloud power? Spin up a VPS in seconds — hosted right here in Africa.",
  "Unlock ChatGPT Plus, Claude Pro, and Midjourney — the best AI tools, all in one place.",
  "Starting from just KES 500 per month — pay via M-Pesa, Card, or Paystack Wallet. Join us today.",
];

const WAVEFORM_BARS = 54;

function useBarParams() {
  return useMemo(() =>
    Array.from({ length: WAVEFORM_BARS }, (_, i) => {
      const center = WAVEFORM_BARS / 2;
      const dist = Math.abs(i - center) / center;
      const maxH = Math.max(6, (1 - dist * 0.55) * 60);
      const s = i * 7.31 + 1.9;
      const sin = (x: number) => Math.abs(Math.sin(s + x));
      return {
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
  const [lineIdx, setLineIdx] = useState(0);
  const [wordCount, setWordCount] = useState(0);
  const [voiceActive, setVoiceActive] = useState(false);
  const [loading, setLoading] = useState(true);

  const mountedRef = useRef(true);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const wordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lineIdxRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      audioRef.current?.pause();
      if (wordTimerRef.current) clearInterval(wordTimerRef.current);
    };
  }, []);

  const getVoice = (): AIVoice =>
    (localStorage.getItem(VOICE_KEY) as AIVoice) ?? DEFAULT_VOICE;

  const playLine = async (idx: number) => {
    if (!mountedRef.current) return;
    const text = SPEECH_LINES[idx];
    const voice = getVoice();

    try {
      const url = await fetchNarrationAudio(text, voice);
      if (!mountedRef.current) return;

      const audio = new Audio(url);
      audioRef.current = audio;

      audio.onloadedmetadata = () => {
        if (!mountedRef.current) return;
        setLoading(false);
        setVoiceActive(true);
        setWordCount(0);

        const words = text.split(' ');
        const durationMs = (audio.duration || words.length * 0.55) * 1000;
        const msPerWord = durationMs / words.length;

        let w = 0;
        if (wordTimerRef.current) clearInterval(wordTimerRef.current);
        wordTimerRef.current = setInterval(() => {
          if (!mountedRef.current) { clearInterval(wordTimerRef.current!); return; }
          w++;
          setWordCount(w);
          if (w >= words.length) clearInterval(wordTimerRef.current!);
        }, msPerWord);
      };

      audio.onended = () => {
        if (!mountedRef.current) return;
        setVoiceActive(false);
        setWordCount(SPEECH_LINES[idx].split(' ').length + 1);
        if (wordTimerRef.current) clearInterval(wordTimerRef.current);

        // Move to next line after a natural breath
        setTimeout(() => {
          if (!mountedRef.current) return;
          const next = (idx + 1) % SPEECH_LINES.length;
          lineIdxRef.current = next;
          setLineIdx(next);
          setWordCount(0);
          setTimeout(() => playLine(next), 180);
        }, 280);
      };

      audio.onerror = () => {
        if (!mountedRef.current) return;
        setVoiceActive(false);
        // Skip to next line after 2s if audio fails
        setTimeout(() => {
          if (!mountedRef.current) return;
          const next = (idx + 1) % SPEECH_LINES.length;
          setLineIdx(next);
          setWordCount(0);
          playLine(next);
        }, 2000);
      };

      await audio.play();
    } catch {
      if (!mountedRef.current) return;
      setLoading(false);
      // Fall through to next line
      setTimeout(() => {
        if (!mountedRef.current) return;
        const next = (idx + 1) % SPEECH_LINES.length;
        setLineIdx(next);
        setWordCount(0);
        playLine(next);
      }, 1500);
    }
  };

  // Pre-fetch all lines, then start playing
  useEffect(() => {
    const voice = getVoice();
    setLoading(true);

    // Fetch line 0 eagerly, then start playing
    fetchNarrationAudio(SPEECH_LINES[0], voice)
      .then(() => {
        if (!mountedRef.current) return;
        playLine(0);
        // Pre-fetch remaining lines in background
        SPEECH_LINES.slice(1).forEach(line =>
          fetchNarrationAudio(line, voice).catch(() => {})
        );
      })
      .catch(() => {
        if (mountedRef.current) setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        {[{ inset: -18, color: '#22c55e', opacity: 0.18, delay: 0 }, { inset: -9, color: '#7c3aed', opacity: 0.26, delay: 0.4 }].map((r, i) => (
          <motion.div
            key={i}
            className="absolute rounded-full"
            style={{ inset: r.inset, border: `${i === 0 ? 2 : 1.5}px solid ${r.color}`, opacity: r.opacity }}
            animate={voiceActive ? { scale: [1, 1.18 - i * 0.06, 1], opacity: [r.opacity, r.opacity * 0.25, r.opacity] } : { scale: 1, opacity: r.opacity * 0.4 }}
            transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut', delay: r.delay }}
          />
        ))}

        <div
          className="relative w-40 h-40 rounded-full flex flex-col items-center justify-center overflow-hidden"
          style={{
            background: 'linear-gradient(135deg, #0d1117, #111827)',
            border: '2px solid #1e1e1e',
            boxShadow: voiceActive ? '0 0 60px #22c55e30, 0 0 120px #7c3aed18' : '0 0 20px #00000060',
            transition: 'box-shadow 0.4s',
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
                    ? { scaleY: [1, 0.1, 1, 0.9, 0.1, 1], scaleX: [1, 1.08, 1] }
                    : { scaleY: [1, 0.2, 1] }
                }
                transition={{ duration: voiceActive ? 2.4 : 4.0, repeat: Infinity, delay: i * 0.12, ease: 'easeInOut' }}
              />
            ))}
          </div>

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
          style={{ background: loading ? '#f59e0b' : voiceActive ? '#22c55e' : '#3f3f46' }}
          animate={voiceActive ? { opacity: [1, 0.25, 1] } : { opacity: 0.5 }}
          transition={{ duration: 0.8, repeat: Infinity }}
        />
        <span className="text-sm font-mono uppercase tracking-widest" style={{ color: '#52525b' }}>
          StreamVault AI
        </span>
        <motion.span
          className="text-xs px-3 py-1 rounded-full font-mono font-bold"
          animate={{
            background: loading ? '#f59e0b18' : voiceActive ? '#22c55e18' : '#1a1a1a',
            color: loading ? '#f59e0b' : voiceActive ? '#22c55e' : '#3f3f46',
          }}
          style={{ border: '1px solid', borderColor: loading ? '#f59e0b44' : voiceActive ? '#22c55e44' : '#252525' }}
          transition={{ duration: 0.3 }}
        >
          {loading ? '◌ Loading...' : voiceActive ? '🔊 Speaking' : '○ Ready'}
        </motion.span>
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
