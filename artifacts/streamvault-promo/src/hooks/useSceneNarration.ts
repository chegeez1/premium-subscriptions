import { useEffect, useRef } from 'react';

export const VOICE_KEY = 'chegetech_voice_name';

// Per-scene advertising scripts
export const SCENE_SCRIPTS: Record<string, string> = {
  hero: "ChegeTech StreamVault. One platform. Everything premium. Your digital life — upgraded.",
  tradingChart: "ChegeBot Pro trades Deriv Boom and Crash indices around the clock. Fully automated. Real profits, every day.",
  freeTools: "Free disposable email addresses and real phone numbers — protect your privacy instantly. No account, no strings attached.",
  premiumAccounts: "Netflix, Disney Plus, Spotify, Showmax, Prime Video — all premium, all verified, delivered to your inbox in seconds.",
  aiTools: "ChatGPT Plus, Claude Pro, Midjourney, GitHub Copilot — the world's most powerful AI tools, all under one subscription.",
  vpsHosting: "Lightning-fast VPS hosting from KES 800 per month — Linux, Windows, African data centres, instant setup. Scale on demand.",
  features: "Smart trading strategies, live profit tracking, automatic risk controls, mobile-friendly. ChegeBot Pro is your edge in the market.",
  pricing: "Monthly access from KES 500. Quarterly for KES 1,200. Or go lifetime for KES 5,000. Pay with M-Pesa, Card, or Wallet.",
  testimonials: "Over 10,000 traders trust ChegeTech. 74 percent average win rate. 2.4 million KES in profits generated. The numbers don't lie.",
  linkShortener: "ChegeTech Link Shortener — paste any long URL, get a clean short link in under a second. Custom slugs, QR codes, real-time click analytics, geo tracking. Over 48,000 links shortened. 1.3 million clicks tracked. Completely free.",
  cardTools: "Generate Luhn-valid test cards by BIN profile. Check any card's format and expiry. Look up any BIN — issuing bank, country, card tier, and 3D Secure status. All the developer tools in one place.",
  proxies: "Free proxies — live, rotating, always fresh. Or go premium: residential IPs no one can detect, datacenter speed, mobile carrier IPs, and IPv6 at bulk scale. Fully anonymous. Starting from KES 50. Only at ChegeTech.",
  digitalStore: "Gift cards for Amazon, iTunes, Steam and more. SMM panel for instant followers and views. Aged social media accounts. Residential, datacenter and mobile proxies. ChegeTech has it all — instant delivery, any budget.",
  botInAction: "Watch ChegeBot Pro in real time — live ticks, buy and sell signals firing automatically, your profits growing trade by trade. This is automated trading done right.",
  whatsappBot: "Deploy your own WhatsApp bot in minutes. Sell products, send M-Pesa invoices, track orders, and handle support — fully automated, 24 hours a day. Three plans to fit any business. Only at ChegeTech.",
  cta: "Visit streamvault-premium.site today. Instant access. Everything premium — starting right now.",
};

const IS_IFRAMED = typeof window !== 'undefined' && window.self !== window.top;

export function getSelectedVoice(): SpeechSynthesisVoice | null {
  if (!window.speechSynthesis) return null;
  const voices = window.speechSynthesis.getVoices();
  const saved = localStorage.getItem(VOICE_KEY);
  if (saved) {
    const v = voices.find(v => v.name === saved);
    if (v) return v;
  }
  const PREF = [
    'Google UK English Female',
    'Microsoft Jenny Online (Natural)',
    'Microsoft Aria Online (Natural)',
    'Microsoft Zira Desktop',
    'Samantha',
    'Karen',
    'Moira',
    'Tessa',
    'Google US English',
  ];
  for (const name of PREF) {
    const v = voices.find(v => v.name.includes(name));
    if (v) return v;
  }
  return voices.find(v => v.lang.startsWith('en') && !v.name.toLowerCase().includes('male')) ?? null;
}

export function useSceneNarration(activeSceneKey: string) {
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (!IS_IFRAMED || !window.speechSynthesis) return;

    const baseKey = activeSceneKey.replace(/_r[12]$/, '');

    // aiNarrator scene manages its own speech
    if (baseKey === 'aiNarrator') return;

    const script = SCENE_SCRIPTS[baseKey];
    if (!script) return;

    window.speechSynthesis.cancel();

    const t = setTimeout(() => {
      if (!mountedRef.current) return;
      const utt = new SpeechSynthesisUtterance(script);
      utt.rate = 0.87;
      utt.pitch = 1.05;
      utt.volume = 1.0;
      const voice = getSelectedVoice();
      if (voice) utt.voice = voice;
      window.speechSynthesis.speak(utt);
    }, 420);

    return () => {
      clearTimeout(t);
      if (mountedRef.current) window.speechSynthesis.cancel();
    };
  }, [activeSceneKey]);
}
