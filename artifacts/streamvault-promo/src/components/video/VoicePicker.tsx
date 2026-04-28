import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Search, Mic } from 'lucide-react';
import { VOICE_KEY } from '@/hooks/useSceneNarration';

const TEST_TEXT = "Welcome to ChegeTech StreamVault — the premium digital platform. Join thousands of traders and subscribers today.";

interface VoicePickerProps {
  open: boolean;
  selectedVoice: string;
  onClose: () => void;
  onSelect: (name: string) => void;
}

export default function VoicePicker({ open, selectedVoice, onClose, onSelect }: VoicePickerProps) {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [search, setSearch] = useState('');
  const [testingName, setTestingName] = useState('');

  useEffect(() => {
    const load = () => {
      const all = window.speechSynthesis?.getVoices() ?? [];
      // English voices first, then any others
      const en = all.filter(v => v.lang.startsWith('en'));
      setVoices(en.length ? en : all);
    };
    load();
    window.speechSynthesis?.addEventListener('voiceschanged', load);
    return () => window.speechSynthesis?.removeEventListener('voiceschanged', load);
  }, []);

  const testVoice = useCallback((voice: SpeechSynthesisVoice) => {
    window.speechSynthesis.cancel();
    setTestingName(voice.name);
    const utt = new SpeechSynthesisUtterance(TEST_TEXT);
    utt.rate = 0.88;
    utt.pitch = 1.05;
    utt.voice = voice;
    utt.onend = () => setTestingName('');
    utt.onerror = () => setTestingName('');
    window.speechSynthesis.speak(utt);
  }, []);

  const stopTest = useCallback(() => {
    window.speechSynthesis.cancel();
    setTestingName('');
  }, []);

  const filtered = voices.filter(v =>
    v.name.toLowerCase().includes(search.toLowerCase()) ||
    v.lang.toLowerCase().includes(search.toLowerCase()),
  );

  const handleSelect = useCallback((name: string) => {
    localStorage.setItem(VOICE_KEY, name);
    onSelect(name);
    window.speechSynthesis.cancel();
    setTestingName('');
  }, [onSelect]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="absolute bottom-full left-4 right-4 mb-3 rounded-2xl overflow-hidden z-50 flex flex-col"
          style={{
            background: '#0f0f0f',
            border: '1px solid #222222',
            maxHeight: '55vh',
            boxShadow: '0 -8px 40px rgba(0,0,0,0.6)',
          }}
          initial={{ opacity: 0, y: 16, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 16, scale: 0.98 }}
          transition={{ duration: 0.22 }}
        >
          {/* Header */}
          <div
            className="flex items-center gap-3 px-5 py-4 shrink-0"
            style={{ borderBottom: '1px solid #1e1e1e' }}
          >
            <Mic className="w-5 h-5 shrink-0" style={{ color: '#22c55e' }} />
            <span
              className="text-base font-bold"
              style={{ fontFamily: 'var(--font-display)', color: '#ffffff' }}
            >
              Narration Voice
            </span>
            <span className="text-xs ml-1" style={{ color: '#52525b' }}>
              — pick the voice that sounds like an ad
            </span>
            <div className="flex-1" />

            {/* Search */}
            <div className="relative">
              <Search
                className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none"
                style={{ color: '#52525b' }}
              />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search voices…"
                className="rounded-xl pl-9 pr-4 py-2 text-sm outline-none"
                style={{
                  background: '#1a1a1a',
                  border: '1px solid #252525',
                  color: '#ffffff',
                  width: 200,
                }}
              />
            </div>

            <button
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-lg transition-colors"
              style={{ color: '#52525b' }}
              onMouseEnter={e => (e.currentTarget.style.color = '#ffffff')}
              onMouseLeave={e => (e.currentTarget.style.color = '#52525b')}
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Voice list */}
          <div className="overflow-y-auto flex-1">
            {filtered.length === 0 ? (
              <div className="text-center py-12 text-sm" style={{ color: '#52525b' }}>
                No voices found for "{search}"
              </div>
            ) : (
              filtered.map(voice => {
                const isSelected = voice.name === selectedVoice;
                const isTesting = voice.name === testingName;
                return (
                  <div
                    key={voice.name}
                    className="flex items-center gap-4 px-5 py-3 cursor-pointer"
                    style={{
                      background: isSelected ? '#22c55e0c' : 'transparent',
                      borderBottom: '1px solid #161616',
                      transition: 'background 0.15s',
                    }}
                    onMouseEnter={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = '#ffffff08'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = isSelected ? '#22c55e0c' : 'transparent'; }}
                    onClick={() => handleSelect(voice.name)}
                  >
                    {/* Radio dot */}
                    <div
                      className="w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0"
                      style={{
                        borderColor: isSelected ? '#22c55e' : '#3f3f46',
                        background: isSelected ? '#22c55e' : 'transparent',
                        transition: 'all 0.15s',
                      }}
                    >
                      {isSelected && <div className="w-2 h-2 rounded-full" style={{ background: '#0a0a0a' }} />}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div
                        className="text-sm font-medium truncate"
                        style={{ color: isSelected ? '#86efac' : '#d4d4d8' }}
                      >
                        {voice.name}
                      </div>
                      <div className="text-xs mt-0.5" style={{ color: '#52525b' }}>
                        {voice.lang}
                        {voice.localService ? ' · Local' : ' · Network'}
                        {voice.default ? ' · System default' : ''}
                      </div>
                    </div>

                    <button
                      onClick={e => {
                        e.stopPropagation();
                        if (isTesting) stopTest();
                        else testVoice(voice);
                      }}
                      className="text-xs px-4 py-1.5 rounded-lg font-bold shrink-0 transition-colors"
                      style={{
                        fontFamily: 'var(--font-mono)',
                        background: isTesting ? '#22c55e22' : '#1e1e1e',
                        color: isTesting ? '#22c55e' : '#71717a',
                        border: `1px solid ${isTesting ? '#22c55e44' : 'transparent'}`,
                      }}
                    >
                      {isTesting ? '■ Stop' : '▶ Test'}
                    </button>
                  </div>
                );
              })
            )}
          </div>

          <div
            className="px-5 py-3 text-xs shrink-0"
            style={{ borderTop: '1px solid #1a1a1a', color: '#3f3f46' }}
          >
            {filtered.length} voice{filtered.length !== 1 ? 's' : ''} available · Click a voice to select · ▶ Test plays the ad script
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
