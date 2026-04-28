import { motion } from 'framer-motion';

const ORBITING = [
  { label: 'M-Pesa', color: '#22c55e', delay: 0, angle: 0 },
  { label: 'Boom 1000', color: '#7c3aed', delay: 0.1, angle: 72 },
  { label: 'Deriv API', color: '#ec4899', delay: 0.2, angle: 144 },
  { label: 'Auto Trade', color: '#22c55e', delay: 0.3, angle: 216 },
  { label: 'Live P&L', color: '#7c3aed', delay: 0.4, angle: 288 },
];

function toXY(angleDeg: number, r: number) {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: Math.cos(rad) * r, y: Math.sin(rad) * r };
}

const STREAMING_LOGOS = ['StreamVault', 'Netflix', 'Disney+', 'Prime', 'Showmax'];

export default function Scene6CTA() {
  return (
    <motion.div
      className="absolute inset-0 flex flex-col items-center justify-center"
      style={{ backgroundColor: '#0a0a0a' }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.5 }}
    >
      <div className="absolute inset-0 overflow-hidden">
        <motion.div
          className="absolute rounded-full"
          style={{
            width: 600, height: 600, left: '50%', top: '50%',
            marginLeft: -300, marginTop: -300,
            background: 'radial-gradient(circle, #22c55e08 0%, transparent 70%)',
          }}
          animate={{ scale: [1, 1.15, 1] }}
          transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="absolute rounded-full"
          style={{
            width: 400, height: 400, left: '50%', top: '50%',
            marginLeft: -200, marginTop: -200,
            background: 'radial-gradient(circle, #7c3aed0a 0%, transparent 70%)',
          }}
          animate={{ scale: [1.1, 1, 1.1] }}
          transition={{ duration: 3.5, repeat: Infinity, ease: 'easeInOut' }}
        />
      </div>

      <div className="relative z-10 flex flex-col items-center text-center">
        <motion.div
          className="relative mb-8"
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.2, duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
        >
          {ORBITING.map((o) => {
            const pos = toXY(o.angle, 140);
            return (
              <motion.div
                key={o.label}
                className="absolute text-xs font-mono font-bold px-3 py-1.5 rounded-full"
                style={{
                  left: `calc(50% + ${pos.x}px)`,
                  top: `calc(50% + ${pos.y}px)`,
                  transform: 'translate(-50%, -50%)',
                  background: `${o.color}1a`,
                  color: o.color,
                  border: `1px solid ${o.color}44`,
                  whiteSpace: 'nowrap',
                }}
                initial={{ opacity: 0, scale: 0.5 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.5 + o.delay, duration: 0.6 }}
              >
                {o.label}
              </motion.div>
            );
          })}

          <div className="w-36 h-36 rounded-3xl flex flex-col items-center justify-center relative z-10"
            style={{ background: 'linear-gradient(135deg, #22c55e, #7c3aed)', boxShadow: '0 0 60px #22c55e33' }}
          >
            <svg width="44" height="44" viewBox="0 0 24 24" fill="none">
              <path d="M3 17l4-8 4 4 4-6 4 10" stroke="#ffffff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <div className="text-xs font-bold mt-1 tracking-wider" style={{ color: '#ffffff', fontFamily: 'var(--font-display)' }}>BOT</div>
          </div>
        </motion.div>

        <motion.h2
          className="text-6xl font-bold mb-4"
          style={{ fontFamily: 'var(--font-display)', color: '#ffffff' }}
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.45, duration: 0.8 }}
        >
          Start Trading
          <br />
          <span style={{ color: '#22c55e' }}>Today</span>
        </motion.h2>

        <motion.p
          className="text-xl mb-2 max-w-lg"
          style={{ color: '#a1a1aa', fontFamily: 'var(--font-body)' }}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.65, duration: 0.7 }}
        >
          Join 10,000+ traders automating profits on Deriv
        </motion.p>

        <motion.p
          className="text-sm mb-8"
          style={{ color: '#52525b' }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.8 }}
        >
          Also includes: <span style={{ color: '#a1a1aa' }}>StreamVault Premium — {STREAMING_LOGOS.slice(1).join(' · ')}</span>
        </motion.p>

        <motion.div
          className="flex flex-col items-center gap-3"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.9, duration: 0.7 }}
        >
          <div
            className="px-10 py-4 rounded-2xl text-xl font-bold flex items-center gap-3"
            style={{
              background: 'linear-gradient(135deg, #22c55e, #16a34a)',
              color: '#0a0a0a',
              fontFamily: 'var(--font-display)',
              boxShadow: '0 0 30px #22c55e44',
            }}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <path d="M5 12h14M12 5l7 7-7 7" stroke="#0a0a0a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            streamvault-premium.site
          </div>
          <div className="text-sm" style={{ color: '#52525b' }}>
            From <span style={{ color: '#22c55e', fontWeight: 'bold' }}>KES 500/mo</span> · M-Pesa accepted
          </div>
        </motion.div>

        <motion.div
          className="mt-8 flex items-center gap-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.2 }}
        >
          {['🔒 Secure Checkout', '⚡ Instant Access', '📱 Any Device'].map((tag) => (
            <span
              key={tag}
              className="text-xs px-3 py-1.5 rounded-full"
              style={{ background: '#1a1a1a', color: '#71717a', border: '1px solid #222222' }}
            >
              {tag}
            </span>
          ))}
        </motion.div>
      </div>
    </motion.div>
  );
}
