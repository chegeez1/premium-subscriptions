import { useEffect, useRef, useCallback } from 'react';
import { SCENE_SCRIPTS } from './useSceneNarration';

export type AIVoice = 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer';
export const DEFAULT_VOICE: AIVoice = 'onyx';
export const VOICE_KEY = 'chegetech_voice_name';

// ─── Client-side blob-URL cache (persists for the page session) ───────────────
const audioCache = new Map<string, string>();
const pendingMap = new Map<string, Promise<string>>();

export async function fetchNarrationAudio(text: string, voice: AIVoice): Promise<string> {
  const key = `${voice}:${text}`;
  if (audioCache.has(key)) return audioCache.get(key)!;

  // If there's already an in-flight promise, wait for it
  if (pendingMap.has(key)) return pendingMap.get(key)!;

  const promise = (async () => {
    try {
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voice }),
      });
      if (!res.ok) throw new Error(`TTS ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      audioCache.set(key, url);
      return url;
    } finally {
      // Always remove from pending (whether success or failure) so retries work
      pendingMap.delete(key);
    }
  })();

  pendingMap.set(key, promise);
  return promise;
}

// ─── One-shot warmup: ask the server to pre-bake ALL narrations on disk ───────
// Server responds immediately (202) — generation happens in background there.
// Client also runs its own sequential wave fetch to populate blob URL cache.
let warmupFired = false;

export async function warmupAllNarrations(voice: AIVoice): Promise<void> {
  if (warmupFired) return;
  warmupFired = true;

  const scripts = Object.entries(SCENE_SCRIPTS).map(([key, text]) => ({ key, text }));

  // Tell the server to pre-generate everything (non-blocking on server side)
  fetch('/api/tts/warmup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scripts, voice }),
  }).catch(() => {}); // Fire and forget

  // Populate client blob URL cache in waves of 3 (avoid flooding)
  const WAVE = 3;
  for (let i = 0; i < scripts.length; i += WAVE) {
    const batch = scripts.slice(i, i + WAVE);
    await Promise.allSettled(
      batch.map(({ text }) => fetchNarrationAudio(text, voice))
    );
  }
}

// Allow re-triggering warmup after voice change
export function resetWarmup() {
  warmupFired = false;
  audioCache.clear();
  pendingMap.clear();
}

// Smart lookahead: eagerly fetch the next N scenes when active scene changes
export function prefetchAhead(
  currentKey: string,
  allKeys: string[],
  voice: AIVoice,
  lookahead = 3,
) {
  const idx = allKeys.indexOf(currentKey);
  if (idx < 0) return;
  for (let i = 1; i <= lookahead; i++) {
    const nextKey = allKeys[(idx + i) % allKeys.length];
    const script = SCENE_SCRIPTS[nextKey];
    if (script) fetchNarrationAudio(script, voice).catch(() => {});
  }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────
export function useSceneAINarration(
  activeSceneKey: string,
  voice: AIVoice,
  onNarrationStart?: () => void,
  onNarrationEnd?: () => void,
) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const mountedRef = useRef(true);
  const onStartRef = useRef(onNarrationStart);
  const onEndRef = useRef(onNarrationEnd);

  // Keep refs current without adding them to effect deps
  onStartRef.current = onNarrationStart;
  onEndRef.current = onNarrationEnd;

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const stopCurrent = useCallback(() => {
    const a = audioRef.current;
    if (a) {
      a.pause();
      a.onended = null;
      audioRef.current = null;
      onEndRef.current?.();
    }
  }, []);

  useEffect(() => {
    stopCurrent();

    const baseKey = activeSceneKey.replace(/_r[12]$/, '');
    // aiNarrator scene manages its own audio pipeline
    if (baseKey === 'aiNarrator') return;

    const script = SCENE_SCRIPTS[baseKey];
    if (!script) return;

    let cancelled = false;

    const play = async () => {
      try {
        // This resolves instantly if already cached (client or server-disk)
        const url = await fetchNarrationAudio(script, voice);
        if (cancelled || !mountedRef.current) return;

        // Tiny breath so scene entrance animation can start
        await new Promise(r => setTimeout(r, 80));
        if (cancelled || !mountedRef.current) return;

        const audio = new Audio(url);
        audio.volume = 1.0;
        audio.onended = () => {
          onEndRef.current?.();
          audioRef.current = null;
        };
        audioRef.current = audio;
        onStartRef.current?.();
        await audio.play();
      } catch {
        // Silent fail — video keeps going, music stays up
        onEndRef.current?.();
      }
    };

    play();

    return () => {
      cancelled = true;
      stopCurrent();
    };
  }, [activeSceneKey, voice, stopCurrent]);
}
