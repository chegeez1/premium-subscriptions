import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Repeat, Mic, Music2, VolumeX } from 'lucide-react';
import VideoTemplate, { SCENE_DURATIONS } from './VideoTemplate';
import VoicePicker from './VoicePicker';
import { useSceneControls } from '@/hooks/useSceneControls';
import {
  useSceneAINarration,
  warmupAllNarrations,
  resetWarmup,
  prefetchAhead,
  DEFAULT_VOICE,
  VOICE_KEY,
  type AIVoice,
} from '@/hooks/useAINarration';
import { useBackgroundMusic } from '@/hooks/useBackgroundMusic';

const PROGRESS_TICK_MS = 60;

// ─── Progress segments ────────────────────────────────────────────────────────
function ProgressSegments({
  sceneKeys,
  activeIndex,
  activeDuration,
  tick,
  onJumpTo,
}: {
  sceneKeys: string[];
  activeIndex: number;
  activeDuration: number;
  tick: number;
  onJumpTo: (i: number) => void;
}) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    setElapsed(0);
    const start = performance.now();
    const id = window.setInterval(() => setElapsed(performance.now() - start), PROGRESS_TICK_MS);
    return () => window.clearInterval(id);
  }, [tick]);

  const progress = activeDuration > 0 ? Math.min(1, elapsed / activeDuration) : 0;

  return (
    <div className="flex-1 flex items-center gap-1.5">
      {sceneKeys.map((key, i) => {
        const isActive = i === activeIndex;
        return (
          <button
            key={key}
            onClick={() => onJumpTo(i)}
            className="flex-1 rounded-full overflow-hidden cursor-pointer hover:bg-white/25 transition-all relative min-h-[12px] bg-white/20"
            style={{ height: isActive ? 14 : 12 }}
            aria-label={`Jump to scene ${i + 1}`}
            aria-current={isActive ? 'true' : undefined}
          >
            <div
              className="absolute inset-y-0 left-0 bg-white/90 rounded-full transition-[width] duration-100"
              style={{ width: isActive ? `${progress * 100}%` : '0%' }}
            />
          </button>
        );
      })}
    </div>
  );
}

// ─── Control bar ──────────────────────────────────────────────────────────────
interface ControlBarProps {
  visible: boolean;
  collapsed: boolean;
  locked: boolean;
  voicePickerOpen: boolean;
  musicOn: boolean;
  sceneKeys: string[];
  activeIndex: number;
  activeDuration: number;
  tick: number;
  selectedVoice: AIVoice;
  onToggleLock: () => void;
  onJumpTo: (i: number) => void;
  onToggleCollapsed: () => void;
  onToggleVoicePicker: () => void;
  onToggleMusic: () => void;
}

