import { useCallback, useEffect, useRef, useState } from 'react';
import html2canvas from 'html2canvas';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';
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
type ExportPhase = 'idle' | 'recording' | 'converting' | 'done' | 'error';

function fmtTime(ms: number) {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function Spinner() {
  return (
    <div className="w-4 h-4 rounded-full border-2 animate-spin"
      style={{
        borderTopColor: '#22c55e', borderRightColor: '#22c55e33',
        borderBottomColor: '#22c55e33', borderLeftColor: '#22c55e33',
      }} />
  );
}

function ExportOverlay({
  phase, elapsed, onCancel, onRetry, errorMsg,
}: {
  phase: ExportPhase; elapsed: number;
  onCancel: () => void; onRetry: () => void; errorMsg: string;
}) {
  if (phase === 'idle') return null;
  const remaining = Math.max(0, TOTAL_DURATION_MS - elapsed);
  const pct       = Math.min(100, (elapsed / TOTAL_DURATION_MS) * 100);
  const busy      = phase === 'recording' || phase === 'converting';

  return (
    <div className="absolute inset-0 z-[100] flex items-end justify-center pb-28"
      style={{ pointerEvents: 'none' }}>
      <div className="rounded-2xl px-6 py-4 flex items-center gap-4 min-w-96"
        style={{ background: '#111', border: '1px solid #22c55e33', pointerEvents: 'auto', boxShadow: '0 8px 32px #00000088' }}>

        {/* Icon */}
        <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: '#22c55e18' }}>
          {phase === 'recording'  && <Circle className="w-4 h-4 fill-red-500 text-red-500" />}
          {phase === 'converting' && <Spinner />}
          {phase === 'done'       && <span className="text-lg">✅</span>}
          {phase === 'error'      && <span className="text-lg">❌</span>}
        </div>

        {/* Text + bar */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm font-bold text-white" style={{ fontFamily: 'var(--font-display)' }}>
              {phase === 'recording'  && 'Capturing frames…'}
              {phase === 'converting' && 'Converting to MP4…'}
              {phase === 'done'       && 'Download complete ✓'}
              {phase === 'error'      && 'Export failed'}
            </span>
            <span className="text-xs font-mono" style={{ color: '#52525b' }}>
              {phase === 'recording'  && `${fmtTime(remaining)} left`}
              {phase === 'converting' && 'almost done…'}
              {phase === 'done'       && 'streamvault-premium-promo.mp4'}
              {phase === 'error'      && errorMsg.slice(0, 40)}
            </span>
          </div>
          {phase === 'recording' && (
            <div className="rounded-full overflow-hidden" style={{ background: '#1a1a1a', height: 5 }}>
              <div className="h-full rounded-full transition-all duration-500"
                style={{ width: `${pct}%`, background: 'linear-gradient(90deg,#22c55e,#7c3aed)' }} />
            </div>
          )}
          {phase === 'converting' && (
            <div className="rounded-full overflow-hidden" style={{ background: '#1a1a1a', height: 5 }}>
              <div className="h-full rounded-full" style={{ width: '100%', background: 'linear-gradient(90deg,#7c3aed,#ec4899)', animation: 'pulse 1.5s ease-in-out infinite' }} />
            </div>
          )}
          {phase === 'error' && (
            <div className="text-xs" style={{ color: '#71717a' }}>
              Try again — or try a different browser (Chrome recommended)
            </div>
          )}
        </div>

        {/* Action */}
        {phase === 'error' && (
          <button onClick={onRetry}
            className="text-xs px-3 py-1.5 rounded-lg font-bold shrink-0"
            style={{ background: '#22c55e22', color: '#22c55e', border: '1px solid #22c55e33' }}>
            Retry
          </button>
        )}
        {!busy && (
          <button onClick={onCancel}
            className="w-7 h-7 flex items-center justify-center rounded-lg shrink-0"
            style={{ color: '#3f3f46' }}>
            <X className="w-4 h-4" />
          </button>
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

  // ── Export / download via canvas capture (no screen-share dialog) ───────────
  const [exportPhase, setExportPhase] = useState<ExportPhase>('idle');
  const [exportElapsed, setExportElapsed] = useState(0);
  const [exportError, setExportError] = useState('');
  const containerRef  = useRef<HTMLDivElement | null>(null);
  const recorderRef   = useRef<MediaRecorder | null>(null);
  const chunksRef     = useRef<Blob[]>([]);
  const capturingRef  = useRef(false);
  const ffmpegRef     = useRef<FFmpeg | null>(null);

  const handleExportStart = useCallback(async () => {
    const container = containerRef.current;
    if (!container) return;

    try {
      setExportError('');
      setExportElapsed(0);
      setExportPhase('recording');

      // Offscreen canvas sized to the video container
      const W = container.offsetWidth  || 1280;
      const H = container.offsetHeight || 720;
      const canvas  = document.createElement('canvas');
      canvas.width  = W;
      canvas.height = H;

      // Manual-frame stream (captureStream(0) = we call requestFrame ourselves)
      const stream = canvas.captureStream(0);
      const track  = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;

      const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
        ? 'video/webm;codecs=vp9'
        : 'video/webm';
      const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 6_000_000 });
      recorderRef.current  = recorder;
      chunksRef.current    = [];
      capturingRef.current = true;

      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = async () => {
        const webmBlob = new Blob(chunksRef.current, { type: mimeType });
        setExportPhase('converting');
        try {
          // Load ffmpeg.wasm once, reuse on subsequent exports
          if (!ffmpegRef.current) {
            const ff = new FFmpeg();
            const base = import.meta.env.BASE_URL ?? '/streamvault-promo/';
            await ff.load({
              coreURL: `${base}ffmpeg/ffmpeg-core.js`,
              wasmURL: `${base}ffmpeg/ffmpeg-core.wasm`,
            });
            ffmpegRef.current = ff;
          }
          const ff = ffmpegRef.current;
          await ff.writeFile('input.webm', await fetchFile(webmBlob));
          // Remux VP9 video into MP4 container — no re-encoding, fast
          await ff.exec(['-i', 'input.webm', '-c', 'copy', '-f', 'mp4', 'output.mp4']);
          const mp4 = await ff.readFile('output.mp4') as Uint8Array;
          const mp4Blob = new Blob([mp4], { type: 'video/mp4' });
          const url = URL.createObjectURL(mp4Blob);
          const a = document.createElement('a');
          a.href = url; a.download = 'streamvault-premium-promo.mp4';
          document.body.appendChild(a); a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        } catch {
          // Fallback: just download the webm if mp4 conversion fails
          const url = URL.createObjectURL(webmBlob);
          const a = document.createElement('a');
          a.href = url; a.download = 'streamvault-premium-promo.webm';
          document.body.appendChild(a); a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }
        setExportPhase('done');
      };

      // Reset to scene 0, then wait a tick for React to repaint
      jumpTo(0);
      await new Promise(r => setTimeout(r, 600));

      recorder.start(1000);
      const started = Date.now();

      // Frame capture loop — runs until full duration captured
      const loop = async () => {
        if (!capturingRef.current) return;

        const elapsed = Date.now() - started;
        setExportElapsed(elapsed);

        if (elapsed >= TOTAL_DURATION_MS) {
          capturingRef.current = false;
          recorder.stop();
          return;
        }

        try {
          await html2canvas(container, {
            canvas,
            useCORS: true,
            allowTaint: true,
            backgroundColor: '#0a0a0a',
            scale: 1,
            logging: false,
            imageTimeout: 0,
            removeContainer: false,
          });
          track.requestFrame();
        } catch {
          // skip bad frames silently
        }

        // ~15fps target (67ms); actual interval adapts to html2canvas cost
        setTimeout(loop, 67);
      };

      loop();

    } catch (err: unknown) {
      capturingRef.current = false;
      setExportError(err instanceof Error ? err.message : String(err));
      setExportPhase('error');
    }
  }, [jumpTo]);

  const handleExportCancel = useCallback(() => {
    capturingRef.current = false;
    if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop();
    setExportPhase('idle');
    setExportElapsed(0);
  }, []);

  return (
    <div ref={containerRef} className="relative w-full h-screen">
      <VideoTemplate
        key={mountKey}
        durations={durations}
        loop
        onSceneChange={onSceneChange}
      />

      <ExportOverlay
        phase={exportPhase}
        elapsed={exportElapsed}
        onRetry={handleExportStart}
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
          onExport={handleExportStart}
        />
      </div>
    </div>
  );
}
