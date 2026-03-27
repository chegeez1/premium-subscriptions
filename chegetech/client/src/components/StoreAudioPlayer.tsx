import { useState, useEffect, useRef } from "react";
import { Play, Pause, SkipForward, Volume2, VolumeX, X } from "lucide-react";

interface Track {
  title: string;
  artist: string;
  preview: string;
}

const SEARCHES = ["drake", "weeknd", "lil tecca", "travis scott", "future", "polo g", "gunna", "pop smoke"];
const INTRO_TEXT = "This is Chege Tech Incorporative. Enjoy our cheap premium plans.";

export default function StoreAudioPlayer() {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [visible, setVisible] = useState(true);
  const [phase, setPhase] = useState<"idle" | "intro" | "music">("idle");
  const [bars, setBars] = useState([30, 30, 30, 30]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const startedRef = useRef(false);
  const barTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    async function loadTracks() {
      const all: Track[] = [];
      const picks = [...SEARCHES].sort(() => Math.random() - 0.5).slice(0, 4);
      for (const q of picks) {
        try {
          const r = await fetch(`https://api.deezer.com/search?q=${encodeURIComponent(q)}&limit=5`);
          const j = await r.json();
          if (j.data) {
            j.data.forEach((t: any) => {
              if (t.preview) all.push({ title: t.title, artist: t.artist.name, preview: t.preview });
            });
          }
        } catch {}
      }
      setTracks(all.sort(() => Math.random() - 0.5));
    }
    loadTracks();
  }, []);

  useEffect(() => {
    if (playing && phase === "music") {
      barTimerRef.current = setInterval(() => {
        setBars([
          Math.random() * 70 + 20,
          Math.random() * 70 + 20,
          Math.random() * 70 + 20,
          Math.random() * 70 + 20,
        ]);
      }, 200);
    } else {
      if (barTimerRef.current) clearInterval(barTimerRef.current);
      setBars([30, 30, 30, 30]);
    }
    return () => { if (barTimerRef.current) clearInterval(barTimerRef.current); };
  }, [playing, phase]);

  function startMusic() {
    setPhase("music");
    setPlaying(true);
  }

  function doIntro() {
    if (!window.speechSynthesis) { startMusic(); return; }
    window.speechSynthesis.cancel();
    const utt = new SpeechSynthesisUtterance(INTRO_TEXT);
    utt.rate = 0.82;
    utt.pitch = 0.65;
    utt.volume = 1;

    function speak() {
      const voices = window.speechSynthesis.getVoices();
      const male = voices.find(v =>
        v.lang.startsWith("en") &&
        /david|mark|guy|daniel|james|richard|george|fred|alex/i.test(v.name)
      ) || voices.find(v => v.lang.startsWith("en"));
      if (male) utt.voice = male;
      setPhase("intro");
      utt.onend = startMusic;
      utt.onerror = startMusic;
      window.speechSynthesis.speak(utt);
    }

    const voices = window.speechSynthesis.getVoices();
    if (voices.length > 0) speak();
    else { window.speechSynthesis.onvoiceschanged = speak; }
  }

  function handlePlay() {
    if (!startedRef.current) {
      startedRef.current = true;
      doIntro();
      return;
    }
    if (playing) {
      audioRef.current?.pause();
      setPlaying(false);
    } else {
      if (phase === "music") {
        audioRef.current?.play().catch(() => {});
        setPlaying(true);
      } else {
        doIntro();
      }
    }
  }

  function skip() {
    const next = (idx + 1) % Math.max(tracks.length, 1);
    setIdx(next);
    if (playing && phase === "music" && tracks[next]) {
      if (audioRef.current) {
        audioRef.current.src = tracks[next].preview;
        audioRef.current.muted = muted;
        audioRef.current.volume = 0.7;
        audioRef.current.play().catch(() => {});
      }
    }
  }

  function toggleMute() {
    setMuted(m => {
      if (audioRef.current) audioRef.current.muted = !m;
      return !m;
    });
  }

  useEffect(() => {
    if (!playing || phase !== "music" || tracks.length === 0) return;
    const track = tracks[idx];
    if (!track || !audioRef.current) return;
    audioRef.current.src = track.preview;
    audioRef.current.muted = muted;
    audioRef.current.volume = 0.7;
    audioRef.current.play().catch(() => setPlaying(false));
  }, [playing, idx, tracks, phase]);

  const cur = tracks[idx];

  if (!visible) return null;

  return (
    <>
      <audio ref={audioRef} onEnded={skip} onError={skip} />
      <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-4 py-2.5 rounded-2xl border border-white/10 shadow-2xl"
        style={{ background: "rgba(10,10,20,0.85)", backdropFilter: "blur(20px)", minWidth: 280, maxWidth: 400 }}>

        <div className="flex items-end gap-[3px] h-5 shrink-0">
          {bars.map((h, i) => (
            <div key={i} className="w-[3px] rounded-full bg-indigo-400 transition-all duration-200"
              style={{ height: `${playing && phase === "music" ? h : 25}%` }} />
          ))}
        </div>

        <div className="flex-1 min-w-0">
          {phase === "intro" ? (
            <p className="text-xs font-semibold text-white truncate">🎙️ Chege Tech Radio</p>
          ) : cur ? (
            <>
              <p className="text-xs font-semibold text-white truncate">{cur.title}</p>
              <p className="text-[10px] text-white/50 truncate">{cur.artist}</p>
            </>
          ) : (
            <p className="text-xs font-medium text-indigo-300">🎵 Chege Tech Radio</p>
          )}
          {!startedRef.current && (
            <p className="text-[10px] text-white/40">Tap ▶ to play</p>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={handlePlay}
            className="w-7 h-7 rounded-full flex items-center justify-center transition-colors"
            style={{ background: "rgba(99,102,241,0.9)" }}
          >
            {playing && phase !== "idle" ? (
              <Pause className="w-3.5 h-3.5 text-white" />
            ) : (
              <Play className="w-3.5 h-3.5 text-white ml-0.5" />
            )}
          </button>
          <button onClick={skip} className="w-6 h-6 rounded-full hover:bg-white/10 flex items-center justify-center transition-colors">
            <SkipForward className="w-3 h-3 text-white/70" />
          </button>
          <button onClick={toggleMute} className="w-6 h-6 rounded-full hover:bg-white/10 flex items-center justify-center transition-colors">
            {muted ? <VolumeX className="w-3 h-3 text-white/50" /> : <Volume2 className="w-3 h-3 text-white/70" />}
          </button>
          <button onClick={() => setVisible(false)} className="w-6 h-6 rounded-full hover:bg-white/10 flex items-center justify-center transition-colors">
            <X className="w-3 h-3 text-white/40" />
          </button>
        </div>
      </div>
    </>
  );
}
