import { motion } from 'framer-motion';

const GEO_SHAPES = [
  { x: '8%', y: '10%', size: 180, color: '#7c3aed', rotate: 15, delay: 0 },
  { x: '75%', y: '5%', size: 140, color: '#ec4899', rotate: -20, delay: 0.3 },
  { x: '85%', y: '55%', size: 200, color: '#7c3aed', rotate: 30, delay: 0.15 },
  { x: '2%', y: '60%', size: 160, color: '#ec4899', rotate: -10, delay: 0.45 },
  { x: '40%', y: '78%', size: 120, color: '#6d28d9', rotate: 25, delay: 0.6 },
];

const PARTICLES = Array.from({ length: 20 }, (_, i) => ({
  x: `${Math.random() * 100}%`,
  y: `${Math.random() * 100}%`,
  delay: i * 0.18,
  duration: 3 + Math.random() * 2,
}));

export default function Scene1Hero() {
  return (
    <motion.div
      className="absolute inset-0 flex flex-col items-center justify-center"
      style={{ backgroundColor: '#0a0a0a' }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.6 }}
    >
      {GEO_SHAPES.map((s, i) => (
        <motion.div
          key={i}
          className="absolute"
          style={{ left: s.x, top: s.y }}
          initial={{ opacity: 0, scale: 0.4, rotate: s.rotate - 20 }}
          animate={{ opacity: 0.22, scale: 1, rotate: s.rotate }}
          transition={{ delay: s.delay, duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
        >
          <div
            style={{
              width: s.size,
              height: s.size,
              background: `linear-gradient(135deg, ${s.color}cc, ${s.color}44)`,
              clipPath: 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)',
              filter: 'blur(2px)',
            }}
          />
        </motion.div>
      ))}

      {PARTICLES.map((p, i) => (
        <motion.div
          key={i}
          className="absolute w-1 h-1 rounded-full bg-primary"
          style={{ left: p.x, top: p.y }}
          animate={{
            y: [-60, -120],
            opacity: [0, 0.8, 0],
          }}
          transition={{
            delay: p.delay,
            duration: p.duration,
            repeat: Infinity,
            ease: 'linear',
          }}
        />
      ))}

      <div className="relative z-10 flex flex-col items-center text-center px-8">
        <motion.div
          className="flex items-center gap-3 mb-6"
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4, duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <path d="M3 17l4-8 4 4 4-6 4 10" stroke="#0a0a0a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <span
            className="text-2xl font-bold tracking-wider uppercase"
            style={{ fontFamily: 'var(--font-display)', color: '#ffffff', letterSpacing: '0.15em' }}
          >
            Chege<span style={{ color: '#22c55e' }}>Tech</span>
          </span>
        </motion.div>

        <motion.h1
          className="text-7xl font-bold leading-none mb-4"
          style={{ fontFamily: 'var(--font-display)', color: '#ffffff' }}
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6, duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
        >
          Chege<span style={{ color: '#22c55e' }}>Bot</span>{' '}
          <span style={{ color: '#ec4899' }}>Pro</span>
        </motion.h1>

        <motion.p
          className="text-2xl mb-2 font-medium"
          style={{ fontFamily: 'var(--font-body)', color: '#a1a1aa' }}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.85, duration: 0.8 }}
        >
          Automated Deriv Trading Bot
        </motion.p>

        <motion.p
          className="text-lg"
          style={{ color: '#52525b', fontFamily: 'var(--font-body)' }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.1, duration: 0.8 }}
        >
          Powered by <span style={{ color: '#22c55e' }}>streamvault-premium.site</span>
        </motion.p>

        <motion.div
          className="mt-8 h-px w-48"
          style={{ background: 'linear-gradient(90deg, transparent, #22c55e, transparent)' }}
          initial={{ scaleX: 0, opacity: 0 }}
          animate={{ scaleX: 1, opacity: 1 }}
          transition={{ delay: 1.3, duration: 0.8 }}
        />
      </div>
    </motion.div>
  );
}
