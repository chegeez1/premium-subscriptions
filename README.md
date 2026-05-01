# ChegeTech — StreamVault Premium

> **One platform. Everything premium.** Trading bots · Streaming accounts · AI tools · VPS · Proxies · Digital store · Developer tools.

<!-- Replace YOUR_GITHUB_USERNAME/YOUR_REPO_NAME below with the actual GitHub repository path -->
[![CI](https://github.com/YOUR_GITHUB_USERNAME/YOUR_REPO_NAME/actions/workflows/ci.yml/badge.svg)](https://github.com/YOUR_GITHUB_USERNAME/YOUR_REPO_NAME/actions/workflows/ci.yml)
[![Sync](https://github.com/YOUR_GITHUB_USERNAME/YOUR_REPO_NAME/actions/workflows/sync.yml/badge.svg)](https://github.com/YOUR_GITHUB_USERNAME/YOUR_REPO_NAME/actions/workflows/sync.yml)

---

## 🎬 Promo Video

<div align="center">

  <a href="https://streamvault-premium.site/advideo/" target="_blank">
    <img
      src="docs/promo-video-thumb.jpg"
      alt="▶ Watch the StreamVault Premium Promo Video"
      width="100%"
      style="border-radius:12px;border:2px solid #22c55e44;max-width:900px"
    />
  </a>

  <br/>
  <br/>

  <a href="https://streamvault-premium.site/advideo/" target="_blank">
    <img src="https://img.shields.io/badge/▶%20Watch%20%2F%20Download%20MP4-22c55e?style=for-the-badge&logoColor=white" alt="Watch & Download"/>
  </a>
  &nbsp;
  <a href="https://streamvault-premium.site/streamvault-promo/" target="_blank">
    <img src="https://img.shields.io/badge/🎬%20Live%20Preview-7c3aed?style=for-the-badge&logoColor=white" alt="Live Preview"/>
  </a>
  &nbsp;
  <a href="https://streamvault-premium.site" target="_blank">
    <img src="https://img.shields.io/badge/Visit%20Site-ec4899?style=for-the-badge&logoColor=white" alt="Visit Site"/>
  </a>

</div>

> Click the thumbnail above to launch the **17-scene animated promo** — with AI voice narration, background music, and live tool demos.

---

## 🗂 What's Inside

This monorepo contains everything that powers **streamvault-premium.site**:

| Artifact | Live URL | Description |
|---|---|---|
| 🎬 Promo Video | [streamvault-premium.site/streamvault-promo/](https://streamvault-premium.site/streamvault-promo/) | 17-scene animated marketing video with AI narration |
| 🤖 Trading Bot | [streamvault-premium.site/trading-bot/](https://streamvault-premium.site/trading-bot/) | ChegeBot Pro dashboard — Boom & Crash auto-trading |
| 🔗 Link Shortener | [streamvault-premium.site/link-shortener/](https://streamvault-premium.site/link-shortener/) | URL shortener with click analytics, QR codes, custom slugs |
| ⚙️ API Server | [streamvault-premium.site/api/](https://streamvault-premium.site/api/) | Express 5 REST API — TTS, links, trading, auth |

---

## 🔗 Domain Routing

All artifacts are served under `streamvault-premium.site` via path-based routing:

```
streamvault-premium.site/                  → Landing / Trading Bot
streamvault-premium.site/streamvault-promo/ → Promo Video (ad)
streamvault-premium.site/link-shortener/   → Link Shortener tool
streamvault-premium.site/api/              → API Server
```

To go live, deploy this project on Replit and point your domain's DNS to the deployed app:

1. **Deploy** — click _Publish_ in Replit to get a `.replit.app` production URL
2. **Custom domain** — in Replit deployment settings, add `streamvault-premium.site` as a custom domain
3. **DNS** — add a `CNAME` record at your registrar pointing `streamvault-premium.site` → your `.replit.app` URL
4. **TLS** — Replit provisions SSL automatically; your video ad URL is live at `https://streamvault-premium.site/streamvault-promo/`

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

## 🔄 GitHub Auto-Sync

Every Replit checkpoint commit is automatically pushed to GitHub, keeping the repo always in sync. Two complementary mechanisms enforce this:

| Mechanism | How it works |
|---|---|
| **Replit Git integration** | Connect via Replit's Git panel — Replit pushes every checkpoint automatically |
| **post-commit hook** | `scripts/hooks/post-commit` pushes to the `github` remote after every commit |

### One-time setup

```bash
# 1. Add your GitHub repository as a remote
git remote add github https://github.com/YOUR_GITHUB_USERNAME/YOUR_REPO_NAME.git

# 2. Install the post-commit hook (also runs automatically on each merge)
bash scripts/install-hooks.sh

# 3. Push the initial state
git push github main
```

After that, every commit — from Replit checkpoints or manual work — is pushed to GitHub automatically without any manual action.

```bash
# Confirm everything is correctly configured at any time
bash scripts/verify-sync.sh
```

### What runs on GitHub after each push

> **Note:** The GitHub Actions workflows below run *after* a push arrives on GitHub. The actual sync (the push itself) is performed by the post-commit hook and/or Replit's Git integration — not by the workflows.

| Workflow | Purpose |
|---|---|
| **CI** (`.github/workflows/ci.yml`) | TypeScript check → production build. Blocks merge if either step fails. |
| **Sync Verified** (`.github/workflows/sync.yml`) | Confirms each push arrived intact and logs the commit hash, message, and timestamp. |

> **Badge URLs** — replace `YOUR_GITHUB_USERNAME/YOUR_REPO_NAME` in the badge lines at the top of this file with your actual GitHub path (e.g. `ChegeT/streamvault-premium`) once the repo is created.

---

## 📦 Getting Started

```bash
# Install dependencies
pnpm install

# Start all services
pnpm --filter @workspace/api-server run dev          # API  → /api
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

| | URL |
|---|---|
| 🌐 Website | [streamvault-premium.site](https://streamvault-premium.site) |
| 🎬 Promo Video | [streamvault-premium.site/streamvault-promo/](https://streamvault-premium.site/streamvault-promo/) |
| 🤖 Trading Bot | [streamvault-premium.site/trading-bot/](https://streamvault-premium.site/trading-bot/) |
| 🔗 Link Shortener | [streamvault-premium.site/link-shortener/](https://streamvault-premium.site/link-shortener/) |
| ⚙️ API | [streamvault-premium.site/api/healthz](https://streamvault-premium.site/api/healthz) |

---

<div align="center">
  <sub>Built by <strong>ChegeTech</strong> · <a href="https://streamvault-premium.site">streamvault-premium.site</a></sub>
</div>
