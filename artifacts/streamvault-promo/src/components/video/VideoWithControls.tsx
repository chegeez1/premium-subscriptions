import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Repeat, Mic, Music2, VolumeX, Download, Circle, X } from 'lucide-react';
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
const TOTAL_DURATION_MS = Object.values(SCENE_DURATIONS).reduce((a, b) => a + b, 0);

// ─── Export overlay ────────────────────────────────────────────────────────────
type ExportPhase = 'idle' | 'instructions' | 'recording' | 'done' | 'error';

function fmtTime(ms: number) {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function ExportOverlay({
  phase,
  elapsed,
  onStart,
  onCancel,
  errorMsg,
}: {
  phase: ExportPhase;
  elapsed: number;
  onStart: () => void;
  onCancel: () => void;
  errorMsg: string;
}) {
  if (phase === 'idle') return null;
  const remaining = Math.max(0, TOTAL_DURATION_MS - elapsed);
  const pct = Math.min(100, (elapsed / TOTAL_DURATION_MS) * 100);

  return (
    <div className="absolute inset-0 z-[100] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.82)', backdropFilter: 'blur(8px)' }}>
      <div className="rounded-2xl p-8 max-w-md w-full mx-6 flex flex-col gap-5"
        style={{ background: '#111', border: '1px solid #22c55e33' }}>

        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ background: '#22c55e18' }}>
            {phase === 'recording' ? (
              <Circle className="w-5 h-5 fill-red-500 text-red-500" />
            ) : phase === 'done' ? (
              <span className="text-xl">✅</span>
            ) : phase === 'error' ? (
              <span className="text-xl">❌</span>
            ) : (
              <Download className="w-5 h-5 text-green-400" />
            )}
          </div>
          <div className="flex-1">
            <div className="font-bold text-white" style={{ fontFamily: 'var(--font-display)' }}>
              {phase === 'instructions' && 'Export Video'}
              {phase === 'recording'    && 'Recording…'}
              {phase === 'done'         && 'Download Ready!'}
              {phase === 'error'        && 'Recording Failed'}
            </div>
            <div className="text-xs" style={{ color: '#52525b' }}>
              {phase === 'recording' && `${fmtTime(remaining)} remaining`}
              {phase === 'done' && 'Check your Downloads folder'}
              {phase === 'error' && errorMsg}
              {phase === 'instructions' && `${fmtTime(TOTAL_DURATION_MS)} · all 17 scenes`}
            </div>
          </div>
          {phase !== 'recording' && (
            <button onClick={onCancel} className="w-8 h-8 flex items-center justify-center rounded-lg text-white/40 hover:text-white hover:bg-white/10">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Instructions */}
        {phase === 'instructions' && (
          <>
            <div className="flex flex-col gap-2">
              {[
                { n: '1', t: 'Click "Start Export" below' },
                { n: '2', t: 'Browser will ask what to share — choose "This Tab"' },
                { n: '3', t: 'The video resets to scene 1 and records automatically' },
                { n: '4', t: 'After 2 min 45 sec, download starts automatically' },
              ].map(s => (
                <div key={s.n} className="flex items-start gap-3 rounded-xl px-3 py-2.5"
                  style={{ background: '#0d0d0d', border: '1px solid #1a1a1a' }}>
                  <span className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold shrink-0 mt-0.5"
                    style={{ background: '#22c55e22', color: '#22c55e' }}>{s.n}</span>
                  <span className="text-sm" style={{ color: '#a1a1aa' }}>{s.t}</span>
                </div>
              ))}
            </div>
            <div className="rounded-xl px-3 py-2.5 text-xs" style={{ background: '#f59e0b0d', border: '1px solid #f59e0b22', color: '#f59e0b' }}>
              Tip: turn on Music before exporting to include audio in the file.
            </div>
            <button onClick={onStart}
              className="w-full py-3 rounded-xl font-bold text-sm transition-colors"
              style={{ background: '#22c55e', color: '#000' }}>
              Start Export
            </button>
          </>
        )}

        {/* Progress bar while recording */}
        {phase === 'recording' && (
          <div className="flex flex-col gap-3">
            <div className="rounded-full overflow-hidden" style={{ background: '#1a1a1a', height: 8 }}>
              <div className="h-full rounded-full transition-all duration-500"
                style={{ width: `${pct}%`, background: 'linear-gradient(90deg,#22c55e,#7c3aed)' }} />
            </div>
            <div className="text-center text-xs" style={{ color: '#52525b' }}>
              Do not close or switch tabs · recording in progress
            </div>
          </div>
        )}

        {/* Done */}
        {phase === 'done' && (
          <div className="text-center">
            <div className="text-sm mb-3" style={{ color: '#a1a1aa' }}>
              Your video has been saved as <strong style={{ color: '#22c55e' }}>streamvault-premium-promo.webm</strong>
            </div>
            <button onClick={onCancel}
              className="px-6 py-2.5 rounded-xl font-bold text-sm"
              style={{ background: '#22c55e22', color: '#22c55e', border: '1px solid #22c55e44' }}>
              Close
            </button>
          </div>
        )}

        {/* Error */}
        {phase === 'error' && (
          <div className="flex gap-3">
            <button onClick={onCancel}
              className="flex-1 py-2.5 rounded-xl font-bold text-sm"
              style={{ background: '#1a1a1a', color: '#a1a1aa' }}>
              Cancel
            </button>
            <button onClick={onStart}
              className="flex-1 py-2.5 rounded-xl font-bold text-sm"
              style={{ background: '#22c55e22', color: '#22c55e', border: '1px solid #22c55e33' }}>
              Try Again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

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
  onExport: () => void;
}

function ControlBar({
  visible, collapsed, locked, voicePickerOpen, musicOn,
  sceneKeys, activeIndex, activeDuration, tick, selectedVoice,
  onToggleLock, onJumpTo, onToggleCollapsed, onToggleVoicePicker, onToggleMusic, onExport,
}: ControlBarProps) {
  return (
    <div
      className={`flex items-center gap-3 bg-black/55 backdrop-blur-sm px-5 py-4 transition-all duration-200 ease-out ${
        visible ? 'translate-y-0 opacity-100 pointer-events-auto' : 'translate-y-full opacity-0 pointer-events-none'
      }`}
    >
      {/* Progress bar — left-aligned, takes all flex space */}
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

      {/* Right-side controls — clearly separated from the progress bar */}
      <button
        onClick={onToggleLock}
        className={`w-14 h-14 flex items-center justify-center transition-colors rounded-lg shrink-0 ${
          locked ? 'text-amber-400 bg-amber-400/15 hover:bg-amber-400/25' : 'text-white/40 hover:text-white/80 hover:bg-white/10'
        }`}
        title={locked ? 'Scene loop: on' : 'Scene loop: off'}
        aria-pressed={locked}
      >
        <Repeat className="w-7 h-7" />
      </button>

      <button
        onClick={onToggleMusic}
        className={`w-14 h-14 flex items-center justify-center transition-colors rounded-lg shrink-0 ${
          musicOn
            ? 'text-violet-400 bg-violet-400/15 hover:bg-violet-400/25'
            : 'text-white/40 hover:text-white/80 hover:bg-white/10'
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
            : 'text-white/40 hover:text-white/80 hover:bg-white/10'
        }`}
        title={`AI Voice: ${selectedVoice}`}
        aria-pressed={voicePickerOpen}
      >
        <Mic className="w-7 h-7" />
      </button>

      <button
        onClick={onExport}
        className="w-14 h-14 flex items-center justify-center text-white/40 hover:text-green-400 hover:bg-green-400/10 transition-colors rounded-lg shrink-0"
        title="Export / Download video"
      >
        <Download className="w-7 h-7" />
      </button>

      <div className="w-px self-stretch bg-white/15" />

      <button
        onClick={onToggleCollapsed}
        className="w-14 h-14 flex items-center justify-center text-white/40 hover:text-white/80 hover:bg-white/10 transition-colors rounded-lg shrink-0"
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

  // ── Export / download via MediaRecorder ──────────────────────────────────────
  const [exportPhase, setExportPhase] = useState<ExportPhase>('idle');
  const [exportElapsed, setExportElapsed] = useState(0);
  const [exportError, setExportError] = useState('');
  const recorderRef  = useRef<MediaRecorder | null>(null);
  const chunksRef    = useRef<Blob[]>([]);
  const elapsedTimer = useRef<number | null>(null);

  const stopExport = useCallback((phase: ExportPhase) => {
    if (elapsedTimer.current) { clearInterval(elapsedTimer.current); elapsedTimer.current = null; }
    if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop();
    setExportPhase(phase);
  }, []);

  const handleExportStart = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 30, width: 1920, height: 1080 } as MediaTrackConstraints,
        audio: true,
      });

      chunksRef.current = [];
      const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
        ? 'video/webm;codecs=vp9,opus'
        : 'video/webm';
      const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 });
      recorderRef.current = recorder;

      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(chunksRef.current, { type: mimeType });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href     = url;
        a.download = 'streamvault-premium-promo.webm';
        a.click();
        URL.revokeObjectURL(url);
        setExportPhase('done');
      };

      recorder.start(1000);
      setExportElapsed(0);
      setExportPhase('recording');

      // Jump to scene 0 and restart
      jumpTo(0);

      // Tick elapsed time
      const started = Date.now();
      elapsedTimer.current = window.setInterval(() => {
        const el = Date.now() - started;
        setExportElapsed(el);
        if (el >= TOTAL_DURATION_MS) stopExport('recording');
      }, 500);

      // Auto-stop after full duration + 1s buffer
      setTimeout(() => stopExport('recording'), TOTAL_DURATION_MS + 1000);

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('Permission denied') || msg.includes('NotAllowedError')) {
        setExportError('Screen share was cancelled. Click "Try Again" to retry.');
      } else {
        setExportError(msg || 'Could not start screen capture.');
      }
      setExportPhase('error');
    }
  }, [jumpTo, stopExport]);

  const handleExportCancel = useCallback(() => {
    stopExport('idle');
    setExportElapsed(0);
  }, [stopExport]);

  return (
    <div className="relative w-full h-screen">
      <VideoTemplate
        key={mountKey}
        durations={durations}
        loop
        onSceneChange={onSceneChange}
      />

      <ExportOverlay
        phase={exportPhase}
        elapsed={exportElapsed}
        onStart={handleExportStart}
        onCancel={handleExportCancel}
        errorMsg={exportError}
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
          onExport={() => setExportPhase('instructions')}
        />
      </div>
    </div>
  );
}
