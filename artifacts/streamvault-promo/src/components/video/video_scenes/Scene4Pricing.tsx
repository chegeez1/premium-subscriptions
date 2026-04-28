import { motion } from 'framer-motion';

const PLANS = [
  {
    name: 'Monthly',
    price: 'KES 500',
    period: '/month',
    color: '#22c55e',
    features: ['Full bot access', 'All strategies', 'Live P&L dashboard', 'Email support'],
    badge: null,
  },
  {
    name: 'Quarterly',
    price: 'KES 1,200',
    period: '/3 months',
    color: '#7c3aed',
    features: ['Everything in Monthly', 'Priority support', 'Advanced risk settings', 'Save 20%'],
    badge: 'POPULAR',
  },
  {
    name: 'Lifetime',
    price: 'KES 5,000',
    period: 'one time',
    color: '#ec4899',
    features: ['Lifetime bot access', 'All future features', 'VIP support', 'Best value'],
    badge: 'BEST DEAL',
  },
];

export default function Scene4Pricing() {
  return (
    <motion.div
      className="absolute inset-0 flex flex-col items-center justify-center px-14 py-10"
      style={{ backgroundColor: '#0a0a0a' }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.5 }}
    >
      <motion.div
        className="text-center mb-10"
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2, duration: 0.7 }}
      >
        <span className="text-sm font-mono uppercase tracking-widest" style={{ color: '#22c55e' }}>
          Pricing Plans
        </span>
        <h2 className="text-5xl font-bold mt-2" style={{ fontFamily: 'var(--font-display)', color: '#ffffff' }}>
          Pick Your Plan
        </h2>
        <p className="mt-3 text-base" style={{ color: '#71717a' }}>
          Pay via M-Pesa · Card · Paystack Wallet
        </p>
      </motion.div>

      <div className="grid grid-cols-3 gap-6 w-full max-w-5xl">
        {PLANS.map((plan, i) => (
          <motion.div
            key={plan.name}
            className="relative rounded-2xl p-7 flex flex-col"
            style={{
              background: i === 1
                ? `linear-gradient(160deg, ${plan.color}1a 0%, #111111 60%)`
                : '#111111',
              border: `1px solid ${i === 1 ? plan.color + '55' : '#222222'}`,
            }}
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.35 + i * 0.15, duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          >
            {plan.badge && (
              <motion.div
                className="absolute -top-3.5 left-1/2 -translate-x-1/2 text-xs font-bold px-4 py-1 rounded-full"
                style={{ background: plan.color, color: '#0a0a0a', fontFamily: 'var(--font-mono)' }}
                initial={{ opacity: 0, scale: 0.7 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.5 + i * 0.15 }}
              >
                {plan.badge}
              </motion.div>
            )}

            <div className="mb-5">
              <div className="text-sm font-mono uppercase tracking-widest mb-3" style={{ color: plan.color }}>
                {plan.name}
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-4xl font-bold" style={{ fontFamily: 'var(--font-display)', color: '#ffffff' }}>
                  {plan.price}
                </span>
                <span className="text-sm" style={{ color: '#52525b' }}>{plan.period}</span>
              </div>
            </div>

            <div className="flex-1 flex flex-col gap-3">
              {plan.features.map((f, j) => (
                <motion.div
                  key={f}
                  className="flex items-center gap-2.5 text-sm"
                  style={{ color: '#a1a1aa' }}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.6 + i * 0.15 + j * 0.07 }}
                >
                  <div className="w-4 h-4 rounded-full flex items-center justify-center shrink-0" style={{ background: `${plan.color}22` }}>
                    <svg width="10" height="10" viewBox="0 0 12 12">
                      <path d="M2 6l3 3 5-5" stroke={plan.color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </div>
                  {f}
                </motion.div>
              ))}
            </div>

            <motion.div
              className="mt-6 rounded-xl py-3 text-center text-sm font-bold"
              style={{
                background: i === 1 ? plan.color : 'transparent',
                color: i === 1 ? '#0a0a0a' : plan.color,
                border: i === 1 ? 'none' : `1px solid ${plan.color}44`,
                fontFamily: 'var(--font-display)',
              }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.9 + i * 0.1 }}
            >
              Get Started
            </motion.div>
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
}
