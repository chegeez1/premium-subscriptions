import { useEffect, useRef, useCallback } from 'react';
import { SCENE_SCRIPTS } from './useSceneNarration';

export type AIVoice = 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer';
export const DEFAULT_VOICE: AIVoice = 'onyx';
export const VOICE_KEY = 'chegetech_voice_name';

// ─── Audio cache ───────────────────────────────────────────────────────────────
// Persists across re-renders; maps "voice:text" → blob URL
const audioCache = new Map<string, string>();
const pendingMap = new Map<string, Promise<string>>();

export async function fetchNarrationAudio(text: string, voice: AIVoice): Promise<string> {
  const key = `${voice}:${text}`;
  if (audioCache.has(key)) return audioCache.get(key)!;
  if (pendingMap.has(key)) return pendingMap.get(key)!;

  const promise = (async () => {
    const res = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voice }),
    });
    if (!res.ok) throw new Error(`TTS ${res.status}`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    audioCache.set(key, url);
    pendingMap.delete(key);
    return url;
  })();

  pendingMap.set(key, promise);
  return promise;
}

// Pre-warm ALL scenes up front — called once on mount
export function prefetchAllNarrations(voice: AIVoice) {
  for (const text of Object.values(SCENE_SCRIPTS)) {
    fetchNarrationAudio(text, voice).catch(() => {});
  }
}

// Smart lookahead: call this when a scene becomes active to warm the next N scenes
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

  useEffect(() => { onStartRef.current = onNarrationStart; });
  useEffect(() => { onEndRef.current = onNarrationEnd; });

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const stopCurrent = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.onended = null;
      audioRef.current = null;
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
        // Fetch (or get from cache instantly) — no artificial delay
        const url = await fetchNarrationAudio(script, voice);
        if (cancelled || !mountedRef.current) return;

        // Tiny breath — just enough to let the scene start animating
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
        // Silent fail — video keeps going
        onEndRef.current?.();
      }
    };

    play();

    return () => {
      cancelled = true;
      stopCurrent();
      onEndRef.current?.();
    };
  }, [activeSceneKey, voice, stopCurrent]);
}
