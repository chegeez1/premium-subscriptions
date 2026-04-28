import { useEffect, useRef, useCallback } from 'react';
import { SCENE_SCRIPTS } from './useSceneNarration';

export type AIVoice = 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer';
export const DEFAULT_VOICE: AIVoice = 'onyx';
export const VOICE_KEY = 'chegetech_voice_name';

// ─── Audio cache ──────────────────────────────────────────────────────────────
// Persists across re-renders; maps "voice:text" → blob URL
const audioCache = new Map<string, string>();
const pendingMap = new Map<string, Promise<string>>();

function getTTSUrl(): string {
  // Same-origin API call — goes through Replit's routing to the api-server
  return '/api/tts';
}

export async function fetchNarrationAudio(text: string, voice: AIVoice): Promise<string> {
  const key = `${voice}:${text}`;
  if (audioCache.has(key)) return audioCache.get(key)!;
  if (pendingMap.has(key)) return pendingMap.get(key)!;

  const promise = (async () => {
    const res = await fetch(getTTSUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voice }),
    });
    if (!res.ok) throw new Error(`TTS failed: ${res.status}`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    audioCache.set(key, url);
    pendingMap.delete(key);
    return url;
  })();

  pendingMap.set(key, promise);
  return promise;
}

// Pre-warm: fetch all scene narrations in background
export function prefetchAllNarrations(voice: AIVoice) {
  for (const text of Object.values(SCENE_SCRIPTS)) {
    fetchNarrationAudio(text, voice).catch(() => {});
  }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────
export function useSceneAINarration(activeSceneKey: string, voice: AIVoice) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const stopCurrent = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
  }, []);

  useEffect(() => {
    stopCurrent();

    const baseKey = activeSceneKey.replace(/_r[12]$/, '');
    // aiNarrator manages its own audio
    if (baseKey === 'aiNarrator') return;

    const script = SCENE_SCRIPTS[baseKey];
    if (!script) return;

    let cancelled = false;

    const play = async () => {
      try {
        const url = await fetchNarrationAudio(script, voice);
        if (cancelled || !mountedRef.current) return;

        await new Promise(r => setTimeout(r, 420)); // let scene animate in
        if (cancelled || !mountedRef.current) return;

        const audio = new Audio(url);
        audio.volume = 1.0;
        audioRef.current = audio;
        await audio.play();
      } catch {
        // Silent fail — no audio plays, video keeps going
      }
    };

    play();

    return () => {
      cancelled = true;
      stopCurrent();
    };
  }, [activeSceneKey, voice, stopCurrent]);
}
