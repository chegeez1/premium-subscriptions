import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Mic, Volume2, Sparkles } from 'lucide-react';
import { fetchNarrationAudio, type AIVoice } from '@/hooks/useAINarration';

const TEST_TEXT = "ChegeTech StreamVault — your premium digital platform. Join thousands of traders and subscribers today.";

interface VoiceOption {
  id: AIVoice;
  name: string;
  desc: string;
  badge?: string;
}

const VOICES: VoiceOption[] = [
  { id: 'onyx',    name: 'Onyx',    desc: 'Deep, rich, broadcast-quality male voice', badge: 'Best for ads' },
  { id: 'fable',   name: 'Fable',   desc: 'Warm, engaging storytelling voice' },
  { id: 'echo',    name: 'Echo',    desc: 'Smooth, confident male voice' },
  { id: 'alloy',   name: 'Alloy',   desc: 'Clear, neutral professional tone' },
  { id: 'nova',    name: 'Nova',    desc: 'Bright, energetic female voice' },
  { id: 'shimmer', name: 'Shimmer', desc: 'Soft, polished female voice' },
];

interface VoicePickerProps {
  open: boolean;
  selectedVoice: AIVoice;
  onClose: () => void;
  onSelect: (voice: AIVoice) => void;
}

export default function VoicePicker({ open, selectedVoice, onClose, onSelect }: VoicePickerProps) {
  const [testingId, setTestingId] = useState<AIVoice | null>(null);
  const [errorId, setErrorId] = useState<AIVoice | null>(null);
  const [audioMap, setAudioMap] = useState<Map<AIVoice, HTMLAudioElement>>(new Map());

  const stopAll = useCallback(() => {
    audioMap.forEach(a => { a.pause(); a.currentTime = 0; });
    setAudioMap(new Map());
    setTestingId(null);
  }, [audioMap]);

  const testVoice = useCallback(async (voice: AIVoice) => {
    stopAll();
    setErrorId(null);
    setTestingId(voice);

    try {
      const url = await fetchNarrationAudio(TEST_TEXT, voice);
      const audio = new Audio(url);
      audio.volume = 1.0;

      audio.onended = () => setTestingId(prev => prev === voice ? null : prev);
      audio.onerror = () => {
        setTestingId(prev => prev === voice ? null : prev);
        setErrorId(voice);
      };

      const map = new Map([[voice, audio]]);
      setAudioMap(map);
      await audio.play();
    } catch {
      setTestingId(null);
      setErrorId(voice);
    }
  }, [stopAll]);

  const handleSelect = useCallback((voice: AIVoice) => {
    stopAll();
    onSelect(voice);
    onClose();
  }, [stopAll, onSelect, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="absolute bottom-full left-4 right-4 mb-3 rounded-2xl overflow-hidden z-50 flex flex-col"
          style={{
            background: '#0d0d0d',
            border: '1px solid #1e1e1e',
            boxShadow: '0 -12px 48px rgba(0,0,0,0.7)',
          }}
          initial={{ opacity: 0, y: 20, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 20, scale: 0.97 }}
          transition={{ duration: 0.22 }}
        >
          {/* Header */}
          <div
            className="flex items-center gap-3 px-6 py-4 shrink-0"
            style={{ borderBottom: '1px solid #1a1a1a' }}
          >
            <Sparkles className="w-5 h-5 shrink-0" style={{ color: '#22c55e' }} />
            <div>
              <div
                className="text-base font-bold"
                style={{ fontFamily: 'var(--font-display)', color: '#ffffff' }}
              >
                AI Narration Voice
              </div>
              <div className="text-xs mt-0.5" style={{ color: '#52525b' }}>
                Powered by OpenAI — ▶ Test plays the actual ad script
              </div>
            </div>
            <div className="flex-1" />
            <button
              onClick={() => { stopAll(); onClose(); }}
              className="w-8 h-8 flex items-center justify-center rounded-lg transition-colors"
              style={{ color: '#52525b' }}
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Voice grid */}
          <div className="p-3 grid grid-cols-3 gap-3">
            {VOICES.map(v => {
              const isSelected = v.id === selectedVoice;
              const isTesting = v.id === testingId;
              const hasError = v.id === errorId;

              return (
                <motion.div
                  key={v.id}
                  className="relative rounded-xl p-4 cursor-pointer flex flex-col gap-3"
                  style={{
                    background: isSelected ? '#22c55e10' : '#141414',
                    border: `1.5px solid ${isSelected ? '#22c55e55' : '#1e1e1e'}`,
                  }}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => handleSelect(v.id)}
                >
                  {v.badge && (
                    <div
                      className="absolute top-2 right-2 text-xs px-2 py-0.5 rounded-full font-bold"
                      style={{ background: '#22c55e20', color: '#22c55e', fontSize: '0.6rem' }}
                    >
                      {v.badge}
                    </div>
                  )}

                  {/* Radio + icon */}
                  <div className="flex items-center gap-2">
                    <div
                      className="w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0"
                      style={{
                        borderColor: isSelected ? '#22c55e' : '#3f3f46',
                        background: isSelected ? '#22c55e' : 'transparent',
                      }}
                    >
                      {isSelected && <div className="w-2 h-2 rounded-full bg-black" />}
                    </div>
                    <Volume2
                      className="w-4 h-4"
                      style={{ color: isSelected ? '#22c55e' : '#52525b' }}
                    />
                  </div>

                  <div>
                    <div
                      className="text-sm font-bold mb-1"
                      style={{ color: isSelected ? '#86efac' : '#e4e4e7' }}
                    >
                      {v.name}
                    </div>
                    <div
                      className="text-xs leading-relaxed"
                      style={{ color: '#71717a', fontSize: '0.7rem' }}
                    >
                      {v.desc}
                    </div>
                  </div>

                  <button
                    className="text-xs px-3 py-1.5 rounded-lg font-bold w-full transition-colors"
                    style={{
                      fontFamily: 'var(--font-mono)',
                      background: isTesting ? '#22c55e22' : hasError ? '#ef444410' : '#1e1e1e',
                      color: isTesting ? '#22c55e' : hasError ? '#ef4444' : '#71717a',
                      border: `1px solid ${isTesting ? '#22c55e44' : 'transparent'}`,
                    }}
                    onClick={e => {
                      e.stopPropagation();
                      if (isTesting) stopAll();
                      else testVoice(v.id);
                    }}
                  >
                    {isTesting ? '■ Stop' : hasError ? '✕ Error' : '▶ Test'}
                  </button>
                </motion.div>
              );
            })}
          </div>

          <div
            className="px-6 py-3 text-xs shrink-0"
            style={{ borderTop: '1px solid #1a1a1a', color: '#3f3f46' }}
          >
            Voice applies to all scenes instantly — pick one and hear the difference
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
