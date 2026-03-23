# Chege Tech — Premium Subscription Store

A full-stack e-commerce platform for selling shared premium subscription accounts. Built with Express, React, Vite, and Paystack — featuring a glassmorphism storefront, complete customer portal, comprehensive admin panel, and reseller API.

**Live at:** https://github.com/Mwasdaym/chegetech  
**WhatsApp Support:** +254114291301

---

## Features at a Glance

### Storefront
- 30+ subscription plans across 5 categories (Streaming, Music, Productivity, VPN, Gaming)
- Cart drawer with quantity controls, persisted in localStorage
- Search and category filters with popular picks section
- **Dark / Light mode toggle** — preference saved to localStorage
- Promo code discounts at checkout
- Paystack inline payment popup with reference tracking

### Customer Portal (`/auth`, `/dashboard`)
| Feature | Details |
|---|---|
| Registration | Email + password with 6-digit email verification |
| Login | Session-based, stored in database |
| Forgot Password | 6-digit code via email, 15-minute expiry |
| My Products | All purchases with toggle-reveal credentials + copy buttons |
| Wallet | Top up via Paystack; pay for orders directly from wallet balance |
| Referral | Unique referral link; earn coins on every purchase by referred users |
| Affiliate Tiers | Silver (5+ refs, 1.25×) · Gold (15+, 1.5×) · Platinum (30+, 2×) |
| PDF Receipts | Download receipt PDF for any completed order |
| API Keys | Generate/revoke personal API keys (max 5) |
| 2FA | TOTP via Google Authenticator / Authy |
| Profile | Edit name, change password |

### Checkout
- Paystack payment popup (inline JS)
- **Pay with Wallet** — deduct from wallet balance, skip Paystack entirely
- Promo code validation with live price breakdown

### Admin Panel (`/admin`)
| Tab | What you can do |
|---|---|
| Dashboard | Revenue/orders/email stats, 14-day bar chart, top plans |
| Plans | Edit prices, offer labels, enable/disable, add custom plans |
| Accounts | Add/edit/delete accounts; bulk CSV upload with live preview |
| Promos | Create/toggle/delete discount codes (% or fixed KES) |
| Transactions | Full history, search, status filter, **CSV export**, resend credentials |
| API Keys | Admin-level key management |
| Customers | View, suspend/unsuspend accounts, **CSV export** |
| Campaigns | Create/schedule/send bulk email campaigns by segment |
| Support | Customer support tickets |
| Logs | Full admin audit log, filterable by category |
| Settings | Paystack, Email, Telegram, admin credentials, affiliate tier config |
| Sub-Admins | Add/remove sub-admin accounts |
| Geo Restrict | Block/allow countries |
| VPS Manager | Manage VPS inventory |
| Domains | Custom domain mapping with CNAME instructions |

### Automation & Cron Jobs
- **Daily 9am** — checks accounts expiring within 3 days; emails customers + Telegram alert
- **Sunday 8am** — weekly revenue/orders summary to Telegram + email
- **Every 5 min** — sends scheduled email campaigns
- **Every 2 min** — auto-cancels pending transactions older than 10 minutes

### Telegram Bot
- Admin: `/addaccount`, `/stock`, `/stats`
- Customer: `/buy` (browse & get payment link), `/myorders` (check by email)

### Public Reseller API
| Endpoint | Description |
|---|---|
| `GET /api/v1/plans` | List all available plans |
| `POST /api/v1/orders` | Place an order (requires `X-API-Key` header) |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, Vite, TailwindCSS, shadcn/ui, TanStack Query |
| Backend | Node.js, Express, TypeScript |
| Database | SQLite (`better-sqlite3`) locally · PostgreSQL in production |
| ORM | Drizzle ORM |
| Payments | Paystack (inline popup + webhooks) |
| Email | Nodemailer (Gmail) |
| PDF | PDFKit |
| Scheduling | node-cron |
| Auth | TOTP 2FA (otplib), bcrypt, session tokens |

---

## Project Structure

```
chegetech/
├── client/
│   └── src/
│       └── pages/
│           ├── Store.tsx          # Storefront with dark/light toggle
│           ├── Auth.tsx           # Sign up / login / forgot password
│           ├── Dashboard.tsx      # Customer portal (wallet, referral, orders)
│           ├── Checkout.tsx       # Checkout + wallet payment option
│           └── Admin.tsx          # Full admin panel
├── server/
│   ├── routes.ts                  # All API endpoints
│   ├── storage.ts                 # Database CRUD (SQLite / PostgreSQL)
│   ├── cron.ts                    # Scheduled jobs (expiry, reports, campaigns)
│   ├── email.ts                   # Email delivery
│   ├── auth.ts                    # Admin TOTP auth
│   ├── telegram-bot.ts            # Interactive Telegram bot
│   ├── accounts.ts                # Account inventory
│   ├── promo.ts                   # Promo code manager
│   └── delivery-log.ts            # Delivery tracking
├── shared/
│   └── schema.ts                  # Drizzle ORM schema
└── data/
    └── database.sqlite            # Auto-created on first run
```

---

## Environment Variables

Set these in Replit Secrets or your `.env` file, or directly from the **Admin → Settings** tab.

| Variable | Required | Description |
|---|---|---|
| `PAYSTACK_PUBLIC_KEY` | Yes | Paystack public key |
| `PAYSTACK_SECRET_KEY` | Yes | Paystack secret key |
| `EMAIL_USER` | Yes | Gmail address for sending emails |
| `EMAIL_PASS` | Yes | Gmail app password |
| `SESSION_SECRET` | Yes | Session encryption secret |
| `TELEGRAM_BOT_TOKEN` | Optional | Telegram bot token from @BotFather |
| `TELEGRAM_CHAT_ID` | Optional | Telegram chat ID for admin notifications |
| `EXTERNAL_DATABASE_URL` | Optional | PostgreSQL connection string (production) |

---

## Database

**Development** — SQLite file at `data/database.sqlite`, auto-created on startup.

**Production** — Set `EXTERNAL_DATABASE_URL` to a PostgreSQL connection string (Neon, Supabase, Render PostgreSQL). Without this, data uses SQLite which is wiped on Render's ephemeral filesystem.

All configuration (plans, accounts, promo codes, settings) is stored in a key-value `settings` table. Existing JSON files are auto-migrated on first startup.

### Tables
- `transactions` — Payment records with expiry tracking
- `customers` — Registered customer accounts
- `customer_sessions` — Active session tokens
- `wallets` + `wallet_transactions` — Customer wallet balances
- `referrals` — Referral tracking
- `api_keys` — Customer and admin API keys
- `settings` — Key-value store for all configuration

---

## Deployment (Render)

```bash
# Build command
npm install && npm run build

# Start command
npm start
```

Set `EXTERNAL_DATABASE_URL` to a free PostgreSQL (Neon/Supabase) for persistent data.

Required env vars for production: `PAYSTACK_PUBLIC_KEY`, `PAYSTACK_SECRET_KEY`, `EMAIL_USER`, `EMAIL_PASS`, `SESSION_SECRET`.

---

## Local Development

```bash
cd chegetech
npm install
npm run dev
```

App runs on **http://localhost:5000**  
Store: `/` · Customer portal: `/auth` · Admin: `/admin`

---

## Branding

- **Name:** Chege Tech
- **Support:** WhatsApp +254114291301 · [WhatsApp Channel](https://whatsapp.com/channel/0029VbBx7NeDp2QGF7qoZ02A)
- **Theme:** Glassmorphism dark UI with indigo/violet gradients; switchable light mode
