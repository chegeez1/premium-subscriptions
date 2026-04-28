import { motion } from 'framer-motion';

const SERVICES = [
  {
    name: 'Netflix',
    tier: 'Premium 4K',
    emoji: '🎬',
    color: '#ef4444',
    screens: '4 screens',
    desc: 'Ultra HD · HDR · Dolby Atmos',
  },
  {
    name: 'Disney+',
    tier: 'Premium',
    emoji: '✨',
    color: '#3b82f6',
    screens: 'Unlimited',
    desc: 'Marvel · Star Wars · Pixar · National Geographic',
  },
  {
    name: 'Prime Video',
    tier: 'Unlimited',
    emoji: '📦',
    color: '#22c55e',
    screens: '3 screens',
    desc: 'Originals · Movies · Live Sports',
  },
  {
    name: 'Showmax',
    tier: 'Pro',
    emoji: '🌍',
    color: '#ec4899',
    screens: '5 screens',
    desc: 'African content · Sport · International',
  },
  {
    name: 'Spotify',
    tier: 'Premium',
    emoji: '🎵',
    color: '#22c55e',
    screens: 'Family Plan',
    desc: 'No ads · Offline · Hi-Fi quality',
  },
  {
    name: 'YouTube',
    tier: 'Premium',
    emoji: '▶️',
    color: '#ef4444',
    screens: 'Ad-Free',
    desc: 'No ads · Background play · Downloads',
  },
  {
    name: 'Canva',
    tier: 'Pro',
    emoji: '🎨',
    color: '#7c3aed',
    screens: '1 user',
    desc: 'Premium templates · Brand Kit · AI tools',
  },
  {
    name: 'ChatGPT',
    tier: 'Plus',
    emoji: '🤖',
    color: '#22c55e',
    screens: '1 user',
    desc: 'GPT-4o · DALL·E · Code Interpreter',
  },
];

export default function Scene4PremiumAccounts() {
  return (
    <motion.div
      className="absolute inset-0 flex flex-col px-14 py-10"
      style={{ backgroundColor: '#0a0a0a' }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.5 }}
    >
      <motion.div
        className="text-center mb-8"
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2, duration: 0.7 }}
      >
        <span className="text-sm font-mono uppercase tracking-widest" style={{ color: '#ec4899' }}>
          StreamVault Premium
        </span>
        <h2 className="text-5xl font-bold mt-2" style={{ fontFamily: 'var(--font-display)', color: '#ffffff' }}>
          Premium Accounts
        </h2>
        <p className="mt-3 text-base" style={{ color: '#71717a' }}>
          Instant delivery · Verified · Shared access · All in one subscription
        </p>
      </motion.div>

      <div className="grid grid-cols-4 gap-4 flex-1">
        {SERVICES.map((s, i) => (
          <motion.div
            key={s.name}
            className="rounded-2xl p-5 flex flex-col gap-3"
            style={{
              background: '#111111',
              border: `1px solid ${s.color}22`,
            }}
            initial={{ opacity: 0, y: 25, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ delay: 0.3 + i * 0.07, duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="flex items-start justify-between">
              <div
                className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl"
                style={{ background: `${s.color}15` }}
              >
                {s.emoji}
              </div>
              <div
                className="text-xs font-bold px-2.5 py-1 rounded-full"
                style={{ background: `${s.color}18`, color: s.color, fontFamily: 'var(--font-mono)' }}
              >
                {s.tier}
              </div>
            </div>

            <div>
              <div className="text-base font-bold" style={{ fontFamily: 'var(--font-display)', color: '#ffffff' }}>
                {s.name}
              </div>
              <div className="text-xs mt-1 leading-relaxed" style={{ color: '#52525b' }}>
                {s.desc}
              </div>
            </div>

            <div className="flex items-center gap-1.5 mt-auto">
              <div className="w-1.5 h-1.5 rounded-full" style={{ background: '#22c55e' }} />
              <span className="text-xs" style={{ color: '#71717a' }}>{s.screens}</span>
            </div>
          </motion.div>
        ))}
      </div>

      <motion.div
        className="mt-6 flex items-center justify-center gap-6"
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.95, duration: 0.6 }}
      >
        {[
          { icon: '⚡', text: 'Instant delivery' },
          { icon: '🔒', text: 'Secure & verified' },
          { icon: '♻️', text: 'Auto-renewal support' },
          { icon: '💬', text: '24/7 live chat' },
        ].map((tag) => (
          <div key={tag.text} className="flex items-center gap-2 text-sm" style={{ color: '#71717a' }}>
            <span>{tag.icon}</span>
            <span>{tag.text}</span>
          </div>
        ))}
      </motion.div>
    </motion.div>
  );
}
