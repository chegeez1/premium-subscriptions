# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Chege Tech App (chegetech/)

Standalone Express + React subscription store app (NOT in pnpm workspace). Runs on port 5000.

**Key features added:**
1. **Referral System** — Ongoing commissions: referrer earns coins on EVERY purchase by referred customer. Affiliate tiers: Silver (5+ refs, 1.25x), Gold (15+, 1.5x), Platinum (30+, 2x). Tier badge shown in Dashboard.
2. **Customer Wallet** — Balance tracking with top-up via Paystack and wallet payment in checkout. Stored in `wallets` and `wallet_transactions` SQLite/PG tables.
3. **Wallet Top-Up** — `POST /api/customer/wallet/topup/initiate` + `/verify`; Paystack popup in Dashboard; wallet payment option in Checkout.tsx.
4. **PDF Receipts** — `GET /api/customer/orders/:reference/receipt` streams a PDFKit receipt. Download button on Dashboard order cards.
5. **CSV Exports** — Admin routes: `GET /api/admin/export/customers`, `/orders`, `/transactions`. Export buttons in Admin Customers tab and Transactions tab.
6. **Auto-Expiry Tracking** — `expires_at` column on transactions. `deliverAccount()` sets expiry from plan duration.
7. **Cron Jobs** — Daily 9am expiry alerts via email; Sunday 8am weekly Telegram/email report; every-5min campaign scheduler (`chegetech/server/cron.ts`).
8. **Dark/Light Mode** — Toggle button (sun/moon) in Store.tsx header; theme stored in localStorage; `ct-light` CSS class in index.css applies light theme across storefront.
9. **Email Campaigns** — Admin Campaigns tab: create/schedule/send bulk emails by segment (all/active/recent). Stored in settings, cron picks up scheduled ones.
10. **Public Reseller API** — `GET /api/v1/plans`, `POST /api/v1/orders` with X-API-Key auth for resellers.
11. **Replit AI Chatbot** — Uses `AI_INTEGRATIONS_OPENAI_BASE_URL` and `AI_INTEGRATIONS_OPENAI_API_KEY` env vars.

**Dashboard tabs:** Wallet, Referral (with tier badge), Payments, My Products, API Keys, Security, Profile

**Admin tabs:** Dashboard, Plans, Accounts (with subscriber expiry display), Promos, Transactions, API Keys (with reseller docs), Customers, Customer Groups, Conversion Funnel, Ratings, Feature Requests, Email Blast, Campaigns, Support, Logs, Settings, Sub-Admins, Geo Restrict, VPS Manager, Domains

**New API endpoints (server):**
- `POST /api/customer/wallet/topup/initiate` + `/verify` — Paystack wallet top-up
- `POST /api/customer/wallet/pay` — pay for order from wallet balance
- `GET /api/customer/orders/:reference/receipt` — PDF receipt download
- `GET /api/admin/export/customers|orders|transactions` — CSV exports
- `GET/POST/DELETE /api/admin/campaigns` + `/:id/send` — campaign management
- `GET /api/v1/plans`, `POST /api/v1/orders` — public reseller API

**New API endpoints added this session:**
- `POST /api/track` — funnel event tracking (page_view, plan_view, checkout_start, checkout_complete)
- `GET /api/admin/funnel` — conversion funnel analytics with dropoff rates, top plans, live activity
- `GET/POST/PUT/DELETE /api/admin/customer-groups` — group management
- `PATCH /api/admin/customers/:id/group` — assign customer to group
- `GET /api/admin/customer-groups/:id/members` — list group members
- Group discount applied at checkout (both standard and hybrid wallet+Paystack routes)
- `GET /api/v1/plans` + `POST /api/v1/orders` — reseller public API (documented in API Keys tab)

**New DB tables:** `wallets`, `wallet_transactions`, `referrals` (both SQLite and PG); `transactions.expires_at` column added; `funnel_events`, `customer_groups`, `customers.group_id` added

**Subscriber expiry display:** `accounts.ts` now stores `expiresAt` in `usedBy` records; Admin Accounts tab shows per-subscriber expiry with color coding (expired=red, expiring soon=amber)

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Structure

