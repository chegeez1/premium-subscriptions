import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Repeat, Mic } from 'lucide-react';
import VideoTemplate, { SCENE_DURATIONS } from './VideoTemplate';
import VoicePicker from './VoicePicker';
import { useSceneControls } from '@/hooks/useSceneControls';
import { useSceneNarration, VOICE_KEY } from '@/hooks/useSceneNarration';

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
            className="flex-1 bg-white/20 rounded-full overflow-hidden cursor-pointer hover:bg-white/25 transition-all relative min-h-[12px]"
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
  sceneKeys: string[];
  activeIndex: number;
  activeDuration: number;
  tick: number;
  selectedVoice: string;
  onToggleLock: () => void;
  onJumpTo: (i: number) => void;
  onToggleCollapsed: () => void;
  onToggleVoicePicker: () => void;
}

function ControlBar({
  visible, collapsed, locked, voicePickerOpen,
  sceneKeys, activeIndex, activeDuration, tick, selectedVoice,
  onToggleLock, onJumpTo, onToggleCollapsed, onToggleVoicePicker,
}: ControlBarProps) {
  return (
    <div
      className={`flex items-center gap-3 bg-black/55 backdrop-blur-sm px-5 py-4 transition-all duration-200 ease-out ${
        visible ? 'translate-y-0 opacity-100 pointer-events-auto' : 'translate-y-full opacity-0 pointer-events-none'
      }`}
      aria-hidden={!visible}
    >
      {/* Loop lock */}
      <button
        onClick={onToggleLock}
        className={`w-14 h-14 flex items-center justify-center transition-colors rounded-lg shrink-0 ${
          locked ? 'text-white bg-white/15 hover:bg-white/25' : 'text-white/60 hover:text-white hover:bg-white/10'
        }`}
        title={locked ? 'Loop: on' : 'Loop: off'}
        aria-label={locked ? 'Loop current scene: on' : 'Loop current scene: off'}
        aria-pressed={locked}
      >
        <Repeat className="w-8 h-8" />
      </button>

      <div className="w-px self-stretch bg-white/15" aria-hidden="true" />

      {/* Progress */}
      <ProgressSegments
        sceneKeys={sceneKeys}
        activeIndex={activeIndex}
        activeDuration={activeDuration}
        tick={tick}
        onJumpTo={onJumpTo}
      />

      {/* Scene counter */}
      <div className="text-xl text-white/60 font-mono tabular-nums shrink-0">
        {activeIndex + 1}/{sceneKeys.length}
      </div>

      <div className="w-px self-stretch bg-white/15" aria-hidden="true" />

      {/* Voice picker toggle */}
      <button
        onClick={onToggleVoicePicker}
        className={`w-14 h-14 flex items-center justify-center transition-colors rounded-lg shrink-0 ${
          voicePickerOpen
            ? 'text-green-400 bg-green-400/15 hover:bg-green-400/25'
            : selectedVoice
            ? 'text-green-400/70 hover:text-green-400 hover:bg-white/10'
            : 'text-white/60 hover:text-white hover:bg-white/10'
        }`}
        title="Narration voice"
        aria-label="Choose narration voice"
        aria-pressed={voicePickerOpen}
      >
        <Mic className="w-7 h-7" />
      </button>

      {/* Collapse */}
      <button
        onClick={onToggleCollapsed}
        className="w-14 h-14 flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 transition-colors rounded-lg shrink-0"
        title={collapsed ? 'Show controls' : 'Hide controls'}
        aria-label={collapsed ? 'Show controls' : 'Hide controls'}
        aria-expanded={!collapsed}
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

  // Per-scene narration
  const activeSceneKey = sceneKeys[activeIndex] ?? '';
  useSceneNarration(activeSceneKey);

  // Voice picker state
  const [showVoicePicker, setShowVoicePicker] = useState(false);
  const [selectedVoice, setSelectedVoice] = useState(() => localStorage.getItem(VOICE_KEY) ?? '');

  // Sensor / collapse
  const sensorRef = useRef<HTMLDivElement | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [hovering, setHovering] = useState(false);
  const [tapPinned, setTapPinned] = useState(false);

  const handlePointerEnter = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse') setHovering(true);
  }, []);
  const handlePointerLeave = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse') setHovering(false);
  }, []);
  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
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

  const handleVoiceSelect = useCallback((name: string) => {
    setSelectedVoice(name);
    setShowVoicePicker(false);
  }, []);

  const barVisible = !collapsed || hovering || tapPinned;

  // Export path — clean, no controls, no voice picker
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
        <div className="flex-1 w-full" aria-hidden="true" />

        {/* Voice picker panel (above control bar) */}
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
          sceneKeys={sceneKeys}
          activeIndex={activeIndex}
          activeDuration={activeDuration}
          tick={tick}
          selectedVoice={selectedVoice}
          onToggleLock={toggleLock}
          onJumpTo={jumpTo}
          onToggleCollapsed={handleToggleCollapsed}
          onToggleVoicePicker={() => setShowVoicePicker(v => !v)}
        />
      </div>
    </div>
  );
}
