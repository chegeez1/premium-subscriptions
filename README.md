# ChegeTech — StreamVault Premium

> **One platform. Everything premium.** Trading bots · Streaming accounts · AI tools · VPS · Proxies · Digital store · Developer tools.

---

## 🎬 Promo Video

<div align="center">

  <a href="https://ac66be45-965a-4b0c-a536-67f2200a17e9-00-2fbk9kaywnyiy.janeway.replit.dev/streamvault-promo/" target="_blank">
    <img
      src="docs/promo-video-thumb.jpg"
      alt="▶ Watch the StreamVault Premium Promo Video"
      width="100%"
      style="border-radius:12px;border:2px solid #22c55e44;max-width:900px"
    />
  </a>

  <br/>
  <br/>

  <a href="https://ac66be45-965a-4b0c-a536-67f2200a17e9-00-2fbk9kaywnyiy.janeway.replit.dev/streamvault-promo/" target="_blank">
    <img src="https://img.shields.io/badge/▶%20Watch%20Full%20Video-22c55e?style=for-the-badge&logoColor=white" alt="Watch Video"/>
  </a>
  &nbsp;
  <a href="https://streamvault-premium.site" target="_blank">
    <img src="https://img.shields.io/badge/Visit%20Site-7c3aed?style=for-the-badge&logoColor=white" alt="Visit Site"/>
  </a>

</div>

> Click the thumbnail above to launch the **17-scene animated promo** — with AI voice narration, background music, and live tool demos.

---

## 🗂 What's Inside

This monorepo contains everything that powers **streamvault-premium.site**:

| Artifact | Path | Description |
|---|---|---|
| 🎬 Promo Video | `/streamvault-promo/` | 17-scene animated marketing video with AI narration |
| 🤖 Trading Bot | `/trading-bot/` | ChegeBot Pro dashboard — Boom & Crash auto-trading |
| 🔗 Link Shortener | `/link-shortener/` | URL shortener with click analytics, QR codes, custom slugs |
| ⚙️ API Server | `/api/` | Express 5 REST API — TTS, links, trading, auth |

---

## 🚀 Tools Showcased

### 🤖 ChegeBot Pro
Automated trading on Deriv Boom & Crash indices. 74% average win rate. Plans from **KES 500/month**.

### 🎬 Premium Streaming Accounts
Netflix, Disney+, Spotify, Showmax, Prime Video — verified, instant delivery.

### 🧠 AI Tools
ChatGPT Plus, Claude Pro, Midjourney, GitHub Copilot — all under one subscription.

### 🖥️ VPS Hosting
Linux & Windows VPS from **KES 800/month**. African data centres, instant setup.

### 🔗 Link Shortener
Shorten any URL → `sv.pm/slug`. Click analytics, geo tracking, QR codes. **100% free**.

### 💳 Card Tools
- **CC Generator** — Luhn-valid test cards by BIN profile (Visa, Mastercard, Amex, Discover)
- **CC Checker** — Format, expiry, and BIN validation
- **BIN Lookup** — Bank, country, card tier, and 3D Secure status

### 🌐 Proxies
Free rotating proxies + premium residential, datacenter, mobile & IPv6 plans from **KES 50**.

### 🛒 Digital Store
Gift cards (Amazon, iTunes, Steam), SMM panel, aged social accounts — instant delivery.

### 💬 WhatsApp Bot
Deploy your own WhatsApp sales/support bot in minutes. M-Pesa STK push built-in. From **KES 1,500/month**.

---

## 🏗 Tech Stack

| Layer | Technology |
|---|---|
| Monorepo | pnpm workspaces |
| Language | TypeScript 5.9 |
| Frontend | React + Vite + Tailwind CSS + Framer Motion |
| Backend | Express 5 + Drizzle ORM |
| Database | PostgreSQL |
| Validation | Zod v4 |
| AI / TTS | OpenAI (server-side disk cache) |
| Animation | Framer Motion |
| Fonts | Space Grotesk · DM Sans · JetBrains Mono |

---

## 📦 Getting Started

```bash
# Install dependencies
pnpm install

# Start all services
pnpm --filter @workspace/api-server run dev     # API  → /api
pnpm --filter @workspace/streamvault-promo run dev   # Video → /streamvault-promo
pnpm --filter @workspace/link-shortener run dev      # Links → /link-shortener
pnpm --filter @workspace/trading-bot run dev         # Bot   → /trading-bot
```

### Key Commands

```bash
pnpm run typecheck                            # Full TypeScript check
pnpm run build                                # Typecheck + build all packages
pnpm --filter @workspace/api-spec run codegen # Regenerate API hooks from OpenAPI spec
pnpm --filter @workspace/db run push          # Push DB schema changes (dev only)
```

---

## 🎨 Brand

| Token | Value |
|---|---|
| Background | `#0a0a0a` |
| Green (primary) | `#22c55e` |
| Violet | `#7c3aed` |
| Pink | `#ec4899` |
| Display font | Space Grotesk |
| Body font | DM Sans |
| Mono font | JetBrains Mono |

---

## 📍 Links

- **Website:** [streamvault-premium.site](https://streamvault-premium.site)
- **Promo Video:** [`/streamvault-promo/`](https://ac66be45-965a-4b0c-a536-67f2200a17e9-00-2fbk9kaywnyiy.janeway.replit.dev/streamvault-promo/)
- **Trading Bot:** [`/trading-bot/`](https://ac66be45-965a-4b0c-a536-67f2200a17e9-00-2fbk9kaywnyiy.janeway.replit.dev/trading-bot/)
- **Link Shortener:** [`/link-shortener/`](https://ac66be45-965a-4b0c-a536-67f2200a17e9-00-2fbk9kaywnyiy.janeway.replit.dev/link-shortener/)

---

<div align="center">
  <sub>Built by <strong>ChegeTech</strong> · streamvault-premium.site</sub>
</div>
