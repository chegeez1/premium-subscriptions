import { useRef, useCallback, useEffect } from 'react';

const BPM = 118;
const BEAT_S = 60 / BPM;
const SCHEDULE_AHEAD = BEAT_S * 16;

// Music volume levels
const VOL_FULL = 0.28;     // when no narration
const VOL_DUCKED = 0.07;   // under narration (audible but not competing)
const FADE_TC = 0.25;      // seconds for volume transitions

function createNoiseBuffer(ctx: AudioContext): AudioBuffer {
  const size = Math.floor(ctx.sampleRate * 2);
  const buf = ctx.createBuffer(1, size, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < size; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

function kick(ctx: AudioContext, dest: AudioNode, t: number) {
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(130, t);
  osc.frequency.exponentialRampToValueAtTime(38, t + 0.14);
  env.gain.setValueAtTime(0.9, t);
  env.gain.exponentialRampToValueAtTime(0.001, t + 0.38);
  osc.connect(env); env.connect(dest);
  osc.start(t); osc.stop(t + 0.4);
}

function hihat(ctx: AudioContext, dest: AudioNode, noise: AudioBuffer, t: number, open = false) {
  const src = ctx.createBufferSource();
  src.buffer = noise;
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass'; hp.frequency.value = 8000;
  const env = ctx.createGain();
  const dur = open ? 0.22 : 0.045;
  env.gain.setValueAtTime(0.12, t);
  env.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(hp); hp.connect(env); env.connect(dest);
  src.start(t); src.stop(t + dur + 0.01);
}

function bass(ctx: AudioContext, dest: AudioNode, t: number, freq: number) {
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  osc.type = 'triangle';
  osc.frequency.value = freq;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = 400;
  env.gain.setValueAtTime(0.55, t);
  env.gain.exponentialRampToValueAtTime(0.001, t + BEAT_S * 1.8);
  osc.connect(lp); lp.connect(env); env.connect(dest);
  osc.start(t); osc.stop(t + BEAT_S * 2);
}

function pad(ctx: AudioContext, dest: AudioNode, t: number, freq: number, dur: number) {
  [freq, freq * 1.004, freq * 1.5].forEach(f => {
    const o = ctx.createOscillator();
    const lp = ctx.createBiquadFilter();
    const env = ctx.createGain();
    o.type = 'sawtooth'; o.frequency.value = f;
    lp.type = 'lowpass'; lp.frequency.value = 700; lp.Q.value = 1.5;
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.055, t + 0.4);
    env.gain.setValueAtTime(0.055, t + dur - 0.4);
    env.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(lp); lp.connect(env); env.connect(dest);
    o.start(t); o.stop(t + dur);
  });
}

const BASS_CHORD = [55, 55, 82.4, 73.4]; // A1 A1 E2 D2

export function useBackgroundMusic() {
  const ctxRef = useRef<AudioContext | null>(null);
  const masterRef = useRef<GainNode | null>(null);
  const noiseRef = useRef<AudioBuffer | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nextBeatRef = useRef(0);
  const beatRef = useRef(0);
  const playingRef = useRef(false);
  const duckedRef = useRef(false);

  const schedule = useCallback(() => {
    const ctx = ctxRef.current;
    const mg = masterRef.current;
    const nb = noiseRef.current;
    if (!ctx || !mg || !nb || !playingRef.current) return;

    const now = ctx.currentTime;
    while (nextBeatRef.current < now + SCHEDULE_AHEAD) {
      const t = nextBeatRef.current;
      const b = beatRef.current % 4;
      const bar = Math.floor(beatRef.current / 4) % 4;

      if (b === 0 || b === 2) kick(ctx, mg, t);
      hihat(ctx, mg, nb, t, false);
      hihat(ctx, mg, nb, t + BEAT_S / 2, b === 3);
      if (b === 0) bass(ctx, mg, t, BASS_CHORD[bar]);
      if (b === 0) pad(ctx, mg, t, BASS_CHORD[bar] * 2, BEAT_S * 4);

      nextBeatRef.current += BEAT_S;
      beatRef.current++;
    }
    timerRef.current = setTimeout(schedule, 80);
  }, []);

  const start = useCallback(() => {
    if (playingRef.current) return;
    playingRef.current = true;
    duckedRef.current = false;
    const ctx = new AudioContext();
    ctxRef.current = ctx;
    const mg = ctx.createGain();
    mg.gain.value = VOL_FULL;
    mg.connect(ctx.destination);
    masterRef.current = mg;
    noiseRef.current = createNoiseBuffer(ctx);
    nextBeatRef.current = ctx.currentTime + 0.05;
    beatRef.current = 0;
    schedule();
  }, [schedule]);

  const stop = useCallback(() => {
    if (!playingRef.current) return;
    playingRef.current = false;
    if (timerRef.current) clearTimeout(timerRef.current);
    const mg = masterRef.current;
    const ctx = ctxRef.current;
    if (mg && ctx) {
      mg.gain.setTargetAtTime(0, ctx.currentTime, 0.4);
      setTimeout(() => { ctx.close(); ctxRef.current = null; masterRef.current = null; }, 1200);
    }
  }, []);

  // Duck music under narration
  const duck = useCallback(() => {
    const mg = masterRef.current;
    const ctx = ctxRef.current;
    if (mg && ctx && !duckedRef.current) {
      duckedRef.current = true;
      mg.gain.setTargetAtTime(VOL_DUCKED, ctx.currentTime, FADE_TC);
    }
  }, []);

  // Restore after narration ends
  const unduck = useCallback(() => {
    const mg = masterRef.current;
    const ctx = ctxRef.current;
    if (mg && ctx && duckedRef.current) {
      duckedRef.current = false;
      mg.gain.setTargetAtTime(VOL_FULL, ctx.currentTime, FADE_TC);
    }
  }, []);

  const setVolume = useCallback((v: number) => {
    const mg = masterRef.current;
    const ctx = ctxRef.current;
    if (mg && ctx) mg.gain.setTargetAtTime(v, ctx.currentTime, 0.1);
  }, []);

  useEffect(() => () => stop(), [stop]);

  return { start, stop, duck, unduck, setVolume, playingRef };
}