function ControlBar({
  visible, collapsed, locked, voicePickerOpen, musicOn,
  sceneKeys, activeIndex, activeDuration, tick, selectedVoice,
  onToggleLock, onJumpTo, onToggleCollapsed, onToggleVoicePicker, onToggleMusic,
}: ControlBarProps) {
  return (
    <div
      className={`flex items-center gap-3 bg-black/55 backdrop-blur-sm px-5 py-4 transition-all duration-200 ease-out ${
        visible ? 'translate-y-0 opacity-100 pointer-events-auto' : 'translate-y-full opacity-0 pointer-events-none'
      }`}
    >
      <button
        onClick={onToggleLock}
        className={`w-14 h-14 flex items-center justify-center transition-colors rounded-lg shrink-0 ${
          locked ? 'text-white bg-white/15 hover:bg-white/25' : 'text-white/60 hover:text-white hover:bg-white/10'
        }`}
        title={locked ? 'Loop: on' : 'Loop: off'}
        aria-pressed={locked}
      >
        <Repeat className="w-8 h-8" />
      </button>

      <div className="w-px self-stretch bg-white/15" />

      <ProgressSegments
        sceneKeys={sceneKeys}
        activeIndex={activeIndex}
        activeDuration={activeDuration}
        tick={tick}
        onJumpTo={onJumpTo}
      />

      <div className="text-xl text-white/60 font-mono tabular-nums shrink-0">
        {activeIndex + 1}/{sceneKeys.length}
      </div>

      <div className="w-px self-stretch bg-white/15" />

      {/* Music toggle */}
      <button
        onClick={onToggleMusic}
        className={`w-14 h-14 flex items-center justify-center transition-colors rounded-lg shrink-0 ${
          musicOn
            ? 'text-violet-400 bg-violet-400/15 hover:bg-violet-400/25'
            : 'text-white/60 hover:text-white hover:bg-white/10'
        }`}
        title={musicOn ? 'Music: on' : 'Music: off'}
        aria-pressed={musicOn}
      >
        {musicOn ? <Music2 className="w-7 h-7" /> : <VolumeX className="w-7 h-7" />}
      </button>

      <button
        onClick={onToggleVoicePicker}
        className={`w-14 h-14 flex items-center justify-center transition-colors rounded-lg shrink-0 ${
          voicePickerOpen
            ? 'text-green-400 bg-green-400/15 hover:bg-green-400/25'
            : 'text-white/60 hover:text-white hover:bg-white/10'
        }`}
        title={`AI Voice: ${selectedVoice}`}
        aria-pressed={voicePickerOpen}
      >
        <Mic className="w-7 h-7" />
      </button>

      <button
        onClick={onToggleCollapsed}
        className="w-14 h-14 flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 transition-colors rounded-lg shrink-0"
        title={collapsed ? 'Show controls' : 'Hide controls'}
      >
        {collapsed ? <ChevronUp className="w-10 h-10" /> : <ChevronDown className="w-10 h-10" />}
      </button>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function VideoWithControls() {
  const isIframed = typeof window !== 'undefined' && window.self !== window.top;

  const {
    sceneKeys, activeIndex, locked, mountKey, tick,
    durations, activeDuration, onSceneChange, jumpTo, toggleLock,
  } = useSceneControls(SCENE_DURATIONS);

  // AI voice selection
  const [selectedVoice, setSelectedVoice] = useState<AIVoice>(
    () => (localStorage.getItem(VOICE_KEY) as AIVoice) ?? DEFAULT_VOICE,
  );

  // Background music with duck/unduck for narration
  const { start: startMusic, stop: stopMusic, duck, unduck, playingRef: musicPlayingRef } = useBackgroundMusic();
  const [musicOn, setMusicOn] = useState(false);

  const handleToggleMusic = useCallback(() => {
    if (musicPlayingRef.current) {
      stopMusic();
      setMusicOn(false);
    } else {
      startMusic();
      setMusicOn(true);
    }
  }, [startMusic, stopMusic, musicPlayingRef]);

  // Narration callbacks that drive music ducking
  const handleNarrationStart = useCallback(() => {
    if (musicPlayingRef.current) duck();
  }, [duck, musicPlayingRef]);

  const handleNarrationEnd = useCallback(() => {
    if (musicPlayingRef.current) unduck();
  }, [unduck, musicPlayingRef]);

  // Warmup: tell server to pre-bake all narrations, then populate client blob cache
  // resetWarmup() clears flags/cache so voice changes re-trigger a full warmup
  useEffect(() => {
    resetWarmup();
    warmupAllNarrations(selectedVoice);
  }, [selectedVoice]);

  // Smart lookahead: prefetch next 3 scenes whenever active scene changes
  useEffect(() => {
    const baseKey = sceneKeys[activeIndex];
    if (baseKey) prefetchAhead(baseKey, sceneKeys, selectedVoice, 3);
  }, [activeIndex, sceneKeys, selectedVoice]);

  // Per-scene AI narration (with music duck/unduck)
  const activeSceneKey = sceneKeys[activeIndex] ?? '';
  useSceneAINarration(activeSceneKey, selectedVoice, handleNarrationStart, handleNarrationEnd);

  // Voice picker
  const [showVoicePicker, setShowVoicePicker] = useState(false);

  const handleVoiceSelect = useCallback((voice: AIVoice) => {
    localStorage.setItem(VOICE_KEY, voice);
    setSelectedVoice(voice);
    setShowVoicePicker(false);
  }, []);

  // Sensor / collapse
  const sensorRef = useRef<HTMLDivElement | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [hovering, setHovering] = useState(false);
  const [tapPinned, setTapPinned] = useState(false);

  const handlePointerEnter = useCallback((e: React.PointerEvent) => {
    if (e.pointerType === 'mouse') setHovering(true);
  }, []);
  const handlePointerLeave = useCallback((e: React.PointerEvent) => {
    if (e.pointerType === 'mouse') setHovering(false);
  }, []);
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (e.pointerType === 'mouse') return;
    if (collapsed) setTapPinned(true);
  }, [collapsed]);
  const handleToggleCollapsed = useCallback(() => {
    setCollapsed(c => {
      if (!c) { setHovering(false); setTapPinned(false); }
      return !c;
    });
  }, []);

  useEffect(() => {
    if (!(collapsed && tapPinned)) return;
    const onDoc = (e: PointerEvent) => {
      if (e.pointerType === 'mouse') return;
      if (sensorRef.current && !sensorRef.current.contains(e.target as Node)) setTapPinned(false);
    };
    document.addEventListener('pointerdown', onDoc);
    return () => document.removeEventListener('pointerdown', onDoc);
  }, [collapsed, tapPinned]);

  const barVisible = !collapsed || hovering || tapPinned;

  // Export mode: clean, no controls
  if (!isIframed) return <VideoTemplate />;

  return (
    <div className="relative w-full h-screen">
      <VideoTemplate
        key={mountKey}
        durations={durations}
        loop
        onSceneChange={onSceneChange}
      />

      <div
        ref={sensorRef}
        className="absolute bottom-0 left-0 right-0 z-50 flex flex-col justify-end"
        style={{ height: '25%' }}
        onPointerEnter={handlePointerEnter}
        onPointerLeave={handlePointerLeave}
        onPointerDown={handlePointerDown}
      >
        <div className="flex-1 w-full" />

        <div className="relative">
          <VoicePicker
            open={showVoicePicker}
            selectedVoice={selectedVoice}
            onClose={() => setShowVoicePicker(false)}
            onSelect={handleVoiceSelect}
          />
        </div>

        <ControlBar
          visible={barVisible}
          collapsed={collapsed}
          locked={locked}
          voicePickerOpen={showVoicePicker}
          musicOn={musicOn}
          sceneKeys={sceneKeys}
          activeIndex={activeIndex}
          activeDuration={activeDuration}
          tick={tick}
          selectedVoice={selectedVoice}
          onToggleLock={toggleLock}
          onJumpTo={jumpTo}
          onToggleCollapsed={handleToggleCollapsed}
          onToggleVoicePicker={() => setShowVoicePicker(v => !v)}
          onToggleMusic={handleToggleMusic}
        />
      </div>
    </div>
  );
}