```text
artifacts-monorepo/
├── artifacts/              # Deployable applications
│   └── api-server/         # Express API server
├── lib/                    # Shared libraries
│   ├── api-spec/           # OpenAPI spec + Orval codegen config
│   ├── api-client-react/   # Generated React Query hooks
│   ├── api-zod/            # Generated Zod schemas from OpenAPI
│   └── db/                 # Drizzle ORM schema + DB connection
├── scripts/                # Utility scripts (single workspace package)
│   └── src/                # Individual .ts scripts, run via `pnpm --filter @workspace/scripts run <script>`
├── pnpm-workspace.yaml     # pnpm workspace (artifacts/*, lib/*, lib/integrations/*, scripts)
├── tsconfig.base.json      # Shared TS options (composite, bundler resolution, es2022)
├── tsconfig.json           # Root TS project references
└── package.json            # Root package with hoisted devDeps
```

## TypeScript & Composite Projects

Every package extends `tsconfig.base.json` which sets `composite: true`. The root `tsconfig.json` lists all packages as project references. This means:

- **Always typecheck from the root** — run `pnpm run typecheck` (which runs `tsc --build --emitDeclarationOnly`). This builds the full dependency graph so that cross-package imports resolve correctly. Running `tsc` inside a single package will fail if its dependencies haven't been built yet.
- **`emitDeclarationOnly`** — we only emit `.d.ts` files during typecheck; actual JS bundling is handled by esbuild/tsx/vite...etc, not `tsc`.
- **Project references** — when package A depends on package B, A's `tsconfig.json` must list B in its `references` array. `tsc --build` uses this to determine build order and skip up-to-date packages.

## Root Scripts

- `pnpm run build` — runs `typecheck` first, then recursively runs `build` in all packages that define it
- `pnpm run typecheck` — runs `tsc --build --emitDeclarationOnly` using project references

## Packages

### `artifacts/api-server` (`@workspace/api-server`)

Express 5 API server. Routes live in `src/routes/` and use `@workspace/api-zod` for request and response validation and `@workspace/db` for persistence.

- Entry: `src/index.ts` — reads `PORT`, starts Express
- App setup: `src/app.ts` — mounts CORS, JSON/urlencoded parsing, routes at `/api`
- Routes: `src/routes/index.ts` mounts sub-routers; `src/routes/health.ts` exposes `GET /health` (full path: `/api/health`)
- Depends on: `@workspace/db`, `@workspace/api-zod`
- `pnpm --filter @workspace/api-server run dev` — run the dev server
- `pnpm --filter @workspace/api-server run build` — production esbuild bundle (`dist/index.cjs`)
- Build bundles an allowlist of deps (express, cors, pg, drizzle-orm, zod, etc.) and externalizes the rest

### `lib/db` (`@workspace/db`)

Database layer using Drizzle ORM with PostgreSQL. Exports a Drizzle client instance and schema models.

- `src/index.ts` — creates a `Pool` + Drizzle instance, exports schema
- `src/schema/index.ts` — barrel re-export of all models
- `src/schema/<modelname>.ts` — table definitions with `drizzle-zod` insert schemas (no models definitions exist right now)
- `drizzle.config.ts` — Drizzle Kit config (requires `DATABASE_URL`, automatically provided by Replit)
- Exports: `.` (pool, db, schema), `./schema` (schema only)

Production migrations are handled by Replit when publishing. In development, we just use `pnpm --filter @workspace/db run push`, and we fallback to `pnpm --filter @workspace/db run push-force`.

### `lib/api-spec` (`@workspace/api-spec`)

Owns the OpenAPI 3.1 spec (`openapi.yaml`) and the Orval config (`orval.config.ts`). Running codegen produces output into two sibling packages:

1. `lib/api-client-react/src/generated/` — React Query hooks + fetch client
2. `lib/api-zod/src/generated/` — Zod schemas

Run codegen: `pnpm --filter @workspace/api-spec run codegen`

### `lib/api-zod` (`@workspace/api-zod`)

Generated Zod schemas from the OpenAPI spec (e.g. `HealthCheckResponse`). Used by `api-server` for response validation.

### `lib/api-client-react` (`@workspace/api-client-react`)

Generated React Query hooks and fetch client from the OpenAPI spec (e.g. `useHealthCheck`, `healthCheck`).

### `scripts` (`@workspace/scripts`)

Utility scripts package. Each script is a `.ts` file in `src/` with a corresponding npm script in `package.json`. Run scripts via `pnpm --filter @workspace/scripts run <script>`. Scripts can import any workspace package (e.g., `@workspace/db`) by adding it as a dependency in `scripts/package.json`.
